import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTr } from '@/i18n';
import { Maximize2, PanelRightOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/ui';
import { PluginType } from './plugin';
import { pluginWidgets } from '../plugins/registry';
import { usePluginScope } from '../plugins/PageStack';
import { ProvideViewScope } from '../view-header/view-scope';
import { tabsActions, type Tab } from './tabs-store';

const MIN_WIDTH = 450;

/** HomeSecondaryTopBar: close / expand buttons and the secondary plugin's right bar item. */
function HomeSecondaryTopBar({ rightBarItem }: { rightBarItem: ReactNode }) {
  const { tr } = useTr();
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-3">
      <Tooltip message={tr('sideBar.closeSidebar')}>
        <Button variant="ghost" size="icon-sm" aria-label={tr('sideBar.closeSidebar')} onClick={() => tabsActions.closeSecondaryPlugin()}><X className="size-4" /></Button>
      </Tooltip>
      <Tooltip message={tr('sideBar.expandSidebar')}>
        <Button variant="ghost" size="icon-sm" aria-label={tr('sideBar.expandSidebar')} onClick={() => tabsActions.expandSecondaryPlugin()}><Maximize2 className="size-4" /></Button>
      </Tooltip>
      <div className="ml-auto flex min-w-0 items-center gap-1">{rightBarItem}</div>
    </div>
  );
}

/** SecondaryViewResizer: 1px divider, 6px hit area, ring line on hover (after 500 ms) or drag. */
function SecondaryViewResizer({ onWidth }: { onWidth: (width: number) => void }) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="relative w-0 shrink-0">
      <div
        className="absolute inset-y-0 -left-0.5 z-2 flex w-1.5 cursor-col-resize justify-center"
        onMouseEnter={() => {
          timer.current = window.setTimeout(() => setHover(true), 500);
        }}
        onMouseLeave={() => {
          window.clearTimeout(timer.current);
          setHover(false);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          setDragging(true);
          const move = (e: MouseEvent) => {
            const width = window.innerWidth - e.clientX;
            if (width >= MIN_WIDTH) onWidth(width);
          };
          const up = () => {
            setDragging(false);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      >
        <div className={cn("h-full w-px transition-colors", hover || dragging ? "bg-ring" : "bg-border")} />
      </div>
    </div>
  );
}

/**
 * SecondaryView (home_stack.dart): the side view used by AI chat "open page from message".
 * Width max(450, 3/7 of the tab), 300 ms ease-out open/close, and a re-open handle while hidden.
 */
export function SecondaryView({ tab, adaptedPercentageWidth }: { tab: Tab; adaptedPercentageWidth: number }) {
  const shown = tab.showSecondary;
  const hasSecondary = tab.secondary.type !== PluginType.blank;
  const [width, setWidth] = useState(shown ? Math.max(MIN_WIDTH, adaptedPercentageWidth) : 0);
  const [open, setOpen] = useState(shown);
  const scope = usePluginScope(tab.secondary, false);

  useEffect(() => {
    if (shown) {
      setWidth(Math.max(MIN_WIDTH, adaptedPercentageWidth));
      setOpen(true);
    } else {
      setOpen(false);
      const timer = window.setTimeout(() => setWidth(0), 300);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const builder = pluginWidgets(tab.secondary);
  return (
    <div className="relative flex shrink-0 bg-background">
      <div className="flex overflow-hidden transition-[width] duration-300 ease-out"
        style={{ width: open ? width : 0 }}
      >
        {width > 0 && (
          <div className="flex shrink-0 border-l transition-transform duration-300 ease-out"
            style={{ width, transform: open ? 'translateX(0)' : 'translateX(100%)' }}
          >
            <SecondaryViewResizer onWidth={setWidth} />
            <ProvideViewScope scope={scope}>
              <div className="flex min-w-0 flex-1 flex-col">
                <HomeSecondaryTopBar rightBarItem={builder.rightBarItem} />
                {/* No contentPadding and no user profile in the secondary view. */}
                <div className="min-h-0 flex-1">{builder.buildWidget({})}</div>
              </div>
            </ProvideViewScope>
          </div>
        )}
      </div>
      {!shown && hasSecondary && (
        <Button variant="outline" size="icon" className="absolute top-30 right-full z-3 rounded-r-none border-r-0 bg-background"
          onClick={() => tabsActions.showSecondaryPlugin()}><PanelRightOpen className="size-4" /></Button>
      )}
    </div>
  );
}
