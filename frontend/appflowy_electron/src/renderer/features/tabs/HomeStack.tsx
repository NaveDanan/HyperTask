import { useEffect, useRef, useState } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { FlowyHover, FlowySvg, Tooltip, shortcutTooltip } from '@/ui';
import { WindowTitleBar } from '@/ui/WindowTitleBar';
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
    <Tooltip rich={shortcutTooltip(tr('sideBar.openSidebar'), isMac ? '⌘+.' : 'Ctrl+\\')}>
      <div
        style={{ display: 'flex' }}
        onMouseDown={() => {
          const isExpanded = useHomeSettingStore.getState().menuStatus === MenuStatus.expanded;
          homeSettingActions.changeMenuStatus(isExpanded ? MenuStatus.hidden : MenuStatus.expanded);
        }}
      >
        <FlowyHover style={{ width: 24, height: 24, padding: 4, boxSizing: 'border-box', display: 'flex' }}>
          <FlowySvg svg="hide_menu_s" style={{ transform: 'rotate(180deg)' }} />
        </FlowyHover>
      </div>
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
    <div ref={ref} style={{ position: 'absolute', inset: 0, display: active ? 'flex' : 'none' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <ProvideViewScope scope={scope}>
          <HomeTopBar key={`${tab.plugin.kind}:${tab.plugin.id}`} leftBarItem={builder.leftBarItem} rightBarItem={builder.rightBarItem} />
        </ProvideViewScope>
        <div style={{ flex: 1, minHeight: 0 }}>
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

  // onIndexChanged → FocusScope.unfocus(): hides the editor's selection toolbar.
  const previousIndex = useRef(currentIndex);
  useEffect(() => {
    if (previousIndex.current === currentIndex) return;
    previousIndex.current = currentIndex;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, [currentIndex]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <WindowTitleBar leftChildren={<ToggleMenuButton />} />
      <div style={{ paddingLeft: menuSpacing }}>
        <TabsManager onIndexChanged={(index) => tabsActions.selectTab(index)} />
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {tabs.map((tab, index) => (
          <TabPage key={tab.key} tab={tab} active={index === currentIndex} />
        ))}
      </div>
    </div>
  );
}
