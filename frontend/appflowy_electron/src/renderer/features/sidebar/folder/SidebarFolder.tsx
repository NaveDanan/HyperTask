// Legacy (non-space) sections: SidebarFolder (shared/sidebar_folder.dart), SectionFolder and
// FolderHeader (folder/_section_folder.dart, _folder_header.dart), FolderBloc.
import { useEffect, useState } from 'react';
import { create as createMessage } from '@bufbuild/protobuf';
import { ViewPBSchema, type ViewPB, type ViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { FlowyButton, FlowySvg, FlowyText, VSpace } from '@/ui';
import { tabsActions } from '@/features/tabs/tabs-store';
import { SbIconButton } from '../components';
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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <VSpace size={4} />
      {favorites.length > 0 && <FavoriteFolder views={favorites.map((f) => f.item)} />}
      {isCollab ? (
        <>
          <VSpace size={16} />
          <SectionFolder title={tr('sideBar.workspace')} spaceType="public" views={section.publicViews} addButtonTooltip={tr('sideBar.addAPageToWorkspace')} />
          <VSpace size={16} />
          <SectionFolder title={tr('sideBar.private')} spaceType="private" views={section.privateViews} addButtonTooltip={tr('sideBar.addAPageToPrivate')} />
        </>
      ) : (
        <>
          <VSpace size={16} />
          {/* Personal = the public section; private views are not shown in local mode. */}
          <SectionFolder title={tr('sideBar.personal')} spaceType="public" views={section.publicViews} addButtonTooltip={tr('sideBar.addAPage')} />
        </>
      )}
      <VSpace size={200} />
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
    <div className="sb-hover-scope" style={{ display: 'flex', flexDirection: 'column' }}>
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
      <VSpace size={4} />
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
    <div className="sb-folder-header" style={{ height: 32, display: 'flex', flexShrink: 0 }}>
      <FlowyButton
        style={{ flex: 1 }}
        margin="0 4px 0 6px"
        iconPadding={10}
        onTap={onPressed}
        text={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <FlowyText style={{ lineHeight: 1.15 }}>{title}</FlowyText>
            <div style={{ width: 4 }} />
            <FlowySvg svg={isExpanded ? 'workspace_drop_down_menu_show_s' : 'workspace_drop_down_menu_hide_s'} />
          </div>
        }
        rightIcon={
          <div className="sb-folder-header-reveal" style={{ display: 'flex' }}>
            <SbIconButton
              width={24}
              iconPadding={4}
              tooltip={addButtonTooltip}
              icon={<FlowySvg svg="view_item_add_s" />}
              onPressed={onAdded}
            />
          </div>
        }
      />
    </div>
  );
}
