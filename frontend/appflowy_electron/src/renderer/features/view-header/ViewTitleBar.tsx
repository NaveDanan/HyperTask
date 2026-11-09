import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { useStore } from 'zustand';
import { useTr } from '@/i18n';
import { useBrightness } from '@/theme/appearance-store';
import { AppFlowyPopover, FlowyButton, FlowySvg, FlowyText, Tooltip, showToast } from '@/ui';
import { trashPlugin } from '../tabs/plugin';
import { tabsActions, useTabsStore } from '../tabs/tabs-store';
import { SpacePermission, isSpace, spaceIcon, spaceIconColor, spacePermission } from '../view/view-ext';
import { buildBreadcrumbs } from './breadcrumbs';
import { useCurrentWorkspace } from './current-workspace';
import { argbToCss, findSvgContent, useIconGroups } from './icon-groups';
import { SharedSectionType, isEditable as accessIsEditable, type PageAccessLevelState } from './page-access-level-store';
import { RenameViewPopover } from './RenameViewPopover';
import { RawEmojiIcon, SvgString, viewIcon } from './ViewIcon';
import { listenView } from './view-listener';
import { usePageAccessLevel, useViewScope } from './view-scope';
import { createViewTitleBarStore } from './view-title-bar-store';
import { FlowySvgs, type FlowySvgName } from '@/icons/flowy-svgs';

/** Opens the Trash tab and clears the sidebar selection (MenuSharedState.latestOpenView = null). */
export function openTrash() {
  useTabsStore.setState({ latestOpenView: null });
  tabsActions.openPlugin(trashPlugin());
}

/** ViewTitleBar (workspace/presentation/widgets/view_title_bar.dart): `space › ... › page`. */
export function ViewTitleBar({ view }: { view: ViewPB }) {
  const [store] = useState(() => createViewTitleBarStore(view.id));
  useEffect(() => store.start(), [store]);
  const { ancestors, isDeleted } = useStore(store);
  const access = usePageAccessLevel();
  const scope = useViewScope();
  const workspace = useCurrentWorkspace();
  const role = workspace?.oneOfRole.case === 'role' ? workspace.oneOfRole.value : undefined;

  // Section type follows the first space ancestor's permission unless the page is shared.
  useEffect(() => {
    const space = ancestors.find((a) => isSpace(a));
    if (!space || !scope) return;
    const sectionType = spacePermission(space) === SpacePermission.publicToAll ? SharedSectionType.public : SharedSectionType.private;
    if (scope.accessLevel.getState().sectionType !== SharedSectionType.shared) scope.accessLevel.updateSectionType(sectionType);
  }, [ancestors, scope]);

  const { crumbs, showSection } = useMemo(
    () =>
      buildBreadcrumbs(ancestors, {
        isDeleted,
        isGuest: role === AFRolePB.Guest,
        isEditable: access ? accessIsEditable(access) : true,
      }),
    [ancestors, isDeleted, role, access],
  );

  if (ancestors.length === 0) return null;
  const reload = () => void store.reload();
  return (
    <div className="view-title-bar" style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', minWidth: 0 }}>
      <div style={{ height: 24, display: 'flex', alignItems: 'center', width: 'max-content' }}>
        {crumbs.map((crumb, index) => {
          switch (crumb.type) {
            case 'trash':
              return <TrashBreadcrumb key="trash" />;
            case 'divider':
              return <FlowySvg key={`d${index}`} svg="title_bar_divider_s" />;
            case 'ellipsis':
              return (
                <FlowyText.regular key="ellipsis" style={{ whiteSpace: 'pre' }}>
                  {' ... '}
                </FlowyText.regular>
              );
            default:
              return (
                <Tooltip key={crumb.view.id} message={crumb.view.name}>
                  <ViewTitle view={crumb.view} editable={crumb.editable} onUpdated={reload} />
                </Tooltip>
              );
          }
        })}
        {showSection && (
          <>
            <div style={{ width: 4, flexShrink: 0 }} />
            <SectionChip access={access} workspaceType={workspace?.workspaceType} workspaceName={workspace?.name} />
          </>
        )}
        <div style={{ width: 8, flexShrink: 0 }} />
        <LockPageStatus />
      </div>
    </div>
  );
}

function SectionChip({
  access,
  workspaceType,
  workspaceName,
}: {
  access: PageAccessLevelState | null;
  workspaceType: WorkspaceTypePB | undefined;
  workspaceName: string | undefined;
}) {
  // Hidden for local workspaces (the default in this checkout) and while the workspace loads.
  if (workspaceType === undefined || workspaceType === WorkspaceTypePB.LocalW || !access) return null;
  const type = access.sectionType;
  if (type === SharedSectionType.unknown) return null;
  const icon =
    type === SharedSectionType.public
      ? 'public_section_icon_m'
      : type === SharedSectionType.private
        ? 'private_section_icon_m'
        : 'shared_section_icon_m';
  const text = type === SharedSectionType.public ? 'Team space' : type === SharedSectionType.private ? 'Private' : 'Shared';
  const tooltip =
    type === SharedSectionType.public
      ? `Everyone at ${workspaceName} has access`
      : type === SharedSectionType.private
        ? 'Only you have access'
        : '';
  return (
    <Tooltip message={tooltip}>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ width: 4 }} />
        <FlowySvg svg={icon} size={20} color="var(--af-icon-tertiary)" />
        <div style={{ width: 4 }} />
        <span style={{ fontSize: 'calc(12px * var(--text-scale, 1))', lineHeight: '18px', fontWeight: 500, color: 'var(--af-text-tertiary)' }}>
          {text}
        </span>
        <div style={{ width: 4 }} />
      </div>
    </Tooltip>
  );
}

/** TrashBreadcrumb: opens the Trash. */
export function TrashBreadcrumb() {
  const { tr } = useTr();
  return (
    <FlowyButton
      useIntrinsicWidth
      margin="0 6px"
      height={24}
      onTap={openTrash}
      text={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <FlowySvg svg="trash_s" size={14} />
          <div style={{ width: 4 }} />
          <FlowyText.regular fontSize={14} lineHeight={18} ellipsis>
            {tr('trash.text')}
          </FlowyText.regular>
        </div>
      }
    />
  );
}

/** SpaceIcon (menu/sidebar/space/space_icon.dart) at the breadcrumb size, when the space has one. */
function BreadcrumbSpaceIcon({ space }: { space: ViewPB }) {
  const groups = useIconGroups();
  const icon = spaceIcon(space);
  const color = spaceIconColor(space);
  if (!icon || !color) return null;
  let svg: ReactNode = null;
  if (icon.includes('space_icon')) {
    // Before 0.6.7: a bundled 16x asset, drawn unsized and clipped by the 14px box.
    const name = `${icon}_s` as FlowySvgName;
    if (!(name in FlowySvgs)) return null;
    svg = <FlowySvg svg={name} size={14} color="var(--cs-surface)" />;
  } else {
    const [group, name] = icon.split('/');
    const content = name ? findSvgContent(groups, group, name) : null;
    if (!content) return null;
    svg = <SvgString svg={content} size={8.5} color="var(--cs-surface)" />;
  }
  return (
    <>
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: argbToCss(color) ?? 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {svg}
      </div>
      <div style={{ width: 6, flexShrink: 0 }} />
    </>
  );
}

/** ViewTitle + ViewTitleBloc: one crumb, live-updated from DidUpdateView. */
export function ViewTitle({ view, editable, onUpdated }: { view: ViewPB; editable: boolean; onUpdated: () => void }) {
  const { tr } = useTr();
  const [current, setCurrent] = useState(view);
  useEffect(() => {
    setCurrent(view);
    return listenView(view.id, {
      onViewUpdated: (updated) => {
        setCurrent(updated);
        onUpdated();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const icon = viewIcon(current);
  const name = current.name || view.name;
  const iconAndName = (isEditable: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
      {icon && (
        <>
          <RawEmojiIcon icon={icon} size={14} />
          <div style={{ width: 4, flexShrink: 0 }} />
        </>
      )}
      {isSpace(current) && <BreadcrumbSpaceIcon space={current} />}
      <FlowyText.regular fontSize={14} lineHeight={18} ellipsis style={{ opacity: isEditable ? 1 : 0.5 }}>
        {name || tr('menuAppHeader.defaultNewPageName')}
      </FlowyText.regular>
    </div>
  );

  if (view.parentViewId === '') {
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <FlowyText.regular>{current.name}</FlowyText.regular>
        <div style={{ width: 4 }} />
      </div>
    );
  }
  if (isSpace(view)) {
    return <div style={{ margin: '0 6px', display: 'flex', alignItems: 'center' }}>{iconAndName(false)}</div>;
  }
  if (!editable) {
    return (
      <div style={{ display: 'flex' }} onMouseDown={() => tabsActions.openView(view)}>
        <FlowyButton useIntrinsicWidth margin="0 6px" height={24} text={iconAndName(false)} />
      </div>
    );
  }
  // Wrapped in a real element so the crumb tooltip has an anchor.
  return (
    <div style={{ display: 'flex' }}>
      <AppFlowyPopover
        constraints={{ maxWidth: 300, maxHeight: 44 }}
        direction="bottomWithLeftAligned"
        offset={{ x: 0, y: 6 }}
        popup={() => <RenameViewPopover view={view} name={view.name} icon={icon} />}
      >
        <FlowyButton useIntrinsicWidth margin="0 6px" height={24} text={iconAndName(true)} />
      </AppFlowyPopover>
    </div>
  );
}

/** _buildLockPageStatus: "Locked" / "Re-lock" chips and the locked toast. */
function LockPageStatus() {
  const { tr } = useTr();
  const scope = useViewScope();
  const access = usePageAccessLevel();
  const light = useBrightness() === 'light';

  // listenWhen: prev.isLoadingLockStatus == curr.isLoadingLockStatus && !curr.isLoadingLockStatus.
  useEffect(() => {
    if (!scope) return;
    return scope.accessLevel.subscribe((curr, prev) => {
      if (prev.isLoadingLockStatus === curr.isLoadingLockStatus && !curr.isLoadingLockStatus && curr.isLocked) {
        showToast({ message: tr('lockPage.pageLockedToast') });
      }
    });
  }, [scope, tr]);

  if (!scope || !access) return null;
  const background = light ? 'rgba(255,255,255,0.75)' : '#1B1A22B2';
  if (access.isLocked) {
    const color = '#D95A0B';
    return (
      <Tooltip message={tr('lockPage.lockTooltip')}>
        <div style={{ border: `1px solid ${color}`, borderRadius: 6, background, flexShrink: 0, display: 'flex' }}>
          <FlowyButton
            useIntrinsicWidth
            margin={4}
            iconPadding={4}
            hoverColor="rgba(217,90,11,0.1)"
            leftIcon={<FlowySvg svg="lock_page_fill_s" blendMode={null} />}
            text={
              <FlowyText.regular fontSize={12} color={color}>
                {tr('lockPage.lockPage')}
              </FlowyText.regular>
            }
            onTap={() => void scope.accessLevel.unlock()}
          />
        </div>
      </Tooltip>
    );
  }
  if (access.lockCounter > 0) {
    return (
      <div style={{ border: '1px solid #8F959E', borderRadius: 6, background, flexShrink: 0, display: 'flex' }}>
        <FlowyButton
          useIntrinsicWidth
          margin={4}
          iconPadding={4}
          leftIcon={<FlowySvg svg="unlock_page_s" blendMode={null} />}
          text={<FlowyText.regular fontSize={12}>{tr('lockPage.reLockPage')}</FlowyText.regular>}
          onTap={() => void scope.accessLevel.lock()}
        />
      </div>
    );
  }
  return null;
}
