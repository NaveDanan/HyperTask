import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
export function Tooltip({ message, rich, preferBelow = true, verticalOffset = 16, children }: TooltipProps) {
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
    const centerY = anchor.top + anchor.height / 2;
    const below = centerY + verticalOffset;
    const above = centerY - verticalOffset - height;
    const fitsBelow = below + height <= window.innerHeight;
    const fitsAbove = above >= 0;
    const top = preferBelow ? (fitsBelow || !fitsAbove ? below : above) : fitsAbove || !fitsBelow ? above : below;
    const left = Math.min(Math.max(0, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width);
    setPos({ left, top });
  }, [anchor, preferBelow, verticalOffset]);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        zIndex: 10000,
        pointerEvents: 'none',
        background: 'var(--tooltip-bg)',
        color: 'var(--tooltip-fg)',
        borderRadius: 10,
        padding: '8px 12px',
        minHeight: 24,
        fontSize: 'calc(14px * var(--text-scale, 1))',
        lineHeight: '20px',
        fontWeight: 400,
        whiteSpace: 'pre-line',
        maxWidth: 'calc(100vw - 16px)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A rich tooltip of a label and a shortcut hint line (hint at 70% alpha, as tooltipHintTextStyle). */
export function shortcutTooltip(label: string, shortcut: string): ReactNode {
  return (
    <>
      {label}
      {'\n'}
      <span style={{ opacity: 0.7 }}>{shortcut}</span>
    </>
  );
}
