import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { create } from 'zustand';

export const HYPER_CHROME_PANEL_MIN_WIDTH = 900;
interface HyperChromePanelClaim { owner: number; width: number }
export const useHyperChromePanelStore = create<{ claim: HyperChromePanelClaim | null }>(() => ({ claim: null }));
export const hyperChromePanelActions = {
  claim(owner: number, width: number) {
    if (!Number.isFinite(width) || width <= 0) return;
    const current = useHyperChromePanelStore.getState().claim;
    if (current?.owner !== owner || current.width !== width) useHyperChromePanelStore.setState({ claim: { owner, width } });
  },
  release(owner: number) {
    if (useHyperChromePanelStore.getState().claim?.owner === owner) useHyperChromePanelStore.setState({ claim: null });
  },
};
const HyperChromePanelContext = createContext<{ target: HTMLDivElement | null; available: boolean; activeOwner: number | null } | null>(null);
const HyperChromePanelOwner = createContext<number | null>(null);

export function HyperChromePanelScope({ owner, children }: { owner: number | null; children: ReactNode }) {
  return <HyperChromePanelOwner.Provider value={owner}>{children}</HyperChromePanelOwner.Provider>;
}

/** The active primary page can portal a panel here without moving its controller or dialogs. */
export function HyperChromePanel({ available, activeOwner, width, left, transition, children }: {
  available: boolean; activeOwner: number | null; width: number; left: number; transition: string; children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const context = useMemo(() => ({ target, available, activeOwner }), [target, available, activeOwner]);
  return <HyperChromePanelContext.Provider value={context}>
    <div ref={setTarget} data-slot="hyper-chrome-panel" hidden={!available || width === 0}
      className="absolute inset-y-0 overflow-hidden border-l border-border pt-10 pb-2 text-sidebar-foreground"
      style={{ left, width, transition }}><div className="drag-region absolute inset-x-0 top-0 h-10" /></div>
    {children}
  </HyperChromePanelContext.Provider>;
}

export function useHyperChromePanel(width: number, enabled = true) {
  const owner = useContext(HyperChromePanelOwner), shell = useContext(HyperChromePanelContext);
  const target = enabled && owner !== null && shell?.activeOwner === owner && shell.available ? shell.target : null;
  useLayoutEffect(() => {
    if (!target || owner === null) return;
    hyperChromePanelActions.claim(owner, width);
    return () => hyperChromePanelActions.release(owner);
  }, [target, owner, width]);
  return target;
}
