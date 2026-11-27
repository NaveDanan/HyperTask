import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HyperHubReadScope, HyperHubSetupScope } from '@shared/HyperTaskHub';
import { hyperHubHash, hyperHubInstant, HyperTaskHubStore, type HyperHubRecord } from './HyperTaskHubStore';

export const setup: HyperHubSetupScope = { jiraProjects: [{ connectionId: 'jira', projectId: 'ENG' }],
  nativeViews: [{ databaseId: 'db', viewId: 'board' }], zone: 'Asia/Jerusalem', aliases: [], workdays: [0, 1, 2, 3, 4],
  hours: { start: '09:00', end: '17:00' }, breaks: [], daysOff: [] };
export const scope: HyperHubReadScope = { accountId: 'account', workspaceId: 'workspace', connectionId: 'jira', generation: 1 };
export function disk() {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-hub-'));
  const key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test',
    encryptString(text: string) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), data]);
    },
    decryptString(data: Buffer) {
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  return { directory, encryption, open: (account = scope.accountId, workspace = scope.workspaceId) =>
    new HyperTaskHubStore(directory, account, workspace, encryption), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
export function record(mirror = false): HyperHubRecord {
  const key = mirror ? { kind: 'hypertask' as const, workspaceId: scope.workspaceId, databaseId: 'db', rowId: 'row' } :
    { kind: 'jira' as const, instanceId: 'https://jira.example/context', issueId: '123' };
  return { id: hyperHubHash(key), key, scope: { ...scope, connectionId: mirror ? 'hypertask' : 'jira' }, label: mirror ? 'Board' : 'ENG-9',
    openTarget: key.kind === 'hypertask' ? { ...key, viewId: 'board' } : key, revision: '1', observedAt: hyperHubInstant(Date.now()),
    role: mirror ? 'mirror' : 'origin', initialState: 'ready', completion: 'open', projectId: 'ENG', title: 'Private task title',
    jiraAlias: 'https://jira.example/context/browse/ENG-9' };
}
