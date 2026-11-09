import { useEffect, useRef, useState } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TitleBar } from '@/components/app/window-controls';
import { ShortcutKeys } from '@/components/app/shortcut';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/ui';
import { MenuStatus, homeSettingActions, useHomeSettingStore } from '../home/home-setting-store';
import { useHomeStore } from '../home/home-store';
import { PageStack, usePluginScope } from '../plugins/PageStack';
import { pluginWidgets } from '../plugins/registry';
import { HomeTopBar, useMenuSpacing } from '../view-header/HomeTopBar';
import { ProvideViewScope } from '../view-header/view-scope';
import { didDeleteStackWidget } from './did-delete';
import { SecondaryView } from './SecondaryView';
import { TabsManager } from './TabsManager';
import { tabsActions, useTabsStore, type Tab } from './tabs-store';

const isMac = navigator.userAgent.includes('Mac');

/** _buildToggleMenuButton (Windows): "Open sidebar" while the sidebar is hidden. */
function ToggleMenuButton() {
  const { tr } = useTr();
  const expanded = useHomeSettingStore((s) => s.menuStatus === MenuStatus.expanded);
  if (expanded) return null;
  return (
    <Tooltip rich={<span className="flex items-center gap-2">{tr('sideBar.openSidebar')}<ShortcutKeys keys={isMac ? '⌘+.' : 'Ctrl+\\'} /></span>}>
      <Button variant="ghost" size="icon-sm" aria-label={tr('sideBar.openSidebar')}
        onMouseDown={() => {
          const isExpanded = useHomeSettingStore.getState().menuStatus === MenuStatus.expanded;
          homeSettingActions.changeMenuStatus(isExpanded ? MenuStatus.hidden : MenuStatus.expanded);
        }}
      >
        <PanelLeftOpen className="size-4" />
      </Button>
    </Tooltip>
  );
}

const onDeleted = (view: ViewPB, index?: number) => void didDeleteStackWidget(view, index);

/** One tab: [HomeTopBar + PageStack] + SecondaryView, kept mounted while inactive. */
function TabPage({ tab, active }: { tab: Tab; active: boolean }) {
  const user = useHomeStore((s) => s.user);
  const scope = usePluginScope(tab.plugin, true);
  const builder = pluginWidgets(tab.plugin);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("absolute inset-0", active ? "flex" : "hidden")}>
      <div className="flex min-w-0 flex-1 flex-col">
        <ProvideViewScope scope={scope}>
          <HomeTopBar key={`${tab.plugin.kind}:${tab.plugin.id}`} leftBarItem={builder.leftBarItem} rightBarItem={builder.rightBarItem} />
        </ProvideViewScope>
        <div className="min-h-0 flex-1">
          <PageStack plugin={tab.plugin} scope={scope} context={{ onDeleted, userProfile: user }} />
        </div>
      </div>
      <SecondaryView tab={tab} adaptedPercentageWidth={(width * 3) / 7} />
    </div>
  );
}

/** HomeStack (workspace/presentation/home/home_stack.dart): title bar, tab strip and the tabs' pages. */
export function HomeStack() {
  const tabs = useTabsStore((s) => s.tabs);
  const currentIndex = useTabsStore((s) => s.currentIndex);
  const menuSpacing = useMenuSpacing();
  const hidden = useHomeSettingStore((s) => s.menuStatus === MenuStatus.hidden);

  // onIndexChanged → FocusScope.unfocus(): hides the editor's selection toolbar.
  const previousIndex = useRef(currentIndex);
  useEffect(() => {
    if (previousIndex.current === currentIndex) return;
    previousIndex.current = currentIndex;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, [currentIndex]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar className={hidden ? 'pl-1.5' : 'pl-2'}>
        <ToggleMenuButton />
        <div className="flex min-w-0" style={{ paddingLeft: menuSpacing }}>
          <TabsManager onIndexChanged={(index) => tabsActions.selectTab(index)} />
        </div>
      </TitleBar>
      <div className={cn('relative mr-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-xs', hidden && 'ml-2')}>
        {tabs.map((tab, index) => (
          <TabPage key={tab.key} tab={tab} active={index === currentIndex} />
        ))}
      </div>
    </div>
  );
}
