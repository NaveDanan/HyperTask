// Generated from rust-lib/hyper-folder/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { EMPTY, request, type HyperResult } from '../dispatch';
import { UpdateViewIconPayloadPBSchema } from '@shared/protobuf/hyper-folder/icon_pb';
import { ImportPayloadPBSchema, ImportZipPBSchema } from '@shared/protobuf/hyper-folder/import_pb';
import { PublishInfoResponsePBSchema, PublishNamespacePBSchema, PublishViewParamsPBSchema, RepeatedPublishInfoViewPBSchema, SetPublishNamespacePayloadPBSchema, UnpublishViewsPayloadPBSchema, type PublishInfoResponsePB, type PublishNamespacePB, type RepeatedPublishInfoViewPB } from '@shared/protobuf/hyper-folder/publish_pb';
import { RepeatedTrashIdPBSchema, RepeatedTrashPBSchema, TrashIdPBSchema, type RepeatedTrashPB } from '@shared/protobuf/hyper-folder/trash_pb';
import { CreateOrphanViewPayloadPBSchema, CreateViewPayloadPBSchema, DuplicateViewPayloadPBSchema, GetSharedUsersPayloadPBSchema, GetSharedViewSectionResponsePBSchema, MoveNestedViewPayloadPBSchema, MoveViewPayloadPBSchema, ReadRecentViewsPBSchema, RemoveUserFromSharedPagePayloadPBSchema, RepeatedFavoriteViewPBSchema, RepeatedRecentViewPBSchema, RepeatedSharedUserPBSchema, RepeatedSharedViewResponsePBSchema, RepeatedViewIdPBSchema, RepeatedViewPBSchema, SetPublishNamePBSchema, SharePageWithUserPayloadPBSchema, UpdateRecentViewPayloadPBSchema, UpdateViewPayloadPBSchema, UpdateViewVisibilityStatusPayloadPBSchema, ViewIdPBSchema, ViewPBSchema, type GetSharedViewSectionResponsePB, type RepeatedFavoriteViewPB, type RepeatedRecentViewPB, type RepeatedSharedUserPB, type RepeatedSharedViewResponsePB, type RepeatedViewPB, type ViewPB } from '@shared/protobuf/hyper-folder/view_pb';
import { GetWorkspaceViewPBSchema, RepeatedFolderSnapshotPBSchema, WorkspaceIdPBSchema, WorkspaceLatestPBSchema, WorkspacePBSchema, type RepeatedFolderSnapshotPB, type WorkspaceLatestPB, type WorkspacePB } from '@shared/protobuf/hyper-folder/workspace_pb';

export function FolderEventCreateFolderWorkspace(): Promise<HyperResult<void>> {
  return request('CreateFolderWorkspace', EMPTY);
}

export function FolderEventGetCurrentWorkspaceSetting(): Promise<HyperResult<WorkspaceLatestPB>> {
  return request('GetCurrentWorkspaceSetting', EMPTY, WorkspaceLatestPBSchema);
}

export function FolderEventReadCurrentWorkspace(): Promise<HyperResult<WorkspacePB>> {
  return request('ReadCurrentWorkspace', EMPTY, WorkspacePBSchema);
}

export function FolderEventDeleteWorkspace(payload: MessageInitShape<typeof WorkspaceIdPBSchema>): Promise<HyperResult<void>> {
  return request('DeleteWorkspace', toBinary(WorkspaceIdPBSchema, create(WorkspaceIdPBSchema, payload)));
}

export function FolderEventReadWorkspaceViews(payload: MessageInitShape<typeof GetWorkspaceViewPBSchema>): Promise<HyperResult<RepeatedViewPB>> {
  return request('ReadWorkspaceViews', toBinary(GetWorkspaceViewPBSchema, create(GetWorkspaceViewPBSchema, payload)), RepeatedViewPBSchema);
}

export function FolderEventCreateView(payload: MessageInitShape<typeof CreateViewPayloadPBSchema>): Promise<HyperResult<ViewPB>> {
  return request('CreateView', toBinary(CreateViewPayloadPBSchema, create(CreateViewPayloadPBSchema, payload)), ViewPBSchema);
}

export function FolderEventGetView(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<ViewPB>> {
  return request('GetView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)), ViewPBSchema);
}

export function FolderEventUpdateView(payload: MessageInitShape<typeof UpdateViewPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateView', toBinary(UpdateViewPayloadPBSchema, create(UpdateViewPayloadPBSchema, payload)));
}

export function FolderEventDeleteView(payload: MessageInitShape<typeof RepeatedViewIdPBSchema>): Promise<HyperResult<void>> {
  return request('DeleteView', toBinary(RepeatedViewIdPBSchema, create(RepeatedViewIdPBSchema, payload)));
}

export function FolderEventDuplicateView(payload: MessageInitShape<typeof DuplicateViewPayloadPBSchema>): Promise<HyperResult<ViewPB>> {
  return request('DuplicateView', toBinary(DuplicateViewPayloadPBSchema, create(DuplicateViewPayloadPBSchema, payload)), ViewPBSchema);
}

export function FolderEventCloseView(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<void>> {
  return request('CloseView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)));
}

export function FolderEventCreateOrphanView(payload: MessageInitShape<typeof CreateOrphanViewPayloadPBSchema>): Promise<HyperResult<ViewPB>> {
  return request('CreateOrphanView', toBinary(CreateOrphanViewPayloadPBSchema, create(CreateOrphanViewPayloadPBSchema, payload)), ViewPBSchema);
}

export function FolderEventGetAllViews(): Promise<HyperResult<RepeatedViewPB>> {
  return request('GetAllViews', EMPTY, RepeatedViewPBSchema);
}

export function FolderEventCopyLink(): Promise<HyperResult<void>> {
  return request('CopyLink', EMPTY);
}

export function FolderEventSetLatestView(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<void>> {
  return request('SetLatestView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)));
}

export function FolderEventMoveView(payload: MessageInitShape<typeof MoveViewPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('MoveView', toBinary(MoveViewPayloadPBSchema, create(MoveViewPayloadPBSchema, payload)));
}

export function FolderEventListTrashItems(): Promise<HyperResult<RepeatedTrashPB>> {
  return request('ListTrashItems', EMPTY, RepeatedTrashPBSchema);
}

export function FolderEventRestoreTrashItem(payload: MessageInitShape<typeof TrashIdPBSchema>): Promise<HyperResult<void>> {
  return request('RestoreTrashItem', toBinary(TrashIdPBSchema, create(TrashIdPBSchema, payload)));
}

export function FolderEventPermanentlyDeleteTrashItem(payload: MessageInitShape<typeof RepeatedTrashIdPBSchema>): Promise<HyperResult<void>> {
  return request('PermanentlyDeleteTrashItem', toBinary(RepeatedTrashIdPBSchema, create(RepeatedTrashIdPBSchema, payload)));
}

export function FolderEventRecoverAllTrashItems(): Promise<HyperResult<void>> {
  return request('RecoverAllTrashItems', EMPTY);
}

export function FolderEventPermanentlyDeleteAllTrashItem(): Promise<HyperResult<void>> {
  return request('PermanentlyDeleteAllTrashItem', EMPTY);
}

export function FolderEventImportData(payload: MessageInitShape<typeof ImportPayloadPBSchema>): Promise<HyperResult<RepeatedViewPB>> {
  return request('ImportData', toBinary(ImportPayloadPBSchema, create(ImportPayloadPBSchema, payload)), RepeatedViewPBSchema);
}

export function FolderEventGetFolderSnapshots(payload: MessageInitShape<typeof WorkspaceIdPBSchema>): Promise<HyperResult<RepeatedFolderSnapshotPB>> {
  return request('GetFolderSnapshots', toBinary(WorkspaceIdPBSchema, create(WorkspaceIdPBSchema, payload)), RepeatedFolderSnapshotPBSchema);
}

export function FolderEventMoveNestedView(payload: MessageInitShape<typeof MoveNestedViewPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('MoveNestedView', toBinary(MoveNestedViewPayloadPBSchema, create(MoveNestedViewPayloadPBSchema, payload)));
}

export function FolderEventReadFavorites(): Promise<HyperResult<RepeatedFavoriteViewPB>> {
  return request('ReadFavorites', EMPTY, RepeatedFavoriteViewPBSchema);
}

export function FolderEventToggleFavorite(payload: MessageInitShape<typeof RepeatedViewIdPBSchema>): Promise<HyperResult<void>> {
  return request('ToggleFavorite', toBinary(RepeatedViewIdPBSchema, create(RepeatedViewIdPBSchema, payload)));
}

export function FolderEventUpdateViewIcon(payload: MessageInitShape<typeof UpdateViewIconPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateViewIcon', toBinary(UpdateViewIconPayloadPBSchema, create(UpdateViewIconPayloadPBSchema, payload)));
}

export function FolderEventReadRecentViews(payload: MessageInitShape<typeof ReadRecentViewsPBSchema>): Promise<HyperResult<RepeatedRecentViewPB>> {
  return request('ReadRecentViews', toBinary(ReadRecentViewsPBSchema, create(ReadRecentViewsPBSchema, payload)), RepeatedRecentViewPBSchema);
}

export function FolderEventUpdateRecentViews(payload: MessageInitShape<typeof UpdateRecentViewPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateRecentViews', toBinary(UpdateRecentViewPayloadPBSchema, create(UpdateRecentViewPayloadPBSchema, payload)));
}

export function FolderEventReadPrivateViews(payload: MessageInitShape<typeof GetWorkspaceViewPBSchema>): Promise<HyperResult<RepeatedViewPB>> {
  return request('ReadPrivateViews', toBinary(GetWorkspaceViewPBSchema, create(GetWorkspaceViewPBSchema, payload)), RepeatedViewPBSchema);
}

export function FolderEventReadCurrentWorkspaceViews(): Promise<HyperResult<RepeatedViewPB>> {
  return request('ReadCurrentWorkspaceViews', EMPTY, RepeatedViewPBSchema);
}

export function FolderEventUpdateViewVisibilityStatus(payload: MessageInitShape<typeof UpdateViewVisibilityStatusPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateViewVisibilityStatus', toBinary(UpdateViewVisibilityStatusPayloadPBSchema, create(UpdateViewVisibilityStatusPayloadPBSchema, payload)));
}

export function FolderEventGetViewAncestors(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<RepeatedViewPB>> {
  return request('GetViewAncestors', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)), RepeatedViewPBSchema);
}

export function FolderEventPublishView(payload: MessageInitShape<typeof PublishViewParamsPBSchema>): Promise<HyperResult<void>> {
  return request('PublishView', toBinary(PublishViewParamsPBSchema, create(PublishViewParamsPBSchema, payload)));
}

export function FolderEventGetPublishInfo(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<PublishInfoResponsePB>> {
  return request('GetPublishInfo', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)), PublishInfoResponsePBSchema);
}

export function FolderEventGetPublishNamespace(): Promise<HyperResult<PublishNamespacePB>> {
  return request('GetPublishNamespace', EMPTY, PublishNamespacePBSchema);
}

export function FolderEventSetPublishNamespace(payload: MessageInitShape<typeof SetPublishNamespacePayloadPBSchema>): Promise<HyperResult<void>> {
  return request('SetPublishNamespace', toBinary(SetPublishNamespacePayloadPBSchema, create(SetPublishNamespacePayloadPBSchema, payload)));
}

export function FolderEventUnpublishViews(payload: MessageInitShape<typeof UnpublishViewsPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('UnpublishViews', toBinary(UnpublishViewsPayloadPBSchema, create(UnpublishViewsPayloadPBSchema, payload)));
}

export function FolderEventImportZipFile(payload: MessageInitShape<typeof ImportZipPBSchema>): Promise<HyperResult<void>> {
  return request('ImportZipFile', toBinary(ImportZipPBSchema, create(ImportZipPBSchema, payload)));
}

export function FolderEventListPublishedViews(): Promise<HyperResult<RepeatedPublishInfoViewPB>> {
  return request('ListPublishedViews', EMPTY, RepeatedPublishInfoViewPBSchema);
}

export function FolderEventGetDefaultPublishInfo(): Promise<HyperResult<PublishInfoResponsePB>> {
  return request('GetDefaultPublishInfo', EMPTY, PublishInfoResponsePBSchema);
}

export function FolderEventSetDefaultPublishView(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<void>> {
  return request('SetDefaultPublishView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)));
}

export function FolderEventSetPublishName(payload: MessageInitShape<typeof SetPublishNamePBSchema>): Promise<HyperResult<void>> {
  return request('SetPublishName', toBinary(SetPublishNamePBSchema, create(SetPublishNamePBSchema, payload)));
}

export function FolderEventRemoveDefaultPublishView(): Promise<HyperResult<void>> {
  return request('RemoveDefaultPublishView', EMPTY);
}

export function FolderEventLockView(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<void>> {
  return request('LockView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)));
}

export function FolderEventUnlockView(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<void>> {
  return request('UnlockView', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)));
}

export function FolderEventSharePageWithUser(payload: MessageInitShape<typeof SharePageWithUserPayloadPBSchema>): Promise<HyperResult<void>> {
  return request('SharePageWithUser', toBinary(SharePageWithUserPayloadPBSchema, create(SharePageWithUserPayloadPBSchema, payload)));
}

export function FolderEventRemoveUserFromSharedPage(payload: MessageInitShape<typeof RemoveUserFromSharedPagePayloadPBSchema>): Promise<HyperResult<void>> {
  return request('RemoveUserFromSharedPage', toBinary(RemoveUserFromSharedPagePayloadPBSchema, create(RemoveUserFromSharedPagePayloadPBSchema, payload)));
}

export function FolderEventGetSharedUsers(payload: MessageInitShape<typeof GetSharedUsersPayloadPBSchema>): Promise<HyperResult<RepeatedSharedUserPB>> {
  return request('GetSharedUsers', toBinary(GetSharedUsersPayloadPBSchema, create(GetSharedUsersPayloadPBSchema, payload)), RepeatedSharedUserPBSchema);
}

export function FolderEventGetSharedViews(): Promise<HyperResult<RepeatedSharedViewResponsePB>> {
  return request('GetSharedViews', EMPTY, RepeatedSharedViewResponsePBSchema);
}

export function FolderEventGetSharedViewSection(payload: MessageInitShape<typeof ViewIdPBSchema>): Promise<HyperResult<GetSharedViewSectionResponsePB>> {
  return request('GetSharedViewSection', toBinary(ViewIdPBSchema, create(ViewIdPBSchema, payload)), GetSharedViewSectionResponsePBSchema);
}
