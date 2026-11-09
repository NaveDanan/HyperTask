import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserWorkspacePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { UserEventChangeWorkspaceIcon, UserEventRenameWorkspace } from '@/backend/events';
import { useTr } from '@/i18n';
import { AppFlowyPopover, FlowyText, Spinner, VSpace, showConfirmDialog, showToast } from '@/ui';
import { EmojiPicker } from '../emoji/EmojiPicker';
import { LanguageDropdown } from '../LanguageDropdown';
import type { SettingsPageProps } from '../page-props';
import { deleteWorkspace, fetchWorkspaces, leaveWorkspace } from '../settings-workspace-store';
import { SettingsBody, SettingsCategory, SettingsCategorySpacer } from '../shared';
import { SettingsDashedDivider, SettingsInputField, SingleSettingAction } from '../shared-widgets';
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
      <div style={{ padding: '2.5px 0' }}>
        <FlowyText>{text}</FlowyText>
      </div>
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
  return (
    <div
      style={{
        width: 64,
        height: 64,
        borderRadius: 18,
        background: workspace.icon ? undefined : background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {workspace.icon ? (
        <span style={{ fontSize: 24, lineHeight: 1 }}>{workspace.icon}</span>
      ) : (
        <FlowyText fontSize={24} fontWeight={600} lineHeight={26} color={text}>
          {workspace.name.substring(0, 1)}
        </FlowyText>
      )}
    </div>
  );
}

/** _WorkspaceIconSetting: only owners can open the emoji picker. */
function WorkspaceIconSetting({ enableEdit }: { enableEdit: boolean }) {
  const workspace = useWorkspaceSettingsStore((s) => s.workspace);
  if (!workspace) return <Spinner size={64} />;
  if (!enableEdit) {
    return (
      <div style={{ pointerEvents: 'none', display: 'inline-flex' }}>
        <WorkspaceIcon workspace={workspace} />
      </div>
    );
  }
  return (
    <div style={{ display: 'inline-flex' }}>
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
        <div style={{ cursor: 'pointer', display: 'inline-flex' }}>
          <WorkspaceIcon workspace={workspace} />
        </div>
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

  return (
    <SettingsBody title={tr('settings.workspacePage.title')} description={tr('settings.workspacePage.description')} autoSeparate={false}>
      {showWorkspace && [
        <SettingsCategory key="name" title={tr('settings.workspacePage.workspaceName.title')}>
          <WorkspaceNameSetting role={role} />
        </SettingsCategory>,
        <SettingsCategorySpacer key="s1" />,
        <SettingsCategory key="icon" title={tr('settings.workspacePage.workspaceIcon.title')} description={tr('settings.workspacePage.workspaceIcon.description')}>
          <WorkspaceIconSetting enableEdit={isOwner} />
        </SettingsCategory>,
        <SettingsCategorySpacer key="s2" />,
      ]}
      <SettingsCategory key="appearance" title={tr('settings.workspacePage.appearance.title')}>
        <AppearanceSelector />
      </SettingsCategory>
      <VSpace key="v1" size={16} />
      <SettingsCategory key="theme" title={tr('settings.workspacePage.theme.title')} description={tr('settings.workspacePage.theme.description')}>
        <ThemeDropdown
          onUploaded={() => {
            showToast({ message: tr('settings.appearance.themeUpload.uploadSuccess') });
            rebuild((n) => n + 1);
          }}
        />
        <DocumentColorSetting kind="cursor" />
        <DocumentColorSetting kind="selection" />
        <DocumentWidthSetting />
      </SettingsCategory>
      <SettingsCategorySpacer key="s3" />
      <SettingsCategory key="font" title={tr('settings.workspacePage.workspaceFont.title')}>
        <FontSelectorDropdown />
        <SettingsDashedDivider color="var(--cs-outline)" />
        <SettingsCategory title={tr('settings.workspacePage.textDirection.title')}>
          <TextDirectionSelect />
          <EnableRTLItemsSwitcher />
        </SettingsCategory>
      </SettingsCategory>
      <VSpace key="v2" size={16} />
      <SettingsCategory key="layout" title={tr('settings.workspacePage.layoutDirection.title')}>
        <LayoutDirectionSelect />
      </SettingsCategory>
      <SettingsCategorySpacer key="s4" />
      <DateTimeSettings key="datetime" />
      <SettingsCategorySpacer key="s5" />
      <SettingsCategory key="language" title={tr('settings.workspacePage.language.title')}>
        <LanguageDropdown />
      </SettingsCategory>
      <SettingsCategorySpacer key="s6" />
      {showWorkspace && (
        <SingleSettingAction
          key="manage"
          label={tr('settings.workspacePage.manageWorkspace.title')}
          fontSize={16}
          fontWeight={600}
          buttonType="danger"
          buttonLabel={tr(isOwner ? 'settings.workspacePage.manageWorkspace.deleteWorkspace' : 'settings.workspacePage.manageWorkspace.leaveWorkspace')}
          onPressed={manageWorkspace}
        />
      )}
    </SettingsBody>
  );
}
