import type { CSSProperties, ReactNode } from 'react';
import { TitleBar, isWindowsChrome } from '@/components/app/window-controls';

/** Preserve caller sizing/background overrides around the shared title bar. */
export function WindowTitleBar({ leftChildren, style }: { leftChildren?: ReactNode; style?: CSSProperties }) {
  if (!isWindowsChrome) return null;
  return (
    <div className="h-10 shrink-0 bg-sidebar pl-1 [&>div]:h-full" style={style}>
      <TitleBar>{leftChildren}</TitleBar>
    </div>
  );
}
