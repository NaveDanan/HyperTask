// Adapted from OpenBot memory sources. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
export type HyperMemorySelection = { page: 'facts' | 'sources' | 'missing' } | { page: 'source'; sourceId: string };
export function hyperMemorySelectionFromPath(path?: string): HyperMemorySelection {
  if (!path) return { page: 'facts' };
  try {
    const url = new URL(path, 'https://native.invalid');
    if (url.origin !== 'https://native.invalid') return { page: 'missing' };
    const match = /^\/(?:settings\/|capabilities\/)?memory(?:\/(sources)(?:\/([^/]+))?)?\/?$/.exec(url.pathname);
    if (!match) return { page: 'missing' };
    if (!match[1]) return { page: 'facts' };
    if (!match[2]) return { page: 'sources' };
    const sourceId = decodeURIComponent(match[2]);
    return sourceId && !/[\x00-\x1f]/.test(sourceId) ? { page: 'source', sourceId } : { page: 'missing' };
  } catch { return { page: 'missing' }; }
}
