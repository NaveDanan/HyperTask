import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { UserProfilePBSchema } from '../shared/protobuf/flowy-user/user_profile_pb';
import { WorkspaceLatestPBSchema } from '../shared/protobuf/flowy-folder/workspace_pb';
import { createHyperBookmarkBackend } from './HyperBookmarkBackend';
import { HyperBookmarkMetadata } from './HyperBookmarkMetadata';
const profile = () => ({ status: 0, payload: toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: 9n })) });
const workspace = () => ({ status: 0, payload: toBinary(WorkspaceLatestPBSchema, create(WorkspaceLatestPBSchema, { workspaceId: 'workspace' })) });
describe('Hyper native bookmark ownership', () => {
  it('derives identity from fresh typed native profile and workspace replies', async () => {
    const request = vi.fn(async (event: string) => event === 'GetUserProfile' ? profile() : workspace()), backend = createHyperBookmarkBackend({ request }, () => 0);
    expect(await backend.identity()).toEqual({ actorId: '9', workspaceId: 'workspace' }); expect(request.mock.calls.map(call => call[0])).toEqual(['GetUserProfile', 'GetCurrentWorkspaceSetting']);
  });
  it('stops before workspace lookup when the native context changes during a profile read', async () => {
    let revision = 0; const request = vi.fn(async () => { revision++; return profile(); }), backend = createHyperBookmarkBackend({ request }, () => revision);
    await expect(backend.identity()).rejects.toThrow('account'); expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not expose failed native status payloads', async () => {
    const backend = createHyperBookmarkBackend({ request: async () => ({ status: 1, payload: new TextEncoder().encode('secret auth and storage path') }) }, () => 0);
    await expect(backend.identity()).rejects.toThrow('verified'); await expect(backend.identity()).rejects.not.toThrow('secret');
  });
  it('bounds a stalled native identity check under the same total deadline', async () => {
    vi.useFakeTimers();
    try {
      const instance = new HyperBookmarkMetadata({ revision: () => 0, identity: () => new Promise(() => {}) }), pending = instance.loadUrl('https://example.com', { actorId: '9', workspaceId: 'workspace' });
      const assertion = expect(pending).rejects.toThrow('timed out'); await vi.advanceTimersByTimeAsync(8000); await assertion;
    } finally { vi.useRealTimers(); }
  });
});
