"""Local Git-only contract tests for source preparation; no services or public fetches."""
import dataclasses
import hashlib
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('hyper_role_source', sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class Contracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hyper-role-source-contract-')
        self.root = pathlib.Path(self.temp.name)
        self.repo = self.root / 'upstream'
        self.repo.mkdir()
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        self.target = self.root / 'prepared'
        self.calls = []
        self.g('init', '--quiet')
        self.g('config', 'user.name', 'Hyper source fixture')
        self.g('config', 'user.email', 'fixture@example.invalid')
        (self.repo / 'LICENSE').write_text('AGPL fixture license\n')
        (self.repo / 'Cargo.lock').write_text('fixture lock\n')
        (self.repo / 'role.txt').write_text('Member\n')
        self.g('add', '.')
        self.g('commit', '--quiet', '-m', 'fixture base')
        commit = self.g('rev-parse', 'HEAD').decode().strip()
        (self.repo / 'role.txt').write_text('Guest\n')
        patch = self.g('diff', '--binary')
        tree = module.tree_digest(self.repo)
        (self.repo / 'role.txt').write_text('Member\n')
        (self.bundle / module.PATCH_NAME).write_bytes(patch)
        self.spec = module.HyperSourceSpec(str(self.repo), commit, hashlib.sha256(patch).hexdigest(), tree,
                                          module.digest_file(self.repo / 'LICENSE'), module.digest_file(self.repo / 'Cargo.lock'))
        provenance = {'source': {'commit': commit, 'license_sha256': self.spec.license_sha256,
                                 'cargo_lock_sha256': self.spec.cargo_lock_sha256}, 'patch': {'sha256': self.spec.patch_sha256}}
        (self.bundle / module.PROVENANCE_NAME).write_text(json.dumps(provenance))
        (self.bundle / module.RECIPE_NAME).write_text('FROM scratch\n')
        (self.bundle / (module.RECIPE_NAME + '.dockerignore')).write_text('.git\n')

    def tearDown(self):
        self.temp.cleanup()

    def g(self, *args):
        return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(self.repo), *args], stderr=subprocess.DEVNULL)

    def fetch(self, directory, spec):
        self.calls.append(directory)
        subprocess.run(['git', 'clone', '--quiet', '--no-local', str(self.repo), str(directory)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        module.git(directory, 'checkout', '--quiet', '--detach', spec.commit)

    def prepare(self, **kwargs):
        return module.prepare_source(self.target, self.bundle, self.spec, self.fetch, **kwargs)

    def test_fresh_and_repeat_are_source_exact_without_reset(self):
        self.assertEqual(self.prepare(), 'prepared')
        self.assertEqual((self.target / 'role.txt').read_text(), 'Guest\n')
        index = (self.target / '.git/index').read_bytes()
        self.assertEqual(self.prepare(), 'verified')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(index, (self.target / '.git/index').read_bytes())

    def test_nonempty_user_directory_is_preserved_before_fetch(self):
        self.target.mkdir()
        sentinel = self.target / 'user.txt'
        sentinel.write_text('LOCAL UNSAVED\n')
        with self.assertRaises(module.HyperSourceError): self.prepare()
        self.assertEqual(sentinel.read_text(), 'LOCAL UNSAVED\n')
        self.assertEqual(self.calls, [])

    def test_existing_empty_directory_is_preserved(self):
        self.target.mkdir()
        identity = self.target.stat().st_ino
        with self.assertRaises(module.HyperSourceError): self.prepare()
        self.assertEqual(identity, self.target.stat().st_ino)
        self.assertEqual(self.calls, [])

    def test_user_edit_and_untracked_env_are_preserved(self):
        self.prepare()
        (self.target / 'role.txt').write_text('LOCAL UNSAVED\n')
        (self.target / '.env').write_text('PRIVATE_FIXTURE_SENTINEL\n')
        with self.assertRaises(module.HyperSourceError): self.prepare()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual((self.target / 'role.txt').read_text(), 'LOCAL UNSAVED\n')
        self.assertEqual((self.target / '.env').read_text(), 'PRIVATE_FIXTURE_SENTINEL\n')

    def test_patch_tampering_rejects_before_fetch(self):
        with (self.bundle / module.PATCH_NAME).open('ab') as stream: stream.write(b'tampered')
        with self.assertRaises(module.HyperSourceError): self.prepare()
        self.assertEqual(self.calls, [])
        self.assertFalse(self.target.exists())

    def test_wrong_full_commit_never_publishes(self):
        self.g('commit', '--quiet', '--allow-empty', '-m', 'different commit, identical files')
        def wrong_fetch(directory, spec):
            subprocess.run(['git', 'clone', '--quiet', '--no-local', str(self.repo), str(directory)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with self.assertRaises(module.HyperSourceError): module.prepare_source(self.target, self.bundle, self.spec, wrong_fetch)
        self.assertFalse(self.target.exists())
        self.assertEqual(list(self.root.glob('.hyper-cloud-role-source-*')), [])

    def test_wrong_tree_or_license_never_publishes(self):
        wrong = dataclasses.replace(self.spec, source_tree_sha256='0' * 64)
        with self.assertRaises(module.HyperSourceError): module.prepare_source(self.target, self.bundle, wrong, self.fetch)
        self.assertFalse(self.target.exists())
        def changed_license(directory, spec):
            self.fetch(directory, spec)
            (directory / 'LICENSE').write_text('ALTERED UPSTREAM LICENSE')
        with self.assertRaises(module.HyperSourceError): module.prepare_source(self.target, self.bundle, self.spec, changed_license)
        self.assertFalse(self.target.exists())

    def test_racing_destination_is_not_replaced(self):
        def race(staging, destination):
            destination.mkdir()
            (destination / 'user.txt').write_text('RACING USER WORK\n')
            module.publish_new_directory(staging, destination)
        with self.assertRaises(module.HyperSourceError): self.prepare(publisher=race)
        self.assertEqual((self.target / 'user.txt').read_text(), 'RACING USER WORK\n')
        self.assertEqual(list(self.root.glob('.hyper-cloud-role-source-*')), [])

    def test_linked_destination_or_source_file_is_not_followed(self):
        external = self.root / 'external'
        external.mkdir()
        (external / 'private.txt').write_text('EXTERNAL SENTINEL\n')
        self.target.symlink_to(external, target_is_directory=True)
        with self.assertRaises(module.HyperSourceError): self.prepare()
        self.assertEqual(self.calls, [])
        self.target.unlink()
        self.prepare()
        (self.target / 'LICENSE').unlink()
        (self.target / 'LICENSE').symlink_to(external / 'private.txt')
        with self.assertRaises(module.HyperSourceError): module.verify_export(self.target, self.spec)
        self.assertEqual((external / 'private.txt').read_text(), 'EXTERNAL SENTINEL\n')

    def test_export_without_git_and_edited_metadata(self):
        self.prepare()
        export = self.root / 'export'
        shutil.copytree(self.target, export, ignore=shutil.ignore_patterns('.git'))
        module.verify_export(export, self.spec)
        (export / module.META / 'Dockerfile').write_text('EDITED RECIPE\n')
        with self.assertRaises(module.HyperSourceError): module.verify_export(export, self.spec)

    def test_marker_cannot_self_sign_edited_source(self):
        self.prepare()
        (self.target / 'role.txt').write_text('Owner\n')
        marker = self.target / module.META / 'source.json'
        value = json.loads(marker.read_text())
        value['source_tree_sha256'] = module.tree_digest(self.target)
        marker.write_text(json.dumps(value))
        with self.assertRaises(module.HyperSourceError): module.verify_export(self.target, self.spec)

    def test_marker_rejects_unknown_keys(self):
        self.prepare()
        marker = self.target / module.META / 'source.json'
        value = json.loads(marker.read_text())
        value['future_source_policy'] = True
        marker.write_text(json.dumps(value))
        before = marker.read_bytes()
        with self.assertRaises(module.HyperSourceError): self.prepare()
        self.assertEqual(marker.read_bytes(), before)
        self.assertEqual(len(self.calls), 1)

    def test_metadata_edits_with_updated_marker_cannot_replace_trusted_bundle(self):
        self.prepare()
        marker = self.target / module.META / 'source.json'
        original_marker = marker.read_bytes()
        for name in ['Dockerfile', 'provenance.json', 'HyperPrepareCloudRoles.py']:
            filename = self.target / module.META / name
            original = filename.read_bytes()
            filename.write_bytes(original + b'\nTAMPERED\n')
            value = json.loads(original_marker)
            value['metadata_sha256'][name] = module.digest_file(filename)
            marker.write_text(json.dumps(value))
            before = filename.read_bytes()
            with self.assertRaises(module.HyperSourceError): self.prepare()
            self.assertEqual(filename.read_bytes(), before)
            self.assertEqual(len(self.calls), 1)
            filename.write_bytes(original)
            marker.write_bytes(original_marker)

    def test_changed_git_head_is_never_reset(self):
        self.prepare()
        module.git(self.target, '-c', 'user.name=Hyper fixture', '-c', 'user.email=fixture@example.invalid',
                   'commit', '--quiet', '--allow-empty', '-m', 'user commit')
        user_head = module.git(self.target, 'rev-parse', 'HEAD')
        with self.assertRaises(module.HyperSourceError): self.prepare()
        self.assertEqual(module.git(self.target, 'rev-parse', 'HEAD'), user_head)
        self.assertEqual(len(self.calls), 1)


suite = unittest.defaultTestLoader.loadTestsFromTestCase(Contracts)
result = unittest.TextTestRunner(stream=sys.stderr).run(suite)
print(json.dumps({'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors)}))
if not result.wasSuccessful(): raise SystemExit(1)
