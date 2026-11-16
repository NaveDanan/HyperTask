import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], state: 0, ref: 0, effects: [] as (() => unknown)[], cleanups: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: any) => { const slot = h.state++, values = h.values; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; }, useRef: (initial: any) => { const slot = h.ref++; return h.refs[slot] ?? (h.refs[slot] = { current: initial }); }, useEffect: (effect: () => unknown) => h.effects.push(effect) }));
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { HyperBotHandoffTab } from './HyperBotHandoffTab';
import { HyperBotSetupTab } from './HyperBotSetupTab';
import { HyperBotAttentionBoard } from './HyperBotAttentionBoard';
beforeEach(() => { h.values = []; h.refs = []; h.cleanups = []; vi.stubGlobal('React', React); vi.useFakeTimers(); vi.mocked(hyperOpenBotRequest).mockReset(); });
afterEach(() => { for (const cleanup of h.cleanups.reverse()) cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function render(component: (props: any) => React.ReactNode, props: any) { h.state = 0; h.ref = 0; h.effects = []; return component(props); }
function mount() { for (const effect of h.effects) { const cleanup = effect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); } }
function find(node: any, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined { if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } } else if (React.isValidElement(node)) { const element = node as React.ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); } }
function text(node: any): string { if (Array.isArray(node)) return node.map(text).join(''); if (React.isValidElement(node)) return text((node as React.ReactElement<any>).props.children); return typeof node === 'string' ? node : ''; }
const drain = () => vi.advanceTimersByTimeAsync(0);
it('an existing hidden handoff target remains visible for revocation', async () => {
  vi.mocked(hyperOpenBotRequest).mockImplementation(async path => path.endsWith('/handoff') ? { handoff: { enabled: true, grantable: true, canGrant: true, reachable: ['hidden'] } } : path === '/api/agents?hidden=true' ? { agents: [{ id: 'hidden', name: 'Hidden target' }] } : { agents: [] });
  render(HyperBotHandoffTab, { agentId: 'bot' }); mount(); await drain();
  expect(text(render(HyperBotHandoffTab, { agentId: 'bot' }))).toContain('Hidden target');
});
it('disabled handoff still permits revoking an existing grant without permitting a new one', async () => {
  vi.mocked(hyperOpenBotRequest).mockImplementation(async path => path.endsWith('/handoff') ? { handoff: { enabled: false, grantable: false, canGrant: true, reachable: ['target'] } } : { agents: [{ id: 'target', name: 'Target' }] });
  render(HyperBotHandoffTab, { agentId: 'bot' }); mount(); await drain();
  const checkbox = find(render(HyperBotHandoffTab, { agentId: 'bot' }), element => element.type === 'input' && element.props.type === 'checkbox')!;
  expect(checkbox).toBeDefined(); expect(checkbox.props.disabled).toBe(false);
  checkbox.props.onChange({ target: { checked: false } }); await drain(); expect(vi.mocked(hyperOpenBotRequest).mock.calls.some(([path, method]) => method === 'DELETE' && path.includes('kind=bot'))).toBe(true);
});
it('isolation edits preserve the current profile instead of cached public visibility', async () => {
  let reads = 0;
  const cached = { id: 'bot', name: 'Cached', title: 'Old', roleDescription: 'Role', visibility: 'public', builtIn: true, isolated: false, canManage: true };
  const fresh = { ...cached, name: 'Changed', visibility: 'private' };
  vi.mocked(hyperOpenBotRequest).mockImplementation(async path => path === '/api/agents/bot' ? { agent: ++reads === 1 ? cached : fresh } : path === '/api/capabilities' ? { edition: 'team' } : { capabilities: { isolationAvailable: true, isolatedComputers: true } });
  render(HyperBotSetupTab, { agentId: 'bot' }); mount(); await drain();
  find(render(HyperBotSetupTab, { agentId: 'bot' }), element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await drain();
  const write = vi.mocked(hyperOpenBotRequest).mock.calls.find(call => call[1] === 'PATCH')!;
  expect(write[2]).toMatchObject({ name: 'Changed', visibility: 'private', isolated: true });
});
it('a live task conversation displays Working instead of its last Ready for review state', async () => {
  vi.mocked(hyperOpenBotRequest).mockImplementation(async path => path === '/api/bots/attention' ? { bots: [] } : path === '/api/approvals' ? { requests: [], questions: [] } : path === '/api/tasks' ? { tasks: [{ id: 'task', agentId: 'bot', channelId: 'channel', title: 'Task', status: 'ready_for_review' }] } : path.startsWith('/api/channels') ? { channels: [{ id: 'channel', busy: true }], nextCursor: null } : { suggestions: [] });
  render(HyperBotAttentionBoard, { agentId: 'bot' }); mount(); await drain();
  expect(text(render(HyperBotAttentionBoard, { agentId: 'bot' }))).toContain('working');
});
