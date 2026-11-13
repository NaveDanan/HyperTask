import { hyperCodeSyntaxLanguage, hyperCodeSyntaxLimits, hyperCodeSyntaxReply, hyperCodeSyntaxSource, type HyperCodeSyntaxReply } from './HyperCodeSyntaxTypes';
export interface HyperCodeSyntaxWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}
interface Job { key: object; id: number; source: string; language: string | null; current(): boolean; resolve(value: HyperCodeSyntaxReply | null): void }
const createWorker = () => new Worker(new URL('./HyperCodeSyntax.worker.ts', import.meta.url), { type: 'module' });
/** One worker per captured owner, bounded queued/latest work. Failure only removes optional paint. */
export class HyperCodeSyntaxClient {
  private worker: HyperCodeSyntaxWorker | null = null;
  private ready = false;
  private nextId = 0;
  private active: Job | null = null;
  private queue: Job[] = [];
  private startup: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private ownership: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  constructor(private readonly current: () => boolean, private readonly factory: () => HyperCodeSyntaxWorker = createWorker) {}
  isCurrent() { return !this.disposed && this.current(); }
  request(key: object, source: string, language: string | null, current: () => boolean): Promise<HyperCodeSyntaxReply | null> {
    if (!this.isCurrent() || !current() || !source || !hyperCodeSyntaxSource(source) || hyperCodeSyntaxLanguage(language) === undefined) return Promise.resolve(null);
    this.cancel(key);
    if (this.queue.length >= hyperCodeSyntaxLimits.queue) return Promise.resolve(null);
    return new Promise(resolve => { this.queue.push({ key, id: ++this.nextId, source, language, current, resolve }); this.pump(); });
  }
  cancel(key: object) {
    this.queue = this.queue.filter(job => { if (job.key !== key) return true; job.resolve(null); return false; });
    if (this.active?.key === key) { const job = this.active; this.active = null; this.stopWorker(); job.resolve(null); this.pump(); }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    const jobs = [...this.queue, ...(this.active ? [this.active] : [])]; this.queue = []; this.active = null;
    this.stopWorker(); for (const job of jobs) job.resolve(null);
  }
  private stopWorker() { clearTimeout(this.startup); clearTimeout(this.deadline); clearInterval(this.ownership); this.startup = undefined; this.deadline = undefined; this.ownership = undefined; this.worker?.terminate(); this.worker = null; this.ready = false; }
  private fail() { const jobs = [...this.queue, ...(this.active ? [this.active] : [])]; this.queue = []; this.active = null; this.stopWorker(); for (const job of jobs) job.resolve(null); }
  private pump() {
    if (!this.isCurrent()) { this.dispose(); return; }
    if (this.active || !this.queue.length) return;
    while (this.queue.length && !this.queue[0].current()) this.queue.shift()!.resolve(null);
    if (!this.queue.length) return;
    if (!this.worker) {
      try {
        const worker = this.factory(); this.worker = worker;
        worker.onmessage = event => { if (this.worker !== worker) return; this.message(event.data); };
        worker.onerror = () => { if (this.worker === worker) this.fail(); };
        this.startup = setTimeout(() => { if (this.worker === worker && !this.ready) this.fail(); }, hyperCodeSyntaxLimits.startupMs);
        this.ownership = setInterval(() => { if (!this.isCurrent()) this.dispose(); }, 25);
      } catch { this.fail(); }
      return;
    }
    if (!this.ready) return;
    const job = this.queue.shift()!; if (!job.current()) { job.resolve(null); this.pump(); return; }
    this.active = job;
    this.deadline = setTimeout(() => { if (this.active !== job) return; this.active = null; this.stopWorker(); job.resolve(null); this.pump(); }, hyperCodeSyntaxLimits.jobMs);
    try { this.worker.postMessage({ version: 1, id: job.id, source: job.source, language: job.language }); } catch { this.fail(); }
  }
  private message(data: unknown) {
    if (!this.isCurrent()) { this.dispose(); return; }
    if (!this.ready) {
      const ready = data as { version?: unknown; ready?: unknown; engine?: unknown; license?: unknown } | null;
      if (!ready || typeof ready !== 'object' || Array.isArray(ready) || Object.keys(ready).some(key => !['version', 'ready', 'engine', 'license'].includes(key)) || ready.version !== 1 || ready.ready !== true || ready.engine !== 'highlight.js@11.11.1' || typeof ready.license !== 'string' || !ready.license.length || ready.license.length > 8192) { this.fail(); return; }
      clearTimeout(this.startup); this.ready = true; this.pump(); return;
    }
    const job = this.active;
    if (!job || !hyperCodeSyntaxReply(data, job.id)) { this.fail(); return; }
    clearTimeout(this.deadline); this.active = null; job.resolve(job.current() && this.isCurrent() ? data : null); this.pump();
  }
}
interface Pool { key: string; client: HyperCodeSyntaxClient; refs: number }
const pools = new Map<string, Pool>();
export function hyperAcquireCodeSyntaxClient(key: string, current: () => boolean) {
  let pool = pools.get(key);
  if (pool && !pool.client.isCurrent()) { pool.client.dispose(); pools.delete(key); pool = undefined; }
  if (!pool) { pool = { key, client: new HyperCodeSyntaxClient(current), refs: 0 }; pools.set(key, pool); }
  pool.refs++; const captured = pool; let released = false;
  return { client: pool.client, release() { if (released) return; released = true; if (--captured.refs === 0) { captured.client.dispose(); if (pools.get(key) === captured) pools.delete(key); } } };
}
