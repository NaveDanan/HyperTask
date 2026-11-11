import { create } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it } from 'vitest';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useAppStore } from '@/startup/app-store';
import { AuthenticatorType, configurationFromUri } from '@/startup/cloud-env';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner } from './HyperDocumentOwner';

afterEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});
function setup() {
  useAppStore.setState({ dataDirectory: '/workspace-data' });
  useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace-a' }), actionResult: null });
  return hyperGetDocumentOwner()!;
}
describe('Hyper document owner context', () => {
  it('does not acquire before user/workspace metadata is ready', () => {
    expect(hyperGetDocumentOwner()).toBeNull();
    useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }) });
    expect(hyperGetDocumentOwner()).toBeNull();
  });
  it('stops old operations as soon as workspace switching starts', () => {
    const owner = setup(); expect(owner.isCurrent()).toBe(true);
    useWorkspaceStore.setState({ actionResult: { actionType: 'open', isLoading: true, result: null } });
    expect(owner.isCurrent()).toBe(false); expect(hyperGetDocumentOwner()).toBeNull();
    useWorkspaceStore.setState({ currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace-b' }), actionResult: null });
    expect(owner.isCurrent()).toBe(false);
    expect(hyperDocumentOwnerKey(hyperGetDocumentOwner())).not.toBe(hyperDocumentOwnerKey(owner));
  });
  it('does not treat a same-user profile refresh as a core owner change', () => {
    const owner = setup();
    useWorkspaceStore.setState({ currentWorkspace: null, userProfile: create(UserProfilePBSchema, { id: 1n, name: 'Renamed' }) });
    expect(owner.isCurrent()).toBe(true); expect(hyperGetDocumentOwner()).toBeNull();
    useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 2n }) });
    expect(owner.isCurrent()).toBe(false);
  });
  it('separates identical user/workspace identifiers in different storage or server contexts', () => {
    const first = setup();
    useAppStore.setState({ dataDirectory: '/another-data-root' });
    expect(first.isCurrent()).toBe(false);
    expect(hyperDocumentOwnerKey(hyperGetDocumentOwner())).not.toBe(hyperDocumentOwnerKey(first));
    const second = hyperGetDocumentOwner()!;
    useWorkspaceStore.setState({ currentWorkspace: null, userProfile: null });
    expect(second.isCurrent()).toBe(false);
  });
  it('separates identical identifiers from two self-hosted servers', () => {
    setup();
    useAppStore.setState({ env: { authenticatorType: AuthenticatorType.AppFlowyCloudSelfHost, appflowyCloudConfig: configurationFromUri(AuthenticatorType.AppFlowyCloudSelfHost, 'https://one.example.test', '') } });
    const first = hyperGetDocumentOwner()!;
    useAppStore.setState({ env: { authenticatorType: AuthenticatorType.AppFlowyCloudSelfHost, appflowyCloudConfig: configurationFromUri(AuthenticatorType.AppFlowyCloudSelfHost, 'https://two.example.test', '') } });
    expect(first.isCurrent()).toBe(false);
    expect(hyperDocumentOwnerKey(hyperGetDocumentOwner())).not.toBe(hyperDocumentOwnerKey(first));
  });
});
