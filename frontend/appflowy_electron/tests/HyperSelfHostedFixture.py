#!/usr/bin/env python3
"""Prepare a new disposable Compose directory; never starts services or reads a real .env."""
import argparse
import json
import pathlib
import secrets
import shutil
import socket
import tempfile


def prepare(port=0):
    if not 0 <= port <= 65535:
        raise ValueError('Choose a port between 0 and 65535.')
    if port == 0:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
    deployment = pathlib.Path(__file__).resolve().parents[3] / 'deploy' / 'self-hosted'
    target = pathlib.Path(tempfile.mkdtemp(prefix='hypertask-self-hosted-test-'))
    target.chmod(0o700)
    try:
        instance = secrets.token_hex(16)
        project = 'hypertask-test-' + instance
        origin = 'http://127.0.0.1:' + str(port)
        values = {
            'SERVER_ORIGIN': origin, 'HTTP_PORT': str(port), 'BIND_ADDRESS': '127.0.0.1',
            'POSTGRES_PASSWORD': secrets.token_hex(32), 'JWT_SECRET': secrets.token_hex(48),
            'S3_SECRET': secrets.token_hex(32),
        }
        content = (deployment / 'compose.yaml').read_text()
        if not content.startswith('name: appflowy-demo\n'):
            raise RuntimeError('Review the changed Compose project name before preparing tests.')
        (target / 'compose.yaml').write_text(content.replace('name: appflowy-demo\n', 'name: ' + project + '\n', 1))
        nginx = (deployment / 'nginx.conf').read_text()
        marker = 'location = /healthz { access_log off;'
        if nginx.count(marker) != 1:
            raise RuntimeError('Review the changed health endpoint before preparing tests.')
        nginx = nginx.replace(marker, marker + ' add_header X-HyperTask-Test-Instance "' + instance + '" always;', 1)
        (target / 'nginx.conf').write_text(nginx)
        (target / '.env').write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))
        (target / '.s3.json').write_text(json.dumps({'identities': [{'name': 'appflowy-test', 'credentials': [{'accessKey': 'appflowy_storage', 'secretKey': values['S3_SECRET']}], 'actions': ['Admin', 'Read', 'Write', 'List', 'Tagging']}]}))
        manifest = {'directory': str(target), 'project': project, 'origin': origin, 'instance': instance, 'local_only': True, 'started': False}
        (target / '.hyper-test-instance.json').write_text(json.dumps(manifest))
        for name in ['.env', '.s3.json', '.hyper-test-instance.json']:
            (target / name).chmod(0o600)
        return manifest
    except BaseException:
        shutil.rmtree(target)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=0, help='Loopback port; 0 selects a currently free port.')
    parser.add_argument('--directory-only', action='store_true', help='Print just the new directory path for shell use.')
    arguments = parser.parse_args()
    result = prepare(arguments.port)
    print(result['directory'] if arguments.directory_only else json.dumps(result))
