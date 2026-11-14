import { hyperRunConnectionLost } from './HyperRunConnection';
import type { HyperOpenBotSocketEvent } from '@shared/api';
/** Browser-compatible Phoenix transport with a fixed main-process gateway destination. */
export class HyperOpenBotSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 0; bufferedAmount = 0; extensions = ''; protocol = ''; binaryType: BinaryType = 'blob';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private id = crypto.randomUUID();
  private connection?: { threadId: string; runId: string };
  private dispose: () => void;
  constructor(readonly url: string, protocols: string | string[] = []) {
    super();
    const path = hyperSocketPath(url);
    if (!path) throw new DOMException('OpenBot socket refused', 'SecurityError');
    this.dispose = window.appflowy.hyperOpenBot.onSocket(event => { if (event.id === this.id) this.receive(event); });
    void window.appflowy.hyperOpenBot.socketOpen(this.id, path, typeof protocols === 'string' ? [protocols] : protocols).catch(() => { this.receive({ id: this.id, type: 'error' }); this.receive({ id: this.id, type: 'close', code: 1006, reason: 'OpenBot socket could not open' }); });
  }
  private receive(value: HyperOpenBotSocketEvent) {
    if (this.readyState === 3) return;
    if (value.type === 'open') {
      if (this.readyState === 2) { window.appflowy.hyperOpenBot.socketClose(this.id, 1000); return; }
      this.readyState = 1; const event = new Event('open'); this.dispatchEvent(event); this.onopen?.(event);
    } else if (value.type === 'message') {
      const data = typeof value.data === 'string' ? value.data : this.binaryType === 'arraybuffer' ? new Uint8Array(value.data ?? []).buffer : new Blob([new Uint8Array(value.data ?? [])]);
      const event = new MessageEvent('message', { data }); this.dispatchEvent(event); this.onmessage?.(event);
    } else if (value.type === 'error') { const event = new Event('error'); this.dispatchEvent(event); this.onerror?.(event); }
    else {
      const interrupted = this.readyState !== 2 ? this.connection : undefined;
      this.readyState = 3; this.dispose();
      const event = new CloseEvent('close', { code: value.code, reason: value.reason, wasClean: value.code === 1000 });
      this.dispatchEvent(event); this.onclose?.(event);
      if (interrupted) hyperRunConnectionLost(interrupted);
    }
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== 1) throw new DOMException('OpenBot socket is not open', 'InvalidStateError');
    if (typeof data === 'string') {
      // Phoenix's run join carries IDs only. Never retain its URL, token or entire payload.
      try {
        const frame = JSON.parse(data);
        if (Array.isArray(frame) && frame.length === 5 && frame[3] === 'phx_join' && typeof frame[2] === 'string' && frame[2].startsWith('thread:') && typeof frame[4]?.run_id === 'string')
          this.connection = { threadId: frame[2].slice('thread:'.length), runId: frame[4].run_id };
      } catch { /* Other socket messages do not identify a run. */ }
      window.appflowy.hyperOpenBot.socketSend(this.id, data);
    }
    else if (data instanceof Blob) void data.arrayBuffer().then(bytes => { if (this.readyState === 1) window.appflowy.hyperOpenBot.socketSend(this.id, new Uint8Array(bytes)); });
    else window.appflowy.hyperOpenBot.socketSend(this.id, ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
  }
  close(code = 1000, reason = '') { if (this.readyState >= 2) return; this.readyState = 2; window.appflowy.hyperOpenBot.socketClose(this.id, code, reason); }
}
export function hyperSocketPath(url: string): string | undefined {
  // Phoenix resolves a path-only gateway against file:// as ws:///api/... .
  if (/^ws:\/\/\/api\/intelligence\/client\/websocket\?/.test(url)) return url.slice('ws://'.length);
  try { const parsed = new URL(url); if (['ws:', 'wss:'].includes(parsed.protocol) && parsed.hostname === 'hyper-openbot.invalid' && parsed.pathname === '/api/intelligence/client/websocket') return parsed.pathname + parsed.search; } catch { /* Refused below. */ }
  return undefined;
}
