import { useState } from 'react';
import { homeSettingActions } from './home-setting-store';

/** SidebarResizer (workspace/presentation/widgets/sidebar_resizer.dart): a 4px strip, 2px blue line on hover/drag. */
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
      style={{ position: 'absolute', top: 0, bottom: 0, left, width: 4, cursor: 'col-resize', zIndex: 3 }}
    >
      <div style={{ width: 2, height: '100%', background: active || dragging ? '#00B5FF' : 'transparent' }} />
    </div>
  );
}
