#!/usr/bin/env python3
"""Check mirror overwrite/registry-error handling without contacting any registry."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def main():
    spec = importlib.util.spec_from_file_location('hyper_mirror', ROOT / 'scripts/mirror-images.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # OCI index and single-platform IDs differ in Docker 29 while content matches.
    runtime = {'Architecture': 'amd64', 'Os': 'linux', 'RootFS': {'Layers': ['sha256:layer']}, 'Config': {'Cmd': ['backend']}}
    def inspect(command, capture=False, check=True):
        details = dict(runtime, Id=command[-1])
        if command[-1] == 'changed-config':
            details['Config'] = {'Cmd': ['different']}
        if command[-1] == 'changed-layer':
            details['RootFS'] = {'Layers': ['sha256:different']}
        return subprocess.CompletedProcess(command, 0, json.dumps([details]), '')
    with mock.patch.object(module, 'run', side_effect=inspect):
        baseline = module.image_fingerprint('index-id')
        assert baseline == module.image_fingerprint('manifest-id')
        assert baseline != module.image_fingerprint('changed-config')
        assert baseline != module.image_fingerprint('changed-layer')
    print('PASS mirror: OCI ID differences accepted only for identical platform content')
    prefix = module.DEFAULT_PREFIX
    source = 'example/source:1@sha256:' + '1' * 64
    for scenario in ('new', 'new-modern-docker', 'matching', 'conflicting', 'unauthorized', 'network-failure'):
        calls = []
        def fake_run(command, capture=False, check=True):
            calls.append(command)
            if command[:3] == ['jf', 'docker', 'pull'] and len([c for c in calls if c[:3] == ['jf', 'docker', 'pull']]) == 1:
                if scenario == 'new':
                    return subprocess.CompletedProcess(command, 1, '', 'manifest unknown')
                if scenario == 'new-modern-docker':
                    target = command[3]
                    return subprocess.CompletedProcess(command, 1, '', 'failed to resolve reference "' + target + '": ' + target + ': not found\nexit status 1')
                if scenario in ('unauthorized', 'network-failure'):
                    return subprocess.CompletedProcess(command, 1, '', scenario)
            if command[:3] == ['docker', 'image', 'inspect']:
                return subprocess.CompletedProcess(command, 0, '["' + prefix + 'hypertask-cloud@sha256:' + '2' * 64 + '"]', '')
            return subprocess.CompletedProcess(command, 0, '', '')
        def fake_id(reference):
            return 'different' if scenario == 'conflicting' and reference != source else 'same-id'
        rejected = False
        with mock.patch.object(module, 'run', side_effect=fake_run), mock.patch.object(module, 'image_fingerprint', side_effect=fake_id), contextlib.redirect_stdout(io.StringIO()):
            try:
                result = module.mirror('cloud', source, 'test-unique-1', prefix, 'linux/amd64')
                assert result['digest'] == 'sha256:' + '2' * 64
            except (ValueError, RuntimeError):
                rejected = True
        pushes = [call for call in calls if call[:3] == ['jf', 'docker', 'push']]
        if scenario in ('new', 'new-modern-docker'):
            assert not rejected and len(pushes) == 1
        elif scenario == 'matching':
            assert not rejected and not pushes
        else:
            assert rejected and not pushes
        print('PASS mirror:', scenario)


if __name__ == '__main__':
    main()
