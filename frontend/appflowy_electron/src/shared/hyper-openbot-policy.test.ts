import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('admin-platform allows credential contracts and rejects unrelated admin families and traversal', () => {
  for (const path of ['/api/admin/credentials', '/api/admin/credentials/id/revoke', '/api/models/available', '/api/plugins/servers/id/refresh']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/admin/users', '/api/admin/credentials-other', '/api/admin/credentials/../users', '/api/admin/credentials/%2e%2e/users']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('admin-platform check-in contracts allow only the enterprise paths used here', () => {
  for (const path of ['/api/admin/proactive?days=7', '/api/admin/enterprise', '/api/admin/enterprise/capabilities', '/api/admin/enterprise/settings/proactiveDailyRuns']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/admin/proactive-other', '/api/admin/enterprise/people', '/api/admin/enterprise/settings/other', '/api/admin/enterprise/capabilities/other']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
