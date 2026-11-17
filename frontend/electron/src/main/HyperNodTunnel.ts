import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { hyperOpenBotSshTarget } from './HyperOpenBotSsh';
/** Nod listens on the VM's loopback only. Its self-host NOD_PUBLIC_URL must name this exact origin. */
export const HYPER_NOD_REMOTE = { host: '127.0.0.1', port: 4311 } as const;
export const HYPER_NOD_ORIGIN = `http://${HYPER_NOD_REMOTE.host}:${HYPER_NOD_REMOTE.port}`;
export const hyperNodSshArgs = (host: string) => ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-W', `${HYPER_NOD_REMOTE.host}:${HYPER_NOD_REMOTE.port}`, host];
/**
 * Private IPC endpoint relaying each connection through its own `ssh -W` child: a Windows named pipe,
 * or a Unix socket in an owner-only directory. No TCP listener is opened. Separate from the OpenBot relay.
 */
export class HyperNodTunnel {
  private starting?: Promise<string>;
  private generation = 0;
  private server?: net.Server;
  private directory?: string;
  private readonly relays = new Set<ChildProcess>();
  private readonly sockets = new Set<net.Socket>();
  constructor(private readonly target = hyperOpenBotSshTarget) {}
  close() {
    this.generation++;
    this.starting = undefined;
    const server = this.server; this.server = undefined; server?.close(() => {});
    for (const socket of this.sockets) socket.destroy(new Error('Nod connection closed'));
    this.sockets.clear();
    for (const relay of this.relays) relay.kill('SIGTERM');
    this.relays.clear();
    const directory = this.directory; this.directory = undefined;
    if (directory) void fs.rm(directory, { recursive: true, force: true });
  }
  socketPath(): Promise<string> {
    if (this.starting) return this.starting;
    const version = this.generation;
    let ownedDirectory: string | undefined;
    let ownedServer: net.Server | undefined;
    const assertCurrent = () => { if (version !== this.generation) throw new Error('Nod connection startup cancelled'); };
    const starting = (async () => {
      let endpoint: string;
      if (process.platform === 'win32') endpoint = `\\\\.\\pipe\\hypertask-nod-${randomUUID()}`;
      else if (process.platform === 'linux') {
        ownedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'hypertask-nod-'));
        assertCurrent();
        await fs.chmod(ownedDirectory, 0o700);
        assertCurrent();
        this.directory = ownedDirectory;
        endpoint = path.join(ownedDirectory, 'nod.sock');
      } else throw new Error('The Nod assistant connection requires Windows or Linux.');
      const server = net.createServer(socket => this.relay(socket, version));
      ownedServer = server; this.server = server;
      await new Promise<void>((resolve, reject) => {
        const cancelled = () => reject(new Error('Nod connection startup cancelled'));
        server.once('error', reject); server.once('close', cancelled);
        server.listen({ path: endpoint, readableAll: false, writableAll: false }, () => { server.off('close', cancelled); server.off('error', reject); resolve(); });
      });
      assertCurrent();
      return endpoint;
    })().catch(async error => {
      // An obsolete startup removes only its own resources, never a newer attempt's.
      if (version === this.generation) this.close();
      else { ownedServer?.close(() => {}); if (ownedDirectory) await fs.rm(ownedDirectory, { recursive: true, force: true }); }
      throw error;
    });
    this.starting = starting;
    return starting;
  }
  private relay(socket: net.Socket, version: number) {
    if (version !== this.generation) { socket.destroy(); return; }
    const target = this.target();
    const relay = spawn(target.command, hyperNodSshArgs(target.host), { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.relays.add(relay); this.sockets.add(socket);
    const fail = () => socket.destroy(new Error('Private Nod SSH connection failed'));
    socket.on('error', () => {});
    relay.once('error', fail);
    relay.once('exit', code => { this.relays.delete(relay); if (code !== 0) fail(); else socket.end(); });
    relay.stdin?.on('error', fail); relay.stdout?.on('error', fail);
    socket.once('close', () => { this.sockets.delete(socket); this.relays.delete(relay); relay.kill('SIGTERM'); });
    if (relay.stdin && relay.stdout) { socket.pipe(relay.stdin); relay.stdout.pipe(socket); }
    else fail();
  }
}
