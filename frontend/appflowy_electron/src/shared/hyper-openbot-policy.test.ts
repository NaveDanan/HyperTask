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
it('memory slot allows memory and learning routes and refuses adjacent families', () => {
 for (const path of ['/api/memory', '/api/memory/sources/available/bot', '/api/admin/learning/settings', '/api/admin/learning/people/person/proposals/p/approve', '/api/settings/learning/review', '/api/settings/learning/proposals/p?container=space']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
 for (const path of ['/api/memory-export', '/api/admin/learning-secrets', '/api/settings/learning-other', '/api/memory/%2e%2e/credentials']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
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
  for (const path of ['/api/proactive-other', '/api/responsibilities-other', '/api/responsibilities/sources/github/%2e%2e']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('settings activity and governance share approved routes without permitting adjacent administration', () => {
  for (const path of ['/api/admin/audit-events?format=csv', '/api/v2/organizations/default/bots?hidden=true&limit=100']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  expect(hyperOpenBotPathAllowed('/api/admin/people')).toBe(true);
  for (const path of ['/api/admin/audit-secrets', '/api/admin/people-other', '/api/v2/organizations/other/bots', '/api/v2/organizations/default/secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
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

it('admin-governance permits its API families and refuses adjacent or escaped paths', () => {
  for (const path of ['/api/admin/people?search=a', '/api/admin/people/id/role', '/api/admin/enterprise/capabilities/batch', '/api/admin/identity-providers/id', '/api/auth/sso/register', '/api/admin/audit-events?format=csv', '/api/admin/what-if/check', '/api/computers/policy', '/api/computers/policy-dry-run', '/api/computers/policy-translate']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/admin/people-other', '/api/auth/sso/delete-provider', '/api/computers-other/policy', '/api/admin/identity-providers/%2e%2e/credentials', '/api/admin/what-if/../../secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('admin-governance permits identity and approval subflows without adjacent auth/admin access', () => {
  for (const path of ['/api/me', '/api/capabilities', '/api/approvals/team', '/api/approvals/team/rules/batch', '/api/approvals/team/rules/backtest', '/api/approvals/shared-use/request/approve', '/api/approvals/team/guidance/check', '/api/admin/enterprise/settings/ssoRequired', '/api/admin/enterprise/people/id/terminate-computers']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/auth/sso/providers', '/api/admin/identity', '/api/admin/what-if-other', '/api/admin/enterprise-other', '/api/me-other']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('computer-browser permits opaque cursors and nested download queries without weakening route checks', () => {
  for (const path of ['/api/recorder/recordings?cursor=a%2Fb%3Fnext%3D1', '/api/computers/bot/files/download?path=reports%2Freport.txt']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/computers%2Fbot/files/download?path=a', '/api/private?path=/api/browser', '/api/browser/%2e%2e/private?cursor=a']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('memory slot permits learning permission and recording subflows without adjacent families', () => {
 for (const path of ['/api/admin/enterprise', '/api/admin/enterprise/capabilities/translate', '/api/admin/enterprise/capabilities/preview', '/api/admin/enterprise/capabilities/batch', '/api/admin/enterprise/settings/skillSharing', '/api/recorder/recordings?cursor=next', '/api/admin/learning/status/bot', '/api/admin/learning/container', '/api/settings/learning/auto-approve']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
 for (const path of ['/api/settings/learning-other', '/api/admin/learning-other', '/api/recorder-other', '/api/admin/enterprise-other', '/api/admin/enterprise/capabilities/%2e%2e/secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('routines slot allows its API families and refuses adjacent or escaped routes', () => {
  for (const path of ['/api/routines', '/api/routines/id/runs', '/api/responsibilities/id/triggers', '/api/responsibilities/triggers/id/secret', '/api/proactive/settings?refuseExisting=true', '/api/proactive/suggestions/id/start', '/api/tasks/id/again']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/routines-extra', '/api/proactive', '/api/proactive/credentials', '/api/tasks-private', '/api/routines/../secrets', '/api/responsibilities/%2fsecrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('bot-tabs permits routine counts without adjacent route families or escaped paths', () => {
  expect(hyperOpenBotPathAllowed('/api/routines')).toBe(true);
  for (const path of ['/api/routines-other', '/api/tasks-other', '/api/proactive/suggestions-other', '/api/routines/%2e%2e/private']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
