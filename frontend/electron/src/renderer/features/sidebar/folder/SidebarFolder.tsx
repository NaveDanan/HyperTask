// Legacy (non-space) sections: SidebarFolder (shared/sidebar_folder.dart), SectionFolder and
// FolderHeader (folder/_section_folder.dart, _folder_header.dart), FolderBloc.
import { useEffect, useState } from 'react';
import { create as createMessage } from '@bufbuild/protobuf';
import { ViewPBSchema, type ViewPB, type ViewSectionPB } from '@shared/protobuf/hyper-folder/view_pb';
import { useTr } from '@/i18n';
import { Plus } from 'lucide-react';
import { Tooltip } from '@/ui';
import { NavIconButton, NavSectionHeader } from '@/components/app/nav';
import { tabsActions } from '@/features/tabs/tabs-store';
import { FavoriteFolder } from '../favorites/FavoriteFolder';
import { getFolderIsExpanded, setExpanded } from '../stores/expand-storage';
import { useFavoriteStore } from '../stores/favorite-store';
import {
  filterHyperProjectViews,
  hyperProjectsFilterActions,
  isHyperProjectsFilterActive,
  type HyperProjectsFilterCriteria,
} from '../stores/HyperProjectsFilter';
import { sectionsActions, useSectionsStore } from '../stores/sections-store';
import { toViewSectionPB, type FolderSpaceType } from '../stores/types';
import { useWorkspaceStore } from '../stores/workspace-store';
import { ViewItem } from '../view/ViewItem';

/** FolderBloc: the expand state of a section, persisted under its type name (`?? true` on read). */
export function useFolderExpanded(type: FolderSpaceType): [boolean, (isExpanded?: boolean) => void] {
  const [isExpanded, setIsExpanded] = useState(() => getFolderIsExpanded(type));
  useEffect(() => setIsExpanded(getFolderIsExpanded(type)), [type]);
  const toggle = (value?: boolean) => {
    const next = value ?? !isExpanded;
    setIsExpanded(next);
    void setExpanded(type, next);
  };
  return [isExpanded, toggle];
}

/** The sidebar's click semantics: Ctrl opens a new tab, then the page always opens (one new tab). */
export function openFromSidebar(view: ViewPB, event: { ctrlKey: boolean }) {
  if (event.ctrlKey) tabsActions.openViewInNewTab(view);
  tabsActions.openView(view);
}

export function SidebarFolder({ projectFilter: activeFilter }: { projectFilter?: HyperProjectsFilterCriteria }) {
  const favorites = useFavoriteStore((s) => s.views);
  const pinnedFavorites = useFavoriteStore((s) => s.pinnedViews);
  const section = useSectionsStore((s) => s.section);
  const isCollab = useWorkspaceStore((s) => s.isCollabWorkspaceOn);
  const { tr } = useTr();
  const filterActive = isHyperProjectsFilterActive(activeFilter);

  const filteredFavorites = filterActive
    ? filterHyperProjectViews(favorites.map((f) => f.item), activeFilter)
    : favorites.map((f) => f.item);
  const filteredPinnedCount = filterActive
    ? filterHyperProjectViews(pinnedFavorites.map((f) => f.item), activeFilter).length
    : pinnedFavorites.length;
  const publicViews = filterActive ? filterHyperProjectViews(section.publicViews, activeFilter) : section.publicViews;
  const privateViews = filterActive ? filterHyperProjectViews(section.privateViews, activeFilter) : section.privateViews;

  const totalMatches =
    filteredPinnedCount + publicViews.length + (isCollab ? privateViews.length : 0);

  return (
    <div className="flex flex-col">
      {filteredFavorites.length > 0 && (
        <FavoriteFolder views={filteredFavorites} projectFilter={activeFilter} />
      )}
      {isCollab ? (
        <>
          {(!filterActive || publicViews.length > 0) && (
            <SectionFolder
              title={tr('sideBar.workspace')}
              spaceType="public"
              views={publicViews}
              addButtonTooltip={tr('sideBar.addAPageToWorkspace')}
              projectFilter={activeFilter}
            />
          )}
          {(!filterActive || privateViews.length > 0) && (
            <SectionFolder
              title={tr('sideBar.private')}
              spaceType="private"
              views={privateViews}
              addButtonTooltip={tr('sideBar.addAPageToPrivate')}
              projectFilter={activeFilter}
            />
          )}
        </>
      ) : (
        <>
          {/* Personal = the public section; private views are not shown in local mode. */}
          {(!filterActive || publicViews.length > 0) && (
            <SectionFolder
              title={tr('sideBar.personal')}
              spaceType="public"
              views={publicViews}
              addButtonTooltip={tr('sideBar.addAPage')}
              projectFilter={activeFilter}
            />
          )}
        </>
      )}
      {filterActive && totalMatches === 0 && (
        <div className="mt-3 flex flex-col items-start gap-1.5 rounded-md border border-dashed border-sidebar-border px-2.5 py-2.5 text-xs text-sidebar-muted-foreground">
          <span>{tr('sideBar.projects.empty')}</span>
          <button
            type="button"
            onClick={() => hyperProjectsFilterActions.clearFilter()}
            className="text-xs font-medium text-sidebar-foreground underline underline-offset-2 hover:opacity-80"
          >
            {tr('sideBar.projects.clear')}
          </button>
        </div>
      )}
    </div>
  );
}

function SectionFolder({
  title,
  spaceType,
  views,
  addButtonTooltip,
  projectFilter,
}: {
  title: string;
  spaceType: FolderSpaceType;
  views: ViewPB[];
  addButtonTooltip: string;
  projectFilter?: HyperProjectsFilterCriteria;
}) {
  const [isExpanded, expand] = useFolderExpanded(spaceType);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.workspaceId ?? '');
  const filterActive = isHyperProjectsFilterActive(projectFilter);
  const expanded = filterActive || isExpanded;
  return (
    <div className="mt-3 flex flex-col">
      <FolderHeader
        title={title}
        isExpanded={expanded}
        addButtonTooltip={addButtonTooltip}
        onPressed={() => expand()}
        onAdded={() => {
          void sectionsActions.createRootViewInSection('', toViewSectionPB(spaceType) as ViewSectionPB, 0);
          expand(true);
        }}
      />
      <div className="mt-0.5 flex flex-col gap-px">
        {expanded &&
          views.map((view) => (
            <ViewItem
              key={`${spaceType} ${view.id}`}
              spaceType={spaceType}
              engagedInExpanding
              isFirstChild={view.id === views[0].id}
              view={view}
              level={0}
              leftPadding={16}
              isFeedback={false}
              hoverGated
              enableRightClickContext
              onSelected={openFromSidebar}
              onTertiarySelected={(v) => tabsActions.openViewInNewTab(v)}
              projectFilter={projectFilter}
            />
          ))}
        {views.length === 0 && !filterActive && (
          // The empty section's drop target (move a page into this section).
          <ViewItem
            spaceType={spaceType}
            view={createMessage(ViewPBSchema, { parentViewId: workspaceId })}
            level={0}
            leftPadding={16}
            isFeedback={false}
            onSelected={() => {}}
            isPlaceholder
          />
        )}
      </div>
    </div>
  );
}

function FolderHeader({
  title,
  isExpanded,
  addButtonTooltip,
  onPressed,
  onAdded,
}: {
  title: string;
  isExpanded: boolean;
  addButtonTooltip: string;
  onPressed: () => void;
  onAdded: () => void;
}) {
  return (
    <NavSectionHeader label={title} collapsed={!isExpanded} onToggle={onPressed}
      actions={<Tooltip rich={addButtonTooltip}><NavIconButton aria-label={addButtonTooltip} onClick={onAdded}><Plus className="size-3.5" /></NavIconButton></Tooltip>} />
  );
}
