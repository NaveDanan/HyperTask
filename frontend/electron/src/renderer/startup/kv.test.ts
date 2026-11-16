import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyValueStorage, KVKeys, loadKeyValueStorage } from './kv';

afterEach(() => vi.unstubAllGlobals());

describe('existing preferences', () => {
  it('reads and updates legacy cloud and custom data path settings', async () => {
    const set = vi.fn(async () => {});
    vi.stubGlobal('window', { hypertask: { prefs: { getAll: async () => ({ kAppFlowyCloudBaseURL: 'https://example.test', 'io.appflowy.appflowy_flutter.path_location': 'old-data' }), set } } });
    await loadKeyValueStorage();
    expect(KeyValueStorage.get(KVKeys.hypertaskCloudBaseURL)).toBe('https://example.test');
    expect(KeyValueStorage.get(KVKeys.pathLocation)).toBe('old-data');
    await KeyValueStorage.set(KVKeys.hypertaskCloudBaseURL, 'https://new.test');
    expect(set).toHaveBeenCalledWith('kAppFlowyCloudBaseURL', 'https://new.test');
  });
  it('prefers an existing HyperTask value when both versions exist', async () => {
    vi.stubGlobal('window', { hypertask: { prefs: { getAll: async () => ({ kAppFlowyCloudBaseURL: 'legacy', kHypertaskCloudBaseURL: 'current' }) } } });
    await loadKeyValueStorage();
    expect(KeyValueStorage.get(KVKeys.hypertaskCloudBaseURL)).toBe('current');
  });
});
