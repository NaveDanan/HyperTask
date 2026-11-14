import { beforeEach, expect, it, vi } from 'vitest';
import { hyperOpenBotRequest } from '../transport';
import { hyperRenameConversation, hyperReadGroup, hyperSendGroup, hyperStartGroup, hyperAddGroupMember, hyperRemoveGroupMember, hyperTeamConsent, hyperGroupPolling, type GroupConversation } from './HyperConversationsApi';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => request.mockReset());
it('uses encoded group paths and exact message/member payloads', async () => {
  await hyperReadGroup('a/b');
  expect(request).toHaveBeenLastCalledWith('/api/groups/a%2Fb');
  const message = { id: 'stable', text: 'Hello', agentId: 'bot' };
  await hyperSendGroup('group', message);
  expect(request).toHaveBeenLastCalledWith('/api/groups/group', 'POST', message);
  await hyperAddGroupMember('group', ' person@example.com ');
  expect(request).toHaveBeenLastCalledWith('/api/groups/group/members', 'POST', { email: 'person@example.com' });
  await hyperRemoveGroupMember('group', 'user/id');
  expect(request).toHaveBeenLastCalledWith('/api/groups/group/members/user%2Fid', 'DELETE');
  await hyperTeamConsent('bot/id', 'server', 'skip');
  expect(request).toHaveBeenLastCalledWith('/api/team-bots/bot%2Fid/consents', 'POST', { serverId: 'server', decision: 'skip' });
});
it('creates groups preserving recipient order and discards a failed first send', async () => {
  const failure = new Error('refused');
  request.mockResolvedValueOnce({ channel: { id: 'group' } }).mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
  await expect(hyperStartGroup(['second', 'first'], 'Hello')).rejects.toBe(failure);
  expect(request).toHaveBeenNthCalledWith(1, '/api/groups', 'POST', { agentIds: ['second', 'first'] });
  expect(request).toHaveBeenLastCalledWith('/api/channels/group?discardFailedStart=true', 'DELETE');
});
it('polls active replies and bounds awaiting-first-reply polling', () => {
  const group: GroupConversation = { bots: [], people: [], messages: [] };
  expect(hyperGroupPolling(group)).toBe(false);
  group.messages.push({ id: 'm', channelId: 'g', ownerUserId: 'u', agentId: null, text: 'Hello', status: 'completed', createdAt: new Date(1000).toISOString() });
  expect(hyperGroupPolling(group, 2000)).toBe(true);
  expect(hyperGroupPolling(group, 601001)).toBe(false);
  group.messages[0].agentId = 'bot'; group.messages[0].status = 'running';
  expect(hyperGroupPolling(group, 601001)).toBe(true);
  group.messages[0].status = 'waiting';
  expect(hyperGroupPolling(group, 601001)).toBe(false);
});

it('renames with a trimmed title and sends null to restore the server-chosen name', async () => {
  await hyperRenameConversation('channel id', '  A title  '); expect(request).toHaveBeenLastCalledWith('/api/channels/channel%20id/title', 'PUT', { title: 'A title' });
  await hyperRenameConversation('channel', '  '); expect(request).toHaveBeenLastCalledWith('/api/channels/channel/title', 'PUT', { title: null });
});
