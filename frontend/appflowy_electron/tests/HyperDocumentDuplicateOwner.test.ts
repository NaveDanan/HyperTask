import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useAppStore } from '../src/renderer/startup/app-store';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { hyperCaptureDuplicateOwner, hyperDocumentDuplicateBackend } from '../src/renderer/features/document-duplicate/HyperDocumentDuplicateBackend';

describe('Hyper copy production owner capture', () => {
  it('cancels same-ID storage and account ABA transitions while allowing an explicit fresh recovery capture', () => {
    const app = useAppStore.getState(), workspace = useWorkspaceStore.getState();
    try {
      useAppStore.setState({ dataDirectory: '/isolated-copy/one' }); useWorkspaceStore.setState({ currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), userProfile: create(UserProfilePBSchema, { id: 1n }), actionResult: null });
      const storage = hyperCaptureDuplicateOwner()!, version = hyperDocumentDuplicateBackend.ownerVersion!(); expect(storage.isCurrent()).toBe(true);
      useAppStore.setState({ dataDirectory: '/isolated-copy/two' }); useAppStore.setState({ dataDirectory: '/isolated-copy/one' });
      expect(storage.isCurrent()).toBe(false); expect(hyperDocumentDuplicateBackend.ownerVersion!()).toBeGreaterThan(version);
      const actor = hyperCaptureDuplicateOwner()!; useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 2n }) }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }) });
      expect(actor.isCurrent()).toBe(false); expect(hyperCaptureDuplicateOwner()!.isCurrent()).toBe(true);
      const launch = hyperCaptureDuplicateOwner()!; useAppStore.setState({ launchId: app.launchId + 1 }); expect(launch.isCurrent()).toBe(false);
    } finally { useAppStore.setState(app, true); useWorkspaceStore.setState(workspace, true); }
  });
});
