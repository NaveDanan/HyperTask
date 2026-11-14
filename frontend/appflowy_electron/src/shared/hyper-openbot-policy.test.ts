import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('admin-governance permits its API families and refuses adjacent or escaped paths', () => {
  for (const path of ['/api/admin/people?search=a', '/api/admin/people/id/role', '/api/admin/enterprise/capabilities/batch', '/api/admin/identity-providers/id', '/api/auth/sso/register', '/api/admin/audit-events?format=csv', '/api/admin/what-if/check', '/api/computers/policy', '/api/computers/policy-dry-run', '/api/computers/policy-translate']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/admin/people-other', '/api/auth/sso/delete-provider', '/api/computers/policy-other', '/api/admin/identity-providers/%2e%2e/credentials', '/api/admin/what-if/../../secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
