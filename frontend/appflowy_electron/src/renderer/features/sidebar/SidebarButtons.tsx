// Sidebar entries: search, new page, Jira, Templates and Trash.
import { useEffect, type ReactNode } from 'react';
import { LayoutTemplate, Search, SquareCheckBig, SquarePen, Trash2 } from 'lucide-react';
import { ViewLayoutPB, ViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';
import { NavItem } from '@/components/app/nav';
import { ShortcutKeys } from '@/components/app/shortcut';
import { useTr } from '@/i18n';
import { Tooltip } from '@/ui';
import { createNewPage, toggleCommandPalette } from '@/features/home/notifiers';
import { localToolPlugin, trashPlugin } from '@/features/tabs/plugin';
import { tabsActions, useTabsStore } from '@/features/tabs/tabs-store';
import { hintTooltip, isMac } from './components';
import { sectionsActions } from './stores/sections-store';
import { sidebarSpace } from './stores/space-store';
import { useWorkspaceStore } from './stores/workspace-store';

export function SidebarSearchButton() {
  const { tr } = useTr();
  const keys = isMac ? '⌘+P' : 'Ctrl+P';
  return (
    <Tooltip rich={hintTooltip(tr('search.sidebarSearchIcon'), keys)}>
      <NavItem icon={<Search />} label={tr('search.label')} trailing={<ShortcutKeys keys={keys} />}
        onClick={() => toggleCommandPalette.emit()} />
    </Tooltip>
  );
}

/** _createNewPage: into the current space, else a root page in Private (collab) / Public. */
export function createNewPageInSidebar() {
  if (sidebarSpace.store.getState().spaces.length > 0) {
    void sidebarSpace.actions.createPage({ name: '', index: 0, layout: ViewLayoutPB.Document, openAfterCreate: true });
  } else {
    const section = useWorkspaceStore.getState().isCollabWorkspaceOn ? ViewSectionPB.Private : ViewSectionPB.Public;
    void sectionsActions.createRootViewInSection('', section, 0);
  }
}

export function SidebarNewPageButton() {
  const { tr } = useTr();
  // createNewPageNotifier (Mod+N).
  useEffect(() => createNewPage.on(() => createNewPageInSidebar()), []);
  return <NavItem icon={<SquarePen />} label={tr('newPageText')}
    trailing={<ShortcutKeys keys={isMac ? '⌘+N' : 'Ctrl+N'} />} onClick={() => createNewPageInSidebar()} />;
}

export function JiraButton() {
  const active = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id === 'local-tool:jira');
  return <NavItem icon={<SquareCheckBig />} label="Jira" active={active}
    onClick={() => tabsActions.openPlugin(localToolPlugin('jira'))} />;
}

export function HyperTemplatesButton() {
  const { tr } = useTr();
  const active = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id === 'local-tool:templates');
  return <NavItem icon={<LayoutTemplate />} label={tr('template.label')} active={active}
    onClick={() => tabsActions.openPlugin(localToolPlugin('templates'))} />;
}

export function SidebarFooter(): ReactNode {
  const { tr } = useTr();
  const active = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.kind === 'trash');
  return (
    <div className="shrink-0 border-t border-sidebar-border py-2">
      <NavItem icon={<Trash2 />} label={tr('trash.text')} active={active} onClick={() => {
        // MenuSharedState.latestOpenView = null clears the tree selection.
        useTabsStore.setState({ latestOpenView: null });
        tabsActions.openPlugin(trashPlugin());
      }} />
    </div>
  );
}
