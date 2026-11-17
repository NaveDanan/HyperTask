import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { powerShellExecutable, stripClixml } from './powershell';
import { SettingsError } from './settings-error';
import { HyperOutlookClosed } from '@shared/HyperOutlookPresence';
import { hyperOutlookDisconnected } from './HyperOutlookConnection';
import { HyperOutlookScript } from './HyperOutlookScript';
import { HyperOutlookArgs, HyperOutlookReply, HyperOutlookValues, type HyperOutlookOp } from './HyperOutlookSchema';
export const HyperOutlookUnavailable = 'Classic Outlook for Windows is required. Run HyperTask and Outlook as the same Windows user without elevation.';
/** The request may already have reached Outlook (timeout, lost host, unreadable reply): its outcome is unknown, so a send is never treated as refused. */
export class HyperOutlookLost extends SettingsError { constructor(message: string) { super('state', message); this.name = 'HyperOutlookLost'; } }
// An online-meeting button opens the meeting window and waits for its add-in; mail lists scan up to 500 items.
const HyperOutlookSlow: ReadonlySet<HyperOutlookOp> = new Set(['list', 'create', 'mail.list', 'event.forward']);
interface HyperOutlookPending { op: HyperOutlookOp; resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
interface HyperOutlookQueued { op: HyperOutlookOp; args: unknown; resolve: (value: any) => void; reject: (error: Error) => void }
export class HyperOutlookBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, HyperOutlookPending>();
  private queue: HyperOutlookQueued[] = [];
  private stopped = false;
  private running: boolean | null = null;
  private availability = new Set<(connected: boolean) => void>();
  onAvailability(listener: (connected: boolean) => void) { this.availability.add(listener); return () => { this.availability.delete(listener); }; }
  private reportAvailability(connected: boolean) { for (const listener of this.availability) listener(connected); }
  setRunning(running: boolean) {
    if (!running && this.running !== false) this.reset(HyperOutlookClosed);
    this.running = running;
  }
  private reset(message: string) {
    const child = this.child; this.child = null;
    this.peopleCache.clear(); this.failPending(new HyperOutlookLost(message)); child?.kill();
    this.reportAvailability(false);
  }
  private scripts = new Set<string>();
  private peopleCache = new Map<string, { value: unknown; expires: number }>();
  private cachePeople(key: string, value: unknown) {
    this.peopleCache.delete(key); this.peopleCache.set(key, { value, expires: Date.now() + 300000 });
    while (this.peopleCache.size > 200) this.peopleCache.delete(this.peopleCache.keys().next().value!);
  }
  private start() {
    if (this.stopped) throw new SettingsError('state', 'Outlook connection has stopped.');
    if (process.platform !== 'win32') throw new SettingsError('unsupported', HyperOutlookUnavailable);
    if (this.child) return this.child;
    // With a byte order mark, Windows PowerShell reads the script as UTF-8 whatever the system code page is.
    const script = join(tmpdir(), 'HyperOutlook-' + randomUUID() + '.ps1'); writeFileSync(script, String.fromCharCode(0xfeff) + HyperOutlookScript, 'utf8'); this.scripts.add(script);
    const child = spawn(powerShellExecutable(), ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = '', stderr = '';
    const failed = (message: string) => { if (this.child === child) { this.child = null; this.failPending(new HyperOutlookLost(message)); child.kill(); this.reportAvailability(false); } };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      if (this.child !== child) return;
      buffer += data;
      if (buffer.length > 32 * 1024 * 1024) { failed('Outlook returned too much data. Refresh to reconnect.'); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim().replace(/^\uFEFF/, ''); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const reply = HyperOutlookReply.parse(JSON.parse(line)), request = this.pending.get(reply.id);
          if (!request) continue;
          if (!reply.ok) {
            this.pending.delete(reply.id); clearTimeout(request.timer);
            // 'unknown': Outlook failed after it began writing (a Save or Send), so the change may have happened.
            request.reject(reply.kind === 'unknown' ? new HyperOutlookLost(reply.message)
              : new SettingsError(reply.kind === 'conflict' ? 'state' : reply.kind, reply.kind === 'conflict' ? 'Changed in Outlook — reloaded' : reply.message));
            if (hyperOutlookDisconnected(reply.message)) { this.reset(reply.message); return; }
          } else {
            const value = HyperOutlookValues[request.op].parse(reply.value);
            this.pending.delete(reply.id); clearTimeout(request.timer); request.resolve(value);
            if (request.op === 'status') {
              const status = value as { available: boolean; reason?: string };
              this.reportAvailability(status.available);
              if (!status.available && hyperOutlookDisconnected(status.reason ?? '')) { this.reset(status.reason!); return; }
            }
          }
        } catch { failed('Outlook returned an invalid response. Refresh to reconnect.'); return; }
        this.pump();
      }
    });
    child.stderr.on('data', (data: string) => { stderr = (stderr + stripClixml(data)).slice(-2048); });
    child.stdin.on('error', () => failed('Outlook connection closed. Refresh to reconnect.'));
    child.on('error', () => failed(HyperOutlookUnavailable));
    child.on('close', () => {
      try { unlinkSync(script); this.scripts.delete(script); } catch {}
      failed(`${HyperOutlookUnavailable}${stderr.trim() ? ' The Outlook host exited unexpectedly.' : ''}`);
    });
    return child;
  }
  request<K extends HyperOutlookOp>(op: K, args: z.input<(typeof HyperOutlookArgs)[K]>): Promise<z.output<(typeof HyperOutlookValues)[K]>> {
    return new Promise((resolve, reject) => {
      const valid = HyperOutlookArgs[op].safeParse(args);
      if (!valid.success) { reject(new SettingsError('format', valid.error.issues[0]?.message ?? 'Invalid Outlook request.')); return; }
      if (this.stopped) { reject(new SettingsError('state', 'Outlook connection has stopped.')); return; }
      if (process.platform !== 'win32') { reject(new SettingsError('unsupported', HyperOutlookUnavailable)); return; }
      if (this.running === false && !op.startsWith('people.')) { reject(new SettingsError('state', HyperOutlookClosed)); return; }
      const key = op.startsWith('people.') ? op + ':' + JSON.stringify(valid.data).toLocaleLowerCase() : '';
      const cached = this.peopleCache.get(key);
      if (cached && cached.expires > Date.now()) { this.peopleCache.delete(key); this.peopleCache.set(key, cached); resolve(cached.value as z.output<(typeof HyperOutlookValues)[K]>); return; }
      if (key) {
        const done = resolve;
        resolve = value => {
          this.cachePeople(key, value);
          if (Array.isArray(value)) for (const person of value) this.cachePeople('people.lookup:' + JSON.stringify({ email: person.email }).toLowerCase(), person);
          done(value);
        };
      }
      this.queue.push({ op, args: valid.data ?? {}, resolve, reject });
      this.pump();
    });
  }
  /**
   * The host runs one request at a time, so requests are sent one at a time too: a request's timeout starts when it is
   * sent, and a short request waiting behind a long one (an online meeting) can never time out the long one.
   */
  private pump() {
    if (this.pending.size || !this.queue.length) return;
    const next = this.queue.shift()!;
    let child: ChildProcessWithoutNullStreams;
    try { child = this.start(); } catch (error) { next.reject(error as Error); this.pump(); return; }
    const id = randomUUID();
    const timer = setTimeout(() => {
      if (this.child === child) this.child = null;
      this.failPending(new HyperOutlookLost('Outlook timed out. Refresh to check whether the change completed before retrying.')); child.kill(); this.reportAvailability(false);
    }, HyperOutlookSlow.has(next.op) ? 60000 : 30000);
    this.pending.set(id, { op: next.op, resolve: next.resolve, reject: next.reject, timer });
    try { child.stdin.write(JSON.stringify({ id, op: next.op, args: next.args }) + '\n'); }
    catch { if (this.child === child) this.child = null; this.failPending(new HyperOutlookLost('Outlook connection closed. Refresh to reconnect.')); child.kill(); this.reportAvailability(false); }
  }
  /** The request in Outlook may have run (outcome unknown); queued requests never reached it. */
  private failPending(error: Error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    const queued = this.queue.splice(0);
    for (const request of queued) request.reject(new SettingsError('state', `${error.message} This request was not sent to Outlook.`));
  }
  stop() { this.peopleCache.clear(); for (const script of this.scripts) { try { unlinkSync(script); } catch {} } this.scripts.clear(); this.stopped = true; const child = this.child; this.child = null; this.failPending(new HyperOutlookLost('Outlook connection has stopped.')); child?.kill(); }
}
