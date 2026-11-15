import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { HyperPluginGrants } from './connections/HyperPluginGrants';
import { HyperConnectionsPanel } from './connections/HyperConnectionsPanel';
import HyperMemorySection from './memory/HyperMemorySection';
import { HyperSkillsPanel } from './skills/HyperSkillsPanel';
import HyperNativeSkills from './skills/HyperNativeSkills';
import { HyperHomeComposer } from './onboarding/HyperHomeComposer';
import { hyperHomeDraftStore } from './onboarding/HyperHomeDraft';
import { HyperOpenBotPage, HyperOpenBotWorkspace } from './HyperOpenBotPage';
import { HyperComposer } from './composer';
import { HyperConversationDraftCache } from './HyperConversationDraft';
import { HyperInteractiveResult } from './screens-gen/HyperInteractiveResult';
import { FormCardArgs, HyperFormCard } from './screens-gen/form';

// Exercise actual production effects and handlers without a live backend or browser fixture.
const h = vi.hoisted(() => ({ active: false, states: [] as any[], refs: [] as any[], effects: [] as (() => unknown)[], deps: [] as (readonly unknown[] | undefined)[], cleanups: [] as (() => void)[], stateIndex: 0, refIndex: 0 }));
const f = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), lookup: vi.fn(), decision: vi.fn(), connections: vi.fn(), stateListener: undefined as undefined | ((state: any) => void) }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  const effect = (...args: Parameters<typeof react.useEffect>) => { if (h.active) { h.effects.push(args[0]); h.deps.push(args[1]); } else react.useEffect(...args); };
  return { ...react,
    useState: (initial: any) => {
      if (!h.active) return react.useState(initial);
      const index = h.stateIndex++; if (!(index in h.states)) h.states[index] = typeof initial === 'function' ? initial() : initial;
      return [h.states[index], (next: any) => { h.states[index] = typeof next === 'function' ? next(h.states[index]) : next; }];
    },
    useRef: (initial: any) => { if (!h.active) return react.useRef(initial); const index = h.refIndex++; return h.refs[index] ?? (h.refs[index] = { current: initial }); },
    useEffect: effect, useLayoutEffect: effect,
    useCallback: (callback: any, deps: unknown[]) => h.active ? callback : react.useCallback(callback, deps),
    useMemo: (create: () => unknown, deps: unknown[]) => h.active ? create() : react.useMemo(create, deps),
  };
});
vi.mock('./transport', async original => ({ ...await original<typeof import('./transport')>(), hyperOpenBotRequest: f.request, hyperOpenBotFetch: f.fetch }));
vi.mock('@copilotkit/react-core/v2', () => ({ useFrontendTool: vi.fn(), useCopilotKit: vi.fn(), OpenGenerativeUIActivityRenderer: () => null }));
vi.mock('./provider', () => ({ HyperOpenBotProvider: () => null }));
vi.mock('./HyperServiceStatus', () => ({ HyperServiceStatus: () => null, useHyperOpenBotService: () => ({ state: { ready: false, problem: 'stopped' } }) }));
vi.mock('./HyperComputerPanel', () => ({ HyperComputerPanel: () => null }));
vi.mock('./screens-gen/HyperGalleryRegistry', () => ({ hyperGalleryComponent: f.lookup, GALLERY_COMPONENTS: [] }));
vi.mock('./screens-gen/HyperScreensApi', async original => { const api = await original<typeof import('./screens-gen/HyperScreensApi')>(); return { ...api, hyperScreensApi: { ...api.hyperScreensApi, decision: f.decision } }; });
vi.mock('./connections/HyperConnectionsApi', async original => ({ ...await original<typeof import('./connections/HyperConnectionsApi')>(), hyperLoadConnections: f.connections }));

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); h.active = false; h.states = []; h.refs = []; h.effects = []; h.deps = []; h.cleanups = [];
  hyperHomeDraftStore.clear(); f.lookup.mockReset(); f.request.mockReset().mockImplementation(async (path: string) => path.startsWith('/api/plugins/for/') ? { skills: [] } : {}); f.fetch.mockReset(); f.connections.mockReset().mockResolvedValue([]);
  f.stateListener = undefined;
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), appflowy: { hyperOpenBot: { service: { onState: (listener: (state: any) => void) => { f.stateListener = listener; return () => { if (f.stateListener === listener) f.stateListener = undefined; }; } } }, shell: { openExternal: vi.fn() } } });
});
afterEach(() => { for (const cleanup of h.cleanups) cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function render(component: (props: any) => ReactNode, props: any, states?: any[]) {
  if (states) h.states = states; h.stateIndex = 0; h.refIndex = 0; h.effects = []; h.deps = []; h.active = true;
  try { return component(props); } finally { h.active = false; }
}
function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } }
  else if (node && typeof node === 'object' && 'props' in node) { const element = node as ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); }
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : '';
const button = (tree: ReactNode, label: string) => find(tree, element => text(element.props.children) === label && typeof element.props.onClick === 'function');
const drain = () => vi.advanceTimersByTimeAsync(0);
function mountEffects() { for (const effect of h.effects) { const cleanup = effect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); } }
const approval = { audience: 'owner', outsideInput: false, members: [] };
const bots = [{ id: 'bot-a', name: 'A' }, { id: 'bot-b', name: 'B' }];
const server = { id: 'server', title: 'Mail', url: 'composio://mail', summary: '', accountMode: 'shared', authScheme: 'COMPOSIO', tools: [{ ref: 'server/read', name: 'read', description: '', effect: 'read', grantedTo: [] }] };

it('hides and rejects an old shared-access confirmation after selecting another Bot', async () => {
  f.request.mockResolvedValue({ apps: [{ serverId: 'server', needed: approval, covered: false }] });
  const props = { server, busy: false, admin: true, selection: { page: 'bot', key: 'server', agentId: 'bot-a' }, navigate: vi.fn(), run: async (action: () => Promise<void>) => action() };
  let tree = render(HyperPluginGrants, props, [bots, '', '', undefined, approval, false, [], [], true, approval, '']);
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await drain();
  tree = render(HyperPluginGrants, props); const oldConfirm = button(tree, 'Approve and grant')!;
  const next = render(HyperPluginGrants, { ...props, selection: { ...props.selection, agentId: 'bot-b' } });
  expect(find(next, element => element.props['aria-label'] === 'Approve shared app access')).toBeUndefined();
  oldConfirm.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
});
it('locks the Memory editor while the submitted fact is being saved', async () => {
  let finish!: (value: unknown) => void; f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const state = [{ page: 'facts' }, { edition: 'team' }, '', false, 0, '/api/capabilities:', [], '', false, 0, '/api/memory:memories', [], '', false, 0, '/api/agents:agents', false, '', 'submitted fact', undefined];
  let tree = render(HyperMemorySection, {}, state); find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  tree = render(HyperMemorySection, {});
  try { expect(find(tree, element => element.props.id === 'hyper-memory-content')!.props.disabled).toBe(true); }
  finally { finish({}); await drain(); }
});
it('applies an incoming skill route without emitting navigation or resetting newer edits', () => {
  const data = { catalogue: { skills: [], servers: [] }, bots: [] }; const navigate = vi.fn();
  const props = { selection: { page: 'new' }, onSelectionChange: navigate };
  render(HyperSkillsPanel, props, [data, false, false, '', '', null, { slug: '', title: '', summary: '', instructions: '', tools: [] }, '', false]);
  h.effects[1](); const deps = h.deps[1]!;
  expect(navigate).not.toHaveBeenCalled();
  const editor = render(HyperSkillsPanel, props);
  const title = find(editor, element => element.type === 'label' && text(element.props.children) === 'Title')!;
  find(title, element => typeof element.props.onChange === 'function')!.props.onChange({ target: { value: 'Newer title' } });
  render(HyperSkillsPanel, { ...props, selection: { page: 'new' }, onSelectionChange: vi.fn() });
  if (h.deps[1]!.some((value, index) => !Object.is(value, deps[index]))) h.effects[1]();
  expect(h.states[6].title).toBe('Newer title');
});
it.each([false, true])('returns successful skill deletion to the native list in admin mode %s', async admin => {
  const skill = { slug: 'one', title: 'One', summary: '', instructions: 'Instructions', tools: [], grantedTo: [], ownerUserId: 'owner' };
  let catalogue = { skills: [skill], servers: [] };
  f.request.mockImplementation(async (path: string, method?: string) => {
    if (path === '/api/plugins/skills/one' && method === 'DELETE') { catalogue = { ...catalogue, skills: [] }; return {}; }
    return path === '/api/plugins' ? catalogue : { agents: [] };
  });
  const navigate = vi.fn(), context = { navigate, openConversation: vi.fn(), startConversation: vi.fn() };
  const native = HyperNativeSkills({ context, path: admin ? '/admin/skills/one' : '/skills/one', admin });
  render(HyperSkillsPanel, native.props); mountEffects(); await drain();
  render(HyperSkillsPanel, native.props); h.effects[1]();
  let tree = render(HyperSkillsPanel, native.props); button(tree, 'Delete skill')!.props.onClick();
  tree = render(HyperSkillsPanel, native.props); button(tree, 'Confirm delete')!.props.onClick(); await drain();
  expect(navigate).toHaveBeenCalledWith(admin ? 'admin-skills' : 'skills', { path: admin ? '/admin/skills' : '/skills' });
});
it('keeps failed and newer text and skill selections in a mounted uncontrolled composer', async () => {
  let fail!: (error: Error) => void;
  const props = { initialValue: '/a', commands: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], onSubmit: () => new Promise<void>((_, reject) => { fail = reject; }) };
  const input = (tree: ReactNode) => find(tree, element => element.props['data-slot'] === 'composer-input')!;
  let tree = render(HyperComposer, props); button(tree, '/a · A')!.props.onClick();
  tree = render(HyperComposer, props); input(tree).props.onChange({ target: { value: 'A' } });
  tree = render(HyperComposer, props); find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  tree = render(HyperComposer, props); input(tree).props.onChange({ target: { value: '/b' } });
  tree = render(HyperComposer, props); button(tree, '/b · B')!.props.onClick();
  tree = render(HyperComposer, props); input(tree).props.onChange({ target: { value: 'B' } });
  render(HyperComposer, props); fail(new Error('refused')); await drain(); tree = render(HyperComposer, props);
  expect(input(tree).props.value).toBe('A B'); expect(button(tree, '/a ×')).toBeDefined(); expect(button(tree, '/b ×')).toBeDefined();
});
it('does not create an abandoned Home submission after its component unmounts', async () => {
  let finish!: (response: Response) => void; f.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const start = vi.fn().mockResolvedValue(undefined); const props = { userId: 'owner', initialText: 'abandoned task', bots: [{ id: 'bot-a', name: 'A', visibility: 'public' }], context: { initialDraftSupported: true, startConversation: start, openConversation: vi.fn() } };
  render(HyperHomeComposer, props); mountEffects(); await drain();
  find(render(HyperHomeComposer, props), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  finish(new Response(JSON.stringify({ agentId: 'bot-a' }))); await drain();
  expect(start).not.toHaveBeenCalled(); expect(hyperHomeDraftStore.read('owner')?.text).toBe('abandoned task');
});
it('keeps retained Home text and File identity when the same-owner AI service loses readiness', () => {
  const file = new File(['synthetic'], 'home.txt'); hyperHomeDraftStore.write('owner', { text: 'unsent task', files: [file], commandIds: ['skill'], submit: true });
  render(HyperOpenBotWorkspace, { viewId: 'test', serviceReady: true }); h.effects[0]();
  render(HyperOpenBotWorkspace, { viewId: 'test', serviceReady: false }); h.effects[0]();
  expect(hyperHomeDraftStore.read('owner')).toMatchObject({ text: 'unsent task', commandIds: ['skill'] });
  expect(hyperHomeDraftStore.read('owner')?.files[0]).toBe(file);
});
it('invalidates the captured Home navigation generation before a destination change unmounts Home', () => {
  const tree = render(HyperOpenBotWorkspace, { viewId: 'test', serviceReady: true }) as ReactElement<any>;
  const context = tree.props.context;
  expect(context.isCurrentNavigation()).toBe(true);
  context.navigate('settings');
  expect(context.isCurrentNavigation()).toBe(false);
});
it('clears retained Home drafts on trusted identity rejection, not ordinary readiness loss', () => {
  render(HyperOpenBotPage, { viewId: 'test' }); mountEffects();
  // The owner may sign out while a Jira/document page is open and Chat is unmounted.
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  for (const problem of ['signed_out', 'profile_required', 'unsupported']) {
    hyperHomeDraftStore.write('owner', { text: 'private draft', files: [], commandIds: [], submit: true });
    f.stateListener!({ problem: 'stopped', ready: false }); expect(hyperHomeDraftStore.read('owner')?.text).toBe('private draft');
    f.stateListener!({ problem, ready: false }); expect(hyperHomeDraftStore.read('owner')).toBeUndefined();
  }
});
it('ignores an exposure response that arrives after the selected Bot changes', async () => {
  let finish!: (value: unknown) => void; f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const props = { server, busy: false, selection: { page: 'bot', key: 'server', agentId: 'bot-a' }, navigate: vi.fn(), run: async (action: () => Promise<void>) => action() };
  let tree = render(HyperPluginGrants, props, [bots, '', '', undefined, approval, false, [], [], true, approval, '']);
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } });
  const next = { ...props, selection: { ...props.selection, agentId: 'bot-b' } }; render(HyperPluginGrants, next);
  finish({ apps: [{ serverId: 'server', needed: approval, covered: false }] }); await drain(); tree = render(HyperPluginGrants, next);
  expect(find(tree, element => element.props['aria-label'] === 'Approve shared app access')).toBeUndefined();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
});
it('keeps a current shared confirmation usable and submits its explicit Bot and server-proposed approval', async () => {
  f.request.mockResolvedValue({ apps: [{ serverId: 'server', needed: approval, covered: false }] });
  const props = { server, busy: false, selection: { page: 'bot', key: 'server', agentId: 'bot-a' }, navigate: vi.fn(), run: async (action: () => Promise<void>) => action() };
  let tree = render(HyperPluginGrants, props, [bots, '', '', undefined, approval, false, [], [], true, approval, '']);
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await drain();
  tree = render(HyperPluginGrants, props); button(tree, 'Approve and grant')!.props.onClick(); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/plugins/grants', 'POST', { kind: 'mcp', ref: 'server/read', agentId: 'bot-a', approval });
});
it('restores an unsent queued follow-up and its attachment instead of deleting them on navigation', () => {
  const cache = new HyperConversationDraftCache(() => 'group'); const lease = cache.acquire('channel');
  const attachment = { id: 'file', name: 'queued.txt', mimeType: 'text/plain', status: 'ready' as const };
  lease.update(current => ({ ...current, text: 'queued follow-up', attachments: [attachment] }));
  const discard = vi.fn();
  const props = () => ({ value: lease.get().text, attachments: lease.get().attachments, pending: true, onSubmit: vi.fn(), onDiscardAttachment: discard,
    onTextChange: (change: any) => lease.update(current => ({ ...current, text: typeof change === 'function' ? change(current.text) : change })),
    onConsumeAttachments: (ids: string[]) => lease.update(current => ({ ...current, attachments: current.attachments.filter(file => !ids.includes(file.id)) })),
    onRestoreQueued: lease.restoreQueued,
  });
  let tree = render(HyperComposer, props()); find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  expect(lease.get().text).toBe(''); expect(lease.get().attachments).toEqual([]);
  render(HyperComposer, props()); mountEffects(); for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  expect(cache.acquire('channel').get().text).toContain('queued follow-up'); expect(cache.acquire('channel').get().attachments).toEqual([attachment]);
  expect(discard).not.toHaveBeenCalled();
});
it('restores a queued send that fails after navigation through the owner draft and retains its retry identity', async () => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('channel');
  const file = { id: 'file', name: 'queued.txt', mimeType: 'text/plain', status: 'ready' as const };
  lease.update(current => ({ ...current, text: 'follow-up', attachments: [file], commandIds: ['skill'] }));
  let fail!: (error: Error) => void; let sentId = ''; let pending = true;
  const send = vi.fn((draft: any) => { sentId = lease.prepareSubmission(draft.text, 'file').id; return new Promise<void>((_, reject) => { fail = reject; }); });
  const discard = vi.fn();
  const props = () => ({ pending, value: lease.get().text, attachments: lease.get().attachments, commandIds: lease.get().commandIds, onSubmit: send, onDiscardAttachment: discard, onRestoreQueued: lease.restoreQueued,
    onTextChange: (change: any) => lease.update(current => ({ ...current, text: typeof change === 'function' ? change(current.text) : change })),
    onCommandIdsChange: (commandIds: string[]) => lease.update(current => ({ ...current, commandIds })),
    onConsumeAttachments: (ids: string[]) => lease.update(current => ({ ...current, attachments: current.attachments.filter(file => !ids.includes(file.id)) })),
  });
  find(render(HyperComposer, props()), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  pending = false; render(HyperComposer, props()); mountEffects(); expect(send).toHaveBeenCalledOnce();
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  fail(new Error('refused after navigation')); await drain();
  const reopened = cache.acquire('channel');
  expect(reopened.get()).toMatchObject({ text: '/skill follow-up', commandIds: ['skill'], attachments: [file] });
  expect(reopened.prepareSubmission('/skill follow-up', 'file').id).toBe(sentId); expect(discard).not.toHaveBeenCalled();
});
it('restores both the queued and live portions of an idle joined send that fails after navigation', async () => {
  const cache = new HyperConversationDraftCache(() => 'group'), lease = cache.acquire('channel');
  const first = { id: 'first', name: 'first.txt', mimeType: 'text/plain', status: 'ready' as const }, second = { ...first, id: 'second', name: 'second.txt' };
  lease.update(current => ({ ...current, text: 'queued text', attachments: [first], commandIds: ['a'] }));
  let pending = true, fail!: (error: Error) => void;
  const props = () => ({ pending, value: lease.get().text, attachments: lease.get().attachments, commandIds: lease.get().commandIds, onSubmit: () => new Promise<void>((_, reject) => { fail = reject; }), onRestoreQueued: lease.restoreQueued,
    onTextChange: (change: any) => lease.update(current => ({ ...current, text: typeof change === 'function' ? change(current.text) : change })),
    onCommandIdsChange: (commandIds: string[]) => lease.update(current => ({ ...current, commandIds })),
    onConsumeAttachments: (ids: string[]) => lease.update(current => ({ ...current, attachments: current.attachments.filter(file => !ids.includes(file.id)) })),
  });
  find(render(HyperComposer, props()), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  lease.update(current => ({ ...current, text: 'live text', attachments: [second], commandIds: ['b'] })); pending = false;
  find(render(HyperComposer, props()), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  mountEffects(); for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  fail(new Error('refused after navigation')); await drain();
  expect(lease.get().text).toContain('queued text'); expect(lease.get().text).toContain('live text');
  expect(lease.get().commandIds).toEqual(['a', 'b']); expect(lease.get().attachments).toEqual([first, second]);
});
it('does not post a covered shared grant when its exposure request resolves after unmount', async () => {
  let finish!: (value: unknown) => void;
  f.request.mockImplementation((path: string) => path.startsWith('/api/approvals/shared-use/bot/') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ agents: bots }));
  const props = { server, busy: false, selection: { page: 'bot', key: 'server', agentId: 'bot-a' }, navigate: vi.fn(), run: async (action: () => Promise<void>) => action() };
  const tree = render(HyperPluginGrants, props, [bots, '', '', undefined, approval, false, [], [], true, approval, '']); mountEffects(); await drain();
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } });
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  finish({ apps: [{ serverId: 'server', covered: true }] }); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
});
it('stops a read-grant loop after unmount without undoing the already accepted first request', async () => {
  let finish!: (value: unknown) => void;
  f.request.mockImplementation((path: string) => path === '/api/plugins/grants' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ agents: bots }));
  const personal = { ...server, accountMode: 'personal', tools: [...server.tools, { ...server.tools[0], ref: 'server/second', name: 'second' }] };
  const props = { server: personal, busy: false, selection: { page: 'bot', key: 'server', agentId: 'bot-a' }, navigate: vi.fn(), run: async (action: () => Promise<void>) => { try { await action(); } catch { /* The parent action reports cancellation and reloads state. */ } } };
  const tree = render(HyperPluginGrants, props, [bots, '', '', undefined, approval, false, [], [], true, approval, '']); mountEffects(); await drain();
  find(tree, element => typeof element.props.onClick === 'function' && text(element.props.children).startsWith('Grant every read-only action'))!.props.onClick();
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  finish({}); await drain();
  expect(f.request.mock.calls.filter(call => call[0] === '/api/plugins/grants')).toHaveLength(1);
});
it('returns invalid askForm arguments through the form recovery response instead of suspending the decision', async () => {
  f.lookup.mockReturnValue({ name: 'askForm', kind: 'decision', Component: HyperFormCard, parameters: FormCardArgs });
  const respond = vi.fn().mockResolvedValue(undefined); const args = { title: 'Invalid', fields: [{ id: 'x', label: 'X', type: 'select' }] };
  const props = { name: 'askForm', agentId: 'bot-a', args, complete: true, respond };
  const tree = render(HyperInteractiveResult, props, [{ allowed: true, key: JSON.stringify(['askForm', 'bot-a', args, true]) }]);
  const form = find(tree, element => element.type === HyperFormCard);
  if (form) {
    h.states = []; h.refs = [];
    const recovery = render(HyperFormCard, form.props) as ReactElement<any>;
    render(recovery.type as any, recovery.props); mountEffects(); await drain();
  }
  expect(respond).toHaveBeenCalledWith(expect.objectContaining({ status: 'invalid' }));
});
it('offers the authoritative shared-account completion check to admins after vendor consent', async () => {
  const row = { key: 'server', title: 'Mail', summary: '', state: 'Team account not connected', server, connections: [] };
  f.connections.mockResolvedValue([row]); f.request.mockResolvedValue({ connected: true });
  const props = { admin: true, selection: { page: 'app', key: 'server' } };
  render(HyperConnectionsPanel, props); h.states[0] = [row]; h.states[1] = false; h.states[6] = 'server';
  const tree = render(HyperConnectionsPanel, props); button(tree, 'Check sign-in completion')?.props.onClick(); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/plugins/servers/server/connection/confirm', 'POST');
  expect(button(render(HyperConnectionsPanel, { ...props, admin: false }), 'Check sign-in completion')).toBeUndefined();
});
it('does not display or apply one app account-mode preview after an incoming route selects another app', async () => {
  const preview = { mode: 'personal', wouldRevoke: { holder: 'deployment', count: 1 }, bots: [{ botId: 'bot-a', exposure: approval }] };
  const rows = [{ key: 'server', title: 'Mail', summary: '', state: 'Team account connected', server, connections: [] }, { key: 'second', title: 'Second', summary: '', state: 'Team account connected', server: { ...server, id: 'second', url: 'composio://second' }, connections: [] }];
  f.connections.mockResolvedValue(rows); f.request.mockResolvedValue({ preview, accounts: [] });
  const props = { admin: true, selection: { page: 'app', key: 'server' } };
  render(HyperConnectionsPanel, props); mountEffects(); await drain();
  let tree = render(HyperConnectionsPanel, props); button(tree, 'Switch to personal account')!.props.onClick(); await drain();
  tree = render(HyperConnectionsPanel, props); const oldConfirm = button(tree, 'Confirm switch')!;
  const next = { ...props, selection: { page: 'app', key: 'second' } }; render(HyperConnectionsPanel, next); mountEffects(); await drain();
  tree = render(HyperConnectionsPanel, next);
  expect(find(tree, element => element.props['aria-label'] === 'Switch account mode')).toBeUndefined();
  oldConfirm.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[2]?.confirm === true)).toBe(false);
});
it('rejects an account-mode preview that arrives after its app target changes', async () => {
  let finish!: (value: unknown) => void;
  const rows = [{ key: 'server', title: 'Mail', summary: '', state: 'Team account connected', server, connections: [] }, { key: 'second', title: 'Second', summary: '', state: 'Team account connected', server: { ...server, id: 'second', url: 'composio://second' }, connections: [] }];
  f.connections.mockResolvedValue(rows);
  f.request.mockImplementation((path: string) => path.endsWith('/account-mode') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ accounts: [] }));
  const props = { admin: true, selection: { page: 'app', key: 'server' } };
  render(HyperConnectionsPanel, props); mountEffects(); await drain();
  button(render(HyperConnectionsPanel, props), 'Switch to personal account')!.props.onClick();
  const next = { ...props, selection: { page: 'app', key: 'second' } }; render(HyperConnectionsPanel, next); mountEffects(); await drain();
  finish({ preview: { mode: 'personal', wouldRevoke: { holder: 'deployment', count: 1 }, bots: [] } }); await drain();
  expect(find(render(HyperConnectionsPanel, next), element => element.props['aria-label'] === 'Switch account mode')).toBeUndefined();
});
it.each([false, true])('reconciles configured broker consent on arrival while respecting shared admin authority %s', async admin => {
  const rows = [{ key: 'personal', title: 'Personal', summary: '', state: 'Not connected', brokerConfigured: true, server: { ...server, id: 'personal', accountMode: 'personal', provenance: 'composio' }, connections: [] }, { key: 'shared', title: 'Shared', summary: '', state: 'Team account not connected', brokerConfigured: true, server: { ...server, id: 'shared', provenance: 'composio' }, connections: [] }];
  f.connections.mockResolvedValue(rows); f.request.mockResolvedValue({ connected: true, accounts: [] });
  render(HyperConnectionsPanel, { admin, selection: { page: 'list' } }); mountEffects(); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/plugins/servers/personal/connection/confirm', 'POST');
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/servers/shared/connection/confirm')).toBe(admin);
  expect(f.connections.mock.calls.length).toBeGreaterThanOrEqual(2);
});
it('asks the provider again on native window focus rather than only reloading stored consent', async () => {
  const row = { key: 'server', title: 'Mail', summary: '', state: 'Team account not connected', brokerConfigured: true, server: { ...server, provenance: 'composio' }, connections: [] };
  f.connections.mockResolvedValue([row]); f.request.mockImplementation(async (path: string) => path.includes('/connect?') ? { authorizationUrl: 'https://vendor.example/consent' } : { connected: true, accounts: [] });
  const props = { admin: true, selection: { page: 'app', key: 'server' } };
  render(HyperConnectionsPanel, props); mountEffects(); await drain();
  const before = f.request.mock.calls.filter(call => call[0].endsWith('/connection/confirm')).length;
  const focus = vi.mocked(window.addEventListener).mock.calls.find(call => call[0] === 'focus')![1] as () => void;
  focus(); await drain(); expect(f.request.mock.calls.filter(call => call[0].endsWith('/connection/confirm'))).toHaveLength(before);
  button(render(HyperConnectionsPanel, props), 'Connect account')!.props.onClick(); await drain();
  focus(); await drain();
  expect(f.request.mock.calls.filter(call => call[0].endsWith('/connection/confirm'))).toHaveLength(before + 1);
  expect(f.request.mock.calls.some(call => call[0].endsWith('/connection/recheck'))).toBe(false);
});
it('keeps recorded connection state and a generic error when provider reconciliation fails', async () => {
  const row = { key: 'server', title: 'Mail', summary: '', state: 'Connected', brokerConfigured: true, server: { ...server, accountMode: 'personal', provenance: 'composio' }, connections: [] };
  f.connections.mockResolvedValue([row]); f.request.mockRejectedValue(new Error('synthetic-signing-secret'));
  render(HyperConnectionsPanel, { selection: { page: 'list' } }); mountEffects(); await drain();
  expect(h.states[0][0].state).toBe('Connected'); expect(h.states[3]).toMatch(/confirm|provider/i); expect(h.states[3]).not.toContain('synthetic-signing-secret');
});
