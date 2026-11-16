// ViewAncestorCache + ViewAncestorBloc (mobile/presentation/search/view_ancestor_cache.dart,
// mobile_view_ancestors.dart): the ancestors' names of a view, cached and refreshed.
import { useEffect, useState } from 'react';
import { FolderEventGetViewAncestors } from '@/backend/events';
import { nameOrDefault } from '../view/view-ext';

export interface ViewParent {
  id: string;
  name: string;
}

const cache = new Map<string, ViewParent[]>();

async function fetchAncestors(viewId: string): Promise<ViewParent[] | null> {
  const result = await FolderEventGetViewAncestors({ value: viewId });
  if (!result.ok) return null;
  // Drop the workspace root (no parent) and the view itself.
  const ancestors = result.value.items
    .filter((e) => e.parentViewId !== '' && e.id !== viewId)
    .map((e) => ({ id: e.id, name: nameOrDefault(e) }));
  cache.set(viewId, ancestors);
  return ancestors;
}

/** { ancestors, isLoading }: cached value first, refreshed in the background. */
export function useViewAncestors(viewId: string): { ancestors: ViewParent[]; isLoading: boolean } {
  const [state, setState] = useState(() => {
    const cached = cache.get(viewId);
    return { ancestors: cached ?? [], isLoading: !cached };
  });
  useEffect(() => {
    let active = true;
    void fetchAncestors(viewId).then((ancestors) => {
      if (active && ancestors) setState({ ancestors, isLoading: false });
      else if (active) setState((s) => ({ ...s, isLoading: false }));
    });
    return () => {
      active = false;
    };
  }, [viewId]);
  return state;
}

/** buildOnelinePath: `first / ... / last` beyond two levels. */
export function onelinePath(ancestors: ViewParent[]): string {
  const names = ancestors.length > 2 ? [ancestors[0].name, '...', ancestors[ancestors.length - 1].name] : ancestors.map((a) => a.name);
  return names.join(' / ');
}
