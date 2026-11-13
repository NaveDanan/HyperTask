import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const deployment = path.join(root, 'deploy/self-hosted');
const python = process.platform === 'win32' ? 'python' : 'python3';
const pythonAvailable = spawnSync(python, ['-c', 'import ast,json,pathlib'], { encoding: 'utf8' }).status === 0;
const yamlAvailable = pythonAvailable && spawnSync(python, ['-c', 'import yaml'], { encoding: 'utf8' }).status === 0;
function runPython(source: string, ...args: string[]): string {
  const result = spawnSync(python, ['-c', source, ...args], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error('Self-hosted configuration check failed.');
  return result.stdout;
}

describe('Hyper self-hosted deployment contracts', () => {
  it.skipIf(!yamlAvailable)('isolates internal services, pins runtime images and enables access control', () => {
    const report = JSON.parse(runPython(`
import json,pathlib,sys,yaml
config=yaml.safe_load((pathlib.Path(sys.argv[1])/'compose.yaml').read_text())
services=config['services']
default={name:value for name,value in services.items() if 'profiles' not in value}
report={
 'published':[name for name,value in default.items() if value.get('ports')],
 'pinned':all('@sha256:' in value['image'] for value in default.values()),
 'internal':config['networks']['backend']['internal'],
 'ingress':[name for name,value in default.items() if 'ingress' in value.get('networks',[])],
 'access_control':services['appflowy_cloud']['environment']['APPFLOWY_ACCESS_CONTROL'],
 'cloud_auth':services['appflowy_cloud']['environment']['APPFLOWY_GOTRUE_BASE_URL'],
 'storage_endpoint':services['appflowy_cloud']['environment']['APPFLOWY_S3_PRESIGNED_URL_ENDPOINT'],
 'password_required':':?' in services['postgres']['environment']['POSTGRES_PASSWORD'],
 'jwt_required':':?' in services['gotrue']['environment']['GOTRUE_JWT_SECRET'],
 'autoconfirm':services['gotrue']['environment']['GOTRUE_MAILER_AUTOCONFIRM'],
}
print(json.dumps(report))
`, deployment));
    expect(report).toEqual({ published: ['nginx'], pinned: true, internal: true, ingress: ['nginx'], access_control: 'true', cloud_auth: 'http://gotrue:9999', storage_endpoint: '${SERVER_ORIGIN}/minio-api', password_required: true, jwt_required: true, autoconfirm: 'true' });
  });
  it('retains WebSocket, API and object-upload proxy requirements', () => {
    const nginx = fs.readFileSync(path.join(deployment, 'nginx.conf'), 'utf8');
    const section = (route: string) => nginx.match(new RegExp(`location ${route} \\{([^}]+)\\}`))?.[1] ?? '';
    expect(nginx).toContain('underscores_in_headers on;');
    expect(section('/ws')).toContain('proxy_http_version 1.1;');
    expect(section('/ws')).toContain('proxy_set_header Upgrade $http_upgrade;');
    expect(section('/ws')).toContain('proxy_set_header Connection $connection_upgrade;');
    expect(section('/api')).toContain('proxy_buffering off;');
    expect(section('/api')).toContain('proxy_request_buffering off;');
    expect(section('/minio-api/')).toContain('proxy_set_header Host minio:9000;');
    expect(section('/minio-api/')).toContain('proxy_request_buffering off;');
    expect(nginx).toContain('location /gotrue/');
  });
  it.skipIf(!pythonAvailable)('parses verification scripts without executing their authenticated requests', () => {
    expect(runPython(`
import ast,pathlib,sys
files=list(pathlib.Path(sys.argv[1]).glob('*.py'))
for file in files: ast.parse(file.read_text(),filename=str(file))
print(len(files))
`, deployment).trim()).toBe('5');
    if (process.platform !== 'win32') {
      for (const name of fs.readdirSync(deployment).filter(name => name.endsWith('.sh'))) {
        expect(spawnSync('bash', ['-n', path.join(deployment, name)], { encoding: 'utf8' }).status, name).toBe(0);
      }
    }
  });
  it.skipIf(!pythonAvailable)('prepares a private loopback-only project without copying real settings or starting services', () => {
    const fixture = JSON.parse(runPython(`
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('hyper_fixture',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
print(json.dumps(module.prepare()))
`, path.join(__dirname, 'HyperSelfHostedFixture.py'))) as { directory: string; project: string; origin: string; instance: string; local_only: boolean; started: boolean };
    try {
      expect(path.dirname(fixture.directory)).toBe(fs.realpathSync(os.tmpdir()));
      expect(fixture.project).toMatch(/^hypertask-test-[a-f0-9]{32}$/);
      expect(fixture.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(fixture.local_only).toBe(true); expect(fixture.started).toBe(false);
      const env = fs.readFileSync(path.join(fixture.directory, '.env'), 'utf8');
      expect(env).toContain('BIND_ADDRESS=127.0.0.1\n');
      expect(fs.readFileSync(path.join(fixture.directory, 'compose.yaml'), 'utf8')).toContain(`name: ${fixture.project}\n`);
      expect(fs.readFileSync(path.join(fixture.directory, 'nginx.conf'), 'utf8')).toContain(`X-HyperTask-Test-Instance "${fixture.instance}"`);
      expect(fs.readdirSync(fixture.directory).sort()).toEqual(['.env', '.hyper-test-instance.json', '.s3.json', 'compose.yaml', 'nginx.conf']);
      if (process.platform !== 'win32') {
        expect(fs.statSync(fixture.directory).mode & 0o777).toBe(0o700);
        for (const name of ['.env', '.s3.json', '.hyper-test-instance.json']) expect(fs.statSync(path.join(fixture.directory, name)).mode & 0o777).toBe(0o600);
      }
    } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
  });
});
