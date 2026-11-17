#!/usr/bin/env python3
"""Lint/render deployment profiles and check wiring. Requires Helm and PyYAML."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import yaml

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helm', default='helm')
    parser.add_argument('--kubeconform', help='Optional kubeconform executable for Kubernetes API schema checks')
    args = parser.parse_args()
    base = [args.helm, 'template', 'hypertask', str(ROOT / 'chart'), '-n', 'hypertask', '-f', str(ROOT / 'tests/values.render-test.yaml')]
    profiles = {
        'nginx-tls': ['-f', str(ROOT / 'values.tls.example.yaml')],
        'traefik-tls': ['-f', str(ROOT / 'values.traefik.example.yaml')],
        'controller-default-tls': ['-f', str(ROOT / 'values.controller-default-tls.example.yaml')],
        'keycloak': ['-f', str(ROOT / 'values.keycloak.example.yaml')],
        'keycloak-context-path': ['-f', str(ROOT / 'values.keycloak.example.yaml'), '--set', 'keycloak.issuerUrl=https://sso.company.internal/auth/realms/company'],
        'smtp': ['--set', 'smtp.enabled=true,smtp.host=smtp.company.internal,smtp.tlsKind=required'],
        'private-ca-no-admin': ['-f', str(ROOT / 'values.keycloak.example.yaml'), '--set', 'global.trustedCa.existingConfigMap=company-ca,admin.enabled=false'],
        'web': ['--set', 'web.enabled=true'],
        'existing-claims': ['--set', 'postgres.existingClaim=pg-data,redis.existingClaim=redis-data,storage.existingClaim=file-data'],
        'internal-only': ['--set', 'ingress.enabled=false,networkPolicy.enabled=false'],
    }
    for name, extra in profiles.items():
        lint = [args.helm, 'lint', str(ROOT / 'chart'), '--strict', '-f', str(ROOT / 'tests/values.render-test.yaml'), *extra]
        subprocess.run(lint, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        result = subprocess.run(base + extra, check=True, capture_output=True, text=True)
        objects = list(yaml.safe_load_all(result.stdout))
        objects = [obj for obj in objects if obj]
        index = {(obj['kind'], obj['metadata']['name']): obj for obj in objects}
        assert len(index) == len(objects), 'Duplicate resource names'
        assert not any(obj['kind'] == 'Secret' for obj in objects), 'Secrets must remain external'
        for obj in objects:
            assert obj['metadata']['namespace'] == 'hypertask'
            if obj['kind'] not in ('StatefulSet', 'Deployment'):
                continue
            pod = obj['spec']['template']['spec']
            assert pod['imagePullSecrets'] == [{'name': 'nave-pull-secret'}]
            assert pod['automountServiceAccountToken'] is False
            labels = obj['spec']['template']['metadata']['labels']
            assert all(labels[k] == v for k, v in obj['spec']['selector']['matchLabels'].items())
            volumes = {volume['name'] for volume in pod.get('volumes', [])}
            for container in pod['containers'] + pod.get('initContainers', []):
                assert container['image'].startswith('artifactory.rafael.co.il/mems-docker-local-ww/danan/')
                assert all(mount['name'] in volumes for mount in container.get('volumeMounts', []))
                for env in container.get('env', []):
                    if 'value' in env:
                        assert isinstance(env['value'], str), 'Environment values must be strings'
            if obj['kind'] == 'StatefulSet':
                assert ('Service', obj['spec']['serviceName']) in index
        for obj in objects:
            if obj['kind'] == 'Service':
                matches = [item for item in objects if item['kind'] in ('Deployment', 'StatefulSet') and all(
                    item['spec']['template']['metadata']['labels'].get(k) == v for k, v in obj['spec']['selector'].items())]
                assert len(matches) == 1, 'Service must select one workload'
                exposed = {p['containerPort'] for p in matches[0]['spec']['template']['spec']['containers'][0]['ports']}
                assert all(p['targetPort'] in exposed for p in obj['spec']['ports'])
        gotrue = index[('Deployment', 'hypertask-gotrue')]['spec']['template']['spec']['containers'][0]
        gotrue_env = {e['name']: e for e in gotrue['env']}
        cloud = index[('Deployment', 'hypertask-cloud')]['spec']['template']['spec']['containers'][0]
        assert any(e['name'] == 'APPFLOWY_DATABASE_URL' for e in cloud['env'])
        if 'keycloak' in name or name == 'private-ca-no-admin':
            assert gotrue_env['GOTRUE_EXTERNAL_EMAIL_ENABLED']['value'] == 'false'
            assert gotrue_env['GOTRUE_EXTERNAL_KEYCLOAK_ENABLED']['value'] == 'true'
            assert gotrue_env['GOTRUE_EXTERNAL_KEYCLOAK_REDIRECT_URI']['value'].endswith('/gotrue/callback')
            assert gotrue_env['GOTRUE_EXTERNAL_KEYCLOAK_SECRET']['valueFrom']['secretKeyRef']['key'] == 'KEYCLOAK_CLIENT_SECRET'
        if name == 'existing-claims':
            assert not any(obj['kind'] == 'PersistentVolumeClaim' for obj in objects)
        if args.kubeconform:
            subprocess.run([args.kubeconform, '-strict', '-summary', '-kubernetes-version', '1.31.0'], input=result.stdout, text=True, check=True)
        print('PASS profile:', name)
    failures = {
        'placeholder images': [args.helm, 'template', 'hypertask', str(ROOT / 'chart')],
        'latest tag': base + ['--set', 'images.cloud.tag=latest'],
        'external image': base + ['--set', 'images.cloud.repository=docker.io/example/cloud'],
        'missing TLS': base + ['--set', 'ingress.tls.secretName='],
        'conflicting TLS': base + ['--set', 'ingress.tls.useControllerDefaultCertificate=true'],
        'invalid Keycloak issuer': base + ['--set', 'keycloak.enabled=true,keycloak.issuerUrl=http://example.internal/realm'],
        'missing SMTP host': base + ['--set', 'smtp.enabled=true'],
        'unsafe database identifier': base + ['--set-string', 'postgres.username=bad;name'],
    }
    for name, command in failures.items():
        assert subprocess.run(command, capture_output=True).returncode != 0, 'Expected rejection: ' + name
        print('PASS rejected:', name)
    with tempfile.TemporaryDirectory(prefix='hyper-secret-check-') as directory:
        output = Path(directory) / 'secret.json'
        command = ['python3', str(ROOT / 'scripts/generate-secrets.py'), '--output', str(output)]
        subprocess.run(command, check=True, stdout=subprocess.PIPE)
        original = output.read_bytes()
        secret = json.loads(original)['stringData']
        creds = json.loads(secret['S3_CONFIG_JSON'])['identities'][0]['credentials'][0]
        assert creds['accessKey'] == secret['S3_ACCESS_KEY'] and creds['secretKey'] == secret['S3_SECRET_KEY']
        assert len(secret['JWT_SECRET']) >= 64 and len(secret['POSTGRES_PASSWORD']) >= 32
        assert subprocess.run(command, capture_output=True).returncode != 0
        assert output.read_bytes() == original
        print('PASS secret consistency and overwrite protection')
    print('All checks passed. This does not install resources or prove target-cluster readiness.')


if __name__ == '__main__':
    main()
