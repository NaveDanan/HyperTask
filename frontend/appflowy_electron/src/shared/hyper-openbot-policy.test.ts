import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('screens allows component and sandbox API families and refuses traversal', () => {
  for (const path of ['/api/components', '/api/components/functions', '/api/components/custom_x/decision', '/api/components/chart/functions/read', '/api/sandboxed', '/api/sandboxed/published', '/api/sandboxed/custom_x/publish']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/components-credentials', '/api/sandboxed-private', '/api/components/%2e%2e/secrets', '/api/sandboxed/../secrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
