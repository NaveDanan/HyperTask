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
import { Copy, Folder, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { useTr, tr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import { runHyperTask } from '@/startup/HyperLauncher';
import { Tooltip, showConfirmDialog, showSimpleAFDialog, showToast } from '@/ui';
import type { SettingsPageProps } from '../page-props';
import { featureFlags } from '../pages/feature-flags';
import { isDebugBuild } from '../settings-dialog-store';

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
    <div className="flex min-w-0 items-center gap-2">
      <Tooltip message={path}>
        <button type="button" title={tr('settings.manageDataPage.dataStorage.actions.openTooltip')} onClick={() => void window.appflowy.shell.openPath(path)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className={`min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-left font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${hover ? 'underline' : ''}`}>{path}</button>
      </Tooltip>
      {copied ? <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs">{tr('settings.manageDataPage.dataStorage.actions.copiedHint')}</span> :
        <Tooltip message={tr('settings.manageDataPage.dataStorage.actions.copy')}>
          <Button variant="outline" size="icon-sm" aria-label={tr('settings.manageDataPage.dataStorage.actions.copy')} onClick={() => {
            window.appflowy.clipboard.writeText(path);
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 300);
          }}><Copy className="size-4" /></Button>
        </Tooltip>}
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
          void runHyperTask({ isAnon: true });
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
      onConfirm: async () => {
        await clearAllCache();
        await checkViewHealth(false);
        showToast({ message: tr('settings.manageDataPage.cache.dialog.successHint') });
      },
    });

  return (
    <>
      <SettingsPageHeader title={tr('settings.manageDataPage.title')} description={tr('settings.manageDataPage.description')} />
      <SettingsSection title={<Tooltip message={tr('settings.manageDataPage.dataStorage.tooltip')}><span>{tr('settings.manageDataPage.dataStorage.title')}</span></Tooltip>}>
        <SettingsGroup><SettingsRow label={<span className="flex items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Folder className="size-4 text-muted-foreground" /></span>{tr('settings.manageDataPage.dataStorage.title')}</span>} control={<>
          {path !== null && <Button variant="outline" size="sm" onClick={() => void window.appflowy.shell.openPath(path)}>{tr('settings.manageDataPage.dataStorage.actions.openTooltip')}</Button>}
          {isCloudWorkspace && <>
          <Button variant="outline" size="sm" onClick={() => void window.appflowy.dialog.pickDirectory()}>{tr('settings.manageDataPage.dataStorage.actions.change')}</Button>
          <Tooltip message={tr('settings.manageDataPage.dataStorage.actions.resetTooltip')}><Button variant="outline" size="sm" onClick={resetToDefault}><RotateCcw className="size-4" />{tr('settings.common.reset')}</Button></Tooltip>
        </>}
        </>}>
          {path === null ? <Spinner /> : <CurrentPath path={path} />}
        </SettingsRow></SettingsGroup>
      </SettingsSection>
      <SettingsSection title={<Tooltip message={tr('settings.manageDataPage.importData.tooltip')}><span>{tr('settings.manageDataPage.importData.title')}</span></Tooltip>}><SettingsGroup><SettingsRow label={tr('settings.manageDataPage.importData.description')} control={<Button variant="outline" size="sm" onClick={() => void importData()}>{tr('settings.manageDataPage.importData.action')}</Button>} /></SettingsGroup></SettingsSection>
      {isDebugBuild() && <SettingsSection title={tr('settings.files.exportData')}><SettingsGroup><SettingsRow label={tr('settings.manageDataPage.data.fixYourData')} description={tr('settings.manageDataPage.data.fixYourDataDescription')} control={<Button variant="outline" size="sm" onClick={() => void checkViewHealth(true)}>{tr('settings.manageDataPage.data.fixButton')}</Button>} /></SettingsGroup></SettingsSection>}
      <SettingsSection title={tr('workspace.errorActions.exportLogFiles')}><SettingsGroup><SettingsRow label={tr('workspace.errorActions.exportLogFiles')} control={<Button variant="outline" size="sm" onClick={() => void shareLogFiles()}>{tr('settings.files.export')}</Button>} /></SettingsGroup></SettingsSection>
      <SettingsSection title={tr('settings.manageDataPage.cache.title')}><SettingsGroup><SettingsRow label={tr('settings.manageDataPage.cache.description')} control={<Button variant="outline" size="sm" onClick={clearCache}>{tr('settings.manageDataPage.cache.title')}</Button>} /></SettingsGroup></SettingsSection>
    </>
  );
}
