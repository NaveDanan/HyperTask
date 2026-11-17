#!/usr/bin/env python3
"""Mirror pinned upstream images into Artifactory without overwriting published tags."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PREFIX = 'artifactory.rafael.co.il/mems-docker-local-ww/danan/'


def run(command, capture=False, check=True):
    return subprocess.run(command, check=check, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None)


def image_fingerprint(reference):
    # Docker 29 reports an OCI index/manifest as .Id; older engines report a config
    # digest. Compare the selected platform's actual runtime config and layer IDs.
    details = json.loads(run(['docker', 'image', 'inspect', reference], True).stdout)[0]
    content = {key: details.get(key) for key in ('Architecture', 'Os', 'Variant', 'RootFS', 'Config')}
    if content['Architecture'] != 'amd64' or content['Os'] != 'linux' or not content['RootFS']:
        raise ValueError('Expected a complete linux/amd64 image: ' + reference)
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def mirror(component, source, tag, prefix, platform):
    if not re.fullmatch(r'.+@sha256:[a-f0-9]{64}', source):
        raise ValueError('Every source image must have a pinned SHA-256 digest: ' + component)
    repository = prefix + 'hypertask-' + component
    target = repository + ':' + tag
    print('Mirroring', component, 'to', target, flush=True)
    run(['docker', 'pull', '--platform', platform, source])
    expected = image_fingerprint(source)
    # jf authenticates Docker with the configured JFrog token. Check target first.
    previous = run(['jf', 'docker', 'pull', target, '--platform', platform], True, False)
    if previous.returncode == 0:
        if image_fingerprint(target) != expected:
            raise ValueError('Published tag differs; choose a NEW unique tag: ' + target)
        print('Existing tag has the same image; leaving it unchanged.', flush=True)
    else:
        error = previous.stdout + previous.stderr
        # Authentication, DNS, and connectivity failures are NOT evidence of absence.
        legacy_missing = any(marker in error.lower() for marker in ('manifest unknown', 'no such manifest', 'manifest not found'))
        # Docker 29's containerd image store reports an explicit reference-specific 404.
        modern_missing = bool(re.search(r'failed to resolve reference "' + re.escape(target) + r'": ' + re.escape(target) + r': not found(?:\n|$)', error))
        if not (legacy_missing or modern_missing):
            raise RuntimeError('Cannot establish whether target exists; check jf/Docker registry login and network. No push attempted.')
        run(['docker', 'tag', source, target])
        run(['jf', 'docker', 'push', target])
        run(['jf', 'docker', 'pull', target, '--platform', platform])
        if image_fingerprint(target) != expected:
            raise ValueError('Pushed image verification failed: ' + target)
    digests = json.loads(run(['docker', 'image', 'inspect', '--format', '{{json .RepoDigests}}', target], True).stdout)
    digest = next((item.split('@', 1)[1] for item in (digests or []) if item.startswith(repository + '@')), None)
    if not digest or not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('Cannot verify registry digest for ' + target)
    return {'repository': repository, 'tag': tag, 'digest': digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True, help='New unique tag, e.g. 0.9.51-20261116.1')
    parser.add_argument('--prefix', default=DEFAULT_PREFIX)
    parser.add_argument('--output', type=Path, default=ROOT / '.private/values.images.json')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', args.tag) or args.tag.lower() == 'latest' or 'REPLACE' in args.tag:
        parser.error('Use a unique, immutable Docker tag')
    if not args.prefix.endswith('/') or '://' in args.prefix:
        parser.error('--prefix must be a registry/repository prefix ending in /')
    lock = json.loads((ROOT / 'images.lock.json').read_text())
    images = {}
    for component, source in lock['images'].items():
        images[component] = mirror(component, source, args.tag, args.prefix, lock['platform'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'global': {'imageRegistryPrefix': args.prefix}, 'images': images}, indent=2) + '\n')
    print('Verified image overrides written to', args.output)
    print('Copy this JSON with the bundle to the offline environment. No node image import is needed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
