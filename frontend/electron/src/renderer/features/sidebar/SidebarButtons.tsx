// Sidebar entries: search, new page, Jira and Templates.
import { useEffect } from 'react';
import { Bot, BotMessageSquare, House, LayoutTemplate, Search, SquareCheckBig, SquarePen } from 'lucide-react';
import { ViewLayoutPB, ViewSectionPB } from '@shared/protobuf/hyper-folder/view_pb';
import { NavItem } from '@/components/app/nav';
import { ShortcutKeys } from '@/components/app/shortcut';
import { useTr } from '@/i18n';
import { Tooltip } from '@/ui';
import { createNewPage, toggleCommandPalette } from '@/features/home/notifiers';
import { localToolPlugin } from '@/features/tabs/plugin';
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

/** HyperHome: the Hyper-Kanban + Hyper-Event startup page. */
export function HyperHomeButton() {
  const active = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id === 'local-tool:home');
  return <NavItem icon={<House />} label="Home" active={active}
    onClick={() => tabsActions.openPlugin(localToolPlugin('home'))} />;
}

export function JiraButton() {
  const active = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id === 'local-tool:jira');
  return <NavItem icon={<SquareCheckBig />} label="Jira" active={active}
    onClick={() => tabsActions.openPlugin(localToolPlugin('jira'))} />;
}

/** The Nod personal assistant: one durable conversation on the configured VM. */
export function HyperNodButton() {
  const active = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id === 'local-tool:nod');
  return <NavItem icon={<Bot />} label="Nod assistant" active={active}
    onClick={() => tabsActions.openPlugin(localToolPlugin('nod'))} />;
}

/** HyperBots: bots in a room that read Outlook and file Jira issues, each tool call approved by the owner. */
export function HyperBotsButton() {
  const active = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id === 'local-tool:bots');
  return <NavItem icon={<BotMessageSquare />} label="Hyper-Bot" active={active}
    onClick={() => tabsActions.openPlugin(localToolPlugin('bots'))} />;
}

export function HyperTemplatesButton() {
  const { tr } = useTr();
  const active = useTabsStore((s) => s.tabs[s.currentIndex]?.plugin.id === 'local-tool:templates');
  return <NavItem icon={<LayoutTemplate />} label={tr('template.label')} active={active}
    onClick={() => tabsActions.openPlugin(localToolPlugin('templates'))} />;
}
