import { useEffect, useState, type ReactNode } from 'react';
import { UpdateButton } from './updates';
import { cn } from '@/lib/utils';

type Caption = 'minimize' | 'maximize' | 'unmaximize' | 'close';

// Windows 11 caption glyphs, 10px, 1px strokes.
const GLYPHS: Record<Caption, ReactNode> = {
  minimize: <path d="M0 5.5h10" />,
  maximize: <rect x="0.5" y="0.5" width="9" height="9" rx="1" />,
  unmaximize: (
    <>
      <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
      <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
    </>
  ),
  close: <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />,
};

function CaptionButton({ kind, label, onClick }: { kind: Caption; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'no-drag flex h-full w-11 items-center justify-center text-foreground/80 transition-colors',
        kind === 'close'
          ? 'hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/90'
          : 'hover:bg-(--caption-hover) active:bg-(--caption-pressed)',
      )}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
        {GLYPHS[kind]}
      </svg>
    </button>
  );
}

/**
 * True where the app uses the frameless custom chrome and must draw its own caption
 * buttons: Windows and Linux. macOS keeps the native traffic lights (hiddenInset).
 */
export const customWindowChrome = navigator.userAgent.includes('Windows') || navigator.userAgent.includes('Linux');

/** Minimize / maximize / close for the frameless window. Renders nothing on macOS. */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void window.appflowy.window.isMaximized().then(setMaximized);
    return window.appflowy.window.onMaximizedChange(setMaximized);
  }, []);
  if (!customWindowChrome) return null;
  return (
    <div className={cn('flex h-full shrink-0 items-stretch', className)}>
      <CaptionButton kind="minimize" label="Minimize" onClick={() => window.appflowy.window.minimize()} />
      <CaptionButton
        kind={maximized ? 'unmaximize' : 'maximize'}
        label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => window.appflowy.window.toggleMaximize()}
      />
      <CaptionButton kind="close" label="Close to tray" onClick={() => window.appflowy.window.close()} />
    </div>
  );
}

/**
 * A draggable window strip (40px). Double-click toggles maximize. Interactive children must
 * carry `no-drag` (Buttons inside `children` get it automatically through the wrapper).
 */
export function TitleBar({ children, className, controls = true }: { children?: ReactNode; className?: string; controls?: boolean }) {
  return (
    <div
      className={cn('drag-region flex h-10 shrink-0 items-center', className)}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) window.appflowy.window.toggleMaximize();
      }}
    >
      <div className="no-drag flex min-w-0 items-center gap-1">{children}</div>
      <div className="h-full flex-1" onDoubleClick={() => window.appflowy.window.toggleMaximize()} />
      {controls && <UpdateButton />}
      {controls && <WindowControls />}
    </div>
  );
}
