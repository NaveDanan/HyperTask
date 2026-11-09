import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTr } from '@/i18n';
import { useBrightness } from '@/theme/appearance-store';
import { FlowyHover, FlowyIconButton, FlowySvg } from '@/ui';
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
    <div
      style={{
        height: 56,
        flexShrink: 0,
        background: 'var(--cs-surface-container-highest)',
        padding: 12,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <FlowyIconButton
        width={24}
        radius={8}
        tooltip={tr('sideBar.closeSidebar')}
        icon={<FlowySvg svg="show_menu_s" size={16} />}
        onPressed={() => tabsActions.closeSecondaryPlugin()}
      />
      <div style={{ width: 8 }} />
      <FlowyIconButton
        width={24}
        radius={8}
        tooltip={tr('sideBar.expandSidebar')}
        icon={<FlowySvg svg="full_view_s" size={16} />}
        onPressed={() => tabsActions.expandSecondaryPlugin()}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>{rightBarItem}</div>
    </div>
  );
}

/** SecondaryViewResizer: 1px divider, 11px hit area, primary 2px line on hover (after 500 ms) or drag. */
function SecondaryViewResizer({ onWidth }: { onWidth: (width: number) => void }) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div style={{ position: 'relative', width: 1, flexShrink: 0, background: 'var(--th-divider)' }}>
      <div
        style={{ position: 'absolute', top: 0, bottom: 0, left: -5, width: 11, cursor: 'ew-resize', zIndex: 2, display: 'flex', justifyContent: 'center' }}
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
        <div style={{ width: 2, height: '100%', background: hover || dragging ? 'var(--cs-primary)' : 'transparent', transition: 'background 100ms' }} />
      </div>
    </div>
  );
}

/**
 * SecondaryView (home_stack.dart): the side view used by AI chat "open page from message".
 * Width max(450, 3/7 of the tab), 300 ms ease-out open/close, and a re-open handle while hidden.
 */
export function SecondaryView({ tab, adaptedPercentageWidth }: { tab: Tab; adaptedPercentageWidth: number }) {
  const light = useBrightness() === 'light';
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
    <div style={{ position: 'relative', display: 'flex', flexShrink: 0, background: 'var(--cs-surface)' }}>
      <div
        style={{
          width: open ? width : 0,
          overflow: 'hidden',
          transition: 'width 300ms ease-out',
          display: 'flex',
        }}
      >
        {width > 0 && (
          <div
            style={{
              width,
              flexShrink: 0,
              display: 'flex',
              transform: open ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 300ms ease-out',
            }}
          >
            <SecondaryViewResizer onWidth={setWidth} />
            <ProvideViewScope scope={scope}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <HomeSecondaryTopBar rightBarItem={builder.rightBarItem} />
                {/* No contentPadding and no user profile in the secondary view. */}
                <div style={{ flex: 1, minHeight: 0 }}>{builder.buildWidget({})}</div>
              </div>
            </ProvideViewScope>
          </div>
        )}
      </div>
      {!shown && hasSecondary && (
        <div style={{ position: 'absolute', right: '100%', top: 120, zIndex: 3 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '12px 0 0 12px',
              background: 'var(--cs-surface)',
              boxShadow: light ? '0 4px 20px #1F23291F' : '0 4px 20px rgba(15,19,28,0.08)',
              animation: 'flowy-fade-in 150ms',
            }}
            onClick={() => tabsActions.showSecondaryPlugin()}
          >
            <FlowyHover
              borderRadius={0}
              style={{
                width: 36,
                height: 36,
                boxSizing: 'border-box',
                borderRadius: '12px 0 0 12px',
                border: `1px solid ${light ? '#1F232914' : 'var(--th-divider)'}`,
                borderRight: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FlowySvg svg="rename_s" size={16} />
            </FlowyHover>
          </div>
        </div>
      )}
    </div>
  );
}
