import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ViewLayoutPB, ViewPBSchema, ViewSectionPB } from '@shared/protobuf/hyper-folder/view_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/hyper-user/user_profile_pb';
import { AFRolePB } from '@shared/protobuf/hyper-user/workspace_pb';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import enUS from '@resources/translations/en-US.json';
import enGB from '@resources/translations/en-GB.json';

vi.hoisted(() => {
  const matchMediaStub = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  const storageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  if (typeof globalThis.window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: matchMediaStub,
        localStorage: storageStub,
      },
      configurable: true,
      writable: true,
    });
  }
  if (typeof globalThis.matchMedia === 'undefined') {
    Object.defineProperty(globalThis, 'matchMedia', { value: matchMediaStub, configurable: true, writable: true });
  }
  if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: storageStub, configurable: true, writable: true });
  }
});
import { TooltipProvider } from '@/components/ui/tooltip';
import { ViewBackendService } from '@/features/view/view-service';
import { tabsActions } from '@/features/tabs/tabs-store';
import { HyperSidebarRail } from './HyperSidebarRail';
import { SidebarBody } from './Sidebar';
import { SidebarFolder } from './folder/SidebarFolder';
import {
  HyperProjectsFilterBar,
  HyperSidebarActionBar,
  createNewPageInSidebar,
  createProjectInSidebar,
} from './SidebarButtons';
import { useFavoriteStore } from './stores/favorite-store';
import { hyperProjectsFilterActions } from './stores/HyperProjectsFilter';
import { sectionsActions, useSectionsStore } from './stores/sections-store';
import { sidebarSpace } from './stores/space-store';
import { useWorkspaceStore } from './stores/workspace-store';
import { resetKv } from './test/mocks';

vi.mock('@/startup/kv', async () => (await import('./test/mocks')).kvMock());

function makeUser() {
  return create(UserProfilePBSchema, { id: 1n, name: 'Test User', email: 'test@example.com' });
}

function makeWorkspace(role: AFRolePB = AFRolePB.Owner, workspaceId = 'ws-1') {
  return create(UserWorkspacePBSchema, { workspaceId, name: 'Workspace', oneOfRole: { case: 'role', value: role } });
}

function makeView(
  id: string,
  name: string,
  layout: ViewLayoutPB = ViewLayoutPB.Document,
  extra = '',
) {
  return create(ViewPBSchema, {
    id,
    name,
    layout,
    parentViewId: 'ws-1',
    ...(extra ? { oneOfExtra: { case: 'extra' as const, value: extra } } : {}),
  });
}

function renderHtml(element: React.ReactElement) {
  return renderToStaticMarkup(<TooltipProvider>{element}</TooltipProvider>);
}

beforeEach(() => {
  resetKv();
  // Static markup normally reads the server snapshot. Render the state the desktop client sees.
  vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot());
  hyperProjectsFilterActions.reset();
  useWorkspaceStore.setState({
    currentWorkspace: makeWorkspace(AFRolePB.Owner),
    workspaces: [makeWorkspace(AFRolePB.Owner)],
    isCollabWorkspaceOn: false,
  });
  useSectionsStore.setState({
    section: { publicViews: [], privateViews: [] },
    containsSpace: false,
    lastCreatedRootView: null,
  });
  useFavoriteStore.setState({ views: [], pinnedViews: [], unpinnedViews: [] });
  sidebarSpace.store.setState({
    spaces: [],
    currentSpace: null,
    isExpanded: true,
    isInitialized: true,
    lastCreatedPage: null,
    isDuplicatingSpace: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  hyperProjectsFilterActions.reset();
});

describe('HyperSidebarActionBar and HyperProjectsFilterBar', () => {
  it('renders Search first followed by Filter projects, New project, and Choose project layout in reference order', () => {
    const html = renderHtml(<HyperSidebarActionBar role={AFRolePB.Owner} />);

    const searchIdx = html.indexOf('aria-label="Search"');
    const filterIdx = html.indexOf('aria-label="Filter projects"');
    const newProjectIdx = html.indexOf('aria-label="New project"');
    const addProjectIdx = html.indexOf('aria-label="Choose project layout"');

    expect(searchIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeGreaterThan(searchIdx);
    expect(newProjectIdx).toBeGreaterThan(filterIdx);
    expect(addProjectIdx).toBeGreaterThan(newProjectIdx);

    // Reference icon classes: Search, ListFilter, FolderPlus, SquarePen
    expect(html).toContain('lucide-search');
    expect(html).toContain('lucide-list-filter');
    expect(html).toContain('lucide-folder-plus');
    expect(html).toContain('lucide-square-pen');
    expect(html).toContain('text-sidebar-muted-foreground');
    expect(html).not.toContain('New page');
  });

  it('hides project creation actions for Guest role while keeping Search and Filter projects', () => {
    const html = renderHtml(<HyperSidebarActionBar role={AFRolePB.Guest} />);
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('aria-label="Filter projects"');
    expect(html).not.toContain('aria-label="New project"');
    expect(html).not.toContain('aria-label="Choose project layout"');
  });

  it('shows the inline filter bar only when open or active and renders layout pills and clear button', () => {
    expect(renderHtml(<HyperProjectsFilterBar />)).toBe('');

    hyperProjectsFilterActions.open();
    const openHtml = renderHtml(<HyperProjectsFilterBar />);
    expect(openHtml).toContain('placeholder="Filter projects"');
    for (const label of ['All', 'Doc', 'Grid', 'Board', 'Calendar', 'Gantt']) {
      expect(openHtml).toContain(`>${label}</button>`);
    }
    expect(openHtml).not.toContain('aria-label="Clear filter"');

    hyperProjectsFilterActions.setQuery('alpha');
    const activeHtml = renderHtml(<HyperProjectsFilterBar />);
    expect(activeHtml).toContain('aria-label="Clear filter"');
  });
});

describe('SidebarBody navigation, Nod removal, and Projects filtering', () => {
  it('places Search before Home, renames section to Projects, and removes Nod assistant', () => {
    useSectionsStore.setState({
      section: {
        publicViews: [
          makeView('p-1', 'Alpha Roadmap', ViewLayoutPB.Document),
          makeView('p-2', 'Sprint Board', ViewLayoutPB.Board),
        ],
        privateViews: [],
      },
      containsSpace: false,
      lastCreatedRootView: null,
    });

    const html = renderHtml(<SidebarBody user={makeUser()} />);

    const searchIdx = html.indexOf('aria-label="Search"');
    const homeIdx = html.indexOf('>Home<');
    expect(searchIdx).toBeGreaterThan(-1);
    expect(homeIdx).toBeGreaterThan(searchIdx);

    expect(html).toContain('Hyper-Bot');
    expect(html).toContain('Jira');
    expect(html).toContain('Projects');
    expect(html).toContain('Alpha Roadmap');
    expect(html).toContain('Sprint Board');

    expect(html).not.toContain('Nod assistant');
    expect(html).not.toContain('New page');
  });

  it('filters visible Projects in SidebarFolder and shows a clearable empty state when nothing matches', () => {
    useSectionsStore.setState({
      section: {
        publicViews: [
          makeView('p-1', 'Alpha Roadmap', ViewLayoutPB.Document),
          makeView('p-2', 'Sprint Board', ViewLayoutPB.Board),
        ],
        privateViews: [],
      },
      containsSpace: false,
      lastCreatedRootView: null,
    });

    hyperProjectsFilterActions.setLayout('board');
    expect(renderHtml(<SidebarBody user={makeUser()} />)).toContain('Searching projects');
    const filteredHtml = renderHtml(<SidebarFolder projectFilter={{ query: '', layout: 'board' }} />);
    expect(filteredHtml).toContain('Sprint Board');
    expect(filteredHtml).not.toContain('Alpha Roadmap');

    hyperProjectsFilterActions.setQuery('nonexistent');
    const emptyHtml = renderHtml(<SidebarFolder projectFilter={{ query: 'nonexistent', layout: 'board' }} />);
    expect(emptyHtml).toContain('No matching projects');
    expect(emptyHtml).toContain('Clear filter');

    hyperProjectsFilterActions.clearFilter();
    const restoredHtml = renderHtml(<SidebarBody user={makeUser()} />);
    expect(restoredHtml).toContain('Alpha Roadmap');
    expect(restoredHtml).toContain('Sprint Board');
  });
});

describe('HyperSidebarRail collapsed navigation', () => {
  it('orders Search before Home, includes Filter projects and FolderPlus New project, and omits Nod assistant', () => {
    const html = renderHtml(<HyperSidebarRail user={makeUser()} />);

    const searchIdx = html.indexOf('aria-label="Search"');
    const filterIdx = html.indexOf('aria-label="Filter projects"');
    const newProjectIdx = html.indexOf('aria-label="New project"');
    const homeIdx = html.indexOf('aria-label="Home"');

    expect(searchIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeGreaterThan(searchIdx);
    expect(newProjectIdx).toBeGreaterThan(filterIdx);
    expect(homeIdx).toBeGreaterThan(newProjectIdx);

    expect(html).toContain('lucide-list-filter');
    expect(html).toContain('lucide-folder-plus');
    expect(html).toContain('aria-label="Hyper-Bot"');
    expect(html).toContain('aria-label="Jira"');
    expect(html).not.toContain('Nod assistant');
    expect(html).not.toContain('New page');
  });

  it('hides New project on the collapsed rail for Guests', () => {
    useWorkspaceStore.setState({ currentWorkspace: makeWorkspace(AFRolePB.Guest) });
    const html = renderHtml(<HyperSidebarRail user={makeUser()} />);
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('aria-label="Filter projects"');
    expect(html).toContain('aria-label="Home"');
    expect(html).not.toContain('aria-label="New project"');
  });
});

describe('Sidebar project creation helpers', () => {
  it('creates root documents in folder mode and space documents in space mode', () => {
    const createRootSpy = vi.spyOn(sectionsActions, 'createRootViewInSection').mockResolvedValue();
    const createSpacePageSpy = vi.spyOn(sidebarSpace.actions, 'createPage').mockResolvedValue();

    createNewPageInSidebar();
    expect(createRootSpy).toHaveBeenCalledWith('', ViewSectionPB.Public, 0);

    useWorkspaceStore.setState({ isCollabWorkspaceOn: true });
    createNewPageInSidebar();
    expect(createRootSpy).toHaveBeenCalledWith('', ViewSectionPB.Private, 0);

    const space = makeView('sp-1', 'General');
    sidebarSpace.store.setState({ spaces: [space], currentSpace: space });
    createNewPageInSidebar();
    expect(createSpacePageSpy).toHaveBeenCalledWith({
      name: '',
      index: 0,
      layout: ViewLayoutPB.Document,
      openAfterCreate: true,
    });
  });

  it('creates typed projects (Board, Gantt) in folder mode and space mode', async () => {
    const created = makeView('v-gantt', 'Gantt', ViewLayoutPB.Grid, JSON.stringify({ hyper_layout: 'gantt' }));
    const createViewSpy = vi
      .spyOn(ViewBackendService, 'createView')
      .mockResolvedValue({ ok: true, value: created });
    const openViewSpy = vi.spyOn(tabsActions, 'openView').mockImplementation(() => {});

    createProjectInSidebar(ViewLayoutPB.Grid, 'gantt');
    await Promise.resolve();
    expect(createViewSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        parentViewId: 'ws-1',
        name: '',
        layoutType: ViewLayoutPB.Grid,
        hyperLayout: 'gantt',
        openAfterCreate: true,
        index: 0,
        section: ViewSectionPB.Public,
      }),
    );
    expect(openViewSpy).toHaveBeenCalledWith(created);

    const space = makeView('sp-1', 'General');
    sidebarSpace.store.setState({ spaces: [space], currentSpace: space });
    const createSpacePageSpy = vi.spyOn(sidebarSpace.actions, 'createPage').mockResolvedValue();
    const expandSpaceSpy = vi.spyOn(sidebarSpace.actions, 'expand').mockResolvedValue();

    createProjectInSidebar(ViewLayoutPB.Board);
    expect(createSpacePageSpy).toHaveBeenCalledWith({
      name: 'Untitled',
      index: 0,
      layout: ViewLayoutPB.Board,
      hyperLayout: undefined,
      openAfterCreate: true,
    });
    expect(expandSpaceSpy).toHaveBeenCalledWith(space, true);
  });
});

describe('Projects terminology translations', () => {
  it('renames workspace navigation and creation surfaces to Projects while preserving unrelated page strings', () => {
    for (const locale of [enUS, enGB]) {
      expect(locale.newPageText).toBe('New project');
      expect(locale.blankPageTitle).toBe('Blank project');
      expect(locale.menuAppHeader.addPageTooltip).toBe('Quickly add a project inside');
      expect(locale.sideBar.personal).toBe('Projects');
      expect(locale.sideBar.workspace).toBe('Projects');
      expect(locale.sideBar.private).toBe('Private projects');
      expect(locale.sideBar.addAPage).toBe('Add a new project');
      expect(locale.search.sidebarSearchIcon).toBe('Search and quickly jump to a project');
      expect(locale.disclosureAction.collapseAllPages).toBe('Collapse all subprojects');
      expect(locale.disclosureAction.movePageTo).toBe('Move project to');
      expect(locale.space.collapseAllSubPages).toBe('Collapse all subprojects');
      expect(locale.space.movePageToSpace).toBe('Move project to space');
      expect(locale.space.cannotMovePageToDatabase).toBe('Cannot move project to database');

      // Unrelated page strings must remain intact
      expect(locale.sideBar.expandSidebar).toBe('Expand as full page');
      expect(locale.tooltip.openAsPage).toBe('Open as a Page');
    }
    expect(enUS.search.pageNotExist).toBe("This project doesn't exist");
    expect(enUS.commandPalette.clickToOpenPage).toBe('Click to open project');
  });
});
