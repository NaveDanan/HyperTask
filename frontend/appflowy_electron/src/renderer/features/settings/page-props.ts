import type { UserProfilePB, UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import type { AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';

/** What SettingsDialog.getSettingsView passes to each page (live UserWorkspaceBloc state). */
export interface SettingsPageProps {
  /** UserWorkspaceBloc.state.userProfile (live). */
  user: UserProfilePB;
  /** UserWorkspaceBloc.state.currentWorkspace. */
  workspace: UserWorkspacePB | null;
  /** currentWorkspace?.role (proto default Owner); null without a workspace. */
  role: AFRolePB | null;
  /** dismissDialog: pops the settings dialog. */
  closeDialog: () => void;
  /** didLogout: pops the dialog and runs runHyperTask(). */
  didLogout: () => void;
  /** restartApp: pops the dialog and runs runHyperTask(). */
  restartApp: () => void;
}
