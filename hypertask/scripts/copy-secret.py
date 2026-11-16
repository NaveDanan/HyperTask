#!/usr/bin/env python3
"""Copy one existing Secret between namespaces without displaying its contents."""
import argparse
import json
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('name')
    parser.add_argument('--from-namespace', required=True)
    parser.add_argument('--to-namespace', default='hypertask')
    parser.add_argument('--to-name')
    args = parser.parse_args()
    target = args.to_name or args.name
    existing = subprocess.run(['kubectl', '-n', args.to_namespace, 'get', 'secret', target, '--ignore-not-found', '-o', 'name'], capture_output=True, text=True)
    if existing.returncode or existing.stdout.strip():
        sys.exit('Cannot create target Secret: it exists or access failed. No changes made.')
    source = subprocess.run(['kubectl', '-n', args.from_namespace, 'get', 'secret', args.name, '-o', 'json'], check=True, capture_output=True, text=True)
    obj = json.loads(source.stdout)
    obj['metadata'] = {'name': target, 'namespace': args.to_namespace}
    obj.pop('immutable', None)
    subprocess.run(['kubectl', 'create', '-f', '-'], input=json.dumps(obj), text=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    print('Copied Secret', target, 'to', args.to_namespace, '(contents not displayed).')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError:
        sys.exit('Secret copy failed; check names, namespace and RBAC. Contents were not printed.')
