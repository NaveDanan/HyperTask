import http from 'node:http';
import type { z } from 'zod';
import { HYPER_NOD_PIN, type HyperNodEvent, type HyperNodHistoryCursor, type HyperNodHistoryPage, type HyperNodSendInput, type HyperNodSnapshot, type HyperNodStatus, type HyperNodSubmitted } from '@shared/HyperNod';
import { HyperNodError } from './HyperNodAccess';
import { HyperNodSseParser, hyperNodEvent } from './HyperNodSse';
import { HYPER_NOD_REMOTE } from './HyperNodTunnel';
import { HyperNodConfigurationSchema, HyperNodErrorSchema, HyperNodHealthSchema, HyperNodHistorySchema, HyperNodStateSchema, HyperNodStoppedSchema, HyperNodSubmittedSchema } from './HyperNodWire';
const HOST = `${HYPER_NOD_REMOTE.host}:${HYPER_NOD_REMOTE.port}`;
/** Finite request and stream-opening deadline, and the longest silence allowed between keepalives (15 s). */
const LIMITS = { deadlineMs: 30_000, idleMs: 45_000 };
const MAX_BODY = 16 * 1024 * 1024;
export interface HyperNodClientDependencies {
  socketPath(): Promise<string>;
  readAccess(signal: AbortSignal): Promise<string>;
}
type Reply = { status: number; body: unknown };
/** Pinned Nod HTTP contract over the private relay. Main injects the Bearer token; no browser Origin is sent. */
export class HyperNodClient {
  private agent = new http.Agent({ keepAlive: true, maxSockets: 6 });
  private access?: { controller: AbortController; token: Promise<string> };
  constructor(private readonly dependencies: HyperNodClientDependencies, private readonly limits = LIMITS) {}
  /** Forget the token and pooled connections after sign-out, identity changes or a refused token. */
  reset() {
    this.access?.controller.abort(new Error('Nod access reset'));
    this.access = undefined;
    this.agent.destroy();
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 6 });
  }
  async status(signal: AbortSignal): Promise<HyperNodStatus> {
    try {
      await this.call('GET', '/api/health', signal, HyperNodHealthSchema);
      const configuration = await this.call('GET', '/api/configuration', signal, HyperNodConfigurationSchema);
      const model = { provider: configuration.provider, model: configuration.model };
      if (!configuration.llmReady) return { ready: false, problem: 'model_required', ...model, ...(configuration.modelIssue ? { detail: configuration.modelIssue.reason } : {}) };
      return { ready: true, problem: 'none', ...model };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof HyperNodError) return { ready: false, problem: error.problem, ...(error.detail ? { detail: error.detail } : {}) };
      throw error;
    }
  }
  state(signal: AbortSignal): Promise<HyperNodSnapshot> { return this.call('GET', '/api/state', signal, HyperNodStateSchema); }
  history(cursor: HyperNodHistoryCursor, signal: AbortSignal): Promise<HyperNodHistoryPage> {
    const query = new URLSearchParams({ threadId: cursor.threadId, before: cursor.before, beforeId: cursor.beforeId });
    return this.call('GET', `/api/messages?${query}`, signal, HyperNodHistorySchema);
  }
  async send(input: HyperNodSendInput, signal: AbortSignal): Promise<HyperNodSubmitted> {
    const answer = input.answer;
    const body = {
      text: input.text, threadId: input.threadId, clientMessageId: input.clientMessageId, attachmentIds: [],
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(answer?.kind === 'choices' ? { questionAnswer: { choiceIds: answer.choiceIds, ...(answer.custom ? { custom: true } : {}) } } : {}),
      ...(answer?.kind === 'written' ? { questionAnswer: { custom: true } } : {}),
      ...(answer?.kind === 'approval' ? { approvalAnswer: { approvalId: answer.approvalId, approved: answer.approved } } : {}),
    };
    try { return await this.call('POST', '/api/messages', signal, HyperNodSubmittedSchema, JSON.stringify(body)); }
    catch (error) {
      // Nod answers 409 when a question or approval was already settled or withdrawn.
      if (answer && error instanceof HyperNodError && error.status === 409) throw new HyperNodError('request_unavailable', error.detail, 409, error.code);
      throw error;
    }
  }
  /** Nod stops every session and task of this assistant, not only the visible reply. */
  async stop(signal: AbortSignal): Promise<void> { await this.call('POST', '/api/thread/stop', signal, HyperNodStoppedSchema, '{}'); }
  /** Streams live events until the connection ends. Nod keeps no replay log: reload state after reconnecting. */
  async events(signal: AbortSignal, emit: (event: HyperNodEvent) => void): Promise<void> {
    const token = await this.token(signal);
    const socketPath = await this.dependencies.socketPath();
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      // Until a valid stream starts the keepalive watchdog cannot run, so opening has its own deadline,
      // which also bounds reading a refused response's body.
      let opening: NodeJS.Timeout | undefined;
      const request = http.request({ socketPath, agent: false, path: '/api/events', method: 'GET', signal, headers: { host: HOST, authorization: `Bearer ${token}`, accept: 'text/event-stream' } }, response => {
        const status = response.statusCode ?? 502;
        if (status !== 200 || !/^text\/event-stream\b/.test(response.headers['content-type'] ?? '')) {
          void collect(response).then(body => reject(this.failure('GET', '/api/events', { status, body })), reject).finally(() => clearTimeout(opening));
          return;
        }
        clearTimeout(opening);
        emit({ type: 'connected' });
        const parser = new HyperNodSseParser();
        let idle: NodeJS.Timeout;
        const watch = () => { clearTimeout(idle); idle = setTimeout(() => response.destroy(new Error('Nod stopped sending keepalives.')), this.limits.idleMs); };
        watch();
        response.on('data', (chunk: Buffer) => {
          watch();
          try { for (const data of parser.push(chunk)) emit(hyperNodEvent(data)); }
          catch (error) { response.destroy(error as Error); }
        });
        response.once('error', error => { clearTimeout(idle); reject(new HyperNodError('unreachable', `The Nod event stream ended: ${error.message}`)); });
        response.once('end', () => { clearTimeout(idle); resolve(); });
        response.once('close', () => { clearTimeout(idle); resolve(); });
      });
      request.once('error', error => { clearTimeout(opening); reject(signal.aborted ? signal.reason : new HyperNodError('unreachable', `Nod did not respond through the private SSH connection: ${error.message}`)); });
      opening = setTimeout(() => request.destroy(new Error(`no event stream within ${this.limits.deadlineMs / 1000} seconds`)), this.limits.deadlineMs);
      request.end();
    });
  }
  private token(signal: AbortSignal): Promise<string> {
    if (!this.access) {
      const controller = new AbortController();
      const access = { controller, token: this.dependencies.readAccess(controller.signal) };
      access.token.catch(() => { if (this.access === access) this.access = undefined; });
      this.access = access;
    }
    const pending = this.access.token;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  private async call<T extends z.ZodType>(method: 'GET' | 'POST', route: string, signal: AbortSignal, schema: T, body?: string): Promise<z.output<T>> {
    const reply = await this.request(method, route, signal, body);
    if (reply.status < 200 || reply.status >= 300) throw this.failure(method, route, reply);
    const value = schema.safeParse(reply.body);
    if (!value.success) throw new HyperNodError('operation_failed', `Nod returned an unexpected response for ${method} ${route.split('?')[0]}. HyperTask supports Nod ${HYPER_NOD_PIN.slice(0, 8)}.`);
    return value.data;
  }
  private failure(method: string, route: string, reply: Reply): HyperNodError {
    const parsed = HyperNodErrorSchema.safeParse(reply.body);
    const reason = parsed.success ? parsed.data.error.slice(0, 500) : undefined;
    const code = parsed.success ? parsed.data.code : undefined;
    const path = route.split('?')[0];
    if (reply.status === 401) { this.reset(); return new HyperNodError('unauthorized', reason, 401); }
    if (reply.status === 403) return new HyperNodError('unsafe_deployment', `Nod refused ${method} ${path}: ${reason ?? 'forbidden'}`, 403);
    if (reply.status === 503 && path === '/api/messages') return new HyperNodError('model_required', reason, 503);
    return new HyperNodError('operation_failed', `Nod returned ${reply.status} for ${method} ${path}${reason ? `: ${reason}` : '.'}`, reply.status, code);
  }
  private async request(method: 'GET' | 'POST', route: string, signal: AbortSignal, body?: string): Promise<Reply> {
    const token = await this.token(signal);
    const socketPath = await this.dependencies.socketPath();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.limits.deadlineMs)]);
    deadline.throwIfAborted();
    return new Promise((resolve, reject) => {
      const headers: Record<string, string | number> = { host: HOST, authorization: `Bearer ${token}`, accept: 'application/json' };
      if (body !== undefined) Object.assign(headers, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      const request = http.request({ socketPath, agent: this.agent, path: route, method, signal: deadline, headers }, response => {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) { response.destroy(); reject(new HyperNodError('unsafe_deployment', `Nod redirected ${method} ${route.split('?')[0]}; redirects are refused.`, status)); return; }
        collect(response).then(value => resolve({ status, body: value }), reject);
      });
      request.once('error', error => {
        if (signal.aborted) reject(signal.reason);
        else if (deadline.aborted) reject(new HyperNodError('unreachable', `Nod did not answer ${method} ${route.split('?')[0]} within ${this.limits.deadlineMs / 1000} seconds.`));
        else reject(new HyperNodError('unreachable', `Nod did not respond through the private SSH connection: ${error.message}`));
      });
      request.end(body);
    });
  }
}
function collect(response: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { response.destroy(); reject(new HyperNodError('operation_failed', 'Nod sent a response larger than 16 MiB.')); return; }
      chunks.push(chunk);
    });
    response.once('error', error => reject(new HyperNodError('unreachable', `The Nod response was interrupted: ${error.message}`)));
    // A destroyed response may close without an error; an unfinished body must still settle.
    response.once('close', () => { if (!response.complete) reject(new HyperNodError('unreachable', 'The Nod response was interrupted before it finished.')); });
    response.once('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) { resolve(undefined); return; }
      try { resolve(JSON.parse(text)); } catch { resolve(undefined); }
    });
  });
}
