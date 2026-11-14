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
