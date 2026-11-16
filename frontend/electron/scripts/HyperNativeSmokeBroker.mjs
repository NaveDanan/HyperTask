#!/usr/bin/env node
// Developer smoke transport only. Electron CDP stays on inherited pipes, never TCP.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { open, lstat, chmod, unlink, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

export async function hyperPrivateSmokePath(socketPath) {
  if (!/^\/tmp\/hyper-native-smoke-[\w-]+\/cdp\.sock$/.test(socketPath)) throw Error('Invalid private smoke socket');
  const parent = await lstat(dirname(socketPath));
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700) throw Error('Smoke socket directory must be owned and private');
}

/** One filesystem-protected client per launch; no listener survives its first use. */
export async function hyperServeSmokePipe({ socketPath, input, output, ttlMs = 20 * 60 * 1000 }) {
  await hyperPrivateSmokePath(socketPath);
  process.umask(0o077);
  const server = createServer((_, response) => { response.writeHead(404); response.end(); });
  const sockets = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  let client, claimed = false, buffer = Buffer.alloc(0), stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    clearTimeout(timer); server.close();
    for (const socket of sockets) socket.destroy();
    client?.terminate(); wss.close();
    await unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  };
  const timer = setTimeout(() => { void stop(); }, ttlMs); timer.unref();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket, head) => {
    if (claimed || stopped || request.url !== '/cdp') { socket.destroy(); return; }
    claimed = true;
    wss.handleUpgrade(request, socket, head, ws => {
      client = ws;
      // Remove discovery/access immediately. The accepted connection alone remains.
      clearTimeout(timer); server.close(); void unlink(socketPath).catch(() => {});
      ws.on('message', (bytes, binary) => {
        if (binary) { ws.close(1003); return; }
        try { const message = JSON.parse(bytes.toString()); if (!message || typeof message.method !== 'string' || !Number.isSafeInteger(message.id)) throw Error(); input.write(JSON.stringify(message) + '\0'); }
        catch { ws.close(1003); }
      });
      ws.on('close', () => { void stop(); });
      ws.on('error', () => { void stop(); });
    });
  });
  const receive = chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 32 * 1024 * 1024) { void stop(); buffer = Buffer.alloc(0); return; }
    let end;
    while ((end = buffer.indexOf(0)) !== -1) {
      const frame = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
      if (client?.readyState === WebSocket.OPEN) client.send(frame.toString());
    }
  };
  output.on('data', receive);
  output.on('end', () => { void stop(); });
  output.on('error', () => { void stop(); });
  input.on('error', () => { void stop(); });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(socketPath, accept); });
  await chmod(socketPath, 0o600);
  // Keep inherited pipes alive after client disconnect so the owned app stays open.
  // There is no remaining externally reachable debugger. App exit closes the pipes.
  return { stop };
}

export async function hyperLaunchSmokeApp(config) {
  const log = await open(config.logPath, 'ax', 0o600);
  try {
    const args = [config.app, `--user-data-dir=${config.profile}/electron`, '--remote-debugging-pipe', `--hyper-native-smoke-session=${config.sessionId}`];
    if (config.developmentNoSandbox) args.push('--no-sandbox');
    return spawn(config.electron, args, { cwd: config.app, env: process.env, stdio: ['ignore', log.fd, log.fd, 'pipe', 'pipe'] });
  } finally {
    // The child owns duplicated descriptors. Leaving the parent's FileHandle to
    // GC is an error on current Node and would close Electron's debugging pipe.
    await log.close();
  }
}

async function main(configPath) {
  process.umask(0o077);
  const info = await lstat(configPath);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('Private broker config required');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await hyperPrivateSmokePath(config.socketPath);
  const app = await hyperLaunchSmokeApp(config);
  let relay;
  app.on('exit', () => { void relay?.stop().finally(() => process.exit(0)); if (!relay) process.exit(1); });
  app.on('error', () => process.exit(1));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void relay?.stop(); app.kill('SIGTERM'); });
  // Reserve negative IDs for pre-client readiness, avoiding client request IDs.
  await new Promise((accept, reject) => {
    let bytes = Buffer.alloc(0), requested = false;
    const timer = setTimeout(() => { cleanup(); reject(Error('Pipe readiness timed out')); }, 30000);
    const cleanup = () => { clearTimeout(timer); app.stdio[4].off('data', receive); };
    const receive = chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      let end;
      while ((end = bytes.indexOf(0)) !== -1) {
        const frame = bytes.subarray(0, end); bytes = bytes.subarray(end + 1);
        let message; try { message = JSON.parse(frame); } catch { continue; }
        if (message.id === -1 && message.result?.protocolVersion && !requested) { requested = true; app.stdio[3].write(JSON.stringify({ id: -2, method: 'Target.getTargets' }) + '\0'); }
        if (message.id === -2) {
          if (message.result?.targetInfos?.some(target => target.type === 'page' && target.url === pathToFileURL(resolve(config.app, 'out/renderer/index.html')).href)) { cleanup(); accept(); }
          else setTimeout(() => { if (!relay) app.stdio[3].write(JSON.stringify({ id: -2, method: 'Target.getTargets' }) + '\0'); }, 100).unref();
        }
      }
    };
    app.stdio[4].on('data', receive);
    app.stdio[3].write(JSON.stringify({ id: -1, method: 'Browser.getVersion' }) + '\0');
  }).catch(error => { app.kill('SIGTERM'); throw error; });
  relay = await hyperServeSmokePipe({ socketPath: config.socketPath, input: app.stdio[3], output: app.stdio[4] });
  process.stdout.write(JSON.stringify({ pid: app.pid, brokerPid: process.pid, transport: 'pipe', debugSocket: config.socketPath, sessionId: config.sessionId }) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]).catch(() => { process.stderr.write('Private native smoke broker failed\n'); process.exit(1); });
