import { fromBinary, type DescMessage } from '@bufbuild/protobuf';
import { UserProfilePBSchema } from '../shared/protobuf/flowy-user/user_profile_pb';
import { WorkspaceLatestPBSchema } from '../shared/protobuf/flowy-folder/workspace_pb';
import type { CoreProcess } from './core/process';
import type { HyperCloudPreviewBackend } from './HyperCloudPreviews';

interface Runtime { root: string | null; server: string | null; revision: number }
const ownerEvents = new Set([
  'InitUser', 'SignInWithEmailPassword', 'SignUp', 'SignOut', 'OauthSignIn',
  'MagicLinkSignIn', 'PasscodeSignIn', 'OpenWorkspace', 'OpenAnonUser',
  'SetCloudConfig', 'CreateWorkspace', 'DeleteWorkspace', 'LeaveWorkspace',
  'DeleteAccount', 'ImportAppFlowyDataFolder', 'RemoveWorkspaceMember', 'UpdateWorkspaceMember',
]);
export const hyperIsAssetOwnerMutation = (event: string): boolean => ownerEvents.has(event);

/** Reads identity directly from the native process. Renderer-supplied IDs only
 * constrain that identity; they can never choose credentials or storage roots. */
export function createHyperCloudPreviewBackend(
  core: Pick<CoreProcess, 'request'>,
  runtime: () => Runtime,
  download: HyperCloudPreviewBackend['download'],
): HyperCloudPreviewBackend {
  return {
    download,
    async context() {
      const captured = { ...runtime() };
      const current = () => {
        const next = runtime();
        if (!captured.root || !captured.server || next.root !== captured.root || next.server !== captured.server || next.revision !== captured.revision) throw new Error('The image workspace or account changed.');
      };
      current();
      const read = async <O extends DescMessage>(event: string, schema: O) => {
        current(); const reply = await core.request(event, new Uint8Array()); current();
        if (reply.status !== 0) throw new Error('The image account or workspace is unavailable.');
        return fromBinary(schema, reply.payload);
      };
      const firstUser = await read('GetUserProfile', UserProfilePBSchema);
      const firstWorkspace = await read('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
      const user = await read('GetUserProfile', UserProfilePBSchema);
      const workspace = await read('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema);
      if (user.id !== firstUser.id || !workspace.workspaceId || workspace.workspaceId !== firstWorkspace.workspaceId) throw new Error('The image workspace or account changed.');
      return { root: captured.root!, server: captured.server!, revision: captured.revision, actorId: String(user.id), workspaceId: workspace.workspaceId };
    },
  };
}
