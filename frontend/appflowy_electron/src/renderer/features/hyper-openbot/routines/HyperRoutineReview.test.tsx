import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], state: 0, ref: 0, effects: [] as (() => unknown)[], cleanups: [] as (() => void)[], create: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: any) => { const slot = h.state++, values = h.values; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; }, useRef: (initial: any) => { const slot = h.ref++; return h.refs[slot] ?? (h.refs[slot] = { current: initial }); }, useEffect: (effect: () => unknown) => h.effects.push(effect) }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('./HyperRoutineNavigation', async original => ({ ...await original<typeof import('./HyperRoutineNavigation')>(), useHyperRoutineNavigation: () => ({}) }));
vi.mock('./HyperRoutineControls', async original => ({ ...await original<typeof import('./HyperRoutineControls')>(), useHyperCheckInsOff: () => false }));
vi.mock('./HyperRoutinesApi', async original => ({ ...await original<typeof import('./HyperRoutinesApi')>(), HyperCreatePlan: h.create }));
import { hyperOpenBotRequest } from '../transport';
import HyperRoutinesSection from './HyperRoutinesSection';
import { ROUTINE_FORM_DEFAULTS } from './HyperRoutineForm';
import { HyperRoutineOverview } from './HyperRoutineOverview';
beforeEach(() => { h.values = []; h.refs = []; h.cleanups = []; h.create.mockReset(); vi.mocked(hyperOpenBotRequest).mockReset(); vi.stubGlobal('React', React); vi.useFakeTimers(); });
afterEach(() => { for (const cleanup of h.cleanups.reverse()) cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function render(component: (props: any) => React.ReactNode, props: any) { h.state = 0; h.ref = 0; h.effects = []; return component(props); }
function mount() { for (const effect of h.effects) { const cleanup = effect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); } }
function find(node: any, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined { if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } } else if (React.isValidElement(node)) { const element = node as React.ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); } }
function text(node: any): string { if (Array.isArray(node)) return node.map(text).join(''); if (React.isValidElement(node)) return text((node as React.ReactElement<any>).props.children); return typeof node === 'string' ? node : ''; }
const drain = () => vi.advanceTimersByTimeAsync(0);
it('late creation cannot dismiss a newer form after Back has left its original composition', async () => {
  const parent = render(HyperRoutinesSection, { initialTab: 'new' }), child = find(parent, element => typeof element.type === 'function' && element.type.name === 'HyperNewRoutine')!;
  h.values = [{ ...ROUTINE_FORM_DEFAULTS, agentId: 'bot', title: 'Routine', instruction: 'Do this', doneWhen: 'Finished', starts: 'now', channelId: 'new' }]; h.refs = [];
  let finish!: (value: any) => void; h.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(hyperOpenBotRequest).mockResolvedValue({ settings: [], allowed: true }); const done = vi.fn();
  let tree = render(child.type as any, { agentId: 'bot', done }); mount(); await drain();
  find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  tree = render(child.type as any, { agentId: 'bot', done }); find(tree, element => element.props.children === 'Back to routines')!.props.onClick();
  for (const cleanup of h.cleanups.splice(0)) cleanup(); finish({}); await drain(); expect(done).toHaveBeenCalledOnce();
});
it('the overview distinguishes an open run from no finished run', async () => {
  const routine = { id: 'routine', agentId: 'bot', title: 'Routine', instruction: 'Work', schedule: '@daily', timezone: 'UTC', enabled: true, lastRun: { status: null } };
  vi.mocked(hyperOpenBotRequest).mockImplementation(async path => path === '/api/routines' ? { routines: [routine] } : path === '/api/responsibilities' ? { responsibilities: [] } : { settings: [] });
  render(HyperRoutineOverview, { select: vi.fn() }); mount(); await drain(); expect(text(render(HyperRoutineOverview, { select: vi.fn() }))).toContain('Last: Running');
});
it('enabled triggers determine goal starts and ongoing repetition in its overview row', async () => {
  const goal = { id: 'goal', agentId: 'bot', title: 'Goal', instruction: 'Work', status: 'active', successCriteria: 'Done', recurring: false, endsWhenMet: false, subscriptions: [] };
  vi.mocked(hyperOpenBotRequest).mockImplementation(async path => path === '/api/routines' ? { routines: [] } : path === '/api/responsibilities' ? { responsibilities: [goal] } : path.endsWith('/triggers') ? { triggers: [{ enabled: true, kind: 'webhook' }] } : { settings: [] });
  render(HyperRoutineOverview, { select: vi.fn() }); mount(); await drain(); let tree = render(HyperRoutineOverview, { select: vi.fn() });
  const row = find(tree, element => typeof element.type === 'function' && element.type.name === 'HyperRoutineGoalOverview');
  if (row) { h.values = []; h.refs = []; render(row.type as any, row.props); mount(); await drain(); tree = render(row.type as any, row.props); }
  expect(vi.mocked(hyperOpenBotRequest)).toHaveBeenCalledWith('/api/responsibilities/goal/triggers'); expect(text(tree)).toContain('Webhook trigger'); expect(text(tree)).toContain('Ongoing');
});
