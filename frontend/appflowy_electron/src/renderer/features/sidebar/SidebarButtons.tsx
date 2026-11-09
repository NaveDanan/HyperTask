// Sidebar entries: the search button (_SidebarSearchButton), SidebarNewPageButton
// (shared/sidebar_new_page_button.dart), the Jira entry and SidebarFooter (footer/*.dart).
import { useEffect, type ReactNode } from 'react';
import { ViewLayoutPB, ViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useTr } from '@/i18n';
import { FlowyButton, FlowySvg, FlowyText, Tooltip } from '@/ui';
import { createNewPage, toggleCommandPalette } from '@/features/home/notifiers';
import { localToolPlugin, trashPlugin } from '@/features/tabs/plugin';
import { tabsActions, useTabsStore } from '@/features/tabs/tabs-store';
import { hintTooltip, isMac } from './components';
import { sectionsActions } from './stores/sections-store';
import { sidebarSpace } from './stores/space-store';
import { useWorkspaceStore } from './stores/workspace-store';

export function SidebarSearchButton() {
  const { tr } = useTr();
  return (
    <Tooltip rich={hintTooltip(tr('search.sidebarSearchIcon'), isMac ? '⌘+P' : 'Ctrl+P')}>
      <div style={{ height: '100%', display: 'flex' }}>
        <FlowyButton
          style={{ flex: 1 }}
          margin="0 0 0 8px"
          iconPadding={12}
          leftIcon={<FlowySvg svg="search_s" />}
          text={<FlowyText>{tr('search.label')}</FlowyText>}
          onTap={() => toggleCommandPalette.emit()}
        />
      </div>
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
  return (
    <div style={{ padding: '0 8px', height: 30, width: '100%', flexShrink: 0, display: 'flex' }}>
      <FlowyButton
        style={{ flex: 1 }}
        margin="0 0 0 4px"
        iconPadding={8}
        leftIcon={<FlowySvg svg="new_app_m" blendMode={null} size={24} />}
        leftIconSize={24}
        text={<FlowyText style={{ lineHeight: 1.15 }}>{tr('newPageText')}</FlowyText>}
        onTap={() => createNewPageInSidebar()}
      />
    </div>
  );
}

/** Icons.task_alt (Material), 18px. */
function TaskAltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22 5.18 10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zM12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8c1.57 0 3.04.46 4.28 1.25l1.45-1.45A10.02 10.02 0 0 0 12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.73 0 3.36-.44 4.78-1.22l-1.5-1.5c-1 .46-2.11.72-3.28.72zm7-5h-3v2h3v3h2v-3h3v-2h-3v-3h-2v3z" />
    </svg>
  );
}

/** The Jira entry (this checkout): a Material TextButton.icon, centered, not localized. */
export function JiraButton() {
  return (
    <div style={{ padding: '0 8px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
      <div className="sb-text-button" onClick={() => tabsActions.openPlugin(localToolPlugin('jira'))}>
        <TaskAltIcon />
        <span>Jira</span>
      </div>
    </div>
  );
}

function SidebarFooterButton({ icon, iconSize, text, onTap }: { icon: FlowySvgName; iconSize: number; text: string; onTap: () => void }) {
  return (
    <div style={{ height: 32, display: 'flex' }}>
      <FlowyButton
        style={{ flex: 1 }}
        margin={4}
        expandText={false}
        leftIcon={<FlowySvg svg={icon} size={iconSize} />}
        leftIconSize={iconSize}
        text={
          <div style={{ paddingRight: 6 }}>
            <FlowyText lineHeight={18}>{text}</FlowyText>
          </div>
        }
        onTap={onTap}
      />
    </div>
  );
}

export function SidebarFooter(): ReactNode {
  const { tr } = useTr();
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SidebarFooterButton
            icon="icon_template_s"
            iconSize={16}
            text={tr('template.label')}
            onTap={() => tabsActions.openPlugin(localToolPlugin('templates'))}
          />
        </div>
        <div style={{ width: 1, height: 14, margin: '0 4px', background: 'var(--afx-border)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SidebarFooterButton
            icon="icon_delete_s"
            iconSize={18}
            text={tr('trash.text')}
            onTap={() => {
              // MenuSharedState.latestOpenView = null clears the tree selection.
              useTabsStore.setState({ latestOpenView: null });
              tabsActions.openPlugin(trashPlugin());
            }}
          />
        </div>
      </div>
    </div>
  );
}
