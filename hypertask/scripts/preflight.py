#!/usr/bin/env python3
"""Read-only preflight against the target cluster. Creates no Kubernetes resources."""
import argparse
import base64
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(command, content=None):
    result = subprocess.run(command, input=content, text=True, capture_output=True)
    if result.returncode:
        # Never echo Kubernetes Secret responses or input manifests.
        raise ValueError('Command failed: ' + ' '.join(command[:3]) + '. Check access and configuration.')
    return result.stdout


def check(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('-n', '--namespace', default='hypertask')
    parser.add_argument('--release', default='hypertask')
    parser.add_argument('-f', '--values', action='append', required=True)
    parser.add_argument('--helm', default='helm')
    parser.add_argument('--registry-prefix', default='artifactory.rafael.co.il/mems-docker-local-ww/danan/')
    args = parser.parse_args()
    def kube(*items):
        return json.loads(run(['kubectl', *items, '-o', 'json']))
    kube('get', 'namespace', args.namespace)
    command = [args.helm, 'template', args.release, str(ROOT / 'chart'), '-n', args.namespace]
    for value in args.values:
        command.extend(['-f', value])
    rendered = run(command)
    # Uses API discovery/OpenAPI on the target, but does not POST resources.
    objects = json.loads(run(['kubectl', 'create', '--dry-run=client', '--validate=true', '-o', 'json', '-f', '-'], rendered))
    resources = objects.get('items', [objects])
    pods = [obj['spec']['template']['spec'] for obj in resources if obj['kind'] in ('Deployment', 'StatefulSet')]
    secrets = {}
    def secret(name):
        if name not in secrets:
            obj = kube('-n', args.namespace, 'get', 'secret', name)
            secrets[name] = (obj.get('type', ''), {k: base64.b64decode(v) for k, v in obj.get('data', {}).items()})
        return secrets[name]
    image_count = 0
    for pod in pods:
        pull_names = [item['name'] for item in pod.get('imagePullSecrets', [])]
        check(pull_names, 'Every workload needs an imagePullSecret')
        for name in pull_names:
            kind, data = secret(name)
            check(kind == 'kubernetes.io/dockerconfigjson', 'Invalid registry Secret type: ' + name)
            docker_config = json.loads(data.get('.dockerconfigjson', b'{}'))
            registry = args.registry_prefix.split('/')[0]
            check(any(re.sub(r'^https?://', '', key).split('/')[0] == registry
                      for key in docker_config.get('auths', {})), 'Registry credentials missing in ' + name)
        for container in pod.get('initContainers', []) + pod['containers']:
            image = container['image']
            check(image.startswith(args.registry_prefix), 'An image was not mirrored to the required registry')
            check(re.fullmatch(r'.+@sha256:[a-f0-9]{64}', image), 'Use digest-pinned output from mirror-images.py')
            image_count += 1
            for env in container.get('env', []):
                ref = env.get('valueFrom', {}).get('secretKeyRef')
                if ref and not ref.get('optional', False):
                    _, data = secret(ref['name'])
                    check(bool(data.get(ref['key'])), 'Required Secret key missing: ' + ref['key'])
        for volume in pod.get('volumes', []):
            ref = volume.get('secret')
            if ref:
                _, data = secret(ref['secretName'])
                for item in ref.get('items', []):
                    check(bool(data.get(item['key'])), 'Required mounted Secret key missing: ' + item['key'])
            ref = volume.get('configMap')
            if ref and not any(o['kind'] == 'ConfigMap' and o['metadata']['name'] == ref['name'] for o in resources):
                config = kube('-n', args.namespace, 'get', 'configmap', ref['name'])
                for item in ref.get('items', []):
                    check('-----BEGIN CERTIFICATE-----' in config.get('data', {}).get(item['key'], ''), 'CA bundle missing in ' + ref['name'])
    # Secret contents are inspected in memory and never printed.
    for _, data in secrets.values():
        if 'POSTGRES_PASSWORD' in data:
            check(re.fullmatch(rb'[A-Za-z0-9_-]{32,}', data['POSTGRES_PASSWORD']), 'Database password must be URL-safe and at least 32 characters')
            check(len(data.get('JWT_SECRET', b'')) >= 32, 'JWT_SECRET is too short')
            s3 = json.loads(data.get('S3_CONFIG_JSON', b'{}'))
            credentials = [c for identity in s3.get('identities', []) for c in identity.get('credentials', [])]
            check(any(c.get('accessKey', '').encode() == data.get('S3_ACCESS_KEY') and
                      c.get('secretKey', '').encode() == data.get('S3_SECRET_KEY') for c in credentials), 'S3 keys and S3_CONFIG_JSON do not match')
    created_claims = {obj['metadata']['name'] for obj in resources if obj['kind'] == 'PersistentVolumeClaim'}
    for pod in pods:
        for volume in pod.get('volumes', []):
            ref = volume.get('persistentVolumeClaim')
            if ref and ref['claimName'] not in created_claims:
                claim = kube('-n', args.namespace, 'get', 'pvc', ref['claimName'])
                check(claim['status']['phase'] == 'Bound', 'Existing PVC is not Bound: ' + ref['claimName'])
    storage_classes = kube('get', 'storageclasses')['items']
    for obj in resources:
        if obj['kind'] == 'PersistentVolumeClaim':
            storage_class = obj['spec'].get('storageClassName')
            if storage_class:
                check(any(s['metadata']['name'] == storage_class for s in storage_classes), 'StorageClass does not exist: ' + storage_class)
            else:
                check(any(s['metadata'].get('annotations', {}).get('storageclass.kubernetes.io/is-default-class') == 'true' for s in storage_classes), 'Choose a StorageClass; the cluster has no default')
        if obj['kind'] == 'Ingress':
            kube('get', 'ingressclass', obj['spec']['ingressClassName'])
            host = obj['spec']['rules'][0]['host']
            for tls in obj['spec'].get('tls', []):
                if tls.get('secretName'):
                    kind, data = secret(tls['secretName'])
                    check(kind == 'kubernetes.io/tls' and data.get('tls.crt') and data.get('tls.key'), 'TLS Secret needs tls.crt and tls.key')
                    certificate = data['tls.crt'].decode()
                    # Trust this leaf solely for local hostname/expiry validation.
                    # Clients must independently trust the actual company issuing CA.
                    with tempfile.TemporaryDirectory(prefix='hyper-public-cert-') as folder:
                        cert_path = Path(folder) / 'certificate.pem'
                        cert_path.write_text(certificate)
                        try:
                            run(['openssl', 'verify', '-trusted', str(cert_path), '-partial_chain', '-verify_hostname', host, str(cert_path)])
                        except ValueError:
                            raise ValueError('TLS certificate is invalid, expired, or does not cover ' + host) from None
                else:
                    print('Controller default certificate selected: verify the served certificate with curl after installation.')
    print('PASS: rendered API schemas, registry image digests, pull/application secrets, storage, ingress and named TLS certificate.')
    print('Checked', len(resources), 'resources and', image_count, 'container image references. No resources were applied.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        sys.exit('Preflight failed: ' + str(error))
