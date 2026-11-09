// Shared section (features/shared_section/**), behind FeatureFlag.sharedSection (KV
// "featureFlag" JSON, default off).
import { fromBinary } from '@bufbuild/protobuf';
import { useEffect, useRef, useState } from 'react';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import { AFAccessLevelPB, RepeatedSharedViewResponsePBSchema, ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { FolderEventGetSharedViews, FolderEventRemoveUserFromSharedPage, UserEventGetUserProfile } from '@/backend/events';
import { NotificationSource, listen } from '@/backend/notifications';
import { useTr } from '@/i18n';
import { KVKeys, KeyValueStorage } from '@/startup/kv';
import {
  AFButton,
  AppFlowyPopover,
  FlowySvg,
  FlowyText,
  Spinner,
  VSpace,
  showAFTextFieldDialog,
  showConfirmDialog,
  type PopoverController,
} from '@/ui';
import { tabsActions } from '@/features/tabs/tabs-store';
import { nameOrDefault } from '@/features/view/view-ext';
import { ViewBackendService } from '@/features/view/view-service';
import { SbIconButton } from '../components';
import { openFromSidebar } from '../folder/SidebarFolder';
import { favoriteActions } from '../stores/favorite-store';
import type { ViewBloc } from '../stores/view-bloc';
import { ViewItem } from '../view/ViewItem';

export function isSharedSectionOn(): boolean {
  try {
    return KeyValueStorage.getJson<Record<string, unknown>>(KVKeys.featureFlag)?.sharedSection === true;
  } catch {
    return false;
  }
}

interface SharedPage {
  view: ViewPB;
  accessLevel: AFAccessLevelPB;
}

/** SharedSectionBloc: initial fetch, DidUpdateSharedViews, and a 30 s poll. */
function useSharedSection(workspaceId: string) {
  const [state, setState] = useState<{ sharedPages: SharedPage[]; isLoading: boolean; errorMessage: string; isExpanded: boolean }>({
    sharedPages: [],
    isLoading: false,
    errorMessage: '',
    isExpanded: true,
  });
  useEffect(() => {
    let alive = true;
    const fetchPages = async (): Promise<{ pages: SharedPage[] } | { error: string }> => {
      const result = await FolderEventGetSharedViews();
      if (!result.ok) return { error: result.error.msg };
      return { pages: result.value.sharedViews.filter((s) => s.view).map((s) => ({ view: s.view!, accessLevel: s.accessLevel })) };
    };
    const refresh = async (silent: boolean) => {
      if (!silent) setState((s) => ({ ...s, isLoading: true, errorMessage: '' }));
      const result = await fetchPages();
      if (!alive) return;
      setState((s) =>
        'pages' in result
          ? { ...s, sharedPages: result.pages, isLoading: false }
          : { ...s, errorMessage: result.error, isLoading: false },
      );
    };
    const stop = listen<FolderNotification>(
      NotificationSource.Folder,
      (ty, result) => {
        if (ty !== FolderNotification.DidUpdateSharedViews || !result.ok) return;
        const pb = fromBinary(RepeatedSharedViewResponsePBSchema, result.value);
        setState((s) => ({
          ...s,
          sharedPages: pb.sharedViews.filter((v) => v.view).map((v) => ({ view: v.view!, accessLevel: v.accessLevel })),
        }));
      },
      workspaceId,
    );
    const timer = window.setInterval(() => void refresh(true), 30_000);
    void refresh(false);
    return () => {
      alive = false;
      stop();
      window.clearInterval(timer);
    };
  }, [workspaceId]);

  const leave = async (pageId: string) => {
    const profile = await UserEventGetUserProfile();
    if (!profile.ok) return;
    const result = await FolderEventRemoveUserFromSharedPage({ viewId: pageId, emails: [profile.value.email] });
    setState((s) =>
      result.ok ? { ...s, sharedPages: s.sharedPages.filter((p) => p.view.id !== pageId) } : { ...s, errorMessage: result.error.msg },
    );
  };
  const toggle = () => setState((s) => ({ ...s, isExpanded: !s.isExpanded }));
  return { state, leave, toggle };
}

export function SharedSection({ workspaceId }: { workspaceId: string }) {
  const { tr } = useTr();
  const { state, leave, toggle } = useSharedSection(workspaceId);
  if (state.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Spinner color="var(--af-icon-primary)" />
      </div>
    );
  }
  if (state.errorMessage) {
    return (
      <div style={{ padding: 16, fontSize: 'calc(14px * var(--text-scale, 1))', lineHeight: '20px', fontWeight: 500, color: 'var(--af-text-warning)' }}>
        {state.errorMessage}
      </div>
    );
  }
  if (state.sharedPages.length === 0) return null;
  const firstId = state.sharedPages[0].view.id;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <AFButton
        variant="ghostPrimary"
        size="l"
        fullWidth
        justify="flex-start"
        padding="6px 4px"
        borderRadius={6}
        icon={<FlowySvg svg="shared_with_me_m" color="#3267D1" />}
        iconGap={8}
        text={tr('shareSection.shared')}
        onTap={toggle}
      />
      {state.isExpanded &&
        state.sharedPages.map((page) => (
          <ViewItem
            key={page.view.id}
            spaceType="public"
            isFirstChild={page.view.id === firstId}
            view={page.view}
            level={0}
            isDraggable={false}
            leftPadding={16}
            isFeedback={false}
            onSelected={openFromSidebar}
            onTertiarySelected={(v) => tabsActions.openViewInNewTab(v)}
            rightIconsBuilder={(view, bloc) => (
              <>
                <SharedPageActionsButton view={view} accessLevel={page.accessLevel} bloc={bloc} onLeave={() => void leave(view.id)} />
                <div style={{ width: 4 }} />
              </>
            )}
          />
        ))}
      <VSpace size={16} />
    </div>
  );
}

type SharedAction = 'favorite' | 'unFavorite' | 'leaveSharedPage' | 'divider' | 'rename' | 'changeIcon' | 'delete' | 'openInNewTab';

/** SharedPageActionsButton: changeIcon and delete are no-ops in Flutter (BUG-COMPAT). */
function SharedPageActionsButton({
  view,
  accessLevel,
  bloc,
  onLeave,
}: {
  view: ViewPB;
  accessLevel: AFAccessLevelPB;
  bloc: ViewBloc;
  onLeave: () => void;
}) {
  const { tr } = useTr();
  const controller = useRef<PopoverController>(null);
  const actions: SharedAction[] = [view.isFavorite ? 'unFavorite' : 'favorite', 'leaveSharedPage'];
  if (accessLevel !== AFAccessLevelPB.ReadOnly) {
    actions.push('divider', 'rename');
    if (view.layout !== ViewLayoutPB.Chat) actions.push('changeIcon');
    if (accessLevel === AFAccessLevelPB.FullAccess) actions.push('delete');
  }
  actions.push('divider', 'openInNewTab');
  const meta: Record<Exclude<SharedAction, 'divider'>, [string, FlowySvgName]> = {
    favorite: [tr('disclosureAction.favorite'), 'favorite_s'],
    unFavorite: [tr('disclosureAction.unfavorite'), 'unfavorite_s'],
    leaveSharedPage: ['Leave', 'leave_workspace_s'],
    rename: [tr('disclosureAction.rename'), 'view_item_rename_s'],
    changeIcon: [tr('disclosureAction.changeIcon'), 'change_icon_s'],
    delete: [tr('disclosureAction.delete'), 'trash_s'],
    openInNewTab: [tr('disclosureAction.openNewTab'), 'view_item_open_in_new_tab_s'],
  };
  const run = (action: SharedAction) => {
    switch (action) {
      case 'favorite':
      case 'unFavorite':
        void favoriteActions.toggle(view);
        break;
      case 'leaveSharedPage':
        showConfirmDialog({ title: 'Remove your own access', description: '', style: 'cancelAndOk', confirmLabel: 'Remove', onConfirm: onLeave });
        break;
      case 'rename':
        showAFTextFieldDialog({
          title: tr('disclosureAction.rename'),
          initialValue: nameOrDefault(view),
          maxLength: 256,
          onConfirm: (name) => void ViewBackendService.updateView({ viewId: view.id, name }),
        });
        break;
      case 'openInNewTab':
        tabsActions.openViewInNewTab(view);
        break;
      default:
        break;
    }
  };
  return (
    <AppFlowyPopover
      controllerRef={controller}
      trigger="none"
      plain
      direction="bottomWithLeftAligned"
      offset={{ x: 98, y: 8 }}
      onClose={() => bloc.setIsEditing(false)}
      popup={(close) => (
        <div
          style={{
            width: 240,
            padding: 8,
            borderRadius: 12,
            background: 'var(--th-card)',
            boxShadow: 'var(--af-shadow-medium)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {actions.map((action, index) => {
            if (action === 'divider') {
              return index === 0 ? null : <div key={index} style={{ height: 1, margin: '4px 0', background: 'var(--af-border-primary)' }} />;
            }
            const [name, icon] = meta[action];
            const danger = action === 'delete';
            return (
              <div
                key={action}
                className="af-menu-item"
                onClick={() => {
                  run(action);
                  close();
                }}
              >
                <FlowySvg svg={icon} size={16} color={danger ? 'var(--cs-error)' : undefined} />
                <FlowyText color={danger ? 'var(--cs-error)' : 'var(--af-text-primary)'} lineHeight={20} style={{ flex: 1 }}>
                  {name}
                </FlowyText>
              </div>
            );
          })}
        </div>
      )}
    >
      <div style={{ display: 'flex' }}>
        <SbIconButton
          width={24}
          icon={<FlowySvg svg="workspace_three_dots_s" />}
          onPressed={() => {
            bloc.setIsEditing(true);
            controller.current?.show();
          }}
        />
      </div>
    </AppFlowyPopover>
  );
}
