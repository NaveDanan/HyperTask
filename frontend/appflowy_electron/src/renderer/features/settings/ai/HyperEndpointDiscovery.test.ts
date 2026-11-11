import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHyperEndpointDiscovery, type HyperEndpointDiscoveryInput } from './HyperEndpointDiscovery';
import { SettingsError } from './openai-endpoint-settings';

const endpoint = (changes: Partial<HyperEndpointDiscoveryInput> = {}): HyperEndpointDiscoveryInput => ({ baseUrl: 'http://localhost:8000/v1', protectedKey: '', ...changes });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());
describe('automatic endpoint discovery', () => {
  it('debounces typing and uses only the latest URL and unsaved key', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => ({ models: ['beta', 'alpha', 'alpha'] }));
    const store = createHyperEndpointDiscovery(request); const stop = store.start();
    store.update(endpoint({ apiKey: 'first' })); await vi.advanceTimersByTimeAsync(400);
    store.update(endpoint({ baseUrl: 'http://localhost:9000/v1', apiKey: 'latest-secret' })); await vi.advanceTimersByTimeAsync(649);
    expect(request).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledExactlyOnceWith(endpoint({ baseUrl: 'http://localhost:9000/v1', apiKey: 'latest-secret' }));
    expect(store.getState().models).toEqual(['alpha', 'beta']);
    expect(JSON.stringify(store.getState())).not.toContain('latest-secret'); stop();
  });
  it('ignores a slow result after the endpoint or key changes', async () => {
    vi.useFakeTimers(); const slow = deferred<{ models: string[] }>();
    const request = vi.fn().mockImplementationOnce(() => slow.promise).mockResolvedValueOnce({ models: ['current'] });
    const store = createHyperEndpointDiscovery(request); const stop = store.start();
    store.update(endpoint()); await vi.advanceTimersByTimeAsync(650);
    store.update(endpoint({ apiKey: 'new' })); expect(store.getState().models).toEqual([]);
    await vi.advanceTimersByTimeAsync(650); slow.resolve({ models: ['obsolete'] }); await Promise.resolve();
    expect(store.getState()).toMatchObject({ status: 'ready', models: ['current'] }); stop();
  });
  it('does not send malformed, credential-bearing or prohibited URLs', async () => {
    vi.useFakeTimers(); const request = vi.fn(async () => ({ models: [] }));
    const store = createHyperEndpointDiscovery(request); const stop = store.start();
    for (const baseUrl of ['javascript:bad', 'https://user:password@host/v1', 'https://appflowy.cloud/v1']) {
      store.update(endpoint({ baseUrl })); await vi.advanceTimersByTimeAsync(650);
      expect(store.getState().status).toBe('error');
    }
    expect(request).not.toHaveBeenCalled();
    store.update(endpoint({ baseUrl: '' })); expect(store.getState()).toEqual({ status: 'idle', models: [], error: null }); stop();
  });
  it('retries immediately on Refresh, preserves a full list and reports HTTP failure', async () => {
    vi.useFakeTimers(); const ids = Array.from({ length: 1500 }, (_, i) => `model-${i}`);
    const request = vi.fn().mockResolvedValueOnce({ models: ids }).mockRejectedValueOnce(new SettingsError('Endpoint returned HTTP 401.', 'state'));
    const store = createHyperEndpointDiscovery(request); const stop = store.start();
    store.update(endpoint()); store.refresh(); await Promise.resolve(); await Promise.resolve();
    expect(store.getState().models).toHaveLength(ids.length);
    await vi.advanceTimersByTimeAsync(650); expect(request).toHaveBeenCalledOnce();
    store.refresh(); await Promise.resolve(); await Promise.resolve();
    expect(store.getState()).toEqual({ status: 'error', models: [], error: 'Endpoint returned HTTP 401.' }); stop();
  });
  it('handles empty results and unchanged input without repeated network calls', async () => {
    vi.useFakeTimers(); const request = vi.fn(async () => ({ models: [] }));
    const store = createHyperEndpointDiscovery(request); const stop = store.start();
    store.update(endpoint()); await vi.advanceTimersByTimeAsync(650);
    expect(store.getState()).toEqual({ status: 'ready', models: [], error: null });
    store.update(endpoint({ baseUrl: ' http://localhost:8000/v1 ' })); await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledOnce(); stop();
  });
  it('cancels pending work and rejects late replies after closing or reopening settings', async () => {
    vi.useFakeTimers(); const slow = deferred<{ models: string[] }>(); const request = vi.fn(() => slow.promise);
    const store = createHyperEndpointDiscovery(request); let stop = store.start();
    store.update(endpoint()); stop(); await vi.advanceTimersByTimeAsync(1000); expect(request).not.toHaveBeenCalled();
    stop = store.start(); store.update(endpoint()); await vi.advanceTimersByTimeAsync(650); stop();
    stop = store.start(); store.update(endpoint({ baseUrl: '' })); slow.resolve({ models: ['stale'] }); await Promise.resolve();
    expect(store.getState()).toEqual({ status: 'idle', models: [], error: null }); stop();
  });
});
