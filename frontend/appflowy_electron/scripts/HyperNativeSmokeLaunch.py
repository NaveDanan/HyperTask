#!/usr/bin/env python3
"""Launch/relaunch one disposable HyperTask app using already built binaries."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.request


def owns_command(arguments, app, profile, port):
    expected = [str(app), '--user-data-dir=' + str(profile / 'electron'), '--remote-debugging-port=' + str(port)]
    if all(value in arguments for value in expected):
        return True
    # Linux Electron may expose its complete command as one rewritten process title.
    # Require complete space-delimited values, not path-prefix/substr matches.
    return len(arguments) == 1 and all(re.search(r'(?<!\S)' + re.escape(value) + r'(?!\S)', arguments[0]) for value in expected)


def _process_running(proc_dir):
    try:
        return (proc_dir / 'stat').read_text().rsplit(') ', 1)[1].split()[0] != 'Z'
    except FileNotFoundError:
        return False


def wait_for_cores(children, timeout=10):
    deadline = time.monotonic() + timeout
    while any(_process_running(child) for child in children):
        if time.monotonic() >= deadline:
            raise RuntimeError('Owned core has not exited; no replacement was launched')
        time.sleep(.05)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', type=Path, required=True, help='Disposable test profile; all stores are retained')
    parser.add_argument('--status', type=Path, required=True, help='Private launch metadata for the native smoke runner')
    parser.add_argument('--core', type=Path, required=True, help='Existing appflowy_core binary; never rebuilt here')
    parser.add_argument('--electron', type=Path, help='Existing Electron binary; defaults to node_modules/electron/dist/electron')
    parser.add_argument('--restart', action='store_true', help='Replace only the owned process recorded in status')
    parser.add_argument('--allow-test-profile', action='store_true', help='Confirm this is a disposable developer profile')
    parser.add_argument('--development-no-sandbox', action='store_true', help='Process-only development flag; not production packaging')
    args = parser.parse_args()
    if sys.platform != 'linux' or not args.allow_test_profile:
        parser.error('Linux and --allow-test-profile are required')
    app = Path(__file__).resolve().parent.parent
    profile, status = args.profile.resolve(), args.status.resolve()
    core = args.core.resolve()
    electron = (args.electron or app / 'node_modules/electron/dist/electron').resolve()
    for binary in [core, electron]:
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise RuntimeError('An existing executable binary is required')
    if not (app / 'out/main/index.js').is_file():
        raise RuntimeError('Build the frontend before launching its smoke profile')
    previous = json.loads(status.read_text()) if status.exists() else None
    if previous:
        if previous.get('profile') != str(profile):
            raise RuntimeError('Status belongs to a different profile')
        old_pid = previous.get('pid')
        if not isinstance(old_pid, int) or old_pid < 1:
            raise RuntimeError('Invalid owned process metadata')
        proc = Path('/proc') / str(old_pid)
        if proc.exists():
            if not args.restart:
                raise RuntimeError('Owned app is still running; use --restart to replace it')
            arguments = [value for value in (proc / 'cmdline').read_bytes().decode().split('\0') if value]
            if not owns_command(arguments, app, profile, previous.get('debugPort')):
                raise RuntimeError('Refusing to signal a process outside the recorded app/profile/port')
            children = []
            for candidate in Path('/proc').iterdir():
                if not candidate.name.isdigit():
                    continue
                try:
                    stat = (candidate / 'stat').read_text().rsplit(') ', 1)[1].split()
                    if (candidate / 'comm').read_text().strip() == 'appflowy_core' and int(stat[1]) == old_pid:
                        children.append(candidate)
                except (FileNotFoundError, PermissionError, ProcessLookupError):
                    pass
            os.kill(old_pid, signal.SIGTERM)
            deadline = time.monotonic() + 10
            while proc.exists() and time.monotonic() < deadline:
                try:
                    if (proc / 'stat').read_text().rsplit(') ', 1)[1].split()[0] == 'Z':
                        break
                except FileNotFoundError:
                    break
                time.sleep(.1)
            else:
                if proc.exists():
                    raise RuntimeError('Owned app has not exited; no replacement was launched')
            for child in children:
                try:
                    if (child / 'comm').read_text().strip() == 'appflowy_core':
                        os.kill(int(child.name), signal.SIGTERM)
                except (FileNotFoundError, ProcessLookupError):
                    pass
            wait_for_cores(children)
    profile.mkdir(mode=0o700, parents=True, exist_ok=True)
    logs = profile / 'smoke-logs'
    logs.mkdir(mode=0o700, exist_ok=True)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    env.update(APPFLOWY_CORE_BINARY=str(core), APPFLOWY_SUPPORT_DIR=str(profile / 'support'),
               XDG_CONFIG_HOME=str(profile / 'config'), XDG_CACHE_HOME=str(profile / 'cache'))
    observed = datetime.datetime.now(datetime.timezone.utc)
    log_path = logs / ('HyperNativeSmoke-' + observed.strftime('%Y%m%dT%H%M%S%fZ') + '.log')
    command = [str(electron), str(app), '--user-data-dir=' + str(profile / 'electron'),
               '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + str(port)]
    if args.development_no_sandbox:
        command.append('--no-sandbox')
    with log_path.open('xb') as log:
        log_path.chmod(0o600)
        process = subprocess.Popen(command, cwd=app, env=env, stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('Owned Electron exited; inspect its private smoke log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/json', timeout=1) as response:
                    targets = json.load(response)
                if any(target.get('type') == 'page' for target in targets):
                    break
            except (OSError, ValueError):
                pass
            time.sleep(.2)
        else:
            raise RuntimeError('Owned Electron debugging endpoint did not become ready')
        record = {'pid': process.pid, 'debugPort': port, 'profile': str(profile),
                  'buildHead': subprocess.check_output(['git', '-C', str(app), 'rev-parse', 'HEAD'], text=True).strip(),
                  'observedAt': observed.isoformat(), 'developmentNoSandbox': args.development_no_sandbox}
        status.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = status.with_name(status.name + '.tmp-' + str(process.pid))
        with temporary.open('x') as output:
            temporary.chmod(0o600)
            json.dump(record, output, indent=2)
            output.write('\n')
        temporary.replace(status)
        print(json.dumps({'state': 'owned_test_app_open', 'pid': process.pid, 'debugPort': port,
                          'buildHead': record['buildHead']}))
    except Exception:
        # Only the process just created here is eligible for cleanup. Never scan/kill other apps.
        process.terminate()
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Native smoke launch failed; inspect the selected disposable profile privately.', file=sys.stderr)
        raise SystemExit(1)
