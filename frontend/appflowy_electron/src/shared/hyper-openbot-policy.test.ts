import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('conversations allows group and Team Bot contracts and refuses escapes', () => {
  for (const path of ['/api/groups', '/api/groups/id/members/person', '/api/team-bots/id/consents', '/api/me']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/groups/../secrets', '/api/groups/%2e%2e/secrets', '/api/group', '/api/team-bots-other', '/api/secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('conversations questions permits approval contracts and refuses sibling families', () => {
  for (const path of ['/api/approvals', '/api/approvals/questions/q/respond', '/api/approvals/questions/q/dismiss']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/approvals-other', '/api/approvals/../secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('conversations delivery and audio permits called families and refuses escapes', () => {
  for (const path of ['/api/delivery', '/api/delivery/opentag/start', '/api/delivery/sms/start', '/api/delivery/sms/confirm', '/api/delivery/bindings/id', '/api/delivery/devices/id', '/api/audio/transcriptions', '/api/voice/config', '/api/voice/calls', '/api/voice/sessions']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/delivery-other', '/api/audio/../secret', '/api/voice-other']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
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

it('approvals-inbox allows its contracts and refuses traversal and unrelated families', () => {
  for (const path of ['/api/approvals', '/api/approvals/rules/one', '/api/bots/routing/decision', '/api/delivery', '/api/delivery/devices/one']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/delivery/../secrets', '/api/delivery/%2e%2e/secrets', '/api/unowned-inbox', '/api/delivery\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('approvals-inbox and conversation consent routes remain confined to the approved Team Bot family', () => {
  expect(hyperOpenBotPathAllowed('/api/team-bots/consents')).toBe(true);
  expect(hyperOpenBotPathAllowed('/api/team-bots/bot/consents')).toBe(true);
  for (const path of ['/api/team-bots-other', '/api/team-bots/../secrets', '/api/team-bots/%2e%2e/secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('computer-browser allows its verified families and refuses foreign and traversal routes', () => {
  for (const path of ['/api/browser', '/api/browser/tabs', '/api/computers/bot/control/take', '/api/recorder/connections/id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/browser/../private', '/api/computers/%2e%2e/private', '/api/recorder/%252e%252e/private', '/api/unknown-family']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('computer-browser folder access permits its API and rejects traversal and foreign protocols', () => {
  for (const path of ['/api/host-access', '/api/host-access/grants', '/api/host-access/grants/folder-id', '/api/host-access/stop', '/api/computers/a/files/download?path=report.txt', '/api/browser/narration']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/host-access/%2fprivate', '/api/host-access/../private', 'file:///api/host-access', '/api/host-access\\private']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
