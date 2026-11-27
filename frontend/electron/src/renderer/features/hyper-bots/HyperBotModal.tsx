// Ported from bot-hq (web/src/components/modals/Modal.tsx), Copyright (c) 2026 Nick Vasilescu, MIT License. See features/hyper-bots/NOTICE.md.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
let hyperBotModalOrigin: HTMLElement | null = null;
export function HyperBotModal({ onClose, children, className, label }: { onClose: () => void; children: ReactNode; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Capture before the portal commits: React autoFocus runs before passive effects.
  const [previous] = useState(() => {
    if (typeof document === 'undefined') return null;
    const active = document.activeElement as HTMLElement | null;
    const menuAnchor = active?.closest('.menu')?.parentElement?.querySelector<HTMLElement>('[aria-haspopup="menu"]');
    const origin = active?.closest('.modal-root') ? hyperBotModalOrigin : menuAnchor ?? active;
    hyperBotModalOrigin = origin;
    return origin;
  });
  useEffect(() => {
    (ref.current?.querySelector<HTMLElement>('input, textarea') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [previous]);
  const content = <div data-hyper-bot className="modal-root">
    <div className="modal-scrim" onMouseDown={onClose} />
    <div ref={ref} className={cn('modal', className)} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key !== 'Tab') return;
        const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])]
          .filter(node => !node.closest('details:not([open])') || node.matches('summary'));
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>{children}</div>
  </div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
export function HyperBotModalHeader({ label, onClose }: { label: string; onClose: () => void }) {
  return <div className="modal__header"><h2 className="modal__title">{label}</h2><button type="button" className="modal__close" aria-label="Close" onClick={onClose}><X size={14} /></button></div>;
}
