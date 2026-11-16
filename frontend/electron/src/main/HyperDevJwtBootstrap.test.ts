import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HyperDevJwtBootstrap } from './HyperDevJwtBootstrap';

const files: string[] = [];
afterEach(async () => { await Promise.all(files.splice(0).map(file => fs.unlink(file).catch(() => {}))); });
async function session(origin = 'http://dev.example.test:8080') {
  const file = path.join(os.tmpdir(), 'hyper-dev-session-' + crypto.randomUUID() + '.json'); files.push(file);
  await fs.writeFile(file, JSON.stringify({ development: true, server_origin: origin, access_token: 'real-session', refresh_token: 'real-refresh', expires_in: 7200, expires_at: Math.floor(Date.now()/1000) + 7200 }));
  return file;
}
it('is unavailable in packaged, preview, non-loopback and non-opt-in launches', async () => {
  for (const options of [
    { packaged: true, rendererUrl: 'http://localhost:5173', enabled: '1' },
    { packaged: false, rendererUrl: undefined, enabled: '1' },
    { packaged: false, rendererUrl: 'http://elsewhere.test:5173', enabled: '1' },
    { packaged: false, rendererUrl: 'http://localhost:5173', enabled: undefined },
  ]) {
    const bootstrap = new HyperDevJwtBootstrap({ ...options, sessionFile: 'must-not-be-read' });
    expect(bootstrap.enabled).toBe(false); expect(await bootstrap.take()).toBeNull();
  }
});
it('waits for core initialization and delivers a normal login callback only once', async () => {
  const file = await session();
  const bootstrap = new HyperDevJwtBootstrap({ packaged: false, rendererUrl: 'http://localhost:5173', enabled: '1', sessionFile: file });
  const result = bootstrap.take();
  expect(await bootstrap.take()).toBeNull();
  bootstrap.coreReady('http://dev.example.test:8080');
  const callback = new URL((await result)!);
  expect(callback.protocol).toBe('hypertask-flutter:');
  expect(new URLSearchParams(callback.hash.slice(1)).get('access_token')).toBe('real-session');
  await expect(fs.stat(file)).rejects.toThrow();
});
it('rejects a session for a different server', async () => {
  const bootstrap = new HyperDevJwtBootstrap({ packaged: false, rendererUrl: 'http://127.0.0.1:5173', enabled: '1', sessionFile: await session() });
  bootstrap.coreReady('http://other.example.test:8080');
  await expect(bootstrap.take()).rejects.toThrow(/did not match/);
});

it('allows a main-process hot restart to use the already persisted session', async () => {
  const file = await session(); await fs.unlink(file);
  const bootstrap = new HyperDevJwtBootstrap({ packaged: false, rendererUrl: 'http://localhost:5173', enabled: '1', sessionFile: file });
  bootstrap.coreReady('http://dev.example.test:8080');
  expect(await bootstrap.take()).toBeNull();
});
