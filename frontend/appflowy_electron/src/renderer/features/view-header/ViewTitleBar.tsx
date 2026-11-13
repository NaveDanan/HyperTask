import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { useStore } from 'zustand';
import { useTr } from '@/i18n';
import { Globe, Lock, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/reui/badge';
import { FlowySvg } from '@/icons/FlowySvg';
import { cn } from '@/lib/utils';
import { AppFlowyPopover, Tooltip, showToast } from '@/ui';
import { HyperLayoutIcon } from '../plugins/PlaceholderPage';
import { trashPlugin } from '../tabs/plugin';
import { tabsActions, useTabsStore } from '../tabs/tabs-store';
import { SpacePermission, isSpace, spaceIcon, spaceIconColor, spacePermission } from '../view/view-ext';
import { buildBreadcrumbs } from './breadcrumbs';
import { useCurrentWorkspace } from './current-workspace';
import { argbToCss, findSvgContent, useIconGroups } from './icon-groups';
import { SharedSectionType, isEditable as accessIsEditable, type PageAccessLevelState } from './page-access-level-store';
import { RenameViewPopover } from './RenameViewPopover';
import { RawEmojiIcon, SvgString, viewIcon } from './ViewIcon';
import { useHyperAppearanceView } from '../view-appearance/HyperViewAppearanceView';
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
    <Breadcrumb className="view-title-bar min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
      <BreadcrumbList className="w-max flex-nowrap gap-0.5 text-sm">
        {crumbs.map((crumb, index) => {
          switch (crumb.type) {
            case 'trash':
              return <BreadcrumbItem key="trash"><TrashBreadcrumb /></BreadcrumbItem>;
            case 'divider':
              return <BreadcrumbSeparator key={`d${index}`} className="text-muted-foreground/60" />;
            case 'ellipsis':
              return (
                <BreadcrumbItem key="ellipsis">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 px-1.5" />}><BreadcrumbEllipsis /></DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56">
                      {ancestors.filter((ancestor, i) => i > 0 && !(role === AFRolePB.Guest && isSpace(ancestor)) && !crumbs.some((c) => c.type === 'title' && c.view.id === ancestor.id)).map((ancestor) => (
                        <DropdownMenuItem key={ancestor.id} onMouseDown={() => tabsActions.openView(ancestor)}>{ancestor.name}</DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </BreadcrumbItem>
              );
            default:
              return (
                <BreadcrumbItem key={crumb.view.id} className={cn(crumb.view.id === ancestors[ancestors.length - 1]?.id && '[&_button]:font-medium [&_button]:text-foreground')}>
                  <Tooltip message={crumb.view.name}><ViewTitle view={crumb.view} editable={crumb.editable} onUpdated={reload} /></Tooltip>
                </BreadcrumbItem>
              );
          }
        })}
        {showSection && <BreadcrumbItem className="ml-1"><SectionChip access={access} workspaceType={workspace?.workspaceType} workspaceName={workspace?.name} /></BreadcrumbItem>}
        <BreadcrumbItem className="ml-2"><LockPageStatus /></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
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
  const Icon = type === SharedSectionType.public ? Globe : type === SharedSectionType.private ? Lock : Users;
  const text = type === SharedSectionType.public ? 'Team space' : type === SharedSectionType.private ? 'Private' : 'Shared';
  const tooltip =
    type === SharedSectionType.public
      ? `Everyone at ${workspaceName} has access`
      : type === SharedSectionType.private
        ? 'Only you have access'
        : '';
  return (
    <Tooltip message={tooltip}>
      <Badge variant="secondary" size="sm"><Icon className="size-3" />{text}</Badge>
    </Tooltip>
  );
}

/** TrashBreadcrumb: opens the Trash. */
export function TrashBreadcrumb() {
  const { tr } = useTr();
  return (
    <Button variant="ghost" size="sm" className="h-7 max-w-48 gap-1.5 px-1.5 font-normal text-muted-foreground hover:text-foreground" onClick={openTrash}>
      <Trash2 className="size-4" /><span className="truncate">{tr('trash.text')}</span>
    </Button>
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
    svg = <FlowySvg svg={name} size={14} color="currentColor" />;
  } else {
    const [group, name] = icon.split('/');
    const content = name ? findSvgContent(groups, group, name) : null;
    if (!content) return null;
    svg = <SvgString svg={content} size={8.5} color="currentColor" />;
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-md text-background" style={{ background: argbToCss(color) ?? 'transparent' }}>{svg}</span>
  );
}

/** ViewTitle + ViewTitleBloc: one crumb, live-updated from DidUpdateView. */
export function ViewTitle({ view, editable, onUpdated }: { view: ViewPB; editable: boolean; onUpdated: () => void }) {
  const { tr } = useTr();
  const current = useHyperAppearanceView(view);
  useEffect(() => { if (current) onUpdated(); }, [current]);
  if (!current) return <span className="inline-block h-4 w-12" aria-busy="true" />;

  const icon = viewIcon(current);
  const name = current.name || view.name;
  const iconAndName = () => (
    <>
      {icon ? <RawEmojiIcon icon={icon} size={16} /> : !isSpace(current) && <HyperLayoutIcon layout={current.layout} />}
      {isSpace(current) && <BreadcrumbSpaceIcon space={current} />}
      <span className="truncate">{name || tr('menuAppHeader.defaultNewPageName')}</span>
    </>
  );
  const buttonClass = 'h-7 max-w-48 gap-1.5 px-1.5 font-normal text-muted-foreground hover:text-foreground';
  if (view.parentViewId === '') {
    return <span className="truncate text-sm">{current.name}</span>;
  }
  if (isSpace(view)) {
    return <Button variant="ghost" size="sm" className={buttonClass}>{iconAndName()}</Button>;
  }
  if (!editable) {
    return <Button variant="ghost" size="sm" className={buttonClass} onMouseDown={() => tabsActions.openView(view)}>{iconAndName()}</Button>;
  }
  return (
    <div className="flex">
      <AppFlowyPopover constraints={{ maxWidth: 300, maxHeight: 44 }} direction="bottomWithLeftAligned" offset={{ x: 0, y: 6 }}
        popup={() => <RenameViewPopover view={current} name={current.name} icon={icon} />}>
        <Button variant="ghost" size="sm" className={buttonClass}>{iconAndName()}</Button>
      </AppFlowyPopover>
    </div>
  );
}

/** _buildLockPageStatus: "Locked" / "Re-lock" chips and the locked toast. */
function LockPageStatus() {
  const { tr } = useTr();
  const scope = useViewScope();
  const access = usePageAccessLevel();

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
  if (access.isLocked) {
    return (
      <Tooltip message={tr('lockPage.lockTooltip')}>
        <Badge variant="outline" size="sm" render={<button type="button" />} onClick={() => void scope.accessLevel.unlock()}>
          <Lock className="size-3" />{tr('lockPage.lockPage')}
        </Badge>
      </Tooltip>
    );
  }
  if (access.lockCounter > 0) {
    return <Badge variant="outline" size="sm" render={<button type="button" />} onClick={() => void scope.accessLevel.lock()}><Lock className="size-3" />{tr('lockPage.reLockPage')}</Badge>;
  }
  return null;
}
