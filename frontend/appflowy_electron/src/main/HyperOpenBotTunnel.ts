import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { app, session } from 'electron';
const ORIGIN = 'http://127.0.0.1:3010';
let starting: Promise<string> | undefined;
let generation = 0;
let child: ChildProcess | undefined;
let directory: string | undefined;
const connections = new Set<{ destroy(error?: Error): unknown }>();
/** Fixed authorized development VM. The main process owns a private Unix SSH forward;
 * the public 3010 reference tunnel is never used by this transport. */
export function closeHyperOpenBotTunnel() {
  generation++;
  const process = child; child = undefined; starting = undefined;
  for (const connection of connections) connection.destroy(new Error('OpenBot tunnel closed'));
  connections.clear(); process?.kill('SIGTERM');
  const old = directory; directory = undefined; if (old) void fs.rm(old, { recursive: true, force: true });
}
export function hyperOpenBotSocketPath(): Promise<string> {
  if (starting) return starting;
  const version = generation;
  let ownedDirectory: string | undefined;
  let ownedChild: ChildProcess | undefined;
  const assertCurrent = () => { if (version !== generation) throw new Error('Private OpenBot SSH startup cancelled'); };
  starting = (async () => {
    if (process.platform !== 'linux') throw new Error('Private OpenBot SSH transport currently requires Linux');
    ownedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'hypertask-openbot-'));
    assertCurrent();
    await fs.chmod(ownedDirectory, 0o700);
    assertCurrent();
    directory = ownedDirectory;
    const socketPath = path.join(ownedDirectory, 'gateway.sock');
    const ssh = spawn('/usr/bin/ssh', ['-NT', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-L', `${socketPath}:127.0.0.1:3010`, 'agent@100.104.170.51'], { stdio: 'ignore' });
    ownedChild = ssh; child = ssh;
    ssh.once('exit', () => { if (child === ssh) closeHyperOpenBotTunnel(); });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Private OpenBot SSH tunnel did not open')), 15000);
      const interval = setInterval(() => { void fs.stat(socketPath).then(stat => { if (stat.isSocket()) finish(); }).catch(() => {}); }, 50);
      const failed = () => finish(new Error('Private OpenBot SSH tunnel failed'));
      function finish(error?: Error) { clearTimeout(timeout); clearInterval(interval); ssh.off('error', failed); ssh.off('exit', failed); error ? reject(error) : resolve(); }
      ssh.once('error', failed); ssh.once('exit', failed);
    });
    assertCurrent();
    return socketPath;
  })().catch(async error => {
    // An obsolete startup cleans up only its own resources, never a newer attempt's globals.
    if (version === generation) closeHyperOpenBotTunnel();
    else { ownedChild?.kill('SIGTERM'); if (ownedDirectory) await fs.rm(ownedDirectory, { recursive: true, force: true }); }
    throw error;
  });
  return starting;
}
app.once('before-quit', closeHyperOpenBotTunnel);
export async function hyperOpenBotCookieHeader() {
  const cookies = await session.defaultSession.cookies.get({ url: ORIGIN });
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}
async function saveCookies(values: string[]) {
  for (const raw of values) {
    const [pair, ...attributes] = raw.split(';'); const at = pair.indexOf('='); if (at < 1) continue;
    const parts = new Map(attributes.map(part => { const i = part.indexOf('='); return [part.slice(0, i < 0 ? undefined : i).trim().toLowerCase(), i < 0 ? '' : part.slice(i + 1).trim()]; }));
    const expiry = parts.has('max-age') ? Date.now() / 1000 + Number(parts.get('max-age')) : parts.has('expires') ? Date.parse(parts.get('expires')!) / 1000 : undefined;
    await session.defaultSession.cookies.set({ url: ORIGIN, name: pair.slice(0, at), value: pair.slice(at + 1), path: parts.get('path') || '/', httpOnly: parts.has('httponly'), secure: parts.has('secure'), ...(expiry !== undefined && Number.isFinite(expiry) ? { expirationDate: expiry } : {}), sameSite: parts.get('samesite')?.toLowerCase() === 'strict' ? 'strict' : parts.get('samesite')?.toLowerCase() === 'none' ? 'no_restriction' : 'lax' });
  }
}
export async function hyperTunnelFetch(route: string, options: { method: string; body?: string | Buffer; signal: AbortSignal; headers: Record<string, string> }): Promise<Response> {
  const socketPath = await hyperOpenBotSocketPath(); options.signal.throwIfAborted();
  const cookie = await hyperOpenBotCookieHeader(); options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: route, method: options.method, signal: options.signal, headers: { ...options.headers, host: '127.0.0.1:3010', cookie } }, response => {
      void (async () => {
        try {
          await saveCookies(response.headers['set-cookie'] ?? []);
          const headers = new Headers(); for (const [name, value] of Object.entries(response.headers)) if (value && name !== 'set-cookie') headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          const status = response.statusCode ?? 502;
          if (status >= 300 && status < 400) { response.destroy(); throw new Error('OpenBot redirects are refused'); }
          resolve(new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers }));
        } catch (error) { response.destroy(); reject(error); }
      })();
    });
    connections.add(request); request.once('close', () => connections.delete(request)); request.once('error', reject);
    request.end(options.body);
  });
}
