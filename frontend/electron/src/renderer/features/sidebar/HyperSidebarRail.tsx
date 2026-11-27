// HyperSidebarRail: the 56px icon rail the sidebar collapses to (as in CPA-Desktop). Built on the
// shared ReUI/base-ui primitives: base-ui Tooltip, the app's sidebar tokens and nav icons.
import { BotMessageSquare, FolderPlus, House, LayoutTemplate, ListFilter, ListTodo, PanelLeftOpen, Search, SquareCheckBig } from 'lucide-react';
import type { ReactNode } from 'react';
import { AFRolePB } from '@shared/protobuf/hyper-user/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/hyper-user/user_profile_pb';
import { ShortcutKeys } from '@/components/app/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HyperLogo } from '@/ui/HyperLogo';
import { AFAvatar } from '@/ui';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import { MenuStatus, homeSettingActions } from '@/features/home/home-setting-store';
import { loseFocus, openSettings, toggleCommandPalette } from '@/features/home/notifiers';
import { localToolPlugin } from '@/features/tabs/plugin';
import { tabsActions, useTabsStore } from '@/features/tabs/tabs-store';
import { isMac } from './components';
import { createNewPageInSidebar } from './SidebarButtons';
import { hyperProjectsFilterActions, isHyperProjectsFilterActive, useHyperProjectsFilterStore } from './stores/HyperProjectsFilter';
import { useWorkspaceStore, workspaceRole } from './stores/workspace-store';

/** Column flow of the rail: 32px rounded icon buttons, hover accent, data-[active] selection. */
const railButtonClass =
  'flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground outline-none transition-colors ' +
  'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
  'data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground ' +
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4';

const HyperRailSeparator = () => <div aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />;

interface HyperRailButtonProps {
  icon: ReactNode;
  label: string;
  /** Tooltip content to the right of the button. */
  tooltip: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

/** A rail icon in a right-side tooltip (base-ui), matching ReUI's collapsed SidebarMenuButton. */
export function HyperRailButton({ icon, label, tooltip, active, onClick, className }: HyperRailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label={label} data-active={active ? 'true' : undefined} className={cn(railButtonClass, className)} onClick={onClick} />}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="right" align="center" className="[&_kbd]:bg-background/20 [&_kbd]:text-background">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The collapsed fall-back of the sidebar, rendered while the sidebar is hidden. Switching tabs
 * and opening the sidebar stay available; hover shows what each icon does.
 */
export function HyperSidebarRail({ user }: { user: UserProfilePB }) {
  const { tr } = useTr();
  const name = user.name || tr('defaultUsername');
  const role = useWorkspaceStore((s) => workspaceRole(s.currentWorkspace));
  const activeTab = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id);
  const filterActive = useHyperProjectsFilterStore((s) => isHyperProjectsFilterActive(s));

  return (
    <div data-slot="sidebar-rail" className="absolute inset-y-0 left-0 z-2 flex w-14 flex-col bg-sidebar text-sidebar-foreground">
      {/* The drag region above the rail keeps window dragging where the title bar begins. */}
      <div className={cn(isMac && 'mt-10', "drag-region flex h-10 shrink-0 items-center justify-center")} >
        <HyperLogo size={18} className="no-drag" />
      </div>
      {/* The open-sidebar button stays the top control, as in the CPA-Desktop rail. */}
      <div className="flex min-h-0 flex-1 overflow-y-auto flex-col items-center gap-1 px-1 pb-2">
        <HyperRailButton
          label={tr('sideBar.openSidebar')} icon={<PanelLeftOpen />}
          active
          onClick={() => homeSettingActions.changeMenuStatus(MenuStatus.expanded)}
          tooltip={<span className="flex items-center gap-2">{tr('sideBar.openSidebar')}<ShortcutKeys keys={isMac ? '⌘+.' : 'Ctrl+\\'} /></span>}
        />
        <HyperRailSeparator />
        <HyperRailButton
          label={name} icon={<AFAvatar url={user.iconUrl} name={user.name} size="s" />}
          onClick={() => {
            loseFocus.emit();
            openSettings.emit();
          }}
          tooltip={name}
        />
        <HyperRailButton
          label={tr('search.label')} icon={<Search />}
          onClick={() => toggleCommandPalette.emit()}
          tooltip={<span className="flex items-center gap-2">{tr('search.sidebarSearchIcon')}<ShortcutKeys keys={isMac ? '⌘+P' : 'Ctrl+P'} /></span>}
        />
        <HyperRailButton
          label={tr('sideBar.projects.filter')} icon={<ListFilter />}
          active={filterActive}
          onClick={() => {
            homeSettingActions.changeMenuStatus(MenuStatus.expanded);
            hyperProjectsFilterActions.open();
          }}
          tooltip={tr('sideBar.projects.filter')}
        />
        {role !== AFRolePB.Guest && (
          <HyperRailButton label={tr('newPageText')} icon={<FolderPlus />} onClick={createNewPageInSidebar} tooltip={
            <span className="flex items-center gap-2">{tr('newPageText')}<ShortcutKeys keys={isMac ? '⌘+N' : 'Ctrl+N'} /></span>
          } />
        )}
        <HyperRailButton label="Home" icon={<House />} active={activeTab === 'local-tool:home'}
          onClick={() => tabsActions.openPlugin(localToolPlugin('home'))} tooltip="Home" />
        <HyperRailButton label="Task Hub" icon={<ListTodo />} active={activeTab === 'local-tool:taskhub'}
          onClick={() => tabsActions.openPlugin(localToolPlugin('taskhub'))} tooltip="Task Hub" />
        <HyperRailButton label="Hyper-Bot" icon={<BotMessageSquare />} active={activeTab === 'local-tool:bots'}
          onClick={() => tabsActions.openPlugin(localToolPlugin('bots'))} tooltip="Hyper-Bot" />
        <HyperRailButton label="Jira" icon={<SquareCheckBig />} active={activeTab === 'local-tool:jira'}
          onClick={() => tabsActions.openPlugin(localToolPlugin('jira'))} tooltip="Jira" />
        <HyperRailButton label={tr('template.label')} icon={<LayoutTemplate />} active={activeTab === 'local-tool:templates'}
          onClick={() => tabsActions.openPlugin(localToolPlugin('templates'))} tooltip={tr('template.label')} />
      </div>
    </div>
  );
}
