// ShareBloc (plugins/shared/share/share_bloc.dart): publish state, publish/unpublish/rename and
// the database CSV export. Toasts are shown where Flutter's BlocListeners show them.
import { createStore, type StoreApi } from 'zustand';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import type { FlowyError } from '@shared/protobuf/flowy-error/errors_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import {
  DatabaseEventExportCSV,
  FolderEventGetPublishInfo,
  FolderEventGetPublishNamespace,
  FolderEventPublishView,
  FolderEventReadCurrentWorkspace,
  FolderEventSetPublishName,
  FolderEventUnpublishViews,
  UserEventGetUserProfile,
} from '@/backend/events';
import { tr } from '@/i18n';
import { loadCloudSharedEnv } from '@/startup/cloud-env';
import { showToast } from '@/ui';
import { listenView } from '../view-listener';

export interface ShareState {
  viewId: string;
  viewName: string;
  workspaceId: string;
  isPublished: boolean;
  namespace: string;
  pathName: string;
  url: string;
  enablePublish: boolean;
  isLoading: boolean;
}

export interface ShareStore extends StoreApi<ShareState> {
  view: ViewPB;
  start(): () => void;
  updatePublishStatus(): Promise<void>;
  publish(publishName: string, selectedViewIds: string[]): Promise<void>;
  unpublish(): Promise<void>;
  updatePathName(pathName: string): Promise<void>;
  exportCSV(path: string): Promise<void>;
}

let baseWebDomain: string | null = null;
async function shareDomain(): Promise<string> {
  if (baseWebDomain === null) {
    try {
      baseWebDomain = (await loadCloudSharedEnv()).appflowyCloudConfig.base_web_domain;
    } catch {
      baseWebDomain = '';
    }
  }
  return baseWebDomain;
}

const addSchemaIfNeeded = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);

/** ShareConstants.buildPublishUrl. */
export async function buildPublishUrl(namespace: string, publishName: string) {
  return addSchemaIfNeeded(`${await shareDomain()}/${namespace}/${publishName}`);
}

/** ShareConstants.buildNamespaceUrl. */
export async function buildNamespaceUrl(namespace: string, withHttps = false) {
  let url = addSchemaIfNeeded(await shareDomain());
  if (!withHttps) url = url.replace('https://', '');
  return `${url}/${namespace}`;
}

/** ShareConstants.buildShareUrl. */
export async function buildShareUrl(workspaceId: string, viewId: string) {
  return addSchemaIfNeeded(`${await shareDomain()}/app/${workspaceId}/${viewId}`);
}

/** ErrorCode.publishErrorMessage (shared/error_code/error_code_map.dart). */
export function publishErrorMessage(code: ErrorCode): string | undefined {
  switch (code) {
    case ErrorCode.PublishNameAlreadyExists:
      return tr('settings.sites.error.publishNameAlreadyInUse');
    case ErrorCode.PublishNameInvalidCharacter:
      return tr('settings.sites.error.publishNameContainsInvalidCharacters');
    case ErrorCode.PublishNameTooLong:
      return tr('settings.sites.error.publishNameTooLong');
    case ErrorCode.UserUnauthorized:
      return tr('settings.sites.error.publishPermissionDenied');
    case ErrorCode.ViewNameInvalid:
      return tr('settings.sites.error.publishNameCannotBeEmpty');
    default:
      return undefined;
  }
}

const codeName = (error: FlowyError) => ErrorCode[error.code] ?? String(error.code);

const toastWithDescription = (message: string, description?: string) =>
  description ? (
    <>
      {message}
      <br />
      <span style={{ opacity: 0.8 }}>{description}</span>
    </>
  ) : (
    message
  );

export function createShareStore(view: ViewPB): ShareStore {
  const store = createStore<ShareState>(() => ({
    viewId: view.id,
    viewName: view.name,
    workspaceId: '',
    isPublished: false,
    namespace: '',
    pathName: '',
    url: '',
    enablePublish: false,
    isLoading: false,
  }));
  const get = store.getState;
  const set = store.setState;

  const updatePublishStatus = async () => {
    const info = await FolderEventGetPublishInfo({ value: view.id });
    const user = await UserEventGetUserProfile();
    const enablePublish = user.ok && user.value.workspaceType === WorkspaceTypePB.ServerW;
    let workspaceId = get().workspaceId;
    if (!workspaceId) {
      const workspace = await FolderEventReadCurrentWorkspace();
      workspaceId = workspace.ok ? workspace.value.id : '';
    }
    if (info.ok) {
      set({
        // Unpublished pages keep their info with an unpublish timestamp.
        isPublished: info.value.oneOfUnpublishedAtTimestampSec.case === undefined,
        namespace: info.value.oneOfNamespace.case === 'namespace' ? info.value.oneOfNamespace.value : '',
        pathName: info.value.publishName,
        url: await buildPublishUrl(
          info.value.oneOfNamespace.case === 'namespace' ? info.value.oneOfNamespace.value : '',
          info.value.publishName,
        ),
      });
    } else {
      set({ isPublished: false, namespace: '', pathName: '', url: '' });
    }
    set({ viewName: view.name, enablePublish, workspaceId, viewId: view.id });
  };

  return Object.assign(store, {
    view,
    start() {
      const stop = listenView(view.id, {
        onViewUpdated: (updated) => set({ viewName: updated.name, viewId: updated.id }),
        onViewMoveToTrash: () => set({ isPublished: false, url: '' }),
      });
      void updatePublishStatus();
      return stop;
    },
    updatePublishStatus,
    async publish(publishName: string, selectedViewIds: string[]) {
      const namespace = await FolderEventGetPublishNamespace();
      const result = namespace.ok
        ? await FolderEventPublishView({
            viewId: view.id,
            oneOfPublishName: { case: 'publishName', value: publishName },
            ...(selectedViewIds.length > 0
              ? { oneOfSelectedViewIds: { case: 'selectedViewIds' as const, value: { items: selectedViewIds } } }
              : {}),
          })
        : namespace;
      if (result.ok && namespace.ok) {
        set({
          isPublished: true,
          namespace: namespace.value.namespace,
          pathName: publishName,
          url: await buildPublishUrl(namespace.value.namespace, publishName),
        });
        showToast({ message: tr('publish.publishSuccessfully') });
      } else {
        set({ isPublished: false, url: '' });
        const error = !result.ok ? result.error : !namespace.ok ? namespace.error : null;
        showToast({ message: `${tr('publish.publishFailed')}: ${error ? codeName(error) : ''}`, type: 'error' });
      }
    },
    async unpublish() {
      const result = await FolderEventUnpublishViews({ viewIds: [view.id] });
      set({ isPublished: !result.ok, url: result.ok ? '' : get().url });
      if (result.ok) showToast({ message: tr('publish.unpublishSuccessfully') });
      else showToast({ message: toastWithDescription(tr('publish.unpublishFailed'), result.error.msg), type: 'error' });
    },
    async updatePathName(pathName: string) {
      if (!pathName) {
        showToast({
          message: toastWithDescription(tr('settings.sites.error.updatePathNameFailed'), publishErrorMessage(ErrorCode.ViewNameInvalid)),
          type: 'error',
        });
        return;
      }
      const result = await FolderEventSetPublishName({ viewId: view.id, newName: pathName });
      if (result.ok) {
        set({ pathName, url: await buildPublishUrl(get().namespace, pathName) });
        showToast({ message: tr('settings.sites.success.updatePathNameSuccess') });
      } else {
        showToast({
          message: toastWithDescription(tr('settings.sites.error.updatePathNameFailed'), publishErrorMessage(result.error.code)),
          type: 'error',
        });
      }
    },
    async exportCSV(path: string) {
      set({ isLoading: true });
      const result = await DatabaseEventExportCSV({ value: view.id });
      set({ isLoading: false });
      if (!result.ok) {
        showToast({ message: `${tr('settings.files.exportFileFail')}: ${codeName(result.error)}` });
        return;
      }
      await window.appflowy.fs.writeText(path, result.value.data);
      showToast({ message: tr('settings.files.exportFileSuccess') });
    },
  });
}

export const isDatabaseView = (view: ViewPB) =>
  view.layout === ViewLayoutPB.Grid || view.layout === ViewLayoutPB.Board || view.layout === ViewLayoutPB.Calendar;
