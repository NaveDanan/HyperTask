import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('settings permits settings and profile routes and refuses unrelated routes and traversal', () => {
  for (const path of ['/api/settings/instructions', '/api/settings/preferences', '/api/me', '/api/me/profile']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/settings/../admin/secrets', '/api/settings/%2e%2e/me', '/api/settings/%252e%252e/me', '/api/unknown-settings', '/api/admin/settings']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('settings automation permits only the requested nested families', () => {
  for (const path of ['/api/proactive/settings', '/api/responsibilities/sources/github', '/api/responsibilities/sources/github/id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/proactive/suggestions', '/api/responsibilities', '/api/responsibilities/sources/slack', '/api/responsibilities/sources/github-evil', '/api/responsibilities/sources/github/%2e%2e']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
