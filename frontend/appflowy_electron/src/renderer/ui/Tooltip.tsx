import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShortcutKeys } from '@/components/app/shortcut';

export interface TooltipProps {
  message?: string;
  /** richMessage: e.g. a label line and a shortcut hint line. */
  rich?: ReactNode;
  preferBelow?: boolean;
  verticalOffset?: number;
  children: ReactNode;
}

const WAIT_MS = 300;
const listeners = new Set<() => void>();
// Tooltip.dismissAllToolTips() on any scroll pointer signal (app_widget.dart).
window.addEventListener('wheel', () => listeners.forEach((hide) => hide()), { passive: true, capture: true });

/** FlowyTooltip (packages/flowy_infra_ui/lib/widget/flowy_tooltip.dart). */
export function Tooltip({ message, rich, preferBelow = true, verticalOffset = 6, children }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number>(undefined);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      setAnchor(null);
    };
    listeners.add(hide);
    return () => {
      listeners.delete(hide);
      window.clearTimeout(timer.current);
    };
  }, []);

  if (!message && !rich) return <>{children}</>;

  const target = () => (anchorRef.current?.firstElementChild as HTMLElement | null) ?? anchorRef.current;
  return (
    <span
      ref={anchorRef}
      style={{ display: 'contents' }}
      onMouseEnter={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          const el = target();
          if (el) setAnchor(el.getBoundingClientRect());
        }, WAIT_MS);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAnchor(null), 100);
      }}
      onMouseDown={() => {
        window.clearTimeout(timer.current);
        setAnchor(null);
      }}
    >
      {children}
      {anchor && (
        <TooltipBubble anchor={anchor} preferBelow={preferBelow} verticalOffset={verticalOffset}>
          {rich ?? message}
        </TooltipBubble>
      )}
    </span>
  );
}

function TooltipBubble({
  anchor,
  preferBelow,
  verticalOffset,
  children,
}: {
  anchor: DOMRect;
  preferBelow: boolean;
  verticalOffset: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const below = anchor.bottom + verticalOffset;
    const above = anchor.top - verticalOffset - height;
    const fitsBelow = below + height <= window.innerHeight;
    const fitsAbove = above >= 0;
    const top = preferBelow ? (fitsBelow || !fitsAbove ? below : above) : fitsAbove || !fitsBelow ? above : below;
    const left = Math.min(Math.max(0, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width);
    setPos({ left, top });
  }, [anchor, preferBelow, verticalOffset]);

  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed z-[100] max-w-xs whitespace-pre-line rounded-md bg-foreground px-3 py-1.5 text-xs text-background animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A tooltip label with keyboard shortcut caps. */
export function shortcutTooltip(label: string, shortcut: string): ReactNode {
  return (
    <span className="flex items-center gap-2">
      {label}
      <ShortcutKeys keys={shortcut} className="[&_kbd]:bg-background/20 [&_kbd]:text-background" />
    </span>
  );
}
