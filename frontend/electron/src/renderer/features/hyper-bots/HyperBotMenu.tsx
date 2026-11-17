// Ported from bot-hq (web/src/components/Menu.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
export function HyperBotMenu({ items, onClose, above, center }: { items: { label: string; onSelect: () => void }[]; onClose: () => void; above?: boolean; center?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const down = (event: PointerEvent) => { if (!ref.current?.parentElement?.contains(event.target as Node)) close.current(); };
    document.addEventListener('pointerdown', down);
    return () => { document.removeEventListener('pointerdown', down); if (previous?.isConnected && (document.activeElement === document.body || ref.current?.contains(document.activeElement))) previous.focus(); };
  }, []);
  return <div ref={ref} className={cn('menu', above ? 'is-above' : 'is-below', center ? 'is-center' : 'is-left')} role="menu" onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); } onClose(); }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const nodes = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
    nodes[event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
  }}>{items.map(item => <button key={item.label} type="button" role="menuitem" className="menu__item" onClick={() => { onClose(); item.onSelect(); }}>{item.label}</button>)}</div>;
}
