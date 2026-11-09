import { useState, type CSSProperties } from 'react';
import { useTr } from '@/i18n';
import { AppFlowyPopover, FlowyButton, FlowyIconButton, FlowySvg, FlowyText, Tooltip } from '@/ui';
import { pluginWidgets } from '../plugins/registry';
import { tabsActions, useTabsStore, type Tab } from './tabs-store';

/** TabMenu (home/tabs/flowy_tab.dart): Close / Close other tabs / — / Pin|Unpin. */
export function TabMenu({ pageId, isPinned, isAllPinned, close }: { pageId: string; isPinned: boolean; isAllPinned: boolean; close: () => void }) {
  const { tr } = useTr();
  const closeButton = (
    <div style={{ opacity: isPinned ? 0.5 : 1 }}>
      <FlowyButton
        disable={isPinned}
        text={<FlowyText.regular>{tr('tabMenu.close')}</FlowyText.regular>}
        onTap={() => {
          tabsActions.closeTab(pageId);
          close();
        }}
      />
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {isPinned ? <Tooltip message={tr('tabMenu.closeDisabledHint')}>{closeButton}</Tooltip> : closeButton}
      <Tooltip message={isAllPinned ? tr('tabMenu.closeOthersDisabledHint') : tr('tabMenu.closeOthersHint')}>
        <div style={{ opacity: isAllPinned ? 0.5 : 1 }}>
          <FlowyButton
            disable={isAllPinned}
            text={<FlowyText.regular>{tr('tabMenu.closeOthers')}</FlowyText.regular>}
            onTap={() => {
              tabsActions.closeOtherTabs(pageId);
              close();
            }}
          />
        </div>
      </Tooltip>
      <div style={{ height: 1, background: 'var(--th-divider)', flexShrink: 0 }} />
      <FlowyButton
        text={<FlowyText.regular>{isPinned ? tr('tabMenu.unpinTab') : tr('tabMenu.pinTab')}</FlowyText.regular>}
        onTap={() => {
          tabsActions.togglePin(pageId);
          close();
        }}
      />
    </div>
  );
}

/** FlowyTab (home/tabs/flowy_tab.dart). */
function FlowyTab({ tab, isCurrent, isAllPinned, onTap }: { tab: Tab; isCurrent: boolean; isAllPinned: boolean; onTap: () => void }) {
  const [hovering, setHovering] = useState(false);
  const builder = pluginWidgets(tab.plugin);
  const pinned = tab.isPinned;
  const content = (
    <div
      className="flowy-hover"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={
        {
          '--hover-radius': '0px',
          '--hover-base': isCurrent ? 'var(--cs-surface)' : 'var(--cs-surface-container-highest)',
          '--hover-bg': isCurrent ? 'var(--cs-surface)' : 'var(--cs-secondary)',
          cursor: 'default',
          width: pinned ? 54 : undefined,
          flex: pinned ? undefined : 1,
          padding: '0 16px',
          boxSizing: 'border-box',
          height: 40,
          display: 'flex',
          minWidth: 0,
        } as CSSProperties
      }
      // Selection happens on primary pointer DOWN.
      onMouseDown={(event) => {
        if (event.button === 0) onTap();
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 200,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ minWidth: 0, flexShrink: 1, display: 'flex' }}>{builder.tabBarItem(pinned)}</div>
        {!pinned && (
          <div style={{ width: 26, height: 26, flexShrink: 0, visibility: hovering ? 'visible' : 'hidden' }} onMouseDown={(e) => e.stopPropagation()}>
            <FlowyIconButton
              width={26}
              // Set explicitly: the tab's own --hover-bg would otherwise be inherited.
              hoverColor="var(--cs-secondary)"
              onPressed={() => tabsActions.closeTab(tab.plugin.id)}
              icon={<FlowySvg svg="close_s" size={22} />}
            />
          </div>
        )}
      </div>
    </div>
  );
  return (
    <AppFlowyPopover
      trigger={['secondaryClick']}
      showAtCursor
      offset={{ x: 4, y: 4 }}
      constraints={{ maxWidth: 240, maxHeight: 600, width: 240 }}
      triggerStyle={{ display: 'contents' }}
      popup={(close) => <TabMenu pageId={tab.plugin.id} isPinned={pinned} isAllPinned={isAllPinned} close={close} />}
    >
      {builder.viewName ? <Tooltip message={builder.viewName}>{content}</Tooltip> : content}
    </AppFlowyPopover>
  );
}

/** TabsManager (home/tabs/tabs_manager.dart): 40px strip, hidden with a single tab. */
export function TabsManager({ onIndexChanged }: { onIndexChanged: (index: number) => void }) {
  const tabs = useTabsStore((s) => s.tabs);
  const currentIndex = useTabsStore((s) => s.currentIndex);
  if (tabs.length === 1) return null;
  const isAllPinned = tabs.every((t) => t.isPinned);
  return (
    // MoveWindowDetector is a no-op on Windows: the strip does not drag the window.
    <div
      style={{
        height: 40,
        background: 'var(--cs-surface-container-highest)',
        display: 'flex',
        alignItems: 'flex-end',
        overflow: 'hidden',
      }}
    >
      {tabs.map((tab, index) => (
        <div
          key={`tab-${tab.key}`}
          style={tab.isPinned ? { flex: '0 0 auto', display: 'flex' } : { flex: '0 1 200px', minWidth: 0, maxWidth: 200, display: 'flex' }}
        >
          <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            <FlowyTab
              tab={tab}
              isCurrent={index === currentIndex}
              isAllPinned={isAllPinned}
              onTap={() => {
                if (index !== currentIndex) onIndexChanged(index);
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
