import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('bot-tabs permits team publication and rejects unrelated and traversal paths', () => {
  expect(hyperOpenBotPathAllowed('/api/team-bots')).toBe(true);
  expect(hyperOpenBotPathAllowed('/api/team-bots/desk/publication')).toBe(true);
  expect(hyperOpenBotPathAllowed('/api/team-bots/../secrets')).toBe(false);
  expect(hyperOpenBotPathAllowed('/api/team-bots/%2e%2e/secrets')).toBe(false);
  expect(hyperOpenBotPathAllowed('/api/unrelated-family')).toBe(false);
});
it('bot-tabs permits delivery and current-user reads without permitting auth or traversal', () => {
  for (const path of ['/api/me', '/api/delivery', '/api/delivery/opentag/start', '/api/delivery/sms/confirm', '/api/delivery/bindings/id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/auth/me', '/api/delivery/../private', '/api/me/%2e%2e/private']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('bot-tabs allows attention tasks and findings and refuses traversal and unrelated admin routes', () => {
  for (const path of ['/api/bots/attention', '/api/tasks', '/api/tasks/task/again', '/api/proactive/suggestions', '/api/proactive/suggestions/item/start']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/tasks/../secrets', '/api/proactive/%2e%2e/secrets', '/api/admin/arbitrary']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
