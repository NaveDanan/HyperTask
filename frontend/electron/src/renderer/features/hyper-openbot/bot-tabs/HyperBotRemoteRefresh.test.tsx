import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], state: 0, ref: 0, effects: [] as (() => unknown)[], deps: [] as (readonly unknown[] | undefined)[], cleanups: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: any) => { const slot = h.state++, values = h.values; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; }, useRef: (initial: any) => { const slot = h.ref++; return h.refs[slot] ?? (h.refs[slot] = { current: initial }); }, useEffect: (effect: () => unknown, deps: readonly unknown[] | undefined) => { h.effects.push(effect); h.deps.push(deps); } }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('./HyperBotTabsApi', async original => ({ ...await original<typeof import('./HyperBotTabsApi')>(), HyperBotTabsApi: { apps: vi.fn() } }));
import { hyperOpenBotRequest } from '../transport';
import { HyperBotTabsApi } from './HyperBotTabsApi';
import { HyperBotDetailTabs } from './HyperBotDetailTabs';
import { HyperAppAccessAction, HyperConnectionsPanel } from '../connections';
import { hyperInvalidateAppAccess } from '../connections/HyperAccessRefresh';
beforeEach(() => { h.values = []; h.refs = []; h.effects = []; h.cleanups = []; vi.stubGlobal('React', React); vi.mocked(HyperBotTabsApi.apps).mockReset(); vi.mocked(hyperOpenBotRequest).mockImplementation(async path => path === '/api/me' ? { user: { role: 'admin' } } : { edition: 'team' }); });
afterEach(() => { for (const cleanup of h.cleanups.reverse()) cleanup(); vi.unstubAllGlobals(); });
function find(node: any, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined { if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } } else if (React.isValidElement(node)) { const element = node as React.ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); } }
function text(node: any): string { if (Array.isArray(node)) return node.map(text).join(''); if (React.isValidElement(node)) return text((node as React.ReactElement<any>).props.children); return typeof node === 'string' ? node : ''; }
function remote() { h.state = 0; h.ref = 0; const tree = HyperBotDetailTabs({ bot: { id: 'bot', name: 'Bot', mine: false } as any }); return find(tree, element => typeof element.type === 'function' && element.type.name === 'HyperBotRemoteTab')!; }
function render(component: React.ReactElement<any>) { h.state = 0; h.ref = 0; h.effects = []; h.deps = []; return (component.type as any)(component.props); }
function mount() { for (const effect of h.effects) { const cleanup = effect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); } }
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
it('peer app invalidation synchronously expires an older Bot app-list read', async () => {
  const component = remote(); h.values = []; h.refs = [];
  let finish!: (value: any) => void;
  vi.mocked(HyperBotTabsApi.apps).mockResolvedValueOnce([{ key: 'first', displayName: 'Original' } as any]).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue([{ key: 'fresh', displayName: 'Fresh' } as any]);
  render(component); mount(); await settle(); let tree = render(component);
  find(tree, element => element.props.children === 'Refresh')!.props.onClick(); render(component);
  const load = h.deps.findIndex(deps => deps?.length === 3 && deps[0] === 'bot'); const cleanup = h.effects[load](); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await settle();
  hyperInvalidateAppAccess(); finish([{ key: 'stale', displayName: 'Stale read' }]); await settle();
  tree = render(component); expect(text(tree)).not.toContain('Stale read');
});
it('a standalone Bot host consumes administrator setup and broker-directory intent', async () => {
  const component = remote(); h.values = []; h.refs = [];
  vi.mocked(HyperBotTabsApi.apps).mockResolvedValue([{ key: 'app', displayName: 'App' } as any]);
  render(component); mount(); await settle(); let tree = render(component);
  find(tree, element => element.type === HyperAppAccessAction)!.props.onOpenConnection('app', { admin: true, provider: 'arcade' }); tree = render(component);
  const panel = find(tree, element => element.type === HyperConnectionsPanel)!;
  expect(panel.props.admin).toBe(true); expect(panel.props.selection).toEqual({ page: 'browse', provider: 'arcade' });
});
