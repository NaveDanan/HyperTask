import fs from 'node:fs/promises';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { hyperOpenBotSshTarget } from './HyperOpenBotSsh';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { app } from 'electron';
import type { HyperOpenBotSessionLease } from './HyperOpenBotSession';
const ORIGIN = 'http://127.0.0.1:3010';
let starting: Promise<string> | undefined;
let generation = 0;
let child: ChildProcess | undefined;
let directory: string | undefined;
let pipeServer: net.Server | undefined;
const relayChildren = new Set<ChildProcess>();
const connections = new Set<{ destroy(error?: Error): unknown }>();
/** Private IPC to the authorized VM: Unix sockets or Windows named pipes.
 * No local TCP listener or public reference forward is used. */
export function closeHyperOpenBotTunnel() {
  generation++;
  const process = child; child = undefined; starting = undefined;
  for (const connection of connections) connection.destroy(new Error('OpenBot tunnel closed'));
  connections.clear(); process?.kill('SIGTERM');
  const server = pipeServer; pipeServer = undefined; server?.close(() => {});
  for (const relay of relayChildren) relay.kill('SIGTERM');
  relayChildren.clear();
  const old = directory; directory = undefined; if (old) void fs.rm(old, { recursive: true, force: true });
}
export function hyperOpenBotSocketPath(): Promise<string> {
  if (starting) return starting;
  const version = generation;
  let ownedDirectory: string | undefined;
  let ownedChild: ChildProcess | undefined;
  let ownedPipeServer: net.Server | undefined;
  const assertCurrent = () => { if (version !== generation) throw new Error('Private OpenBot SSH startup cancelled'); };
  starting = (async () => {
    if (process.platform === 'win32') {
      const pipePath = '\\\\.\\pipe\\hypertask-openbot-' + randomUUID();
      const server = net.createServer(socket => {
        if (version !== generation) { socket.destroy(); return; }
        const target = hyperOpenBotSshTarget();
        const relay = spawn(target.command, ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-W', '127.0.0.1:3010', target.host], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
        relayChildren.add(relay); connections.add(socket);
        const fail = () => socket.destroy(new Error('Private OpenBot SSH connection failed'));
        socket.on('error', () => {});
        relay.once('error', fail);
        relay.once('exit', code => { relayChildren.delete(relay); if (code !== 0) fail(); else socket.end(); });
        relay.stdin?.on('error', fail); relay.stdout?.on('error', fail);
        socket.once('close', () => { connections.delete(socket); relayChildren.delete(relay); relay.kill('SIGTERM'); });
        if (relay.stdin && relay.stdout) { socket.pipe(relay.stdin); relay.stdout.pipe(socket); }
        else fail();
      });
      ownedPipeServer = server; pipeServer = server;
      await new Promise<void>((resolve, reject) => {
        const cancelled = () => reject(new Error('Private OpenBot SSH startup cancelled'));
        server.once('error', reject); server.once('close', cancelled);
        server.listen({ path: pipePath, readableAll: false, writableAll: false }, () => {
          server.off('close', cancelled); resolve();
        });
      });
      assertCurrent();
      return pipePath;
    }
    if (process.platform !== 'linux') throw new Error('Private OpenBot SSH transport requires Windows or Linux');
    ownedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'hypertask-openbot-'));
    assertCurrent();
    await fs.chmod(ownedDirectory, 0o700);
    assertCurrent();
    directory = ownedDirectory;
    const socketPath = path.join(ownedDirectory, 'gateway.sock');
    const target = hyperOpenBotSshTarget();
    const ssh = spawn(target.command, ['-NT', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-L', `${socketPath}:127.0.0.1:3010`, target.host], { stdio: 'ignore', windowsHide: true });
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
    else { ownedPipeServer?.close(() => {}); ownedChild?.kill('SIGTERM'); if (ownedDirectory) await fs.rm(ownedDirectory, { recursive: true, force: true }); }
    throw error;
  });
  return starting;
}
app.once('before-quit', closeHyperOpenBotTunnel);
export async function hyperOpenBotCookieHeader(lease: HyperOpenBotSessionLease) {
  const cookies = await lease.withCookies(cookies => cookies.get({ url: ORIGIN }));
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}
async function saveCookies(values: string[], lease: HyperOpenBotSessionLease) {
  await lease.withCookies(async cookies => {
  for (const raw of values) {
    const [pair, ...attributes] = raw.split(';'); const at = pair.indexOf('='); if (at < 1) continue;
    const parts = new Map(attributes.map(part => { const i = part.indexOf('='); return [part.slice(0, i < 0 ? undefined : i).trim().toLowerCase(), i < 0 ? '' : part.slice(i + 1).trim()]; }));
    const expiry = parts.has('max-age') ? Date.now() / 1000 + Number(parts.get('max-age')) : parts.has('expires') ? Date.parse(parts.get('expires')!) / 1000 : undefined;
    await cookies.set({ url: ORIGIN, name: pair.slice(0, at), value: pair.slice(at + 1), path: parts.get('path') || '/', httpOnly: parts.has('httponly'), secure: parts.has('secure'), ...(expiry !== undefined && Number.isFinite(expiry) ? { expirationDate: expiry } : {}), sameSite: parts.get('samesite')?.toLowerCase() === 'strict' ? 'strict' : parts.get('samesite')?.toLowerCase() === 'none' ? 'no_restriction' : 'lax' });
  }
  });
}
export async function hyperTunnelFetch(route: string, options: { method: string; body?: string | Buffer; signal: AbortSignal; lease: HyperOpenBotSessionLease; headers: Record<string, string> }): Promise<Response> {
  options.lease.assertCurrent();
  const signal = AbortSignal.any([options.signal, options.lease.signal]);
  const socketPath = await hyperOpenBotSocketPath(); signal.throwIfAborted();
  const cookie = await hyperOpenBotCookieHeader(options.lease); signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: route, method: options.method, signal, headers: { ...options.headers, host: '127.0.0.1:3010', cookie } }, response => {
      void (async () => {
        try {
          await saveCookies(response.headers['set-cookie'] ?? [], options.lease);
          options.lease.assertCurrent();
          const headers = new Headers(); for (const [name, value] of Object.entries(response.headers)) if (value && name !== 'set-cookie') headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          const status = response.statusCode ?? 502;
          if (status >= 300 && status < 400 && status !== 304) { response.destroy(); throw new Error('OpenBot redirects are refused'); }
          const noBody = [204, 205, 304].includes(status);
          if (noBody) response.resume();
          resolve(new Response(noBody ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers }));
        } catch (error) { response.destroy(); reject(error); }
      })();
    });
    connections.add(request); request.once('close', () => connections.delete(request)); request.once('error', reject);
    request.end(options.body);
  });
}
