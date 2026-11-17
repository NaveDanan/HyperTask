#!/usr/bin/env python3
"""Opt-in Linux Docker smoke test of rendered chart settings. No Kubernetes writes.
Uses pinned source images from images.lock.json on a Docker test host, NOT cluster
nodes. Creates a random Compose project and removes only its containers/volumes.
"""
import argparse
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import yaml

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helm', default='helm')
    args = parser.parse_args()
    project = 'hyper-chart-smoke-' + secrets.token_hex(4)
    lock = json.loads((ROOT / 'images.lock.json').read_text())
    with tempfile.TemporaryDirectory(prefix=project + '-') as folder:
        folder = Path(folder)
        os.chmod(folder, 0o700)
        private = folder / 'secret.json'
        subprocess.run(['python3', str(ROOT / 'scripts/generate-secrets.py'), '--output', str(private)], check=True, stdout=subprocess.DEVNULL)
        credentials = json.loads(private.read_text())['stringData']
        render = subprocess.check_output([args.helm, 'template', project, str(ROOT / 'chart'), '-n', 'hypertask', '-f', str(ROOT / 'tests/values.render-test.yaml')], text=True)
        resources = [o for o in yaml.safe_load_all(render) if o]
        config = next(o['data'] for o in resources if o['kind'] == 'ConfigMap')
        services, volumes = {}, {}
        for obj in resources:
            if obj['kind'] not in ('StatefulSet', 'Deployment'):
                continue
            pod = obj['spec']['template']['spec']
            container = pod['containers'][0]
            component = container['name']
            service_name = obj['metadata']['name']
            env = {}
            for item in container.get('env', []):
                if 'value' in item:
                    env[item['name']] = re.sub(r'\$\(([^)]+)\)', lambda match: env[match[1]], item['value'])
                elif 'secretKeyRef' in item.get('valueFrom', {}):
                    ref = item['valueFrom']['secretKeyRef']
                    env[item['name']] = credentials.get(ref['key'], '')
                else:
                    env[item['name']] = service_name  # POD_IP: Docker DNS alias for SeaweedFS
            service = {'image': lock['images'][component], 'platform': lock['platform'], 'environment': env, 'restart': 'on-failure:5'}
            if container.get('workingDir'):
                service['working_dir'] = container['workingDir']
            if container.get('args'):
                service['command'] = [re.sub(r'\$\(([^)]+)\)', lambda match: env[match[1]], a) for a in container['args']]
            previous = None
            for number, init in enumerate(pod.get('initContainers', [])):
                init_name = service_name + '-init-' + str(number)
                init_component = 'postgres' if init['name'] == 'wait-postgres' else 'proxy'
                dependencies = {project + '-postgres': {'condition': 'service_started'}}
                if previous:
                    dependencies[previous] = {'condition': 'service_completed_successfully'}
                    dependencies.update({project + '-' + c: {'condition': 'service_started'} for c in ('gotrue', 'redis', 'storage')})
                services[init_name] = {'image': lock['images'][init_component], 'entrypoint': init['command'],
                                       'command': init['args'], 'depends_on': dependencies}
                previous = init_name
            if previous:
                service['depends_on'] = {previous: {'condition': 'service_completed_successfully'}}
            if component == 'proxy':
                service['depends_on'] = {project + '-' + c: {'condition': 'service_started'} for c in ('cloud', 'gotrue', 'storage', 'admin')}
            if component in ('postgres', 'redis'):
                service['healthcheck'] = {'test': ['CMD', *[part.replace('$', '$$') for part in container['readinessProbe']['exec']['command']]], 'interval': '2s', 'timeout': '5s', 'retries': 60}
            mounts = {v['name']: v for v in pod.get('volumes', [])}
            for mount in container.get('volumeMounts', []):
                volume = mounts[mount['name']]
                if 'persistentVolumeClaim' in volume:
                    source = component + '-data'
                    volumes[source] = {}
                else:
                    source = folder / (component + '-' + mount['name'])
                    source.mkdir()
                    ref = volume.get('configMap') or volume['secret']
                    data = config if 'configMap' in volume else credentials
                    items = ref.get('items', [{'key': key, 'path': key} for key in data])
                    for entry in items:
                        target = source / entry['path']
                        target.write_text(data[entry['key']])
                        target.chmod(0o644)
                    if mount.get('subPath'):
                        source = source / mount['subPath']
                    source = str(source)
                service.setdefault('volumes', []).append(source + ':' + mount['mountPath'] + (':ro' if mount.get('readOnly') else ''))
            if component == 'proxy':
                service['ports'] = ['127.0.0.1::8080']
            services[service_name] = service
        compose_path = folder / 'compose.json'
        compose_path.write_text(json.dumps({'services': services, 'volumes': volumes}))
        compose_path.chmod(0o600)
        compose = ['docker', 'compose', '-p', project, '-f', str(compose_path)]
        def command(*parts, check=True):
            return subprocess.run([*compose, *parts], check=check, capture_output=True, text=True)
        try:
            command('up', '-d', '--quiet-pull')
            endpoint = command('port', project + '-proxy', '8080').stdout.strip()
            origin = 'http://' + endpoint
            def request(path, data=None, headers=None, method=None):
                req = urllib.request.Request(origin + path, data=data, headers=headers or {}, method=method)
                with urllib.request.urlopen(req, timeout=5) as response:
                    return response.read()
            deadline = time.monotonic() + 240
            while True:
                try:
                    for route in ['/healthz', '/gotrue/health', '/health']:
                        request(route)
                    break
                except (OSError, urllib.error.HTTPError):
                    if time.monotonic() > deadline:
                        raise RuntimeError('Isolated backend did not become ready in 240 seconds')
                    time.sleep(2)
            print('PASS runtime: proxy, GoTrue and cloud health', flush=True)
            account = {'email': 'chart-' + secrets.token_hex(6) + '@example.test', 'password': secrets.token_urlsafe(24)}
            session = json.loads(request('/gotrue/signup', json.dumps(account).encode(), {'Content-Type': 'application/json'}))
            token = session['access_token']
            verified = json.loads(request('/api/user/verify/' + token))
            assert verified['code'] == 0
            # A different signature must not authenticate.
            parts = token.split('.')
            parts[2] = ('A' if parts[2][0] != 'A' else 'B') + parts[2][1:]
            try:
                invalid = json.loads(request('/api/user/verify/' + '.'.join(parts)))
                assert invalid.get('code') != 0, 'Tampered JWT was accepted'
            except urllib.error.HTTPError as error:
                assert error.code in (400, 401, 403)
            print('PASS runtime: signup/session, cloud account creation, tampered JWT rejection', flush=True)
            def s3(method, resource, body=b''):
                now = datetime.datetime.now(datetime.timezone.utc)
                day, stamp = now.strftime('%Y%m%d'), now.strftime('%Y%m%dT%H%M%SZ')
                digest = hashlib.sha256(body).hexdigest()
                signed = 'host;x-amz-content-sha256;x-amz-date'
                headers = 'host:' + project + '-storage:9000\nx-amz-content-sha256:' + digest + '\nx-amz-date:' + stamp + '\n'
                canonical = '\n'.join((method, resource, '', headers, signed, digest))
                scope = day + '/us-east-1/s3/aws4_request'
                to_sign = '\n'.join(('AWS4-HMAC-SHA256', stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()))
                def sign(key, value):
                    return hmac.new(key, value.encode(), hashlib.sha256).digest()
                key = sign(sign(sign(sign(('AWS4' + credentials['S3_SECRET_KEY']).encode(), day), 'us-east-1'), 's3'), 'aws4_request')
                signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
                auth = 'AWS4-HMAC-SHA256 Credential=' + credentials['S3_ACCESS_KEY'] + '/' + scope + ', SignedHeaders=' + signed + ', Signature=' + signature
                return request('/minio-api' + resource, body if method == 'PUT' else None,
                               {'x-amz-date': stamp, 'x-amz-content-sha256': digest, 'Authorization': auth}, method)
            resource = '/appflowy/chart-smoke.txt'
            payload = b'HyperTask Helm storage roundtrip'
            s3('PUT', resource, payload)
            assert s3('GET', resource) == payload
            s3('DELETE', resource)
            print('PASS runtime: authenticated S3 PUT/GET/DELETE through nginx', flush=True)
        except Exception as error:
            # Logs could contain session URLs: do not dump them or secret-bearing Compose data.
            raise RuntimeError('Isolated smoke test failed: ' + type(error).__name__) from None
        finally:
            command('down', '--volumes', '--remove-orphans', check=False)
            print('Removed isolated Docker test project:', project, flush=True)


if __name__ == '__main__':
    main()
