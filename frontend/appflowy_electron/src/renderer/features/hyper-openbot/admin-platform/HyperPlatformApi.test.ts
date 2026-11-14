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

import { hyperLoadCheckInMetrics, hyperSetCheckInLimit, hyperSetCheckIns } from './HyperProactiveApi';
it('uses upstream proactive metrics and organization control payloads', async () => {
  await hyperLoadCheckInMetrics(30);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/admin/proactive?days=30');
  await hyperSetCheckIns(false);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/admin/enterprise/capabilities', 'PUT', { scopeKind: 'organization', scopeId: '', capability: 'proactive', allowed: false });
});
it('validates the daily limit before transport', async () => {
  for (const value of [0, 1441, 1.5, NaN]) expect(() => hyperSetCheckInLimit(value)).toThrow();
  expect(hyperOpenBotRequest).not.toHaveBeenCalled();
  await hyperSetCheckInLimit(24);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/admin/enterprise/settings/proactiveDailyRuns', 'PUT', { value: 24 });
});
