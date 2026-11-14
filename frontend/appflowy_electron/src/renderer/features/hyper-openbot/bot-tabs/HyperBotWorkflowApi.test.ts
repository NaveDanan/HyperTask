import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { HyperBotGrantApi, HyperReachabilityApi, hyperExternalInput, hyperSaveExternalAgent, hyperTestExternalAgent } from './HyperBotWorkflowApi';
import type { HyperBotProfile } from '../bots/HyperBotsApi';
const input = { name: ' Desk ', title: '', roleDescription: ' Assist ', visibility: 'private' as const, endpoint: ' https://agent.example.test/run ', key: '', harness: 'byo-url' };
beforeEach(() => vi.resetAllMocks());
it('preserves external credentials on blank edit and omits framework on updates', async () => {
  await hyperSaveExternalAgent({ ...input, harness: 'langgraph' }, { id: 'desk', canManage: true } as HyperBotProfile);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/agents/desk', 'PATCH', { name: 'Desk', title: '', roleDescription: 'Assist', visibility: 'private', endpoint: 'https://agent.example.test/run' });
});
it('creates an external framework with only allowed profile and connection fields', () => {
  const payload = hyperExternalInput({ ...input, harness: 'langgraph', canManage: true } as typeof input, true);
  expect(payload).toEqual({ name: 'Desk', title: '', roleDescription: 'Assist', visibility: 'private', endpoint: 'https://agent.example.test/run', harness: 'langgraph' });
});
it('refuses unauthorized edits and invalid URL schemes before sending', async () => {
  expect(() => hyperSaveExternalAgent(input, { canManage: false } as HyperBotProfile)).toThrow('cannot edit');
  expect(() => hyperTestExternalAgent('file:///local', '')).toThrow('http');
  expect(hyperOpenBotRequest).not.toHaveBeenCalled();
});
it('tests unsaved endpoint authorization without retaining it in a payload object', async () => {
  const value = ['fixture', 'authorization'].join('-');
  await hyperTestExternalAgent(input.endpoint, value);
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/agents/test-connection', 'POST', { endpoint: input.endpoint.trim(), headers: { Authorization: value } });
});
it('links the exact conversation and bot to Slack or Teams', async () => {
  await HyperReachabilityApi.chat('conversation', 'desk', 'teams');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/delivery/opentag/start', 'POST', { channelId: 'conversation', agentId: 'desk', platform: 'teams' });
});
it('verifies SMS in two steps and deletes only the selected destination and device', async () => {
  await HyperReachabilityApi.sms('conversation', 'desk', '+15555550123');
  await HyperReachabilityApi.confirm('challenge', '000000');
  await HyperReachabilityApi.disconnect('binding'); await HyperReachabilityApi.removeDevice('device');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/delivery/sms/start', 'POST', { channelId: 'conversation', agentId: 'desk', phone: '+15555550123' });
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/delivery/sms/confirm', 'POST', { challengeId: 'challenge', code: '000000' });
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/delivery/bindings/binding', 'DELETE');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/delivery/devices/device', 'DELETE');
});
it('translates and replays grants without writing them, then saves explicit add/remove and authoring', async () => {
  await HyperBotGrantApi.translate('desk', 'mail', 'Read mail');
  await HyperBotGrantApi.replay('desk', 'mail', ['mail/read']);
  const change = { add: ['mail/read'], remove: ['mail/send'], authoring: { source: 'english' as const, text: 'Read mail' }, approval: { audience: 'people', outsideInput: false, members: [{ kind: 'group', value: 'support' }] } };
  await HyperBotGrantApi.save('desk', 'mail', change);
  expect(hyperOpenBotRequest).toHaveBeenNthCalledWith(1, '/api/plugins/for/desk/apps/mail/grants/translate', 'POST', { text: 'Read mail' });
  expect(hyperOpenBotRequest).toHaveBeenNthCalledWith(2, '/api/plugins/for/desk/apps/mail/grants/replay', 'POST', { grants: ['mail/read'] });
  expect(hyperOpenBotRequest).toHaveBeenNthCalledWith(3, '/api/plugins/for/desk/apps/mail/grants', 'POST', change);
});
