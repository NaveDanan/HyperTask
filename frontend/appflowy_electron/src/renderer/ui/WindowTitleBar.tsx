import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useBrightness } from '@/theme/appearance-store';

type Caption = 'minimize' | 'maximize' | 'unmaximize' | 'close';

// window_manager WindowCaptionButton painters (16×16, 1px strokes).
const GLYPHS: Record<Caption, ReactNode> = {
  minimize: <path d="M3 8.5h10" />,
  maximize: <rect x="3.5" y="3.5" width="9" height="9" />,
  unmaximize: (
    <>
      <rect x="3.5" y="5.5" width="7" height="7" />
      <path d="M5.5 5.5v-2h7v7h-2" />
    </>
  ),
  close: <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />,
};

function CaptionButton({ kind, onClick }: { kind: Caption; onClick: () => void }) {
  const light = useBrightness() === 'light';
  const [state, setState] = useState<'normal' | 'hover' | 'pressed'>('normal');
  const isClose = kind === 'close';
  const background =
    state === 'normal'
      ? 'transparent'
      : isClose
        ? state === 'pressed'
          ? '#C42B1CE6'
          : '#C42B1C'
        : light
          ? state === 'pressed'
            ? 'rgba(0,0,0,0.0241)'
            : 'rgba(0,0,0,0.0373)'
          : state === 'pressed'
            ? 'rgba(255,255,255,0.0419)'
            : 'rgba(255,255,255,0.0605)';
  const icon =
    isClose && state !== 'normal'
      ? '#FFFFFF'
      : light
        ? state === 'pressed'
          ? 'rgba(0,0,0,0.6063)'
          : 'rgba(0,0,0,0.8956)'
        : state === 'pressed'
          ? 'rgba(255,255,255,0.786)'
          : '#FFFFFF';
  return (
    <div
      className="no-drag"
      style={{ minWidth: 46, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background }}
      onMouseEnter={() => setState('hover')}
      onMouseLeave={() => setState('normal')}
      onMouseDown={() => setState('pressed')}
      onMouseUp={() => setState('hover')}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={icon} strokeWidth="1">
        {GLYPHS[kind]}
      </svg>
    </div>
  );
}

/**
 * WindowTitleBar (shared/window_title_bar.dart): 40px, sidebar background, draggable,
 * double-click toggles maximize, Windows caption buttons on the right. Windows only.
 */
export function WindowTitleBar({ leftChildren, style }: { leftChildren?: ReactNode; style?: CSSProperties }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void window.appflowy.window.isMaximized().then(setMaximized);
    return window.appflowy.window.onMaximizedChange(setMaximized);
  }, []);
  if (!navigator.userAgent.includes('Windows')) return null;
  return (
    <div
      className="drag-region"
      onDoubleClick={() => window.appflowy.window.toggleMaximize()}
      style={{
        height: 40,
        flexShrink: 0,
        background: 'var(--cs-surface-container-highest)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 4,
        ...style,
      }}
    >
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center' }}>
        {leftChildren}
      </div>
      <div style={{ flex: 1 }} />
      <CaptionButton kind="minimize" onClick={() => window.appflowy.window.minimize()} />
      <CaptionButton kind={maximized ? 'unmaximize' : 'maximize'} onClick={() => window.appflowy.window.toggleMaximize()} />
      <CaptionButton kind="close" onClick={() => window.appflowy.window.close()} />
    </div>
  );
}
