import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});

it('routines slot allows its API families and refuses adjacent or escaped routes', () => {
  for (const path of ['/api/routines', '/api/routines/id/runs', '/api/responsibilities/id/triggers', '/api/responsibilities/triggers/id/secret', '/api/proactive/settings?refuseExisting=true', '/api/proactive/suggestions/id/start', '/api/tasks/id/again']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/routines-extra', '/api/proactive', '/api/proactive/credentials', '/api/tasks-private', '/api/routines/../secrets', '/api/responsibilities/%2fsecrets']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
