#!/usr/bin/env python3
"""Exercise preflight with simulated Kubernetes reads and real certificate checks."""
import argparse
import base64
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest import mock
import yaml

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helm', default='helm')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('hyper_preflight', ROOT / 'scripts/preflight.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    real_run = module.run
    with tempfile.TemporaryDirectory(prefix='hyper-preflight-check-') as folder:
        folder = Path(folder)
        private = folder / 'secret.json'
        subprocess.run(['python3', str(ROOT / 'scripts/generate-secrets.py'), '--output', str(private)], check=True, stdout=subprocess.PIPE)
        generated = json.loads(private.read_text())['stringData']
        cert = folder / 'test.crt'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(folder / 'key'),
                        '-out', str(cert), '-days', '1', '-subj', '/CN=*.apps.example.internal', '-addext', 'subjectAltName=DNS:*.apps.example.internal'], check=True, capture_output=True)
        def encoded(data):
            return {k: base64.b64encode(v.encode()).decode() for k, v in data.items()}
        pull = {'auths': {'artifactory.rafael.co.il': {'auth': 'ZHVtbXk6ZHVtbXk='}}}
        objects = {
            ('namespace', 'hypertask'): {},
            ('ingressclass', 'nginx'): {},
            ('storageclasses', ''): {'items': [{'metadata': {'name': 'default', 'annotations': {'storageclass.kubernetes.io/is-default-class': 'true'}}}]},
            ('secret', 'hypertask-secrets'): {'type': 'Opaque', 'data': encoded(generated)},
            ('secret', 'nave-pull-secret'): {'type': 'kubernetes.io/dockerconfigjson', 'data': encoded({'.dockerconfigjson': json.dumps(pull)})},
            ('secret', 'wildcard-tls'): {'type': 'kubernetes.io/tls', 'data': encoded({'tls.crt': cert.read_text(), 'tls.key': 'not-inspected'})},
        }
        values = folder / 'images.json'
        lock = json.loads((ROOT / 'images.lock.json').read_text())
        values.write_text(json.dumps({'images': {key: {'digest': source.split('@')[1]} for key, source in lock['images'].items()}}))
        state = copy.deepcopy(objects)
        def fake_run(command, content=None):
            if command[0] != 'kubectl':
                return real_run(command, content)
            if command[1] == 'create':
                return json.dumps({'kind': 'List', 'items': list(yaml.safe_load_all(content))})
            offset = command.index('get')
            kind = command[offset + 1]
            name = command[offset + 2] if command[offset + 2] != '-o' else ''
            return json.dumps(state[(kind, name)])
        argv = ['preflight.py', '--helm', args.helm, '-f', str(ROOT / 'tests/values.render-test.yaml'), '-f', str(values)]
        def invoke(extra=None):
            with mock.patch.object(module, 'run', side_effect=fake_run), mock.patch.object(sys, 'argv', argv + (extra or [])), contextlib.redirect_stdout(io.StringIO()):
                module.main()
        invoke()
        print('PASS preflight: matching wildcard certificate and complete cluster fixtures')
        cases = {
            'missing JWT key': lambda: state[('secret', 'hypertask-secrets')]['data'].pop('JWT_SECRET'),
            'mismatched S3 keys': lambda: state[('secret', 'hypertask-secrets')]['data'].update(encoded({'S3_ACCESS_KEY': 'different-key'})),
            'missing registry credentials': lambda: state[('secret', 'nave-pull-secret')]['data'].update(encoded({'.dockerconfigjson': '{}'})),
        }
        for name, change in cases.items():
            state = copy.deepcopy(objects)
            change()
            try:
                invoke()
                raise AssertionError('Expected preflight rejection: ' + name)
            except ValueError:
                print('PASS preflight rejected:', name)
        state = copy.deepcopy(objects)
        wrong_host = folder / 'wrong-host.json'
        wrong_host.write_text(json.dumps({'global': {'host': 'hypertask.other.internal'}}))
        try:
            invoke(['-f', str(wrong_host)])
            raise AssertionError('Expected certificate hostname rejection')
        except ValueError:
            print('PASS preflight rejected: certificate does not cover hostname')


if __name__ == '__main__':
    main()
