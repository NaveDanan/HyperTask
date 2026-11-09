import { useEffect, useRef, useState } from 'react';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import {
  FolderEventGetAllViews,
  FolderEventGetView,
  FolderEventMoveNestedView,
  FolderEventReadCurrentWorkspace,
  UserEventGetUserSetting,
  UserEventImportAppFlowyDataFolder,
} from '@/backend/events';
import { FlowySvg } from '@/icons/FlowySvg';
import { useTr, tr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { runAppFlowy } from '@/startup/launcher';
import { AFButton, Spinner, Tooltip, showConfirmDialog, showSimpleAFDialog, showToast } from '@/ui';
import type { SettingsPageProps } from '../page-props';
import { featureFlags } from '../pages/feature-flags';
import { isDebugBuild } from '../settings-dialog-store';
import { SettingsCategory, SettingsBody } from '../shared';
import { SettingAction, SettingsSubcategory, SingleSettingAction } from '../shared-widgets';

/** appFlowyApplicationDataDirectory(): `<support>/data` (release) or `<support>/data_dev` (develop). */
export function defaultDataDirectory(): string {
  const info = useAppStore.getState().info!;
  const sep = info.platform === 'win32' ? '\\' : '/';
  return `${info.paths.support}${sep}${info.isPackaged ? 'data' : 'data_dev'}`;
}

/** WorkspaceDataManager.checkViewHealth (fix_data_widget.dart): re-parents unlisted child views. */
export async function checkViewHealth(dryRun: boolean): Promise<ViewPB[]> {
  const unlisted: ViewPB[] = [];
  try {
    const current = await FolderEventReadCurrentWorkspace();
    const all = await FolderEventGetAllViews();
    if (!current.ok || !all.ok) throw new Error('Failed to read the workspace');
    const views = all.value.items;
    for (const view of views) {
      if (view.parentViewId === '') continue;
      const parent = views.find((v) => v.id === view.parentViewId);
      if (!parent) {
        console.info('[workspace] orphanViews:', view.id);
        continue;
      }
      if (parent.id === view.id) {
        console.info('[workspace] rowPageViews:', view.id);
        continue;
      }
      const children = await FolderEventGetView({ value: parent.id });
      if (!children.ok) throw children.error;
      if (!children.value.childViews.some((c) => c.id === view.id)) unlisted.push(view);
    }
  } catch (error) {
    console.error('Failed to check space health:', error);
    return [];
  }
  for (const view of unlisted) console.info("[workspace] found an issue: view is not in the parent view's child views, view:", view.id);
  if (!dryRun) {
    for (const view of unlisted) {
      await FolderEventMoveNestedView({ viewId: view.id, newParentId: view.parentViewId });
    }
  }
  return unlisted;
}

/** FlowyCacheManager.clearAllCache(): temporary/image caches and the feature-flag cache. */
async function clearAllCache() {
  await window.appflowy.app.clearCache();
  // FeatureFlagCache: KV featureFlag removed, in-memory flags reset.
  await featureFlags.clear();
}

/** shareLogFiles(): zip log.* files and open the zip (desktop). */
export async function shareLogFiles() {
  try {
    const zip = await window.appflowy.app.exportLogs();
    if (!zip) {
      showToast({ message: tr('noLogFiles'), type: 'error' });
      return;
    }
    await window.appflowy.shell.openPath(zip);
  } catch (error) {
    showToast({ message: error instanceof Error ? error.message : String(error), type: 'error' });
  }
}

/** _CurrentPath: action-colored path (opens the folder), copy button with a 300 ms "Path copied!" pill. */
function CurrentPath({ path }: { path: string }) {
  const { tr } = useTr();
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Tooltip message={tr('settings.manageDataPage.dataStorage.actions.openTooltip')}>
          <div
            onClick={() => void window.appflowy.shell.openPath(path)}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              cursor: 'pointer',
              fontSize: 'calc(14px * var(--text-scale, 1))',
              lineHeight: '20px',
              color: 'var(--af-text-action)',
              textDecoration: hover ? 'underline' : undefined,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }}
          >
            {path}
          </div>
        </Tooltip>
      </div>
      <div style={{ width: 8 }} />
      {copied ? (
        <div
          style={{
            background: 'var(--afx-tint-7)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 'calc(14px * var(--text-scale, 1))',
            lineHeight: '20px',
            color: 'var(--af-text-primary)',
            whiteSpace: 'nowrap',
          }}
        >
          {tr('settings.manageDataPage.dataStorage.actions.copiedHint')}
        </div>
      ) : (
        <Tooltip message={tr('settings.manageDataPage.dataStorage.actions.copy')}>
          <AFButton
            variant="ghostPrimary"
            padding={8}
            onTap={() => {
              window.appflowy.clipboard.writeText(path);
              setCopied(true);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setCopied(false), 300);
            }}
          >
            <FlowySvg svg="copy_s" size={20} color="var(--af-text-primary)" />
          </AFButton>
        </Tooltip>
      )}
    </div>
  );
}

/** SettingsManageDataView (pages/settings_manage_data_view.dart). */
export function ManageDataPage({ workspace, closeDialog }: SettingsPageProps) {
  const { tr } = useTr();
  const [path, setPath] = useState<string | null>(null);
  const isCloudWorkspace = workspace?.workspaceType === WorkspaceTypePB.ServerW;

  useEffect(() => {
    // DataLocationBloc.initial → UserEventGetUserSetting().user_folder
    void UserEventGetUserSetting().then((result) => {
      if (result.ok) setPath(result.value.userFolder);
    });
  }, []);

  const resetToDefault = () =>
    showSimpleAFDialog({
      title: tr('settings.manageDataPage.dataStorage.resetDialog.title'),
      content: tr('settings.manageDataPage.dataStorage.resetDialog.description'),
      primaryAction: [
        tr('button.confirm'),
        async () => {
          await KeyValueStorage.set(KVKeys.pathLocation, defaultDataDirectory());
          closeDialog();
          void runAppFlowy({ isAnon: true });
        },
      ],
      secondaryAction: [tr('button.cancel'), () => {}],
    });

  const importData = async () => {
    const folder = await window.appflowy.dialog.pickDirectory();
    if (!folder) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const parent = KeyValueStorage.get(KVKeys.lastOpenedSpaceId);
    const result = await UserEventImportAppFlowyDataFolder({
      path: folder,
      oneOfImportContainerName: { case: 'importContainerName', value: `import_${stamp}` },
      oneOfParentViewId: parent ? { case: 'parentViewId', value: parent } : { case: undefined },
    });
    showToast({ message: tr(result.ok ? 'settings.menu.importSuccess' : 'settings.menu.importFailed'), type: result.ok ? 'success' : 'error' });
  };

  const clearCache = () =>
    showConfirmDialog({
      title: tr('settings.manageDataPage.cache.dialog.title'),
      description: tr('settings.manageDataPage.cache.dialog.description'),
      style: 'cancelAndOk',
      confirmLabel: tr('button.ok'),
      confirmButtonColor: 'var(--cs-primary)',
      onConfirm: async () => {
        await clearAllCache();
        await checkViewHealth(false);
        showToast({ message: tr('settings.manageDataPage.cache.dialog.successHint') });
      },
    });

  return (
    <SettingsBody title={tr('settings.manageDataPage.title')} description={tr('settings.manageDataPage.description')}>
      <SettingsCategory
        key="storage"
        title={tr('settings.manageDataPage.dataStorage.title')}
        tooltip={tr('settings.manageDataPage.dataStorage.tooltip')}
        actions={
          isCloudWorkspace && (
            <SettingAction
              tooltip={tr('settings.manageDataPage.dataStorage.actions.resetTooltip')}
              icon={<FlowySvg svg="restore_s" size={20} />}
              label={tr('settings.common.reset')}
              onPressed={resetToDefault}
            />
          )
        }
      >
        {path === null ? (
          <Spinner />
        ) : (
          [
            <CurrentPath key="path" path={path} />,
            isCloudWorkspace && (
              // _DataPathActions: "Change path". The Dart guard `path == path` always returns,
              // so picking a folder has no effect; reproduced.
              <div key="change" style={{ display: 'flex' }}>
                <AFButton variant="filledPrimary" text={tr('settings.manageDataPage.dataStorage.actions.change')} onTap={() => void window.appflowy.dialog.pickDirectory()} />
              </div>
            ),
          ]
        )}
      </SettingsCategory>
      <SettingsCategory key="import" title={tr('settings.manageDataPage.importData.title')} tooltip={tr('settings.manageDataPage.importData.tooltip')}>
        <SingleSettingAction
          label={tr('settings.manageDataPage.importData.description')}
          labelMaxLines={2}
          buttonLabel={tr('settings.manageDataPage.importData.action')}
          onPressed={() => void importData()}
        />
      </SettingsCategory>
      {isDebugBuild() && (
        <SettingsCategory key="export" title={tr('settings.files.exportData')}>
          <SettingsSubcategory title={tr('settings.manageDataPage.data.fixYourData')}>
            <SingleSettingAction
              label={tr('settings.manageDataPage.data.fixYourDataDescription')}
              buttonLabel={tr('settings.manageDataPage.data.fixButton')}
              onPressed={() => void checkViewHealth(true)}
            />
          </SettingsSubcategory>
        </SettingsCategory>
      )}
      <SettingsCategory key="logs" title={tr('workspace.errorActions.exportLogFiles')}>
        <SingleSettingAction
          labelMaxLines={4}
          label={tr('workspace.errorActions.exportLogFiles')}
          buttonLabel={tr('settings.files.export')}
          onPressed={() => void shareLogFiles()}
        />
      </SettingsCategory>
      <SettingsCategory key="cache" title={tr('settings.manageDataPage.cache.title')}>
        <SingleSettingAction
          labelMaxLines={4}
          label={tr('settings.manageDataPage.cache.description')}
          buttonLabel={tr('settings.manageDataPage.cache.title')}
          onPressed={clearCache}
        />
      </SettingsCategory>
    </SettingsBody>
  );
}
