import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { HyperAppAccessAction } from './HyperAppAccessAction';
import { HyperPluginGrants } from './HyperPluginGrants';

// Run the production hooks, effects and event handlers with deterministic transport replies.
const h = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], deps: [] as any[], cleanups: [] as any[], effects: [] as any[], s: 0, r: 0, e: 0 }));
const f = vi.hoisted(() => ({ request: vi.fn(), listeners: new Map<string, Set<() => void>>() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.s++; if (!(i in h.states)) h.states[i] = typeof initial === 'function' ? initial() : initial; return [h.states[i], (next: any) => { h.states[i] = typeof next === 'function' ? next(h.states[i]) : next; }]; },
  useRef: (initial: any) => { const i = h.r++; return h.refs[i] ?? (h.refs[i] = { current: initial }); },
  useEffect: (effect: any, deps: any[]) => { const i = h.e++; if (!h.deps[i] || deps.some((v, j) => !Object.is(v, h.deps[i][j]))) { h.deps[i] = deps; h.effects.push(() => { h.cleanups[i]?.(); h.cleanups[i] = effect(); }); } },
  useContext: () => undefined,
}));
vi.mock('../transport', () => ({ hyperOpenBotRequest: f.request }));
const access = (changes = {}) => ({ key: 'mail', displayName: 'Mail', account: 'personal', accountHolder: 'you', connect: 'consent', provider: 'composio', state: 'not_connected', request: null, requestKind: null, connectedAt: null, ...changes });
let live = access();
let edition = 'team';
const writes = () => f.request.mock.calls.filter(call => call[1]);
function render(component: any, props: any): ReactNode { h.s = h.r = h.e = 0; const tree = component(props); for (const effect of h.effects.splice(0)) effect(); return tree; }
async function settle(component: any, props: any) { let tree: ReactNode; for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(0); tree = render(component, props); } return tree; }
function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined { if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } } else if (node && typeof node === 'object' && 'props' in node) { const el = node as ReactElement<any>; return predicate(el) ? el : find(el.props.children, predicate); } }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : ''; }
const button = (tree: ReactNode, label: string) => find(tree, el => text(el.props.children) === label && typeof el.props.onClick === 'function');
beforeEach(() => {
  vi.useFakeTimers(); h.states = []; h.refs = []; h.deps = []; h.cleanups = []; h.effects = []; f.listeners.clear(); f.request.mockReset(); live = access(); edition = 'team';
  vi.stubGlobal('window', { addEventListener: (name: string, cb: () => void) => { if (!f.listeners.has(name)) f.listeners.set(name, new Set()); f.listeners.get(name)!.add(cb); }, removeEventListener: (name: string, cb: () => void) => f.listeners.get(name)?.delete(cb), hypertask: { shell: { openExternal: vi.fn(async () => {}) } } });
  f.request.mockImplementation(async (path: string, method?: string) => {
    if (path === '/api/me') return { user: { id: 'person', role: 'admin' } };
    if (path === '/api/capabilities') return { edition };
    if (path === '/api/plugins') return { composioConfigured: true, servers: [{ id: 'mail', accountMode: 'shared', tools: [{ ref: 'mail/read', name: 'Read', effect: 'read', grantedTo: [] }] }] };
    if (path.startsWith('/api/agents')) return { agents: [] };
    if (path.startsWith('/api/approvals/shared-use')) return { apps: [] };
    if (path.endsWith('/approve') && method) { live = access(); return {}; }
    if (path.includes('/connect?')) return { connected: true };
    if (path.endsWith('/give') && method) { live = access({ state: 'ready' }); return {}; }
    return { app: live };
  });
});
afterEach(() => { for (const cleanup of h.cleanups) cleanup?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('turns on a personal app and starts its connection on the same press', async () => {
  edition = 'personal'; live = access({ state: 'disabled', unavailable: 'absent', connect: null });
  const props = { agentId: 'bot', app: 'mail', deriveAdmin: true }; render(HyperAppAccessAction, props); const tree = await settle(HyperAppAccessAction, props);
  expect(button(tree, 'Connect app')).toBeDefined(); button(tree, 'Connect app')!.props.onClick(); await settle(HyperAppAccessAction, props);
  expect(writes().map(call => call[0])).toEqual(['/api/plugins/for/bot/apps/mail/approve', '/api/plugins/servers/mail/connect?returnTo=settings&from=desktop']);
});
it('connects before giving an owner app on the original press', async () => {
  live = access({ state: 'owner_grantable', needsConnect: true });
  f.request.mockImplementationOnce(async () => ({ app: live }));
  const props = { agentId: 'bot', app: 'mail' }; render(HyperAppAccessAction, props); const tree = await settle(HyperAppAccessAction, props);
  expect(button(tree, 'Connect and allow')).toBeDefined(); button(tree, 'Connect and allow')!.props.onClick(); await settle(HyperAppAccessAction, props);
  // A successful connect response must still be checked against this Bot's authoritative access.
  live = access({ state: 'owner_grantable', needsConnect: false });
  for (const cb of f.listeners.get('focus') ?? []) cb(); await settle(HyperAppAccessAction, props);
  expect(writes().map(call => call[0])).toEqual(['/api/plugins/servers/mail/connect?returnTo=settings&from=desktop', '/api/plugins/for/bot/apps/mail/give']);
});
it('names the administrator destination for shared account repair', async () => {
  live = access({ state: 'shared_not_connected', account: 'shared', accountHolder: null });
  const navigate = vi.fn(), props = { agentId: 'bot', app: 'mail', admin: true, onOpenConnection: navigate }; render(HyperAppAccessAction, props); const tree = await settle(HyperAppAccessAction, props);
  button(tree, 'Open app setup and connection')!.props.onClick();
  expect(navigate).toHaveBeenCalledWith('mail', { admin: true });
});
it('offers Continue when a latest formerly blocked card first reads ready', async () => {
  live = access({ state: 'ready' }); const resume = vi.fn(async () => true);
  const props = { agentId: 'bot', app: 'mail', carryOn: { key: 'channel:bot:ready-test', latest: () => true, resume, blockedWhenAsked: true } };
  render(HyperAppAccessAction, props); const tree = await settle(HyperAppAccessAction, props);
  expect(resume).not.toHaveBeenCalled(); expect(button(tree, 'Continue')).toBeDefined(); button(tree, 'Continue')!.props.onClick(); await settle(HyperAppAccessAction, props);
  expect(resume).toHaveBeenCalledOnce();
});
it('does not offer personal-edition per-Bot grant or revoke controls', async () => {
  edition = 'personal'; const props = { server: { id: 'mail', title: 'Mail', summary: '', url: '', tools: [{ ref: 'mail/read', name: 'Read', description: '', grantedTo: ['bot'] }] }, busy: false, admin: true, navigate: vi.fn(), run: async (fn: () => Promise<void>) => fn() };
  render(HyperPluginGrants, props); const tree = await settle(HyperPluginGrants, props);
  expect(button(tree, 'Choose Bots and tools in a batch')).toBeUndefined();
  expect(find(tree, el => el.type === 'p' && text(el.props.children).includes('every Bot'))).toBeDefined();
});

it('invalidates mounted peer views when a write fails after a partial change', async () => {
  const { hyperSubscribeAppAccess } = await import('./HyperAccessRefresh');
  const invalidated = vi.fn(), off = hyperSubscribeAppAccess(invalidated);
  live = access({ state: 'owner_grantable', needsConnect: false });
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, method, body) => { if (path.endsWith('/give')) throw new Error('private server detail'); return original(path, method, body); });
  const props = { agentId: 'bot', app: 'mail' }; render(HyperAppAccessAction, props); const tree = await settle(HyperAppAccessAction, props);
  button(tree, 'Let it use your app')!.props.onClick(); const next = await settle(HyperAppAccessAction, props);
  expect(invalidated).toHaveBeenCalledOnce(); expect(find(next, el => el.props.role === 'alert')).toBeDefined();
  expect(text(find(next, el => el.props.role === 'alert')!.props.children)).not.toContain('private server detail'); off();
});
it('automatically continues a watched blocked-to-ready card only once', async () => {
  const resume = vi.fn(async () => true), props = { agentId: 'bot', app: 'mail', carryOn: { key: 'watched', latest: () => true, resume, blockedWhenAsked: true } };
  render(HyperAppAccessAction, props); await settle(HyperAppAccessAction, props);
  live = access({ state: 'ready' }); for (const cb of f.listeners.get('focus') ?? []) cb(); await settle(HyperAppAccessAction, props);
  expect(resume).toHaveBeenCalledOnce(); for (const cb of f.listeners.get('focus') ?? []) cb(); await settle(HyperAppAccessAction, props); expect(resume).toHaveBeenCalledOnce();
});
it('does not auto-resume or offer Continue for a historical card', async () => {
  const resume = vi.fn(async () => true), props = { agentId: 'bot', app: 'mail', carryOn: { key: 'historic', latest: () => false, resume, blockedWhenAsked: true } };
  render(HyperAppAccessAction, props); await settle(HyperAppAccessAction, props);
  live = access({ state: 'ready' }); for (const cb of f.listeners.get('focus') ?? []) cb(); const tree = await settle(HyperAppAccessAction, props);
  expect(resume).not.toHaveBeenCalled(); expect(button(tree, 'Continue')).toBeUndefined();
});
it('rechecks latest state after deferred actor verification for Continue', async () => {
  live = access({ state: 'ready' }); let latest = true;
  const resume = vi.fn(async () => true), props = { agentId: 'bot', app: 'mail', carryOn: { key: 'deferred-continue', latest: () => latest, resume, blockedWhenAsked: true } };
  render(HyperAppAccessAction, props); const tree = await settle(HyperAppAccessAction, props);
  let release!: (value: unknown) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  button(tree, 'Continue')!.props.onClick(); latest = false; release({ user: { id: 'person', role: 'admin' } }); await settle(HyperAppAccessAction, props);
  expect(resume).not.toHaveBeenCalled();
});
it.each(['actor', 'edition', 'role', 'unmount', 'Bot', 'app'])('expires an owner connection transaction on %s change', async change => {
  live = access({ state: 'owner_grantable', needsConnect: true });
  const props = { agentId: 'bot', app: 'mail' }; render(HyperAppAccessAction, props); const tree = await settle(HyperAppAccessAction, props);
  button(tree, 'Connect and allow')!.props.onClick(); await settle(HyperAppAccessAction, props);
  live = access({ state: 'owner_grantable', needsConnect: false });
  const original = f.request.getMockImplementation()!;
  if (change === 'actor' || change === 'role') f.request.mockImplementation(async (path, method, body) => path === '/api/me' ? { user: { id: change === 'actor' ? 'another-person' : 'person', role: change === 'role' ? 'member' : 'admin' } } : original(path, method, body));
  if (change === 'edition') edition = 'personal';
  if (change === 'unmount') { for (const cleanup of h.cleanups) cleanup?.(); h.cleanups = []; }
  else if (change === 'Bot' || change === 'app') render(HyperAppAccessAction, { ...props, [change === 'Bot' ? 'agentId' : 'app']: 'other' });
  for (const cb of f.listeners.get('focus') ?? []) cb(); await vi.advanceTimersByTimeAsync(0);
  expect(writes().some(call => call[0].endsWith('/give'))).toBe(false);
});
it('does not connect an unknown actor or somebody else’s owner-held account', async () => {
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, method, body) => path === '/api/me' ? { user: { role: 'admin' } } : original(path, method, body));
  const props = { agentId: 'bot', app: 'mail' }; render(HyperAppAccessAction, props); let tree = await settle(HyperAppAccessAction, props);
  expect(button(tree, 'Connect account')).toBeUndefined();
  live = access({ state: 'reconnect', accountHolder: 'owner' }); for (const cb of f.listeners.get('focus') ?? []) cb(); tree = await settle(HyperAppAccessAction, props);
  expect(button(tree, 'Connect account')).toBeUndefined(); expect(button(tree, 'Open app setup and connection')).toBeUndefined(); expect(writes()).toHaveLength(0);
});
it('uses only a server-confirmed account before giving after browser consent', async () => {
  live = access({ state: 'owner_grantable', needsConnect: true }); const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, method, body) => path.includes('/connect?') ? { authorizationUrl: 'https://vendor.example/consent' } : path.endsWith('/connection/confirm') ? { connected: false } : original(path, method, body));
  const props = { agentId: 'bot', app: 'mail' }; render(HyperAppAccessAction, props); let tree = await settle(HyperAppAccessAction, props);
  button(tree, 'Connect and allow')!.props.onClick(); tree = await settle(HyperAppAccessAction, props);
  expect(window.hypertask.shell.openExternal).toHaveBeenCalledWith('https://vendor.example/consent');
  button(tree, 'Check connection')!.props.onClick(); await settle(HyperAppAccessAction, props);
  expect(writes().some(call => call[0].endsWith('/give'))).toBe(false);
  expect(writes().some(call => call[0].endsWith('/connection/confirm'))).toBe(true);
});
it('does not continue a pending give after the connection wait is cancelled', async () => {
  live = access({ state: 'owner_grantable', needsConnect: true }); const props = { agentId: 'bot', app: 'mail' };
  render(HyperAppAccessAction, props); let tree = await settle(HyperAppAccessAction, props); button(tree, 'Connect and allow')!.props.onClick(); tree = await settle(HyperAppAccessAction, props);
  button(tree, 'Cancel connection wait')!.props.onClick(); live = access({ state: 'owner_grantable', needsConnect: false }); for (const cb of f.listeners.get('focus') ?? []) cb(); await settle(HyperAppAccessAction, props);
  expect(writes().some(call => call[0].endsWith('/give'))).toBe(false);
});
it('keeps a pending owner transaction mounted on the safe main return and rechecks the server', async () => {
  const { hyperRefreshPendingConnection } = await import('./HyperAccessRefresh');
  live = access({ state: 'owner_grantable', needsConnect: true }); const props = { agentId: 'bot', app: 'mail' };
  render(HyperAppAccessAction, props); let tree = await settle(HyperAppAccessAction, props); button(tree, 'Connect and allow')!.props.onClick(); tree = await settle(HyperAppAccessAction, props);
  expect(hyperRefreshPendingConnection()).toBe(true); await settle(HyperAppAccessAction, props);
  expect(writes().some(call => call[0].endsWith('/give'))).toBe(false);
  live = access({ state: 'owner_grantable', needsConnect: false }); expect(hyperRefreshPendingConnection()).toBe(true); await settle(HyperAppAccessAction, props);
  expect(writes().filter(call => call[0].endsWith('/give'))).toHaveLength(1);
  for (const cleanup of h.cleanups) cleanup?.(); h.cleanups = []; expect(hyperRefreshPendingConnection()).toBe(false);
});
it.each(['give', 'approve'])('confirms a shared card %s before accepting its first server-resolved exposure', async action => {
  live = access({ account: 'shared', state: action === 'give' ? 'owner_grantable' : 'not_granted', needsConnect: false });
  const props = { agentId: 'bot', app: 'mail', admin: true }; render(HyperAppAccessAction, props); let tree = await settle(HyperAppAccessAction, props);
  button(tree, action === 'give' ? 'Let it use your app' : 'Enable and grant read-only access')!.props.onClick(); tree = await settle(HyperAppAccessAction, props);
  expect(writes()).toHaveLength(0); expect(button(tree, 'Confirm shared account grant')).toBeDefined();
  button(tree, 'Confirm shared account grant')!.props.onClick(); await settle(HyperAppAccessAction, props);
  expect(writes().map(call => call[0])).toEqual([`/api/plugins/for/bot/apps/mail/${action}`]);
});
it('routes missing broker configuration to the matching administrator directory', async () => {
  live = access({ state: 'disabled', unavailable: 'composio_unconfigured', provider: 'arcade' });
  const navigate = vi.fn(), props = { agentId: 'bot', app: 'mail', admin: true, onOpenConnection: navigate };
  render(HyperAppAccessAction, props); const tree = await settle(HyperAppAccessAction, props);
  button(tree, 'Open app setup and connection')!.props.onClick(); expect(navigate).toHaveBeenCalledWith('mail', { admin: true, provider: 'arcade' });
});
it('cancels the pending owner give when the server changes the grant authority', async () => {
  live = access({ state: 'owner_grantable', needsConnect: true }); const props = { agentId: 'bot', app: 'mail' };
  render(HyperAppAccessAction, props); let tree = await settle(HyperAppAccessAction, props); button(tree, 'Connect and allow')!.props.onClick(); await settle(HyperAppAccessAction, props);
  live = access({ state: 'not_granted' }); for (const cb of f.listeners.get('focus') ?? []) cb(); await settle(HyperAppAccessAction, props);
  live = access({ state: 'owner_grantable', needsConnect: false }); for (const cb of f.listeners.get('focus') ?? []) cb(); tree = await settle(HyperAppAccessAction, props);
  expect(writes().some(call => call[0].endsWith('/give'))).toBe(false); expect(button(tree, 'Let it use your app')).toBeDefined();
});
it('invalidates current peers when an already-started grant settles after navigation', async () => {
  const { hyperSubscribeAppAccess } = await import('./HyperAccessRefresh');
  const invalidated = vi.fn(), off = hyperSubscribeAppAccess(invalidated); live = access({ state: 'owner_grantable', needsConnect: false });
  const original = f.request.getMockImplementation()!; let finish!: (value: unknown) => void;
  f.request.mockImplementation(async (path, method, body) => path.endsWith('/give') ? new Promise(resolve => { finish = resolve; }) : original(path, method, body));
  const props = { agentId: 'bot', app: 'mail' }; render(HyperAppAccessAction, props); let tree = await settle(HyperAppAccessAction, props);
  button(tree, 'Let it use your app')!.props.onClick(); await vi.advanceTimersByTimeAsync(0);
  render(HyperAppAccessAction, { ...props, agentId: 'other' }); finish({}); await vi.advanceTimersByTimeAsync(0);
  expect(invalidated).toHaveBeenCalledOnce(); off();
});
