import type { ReactNode } from 'react';
import { useTr } from '@/i18n';
import { PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShortcutKeys } from '@/components/app/shortcut';
import { Tooltip } from '@/ui';
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
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {!isWindows && hidden && (
        <Tooltip rich={<span className="flex items-center gap-2">{tr('sideBar.openSidebar')}<ShortcutKeys keys={isMac ? '⌘+.' : 'Ctrl+\\'} /></span>}>
          <Button variant="ghost" size="icon-sm" aria-label={tr('sideBar.openSidebar')} onMouseDown={() => homeSettingActions.collapseMenu()}>
            <PanelLeftOpen className="size-4" />
          </Button>
        </Tooltip>
      )}
      <div className="flex min-w-0 flex-1 items-center">{leftBarItem}</div>
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
