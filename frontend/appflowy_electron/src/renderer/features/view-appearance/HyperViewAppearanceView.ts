import { useEffect, useMemo, useState } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useAppStore } from '@/startup/app-store';
import { listenView } from '../view-header/view-listener';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureAppearanceOwner, hyperViewAppearance } from './HyperViewAppearanceService';

/** Folder notifications are unscoped invalidations, never authoritative private metadata. */
export function useHyperAppearanceView(view: ViewPB): ViewPB | null {
  const owner = useHyperDocumentOwner(), key = hyperDocumentOwnerKey(owner), launch = useAppStore(state => state.launchId);
  const scope = useMemo(() => hyperCaptureAppearanceOwner(owner), [owner, key, launch]);
  const [loaded, setLoaded] = useState<{ scope: typeof scope; view: ViewPB } | null>(null);
  useEffect(() => {
    if (!scope) return;
    let active = true, version = 0;
    const reload = async () => { const run = ++version; try { const fresh = await hyperViewAppearance.read(view, scope.owner); if (active && scope.isCurrent() && run === version) setLoaded({ scope, view: fresh }); } catch { if (active && scope.isCurrent() && run === version) setLoaded(null); } };
    void reload(); const stopView = listenView(view.id, { onViewUpdated: () => { void reload(); }, onViewMoveToTrash: () => { void reload(); } });
    const stopSaved = hyperViewAppearance.subscribe((updated, original) => { if (active && scope.isCurrent() && updated.id === view.id && hyperDocumentOwnerKey(original) === key) { version++; setLoaded({ scope, view: updated }); } });
    return () => { active = false; version++; stopView(); stopSaved(); };
  }, [scope, view.id, key]);
  return scope?.isCurrent() && loaded?.scope === scope ? loaded.view : null;
}
