import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { UserEventChangeWorkspaceIcon, UserEventRenameWorkspace } from '@/backend/events';
import { useTr } from '@/i18n';
import { AppFlowyPopover, Spinner, showConfirmDialog, showToast } from '@/ui';
import { Button } from '@/components/ui/button';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { EmojiPicker } from '../emoji/EmojiPicker';
import { LanguageDropdown } from '../LanguageDropdown';
import type { SettingsPageProps } from '../page-props';
import { deleteWorkspace, fetchWorkspaces, leaveWorkspace } from '../settings-workspace-store';
import { SettingsBody } from '../shared';
import { SettingsInputField } from '../shared-widgets';
import {
  AppearanceSelector,
  DateTimeSettings,
  DocumentColorSetting,
  DocumentWidthSetting,
  EnableRTLItemsSwitcher,
  FontSelectorDropdown,
  LayoutDirectionSelect,
  TextDirectionSelect,
  ThemeDropdown,
} from './appearance-controls';
import { workspaceIconColors } from './appearance-utils';

/** WorkspaceSettingsBloc (workspace/application/settings/workspace/workspace_settings_bloc.dart). */
const useWorkspaceSettingsStore = create<{ workspace: UserWorkspacePB | null }>(() => ({ workspace: null }));

async function initialWorkspaceSettings() {
  useWorkspaceSettingsStore.setState({ workspace: null });
  const { current } = await fetchWorkspaces();
  useWorkspaceSettingsStore.setState({ workspace: current });
}

async function updateWorkspaceName(name: string) {
  const workspace = useWorkspaceSettingsStore.getState().workspace;
  if (!workspace) return;
  const result = await UserEventRenameWorkspace({ workspaceId: workspace.workspaceId, newName: name });
  if (result.ok) useWorkspaceSettingsStore.setState({ workspace: { ...workspace, name } });
  else console.error(result.error.msg);
}

async function updateWorkspaceIcon(icon: string) {
  const workspace = useWorkspaceSettingsStore.getState().workspace;
  if (!workspace) return;
  const result = await UserEventChangeWorkspaceIcon({ workspaceId: workspace.workspaceId, newIcon: icon });
  if (result.ok) useWorkspaceSettingsStore.setState({ workspace: { ...workspace, icon } });
  else console.error(result.error.msg);
}

/** _WorkspaceNameSetting: owners edit (300 ms debounce, Enter saves now); others read. */
function WorkspaceNameSetting({ role }: { role: AFRolePB | null }) {
  const name = useWorkspaceSettingsStore((s) => s.workspace?.name ?? '');
  const [text, setText] = useState(name);
  const saving = useRef(false);
  const debounce = useRef<number>(undefined);
  useEffect(() => {
    if (!saving.current && name !== text) setText(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  useEffect(() => () => window.clearTimeout(debounce.current), []);

  if (role !== AFRolePB.Owner) {
    return (
      <span className="text-sm">{text}</span>
    );
  }
  const save = (value: string) => {
    if (value !== '') void updateWorkspaceName(value);
  };
  return (
    <SettingsInputField
      value={text}
      text={text}
      setText={setText}
      hideActions
      onSave={(value) => save(value)}
      onChanged={(value) => {
        saving.current = true;
        window.clearTimeout(debounce.current);
        debounce.current = window.setTimeout(() => {
          save(value);
          saving.current = false;
        }, 300);
      }}
    />
  );
}

/** WorkspaceIcon (sidebar/workspace/_sidebar_workspace_icon.dart) at 64px, radius 18. */
function WorkspaceIcon({ workspace }: { workspace: UserWorkspacePB }) {
  const [text, background] = workspaceIconColors(workspace.name);
  return <div className="flex size-12 items-center justify-center rounded-md" style={{ background: workspace.icon ? undefined : background }}>
    {workspace.icon ? <span className="text-2xl leading-none">{workspace.icon}</span> : <span className="text-2xl font-semibold" style={{ color: text }}>{workspace.name.substring(0, 1)}</span>}
  </div>;
}

/** _WorkspaceIconSetting: only owners can open the emoji picker. */
function WorkspaceIconSetting({ enableEdit }: { enableEdit: boolean }) {
  const workspace = useWorkspaceSettingsStore((s) => s.workspace);
  if (!workspace) return <Spinner size={20} />;
  if (!enableEdit) {
    return (
      <div className="pointer-events-none inline-flex">
        <WorkspaceIcon workspace={workspace} />
      </div>
    );
  }
  return (
    <div className="inline-flex">
      <AppFlowyPopover
        direction="bottomWithLeftAligned"
        constraints={{ maxWidth: 364, maxHeight: 356 }}
        margin={0}
        popup={(close) => (
          <EmojiPicker
            width={364}
            height={356}
            onSelected={(emoji) => {
              void updateWorkspaceIcon(emoji);
              close();
            }}
          />
        )}
      >
        <button type="button" className="inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring" aria-label="Change icon">
          <WorkspaceIcon workspace={workspace} />
        </button>
      </AppFlowyPopover>
    </div>
  );
}

/** SettingsWorkspaceView (pages/settings_workspace_view.dart). */
export function WorkspacePage({ user, role, closeDialog, restartApp }: SettingsPageProps) {
  const { tr } = useTr();
  const isOwner = role === AFRolePB.Owner;
  const showWorkspace = user.workspaceType !== WorkspaceTypePB.LocalW;
  const [, rebuild] = useState(0);

  useEffect(() => void initialWorkspaceSettings(), []);

  const manageWorkspace = () =>
    showConfirmDialog({
      title: tr(isOwner ? 'settings.workspacePage.deleteWorkspacePrompt.title' : 'settings.workspacePage.leaveWorkspacePrompt.title'),
      description: tr(isOwner ? 'settings.workspacePage.deleteWorkspacePrompt.content' : 'settings.workspacePage.leaveWorkspacePrompt.content'),
      style: 'cancelAndOk',
      onConfirm: async () => {
        const workspace = useWorkspaceSettingsStore.getState().workspace;
        if (!workspace) return;
        // The view listener pops the settings dialog, then UserWorkspaceBloc handles the event.
        closeDialog();
        const switched = isOwner ? await deleteWorkspace(workspace.workspaceId) : await leaveWorkspace(workspace.workspaceId);
        // Deliberate deviation: the home screen is reloaded with runAppFlowy() so it opens
        // the remaining workspace (the Dart home rebuilds from UserWorkspaceBloc state).
        if (switched) restartApp();
      },
    });

  return <SettingsBody title={tr('settings.workspacePage.title')} description={tr('settings.workspacePage.description')} autoSeparate={false}>
    {showWorkspace && <SettingsSection key="workspace"><SettingsGroup>
      <SettingsRow label={tr('settings.workspacePage.workspaceName.title')}><WorkspaceNameSetting role={role} /></SettingsRow>
      <SettingsRow label={tr('settings.workspacePage.workspaceIcon.title')} description={tr('settings.workspacePage.workspaceIcon.description')} control={<WorkspaceIconSetting enableEdit={isOwner} />} />
    </SettingsGroup></SettingsSection>}
    <SettingsSection key="appearance" title={tr('settings.workspacePage.appearance.title')} description={tr('settings.workspacePage.theme.description')}>
      <SettingsGroup><div className="p-4"><AppearanceSelector /></div></SettingsGroup>
      <SettingsGroup>
        <ThemeDropdown onUploaded={() => { showToast({ message: tr('settings.appearance.themeUpload.uploadSuccess') }); rebuild((n) => n + 1); }} />
        <DocumentColorSetting kind="cursor" /><DocumentColorSetting kind="selection" /><DocumentWidthSetting />
      </SettingsGroup>
    </SettingsSection>
    <SettingsSection key="text"><SettingsGroup>
      <FontSelectorDropdown /><TextDirectionSelect /><EnableRTLItemsSwitcher /><LayoutDirectionSelect />
      <SettingsRow label={tr('settings.workspacePage.language.title')} control={<LanguageDropdown />} />
    </SettingsGroup></SettingsSection>
    <DateTimeSettings key="datetime" />
    {showWorkspace && <SettingsSection key="manage" title={tr('settings.workspacePage.manageWorkspace.title')}><SettingsGroup className="border-destructive/30"><SettingsRow
      label={tr(isOwner ? 'settings.workspacePage.deleteWorkspacePrompt.title' : 'settings.workspacePage.leaveWorkspacePrompt.title')}
      description={tr(isOwner ? 'settings.workspacePage.deleteWorkspacePrompt.content' : 'settings.workspacePage.leaveWorkspacePrompt.content')}
      destructive control={<Button variant="destructive" size="sm" onClick={manageWorkspace}>{tr(isOwner ? 'settings.workspacePage.manageWorkspace.deleteWorkspace' : 'settings.workspacePage.manageWorkspace.leaveWorkspace')}</Button>} /></SettingsGroup></SettingsSection>}
  </SettingsBody>;
}
