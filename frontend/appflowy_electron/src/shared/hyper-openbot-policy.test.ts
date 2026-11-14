import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('approvals-inbox allows its contracts and refuses traversal and unrelated families', () => {
  for (const path of ['/api/approvals', '/api/approvals/rules/one', '/api/bots/routing/decision', '/api/delivery', '/api/delivery/devices/one']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/delivery/../secrets', '/api/delivery/%2e%2e/secrets', '/api/unowned-inbox', '/api/delivery\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('approvals-inbox restricts shared consent reset to its exact path', () => {
  expect(hyperOpenBotPathAllowed('/api/team-bots/consents')).toBe(true);
  for (const path of ['/api/team-bots', '/api/team-bots/other/consents', '/api/team-bots/consents/other']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
