// ViewAncestorCache + ViewAncestorBloc (mobile/presentation/search/view_ancestor_cache.dart,
// mobile_view_ancestors.dart): the ancestors' names of a view, cached and refreshed.
import { useEffect, useState } from 'react';
import { FolderEventGetViewAncestors } from '@/backend/events';
import { nameOrDefault } from '../view/view-ext';
import { hyperDocumentOwnerKey, useHyperDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureSearchOwner } from './HyperSearchOwner';

export interface ViewParent {
  id: string;
  name: string;
}

const cache = new Map<string, ViewParent[]>();
let generation = 0;

export function resetViewAncestors() {
  generation++;
  cache.clear();
}

async function fetchAncestors(viewId: string, owner: HyperDocumentOwner): Promise<ViewParent[] | null> {
  const scope = hyperCaptureSearchOwner(owner), captured = generation;
  if (!scope) return null;
  const result = await FolderEventGetViewAncestors({ value: viewId });
  if (!result.ok || !scope.isCurrent() || captured !== generation) return null;
  // Drop the workspace root (no parent) and the view itself.
  const ancestors = result.value.items
    .filter((e) => e.parentViewId !== '' && e.id !== viewId)
    .map((e) => ({ id: e.id, name: nameOrDefault(e) }));
  cache.set(JSON.stringify([scope.key, viewId]), ancestors);
  return ancestors;
}

/** { ancestors, isLoading }: cached value first, refreshed in the background. */
export function useViewAncestors(viewId: string, expectedOwner?: HyperDocumentOwner): { ancestors: ViewParent[]; isLoading: boolean } {
  const currentOwner = useHyperDocumentOwner();
  const owner = expectedOwner ?? currentOwner;
  const key = JSON.stringify([hyperDocumentOwnerKey(owner), viewId]);
  const [state, setState] = useState(() => {
    const cached = owner?.isCurrent() ? cache.get(key) : undefined;
    return { key, ancestors: cached ?? [], isLoading: !cached };
  });
  useEffect(() => {
    const scope = hyperCaptureSearchOwner(owner);
    if (!scope || hyperDocumentOwnerKey(currentOwner) !== scope.key) return;
    let active = true;
    setState({ key, ancestors: cache.get(key) ?? [], isLoading: true });
    void fetchAncestors(viewId, scope.owner).then((ancestors) => {
      if (!active || !scope.isCurrent()) return;
      setState({ key, ancestors: ancestors ?? cache.get(key) ?? [], isLoading: false });
    }).catch(() => {
      if (active && scope.isCurrent()) setState({ key, ancestors: cache.get(key) ?? [], isLoading: false });
    });
    return () => {
      active = false;
    };
  }, [viewId, key, owner, currentOwner]);
  if (!owner?.isCurrent() || hyperDocumentOwnerKey(currentOwner) !== hyperDocumentOwnerKey(owner)) return { ancestors: [], isLoading: false };
  return state.key === key ? state : { ancestors: cache.get(key) ?? [], isLoading: true };
}

/** buildOnelinePath: `first / ... / last` beyond two levels. */
export function onelinePath(ancestors: ViewParent[]): string {
  const names = ancestors.length > 2 ? [ancestors[0].name, '...', ancestors[ancestors.length - 1].name] : ancestors.map((a) => a.name);
  return names.join(' / ');
}
