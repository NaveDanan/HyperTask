export const hyperDatabaseWindowSizes = {
  rows: 50,
  properties: 12,
  detailProperties: 20,
  groups: 8,
  cards: 25,
  dayEvents: 10,
  undated: 25,
  moveTargets: 25,
} as const;

export interface HyperDatabaseWindowData<T> {
  items: T[];
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
}

/** Slice the core's order without sorting, filtering or mutating its snapshot. */
export function hyperDatabaseWindow<T>(items: readonly T[], requestedPage: number, size: number): HyperDatabaseWindowData<T> {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('A database page size must be a positive integer.');
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(0, Math.min(pageCount - 1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0));
  const offset = page * size;
  return { items: items.slice(offset, offset + size), page, pageCount, start: items.length ? offset + 1 : 0, end: Math.min(items.length, offset + size), total: items.length };
}

/** Query changes reset navigation. Ordinary snapshot refreshes retain the current page. */
export function hyperDatabaseWindowScope(viewId: string, layout: number | undefined, filters: unknown, sorts: unknown, grouping?: unknown): string {
  return JSON.stringify([viewId, layout, filters ?? null, sorts ?? null, grouping ?? null], (_, value) => typeof value === 'bigint' ? String(value) : value);
}

/** Group a large event snapshot in linear time while retaining core event order. */
export function hyperDatabaseWindowBuckets<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (value === null) continue;
    const bucket = buckets.get(value);
    if (bucket) bucket.push(item);
    else buckets.set(value, [item]);
  }
  return buckets;
}
