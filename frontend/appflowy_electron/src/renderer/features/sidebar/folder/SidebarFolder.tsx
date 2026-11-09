// Legacy (non-space) sections: SidebarFolder (shared/sidebar_folder.dart), SectionFolder and
// FolderHeader (folder/_section_folder.dart, _folder_header.dart), FolderBloc.
import { useEffect, useState } from 'react';
import { create as createMessage } from '@bufbuild/protobuf';
import { ViewPBSchema, type ViewPB, type ViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { Plus } from 'lucide-react';
import { Tooltip } from '@/ui';
import { NavIconButton, NavSectionHeader } from '@/components/app/nav';
import { tabsActions } from '@/features/tabs/tabs-store';
import { FavoriteFolder } from '../favorites/FavoriteFolder';
import { getFolderIsExpanded, setExpanded } from '../stores/expand-storage';
import { useFavoriteStore } from '../stores/favorite-store';
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

export function SidebarFolder() {
  const favorites = useFavoriteStore((s) => s.views);
  const section = useSectionsStore((s) => s.section);
  const isCollab = useWorkspaceStore((s) => s.isCollabWorkspaceOn);
  const { tr } = useTr();
  return (
    <div className="flex flex-col">
      {favorites.length > 0 && <FavoriteFolder views={favorites.map((f) => f.item)} />}
      {isCollab ? (
        <>
          <SectionFolder title={tr('sideBar.workspace')} spaceType="public" views={section.publicViews} addButtonTooltip={tr('sideBar.addAPageToWorkspace')} />
          <SectionFolder title={tr('sideBar.private')} spaceType="private" views={section.privateViews} addButtonTooltip={tr('sideBar.addAPageToPrivate')} />
        </>
      ) : (
        <>
          {/* Personal = the public section; private views are not shown in local mode. */}
          <SectionFolder title={tr('sideBar.personal')} spaceType="public" views={section.publicViews} addButtonTooltip={tr('sideBar.addAPage')} />
        </>
      )}
    </div>
  );
}

function SectionFolder({
  title,
  spaceType,
  views,
  addButtonTooltip,
}: {
  title: string;
  spaceType: FolderSpaceType;
  views: ViewPB[];
  addButtonTooltip: string;
}) {
  const [isExpanded, expand] = useFolderExpanded(spaceType);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.workspaceId ?? '');
  return (
    <div className="mt-3 flex flex-col">
      <FolderHeader
        title={title}
        isExpanded={isExpanded}
        addButtonTooltip={addButtonTooltip}
        onPressed={() => expand()}
        onAdded={() => {
          void sectionsActions.createRootViewInSection('', toViewSectionPB(spaceType) as ViewSectionPB, 0);
          expand(true);
        }}
      />
      <div className="mt-0.5 flex flex-col gap-px">
        {isExpanded &&
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
            />
          ))}
        {views.length === 0 && (
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
