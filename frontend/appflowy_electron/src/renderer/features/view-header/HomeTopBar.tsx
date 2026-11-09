import type { ReactNode } from 'react';
import { useTr } from '@/i18n';
import { FlowyIconButton, FlowySvg, Tooltip, shortcutTooltip } from '@/ui';
import { MenuStatus, homeSettingActions, useHomeSettingStore } from '../home/home-setting-store';

const isWindows = navigator.userAgent.includes('Windows');
const isMac = navigator.userAgent.includes('Mac');

/** HomeLayout.menuSpacing: 80 only when the sidebar is hidden on macOS. */
export function useMenuSpacing() {
  const hidden = useHomeSettingStore((s) => s.menuStatus === MenuStatus.hidden);
  return hidden && isMac ? 80 : 0;
}

/** FlowyNavigation (workspace/presentation/home/navigation.dart): [collapse button] + leftBarItem. */
export function FlowyNavigation({ leftBarItem }: { leftBarItem: ReactNode }) {
  const { tr } = useTr();
  const hidden = useHomeSettingStore((s) => s.menuStatus === MenuStatus.hidden);
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
      {/* _renderCollapse: non-Windows only; Windows has the toggle in its title bar. */}
      {!isWindows && hidden && (
        <div style={{ paddingRight: 8, display: 'flex' }}>
          <div style={{ width: 24, height: 24, position: 'relative' }}>
            <Tooltip rich={shortcutTooltip(tr('sideBar.openSidebar'), isMac ? '⌘+.' : 'Ctrl+\\')}>
              <div style={{ transform: 'rotate(180deg)', display: 'flex' }} onMouseDown={() => homeSettingActions.collapseMenu()}>
                <FlowyIconButton width={24} icon={<FlowySvg svg="double_back_arrow_m" color="var(--af-icon-secondary)" />} />
              </div>
            </Tooltip>
          </div>
        </div>
      )}
      {/* navigationItems => [this]: one NaviItemWidget, the leftBarItem padded h2 v2. */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0, padding: '2px 2px', display: 'flex', alignItems: 'center' }}>{leftBarItem}</div>
      </div>
    </div>
  );
}

/** HomeTopBar (home_stack.dart): 56px, surface, padding 12, [menuSpacing, navigation, 16, rightBarItem]. */
export function HomeTopBar({ leftBarItem, rightBarItem }: { leftBarItem: ReactNode; rightBarItem?: ReactNode }) {
  const menuSpacing = useMenuSpacing();
  return (
    <div
      style={{
        height: 56,
        flexShrink: 0,
        background: 'var(--cs-surface)',
        padding: '12px 12px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div style={{ width: menuSpacing, flexShrink: 0 }} />
      <FlowyNavigation leftBarItem={leftBarItem} />
      <div style={{ width: 16, flexShrink: 0 }} />
      {rightBarItem}
    </div>
  );
}
