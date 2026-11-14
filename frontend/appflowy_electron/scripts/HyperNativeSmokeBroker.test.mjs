import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, lstat, rm, writeFile, readFile, readdir, readlink } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { hyperPrivateSmokePath, hyperServeSmokePipe, hyperLaunchSmokeApp } from './HyperNativeSmokeBroker.mjs';

test('the debugger refuses a nonprivate directory and closes its one-use Unix endpoint after access', async t => {
  const directory = await mkdtemp('/tmp/hyper-native-smoke-'), socketPath = directory + '/cdp.sock';
  const input = new PassThrough(), output = new PassThrough(); let relay, client;
  try {
    await chmod(directory, 0o755); await assert.rejects(hyperPrivateSmokePath(socketPath), /private/);
    await chmod(directory, 0o700);
    const uid = process.getuid();
    const uidMock = t.mock.method(process, 'getuid', () => uid + 1);
    await assert.rejects(hyperPrivateSmokePath(socketPath), /owned/);
    uidMock.mock.restore();
    relay = await hyperServeSmokePipe({ socketPath, input, output });
    assert.equal((await lstat(socketPath)).mode & 0o777, 0o600);
    client = new WebSocket(`ws+unix://${socketPath}:/cdp`); await once(client, 'open');
    const forwarded = once(input, 'data'); client.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
    assert.equal((await forwarded)[0].toString(), '{"id":1,"method":"Browser.getVersion"}\0');
    const reply = once(client, 'message'); output.write('{"id":1,"result":{"protocolVersion":"1.3"}}\0');
    assert.equal(JSON.parse((await reply)[0]).result.protocolVersion, '1.3');
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) { try { await lstat(socketPath); await new Promise(r => setTimeout(r, 10)); } catch { break; } }
    await assert.rejects(lstat(socketPath), { code: 'ENOENT' });
    const closed = once(client, 'close'); client.close(); await closed;
    assert.equal(input.destroyed, false); // Pipe owner keeps the native app alive, without a public debugger.
    const second = new WebSocket(`ws+unix://${socketPath}:/cdp`);
    const [error] = await once(second, 'error'); assert.equal(error.code, 'ENOENT');
  } finally { client?.terminate(); await relay?.stop(); input.destroy(); output.destroy(); await rm(directory, { recursive: true, force: true }); }
});
test('an unused debugger lease expires and removes its Unix endpoint', async () => {
  const directory = await mkdtemp('/tmp/hyper-native-smoke-'), socketPath = directory + '/cdp.sock';
  const input = new PassThrough(), output = new PassThrough(); let relay;
  try {
    await chmod(directory, 0o700); relay = await hyperServeSmokePipe({ socketPath, input, output, ttlMs: 20 });
    await new Promise(r => setTimeout(r, 80)); await assert.rejects(lstat(socketPath), { code: 'ENOENT' });
  } finally { await relay?.stop(); input.destroy(); output.destroy(); await rm(directory, { recursive: true, force: true }); }
});

test('the launcher closes its own log handle while the child retains its duplicated output', async () => {
  const directory = await mkdtemp('/tmp/hyper-native-smoke-'), logPath = directory + '/child.log'; let child;
  try {
    await writeFile(directory + '/index.js', "console.log('ready');setTimeout(()=>console.log('later'),30);setTimeout(()=>process.exit(0),50);");
    child = await hyperLaunchSmokeApp({ app: directory, profile: directory, logPath, electron: process.execPath, sessionId: 'a'.repeat(32) });
    const descriptors = await readdir('/proc/self/fd');
    const targets = await Promise.all(descriptors.map(fd => readlink('/proc/self/fd/' + fd).catch(() => '')));
    assert.equal(targets.includes(logPath), false);
    await once(child, 'exit');
    assert.equal(await readFile(logPath, 'utf8'), 'ready\nlater\n');
  } finally { if (child?.exitCode === null) child.kill('SIGTERM'); await rm(directory, { recursive: true, force: true }); }
});
