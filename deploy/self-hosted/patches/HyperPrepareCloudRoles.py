#!/usr/bin/env python3
"""Prepare or verify an isolated, source-pinned HyperCloud build context. Never builds or starts services."""
import argparse
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
from dataclasses import dataclass

BUNDLE = Path(__file__).resolve().parent
META = '.hyper-build'
PATCH_NAME = '0001-HyperCloud-0.9.51-workspace-role-policy.patch'
PROVENANCE_NAME = 'HyperCloud-0.9.51-workspace-role-policy.provenance.json'
RUNTIME_NAME = 'HyperCloud-0.9.51-workspace-role-policy.runtime.json'
RECIPE_NAME = 'Dockerfile.hyper-cloud-role-policy'


@dataclass(frozen=True)
class HyperSourceSpec:
    repository: str
    commit: str
    patch_sha256: str
    source_tree_sha256: str
    license_sha256: str
    cargo_lock_sha256: str


SPEC = HyperSourceSpec(
    'https://github.com/AppFlowy-IO/AppFlowy-Cloud.git',
    '0311f6a9314da56e12d2b33d18c398dba1933240',
    '702adf9270e76cab6c3837ddbfabc60921e7ee0fbfc64c7e7bf55ceba8696987',
    '1a5bcec3937a45f9f72b8e1e80cb754317cef1b3dd07125538a0f9319c42e902',
    '8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef',
    '9dfde561793e70e94b67d1d620c294f9c90fc82a5b2f9961a953f042f08870c1',
)


class HyperSourceError(RuntimeError):
    pass


def digest_file(filename):
    regular_file(filename)
    digest = hashlib.sha256()
    with Path(filename).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def regular_file(filename):
    entry = Path(filename).lstat()
    if not stat.S_ISREG(entry.st_mode):
        raise HyperSourceError('A required source or metadata file is not a regular file.')
    return entry


def tree_records(directory):
    """Canonical paths, Git executable modes and SHA256s, including untracked inputs."""
    directory = Path(directory)
    records = []
    for current, dirs, files in os.walk(directory, followlinks=False):
        current = Path(current)
        if current == directory:
            dirs[:] = [name for name in dirs if name not in {'.git', 'target', META}]
            files = [name for name in files if name != '.git']
        for name in dirs:
            if (current / name).is_symlink():
                raise HyperSourceError('Source directory links are not permitted.')
        for name in files:
            filename = current / name
            entry = regular_file(filename)
            relative = filename.relative_to(directory).as_posix()
            mode = '100755' if entry.st_mode & 0o111 else '100644'
            records.append((relative, mode, digest_file(filename)))
    return sorted(records)


def tree_digest(directory):
    digest = hashlib.sha256()
    for relative, mode, checksum in tree_records(directory):
        digest.update(relative.encode('utf-8') + b'\0' + mode.encode() + b'\0' + checksum.encode() + b'\n')
    return digest.hexdigest()


def git(directory, *arguments):
    env = dict(os.environ)
    env['GIT_TERMINAL_PROMPT'] = '0'
    result = subprocess.run(
        ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf',
         '-C', str(directory), *arguments],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode:
        raise HyperSourceError('Git could not complete the requested source operation.')
    return result.stdout.decode('utf-8').strip()


def fetch_exact_source(directory, spec):
    if spec.repository != SPEC.repository or spec.commit != SPEC.commit:
        raise HyperSourceError('The command-line preparer only fetches its pinned public source.')
    git(directory, 'init', '--quiet')
    git(directory, 'remote', 'add', 'origin', spec.repository)
    git(directory, 'fetch', '--quiet', '--no-tags', '--depth=1', 'origin', spec.commit)
    # This directory was just created by this invocation. Existing work is never checked out.
    git(directory, 'checkout', '--quiet', '--detach', spec.commit)


def read_assets(bundle, spec):
    bundle = Path(bundle)
    patch = bundle / PATCH_NAME
    provenance_file = bundle / PROVENANCE_NAME
    for filename in [patch, provenance_file, bundle / RECIPE_NAME, bundle / (RECIPE_NAME + '.dockerignore')]:
        regular_file(filename)
    if digest_file(patch) != spec.patch_sha256:
        raise HyperSourceError('Patch checksum mismatch; no source was fetched or modified.')
    provenance = json.loads(provenance_file.read_text())
    if (provenance.get('source', {}).get('commit') != spec.commit or
            provenance.get('patch', {}).get('sha256') != spec.patch_sha256 or
            provenance.get('source', {}).get('license_sha256') != spec.license_sha256 or
            provenance.get('source', {}).get('cargo_lock_sha256') != spec.cargo_lock_sha256):
        raise HyperSourceError('Source and patch provenance do not match the pinned recipe.')
    return patch


def metadata_sources(bundle):
    bundle = Path(bundle)
    sources = {
        'role-policy.patch': bundle / PATCH_NAME,
        'provenance.json': bundle / PROVENANCE_NAME,
        'HyperPrepareCloudRoles.py': Path(__file__).resolve(),
        'Dockerfile': bundle / RECIPE_NAME,
        'Dockerfile.dockerignore': bundle / (RECIPE_NAME + '.dockerignore'),
    }
    runtime = bundle / RUNTIME_NAME
    if runtime.exists():
        sources['runtime.json'] = runtime
    for filename in sources.values():
        regular_file(filename)
    return sources


def verify_tree(directory, spec):
    if (digest_file(Path(directory) / 'LICENSE') != spec.license_sha256 or
            digest_file(Path(directory) / 'Cargo.lock') != spec.cargo_lock_sha256):
        raise HyperSourceError('Upstream license or Cargo lockfile differs from the pinned source.')
    if tree_digest(directory) != spec.source_tree_sha256:
        raise HyperSourceError('The source tree has changed; existing files were preserved.')


def verify_export(directory, spec=SPEC, trusted_bundle=None):
    """Verify a Docker context without relying on .git being copied into the image."""
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise HyperSourceError('Expected a regular prepared source directory.')
    metadata = directory / META
    if metadata.is_symlink() or not metadata.is_dir():
        raise HyperSourceError('No prepared-source metadata; existing directory was preserved.')
    marker_file = metadata / 'source.json'
    regular_file(marker_file)
    marker = json.loads(marker_file.read_text())
    if (not isinstance(marker, dict) or type(marker.get('schema')) is not int or
            set(marker) != {'schema', 'repository', 'commit', 'patch_sha256', 'source_tree_sha256', 'metadata_sha256'}):
        raise HyperSourceError('Unexpected keys in prepared-source metadata.')
    expected = dict(schema=1, repository=spec.repository, commit=spec.commit,
                    patch_sha256=spec.patch_sha256, source_tree_sha256=spec.source_tree_sha256)
    if any(marker.get(key) != value for key, value in expected.items()):
        raise HyperSourceError('Prepared-source identity does not match this recipe.')
    hashes = marker.get('metadata_sha256', {})
    required = {'role-policy.patch', 'provenance.json', 'HyperPrepareCloudRoles.py', 'Dockerfile', 'Dockerfile.dockerignore'}
    if not isinstance(hashes, dict) or set(hashes) not in [required, required | {'runtime.json'}]:
        raise HyperSourceError('Unexpected prepared build metadata.')
    if set(path.name for path in metadata.iterdir()) != set(hashes) | {'source.json'}:
        raise HyperSourceError('Unexpected files in prepared build metadata.')
    for name, checksum in hashes.items():
        filename = metadata / name
        regular_file(filename)
        if digest_file(filename) != checksum:
            raise HyperSourceError('Prepared build metadata was edited; existing files were preserved.')
    if digest_file(metadata / 'role-policy.patch') != spec.patch_sha256:
        raise HyperSourceError('Prepared patch checksum mismatch.')
    # The project-side verifier has the trusted current bundle. Copied Docker
    # contexts instead use the recipe-pinned verifier and canonical source hash.
    if trusted_bundle is None and spec == SPEC and (BUNDLE / PATCH_NAME).is_file():
        trusted_bundle = BUNDLE
    if trusted_bundle is not None:
        trusted = metadata_sources(trusted_bundle)
        if set(hashes) != set(trusted):
            raise HyperSourceError('Prepared metadata differs from the trusted current bundle.')
        for name, filename in trusted.items():
            if digest_file(metadata / name) != digest_file(filename):
                raise HyperSourceError('Prepared metadata was edited or is outdated; existing files were preserved.')
    verify_tree(directory, spec)
    return marker


def verify_prepared(directory, spec=SPEC, bundle=BUNDLE):
    marker = verify_export(directory, spec, bundle)
    if (Path(directory) / '.git').is_symlink() or not (Path(directory) / '.git').is_dir():
        raise HyperSourceError('Prepared local checkout metadata is missing or linked.')
    if git(directory, 'rev-parse', 'HEAD') != spec.commit:
        raise HyperSourceError('Existing checkout revision differs; no checkout or reset was performed.')
    return marker


def publish_new_directory(staging, destination):
    """Linux atomic no-replace rename; a concurrently created destination is preserved."""
    library = ctypes.CDLL(None, use_errno=True)
    rename = getattr(library, 'renameat2', None)
    if rename is None:
        raise HyperSourceError('Atomic source publication requires Linux renameat2; no destination was changed.')
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(staging), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        if code in {errno.EEXIST, errno.ENOTEMPTY}:
            raise HyperSourceError('Destination appeared during preparation; it was preserved.')
        raise HyperSourceError('Atomic source publication failed; destination was preserved.')


def prepare_source(destination, bundle=BUNDLE, spec=SPEC, fetcher=fetch_exact_source,
                   publisher=publish_new_directory):
    destination = Path(destination).absolute()
    patch = read_assets(bundle, spec)
    if destination.is_symlink():
        raise HyperSourceError('A linked destination is not modified.')
    if destination.exists():
        verify_prepared(destination, spec, bundle)
        return 'verified'
    parent = destination.parent
    if parent.is_symlink() or not parent.is_dir():
        raise HyperSourceError('The source parent must be an existing regular directory.')
    staging = Path(tempfile.mkdtemp(prefix='.hyper-cloud-role-source-', dir=parent))
    staging.chmod(0o700)
    try:
        fetcher(staging, spec)
        if git(staging, 'rev-parse', 'HEAD') != spec.commit:
            raise HyperSourceError('Fetched revision does not match the full pinned commit.')
        if (digest_file(staging / 'LICENSE') != spec.license_sha256 or
                digest_file(staging / 'Cargo.lock') != spec.cargo_lock_sha256):
            raise HyperSourceError('Fetched upstream license or Cargo lockfile does not match.')
        git(staging, 'apply', '--check', str(patch.resolve()))
        git(staging, 'apply', str(patch.resolve()))
        git(staging, 'diff', '--check')
        verify_tree(staging, spec)
        metadata = staging / META
        metadata.mkdir(mode=0o700)
        sources = metadata_sources(bundle)
        hashes = {}
        for name, filename in sources.items():
            shutil.copyfile(filename, metadata / name)
            (metadata / name).chmod(0o600)
            hashes[name] = digest_file(metadata / name)
        marker = dict(schema=1, repository=spec.repository, commit=spec.commit,
                      patch_sha256=spec.patch_sha256, source_tree_sha256=spec.source_tree_sha256,
                      metadata_sha256=hashes)
        (metadata / 'source.json').write_text(json.dumps(marker, indent=2) + '\n')
        (metadata / 'source.json').chmod(0o600)
        verify_prepared(staging, spec, bundle)
        publisher(staging, destination)
        return 'prepared'
    finally:
        # Only the unique staging directory created by this invocation is cleaned up.
        if staging.exists() and not staging.is_symlink():
            shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--verify-only', type=Path, help='Read-only verification of an existing prepared checkout.')
    modes.add_argument('--verify-export', type=Path, help='Verify copied build sources without .git; no network or build.')
    parser.add_argument('--destination', type=Path, help='New source directory; existing directories are never reset.')
    options = parser.parse_args()
    if options.verify_only:
        directory = options.verify_only
        verify_prepared(directory)
        status = 'verified'
    elif options.verify_export:
        directory = options.verify_export
        verify_export(directory)
        status = 'verified'
    else:
        directory = options.destination or BUNDLE.parent / '.sources' / 'hyper-cloud-role-policy'
        if options.destination is None and not directory.parent.exists():
            directory.parent.mkdir(mode=0o700)
        status = prepare_source(directory)
    print(json.dumps(dict(status=status, directory=str(directory), source_commit=SPEC.commit,
                          patch_sha256=SPEC.patch_sha256, source_tree_sha256=SPEC.source_tree_sha256)))


if __name__ == '__main__':
    try:
        main()
    except (HyperSourceError, OSError, ValueError) as error:
        # No environment values, URLs with credentials or native process logs are emitted.
        raise SystemExit('HyperCloud source preparation refused: ' + str(error))
