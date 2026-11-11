import { AFAccessLevelPB, SharedViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';
import { AFRolePB, AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FolderEventDuplicateView, FolderEventGetAllViews, FolderEventGetSharedUsers, FolderEventGetSharedViewSection, FolderEventGetView, FolderEventReadCurrentWorkspace, FolderEventSetLatestView } from '@/backend/events/flowy-folder';
import { UserEventCreateReminder, UserEventGetAllReminders, UserEventGetAllWorkspace, UserEventGetUserProfile } from '@/backend/events/flowy-user';
import { DocumentEventGetDocumentData } from '@/backend/events/flowy-document';
import { unwrap } from '@/backend/dispatch';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { flushHyperDocument } from '../document/HyperDocumentSession';
import { reminderActions } from '../sidebar/stores/reminder-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { useAppStore } from '@/startup/app-store';
import { hyperCaptureSearchOwner } from '../search/HyperSearchOwner';
import { HyperDocumentDuplicateService, type HyperDocumentDuplicateBackend, type HyperDuplicateCheck, type HyperDuplicateOptions } from './HyperDocumentDuplicateService';

const identity = async (check: HyperDuplicateCheck) => {
  const workspace = unwrap(await check(() => FolderEventReadCurrentWorkspace()));
  const user = unwrap(await check(() => UserEventGetUserProfile()));
  return { workspaceId: workspace.id, actorId: String(user.id) };
};
let ownerRevision = 0, watched = false, lastOwner = '';
function duplicateOwnerVersion() {
  const update = () => {
    const next = JSON.stringify([hyperDocumentOwnerKey(hyperGetDocumentOwner()), useAppStore.getState().launchId]);
    if (next !== lastOwner) { ownerRevision++; lastOwner = next; }
  };
  // Lazy subscription avoids touching stores during their circular module initialization.
  if (!watched) { watched = true; update(); useWorkspaceStore.subscribe(update); useAppStore.subscribe(update); }
  update(); return ownerRevision;
}
export function hyperCaptureDuplicateOwner(owner: HyperDocumentOwner | null = hyperGetDocumentOwner()): HyperDocumentOwner | null {
  const scope = hyperCaptureSearchOwner(owner), revision = duplicateOwnerVersion();
  return scope && owner ? { ...owner, isCurrent: () => revision === duplicateOwnerVersion() && scope.isCurrent() } : null;
}
export const hyperDocumentDuplicateBackend: HyperDocumentDuplicateBackend = {
  owner: hyperGetDocumentOwner,
  ownerVersion: duplicateOwnerVersion,
  identity,
  async writable(id, owner, check) {
    const user = unwrap(await check(() => UserEventGetUserProfile())), workspace = unwrap(await check(() => FolderEventReadCurrentWorkspace()));
    if (String(user.id) !== owner.actorId || workspace.id !== owner.workspaceId) throw new Error('The active workspace or account changed.');
    const local = user.userAuthType === AuthTypePB.Local || user.workspaceType === WorkspaceTypePB.LocalW;
    const view = id === owner.workspaceId ? null : unwrap(await check(() => FolderEventGetView({ value: id })));
    if (view?.oneOfIsLocked.case === 'isLocked' && view.oneOfIsLocked.value) throw new Error('The copied page or destination is locked.');
    if (local || view?.oneOfCreatedBy.case === 'createdBy' && view.oneOfCreatedBy.value === user.id) return;
    const workspaces = unwrap(await check(() => UserEventGetAllWorkspace())).items;
    const role = workspaces.find(item => item.workspaceId === owner.workspaceId)?.oneOfRole;
    if (!view) { if (role?.case === 'role' && [AFRolePB.Owner, AFRolePB.Member].includes(role.value)) return; throw new Error('You cannot create pages in this workspace.'); }
    const section = unwrap(await check(() => FolderEventGetSharedViewSection({ value: id })));
    if (section.section === SharedViewSectionPB.PublicSection && role?.case === 'role' && role.value !== AFRolePB.Guest) return;
    const shared = unwrap(await check(() => FolderEventGetSharedUsers({ viewId: id }))).items.find(item => item.email === user.email);
    if (!shared || ![AFAccessLevelPB.FullAccess, AFAccessLevelPB.ReadAndWrite].includes(shared.accessLevel)) throw new Error('You cannot write to the copied page or destination.');
  },
  view: async value => unwrap(await FolderEventGetView({ value })),
  views: async () => unwrap(await FolderEventGetAllViews()).items,
  flush: flushHyperDocument,
  document: async documentId => unwrap(await DocumentEventGetDocumentData({ documentId })),
  reminders: async () => unwrap(await UserEventGetAllReminders()).items,
  create: async reminder => { unwrap(await UserEventCreateReminder(reminder)); },
  duplicate: async options => unwrap(await FolderEventDuplicateView({ viewId: options.view.id, openAfterDuplicate: false, includeChildren: options.includeChildren, syncAfterCreate: options.syncAfterDuplicate, ...(options.parentViewId !== undefined ? { oneOfParentViewId: { case: 'parentViewId', value: options.parentViewId } as const } : {}), ...(options.suffix !== undefined ? { oneOfSuffix: { case: 'suffix', value: options.suffix } as const } : {}) })),
  open: async value => { unwrap(await FolderEventSetLatestView({ value })); },
  changed: () => { void reminderActions.refresh(); },
};
export const hyperDocumentDuplicates = new HyperDocumentDuplicateService(hyperDocumentDuplicateBackend);
/** Capture owner synchronously, before any backend call or deferred work. */
export const hyperDuplicateView = (options: HyperDuplicateOptions) => hyperDocumentDuplicates.duplicate({ ...options, owner: hyperCaptureDuplicateOwner(options.owner === undefined ? hyperGetDocumentOwner() : options.owner) });
