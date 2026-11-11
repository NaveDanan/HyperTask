import { fromBinary } from '@bufbuild/protobuf';
import { UserProfilePBSchema } from '../shared/protobuf/flowy-user/user_profile_pb';
import { WorkspaceLatestPBSchema } from '../shared/protobuf/flowy-folder/workspace_pb';
import type { CoreProcess } from './core/process';
import type { HyperBookmarkRuntime } from './HyperBookmarkMetadata';
export function createHyperBookmarkBackend(core: Pick<CoreProcess, 'request'>, revision: () => number): HyperBookmarkRuntime {
  return {
    revision,
    async identity() {
      const captured = revision(), user = await core.request('GetUserProfile', new Uint8Array());
      if (captured !== revision() || user.status !== 0) throw Error('The active account could not be verified.');
      const workspace = await core.request('GetCurrentWorkspaceSetting', new Uint8Array());
      if (captured !== revision() || workspace.status !== 0) throw Error('The active workspace could not be verified.');
      return { actorId: String(fromBinary(UserProfilePBSchema, user.payload).id), workspaceId: fromBinary(WorkspaceLatestPBSchema, workspace.payload).workspaceId };
    },
  };
}
