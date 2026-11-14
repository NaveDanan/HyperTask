import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('vault allows only its verified API families and refuses traversal', () => {
  for (const path of ['/api/passwords', '/api/passwords/id', '/api/sign-in-requests/id/submit', '/api/admin/credentials', '/api/admin/credentials/id/revoke']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/admin/users', '/api/vault', '/api/passwords/../secrets', '/api/passwords/%2e%2e/secrets', '/api/admin/credentials-other']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('onboarding allows its server families and refuses unrelated or escaped paths', () => {
  for (const path of ['/api/me', '/api/me/profile', '/api/me/onboarding', '/api/setup', '/api/setup/check']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/me/../auth', '/api/setup/%2e%2e/secrets', '/api/setup-other', '/api/auth/sign-in', '/api/unowned']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('onboarding starter preferences allows only its preference path family', () => {
  expect(hyperOpenBotPathAllowed('/api/settings/preferences')).toBe(true);
  for (const path of ['/api/settings/providers', '/api/settings/preferences-other', '/api/settings/preferences/%2e%2e/secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('onboarding routing allows only its route family', () => {
  expect(hyperOpenBotPathAllowed('/api/route')).toBe(true);
  expect(hyperOpenBotPathAllowed('/api/route-other')).toBe(false);
  expect(hyperOpenBotPathAllowed('/api/route/%2e%2e/auth')).toBe(false);
});

it('settings permits settings and profile routes and refuses unrelated routes and traversal', () => {
  for (const path of ['/api/settings/instructions', '/api/settings/preferences', '/api/me', '/api/me/profile']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/settings/../admin/secrets', '/api/settings/%2e%2e/me', '/api/settings/%252e%252e/me', '/api/unknown-settings', '/api/admin/settings']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('settings automation permits only the requested nested families', () => {
  for (const path of ['/api/proactive/settings', '/api/responsibilities/sources/github', '/api/responsibilities/sources/github/id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/proactive/suggestions', '/api/responsibilities', '/api/responsibilities/sources/slack', '/api/responsibilities/sources/github-evil', '/api/responsibilities/sources/github/%2e%2e']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('settings activity allows its audit and bot-list families and refuses other administration', () => {
  for (const path of ['/api/admin/audit-events?format=csv', '/api/v2/organizations/default/bots?hidden=true&limit=100']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/admin/audit-secrets', '/api/admin/people', '/api/v2/organizations/other/bots', '/api/v2/organizations/default/secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
