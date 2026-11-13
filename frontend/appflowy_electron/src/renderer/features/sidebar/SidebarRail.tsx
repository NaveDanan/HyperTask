// SidebarRail: the 56px icon rail the sidebar collapses to (as in CPA-Desktop). Built on the
// shared ReUI/base-ui primitives: base-ui Tooltip, the app's sidebar tokens and nav icons.
import { SquareCheckBig, LayoutTemplate, PanelLeftOpen, Search, SquarePen, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { ShortcutKeys } from '@/components/app/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HyperLogo } from '@/ui/HyperLogo';
import { AFAvatar } from '@/ui';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import { MenuStatus, homeSettingActions } from '@/features/home/home-setting-store';
import { loseFocus, openSettings, toggleCommandPalette } from '@/features/home/notifiers';
import { localToolPlugin, trashPlugin } from '@/features/tabs/plugin';
import { tabsActions, useTabsStore } from '@/features/tabs/tabs-store';
import { isMac } from './components';
import { createNewPageInSidebar } from './SidebarButtons';
import { useWorkspaceStore, workspaceRole } from './stores/workspace-store';

/** Column flow of the rail: 32px rounded icon buttons, hover accent, data-[active] selection. */
const railButtonClass =
  'flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground outline-none transition-colors ' +
  'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
  'data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground ' +
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4';

const RailSeparator = () => <div aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />;

interface RailButtonProps {
  icon: ReactNode;
  /** Tooltip content to the right of the button. */
  tooltip: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

/** A rail icon in a right-side tooltip (base-ui), matching ReUI's collapsed SidebarMenuButton. */
export function RailButton({ icon, tooltip, active, onClick, className }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label={typeof tooltip === 'string' ? tooltip : undefined} data-active={active ? 'true' : undefined} className={cn(railButtonClass, className)} onClick={onClick} />}
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
export function SidebarRail({ user }: { user: UserProfilePB }) {
  const { tr } = useTr();
  const name = user.name || tr('defaultUsername');
  const role = useWorkspaceStore((s) => workspaceRole(s.currentWorkspace));
  const activeTab = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id);
  const activeTrash = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.kind === 'trash');

  return (
    <div data-slot="sidebar-rail" className="absolute inset-y-0 left-0 z-2 flex w-14 flex-col bg-sidebar text-sidebar-foreground">
      {/* The drag region above the rail keeps window dragging where the title bar begins. */}
      <div className="drag-region flex h-10 shrink-0 items-center justify-center">
        <HyperLogo size={18} className="no-drag" />
      </div>
      {/* The open-sidebar button stays the top control, as in the CPA-Desktop rail. */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 px-1 pb-2">
        <RailButton
          icon={<PanelLeftOpen />}
          active
          onClick={() => homeSettingActions.changeMenuStatus(MenuStatus.expanded)}
          tooltip={<span className="flex items-center gap-2">{tr('sideBar.openSidebar')}<ShortcutKeys keys={isMac ? '⌘+.' : 'Ctrl+\\'} /></span>}
        />
        <RailSeparator />
        <RailButton
          icon={<AFAvatar url={user.iconUrl} name={user.name} size="s" />}
          onClick={() => {
            loseFocus.emit();
            openSettings.emit();
          }}
          tooltip={name}
        />
        <RailButton
          icon={<Search />}
          onClick={() => toggleCommandPalette.emit()}
          tooltip={<span className="flex items-center gap-2">{tr('search.sidebarSearchIcon')}<ShortcutKeys keys={isMac ? '⌘+P' : 'Ctrl+P'} /></span>}
        />
        {role !== AFRolePB.Guest && (
          <RailButton icon={<SquarePen />} onClick={createNewPageInSidebar} tooltip={
            <span className="flex items-center gap-2">{tr('newPageText')}<ShortcutKeys keys={isMac ? '⌘+N' : 'Ctrl+N'} /></span>
          } />
        )}
        <RailButton icon={<SquareCheckBig />} active={activeTab === 'local-tool:jira'}
          onClick={() => tabsActions.openPlugin(localToolPlugin('jira'))} tooltip="Jira" />
        <RailButton icon={<LayoutTemplate />} active={activeTab === 'local-tool:templates'}
          onClick={() => tabsActions.openPlugin(localToolPlugin('templates'))} tooltip={tr('template.label')} />
        <div className="flex-1" />
        <RailButton icon={<Trash2 />} active={activeTrash} className="shrink-0" onClick={() => {
          // MenuSharedState.latestOpenView = null clears the tree selection.
          useTabsStore.setState({ latestOpenView: null });
          tabsActions.openPlugin(trashPlugin());
        }} tooltip={tr('trash.text')} />
      </div>
    </div>
  );
}
