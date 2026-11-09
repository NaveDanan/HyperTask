import { useTr } from '@/i18n';
import { Pin, PinOff, X } from 'lucide-react';
import { MenuRow, MenuSeparator } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import { AppFlowyPopover, Tooltip } from '@/ui';
import { pluginWidgets } from '../plugins/registry';
import { tabsActions, useTabsStore, type Tab } from './tabs-store';

/** TabMenu: Close / Close other tabs / Pin|Unpin. */
export function TabMenu({ pageId, isPinned, isAllPinned, close }: { pageId: string; isPinned: boolean; isAllPinned: boolean; close: () => void }) {
  const { tr } = useTr();
  const closeButton = (
    <div>
      <MenuRow disabled={isPinned} icon={<X className="size-4" />} label={tr('tabMenu.close')}
        onClick={() => { tabsActions.closeTab(pageId); close(); }} />
    </div>
  );
  return (
    <div className="flex flex-col">
      {isPinned ? <Tooltip message={tr('tabMenu.closeDisabledHint')}>{closeButton}</Tooltip> : closeButton}
      <Tooltip message={isAllPinned ? tr('tabMenu.closeOthersDisabledHint') : tr('tabMenu.closeOthersHint')}>
        <div>
          <MenuRow disabled={isAllPinned} icon={<X className="size-4" />} label={tr('tabMenu.closeOthers')}
            onClick={() => { tabsActions.closeOtherTabs(pageId); close(); }} />
        </div>
      </Tooltip>
      <MenuSeparator />
      <MenuRow icon={isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} label={isPinned ? tr('tabMenu.unpinTab') : tr('tabMenu.pinTab')}
        onClick={() => { tabsActions.togglePin(pageId); close(); }} />
    </div>
  );
}

/** Selection happens on primary pointer DOWN; the close button does not select the tab. */
function FlowyTab({ tab, isCurrent, isAllPinned, onTap }: { tab: Tab; isCurrent: boolean; isAllPinned: boolean; onTap: () => void }) {
  const builder = pluginWidgets(tab.plugin);
  const pinned = tab.isPinned;
  const content = (
    <div className={cn('group/tab flex h-7 min-w-24 max-w-52 flex-1 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
      isCurrent && 'bg-background text-foreground shadow-xs ring-1 ring-border', pinned && 'w-9 min-w-9 flex-none justify-center')}
      onMouseDown={(event) => { if (event.button === 0) onTap(); }}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {builder.tabBarItem(pinned)}
      </button>
      {!pinned && (
        <button type="button" aria-label={builder.viewName ? `Close ${builder.viewName}` : 'Close'}
          className="flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-colors group-hover/tab:opacity-100 hover:bg-accent focus-visible:opacity-100"
          onMouseDown={(event) => event.stopPropagation()} onClick={() => tabsActions.closeTab(tab.plugin.id)}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
  return (
    <AppFlowyPopover trigger={['secondaryClick']} showAtCursor offset={{ x: 4, y: 4 }}
      constraints={{ maxWidth: 192, maxHeight: 600, width: 192 }} triggerStyle={{ display: 'contents' }}
      popup={(close) => <TabMenu pageId={tab.plugin.id} isPinned={pinned} isAllPinned={isAllPinned} close={close} />}>
      {builder.viewName ? <Tooltip message={builder.viewName}>{content}</Tooltip> : content}
    </AppFlowyPopover>
  );
}

/** The strip stays hidden with a single tab. */
export function TabsManager({ onIndexChanged }: { onIndexChanged: (index: number) => void }) {
  const tabs = useTabsStore((s) => s.tabs);
  const currentIndex = useTabsStore((s) => s.currentIndex);
  if (tabs.length === 1) return null;
  const isAllPinned = tabs.every((t) => t.isPinned);
  return (
    <div className="flex h-10 min-w-0 items-center gap-1 overflow-hidden">
      {tabs.map((tab, index) => (
        <div key={`tab-${tab.key}`} className={cn('flex min-w-0 max-w-52 flex-1', tab.isPinned && 'w-9 flex-none')}>
          <FlowyTab tab={tab} isCurrent={index === currentIndex} isAllPinned={isAllPinned}
            onTap={() => { if (index !== currentIndex) onIndexChanged(index); }} />
        </div>
      ))}
    </div>
  );
}
