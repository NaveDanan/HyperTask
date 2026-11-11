import { create } from '@bufbuild/protobuf';
import { AFAccessLevelPB, SharedViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';
import { AFRolePB, AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { MediaFilePBSchema, type MediaFilePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import { FileUploadTypePB } from '@shared/protobuf/flowy-database2/file_entities_pb';
import { DatabaseEventGetDatabase, DatabaseEventGetFields, DatabaseEventGetRowMeta, DatabaseEventGetAllFieldSettings } from '@/backend/events/flowy-database2';
import { FolderEventGetView, FolderEventGetSharedUsers, FolderEventGetSharedViewSection, FolderEventReadCurrentWorkspace } from '@/backend/events/flowy-folder';
import { UserEventGetAllWorkspace, UserEventGetUserProfile } from '@/backend/events/flowy-user';
import { DocumentEventUploadFile } from '@/backend/events/flowy-document';
import { unwrap } from '@/backend/dispatch';
import { HyperDatabaseDraftBlocked, type HyperDatabaseDraftMutation, type HyperDatabaseDraftTarget, type HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import { hyperMediaFileType } from './HyperDatabaseMediaCell';

/** Recheck the active account, workspace and view permissions before a write. */
export async function hyperReadDatabaseWriteView(viewId: string, owner: HyperDatabaseDraftOwner) {
  const requireOwner = () => { if (!owner.isCurrent()) throw new HyperDatabaseDraftBlocked('unavailable'); };
  requireOwner();
  const [viewResult, userResult, workspaceResult] = await Promise.all([FolderEventGetView({ value: viewId }), UserEventGetUserProfile(), FolderEventReadCurrentWorkspace()]);
  requireOwner();
  const view = unwrap(viewResult), user = unwrap(userResult), workspace = unwrap(workspaceResult);
  if (view.oneOfIsLocked.case === 'isLocked' && view.oneOfIsLocked.value || String(user.id) !== owner.actorId || workspace.id !== owner.workspaceId) throw new HyperDatabaseDraftBlocked('unavailable');
  if (user.userAuthType !== AuthTypePB.Local && user.workspaceType !== WorkspaceTypePB.LocalW && !(view.oneOfCreatedBy.case === 'createdBy' && view.oneOfCreatedBy.value === user.id)) {
    const [section, workspaces, shared] = await Promise.all([FolderEventGetSharedViewSection({ value: viewId }), UserEventGetAllWorkspace(), FolderEventGetSharedUsers({ viewId })]);
    requireOwner();
    const role = workspaces.ok ? workspaces.value.items.find(item => item.workspaceId === owner.workspaceId)?.oneOfRole : undefined;
    const publicMember = section.ok && section.value.section === SharedViewSectionPB.PublicSection && role?.case === 'role' && role.value !== AFRolePB.Guest;
    const me = shared.ok ? shared.value.items.find(item => item.email === user.email) : undefined;
    if (!publicMember && (!me || ![AFAccessLevelPB.FullAccess, AFAccessLevelPB.ReadAndWrite].includes(me.accessLevel))) throw new HyperDatabaseDraftBlocked('unavailable');
  }
  return view;
}
/** Fresh reads reject observed changes. Native cell events do not offer an atomic compare-and-set. */
export async function hyperReadDatabaseDraft(repository: HyperDatabaseRepository, viewId: string, target: HyperDatabaseDraftTarget) {
  const [databaseResult, fieldsResult, rowResult, settingsResult] = await Promise.all([
    DatabaseEventGetDatabase({ value: viewId }), DatabaseEventGetFields({ viewId }), DatabaseEventGetRowMeta({ viewId, rowId: target.rowId }),
    DatabaseEventGetAllFieldSettings({ value: viewId }), hyperReadDatabaseWriteView(viewId, target.owner),
  ]);
  if (!target.owner.isCurrent()) throw new HyperDatabaseDraftBlocked('unavailable');
  const database = unwrap(databaseResult), fields = unwrap(fieldsResult).items, row = unwrap(rowResult), settings = unwrap(settingsResult).items;
  const field = fields.find(field => field.id === target.fieldId);
  if (database.id !== target.databaseId || row.id !== target.rowId || !field || !database.rows.some(row => row.id === target.rowId) || settings.some(setting => setting.fieldId === target.fieldId && setting.visibility === FieldVisibility.AlwaysHidden)) throw new HyperDatabaseDraftBlocked('unavailable');
  const cell = await repository.cell(viewId, target.rowId, target.fieldId);
  if (!target.owner.isCurrent()) throw new HyperDatabaseDraftBlocked('unavailable');
  return { field, cell };
}

export async function hyperExecuteDatabaseDraft(repository: HyperDatabaseRepository, mutation: HyperDatabaseDraftMutation, prepared: MediaFilePB[], check: () => Promise<void>, sent: () => void = () => {}) {
  await check();
  if (mutation.method === 'uploadMedia') {
    const [viewId, rowId, fieldId, paths, workspaceId, workspaceType] = mutation.args as [string, string, string, string[], string, WorkspaceTypePB];
    while (prepared.length < paths.length) {
      await check();
      const source = paths[prepared.length], local = workspaceType === WorkspaceTypePB.LocalW;
      const imported = local ? await window.appflowy.assets.importFile(source) : null;
      const uploaded = imported ? null : unwrap(await DocumentEventUploadFile({ workspaceId, documentId: rowId, localFilePath: source }));
      const name = imported?.name || source.split(/[\\/]/).at(-1) || 'File';
      // Keep successful preparation even if permission changes while this await is pending.
      prepared.push(create(MediaFilePBSchema, { id: crypto.randomUUID(), name, url: imported?.path || uploaded!.url, uploadType: local ? FileUploadTypePB.LocalFile : FileUploadTypePB.CloudFile, fileType: hyperMediaFileType(name) }));
      await check();
    }
    await check();
    sent();
    await repository.attachMediaFiles(viewId, rowId, fieldId, prepared);
    return;
  }
  const method = repository[mutation.method] as (...args: unknown[]) => Promise<void>;
  sent();
  await method.apply(repository, mutation.args);
}
