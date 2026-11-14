"""HyperTask's fixed, scoped development backend controller. No provisioning or secret output."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/home/agent/.local/share/hypertask-openbot-backend')
APP = Path('/home/agent/HyperTask-OpenBot-backend')
PROJECT = 'hypertask-openbot-baseline'
STACK = 'local-e866e019ee833a9f6ad99038'
NODE = 'k3d-' + STACK + '-server-0'
SERVICES = {'postgres': 'postgres', 'computer': 'agent-computer', 'harness': 'agent-harness', 'server': 'server', 'worker': 'worker'}
IDS = ['docker', 'deployment', *SERVICES, 'runtime', 'license', 'provider']
ENV = dict(os.environ, PATH=str(ROOT / 'tools/node-v22.23.5-linux-x64/bin') + ':' + os.environ.get('PATH', ''), COPILOTKIT_CONFIG_DIR=str(ROOT / 'cli-state'), DOCKER_HOST='unix:///var/run/docker.sock', DOCKER_CONFIG=str(ROOT / 'docker-client'))
ENV.pop('DOCKER_CONTEXT', None)
COMPOSE = ['docker', 'compose', '-p', PROJECT, '-f', str(APP / 'docker-compose.yml'), '-f', str(ROOT / 'HyperVmCompose.json'), '--profile', 'harness', '--profile', 'openbot']
CLI = [str(ROOT / 'cli/node_modules/.bin/copilotkit'), 'local']


def command(args, timeout=15):
    return subprocess.run(args, cwd=APP if APP.is_dir() else None, env=ENV, capture_output=True, text=True, timeout=timeout, check=True).stdout


def report():
    return {'version': 1, 'ready': False, 'problem': 'setup_required', 'checks': [{'id': key, 'state': 'unknown'} for key in IDS]}


def state(result, key, value):
    next(row for row in result['checks'] if row['id'] == key)['state'] = value


def inspect(name):
    # Only state, ownership and network settings are read. Never ask Docker for environment values.
    template = '{{json .State}}\n{{json .HostConfig.PortBindings}}\n{{json .HostConfig.NetworkMode}}\n{{index .Config.Labels "com.docker.compose.project"}}\n{{index .Config.Labels "com.docker.compose.service"}}\n{{index .Config.Labels "k3d.cluster"}}'
    lines = command(['docker', 'inspect', '--format', template, name]).splitlines()
    return json.loads(lines[0]), json.loads(lines[1]), json.loads(lines[2]), lines[3:]


def private_ports(ports):
    return all(binding.get('HostIp') in ('127.0.0.1', '::1') for bindings in (ports or {}).values() for binding in (bindings or []))


def private_network(network):
    # Shared namespaces ignore the container's published-port contract. A sibling
    # namespace can itself use host networking, so reject both forms before start.
    return isinstance(network, str) and bool(network) and network != 'host' and not network.startswith('container:')


def readiness():
    result = report()
    try:
        command(['docker', 'info', '--format', '{{.ServerVersion}}'])
    except (OSError, subprocess.SubprocessError):
        state(result, 'docker', 'missing'); result['problem'] = 'docker_unavailable'; return result
    state(result, 'docker', 'ready')
    if not all(p.exists() for p in [APP / 'docker-compose.yml', ROOT / 'HyperVmCompose.json', Path(CLI[0])]):
        state(result, 'deployment', 'missing'); return result
    try:
        node_state, ports, network, labels = inspect(NODE)
        if labels[-1] != STACK or not private_network(network) or not private_ports(ports):
            result['problem'] = 'unsafe_deployment'; return result
        state(result, 'deployment', 'ready' if node_state['Running'] else 'stopped')
        for check, service in SERVICES.items():
            current, ports, network, labels = inspect(PROJECT + '-' + service + '-1')
            if labels[:2] != [PROJECT, service] or not private_network(network) or not private_ports(ports):
                result['problem'] = 'unsafe_deployment'; return result
            value = 'stopped' if not current['Running'] else 'unhealthy' if current.get('Health', {}).get('Status', 'healthy') != 'healthy' else 'ready'
            state(result, check, value)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError):
        state(result, 'deployment', 'missing'); return result
    if any(row['state'] == 'stopped' for row in result['checks'][:7]):
        result['problem'] = 'services_stopped'; return result
    if any(row['state'] == 'unhealthy' for row in result['checks'][:7]):
        result['problem'] = 'services_unhealthy'; return result
    try:
        with urllib.request.urlopen('http://127.0.0.1:3010/health', timeout=4) as response:
            if response.status != 200:
                raise ValueError('unhealthy')
        with urllib.request.urlopen('http://127.0.0.1:3010/api/copilotkit/info', timeout=8) as response:
            info = json.load(response)
        if info.get('mode') != 'intelligence':
            raise ValueError('not original runtime')
        state(result, 'runtime', 'ready')
        if info.get('licenseStatus') != 'valid':
            state(result, 'license', 'missing'); result['problem'] = 'license_required'; return result
        state(result, 'license', 'ready')
    except (OSError, ValueError, TimeoutError):
        state(result, 'runtime', 'unhealthy'); result['problem'] = 'runtime_unavailable'; return result
    store = ROOT / 'private/provider/chatgpt-auth.json'
    if not store.is_file() or store.stat().st_size == 0:
        state(result, 'provider', 'missing'); result['problem'] = 'provider_required'; return result
    state(result, 'provider', 'ready')
    result.update(ready=True, problem='none')
    return result


def operate(action):
    initial = readiness()
    # No setup, new cluster, image build/pull, agreement acceptance, account flow or volume deletion.
    if action == 'check' or initial['problem'] in ('docker_unavailable', 'setup_required', 'unsafe_deployment'):
        return initial
    if action == 'start' and initial['ready']:
        return initial
    already_stopped = all(row['state'] == 'stopped' for row in initial['checks'] if row['id'] in ('deployment', *SERVICES))
    if action in ('stop', 'restart') and not already_stopped:
        command(COMPOSE + ['stop', '--timeout', '30', 'worker', 'server', 'agent-harness', 'agent-computer', 'postgres'], 100)
        command(CLI + ['stop', '--stack', STACK, '--json'], 100)
    if action == 'stop':
        return readiness()
    if action in ('start', 'restart'):
        command(['docker', 'start', NODE], 30)
        command(CLI + ['start', '--stack', STACK, '--json'], 100)
        # Start existing containers only, preserving their IDs, images, mounts and published bindings.
        command(COMPOSE + ['start', 'postgres', 'agent-computer', 'agent-harness', 'server', 'worker'], 100)
        deadline = time.monotonic() + 90
        while True:
            current = readiness()
            if current['ready'] or current['problem'] in ('license_required', 'provider_required', 'unsafe_deployment') or time.monotonic() >= deadline:
                return current
            time.sleep(1)
    return initial


def main():
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    if action not in ('check', 'start', 'stop', 'restart'):
        raise ValueError('unsupported operation')
    if action == 'check':
        return readiness()
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(ROOT / 'HyperDesktopLifecycle.lock', os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return operate(action)


if __name__ == '__main__':
    try:
        result = main()
    except Exception:
        # Docker/CLI error output may include deployment details. It never crosses the renderer boundary.
        result = report(); result['problem'] = 'operation_failed'
    print(json.dumps(result, separators=(',', ':')))
