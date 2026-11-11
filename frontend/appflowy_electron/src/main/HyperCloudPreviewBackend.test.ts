import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { UserProfilePBSchema } from '../shared/protobuf/flowy-user/user_profile_pb';
import { WorkspaceLatestPBSchema } from '../shared/protobuf/flowy-folder/workspace_pb';
import { createHyperCloudPreviewBackend } from './HyperCloudPreviewBackend';

function fixture() {
  let actor = 7n, workspace = 'workspace-A', revision = 0;
  const request = vi.fn(async (event: string) => ({ status: 0, payload: event === 'GetUserProfile'
    ? toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: actor, email: 'private-account@example.test' }))
    : toBinary(WorkspaceLatestPBSchema, create(WorkspaceLatestPBSchema, { workspaceId: workspace })) }));
  const backend = createHyperCloudPreviewBackend({ request }, () => ({ root: '/active/storage', server: 'https://private.example', revision }), async () => {});
  return { request, backend, change: (next: { actor?: bigint; workspace?: string; revision?: number }) => { actor = next.actor ?? actor; workspace = next.workspace ?? workspace; revision = next.revision ?? revision; } };
}
describe('Hyper native image identity adapter', () => {
  it('returns only identity and storage scope after verifying both native identities twice', async () => {
    const f = fixture();
    expect(await f.backend.context()).toEqual({ root: '/active/storage', server: 'https://private.example', revision: 0, actorId: '7', workspaceId: 'workspace-A' });
    expect(f.request.mock.calls.map(call => call[0])).toEqual(['GetUserProfile', 'GetCurrentWorkspaceSetting', 'GetUserProfile', 'GetCurrentWorkspaceSetting']);
  });
  it('stops before another read when an owner mutation starts during a reply', async () => {
    const f = fixture();
    f.request.mockImplementationOnce(async () => { f.change({ revision: 1 }); return { status: 0, payload: toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: 7n })) }; });
    await expect(f.backend.context()).rejects.toThrow('workspace or account changed'); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('rejects native account replacement even when the renderer did not send an owner event', async () => {
    const f = fixture();
    f.request.mockImplementationOnce(async () => { f.change({ actor: 8n }); return { status: 0, payload: toBinary(UserProfilePBSchema, create(UserProfilePBSchema, { id: 7n })) }; });
    await expect(f.backend.context()).rejects.toThrow('workspace or account changed');
  });
});
