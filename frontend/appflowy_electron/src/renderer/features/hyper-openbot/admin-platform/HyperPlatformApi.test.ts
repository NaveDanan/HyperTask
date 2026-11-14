import { beforeEach, expect, it, vi } from 'vitest';
import { hyperOpenBotRequest } from '../transport';
import { hyperCreateCredential, hyperLoadCredentials, hyperLoadProvider, hyperRevokeCredential } from './HyperPlatformApi';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it('uses authoritative credential and provider reads', async () => {
  await hyperLoadCredentials(); await hyperLoadProvider();
  expect(hyperOpenBotRequest).toHaveBeenNthCalledWith(1, '/api/admin/credentials');
  expect(hyperOpenBotRequest).toHaveBeenNthCalledWith(2, '/api/models/available');
});
it('leaves model key naming to the server', async () => {
  await hyperCreateCredential({ kind: 'model', provider: 'openai', keyId: 'ignored', plaintext: 'synthetic-value' });
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/admin/credentials', 'POST', { kind: 'model', provider: 'openai', plaintext: 'synthetic-value', metadata: {} });
});
it('validates connector key ID and encodes revoke IDs', async () => {
  expect(() => hyperCreateCredential({ kind: 'connector', provider: 'test', keyId: '', plaintext: 'synthetic-value' })).toThrow('required');
  expect(hyperOpenBotRequest).not.toHaveBeenCalled();
  await hyperRevokeCredential('key?test');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/admin/credentials/key%3Ftest/revoke', 'POST');
});
