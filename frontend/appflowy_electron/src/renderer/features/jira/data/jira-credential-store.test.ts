import { afterEach, expect, it, vi } from 'vitest';
import { HyperJiraCredentialStore } from './jira-credential-store';
import { JiraCredentials } from './models/jira-config';
import { jiraCredentialAccountId } from './jira-repository';
import { testConfig, testToken } from '../test-utils';
afterEach(() => vi.unstubAllGlobals());
it('passes exact Dart account id and explicit secret DTO through platform IPC', async () => {
  const id = jiraCredentialAccountId('1', testConfig), readCredentials = vi.fn(async () => ({ ok: true, value: { username: 'u', secret: testToken } })),
    writeCredentials = vi.fn(async () => ({ ok: true, value: undefined })), deleteCredentials = vi.fn(async () => ({ ok: true, value: undefined }));
  vi.stubGlobal('window', { appflowy: { jira: { readCredentials, writeCredentials, deleteCredentials, isPersistent: async () => true } } });
  const store = new HyperJiraCredentialStore(); expect(await store.isPersistent()).toBe(true);
  expect((await store.read(id))?.secret).toBe(testToken); await store.write(id, new JiraCredentials({ secret: testToken, username: 'u' })); await store.delete(id);
  expect(readCredentials).toHaveBeenCalledWith('1|https://jira.example.com|DEMO|personalAccessToken|');
  expect(writeCredentials).toHaveBeenCalledWith(id, { username: 'u', secret: testToken }); expect(deleteCredentials).toHaveBeenCalledWith(id);
});
it('format errors require reentry; storage errors are typed and never echo IPC text', async () => {
  const readCredentials = vi.fn().mockResolvedValueOnce({ ok: false, kind: 'format', message: testToken }).mockResolvedValueOnce({ ok: false, kind: 'state', message: testToken });
  vi.stubGlobal('window', { appflowy: { jira: { readCredentials } } });
  const store = new HyperJiraCredentialStore(); expect(await store.read('id')).toBeNull();
  await expect(store.read('id')).rejects.toMatchObject({ kind: 'server', message: expect.not.stringContaining(testToken) });
});
