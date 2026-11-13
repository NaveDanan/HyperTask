import { describe, expect, it } from 'vitest';
import { hyperDatabaseWindow, hyperDatabaseWindowBuckets, hyperDatabaseWindowScope, hyperDatabaseWindowSizes } from './HyperDatabaseWindowModel';

describe('Hyper database rendering windows', () => {
  it('walks a large core-ordered snapshot exactly once across bounded pages without changing it', () => {
    const rows = Array.from({ length: 10_007 }, (_, index) => ({ id: `row-${10_006 - index}` }));
    const original = [...rows], visited: typeof rows = [];
    for (let page = 0; page < Math.ceil(rows.length / hyperDatabaseWindowSizes.rows); page++) {
      const window = hyperDatabaseWindow(rows, page, hyperDatabaseWindowSizes.rows);
      expect(window.items.length).toBeLessThanOrEqual(50);
      expect(window.start).toBe(page * 50 + 1);
      visited.push(...window.items);
    }
    expect(visited).toEqual(original); expect(rows).toEqual(original);
    expect(visited[0]).toBe(rows[0]); expect(visited.at(-1)).toBe(rows.at(-1));
  });
  it('clamps shrinking, empty and invalid pages without hiding the last partial page', () => {
    expect(hyperDatabaseWindow([1, 2, 3], 100, 2)).toEqual({ items: [3], page: 1, pageCount: 2, start: 3, end: 3, total: 3 });
    expect(hyperDatabaseWindow([], 100, 50)).toEqual({ items: [], page: 0, pageCount: 1, start: 0, end: 0, total: 0 });
    for (const page of [-1, NaN, Infinity]) expect(hyperDatabaseWindow([1, 2], page, 1).items).toEqual([1]);
    for (const size of [0, -1, NaN, 1.5]) expect(() => hyperDatabaseWindow([1], 0, size)).toThrow('positive integer');
  });
  it('keeps equivalent refreshed query snapshots on the same scope and distinguishes actual query changes', () => {
    const filters = { items: [{ id: 'filter', data: new Uint8Array([1, 2]) }] }, sorts = { items: [{ id: 'sort', condition: 0 }] };
    const scope = hyperDatabaseWindowScope('view', 0, filters, sorts, { fieldId: 'group' });
    expect(hyperDatabaseWindowScope('view', 0, structuredClone(filters), structuredClone(sorts), { fieldId: 'group' })).toBe(scope);
    expect(hyperDatabaseWindowScope('other', 0, filters, sorts)).not.toBe(scope);
    expect(hyperDatabaseWindowScope('view', 1, filters, sorts)).not.toBe(scope);
    expect(hyperDatabaseWindowScope('view', 0, filters, { items: [{ id: 'sort', condition: 1 }] }, { fieldId: 'group' })).not.toBe(scope);
  });
  it('buckets crowded calendar days in a single pass, keeping each core sequence and the undated distinction', () => {
    const events = Array.from({ length: 100_000 }, (_, index) => ({ id: index, day: index % 5 === 0 ? null : index % 2 === 0 ? '2026-11-01' : '2026-11-02' }));
    let visits = 0;
    const days = hyperDatabaseWindowBuckets(events, event => { visits++; return event.day; });
    expect(visits).toBe(events.length);
    expect(days.get('2026-11-01')).toEqual(events.filter(event => event.day === '2026-11-01'));
    expect(days.get('2026-11-02')).toEqual(events.filter(event => event.day === '2026-11-02'));
    expect(days.has('null')).toBe(false);
    expect(events[0].day).toBeNull();
  });
});
