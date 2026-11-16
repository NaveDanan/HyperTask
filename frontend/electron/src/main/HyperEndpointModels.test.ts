import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listEndpointModels, testEndpoint } from './openai-endpoint';

const mock = vi.hoisted(() => ({ request: vi.fn(), unprotect: vi.fn() }));
vi.mock('electron', () => ({ net: { request: mock.request } }));
vi.mock('./dpapi', () => ({ unprotect: mock.unprotect }));

function respond(status: number, body: unknown) {
  const request = Object.assign(new EventEmitter(), { setHeader: vi.fn(), abort: vi.fn(), end: vi.fn() });
  request.end.mockImplementation(() => queueMicrotask(() => {
    const response = Object.assign(new EventEmitter(), { statusCode: status });
    request.emit('response', response);
    response.emit('data', Buffer.from(JSON.stringify(body)));
    response.emit('end');
  }));
  mock.request.mockReturnValueOnce(request);
  return request;
}

beforeEach(() => { vi.clearAllMocks(); mock.request.mockReset(); mock.unprotect.mockResolvedValue('test-only-key'); });
const endpoint = { baseUrl: 'https://ai.internal/prefix/v1///', protectedKey: 'encrypted-test-key' };

describe('endpoint model discovery', () => {
  it('gets every unique model ID using the exact API prefix and saved credential, without requiring a chat model', async () => {
    const request = respond(200, { data: [{ id: 'claude-haiku-5-5' }, { id: 'embed-v1' }, { id: 'image-v1' }, { id: 'claude-haiku-5-5' }, { id: '' }, {}] });
    expect(await listEndpointModels(endpoint)).toEqual(['claude-haiku-5-5', 'embed-v1', 'image-v1']);
    expect(mock.request).toHaveBeenCalledWith({ method: 'GET', url: 'https://ai.internal/prefix/v1/models', redirect: 'manual' });
    expect(mock.unprotect).toHaveBeenCalledWith(endpoint.protectedKey);
    expect(request.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-only-key');
    expect(request.end).toHaveBeenCalledWith(undefined);
  });
  it('supports keyless endpoints', async () => {
    mock.unprotect.mockResolvedValue('');
    const request = respond(200, { data: [] });
    expect(await listEndpointModels({ ...endpoint, protectedKey: '' })).toEqual([]);
    expect(request.setHeader).not.toHaveBeenCalledWith('Authorization', expect.anything());
  });
  it('does not expose provider error bodies or follow redirects', async () => {
    respond(401, { error: 'private-provider-details' });
    await expect(listEndpointModels(endpoint)).rejects.toThrow('HTTP 401');
    const request = Object.assign(new EventEmitter(), { setHeader: vi.fn(), abort: vi.fn(), end: vi.fn() });
    request.end.mockImplementation(() => queueMicrotask(() => request.emit('redirect', 302)));
    mock.request.mockReturnValueOnce(request);
    await expect(listEndpointModels(endpoint)).rejects.toThrow('HTTP 302');
    expect(request.abort).toHaveBeenCalledOnce();
  });
  it('validates the URL before decrypting or sending credentials', async () => {
    for (const baseUrl of ['https://hypertask.com/v1', 'https://user:password@ai.internal/v1', 'https://ai.internal/v1?key=x']) {
      await expect(listEndpointModels({ ...endpoint, baseUrl })).rejects.toThrow();
    }
    expect(mock.unprotect).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('rejects malformed catalogues and reports network failures', async () => {
    respond(200, { models: ['wrong-shape'] });
    await expect(listEndpointModels(endpoint)).rejects.toThrow('model list');
    const request = Object.assign(new EventEmitter(), { setHeader: vi.fn(), abort: vi.fn(), end: vi.fn() });
    request.end.mockImplementation(() => queueMicrotask(() => request.emit('error', new Error('private-details'))));
    mock.request.mockReturnValueOnce(request);
    await expect(listEndpointModels(endpoint)).rejects.toThrow('Cannot reach the endpoint');
  });
  it('keeps the completion test on POST with the selected model', async () => {
    const request = respond(200, { choices: [{ message: { content: 'OK' } }] });
    await testEndpoint({ ...endpoint, model: 'claude-haiku-5-5' });
    expect(mock.request).toHaveBeenCalledWith({ method: 'POST', url: 'https://ai.internal/prefix/v1/chat/completions', redirect: 'manual' });
    expect(JSON.parse(request.end.mock.calls[0][0])).toMatchObject({ model: 'claude-haiku-5-5', stream: false });
  });
});
  it('uses Responses when the gateway rejects Chat Completions input translation', async () => {
    respond(400, { error: { code: 'invalid_request_body', message: "Invalid type for 'input': expected a string, but got an object instead." } });
    const request = respond(200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] });
    await testEndpoint({ ...endpoint, model: 'gpt-6.1-sol' });
    expect(mock.request).toHaveBeenLastCalledWith({ method: 'POST', url: 'https://ai.internal/prefix/v1/responses', redirect: 'manual' });
    expect(JSON.parse(request.end.mock.calls[0][0])).toMatchObject({ model: 'gpt-6.1-sol', stream: false, input: [{ role: 'user', content: 'Reply with OK.' }] });
  });

  it('does not retry unrelated model or credential errors through another API', async () => {
    respond(400, { error: { code: 'model_not_found', message: 'Unknown model' } });
    await expect(testEndpoint({ ...endpoint, model: 'missing' })).rejects.toThrow('HTTP 400');
    expect(mock.request).toHaveBeenCalledOnce();
  });
