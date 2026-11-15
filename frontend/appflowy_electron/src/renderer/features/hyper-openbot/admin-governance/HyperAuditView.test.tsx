import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [] as any[], state: 0, paths: [] as string[], action: undefined as Promise<unknown> | undefined }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: any) => { const slot = h.state++, values = h.values; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; }, useEffect: () => {} }));
vi.mock('./HyperGovernanceUi', async original => ({ ...await original<typeof import('./HyperGovernanceUi')>(), useHyperResource: (path: string) => { h.paths.push(path); return { loading: false, error: '', reload: vi.fn(), data: path === '/api/capabilities' ? { edition: 'team' } : path.includes('/vocabulary') ? { bots: [], people: [], apps: [], tools: [], rules: [] } : { events: [] } }; }, useHyperAction: () => ({ busy: false, error: '', run: (action: () => Promise<unknown>) => { h.action = action(); return h.action; } }) }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn(), hyperOpenBotFetch: vi.fn(), HYPER_OPENBOT_ORIGIN: 'https://hyper-openbot.invalid' }));
import { hyperOpenBotFetch } from '../transport';
import { HyperAudit } from './HyperAudit';
import { hyperAuditViewParams } from './HyperAuditFilters';
beforeEach(() => { h.values = []; h.paths = []; vi.stubGlobal('React', React); vi.stubGlobal('document', { createElement: () => ({ click() {}, href: '', download: '' }) }); vi.useFakeTimers(); vi.mocked(hyperOpenBotFetch).mockResolvedValue(new Response('csv')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function find(node: any, label: string): React.ReactElement<any> | undefined { if (Array.isArray(node)) { for (const child of node) { const match = find(child, label); if (match) return match; } } else if (React.isValidElement(node)) { const element = node as React.ReactElement<any>; return element.props.children === label && typeof element.props.onClick === 'function' ? element : find(element.props.children, label); } }
function render(filters: object) { h.state = 0; return HyperAudit({ initialFilters: filters }); }
it('saved views retain Bot/app restrictions in both the server query and CSV export', async () => {
  const filters = { bot: 'bot-1', app: ['gmail'] }; let tree = render(filters);
  find(tree, 'Blocked')!.props.onClick(); tree = render(filters);
  const query = new URLSearchParams(h.paths.at(-1)!.split('?')[1]);
  expect(query.get('bot')).toBe('bot-1'); expect(query.get('app')).toBe('gmail'); expect(query.get('eventType')).toContain('refused');
  find(tree, 'Export matching CSV')!.props.onClick(); await h.action;
  const exported = new URL(String(vi.mocked(hyperOpenBotFetch).mock.calls.at(-1)![0]));
  expect(exported.searchParams.get('bot')).toBe('bot-1'); expect(exported.searchParams.get('app')).toBe('gmail');
});
it('saved-view event and initiator chips intersect and never drop a disjoint restriction', () => {
  const narrowed = hyperAuditViewParams({ eventType: ['a', 'b'], initiatorKind: ['routine', 'handoff'] }, { eventType: ['b', 'c'], initiatorKind: ['routine'], bot: 'bot', app: ['gmail'] });
  expect(narrowed.get('eventType')).toBe('b'); expect(narrowed.get('initiatorKind')).toBe('routine'); expect(narrowed.get('bot')).toBe('bot'); expect(narrowed.get('app')).toBe('gmail');
  expect(hyperAuditViewParams({ eventType: ['a'] }, { eventType: ['b'] }).get('eventType')).toBe('none');
  expect(hyperAuditViewParams({ bot: 'one' }, { bot: 'two' }).get('bot')).toBe('none');
});
