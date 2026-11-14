import { beforeEach, expect, it, vi } from 'vitest';
import { hyperOpenBotRequest } from '../transport';
import { hyperChangeComputer, hyperNetworkRules, hyperSetInactiveDays, hyperSaveNetwork } from './HyperComputersApi';
import { hyperCreateCheckIn, hyperRunCheckIn, hyperResolveSuggestion } from './HyperCheckInsApi';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
beforeEach(() => vi.mocked(hyperOpenBotRequest).mockReset());
it('preserves network ports, CIDRs and ordered entries', async () => {
  const rules = hyperNetworkRules('intranet.example 8443\n10.0.0.0/8 443,5432\n*.corp.example');
  expect(rules).toEqual([{ type: 'domain', value: 'intranet.example', ports: '8443' }, { type: 'cidr', value: '10.0.0.0/8', ports: '443,5432' }, { type: 'domain', value: '*.corp.example' }]);
  const policy = { scopeKind: 'organization' as const, scopeId: '', mode: 'allowlist_only' as const, rules, locked: true };
  await hyperSaveNetwork(policy, 'test description');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/admin/enterprise/network', 'PUT', { ...policy, authoring: { source: 'english', text: 'test description' } });
});
it('targets the listed computer and shared seat, and validates idle days', async () => {
  await hyperChangeComputer({ computer: 'person:test', botId: 'seat', kind: 'person', running: true, startedAt: null }, 'reset');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/computers/fleet', 'POST', { computer: 'person:test', botId: 'seat', action: 'reset' });
  for (const value of [-1, 3651, 1.5]) expect(() => hyperSetInactiveDays(value)).toThrow();
});
it('refuses duplicate new check-ins and preserves run and resolve responses', async () => {
  const draft = { agentId: 'bot', channelId: 'channel', focus: 'watch', intervalMinutes: 60 };
  await hyperCreateCheckIn(draft);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/proactive/settings?refuseExisting=true', 'POST', draft);
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce({ queued: false, skipped: 'busy', why: 'Already running' });
  expect(await hyperRunCheckIn('id?test')).toEqual({ queued: false, skipped: 'busy', why: 'Already running' });
  await hyperResolveSuggestion('item?test', 'start');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/proactive/suggestions/item%3Ftest/start', 'POST');
});
