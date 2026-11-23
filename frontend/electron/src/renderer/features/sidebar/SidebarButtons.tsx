// Sidebar entries: top action bar (Search, Filter projects, New project, Create project view),
// inline Projects filter bar, Home, Hyper-Bot, Jira, and Templates.
import { useEffect, useRef } from 'react';
import {
  BotMessageSquare,
  FolderPlus,
  House,
  LayoutTemplate,
  ListFilter,
  Search,
  SquareCheckBig,
  SquarePen,
  X,
} from 'lucide-react';
import { ViewLayoutPB, ViewSectionPB } from '@shared/protobuf/hyper-folder/view_pb';
import { AFRolePB } from '@shared/protobuf/hyper-user/workspace_pb';
import { NavIconButton, NavItem } from '@/components/app/nav';
import { cn } from '@/lib/utils';
import { tr as translate, useTr } from '@/i18n';
import { Tooltip } from '@/ui';
import { createNewPage, toggleCommandPalette } from '@/features/home/notifiers';
import { localToolPlugin } from '@/features/tabs/plugin';
import { tabsActions, useTabsStore } from '@/features/tabs/tabs-store';
import { ViewBackendService } from '@/features/view/view-service';
import { hintTooltip, isMac } from './components';
import {
  hyperProjectsFilterActions,
  isHyperProjectsFilterActive,
  useHyperProjectsFilterStore,
  type HyperProjectLayoutFilter,
} from './stores/HyperProjectsFilter';
import { useSpaceState } from './space/space-context';
import { sectionsActions } from './stores/sections-store';
import { sidebarSpace } from './stores/space-store';
import { useWorkspaceStore } from './stores/workspace-store';
import { ViewAddButton } from './view/ViewAddButton';

const topBarButtonClass =
  'size-7 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ' +
  'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground';

/** _createNewPage: into the current space, else a root project in Private (collab) / Public. */
export function createNewPageInSidebar() {
  createProjectInSidebar(ViewLayoutPB.Document);
}

/** Creates a project with the chosen layout in either space mode or root folder mode. */
export function createProjectInSidebar(layout: ViewLayoutPB, hyperLayout?: 'gantt') {
  const spaceState = sidebarSpace.store.getState();
  if (spaceState.spaces.length > 0) {
    const currentSpace = spaceState.currentSpace ?? spaceState.spaces[0];
    const name =
      layout === ViewLayoutPB.Document || hyperLayout === 'gantt'
        ? ''
        : translate('menuAppHeader.defaultNewPageName');
    void sidebarSpace.actions.createPage({ name, index: 0, layout, hyperLayout, openAfterCreate: true });
    if (currentSpace) void sidebarSpace.actions.expand(currentSpace, true);
    return;
  }
  const section = useWorkspaceStore.getState().isCollabWorkspaceOn ? ViewSectionPB.Private : ViewSectionPB.Public;
  if (layout === ViewLayoutPB.Document && !hyperLayout) {
    void sectionsActions.createRootViewInSection('', section, 0);
    return;
  }
  const workspaceId = sectionsActions.workspaceId || useWorkspaceStore.getState().currentWorkspace?.workspaceId || '';
  if (!workspaceId) return;
  const name = hyperLayout === 'gantt' ? '' : translate('menuAppHeader.defaultNewPageName');
  void ViewBackendService.createView({
    parentViewId: workspaceId,
    name,
    layoutType: layout,
    hyperLayout,
    openAfterCreate: true,
    index: 0,
    section,
  }).then((result) => {
    if (result.ok) tabsActions.openView(result.value);
  });
}

/**
 * Top sidebar action bar matching the reference design:
 * Search on the left, followed by Filter projects, New project, and Create project view on the right.
 */
export function HyperSidebarActionBar({ role }: { role?: AFRolePB }) {
  const { tr } = useTr();
  const canCreate = role !== AFRolePB.Guest;
  const filterOpen = useHyperProjectsFilterStore((s) => s.isOpen);
  const filterActive = useHyperProjectsFilterStore((s) => isHyperProjectsFilterActive(s));
  const currentSpaceId = useSpaceState((s) => s.currentSpace?.id);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.workspaceId ?? '');
  const parentViewId = currentSpaceId || sectionsActions.workspaceId || workspaceId;

  // createNewPageNotifier (Mod+N).
  useEffect(() => {
    if (!canCreate) return;
    return createNewPage.on(() => createNewPageInSidebar());
  }, [canCreate]);

  const searchKeys = isMac ? '⌘+P' : 'Ctrl+P';
  const newProjectKeys = isMac ? '⌘+N' : 'Ctrl+N';
  const filterHighlighted = filterOpen || filterActive;

  return (
    <div data-slot="sidebar-action-bar" className="relative z-10 flex h-8 shrink-0 items-center gap-0.5 py-0.5">
      <Tooltip rich={hintTooltip(tr('search.sidebarSearchIcon'), searchKeys)}>
        <button
          type="button"
          aria-label={tr('search.label')}
          onClick={() => toggleCommandPalette.emit()}
          className={cn(
            'group/search flex h-8 min-w-0 flex-1 cursor-default items-center gap-2 rounded-md px-2 text-left text-sm',
            'text-sidebar-muted-foreground outline-none transition-colors',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
          )}
        >
          <Search />
          <span className="min-w-0 flex-1 truncate">{tr('search.label')}</span>
        </button>
      </Tooltip>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip message={tr('sideBar.projects.filter')}>
          <NavIconButton
            aria-label={tr('sideBar.projects.filter')}
            aria-pressed={filterHighlighted}
            data-active={filterHighlighted ? 'true' : undefined}
            className={topBarButtonClass}
            onClick={() => hyperProjectsFilterActions.toggleOpen()}
          >
            <ListFilter />
          </NavIconButton>
        </Tooltip>
        {canCreate && (
          <>
            <Tooltip rich={hintTooltip(tr('newPageText'), newProjectKeys)}>
              <NavIconButton
                aria-label={tr('newPageText')}
                className={topBarButtonClass}
                onClick={() => createNewPageInSidebar()}
              >
                <FolderPlus />
              </NavIconButton>
            </Tooltip>
            <ViewAddButton
              parentViewId={parentViewId}
              tooltip={tr('sideBar.projects.layout')}
              ariaLabel={tr('sideBar.projects.layout')}
              icon={<SquarePen />}
              buttonClassName={topBarButtonClass}
              onEditing={() => {}}
              onSelected={(layout, createNewView, hyperLayout) => {
                if (createNewView) createProjectInSidebar(layout, hyperLayout);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

const FILTER_LAYOUT_OPTIONS: readonly HyperProjectLayoutFilter[] = ['all', 'document', 'grid', 'board', 'calendar', 'gantt'];

/** Inline Projects filter bar toggled by the ListFilter button in HyperSidebarActionBar. */
export function HyperProjectsFilterBar() {
  const { tr } = useTr();
  const isOpen = useHyperProjectsFilterStore((s) => s.isOpen);
  const query = useHyperProjectsFilterStore((s) => s.query);
  const layout = useHyperProjectsFilterStore((s) => s.layout);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen && !isHyperProjectsFilterActive({ query, layout })) return null;

  return (
    <div data-slot="sidebar-projects-filter" className="relative z-10 flex shrink-0 flex-col gap-1.5 pt-1 pb-1.5">
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-control-surface px-2">
        <Search className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          aria-label={tr('sideBar.projects.filter')}
          placeholder={tr('sideBar.projects.filter')}
          onChange={(event) => hyperProjectsFilterActions.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (query !== '') hyperProjectsFilterActions.setQuery('');
              else hyperProjectsFilterActions.close();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-xs text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
        />
        {(query !== '' || layout !== 'all') && (
          <button
            type="button"
            aria-label={tr('sideBar.projects.clear')}
            onClick={() => {
              hyperProjectsFilterActions.clearFilter();
              inputRef.current?.focus();
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <div role="group" aria-label={tr('sideBar.projects.filterType')} className="flex flex-wrap gap-1">
        {FILTER_LAYOUT_OPTIONS.map((option) => {
          const selected = layout === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              data-active={selected ? 'true' : undefined}
              onClick={() => hyperProjectsFilterActions.setLayout(option)}
              className={cn(
                'rounded-md px-1.5 py-0.5 text-2xs font-medium transition-colors outline-none',
                'text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                'focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
              )}
            >
              {tr('sideBar.projects.' + option)}
            </button>
          );
        })}
      </div>
    </div>
  );
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
