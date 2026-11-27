// Stable list order (spec D9.6): a new ranking never reorders the list under the pointer or keyboard.
// While the owner interacts, the new order waits behind an Apply pill; it applies on request, after 10
// idle seconds once the pointer has left the list, or on the next visit. Removed or revoked tasks
// disappear at once, and task data (Start eligibility, blockers) is always current.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HyperHubSnapshot } from '@shared/HyperTaskHub';
import { hyperSelectPendingOrder, type HyperHubFilters } from '../state/HyperTaskHubSelectors';

const hyperHubIdleApplyMs = 10_000;

export interface HyperHubStableOrder {
  /** Task ids in the order to render. */
  order: readonly string[];
  /** Moved items waiting behind the Apply pill (0 when none). */
  pendingMoves: number;
  apply: () => void;
  /** Spread on the list container. */
  listProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onPointerDown: () => void;
    onFocusCapture: () => void;
    onBlurCapture: (event: React.FocusEvent<HTMLElement>) => void;
    onKeyDown: () => void;
  };
}

export function useHyperHubStableOrder(snapshot: HyperHubSnapshot | null, filters?: HyperHubFilters): HyperHubStableOrder {
  const [displayed, setDisplayed] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<{ order: readonly string[]; movedCount: number } | null>(null);
  const pointerInside = useRef(false), focusInside = useRef(false), lastTouch = useRef(0);
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;
  const interacting = () => pointerInside.current || focusInside.current || Date.now() - lastTouch.current < 1_500;

  useEffect(() => {
    if (!snapshot) { setDisplayed([]); setPending(null); return; }
    const next = hyperSelectPendingOrder(displayedRef.current, snapshot, filters);
    if (!displayedRef.current.length || next.movedCount === 0 || !interacting()) {
      setDisplayed(next.order); setPending(null);
    } else {
      // Keep positions, but drop tasks that are gone and append arrivals at the end until Apply.
      const present = new Set(next.order);
      const kept = displayedRef.current.filter(id => present.has(id));
      const keptSet = new Set(kept);
      setDisplayed([...kept, ...next.order.filter(id => !keptSet.has(id))]);
      setPending(next);
    }
  }, [snapshot, filters]);

  const apply = useCallback(() => {
    setPending(current => { if (current) setDisplayed(current.order); return null; });
  }, []);

  // Apply after 10 idle seconds once the owner is clear of the list.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (!pointerInside.current && !focusInside.current && Date.now() - lastTouch.current >= hyperHubIdleApplyMs) apply();
    }, 1_000);
    return () => clearInterval(timer);
  }, [pending, apply]);

  const touch = () => { lastTouch.current = Date.now(); };
  const listProps = useMemo<HyperHubStableOrder['listProps']>(() => ({
    onPointerEnter: () => { pointerInside.current = true; touch(); },
    onPointerLeave: () => { pointerInside.current = false; touch(); },
    onPointerDown: touch,
    onFocusCapture: () => { focusInside.current = true; touch(); },
    onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusInside.current = false; touch(); },
    onKeyDown: touch,
  }), []);

  return { order: displayed, pendingMoves: pending?.movedCount ?? 0, apply, listProps };
}
