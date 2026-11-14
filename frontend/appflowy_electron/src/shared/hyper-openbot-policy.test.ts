import { expect, it } from 'vitest';
import { hyperOpenBotPathAllowed } from './hyper-openbot-policy';
it('restricts requests to original OpenBot routes on the fixed tunnel', () => {
  for (const path of ['/api/channels', '/api/copilotkit/agent/run', '/api/channels/id/attachments', '/api/approvals?thread=id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['http://evil/api/channels', '//evil/api/channels', '/api/channels/../credentials', '/api/channels/%2e%2e/credentials', '/api/channels/%252e%252e/credentials', '/api/jira', '/api/channels\\..\\secret']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('computer-browser allows its verified families and refuses foreign and traversal routes', () => {
  for (const path of ['/api/browser', '/api/browser/tabs', '/api/computers/bot/control/take', '/api/recorder/connections/id']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/browser/../private', '/api/computers/%2e%2e/private', '/api/recorder/%252e%252e/private', '/api/unknown-family']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
it('computer-browser folder access permits its API and rejects traversal and foreign protocols', () => {
  for (const path of ['/api/host-access', '/api/host-access/grants', '/api/host-access/grants/folder-id', '/api/host-access/stop', '/api/computers/a/files/download?path=report.txt', '/api/browser/narration']) expect(hyperOpenBotPathAllowed(path)).toBe(true);
  for (const path of ['/api/host-access/%2fprivate', '/api/host-access/../private', 'file:///api/host-access', '/api/host-access\\private']) expect(hyperOpenBotPathAllowed(path)).toBe(false);
});
