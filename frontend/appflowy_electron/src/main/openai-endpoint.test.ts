import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverEndpoint, testEndpoint } from './openai-endpoint';

const mocks = vi.hoisted(() => ({ request: vi.fn(), unprotect: vi.fn() }));
vi.mock('electron', () => ({ net: { request: mocks.request } }));
vi.mock('./dpapi', () => ({ unprotect: mocks.unprotect }));
type Plan = { status?: number; body?: string; redirect?: number; hang?: boolean; chunks?: Buffer[]; error?: boolean };
class TestRequest extends EventEmitter {
  readonly headers: Record<string, string> = {};
  readonly abort = vi.fn();
  body?: string;
  constructor(readonly options: { method: string; url: string; redirect: string }, private readonly plan: Plan) { super(); }
  setHeader(name: string, value: string) { this.headers[name] = value; }
  end(body?: string) {
    this.body = body;
    queueMicrotask(() => {
      if (this.plan.hang) return;
      if (this.plan.error) { this.emit('error', new Error('provider error may contain sensitive details')); return; }
      if (this.plan.redirect) { this.emit('redirect', this.plan.redirect); return; }
      const response = Object.assign(new EventEmitter(), { statusCode: this.plan.status ?? 200 });
      this.emit('response', response);
      if (this.abort.mock.calls.length) return;
      for (const chunk of this.plan.chunks ?? [Buffer.from(this.plan.body ?? '{"data":[]}')]) response.emit('data', chunk);
      response.emit('end');
    });
  }
}
const baseUrl = 'http://localhost:8000/v1';
const requests: TestRequest[] = [];
let plan: (url: string) => Plan;
beforeEach(() => {
  vi.clearAllMocks(); requests.length = 0;
  plan = () => ({ body: '{"data":[{"id":"one"}]}' });
  mocks.unprotect.mockResolvedValue('saved-fixture-key');
  mocks.request.mockImplementation(options => { const request = new TestRequest(options, plan(options.url)); requests.push(request); return request; });
});
afterEach(() => vi.useRealTimers());
describe('main process endpoint discovery', () => {
  it('uses a transient typed key without decrypting or requiring a model', async () => {
    expect(await discoverEndpoint({ baseUrl, protectedKey: 'old-key', apiKey: 'typed-fixture-key' })).toEqual({ models: ['one'] });
    expect(mocks.unprotect).not.toHaveBeenCalled();
    expect(requests[0].options).toEqual({ method: 'GET', url: `${baseUrl}/models`, redirect: 'manual' });
    expect(requests[0].headers.Authorization).toBe('Bearer typed-fixture-key');
    expect(requests[0].headers['Cache-Control']).toBe('no-store, no-cache');
    expect(requests[0].body).toBeUndefined();
  });
  it('uses saved DPAPI credentials only when no override is provided and honors explicit key removal', async () => {
    await discoverEndpoint({ baseUrl, protectedKey: 'protected-fixture' });
    expect(mocks.unprotect).toHaveBeenCalledWith('protected-fixture');
    expect(requests[0].headers.Authorization).toBe('Bearer saved-fixture-key');
    mocks.unprotect.mockClear(); await discoverEndpoint({ baseUrl, protectedKey: 'protected-fixture', apiKey: '' });
    expect(mocks.unprotect).not.toHaveBeenCalled(); expect(requests[1].headers).not.toHaveProperty('Authorization');
  });
  it('allows the main process to resolve a platform-specific saved credential without returning it', async () => {
    const resolver = vi.fn(async () => 'resolved-fixture-key');
    const result = await discoverEndpoint({ baseUrl, protectedKey: 'platform-envelope' }, undefined, resolver);
    expect(result).toEqual({ models: ['one'] }); expect(resolver).toHaveBeenCalledExactlyOnceWith('platform-envelope');
    expect(mocks.unprotect).not.toHaveBeenCalled(); expect(requests[0].headers.Authorization).toBe('Bearer resolved-fixture-key');
  });
  it('returns every safely paginated model sorted and deduplicated', async () => {
    plan = url => new URL(url).searchParams.has('after') ? { body: '{"data":[{"id":"a"},{"id":"z"}],"has_more":false}' } : { body: '{"data":[{"id":"z"}],"has_more":true,"last_id":"z"}' };
    expect(await discoverEndpoint({ baseUrl, protectedKey: '', apiKey: 'typed-fixture-key' })).toEqual({ models: ['a', 'z'] });
    expect(requests).toHaveLength(2); expect(requests[1].options.url).toBe(`${baseUrl}/models?after=z`);
    expect(requests.every(request => request.headers.Authorization === 'Bearer typed-fixture-key')).toBe(true);
  });
  it('refuses cross-origin pagination and redirects before forwarding a credential', async () => {
    plan = () => ({ body: '{"data":[],"next":"https://other.example/v1/models?page=2"}' });
    await expect(discoverEndpoint({ baseUrl, protectedKey: '', apiKey: 'typed-fixture-key' })).rejects.toThrow('unsafe');
    expect(requests).toHaveLength(1);
    requests.length = 0; plan = () => ({ redirect: 302 });
    await expect(discoverEndpoint({ baseUrl, protectedKey: '', apiKey: 'typed-fixture-key' })).rejects.toThrow('302');
    expect(requests).toHaveLength(1); expect(requests[0].abort).toHaveBeenCalledOnce();
  });
  it('reports authorization and missing endpoint statuses without echoing response bodies', async () => {
    for (const status of [401, 404]) {
      plan = () => ({ status, body: 'typed-fixture-key' });
      await expect(discoverEndpoint({ baseUrl, protectedKey: '', apiKey: 'typed-fixture-key' })).rejects.toThrow(`HTTP ${status}`);
    }
    plan = () => ({ body: 'malformed response containing typed-fixture-key' });
    await expect(discoverEndpoint({ baseUrl, protectedKey: '', apiKey: 'typed-fixture-key' })).rejects.toThrow('did not return valid JSON');
  });
  it('rejects repeated pagination and oversized bodies instead of returning partial results', async () => {
    plan = () => ({ body: '{"data":[{"id":"same"}],"has_more":true,"last_id":"same"}' });
    await expect(discoverEndpoint({ baseUrl, protectedKey: '' })).rejects.toThrow('repeated'); expect(requests).toHaveLength(2);
    plan = () => ({ chunks: [Buffer.alloc(2 * 1024 * 1024 + 1)] });
    await expect(discoverEndpoint({ baseUrl, protectedKey: '' })).rejects.toThrow('size limit'); expect(requests.at(-1)!.abort).toHaveBeenCalledOnce();
  });
  it('aborts active requests and rejects a previously cancelled request without sending it', async () => {
    plan = () => ({ hang: true });
    const controller = new AbortController();
    const promise = discoverEndpoint({ baseUrl, protectedKey: '', apiKey: '' }, controller.signal);
    const rejected = expect(promise).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(requests).toHaveLength(1)); controller.abort(); await rejected;
    expect(requests[0].abort).toHaveBeenCalledOnce();
    await expect(discoverEndpoint({ baseUrl, protectedKey: '', apiKey: '' }, controller.signal)).rejects.toThrow('cancelled'); expect(requests).toHaveLength(1);
  });
  it('bounds the whole discovery operation including saved-key decryption', async () => {
    vi.useFakeTimers(); mocks.unprotect.mockReturnValue(new Promise(() => {}));
    const rejected = expect(discoverEndpoint({ baseUrl, protectedKey: 'protected' })).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15001); await rejected; expect(requests).toHaveLength(0);
  });
  it('refuses invalid credential headers without including the key in errors or sending a request', async () => {
    await expect(discoverEndpoint({ baseUrl, protectedKey: '', apiKey: 'fixture\nprivate' })).rejects.toThrow('printable ASCII'); expect(requests).toHaveLength(0);
  });
});
describe('explicit selected-model endpoint test', () => {
  it('tests an unsaved key and selected model without persisting or decrypting', async () => {
    plan = () => ({ body: '{"choices":[{"message":{"content":"OK"}}]}' });
    await testEndpoint({ baseUrl, model: 'chosen-model', protectedKey: 'saved-key', apiKey: 'typed-fixture-key' });
    expect(mocks.unprotect).not.toHaveBeenCalled(); expect(requests[0].headers.Authorization).toBe('Bearer typed-fixture-key');
    expect(JSON.parse(requests[0].body!)).toMatchObject({ model: 'chosen-model' });
    expect(requests[0].body).not.toContain('typed-fixture-key');
  });
});
