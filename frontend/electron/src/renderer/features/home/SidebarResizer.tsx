import { useState } from 'react';
import { cn } from '@/lib/utils';
import { homeSettingActions } from './home-setting-store';

/** SidebarResizer (workspace/presentation/widgets/sidebar_resizer.dart): an 8px hit area with a 2px ring line on hover/drag. */
export function SidebarResizer({ left }: { left: number }) {
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onMouseDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        setDragging(true);
        homeSettingActions.resizeStart();
        const move = (e: MouseEvent) => homeSettingActions.resized(e.clientX - startX);
        const up = () => {
          setDragging(false);
          homeSettingActions.resizeEnd();
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
      className="absolute inset-y-0 z-3 flex w-2 -translate-x-1/2 cursor-col-resize justify-center"
      style={{ left }}
    >
      <div className={cn("h-full w-0.5 rounded-full transition-colors", active || dragging ? "bg-ring/60" : "bg-transparent")} />
    </div>
  );
}
