import type { ReactNode } from 'react';
import { MenuStatus, useHomeSettingStore } from '../home/home-setting-store';

const isMac = navigator.userAgent.includes('Mac');

/** HomeLayout.menuSpacing: 80 only when the sidebar is hidden on macOS. */
export function useMenuSpacing() {
  const hidden = useHomeSettingStore((s) => s.menuStatus === MenuStatus.hidden);
  return hidden && isMac ? 80 : 0;
}

/**
 * FlowyNavigation (workspace/presentation/home/navigation.dart): the tab's leftBarItem.
 * When the sidebar is hidden only the title bar's open-sidebar button shows (HomeStack's
 * ToggleMenuButton) — adding one here duplicated it.
 */
export function FlowyNavigation({ leftBarItem }: { leftBarItem: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center">
      {leftBarItem}
    </div>
  );
}

/** HomeTopBar (home_stack.dart): 56px, surface, padding 12, [menuSpacing, navigation, 16, rightBarItem]. */
export function HomeTopBar({ leftBarItem, rightBarItem }: { leftBarItem: ReactNode; rightBarItem?: ReactNode }) {
  const menuSpacing = useMenuSpacing();
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-3">
      <div className="shrink-0" style={{ width: menuSpacing }} />
      <FlowyNavigation leftBarItem={leftBarItem} />
      <div className="ml-auto flex items-center gap-1">{rightBarItem}</div>
    </div>
  );
}
