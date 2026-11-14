import { beforeEach, expect, it, vi } from 'vitest';
import { hyperOpenBotRequest } from '../transport';
import { hyperConnectFields, hyperPreviewMode, hyperCommitMode, hyperPluginGrant, hyperAccountDefault, hyperBrowseApps } from './HyperPluginDetailsApi';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
beforeEach(() => vi.mocked(hyperOpenBotRequest).mockReset());
it('previews account switching before committing explicit approvals', async () => {
  await hyperPreviewMode('app?test', 'shared');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/servers/app%3Ftest/account-mode', 'PUT', { mode: 'shared', confirm: false });
  const exposure = { audience: 'owner' as const, outsideInput: false, members: [] };
  await hyperCommitMode('app', { mode: 'shared', wouldRevoke: { holder: 'person', count: 2 }, bots: [{ botId: 'bot', exposure }] });
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/servers/app/account-mode', 'PUT', { mode: 'shared', confirm: true, approvals: { bot: exposure } });
});
it('erases secret copies after successful and refused field submissions', async () => {
  const values = { key: 'synthetic-test-value' };
  await hyperConnectFields('app', values);
  expect(values).toEqual({});
  vi.mocked(hyperOpenBotRequest).mockRejectedValueOnce(new Error('refused'));
  const refused = { key: 'synthetic-refusal-value' };
  await expect(hyperConnectFields('app', refused)).rejects.toThrow();
  expect(refused).toEqual({});
});
it('uses encoded grant, account and shared broker directory contracts', async () => {
  await hyperPluginGrant('app/read', 'bot?test', false);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/grants?kind=mcp&ref=app%2Fread&agentId=bot%3Ftest', 'DELETE');
  await hyperAccountDefault('app', 'account?test');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/servers/app/accounts/account%3Ftest/default', 'POST');
  await hyperBrowseApps('mail & calendar');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/composio/apps?q=mail%20%26%20calendar');
});

import { hyperConnectionSelectionFromPath } from './HyperPluginDetailsApi';
it('maps nested destinations without retaining provider callback query data', () => {
  expect(hyperConnectionSelectionFromPath('/admin/plugins/slack/tools/read?code=synthetic')).toEqual({ page: 'tool', key: 'slack', tool: 'read' });
  expect(hyperConnectionSelectionFromPath('/connections/slack/bots/bot')).toEqual({ page: 'bot', key: 'slack', agentId: 'bot' });
  expect(hyperConnectionSelectionFromPath('/connections/browse/arcade')).toEqual({ page: 'browse', provider: 'arcade' });
  expect(hyperConnectionSelectionFromPath('/connections/%invalid')).toBeUndefined();
});

import { hyperRequestAppAccess, hyperGiveApp, hyperDecideAppRequest } from './HyperAppAccessApi';
it('preserves app access request, owner grant and selected approval contracts', async () => {
  await hyperRequestAppAccess('bot', 'app');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/access-requests', 'POST', { agentId: 'bot', app: 'app' });
  await hyperGiveApp('bot?x', 'app', false);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/for/bot%3Fx/apps/app/give', 'DELETE');
  await hyperDecideAppRequest('request?x', 'approve', ['app/read']);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/plugins/access-requests/request%3Fx/approve', 'POST', { refs: ['app/read'] });
});
