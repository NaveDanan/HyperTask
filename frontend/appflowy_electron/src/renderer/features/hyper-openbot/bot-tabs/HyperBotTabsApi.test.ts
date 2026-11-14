import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { HyperBotTabsApi as api } from './HyperBotTabsApi';
beforeEach(() => vi.resetAllMocks());
it('bot-tabs reads server app states without deriving permissions', async () => {
  const apps = [{ key: 'mail', state: 'shared_not_approved' }];
  vi.mocked(hyperOpenBotRequest).mockResolvedValue({ apps });
  expect(await api.apps('desk')).toEqual(apps);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/for/desk/apps');
});
it('bot-tabs gives and takes back apps through owner grant endpoints', async () => {
  await api.give('desk', 'mail'); await api.give('desk', 'mail', true);
  expect(hyperOpenBotRequest).toHaveBeenNthCalledWith(1, '/api/plugins/for/desk/apps/mail/give', 'POST');
  expect(hyperOpenBotRequest).toHaveBeenNthCalledWith(2, '/api/plugins/for/desk/apps/mail/give', 'DELETE');
});
it('bot-tabs files and withdraws app access requests', async () => {
  await api.request('desk', 'mail'); await api.cancelRequest('r1');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/access-requests', 'POST', { agentId: 'desk', app: 'mail' });
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/access-requests/r1', 'DELETE');
});
it('bot-tabs publishes exact audience payloads and clears unused people', async () => {
  await api.publish('desk', 'team', ['unused'], ['unused']);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/team-bots/desk/publication', 'PUT', { audience: 'team', emails: [], groups: [] });
  await api.publish('desk', 'people', ['a@example.test'], ['engineering']);
  expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/team-bots/desk/publication', 'PUT', { audience: 'people', emails: ['a@example.test'], groups: ['engineering'] });
  await api.unpublish('desk');
  expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/team-bots/desk/publication', 'DELETE');
});
