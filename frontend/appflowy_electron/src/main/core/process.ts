import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import {
  FrameReader,
  Kind,
  Status,
  decodePortMessage,
  decodeResponse,
  encodeFrame,
  encodeRequest,
  type CoreResponse,
} from './protocol';

export interface CoreReply {
  status: number;
  payload: Uint8Array;
}

interface CoreProcessEvents {
  notification: [payload: Uint8Array];
  portMessage: [port: bigint, value: unknown];
  exit: [code: number | null];
}

const HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * Runs the AppFlowy Rust core (rust-lib/electron-core) as a child process and talks to it
 * over an authenticated loopback connection. This is the Electron counterpart of the
 * dart-ffi library the Flutter app loads.
 */
export class CoreProcess extends EventEmitter<CoreProcessEvents> {
  private child?: ChildProcess;
  private socket?: net.Socket;
  private nextId = 1n;
  private readonly pending = new Map<bigint, (reply: CoreReply) => void>();
  private initWaiters: Array<(code: number) => void> = [];
  private closing = false;

  constructor(private readonly binaryPath: string, private readonly childEnvironment?: () => NodeJS.ProcessEnv) {
    super();
  }

  async start(onOutput: (chunk: Buffer) => void): Promise<void> {
    const token = randomBytes(32).toString('hex');
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as net.AddressInfo;

    const connected = new Promise<net.Socket>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AppFlowy core did not connect')), HANDSHAKE_TIMEOUT_MS);
      server.on('connection', (socket) => {
        const reader = new FrameReader();
        const onData = (chunk: Buffer) => {
          let frames;
          try {
            frames = reader.push(chunk);
          } catch {
            socket.destroy();
            return;
          }
          const hello = frames[0];
          if (!hello) return;
          socket.off('data', onData);
          const expected = Buffer.from(token);
          if (hello.kind !== Kind.Hello || hello.body.length !== expected.length || !timingSafeEqual(hello.body, expected)) {
            socket.destroy();
            return;
          }
          clearTimeout(timer);
          server.close();
          this.attach(socket, reader, frames.slice(1));
          resolve(socket);
        };
        socket.on('data', onData);
      });
    });

    this.child = spawn(this.binaryPath, [], {
      env: { ...process.env, ...this.childEnvironment?.(), APPFLOWY_CORE_PORT: String(port), APPFLOWY_CORE_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout?.on('data', onOutput);
    this.child.stderr?.on('data', onOutput);
    this.child.once('exit', (code) => {
      server.close();
      this.failPending('AppFlowy core exited');
      if (!this.closing) this.emit('exit', code);
    });

    this.socket = await connected;
  }

  /** Sends the init_sdk configuration. Resolves with the core's return code (0 = success). */
  init(configuration: object): Promise<number> {
    return new Promise((resolve) => {
      const frame = encodeFrame(Kind.Init, Buffer.from(JSON.stringify(configuration), 'utf8'));
      if (!this.socket || this.socket.destroyed) { resolve(-1); return; }
      // A replacement SDK cannot finish requests belonging to the old owner.
      // Resolve them before native teardown, and never replay them into the new SDK.
      this.retireRequests('AppFlowy SDK initialization retired this request');
      this.initWaiters.push(resolve);
      this.write(frame);
    });
  }

  request(event: string, payload: Uint8Array): Promise<CoreReply> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        resolve({ status: Status.Internal, payload: Buffer.from('AppFlowy core is not running') });
        return;
      }
      if (this.initWaiters.length > 0) {
        resolve({ status: Status.Internal, payload: Buffer.from('AppFlowy core is initializing') });
        return;
      }
      this.pending.set(id, resolve);
      this.write(encodeRequest(id, event, payload));
    });
  }

  log(level: number, message: string): void {
    this.write(encodeFrame(Kind.Log, Buffer.from([level]), Buffer.from(message, 'utf8')));
  }

  /** Asks the core to close its database and exit; kills it if it does not. */
  async stop(timeoutMs = 5_000): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    this.closing = true;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    this.write(encodeFrame(Kind.Shutdown));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    await exited;
    clearTimeout(timer);
  }

  private attach(socket: net.Socket, reader: FrameReader, initial: { kind: number; body: Buffer }[]) {
    socket.setNoDelay(true);
    const handle = (frame: { kind: number; body: Buffer }) => {
      switch (frame.kind) {
        case Kind.Response:
          this.resolve(decodeResponse(frame.body));
          break;
        case Kind.Notification:
          if (this.initWaiters.length === 0) this.emit('notification', new Uint8Array(frame.body));
          break;
        case Kind.PortMessage: {
          if (this.initWaiters.length > 0) break;
          const { port, value } = decodePortMessage(frame.body);
          this.emit('portMessage', port, value);
          break;
        }
        case Kind.InitDone: {
          const code = Number(frame.body.readBigInt64LE(0));
          this.initWaiters.shift()?.(code);
          break;
        }
      }
    };
    initial.forEach(handle);
    socket.on('data', (chunk: Buffer) => {
      try {
        reader.push(chunk).forEach(handle);
      } catch (error) {
        console.error('[core] invalid frame', error);
        socket.destroy();
      }
    });
    socket.on('error', (error) => {
      if (!this.closing) console.error('[core] connection error', error);
    });
    socket.on('close', () => this.failPending('AppFlowy core connection closed'));
  }

  private resolve(response: CoreResponse) {
    const resolve = this.pending.get(response.id);
    if (!resolve) return;
    this.pending.delete(response.id);
    resolve({ status: response.status, payload: response.payload });
  }

  private retireRequests(message: string) {
    const payload = Buffer.from(message);
    for (const resolve of this.pending.values()) resolve({ status: Status.Internal, payload });
    this.pending.clear();
  }

  private failPending(message: string) {
    this.retireRequests(message);
    for (const waiter of this.initWaiters) waiter(-1);
    this.initWaiters = [];
  }

  private write(frame: Buffer) {
    if (this.socket && !this.socket.destroyed) this.socket.write(frame);
  }
}
