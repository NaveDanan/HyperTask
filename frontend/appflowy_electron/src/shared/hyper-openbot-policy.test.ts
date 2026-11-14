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
