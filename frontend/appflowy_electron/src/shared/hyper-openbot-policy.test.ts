import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
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
