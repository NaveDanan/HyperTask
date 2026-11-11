import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const deployment = path.resolve(__dirname, '../../../deploy/self-hosted');
const bundle = path.join(deployment, 'patches');
const script = path.join(bundle, 'HyperPrepareCloudRoles.py');
const python = process.platform === 'win32' ? 'python' : 'python3';
function runPython(source: string, ...args: string[]): string {
  const result = spawnSync(python, ['-B', '-c', source, ...args], { encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`HyperCloud source contract failed: ${result.stderr}`);
  return result.stdout;
}

describe('HyperCloud patched source build contracts', () => {
  it('prepares real Git fixtures and preserves existing, edited and racing destinations', () => {
    const result = spawnSync(python, ['-B', path.join(__dirname, 'HyperSelfHostedRoleSourceFixture.py'), script], {
      encoding: 'utf8', timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ tests: 14, failures: 0, errors: 0 });
  });

  it('overrides Cloud alone while retaining default and older source configurations', () => {
    const report = JSON.parse(runPython(`
import json,pathlib,sys,yaml
root=pathlib.Path(sys.argv[1]);override=yaml.safe_load((root/'compose.hyper-cloud-roles.yaml').read_text());default=yaml.safe_load((root/'compose.yaml').read_text());older=yaml.safe_load((root/'compose.source.yaml').read_text())
print(json.dumps({'override':override,'default_image':default['services']['appflowy_cloud']['image'],'older_image':older['services']['appflowy_cloud']['image'],'healthcheck':default['services']['appflowy_cloud']['healthcheck']}))
`, deployment));
    expect(report.override).toEqual({ services: { appflowy_cloud: {
      image: 'hypertask/cloud:0.9.51-hyper-roles-702adf9270e7', platform: 'linux/amd64', pull_policy: 'never',
      build: { context: '.sources/hyper-cloud-role-policy', dockerfile: '.hyper-build/Dockerfile', target: 'runtime' },
    } } });
    expect(report.default_image).toBe('appflowyinc/appflowy_cloud:0.9.51@sha256:8509c1faf1777e339f91bf2f4303e13ec466d23575b1ccd1dbd9fc0055a2d430');
    expect(report.older_image).toBe('appflowy-demo/cloud:592f644a24be');
    expect(JSON.stringify(report.healthcheck)).toContain('curl');
    expect(fs.readFileSync(path.join(bundle, 'Dockerfile.hyper-cloud-role-policy'), 'utf8').split(' AS runtime')[1]).toContain('ca-certificates libssl3 curl');
  });

  it('verifies sources before Cargo and pins both bases to checked registry metadata', () => {
    const recipe = fs.readFileSync(path.join(bundle, 'Dockerfile.hyper-cloud-role-policy'), 'utf8');
    const hashes = JSON.parse(runPython(`
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);script=root/'HyperPrepareCloudRoles.py';patch=root/'0001-HyperCloud-0.9.51-workspace-role-policy.patch'
print(json.dumps({'verifier':hashlib.sha256(script.read_bytes()).hexdigest(),'patch':hashlib.sha256(patch.read_bytes()).hexdigest()}))
`, bundle));
    expect(recipe).toContain(`'${hashes.verifier}' '.hyper-build/HyperPrepareCloudRoles.py'`);
    expect(recipe.indexOf('--verify-export /app')).toBeLessThan(recipe.indexOf('cargo test --locked'));
    expect(recipe).toContain('cargo build --locked -j1 --release -p appflowy-cloud --bin appflowy_cloud');
    expect(recipe).toContain(`hypertask.patch.sha256="${hashes.patch}"`);
    const metadata = JSON.parse(fs.readFileSync(path.join(bundle, 'HyperCloud-role-build.images.json'), 'utf8'));
    expect(metadata.images).toHaveLength(2);
    for (const item of metadata.images) {
      expect(item.index_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(item.linux_amd64_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(item.metadata_sha256_verified).toBe(true);
      expect(item.layers_downloaded).toBe(false);
      expect(recipe).toContain(`docker.io/${item.repository}:${item.tag}@${item.index_digest}`);
    }
  });
});
