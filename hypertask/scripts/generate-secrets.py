#!/usr/bin/env python3
"""Create a fresh-install Kubernetes Secret locally; never overwrite existing keys."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--namespace', default='hypertask')
    parser.add_argument('--name', default='hypertask-secrets')
    parser.add_argument('--output', type=Path, default=Path('.private/hypertask-secret.json'))
    parser.add_argument('--keycloak', action='store_true', help='Prompt securely for the Keycloak client secret')
    parser.add_argument('--smtp', action='store_true', help='Prompt for SMTP username/password')
    args = parser.parse_args()
    for value in (args.namespace, args.name):
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', value):
            parser.error('Invalid Kubernetes name')
    if args.output.exists():
        parser.error('Output already exists. Reuse it for upgrades; do not regenerate credentials.')
    data = {
        'POSTGRES_PASSWORD': secrets.token_hex(32),
        'JWT_SECRET': secrets.token_hex(48),
        'S3_ACCESS_KEY': 'hyper' + secrets.token_hex(10),
        'S3_SECRET_KEY': secrets.token_hex(32),
    }
    data['S3_CONFIG_JSON'] = json.dumps({'identities': [{
        'name': 'hypertask',
        'credentials': [{'accessKey': data['S3_ACCESS_KEY'], 'secretKey': data['S3_SECRET_KEY']}],
        'actions': ['Admin', 'Read', 'Write', 'List', 'Tagging'],
    }]})
    if args.keycloak:
        data['KEYCLOAK_CLIENT_SECRET'] = getpass.getpass('Keycloak client secret: ')
        if not data['KEYCLOAK_CLIENT_SECRET'].strip():
            parser.error('Keycloak client secret must not be empty')
    if args.smtp:
        data['SMTP_USERNAME'] = input('SMTP username: ').strip()
        data['SMTP_PASSWORD'] = getpass.getpass('SMTP password: ')
    manifest = {'apiVersion': 'v1', 'kind': 'Secret',
                'metadata': {'name': args.name, 'namespace': args.namespace},
                'type': 'Opaque', 'stringData': data}
    args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # O_EXCL prevents races and accidental replacement; mode 0600 on Linux.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(manifest, stream, indent=2)
        stream.write('\n')
    print('Created private Secret file:', args.output)
    print('Apply it once, back it up securely, and reuse it for upgrades.')


if __name__ == '__main__':
    main()
