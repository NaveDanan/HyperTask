import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { HyperPluginGrants } from './connections/HyperPluginGrants';
import { HyperConnectionsPanel } from './connections/HyperConnectionsPanel';
import HyperMemorySection, { HyperBotMemoryTab } from './memory/HyperMemorySection';
import { HyperSkillsPanel } from './skills/HyperSkillsPanel';
import HyperNativeSkills from './skills/HyperNativeSkills';
import { HyperHomeComposer } from './onboarding/HyperHomeComposer';
import { hyperHomeDraftStore } from './onboarding/HyperHomeDraft';
import { HyperOpenBotPage, HyperOpenBotWorkspace } from './HyperOpenBotPage';
import { HyperComposer } from './composer';
import { HyperConversationDraftCache } from './HyperConversationDraft';
import { HyperInteractiveResult } from './screens-gen/HyperInteractiveResult';
import { FormCardArgs, HyperFormCard } from './screens-gen/form';
import HyperRoutinesSection, { HyperCheckInEditor, HyperGoalEditor } from './routines/HyperRoutinesSection';
import { HyperRead } from './routines/HyperRoutineControls';
import HyperLearningSection from './memory/HyperLearningSection';
import { HyperLearningConfiguration } from './memory/HyperLearningConfiguration';
import HyperNewConversationSection from './conversations/HyperNewConversationSection';
import { HyperGroupChat } from './conversations/HyperGroupChat';
import { hyperAcquireConversationDraft } from './useHyperConversationDraft';
import { HyperAppAccessAction, HyperAppAccessRequests } from './connections/HyperAppAccessAction';
import { HyperSharedAccessRequests } from './connections/HyperSharedAccessRequests';
import { HyperBotsPanel, HyperBotEditor } from './bots/HyperBotsPanel';
import { HyperBotAttentionBoard } from './bot-tabs/HyperBotAttentionBoard';
import { HyperVoiceControls } from './conversations/HyperVoiceControls';
import { HyperInitialDraftTransfer } from './conversations/HyperInitialDraftTransfer';
import { hyperRoutineSelectionFromPath } from './routines/HyperRoutineNavigation';
import { HyperReachability } from './bot-tabs/HyperReachability';
import { HyperConversationResult } from './screens-gen/HyperConversationResult';
import { HyperSharedApprovalFields } from './connections/HyperPluginGrants';

// Exercise actual production effects and handlers without a live backend or browser fixture.
const h = vi.hoisted(() => ({ active: false, states: [] as any[], refs: [] as any[], effects: [] as (() => unknown)[], deps: [] as (readonly unknown[] | undefined)[], cleanups: [] as (() => void)[], stateIndex: 0, refIndex: 0, context: undefined as any }));
const f = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), lookup: vi.fn(), decision: vi.fn(), connections: vi.fn(), stateListener: undefined as undefined | ((state: any) => void), agent: undefined as any, core: undefined as any }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  const effect = (...args: Parameters<typeof react.useEffect>) => { if (h.active) { h.effects.push(args[0]); h.deps.push(args[1]); } else react.useEffect(...args); };
  return { ...react,
    useState: (initial: any) => {
      if (!h.active) return react.useState(initial);
      const index = h.stateIndex++, state = h.states; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (next: any) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useRef: (initial: any) => { if (!h.active) return react.useRef(initial); const index = h.refIndex++; return h.refs[index] ?? (h.refs[index] = { current: initial }); },
    useEffect: effect, useLayoutEffect: effect,
    useCallback: (callback: any, deps: unknown[]) => h.active ? callback : react.useCallback(callback, deps),
    useMemo: (create: () => unknown, deps: unknown[]) => h.active ? create() : react.useMemo(create, deps),
    useContext: (...args: Parameters<typeof react.useContext>) => h.active ? h.context : react.useContext(...args),
    useSyncExternalStore: (...args: Parameters<typeof react.useSyncExternalStore>) => h.active ? args[1]() : react.useSyncExternalStore(...args),
  };
});
vi.mock('./transport', async original => ({ ...await original<typeof import('./transport')>(), hyperOpenBotRequest: f.request, hyperOpenBotFetch: f.fetch }));
vi.mock('@copilotkit/react-core/v2', () => ({ useFrontendTool: vi.fn(), useCopilotKit: () => ({ copilotkit: f.core ?? {} }), useAgent: () => ({ agent: f.agent ?? { messages: [], isRunning: false }, isReady: true }), OpenGenerativeUIActivityRenderer: () => null }));
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
  f.agent = undefined; f.core = undefined;
  h.context = undefined;
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
it('keeps check-in focus and interval in the same draft until Save changes', async () => {
  const setting = { id: 'check', focus: 'original focus', intervalMinutes: 60, subject: 'Check' }, refresh = vi.fn();
  const props = { setting, refresh };
  let tree = render(HyperCheckInEditor, props);
  find(tree, element => element.props.maxLength === 1000)!.props.onChange({ target: { value: 'unsaved focus' } });
  tree = render(HyperCheckInEditor, props);
  find(tree, element => element.props.label === 'How often')!.props.onChange('240'); await drain();
  expect(f.request).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  tree = render(HyperCheckInEditor, props);
  await find(tree, element => element.props.label === 'Save changes')!.props.run();
  expect(f.request).toHaveBeenCalledWith('/api/proactive/settings/check', 'PATCH', { focus: 'unsaved focus', intervalMinutes: 240 });
});
it('does not borrow a remounted composer active-send attachment for a queued follow-up', () => {
  const consume = vi.fn(), discard = vi.fn();
  const props = { value: 'follow-up', pending: true, attachments: [{ id: 'first-send-file', name: 'sent.txt', status: 'ready' }], activeAttachmentIds: ['first-send-file'], onSubmit: vi.fn(), onConsumeAttachments: consume, onDiscardAttachment: discard };
  let tree = render(HyperComposer, props); find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  expect(consume).toHaveBeenCalledWith([]);
  tree = render(HyperComposer, props); button(tree, 'Remove queued message')!.props.onClick();
  expect(discard).not.toHaveBeenCalled();
});
it('already merges an older rejected group send into the reopened owner draft instead of losing it', async () => {
  const id = 'group-rejection-current', lease = hyperAcquireConversationDraft(id);
  lease.update(current => ({ ...current, text: 'A', attachments: [], commandIds: [] }));
  let fail!: (error: Error) => void;
  f.request.mockImplementation((path: string, method?: string) => path === `/api/groups/${id}` && method === 'POST' ? new Promise((_, reject) => { fail = reject; }) : Promise.resolve({ user: { id: 'owner' } }));
  const data = { people: [], bots: [{ id: 'bot-a', name: 'A' }, { id: 'bot-b', name: 'B' }], messages: [] };
  let group = render(HyperGroupChat, { channelId: id, serviceReady: true }, [[], false, data]);
  const first = find(group, element => element.type === HyperComposer)!;
  h.states = []; h.refs = [];
  find(render(HyperComposer, first.props), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  mountEffects(); for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  h.states = []; h.refs = [];
  group = render(HyperGroupChat, { channelId: id, serviceReady: true }, [[], false, data]);
  const reopened = find(group, element => element.type === HyperComposer)!; h.states = []; h.refs = [];
  const tree = render(HyperComposer, reopened.props);
  find(tree, element => element.props['data-slot'] === 'composer-input')!.props.onChange({ target: { value: 'B' } });
  fail(new Error('refused')); await drain();
  expect(lease.get().text).toBe('A B');
});
const requestLists = [
  { name: 'app', component: HyperAppAccessRequests, props: (key: string) => ({ app: key }), label: 'Approve read-only access' },
  { name: 'shared', component: HyperSharedAccessRequests, props: (key: string) => ({ serverId: key }), label: 'Approve requested access' },
];
const requestRows = (key: string) => ({ requests: [{ id: `request-${key}`, appKey: key, appTitle: `App ${key}`, serverId: key, botName: `Bot ${key}`, requesterName: `Person ${key}`, kind: 'enable', status: 'pending', reason: 'Read access', proposed: approval, current: null }], counts: { total: 1, byApp: { [key]: 1 } } });
it.each(requestLists)('$name requests cannot remain actionable under another app while its read is pending', async list => {
  let finish!: (value: unknown) => void;
  f.request.mockResolvedValueOnce(requestRows('A')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const run = async (action: () => Promise<void>) => action(), props = (key: string) => ({ ...list.props(key), busy: false, run });
  render(list.component, props('A')); mountEffects(); await drain();
  const old = button(render(list.component, props('A')), list.label)!;
  const changed = render(list.component, props('B'));
  expect(button(changed, list.label)).toBeUndefined();
  old.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[1] === 'POST')).toBe(false);
  mountEffects(); await drain();
  const current = render(list.component, props('B'));
  try {
    expect(button(current, list.label)).toBeUndefined(); old.props.onClick(); await drain();
    expect(f.request.mock.calls.some(call => call[1] === 'POST')).toBe(false);
  } finally { finish(requestRows('B')); await drain(); }
});
it.each(requestLists)('$name requests discard a late previous-app read after the new app has loaded', async list => {
  let oldRead!: (value: unknown) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { oldRead = resolve; })).mockResolvedValueOnce(requestRows('B'));
  const props = (key: string) => ({ ...list.props(key), busy: false, run: async (action: () => Promise<void>) => action() });
  render(list.component, props('A')); mountEffects();
  render(list.component, props('B')); mountEffects(); await drain(); oldRead(requestRows('A')); await drain();
  const current = render(list.component, props('B'));
  expect(find(current, element => element.type === 'p' && text(element.props.children).includes('Bot A'))).toBeUndefined();
  expect(find(current, element => element.type === 'p' && text(element.props.children).includes('Bot B'))).toBeDefined();
});
it.each(requestLists)('$name request decisions reject a cached callback after unmount', async list => {
  f.request.mockResolvedValue(requestRows('A'));
  const props = { ...list.props('A'), busy: false, run: async (action: () => Promise<void>) => action() };
  render(list.component, props); mountEffects(); await drain();
  const old = button(render(list.component, props), list.label)!;
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  old.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[1] === 'POST')).toBe(false);
});
it.each(requestLists)('$name requests keep another app hidden when the current read fails and recover on polling', async list => {
  f.request.mockResolvedValueOnce(requestRows('A')).mockRejectedValueOnce(new Error('synthetic-read-failure')).mockResolvedValue(requestRows('B'));
  const props = (key: string) => ({ ...list.props(key), busy: false, run: async (action: () => Promise<void>) => action() });
  render(list.component, props('A')); mountEffects(); await drain();
  render(list.component, props('B')); mountEffects(); await drain();
  let tree = render(list.component, props('B'));
  expect(button(tree, list.label)).toBeUndefined(); expect(find(tree, element => element.props.role === 'alert')).toBeDefined();
  await vi.advanceTimersByTimeAsync(10000); tree = render(list.component, props('B'));
  expect(button(tree, list.label)).toBeDefined(); expect(find(tree, element => element.props.role === 'alert')).toBeUndefined();
});
it.each(requestLists)('$name requests reject reordered reads within the same app', async list => {
  let original!: (value: unknown) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { original = resolve; })).mockResolvedValue({ ...requestRows('A'), requests: [{ ...requestRows('A').requests[0], botName: 'Latest Bot' }] });
  const props = { ...list.props('A'), busy: false, run: async (action: () => Promise<void>) => action() };
  render(list.component, props); mountEffects(); await vi.advanceTimersByTimeAsync(10000);
  original(requestRows('A')); await drain(); const tree = render(list.component, props);
  expect(find(tree, element => element.type === 'p' && text(element.props.children).includes('Latest Bot'))).toBeDefined();
  expect(find(tree, element => element.type === 'p' && text(element.props.children).includes('Bot A'))).toBeUndefined();
});
it.each(requestLists)('$name decisions recheck the target when the parent defers their execution', async list => {
  let deferred!: () => Promise<void>;
  f.request.mockResolvedValue(requestRows('A'));
  const run = vi.fn(async (action: () => Promise<void>) => { deferred = action; }), props = (key: string) => ({ ...list.props(key), busy: false, run });
  render(list.component, props('A')); mountEffects(); await drain();
  button(render(list.component, props('A')), list.label)!.props.onClick(); await drain(); expect(run).toHaveBeenCalledOnce();
  render(list.component, props('B')); await deferred();
  expect(f.request.mock.calls.some(call => call[1] === 'POST')).toBe(false);
});
it.each(requestLists)('$name decisions do not revive an old callback when returning to the same app', async list => {
  f.request.mockImplementation(async () => requestRows('A'));
  const props = (key: string) => ({ ...list.props(key), busy: false, run: async (action: () => Promise<void>) => action() });
  render(list.component, props('A')); mountEffects(); await drain();
  const old = button(render(list.component, props('A')), list.label)!;
  render(list.component, props('B')); mountEffects(); await drain();
  render(list.component, props('A')); mountEffects(); await drain();
  expect(button(render(list.component, props('A')), list.label)).toBeDefined(); old.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[1] === 'POST')).toBe(false);
});
it.each(requestLists)('$name requests exclude rows belonging to another app even in the current response', async list => {
  f.request.mockResolvedValue({ ...requestRows('A'), requests: [...requestRows('A').requests, ...requestRows('B').requests] });
  const props = { ...list.props('A'), busy: false, run: async (action: () => Promise<void>) => action() };
  render(list.component, props); mountEffects(); await drain(); const tree = render(list.component, props);
  expect(find(tree, element => element.type === 'p' && text(element.props.children).includes('Bot A'))).toBeDefined();
  expect(find(tree, element => element.type === 'p' && text(element.props.children).includes('Bot B'))).toBeUndefined();
});
it.each([
  { ...requestLists[0], decision: 'approve', endpoint: '/api/plugins/access-requests/request-A/approve' },
  { ...requestLists[0], label: 'Dismiss request', decision: 'dismiss', endpoint: '/api/plugins/access-requests/request-A/dismiss' },
  { ...requestLists[1], decision: 'approve', endpoint: '/api/approvals/shared-use/request-A/approve' },
  { ...requestLists[1], label: 'Decline', decision: 'decline', endpoint: '/api/approvals/shared-use/request-A/decline' },
])('$name current-target $decision still posts and reloads after the parent marks itself busy', async list => {
  let deferred!: () => Promise<void>;
  f.request.mockImplementation(async (_path: string, method?: string) => method === 'POST' ? {} : requestRows('A'));
  const run = vi.fn(async (action: () => Promise<void>) => { deferred = action; }), props = { ...list.props('A'), busy: false, run };
  render(list.component, props); mountEffects(); await drain();
  button(render(list.component, props), list.label)!.props.onClick(); await drain();
  render(list.component, { ...props, busy: true }); await deferred();
  expect(f.request.mock.calls.filter(call => call[1] === 'POST').map(call => call[0])).toEqual([list.endpoint]);
  expect(f.request.mock.calls.filter(call => call[1] !== 'POST')).toHaveLength(2);
});
it.each(requestLists)('$name settling decisions do not reload the old app after navigation', async list => {
  let finish!: (value: unknown) => void;
  f.request.mockImplementation(async (_path: string, method?: string) => method === 'POST' ? new Promise(resolve => { finish = resolve; }) : requestRows('A'));
  const props = (key: string) => ({ ...list.props(key), busy: false, run: async (action: () => Promise<void>) => action() });
  render(list.component, props('A')); mountEffects(); await drain();
  button(render(list.component, props('A')), list.label)!.props.onClick(); await drain();
  render(list.component, props('B')); mountEffects(); await drain(); finish({}); await drain();
  expect(f.request.mock.calls.filter(call => call[1] !== 'POST')).toHaveLength(2);
});
const botAppAccess = (agentId: string, app: string) => ({ app: { key: app, displayName: `Access ${agentId} ${app}`, state: 'not_connected', accountHolder: 'you', request: { id: `request-${agentId}-${app}`, kind: 'enable', createdAt: '2026-11-15T00:00:00Z' }, requestKind: 'enable' } });
const cardTargets = [
  { name: 'Bot', before: { agentId: 'A', app: 'mail' }, after: { agentId: 'B', app: 'mail' } },
  { name: 'app', before: { agentId: 'A', app: 'mail' }, after: { agentId: 'A', app: 'calendar' } },
];
it.each(cardTargets)('Bot app-access card hides old state and rejects cached withdrawal immediately on $name change', async target => {
  f.request.mockResolvedValue(botAppAccess(target.before.agentId, target.before.app));
  render(HyperAppAccessAction, target.before); mountEffects(); await drain();
  const old = button(render(HyperAppAccessAction, target.before), 'Withdraw request')!;
  const next = render(HyperAppAccessAction, target.after);
  expect(button(next, 'Withdraw request')).toBeUndefined(); old.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[1] === 'DELETE')).toBe(false);
});
it.each(cardTargets)('Bot app-access card rejects a late read from the previous $name after current state loads', async target => {
  let finish!: (value: unknown) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(botAppAccess(target.after.agentId, target.after.app));
  render(HyperAppAccessAction, target.before); mountEffects();
  render(HyperAppAccessAction, target.after); mountEffects(); await drain();
  finish(botAppAccess(target.before.agentId, target.before.app)); await drain(); const tree = render(HyperAppAccessAction, target.after);
  expect(find(tree, element => element.type === 'p' && text(element.props.children).includes(`Access ${target.before.agentId} ${target.before.app}`))).toBeUndefined();
  expect(find(tree, element => element.type === 'p' && text(element.props.children).includes(`Access ${target.after.agentId} ${target.after.app}`))).toBeDefined();
  button(tree, 'Withdraw request')!.props.onClick(); await drain();
  expect(f.request.mock.calls.filter(call => call[1] === 'DELETE').map(call => call[0])).toEqual([`/api/plugins/access-requests/request-${target.after.agentId}-${target.after.app}`]);
});
it.each(cardTargets)('Bot app-access card settling withdrawal does not reload the previous $name', async target => {
  let finish!: (value: unknown) => void;
  f.request.mockImplementation(async (path: string, method?: string) => method === 'DELETE' ? new Promise(resolve => { finish = resolve; }) : path.includes(`/for/${target.after.agentId}/apps/${target.after.app}`) ? botAppAccess(target.after.agentId, target.after.app) : botAppAccess(target.before.agentId, target.before.app));
  render(HyperAppAccessAction, target.before); mountEffects(); await drain();
  button(render(HyperAppAccessAction, target.before), 'Withdraw request')!.props.onClick(); await drain();
  render(HyperAppAccessAction, target.after); mountEffects(); await drain(); finish({}); await drain();
  expect(f.request.mock.calls.filter(call => call[1] !== 'DELETE')).toHaveLength(2);
  expect(find(render(HyperAppAccessAction, target.after), element => element.type === 'p' && text(element.props.children).includes(`Access ${target.after.agentId} ${target.after.app}`))).toBeDefined();
});
it('Bot app-access card rejects cached withdrawal and refresh callbacks after unmount', async () => {
  const props = { agentId: 'A', app: 'mail' }; f.request.mockResolvedValue(botAppAccess(props.agentId, props.app));
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  const withdraw = button(tree, 'Withdraw request')!, refresh = button(tree, 'Refresh access')!;
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  withdraw.props.onClick(); refresh.props.onClick(); await drain();
  expect(f.request).toHaveBeenCalledOnce();
});
it.each([
  { label: 'Withdraw request', changes: {}, admin: false, method: 'DELETE', path: '/api/plugins/access-requests/request-A-mail' },
  { label: 'Request access', changes: { request: null }, admin: false, method: 'POST', path: '/api/plugins/access-requests' },
  { label: 'Let it use your app', changes: { state: 'owner_grantable', needsConnect: false, request: null }, admin: false, method: 'POST', path: '/api/plugins/for/A/apps/mail/give' },
  { label: 'Take back what you gave', changes: { givenByOwner: true }, admin: false, method: 'DELETE', path: '/api/plugins/for/A/apps/mail/give' },
  { label: 'Enable and grant read-only access', changes: { state: 'not_granted' }, admin: true, method: 'POST', path: '/api/plugins/for/A/apps/mail/approve' },
])('Bot app-access card preserves current-selection "$label" and reloads afterward', async action => {
  const props = { agentId: 'A', app: 'mail', admin: action.admin }, response = botAppAccess(props.agentId, props.app);
  f.request.mockImplementation(async (_path: string, method?: string) => method ? {} : { app: { ...response.app, ...action.changes } });
  render(HyperAppAccessAction, props); mountEffects(); await drain();
  button(render(HyperAppAccessAction, props), action.label)!.props.onClick(); await drain();
  expect(f.request.mock.calls.filter(call => call[1]).map(call => [call[0], call[1]])).toEqual([[action.path, action.method]]);
  expect(f.request.mock.calls.filter(call => !call[1])).toHaveLength(2);
  expect(button(render(HyperAppAccessAction, props), action.label)!.props.disabled).toBe(false);
});
it.each(cardTargets)('Bot app-access setup and refresh callbacks cannot act after a $name change', async target => {
  const navigate = vi.fn(), props = { ...target.before, onOpenConnection: navigate };
  f.request.mockResolvedValue(botAppAccess(target.before.agentId, target.before.app));
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  const open = button(tree, 'Open app setup and connection')!, refresh = button(tree, 'Refresh access')!;
  render(HyperAppAccessAction, { ...target.after, onOpenConnection: navigate }); open.props.onClick(); refresh.props.onClick(); await drain();
  expect(navigate).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledOnce();
});
it('Bot app-access setup and refresh work for the current selection', async () => {
  const navigate = vi.fn(), props = { agentId: 'A', app: 'mail', onOpenConnection: navigate };
  f.request.mockResolvedValue(botAppAccess(props.agentId, props.app));
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  button(tree, 'Open app setup and connection')!.props.onClick(); button(tree, 'Refresh access')!.props.onClick(); await drain();
  expect(navigate).toHaveBeenCalledWith('mail'); expect(f.request).toHaveBeenCalledTimes(2);
});
it('Bot app-access card does not revive an old callback when returning to the same Bot', async () => {
  const props = { agentId: 'A', app: 'mail' }; f.request.mockResolvedValue(botAppAccess(props.agentId, props.app));
  render(HyperAppAccessAction, props); mountEffects(); await drain();
  const old = button(render(HyperAppAccessAction, props), 'Withdraw request')!;
  render(HyperAppAccessAction, { ...props, agentId: 'B' }); mountEffects(); await drain();
  render(HyperAppAccessAction, props); mountEffects(); await drain();
  expect(button(render(HyperAppAccessAction, props), 'Withdraw request')).toBeDefined(); old.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[1] === 'DELETE')).toBe(false);
});
it('Bot app-access card expires an admin approval callback on role change', async () => {
  const props = { agentId: 'A', app: 'mail', admin: true };
  f.request.mockResolvedValue({ app: { ...botAppAccess(props.agentId, props.app).app, state: 'not_granted' } });
  render(HyperAppAccessAction, props); mountEffects(); await drain();
  const approve = button(render(HyperAppAccessAction, props), 'Enable and grant read-only access')!;
  render(HyperAppAccessAction, { ...props, admin: false }); approve.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[1] === 'POST')).toBe(false);
});
it('Bot app-access card rejects reordered manual refreshes on the same selection', async () => {
  const props = { agentId: 'A', app: 'mail' }; let older!: (value: unknown) => void;
  f.request.mockResolvedValueOnce(botAppAccess(props.agentId, props.app)).mockImplementationOnce(() => new Promise(resolve => { older = resolve; })).mockResolvedValue({ app: { ...botAppAccess(props.agentId, props.app).app, displayName: 'Newest state' } });
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  button(tree, 'Refresh access')!.props.onClick(); button(tree, 'Refresh access')!.props.onClick(); await drain();
  older(botAppAccess(props.agentId, props.app)); await drain();
  expect(find(render(HyperAppAccessAction, props), element => element.type === 'p' && text(element.props.children).includes('Newest state'))).toBeDefined();
});
it('Bot app-access card prevents a duplicate withdrawal before React rerenders', async () => {
  const props = { agentId: 'A', app: 'mail' }; let finish!: (value: unknown) => void;
  f.request.mockImplementation(async (_path: string, method?: string) => method === 'DELETE' ? new Promise(resolve => { finish = resolve; }) : botAppAccess(props.agentId, props.app));
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const withdraw = button(render(HyperAppAccessAction, props), 'Withdraw request')!;
  withdraw.props.onClick(); withdraw.props.onClick(); await drain();
  expect(f.request.mock.calls.filter(call => call[1] === 'DELETE')).toHaveLength(1); finish({}); await drain();
});
it('Bot app-access card keeps generic mutation failure feedback after readback and clears it on refresh', async () => {
  const props = { agentId: 'A', app: 'mail' };
  f.request.mockImplementation(async (_path: string, method?: string) => { if (method) throw new Error('synthetic-private-failure'); return botAppAccess(props.agentId, props.app); });
  render(HyperAppAccessAction, props); mountEffects(); await drain();
  button(render(HyperAppAccessAction, props), 'Withdraw request')!.props.onClick(); await drain(); let tree = render(HyperAppAccessAction, props);
  expect(text(find(tree, element => element.props.role === 'alert')!.props.children)).toBe('Access could not be changed. Check the refreshed state and retry.');
  expect(button(tree, 'Withdraw request')!.props.disabled).toBe(false); button(tree, 'Refresh access')!.props.onClick(); await drain(); tree = render(HyperAppAccessAction, props);
  expect(find(tree, element => element.props.role === 'alert')).toBeUndefined();
});
it('Bot app-access card rejects a read from the previous StrictMode effect lifetime', async () => {
  const props = { agentId: 'A', app: 'mail' }; let older!: (value: unknown) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { older = resolve; })).mockResolvedValue({ app: { ...botAppAccess(props.agentId, props.app).app, displayName: 'Fresh mount state' } });
  render(HyperAppAccessAction, props); mountEffects();
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = []; mountEffects(); await drain();
  older(botAppAccess(props.agentId, props.app)); await drain();
  expect(find(render(HyperAppAccessAction, props), element => element.type === 'p' && text(element.props.children).includes('Fresh mount state'))).toBeDefined();
});
it('preserves an active voice call when only starting a new call is disabled during history refresh', async () => {
  const session = { subscribe: vi.fn(), getSnapshot: () => ({ phase: 'connected', seconds: 1, working: false, muted: false, transcript: '', reply: '' }), end: vi.fn() };
  f.request.mockImplementation(async (path: string) => path === '/api/me' ? { user: { id: 'owner' } } : path === '/api/capabilities' ? { voice: true } : { sessions: [], nextCursor: null });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
  render(HyperVoiceControls, { channelId: 'voice', disabled: true, canContinue: true, context: () => '', askAgent: vi.fn(), anchorMessageId: () => null }, [true, [], [], undefined, 0, session]);
  mountEffects(); await drain(); expect(session.end).not.toHaveBeenCalled();
});
it('threads native Bots conversation navigation into attention and selected Bot views', async () => {
  const states = ['bots', [], false, '', [], 'thread', 0, 0, undefined, [], undefined, undefined, false];
  const workspace = render(HyperOpenBotWorkspace, { viewId: 'bots-navigation', serviceReady: true }, states);
  const panel = find(workspace, element => element.type === HyperBotsPanel)!;
  expect(typeof panel.props.onOpenConversation).toBe('function');
  const bot = { id: 'bot', name: 'Bot', title: '', roleDescription: '', visibility: 'private', mine: true };
  h.refs = [];
  const tree = render(HyperBotsPanel, panel.props, [[bot], false, '', bot, true, false, '', 0]);
  const board = find(tree, element => element.type === HyperBotAttentionBoard)!, editor = find(tree, element => element.type === HyperBotEditor)!;
  expect(board.props.openConversation).toBe(panel.props.onOpenConversation); expect(editor.props.onOpenConversation).toBe(panel.props.onOpenConversation);
  f.request.mockResolvedValue({ channel: { id: 'work', name: 'Work', threadId: 'thread', agentIds: ['bot'], active: true } });
  vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn() });
  board.props.openConversation('work'); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/channels/work');
  expect(find(render(HyperOpenBotWorkspace, { viewId: 'bots-navigation', serviceReady: true }, states), element => element.props.channel?.id === 'work')).toBeDefined();
});
it.each([
  { name: 'history restoring', serviceReady: true, active: true, expectedContinue: true },
  { name: 'service outage', serviceReady: false, active: true, expectedContinue: false },
  { name: 'inactive channel', serviceReady: true, active: false, expectedContinue: false },
])('native Chat voice continuation policy distinguishes $name from start readiness', test => {
  const channel = { id: 'voice-policy', name: 'Voice', threadId: 'thread', agentIds: ['bot'], active: test.active };
  const workspace = render(HyperOpenBotWorkspace, { viewId: 'voice-policy', serviceReady: test.serviceReady }, ['conversations', [], false, '', [], 'thread', 0, 0, undefined, [channel], channel]);
  const chat = find(workspace, element => element.props.channel?.id === channel.id)!;
  h.states = []; h.refs = [];
  const controls = find(render(chat.type as (props: any) => ReactNode, chat.props), element => element.type === HyperVoiceControls)!;
  expect(controls.props.disabled).toBe(true); expect(controls.props.canContinue).toBe(test.expectedContinue);
});
it('voice continuation denial ends a connected call and blocks a new start', async () => {
  let phase = 'connected';
  const session = { subscribe: vi.fn(), getSnapshot: () => ({ phase, seconds: 1 }), end: vi.fn(() => { phase = 'idle'; }), start: vi.fn() };
  const props = { channelId: 'voice-denied', disabled: false, canContinue: false, context: () => '', askAgent: vi.fn(), anchorMessageId: () => null };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
  f.request.mockImplementation(async (path: string) => path === '/api/me' ? { user: { id: 'owner' } } : path === '/api/capabilities' ? { voice: true } : { sessions: [], nextCursor: null });
  let tree = render(HyperVoiceControls, props, [true, [], [], undefined, 0, session]); mountEffects(); await drain();
  expect(session.end).toHaveBeenCalledOnce(); tree = render(HyperVoiceControls, props);
  const start = button(tree, 'Start voice call')!; expect(start.props.disabled).toBe(true); start.props.onClick(); expect(session.start).not.toHaveBeenCalled();
});
it('Memory Remember is an explicit submit control for the real form save handler', async () => {
  const state = [{ page: 'facts' }, { edition: 'team' }, '', false, 0, '/api/capabilities:', [], '', false, 0, '/api/memory:memories', [], '', false, 0, '/api/agents:agents', false, '', 'remember this fact', undefined];
  f.request.mockResolvedValue({}); const tree = render(HyperMemorySection, {}, state);
  const form = find(tree, element => element.type === 'form')!, submit = find(form, element => text(element.props.children) === 'Remember')!;
  expect(submit.props.type).toBe('submit'); form.props.onSubmit({ preventDefault() {} }); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/memory', 'POST', { content: 'remember this fact' });
});
function hyperModelTestChat(agentId = 'model-bot') {
  const channel = { id: 'model-channel', name: 'Model', threadId: 'model-thread', agentIds: [agentId], active: true };
  const workspace = render(HyperOpenBotWorkspace, { viewId: 'model-test', serviceReady: true }, ['conversations', [], false, '', [], 'thread', 0, 0, undefined, [channel], channel]);
  const chat = find(workspace, element => element.props.channel?.id === channel.id)!;
  h.states = []; h.refs = [];
  const component = chat.type as (props: any) => ReactNode;
  render(component, chat.props);
  return { component, props: chat.props, metadataEffect: h.effects[2] };
}
const hyperModelCatalogue = { models: [{ id: 'openbot-model', label: 'OpenBot model', efforts: ['high'] }], default: 'openbot-model', choosable: true };
it.each([false, undefined])('does not fetch or offer OpenBot model choices for Bot capability %s', async capability => {
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/agents/') ? { agent: { id: 'model-bot', runsOnOpenBotModel: capability } } : path === '/api/models' ? hyperModelCatalogue : path.endsWith('/model') ? { model: 'openbot-model', effort: 'high' } : { skills: [] });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/models' || call[0] === '/api/channels/model-channel/model')).toBe(false);
  expect(find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker).toBeUndefined();
});
it('waits for authoritative native-model capability before loading model choices', async () => {
  let resolveBot!: (value: unknown) => void;
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/agents/') ? new Promise(resolve => { resolveBot = resolve; }) : path === '/api/models' ? hyperModelCatalogue : path.endsWith('/model') ? { model: 'openbot-model', effort: 'high' } : { skills: [] });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/models')).toBe(false);
  resolveBot({ agent: { id: 'model-bot', runsOnOpenBotModel: true } }); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/models');
  expect(find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker).toBeDefined();
});
it('shows an open routine run with null status as Running rather than No finished run', () => {
  const tree = render(HyperRoutinesSection, { initialTab: 'routines' });
  const read = find(tree, element => element.props.path === '/api/routines')!;
  const rows = read.props.children({ sweep: { working: true }, routines: [{ id: 'routine', title: 'Routine', instruction: 'Check', schedule: '* * * * *', enabled: true, channel: { gone: true }, lastRun: { status: null } }] });
  expect(find(rows, element => element.type === 'p' && text(element.props.children) === 'Last run: Running…')).toBeDefined();
});
it('documents check-in interval and focus as a joint local draft instead of immediate interval writes', () => {
  const reuse = readFileSync(new URL('./routines/REUSE.md', import.meta.url), 'utf8');
  expect(reuse.includes('immediate interval writes')).toBe(false);
  expect(reuse).toContain('Save changes');
});
it('keeps model choices for a managed harness even when builtIn is false', async () => {
  f.request.mockImplementation(async (path: string, method?: string) => method === 'PUT' ? { model: 'openbot-model', effort: 'high' } : path.startsWith('/api/agents/') ? { agent: { id: 'model-bot', builtIn: false, runsOnOpenBotModel: true } } : path === '/api/models' ? hyperModelCatalogue : path.endsWith('/model') ? { model: null, effort: null } : { skills: [] });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  const picker = find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker;
  expect(picker.value).toEqual({ model: 'openbot-model', effort: null });
  picker.onChange({ model: 'openbot-model', effort: 'high' }); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/channels/model-channel/model', 'PUT', { model: null, effort: 'high' });
  expect(find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker.value).toEqual({ model: 'openbot-model', effort: 'high' });
});
it.each(['wrong Bot', 'nonboolean flag', 'read failure'])('does not infer a model capability from %s', async mode => {
  f.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/agents/')) { if (mode === 'read failure') throw new Error('synthetic-profile-failure'); return { agent: { id: mode === 'wrong Bot' ? 'other' : 'model-bot', runsOnOpenBotModel: mode === 'nonboolean flag' ? 'true' : true } }; }
    return path === '/api/models' ? hyperModelCatalogue : path.endsWith('/model') ? { model: null, effort: null } : { skills: [] };
  });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/models')).toBe(false);
  expect(find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker).toBeUndefined();
});
it('hides old model choices and rejects a cached picker before another Bot metadata effect runs', async () => {
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/agents/') ? { agent: { id: 'model-bot', runsOnOpenBotModel: true } } : path === '/api/models' ? hyperModelCatalogue : path.endsWith('/model') ? { model: null, effort: null } : { skills: [] });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  const old = find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker;
  const next = { ...chat.props, channel: { ...chat.props.channel, agentIds: ['external'] } };
  expect(find(render(chat.component, next), element => element.type === HyperComposer)!.props.modelPicker).toBeUndefined();
  old.onChange({ model: 'openbot-model', effort: 'high' }); await drain();
  expect(f.request.mock.calls.some(call => call[1] === 'PUT')).toBe(false);
});
it('rejects a late native capability read after the selected Bot changes', async () => {
  let native!: (value: unknown) => void;
  f.request.mockImplementation(async (path: string) => path === '/api/agents/model-bot' ? new Promise(resolve => { native = resolve; }) : path === '/api/agents/external' ? { agent: { id: 'external', runsOnOpenBotModel: false } } : path === '/api/models' ? hyperModelCatalogue : path.endsWith('/model') ? { model: null, effort: null } : { skills: [] });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  const next = { ...chat.props, channel: { ...chat.props.channel, agentIds: ['external'] } };
  render(chat.component, next); const nextCleanup = h.effects[2](); if (typeof nextCleanup === 'function') h.cleanups.push(nextCleanup as () => void); await drain();
  native({ agent: { id: 'model-bot', runsOnOpenBotModel: true } }); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/models')).toBe(false);
  expect(find(render(chat.component, next), element => element.type === HyperComposer)!.props.modelPicker).toBeUndefined();
});
it('rejects a late native catalogue after an external Bot is selected', async () => {
  let catalogue!: (value: unknown) => void;
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/agents/') ? { agent: { id: path.endsWith('/external') ? 'external' : 'model-bot', runsOnOpenBotModel: !path.endsWith('/external') } } : path === '/api/models' ? new Promise(resolve => { catalogue = resolve; }) : path.endsWith('/model') ? { model: null, effort: null } : { skills: [] });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  const next = { ...chat.props, channel: { ...chat.props.channel, agentIds: ['external'] } };
  render(chat.component, next); const nextCleanup = h.effects[2](); if (typeof nextCleanup === 'function') h.cleanups.push(nextCleanup as () => void); await drain();
  catalogue(hyperModelCatalogue); await drain();
  expect(find(render(chat.component, next), element => element.type === HyperComposer)!.props.modelPicker).toBeUndefined();
});
it('rejects a cached model picker after unmount', async () => {
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/agents/') ? { agent: { id: 'model-bot', runsOnOpenBotModel: true } } : path === '/api/models' ? hyperModelCatalogue : path.endsWith('/model') ? { model: null, effort: null } : { skills: [] });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  const picker = find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker;
  for (const off of h.cleanups) off(); h.cleanups = [];
  picker.onChange({ model: 'openbot-model', effort: 'high' }); await drain(); expect(f.request.mock.calls.some(call => call[1] === 'PUT')).toBe(false);
});
it('old model-save settlement cannot overwrite or unlock the current channel picker', async () => {
  let oldSave!: (value: unknown) => void, newSave!: (value: unknown) => void;
  f.request.mockImplementation(async (path: string, method?: string) => {
    if (method === 'PUT') return new Promise(resolve => { if (path.includes('other-channel')) newSave = resolve; else oldSave = resolve; });
    if (path.startsWith('/api/agents/')) return { agent: { id: path.endsWith('other-bot') ? 'other-bot' : 'model-bot', runsOnOpenBotModel: true } };
    if (path === '/api/models') return hyperModelCatalogue;
    if (path.endsWith('/model')) return path.includes('other-channel') ? { model: 'other-model', effort: 'low' } : { model: null, effort: null };
    return { skills: [] };
  });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker.onChange({ model: 'openbot-model', effort: 'high' }); await drain();
  const next = { ...chat.props, channel: { ...chat.props.channel, id: 'other-channel', threadId: 'other-thread', agentIds: ['other-bot'] } };
  render(chat.component, next); const nextCleanup = h.effects[2](); if (typeof nextCleanup === 'function') h.cleanups.push(nextCleanup as () => void); await drain();
  find(render(chat.component, next), element => element.type === HyperComposer)!.props.modelPicker.onChange({ model: 'other-model', effort: 'high' }); await drain();
  oldSave({ model: 'openbot-model', effort: 'high' }); await drain();
  let picker = find(render(chat.component, next), element => element.type === HyperComposer)!.props.modelPicker;
  expect(picker.value).toEqual({ model: 'other-model', effort: 'low' }); expect(picker.disabled).toBe(true);
  newSave({ model: 'other-model', effort: 'high' }); await drain();
  picker = find(render(chat.component, next), element => element.type === HyperComposer)!.props.modelPicker;
  expect(picker.value).toEqual({ model: 'other-model', effort: 'high' }); expect(picker.disabled).toBe(false);
});
it.each([
  { lastRun: null, label: 'No finished run' },
  { lastRun: { status: 'succeeded' }, label: 'succeeded' },
  { lastRun: { status: 'failed' }, label: 'failed' },
  { lastRun: { status: 'skipped' }, label: 'skipped' },
])('keeps the distinct routine last-run display for $label', test => {
  const tree = render(HyperRoutinesSection, { initialTab: 'routines' });
  const read = find(tree, element => element.props.path === '/api/routines')!;
  const rows = read.props.children({ sweep: { working: true }, routines: [{ id: 'routine', title: 'Routine', enabled: true, channel: { gone: true }, lastRun: test.lastRun }] });
  expect(find(rows, element => element.type === 'p' && text(element.props.children) === `Last run: ${test.label}`)).toBeDefined();
});
function hyperLearningTestEditor() {
  const settings = { enabled: true, defaultTarget: { containerId: 'submitted-container', revision: 'revision-a' }, agents: { 'learning-bot': null }, personalReview: 'people' };
  const resource = (path: string, key: string | undefined, data: unknown) => [data, '', false, 0, `${path}:${key ?? ''}`];
  const outer = render(HyperLearningSection, {}, resource('/api/capabilities', undefined, { edition: 'team' })) as ReactElement<any>;
  const states = ['configuration', '', ...resource('/api/admin/learning/settings', 'settings', settings), settings,
    ...resource('/api/admin/learning/proposals', undefined, { proposals: [] }), ...resource('/api/admin/learning/runs', undefined, { runs: [] }),
    ...resource('/api/admin/learning/skills', undefined, { skills: [] }), ...resource('', undefined, undefined), '', false, ''];
  h.refs = [];
  const component = outer.type as (props: any) => ReactNode;
  render(component, outer.props, states);
  return { component, props: outer.props, settings, states };
}
it.each([
  { name: 'container', change: (tree: ReactNode) => find(tree, element => element.props.maxLength === 64)!.props.onChange({ target: { value: 'newer-container' } }), expected: { defaultTarget: { containerId: 'newer-container', revision: 'revision-a' } } },
  { name: 'revision', change: (tree: ReactNode) => find(tree, element => element.props.maxLength === 256)!.props.onChange({ target: { value: 'revision-b' } }), expected: { defaultTarget: { containerId: 'submitted-container', revision: 'revision-b' } } },
  { name: 'enablement', change: (tree: ReactNode) => find(tree, element => typeof element.props.onCheckedChange === 'function')!.props.onCheckedChange(false), expected: { enabled: false } },
  { name: 'Bot participation', change: (tree: ReactNode) => { const editor = find(tree, element => element.type === HyperLearningConfiguration)!; editor.props.onChange({ ...editor.props.value, agents: { 'learning-bot': { containerId: 'newer-bot-container' } } }); }, expected: { agents: { 'learning-bot': { containerId: 'newer-bot-container' } } } },
])('preserves newer Learning $name edits after an older configuration save succeeds', async test => {
  let finish!: (value: unknown) => void; f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const editor = hyperLearningTestEditor();
  find(render(editor.component, editor.props), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} }); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/admin/learning/settings', 'PUT', { enabled: editor.settings.enabled, defaultTarget: editor.settings.defaultTarget, agents: editor.settings.agents });
  test.change(render(editor.component, editor.props));
  expect(find(render(editor.component, editor.props), element => element.type === HyperLearningConfiguration)!.props.value).toMatchObject(test.expected);
  finish({ settings: editor.settings }); await drain();
  expect(find(render(editor.component, editor.props), element => element.type === HyperLearningConfiguration)!.props.value).toMatchObject(test.expected);
});
it('offers read-only retry when the first Bot app-access read fails', async () => {
  const props = { agentId: 'A', app: 'mail' };
  f.request.mockRejectedValueOnce(new Error('synthetic-transient-read')).mockResolvedValue(botAppAccess(props.agentId, props.app));
  render(HyperAppAccessAction, props); mountEffects(); await drain(); let tree = render(HyperAppAccessAction, props);
  const retry = button(tree, 'Retry access'); expect(retry).toBeDefined();
  expect(find(tree, element => element.props.role === 'status')).toBeUndefined();
  retry!.props.onClick(); await drain(); tree = render(HyperAppAccessAction, props);
  expect(button(tree, 'Withdraw request')).toBeDefined(); expect(find(tree, element => element.props.role === 'alert')).toBeUndefined();
  expect(f.request.mock.calls.some(call => call[1])).toBe(false);
});
it.each([
  { name: 'check-in', component: HyperCheckInEditor, props: () => ({ setting: { id: 'check', subject: 'Check', focus: 'original focus', intervalMinutes: 60 }, refresh: vi.fn() }) },
  { name: 'goal', component: HyperGoalEditor, props: () => ({ goal: { id: 'goal', title: 'Goal', instruction: 'Original instruction', successCriteria: 'Done', endsWhenMet: true }, refresh: vi.fn() }) },
])('locks $name draft controls while Save changes is pending', async editor => {
  let finish!: (value: unknown) => void; f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const props = editor.props();
  const pending = find(render(editor.component, props), element => element.props.label === 'Save changes')!.props.run(); await drain();
  try { expect(find(render(editor.component, props), element => element.type === 'fieldset')?.props.disabled).toBe(true); }
  finally { finish({}); await pending; await drain(); }
  expect(find(render(editor.component, props), element => element.type === 'fieldset')!.props.disabled).toBe(false);
});
it('retains the mounted routine editor and unsaved draft through a failed settings poll', async () => {
  const setting = { id: 'check', subject: 'Check', focus: 'saved focus', intervalMinutes: 60 };
  const props = { path: '/api/proactive/settings', field: 'settings', children: (settings: any[]) => <HyperCheckInEditor setting={settings[0]} refresh={vi.fn()} /> };
  f.request.mockResolvedValueOnce({ settings: [setting] }).mockRejectedValueOnce(new Error('synthetic-poll-failure'));
  render(HyperRead, props); mountEffects(); await drain();
  const readState = h.states, readRefs = h.refs;
  const first = find(render(HyperRead, props), element => element.type === HyperCheckInEditor)!;
  h.states = []; h.refs = []; let editor = render(HyperCheckInEditor, first.props);
  find(editor, element => element.props.maxLength === 1000)!.props.onChange({ target: { value: 'unsaved focus' } });
  editor = render(HyperCheckInEditor, first.props); find(editor, element => element.props.label === 'How often')!.props.onChange('240');
  const draftState = h.states, draftRefs = h.refs;
  await vi.advanceTimersByTimeAsync(10000); h.states = readState; h.refs = readRefs;
  const refreshed = render(HyperRead, props), held = find(refreshed, element => element.type === HyperCheckInEditor);
  expect(held).toBeDefined(); expect(find(refreshed, element => element.props.role === 'alert')).toBeDefined();
  h.states = draftState; h.refs = draftRefs; editor = render(HyperCheckInEditor, held!.props);
  expect(find(editor, element => element.props.maxLength === 1000)!.props.value).toBe('unsaved focus');
  expect(find(editor, element => element.props.label === 'How often')!.props.value).toBe('240');
});
it.each([false, undefined])('new conversation does not offer model choices for Bot capability %s', async capability => {
  const bot = { id: 'new-bot', name: 'Bot', title: '', runsOnOpenBotModel: capability };
  f.request.mockImplementation(async (path: string) => path === '/api/models' ? hyperModelCatalogue : path === '/api/agents' ? { agents: [bot] } : { skills: [] });
  const context = { initialAgentIds: [bot.id], startConversation: vi.fn(), openConversation: vi.fn() };
  const states = [[], [], [], { model: '', effort: null }, [bot], [bot.id], undefined, 0];
  render(HyperNewConversationSection, { context }, states); mountEffects(); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/models')).toBe(false);
  expect(find(render(HyperNewConversationSection, { context }), element => element.type === HyperComposer)!.props.modelPicker).toBeUndefined();
});
it('does not make an explicit model save for a new conversation using both defaults', async () => {
  const bot = { id: 'new-bot', name: 'Bot', title: '', runsOnOpenBotModel: true };
  f.request.mockImplementation(async (path: string) => path === '/api/models' ? hyperModelCatalogue : path === '/api/agents' ? { agents: [bot] } : { skills: [] });
  const start = vi.fn(async (_ids: string[], draft: any) => { if (draft.modelPick) throw new Error('Model choice disabled'); });
  const context = { initialAgentIds: [bot.id], startConversation: start, openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, [bot], [bot.id], undefined, 0]); mountEffects(); await drain();
  const composer = find(render(HyperNewConversationSection, { context }), element => element.type === HyperComposer)!;
  await expect(composer.props.onSubmit({ text: 'First message', attachments: [], commandIds: [] })).resolves.toBeUndefined();
  expect(start).toHaveBeenCalledWith([bot.id], { text: 'First message', files: [], commandIds: [], submit: true });
});
const hyperComposition = (tree: ReactNode) => find(tree, element => typeof element.key === 'string' && element.key.startsWith('hyper-new-conversation-'));
it('repeated native New conversation arrivals clear old recipients and receive a fresh composition key', () => {
  const props = { viewId: 'new-arrival', serviceReady: true };
  let tree = render(HyperOpenBotWorkspace, props, ['new-conversation', ['earlier-bot'], false, '', [], 'thread', 0, 0, undefined, [], undefined]);
  const earlier = hyperComposition(tree)?.key; button(tree, 'New conversation')!.props.onClick(); tree = render(HyperOpenBotWorkspace, props);
  const section = find(tree, element => 'path' in element.props && element.props.context?.initialDraftSupported)!;
  expect(section.props.context.initialAgentIds).toEqual([]); expect(hyperComposition(tree)?.key).not.toBe(earlier);
});
it('repeated native Bot start requests remount the new composition even for the same recipient', async () => {
  const props = { viewId: 'new-preselection', serviceReady: true };
  let tree = render(HyperOpenBotWorkspace, props, ['new-conversation', ['chosen-bot'], false, '', [], 'thread', 0, 0, undefined, [], undefined]);
  const earlier = hyperComposition(tree)?.key;
  const section = find(tree, element => 'path' in element.props && element.props.context?.initialDraftSupported)!;
  await section.props.context.startConversation(['chosen-bot']); tree = render(HyperOpenBotWorkspace, props);
  expect(hyperComposition(tree)?.key).not.toBe(earlier);
});
it('does not read or expose saved model choices when the native catalogue is not choosable', async () => {
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/agents/') ? { agent: { id: 'model-bot', runsOnOpenBotModel: true } } : path === '/api/models' ? { ...hyperModelCatalogue, choosable: false } : path.endsWith('/model') ? { model: null, effort: null } : { skills: [] });
  const chat = hyperModelTestChat(); const cleanup = chat.metadataEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/channels/model-channel/model')).toBe(false);
  expect(find(render(chat.component, chat.props), element => element.type === HyperComposer)!.props.modelPicker).toBeUndefined();
});
it('clears the Learning draft after an unchanged submitted snapshot succeeds', async () => {
  f.request.mockResolvedValue({}); const editor = hyperLearningTestEditor();
  find(render(editor.component, editor.props), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} }); await drain();
  expect(editor.states[7]).toBeUndefined();
});
it('keeps the current Learning draft and generic guidance after a failed save', async () => {
  f.request.mockRejectedValue(new Error('synthetic-save-failure')); const editor = hyperLearningTestEditor();
  find(render(editor.component, editor.props), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} }); await drain();
  expect(editor.states[7]).toBe(editor.settings);
  const tree = render(editor.component, editor.props);
  expect(find(tree, element => element.props.role === 'alert')).toBeDefined();
  expect(find(tree, element => text(element.props.children) === 'Save settings')!.props.disabled).toBe(false);
});
it.each(['unmount', 'Bot change'])('read-only access retry rejects a cached callback after $0', async change => {
  const props = { agentId: 'A', app: 'mail' }; f.request.mockRejectedValue(new Error('synthetic-read-failure'));
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const retry = button(render(HyperAppAccessAction, props), 'Retry access')!;
  if (change === 'unmount') { for (const cleanup of h.cleanups) cleanup(); h.cleanups = []; }
  else render(HyperAppAccessAction, { ...props, agentId: 'B' });
  retry.props.onClick(); await drain(); expect(f.request).toHaveBeenCalledOnce();
});
it.each([
  { name: 'check-in', component: HyperCheckInEditor, props: () => ({ setting: { id: 'check', subject: 'Check', focus: 'draft focus', intervalMinutes: 240 }, refresh: vi.fn() }) },
  { name: 'goal', component: HyperGoalEditor, props: () => ({ goal: { id: 'goal', title: 'Draft goal', instruction: 'Draft instruction', successCriteria: 'Done', endsWhenMet: true }, refresh: vi.fn() }) },
])('$name save failure unlocks the existing draft without refreshing it away', async editor => {
  f.request.mockRejectedValue(new Error('synthetic-save-failure')); const props = editor.props();
  const save = find(render(editor.component, props), element => element.props.label === 'Save changes')!;
  await expect(save.props.run()).rejects.toThrow('synthetic-save-failure'); await drain();
  expect(find(render(editor.component, props), element => element.type === 'fieldset')!.props.disabled).toBe(false);
  expect(props.refresh).not.toHaveBeenCalled();
});
it.each([
  { name: 'check-in', component: HyperCheckInEditor, props: () => ({ setting: { id: 'check', subject: 'Check', focus: 'draft focus', intervalMinutes: 60 }, refresh: vi.fn() }) },
  { name: 'goal', component: HyperGoalEditor, props: () => ({ goal: { id: 'goal', title: 'Draft goal', instruction: 'Draft instruction', successCriteria: 'Done', endsWhenMet: true }, refresh: vi.fn() }) },
])('$name save rejects duplicate submission and obsolete post-unmount refresh', async editor => {
  let finish!: (value: unknown) => void; f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const props = editor.props();
  render(editor.component, props); mountEffects(); const save = find(render(editor.component, props), element => element.props.label === 'Save changes')!;
  const pending = save.props.run(); await expect(save.props.run()).rejects.toThrow('already saving');
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = []; finish({}); await pending; save.props.done();
  expect(f.request).toHaveBeenCalledOnce(); expect(props.refresh).not.toHaveBeenCalled();
});
it('same-query routine retry keeps cached children in place while reloading', async () => {
  const props = { path: '/api/routines', field: 'routines', children: (rows: any[]) => <p data-testid="cached-routine">{rows[0].title}</p> };
  f.request.mockResolvedValueOnce({ routines: [{ title: 'Cached' }] }).mockRejectedValueOnce(new Error('synthetic-poll-failure')).mockImplementation(() => new Promise(() => {}));
  render(HyperRead, props); mountEffects(); await drain(); await vi.advanceTimersByTimeAsync(10000);
  let tree = render(HyperRead, props); button(tree, 'Retry')!.props.onClick();
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = []; render(HyperRead, props); mountEffects(); await drain(); tree = render(HyperRead, props);
  expect(find(tree, element => element.props['data-testid'] === 'cached-routine')).toBeDefined();
});
it('routine read scope hides another query immediately and rejects its late response', async () => {
  let old!: (value: unknown) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValue({ settings: [{ title: 'New query' }] });
  const props = (path: string) => ({ path, field: 'settings', children: (rows: any[]) => <p data-testid="query-title">{rows[0].title}</p> });
  render(HyperRead, props('/api/one')); mountEffects();
  expect(find(render(HyperRead, props('/api/two')), element => element.props['data-testid'] === 'query-title')).toBeUndefined(); mountEffects(); await drain();
  old({ settings: [{ title: 'Old query' }] }); await drain();
  expect(text(find(render(HyperRead, props('/api/two')), element => element.props['data-testid'] === 'query-title')!.props.children)).toBe('New query');
});
it.each([
  { model: 'openbot-model', effort: 'high', expected: { model: null, effort: 'high' } },
  { model: 'other-model', effort: 'high', expected: { model: 'other-model', effort: 'high' } },
])('new composition preserves an explicit choice as $expected', async test => {
  const bot = { id: 'new-bot', name: 'Bot', runsOnOpenBotModel: true, builtIn: false };
  const catalogue = { ...hyperModelCatalogue, models: [...hyperModelCatalogue.models, { id: 'other-model', label: 'Other', efforts: ['high'] }] };
  f.request.mockImplementation(async (path: string) => path === '/api/models' ? catalogue : path === '/api/agents' ? { agents: [bot] } : { skills: [] });
  const context = { initialAgentIds: [bot.id], startConversation: vi.fn(async () => {}), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, [bot], [bot.id], undefined, 0]); mountEffects(); await drain();
  const composer = find(render(HyperNewConversationSection, { context }), element => element.type === HyperComposer)!;
  composer.props.modelPicker.onChange({ model: test.model, effort: test.effort });
  await composer.props.onSubmit({ text: 'First', attachments: [], commandIds: [] });
  expect(context.startConversation).toHaveBeenCalledWith([bot.id], { text: 'First', files: [], commandIds: [], submit: true, modelPick: test.expected });
});
it('new composition keeps both defaults when catalogue choices are disabled', async () => {
  const bot = { id: 'new-bot', name: 'Bot', runsOnOpenBotModel: true };
  f.request.mockImplementation(async (path: string) => path === '/api/models' ? { ...hyperModelCatalogue, choosable: false } : path === '/api/agents' ? { agents: [bot] } : { skills: [] });
  const context = { initialAgentIds: [bot.id], startConversation: vi.fn(async () => {}), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, [bot], [bot.id], undefined, 0]); mountEffects(); await drain();
  const composer = find(render(HyperNewConversationSection, { context }), element => element.type === HyperComposer)!;
  expect(composer.props.modelPicker).toBeUndefined(); await composer.props.onSubmit({ text: 'First', attachments: [], commandIds: [] });
  expect(context.startConversation).toHaveBeenCalledWith([bot.id], { text: 'First', files: [], commandIds: [], submit: true });
});
it('new composition rejects a cached submit when its navigation is no longer current', async () => {
  let active = true;
  const bot = { id: 'new-bot', name: 'Bot', runsOnOpenBotModel: false };
  f.request.mockResolvedValue({ agents: [bot], skills: [] });
  const context = { initialAgentIds: [bot.id], isCurrentNavigation: () => active, startConversation: vi.fn(), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, [bot], [bot.id], undefined, 0]); mountEffects(); await drain();
  const composer = find(render(HyperNewConversationSection, { context }), element => element.type === HyperComposer)!;
  active = false; await expect(composer.props.onSubmit({ text: 'Old', attachments: [], commandIds: [] })).rejects.toThrow('setup changed');
  expect(context.startConversation).not.toHaveBeenCalled(); expect(f.request.mock.calls.some(call => call[0] === '/api/route')).toBe(false);
});
it('same-view native new-conversation navigation also resets its composition and preselection', () => {
  const props = { viewId: 'new-navigation', serviceReady: true };
  let tree = render(HyperOpenBotWorkspace, props, ['new-conversation', ['previous-bot'], false, '', [], 'thread', 0, 0, undefined, [], undefined]);
  const before = hyperComposition(tree)!.key, section = find(tree, element => 'path' in element.props && element.props.context?.initialDraftSupported)!;
  section.props.context.navigate('new-conversation'); tree = render(HyperOpenBotWorkspace, props);
  expect(hyperComposition(tree)!.key).not.toBe(before);
  expect(find(tree, element => 'path' in element.props && element.props.context?.initialDraftSupported)!.props.context.initialAgentIds).toEqual([]);
});
it('locks source-creation fields while the submitted source is being added', async () => {
  const resource = (path: string, key: string | undefined, data: unknown) => [data, '', false, 0, `${path}:${key ?? ''}`];
  const tab = HyperBotMemoryTab({ agentId: 'source-bot' }) as ReactElement<any>;
  const states = [...resource('/api/capabilities', undefined, { edition: 'team' }), ...resource('/api/memory/sources', 'sources', []),
    ...resource('/api/memory/sources/available/source-bot', 'tools', [{ ref: 'app/read', title: 'Read app', inputSchema: { properties: { limit: { type: 'integer' } } } }]), false, '', 'app/read', 'Source', { limit: '5' }];
  const component = tab.type as (props: any) => ReactNode;
  let finish!: (value: unknown) => void; f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const tree = render(component, tab.props, states); find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} }); await drain();
  try { expect(find(render(component, tab.props), element => element.type === 'fieldset')?.props.disabled).toBe(true); }
  finally { finish({}); await drain(); }
});
it('an explicit fresh composition does not reuse a retained failed channel for identical text and Bot', async () => {
  const tree = render(HyperOpenBotWorkspace, { viewId: 'fresh-transfer', serviceReady: true }, ['new-conversation', ['bot'], false, '', [], 'thread', 0, 0, undefined, [], undefined]);
  const transfer = h.states[13] as HyperInitialDraftTransfer<string>;
  const draft = { text: 'Hello', files: [], commandIds: [], submit: true };
  const create = vi.fn().mockResolvedValueOnce('first-channel').mockResolvedValueOnce('fresh-channel');
  const receive = vi.fn().mockRejectedValueOnce(new Error('initial send failed')).mockResolvedValueOnce(undefined), navigate = vi.fn();
  await expect(transfer.start(['bot'], draft, { create, receive, navigate })).rejects.toThrow('initial send failed');
  button(tree, 'New conversation')!.props.onClick();
  await transfer.start(['bot'], { ...draft }, { create, receive, navigate });
  expect(create).toHaveBeenCalledTimes(2);
  expect(receive.mock.calls.map(call => call[0])).toEqual(['first-channel', 'fresh-channel']);
  expect(navigate).toHaveBeenCalledWith('fresh-channel');
});
it.each([
  { path: '/routines/goals/goal-id', family: 'responsibilities', id: 'goal-id' },
  { path: '/routines/schedules/schedule-id', family: 'routines', id: 'schedule-id' },
  { path: '/routines/check-ins/check-id', family: 'proactive/settings', id: 'check-id' },
])('opens the pinned routine destination $path using its entity ID rather than the family segment', test => {
  const tree = render(HyperRoutinesSection, { path: test.path });
  const detail = find(tree, element => typeof element.props.family === 'string' && typeof element.props.id === 'string')!;
  expect(detail.props.family).toBe(test.family); expect(detail.props.id).toBe(test.id);
});
function hyperRuntimeTestChat() {
  const listeners = new Set<any>(); let connect!: () => void;
  const agent = { agentId: 'channel:model-channel', runtimeAgentId: 'model-bot', threadId: 'model-thread', messages: [] as any[], pendingInterrupts: [] as any[], isRunning: false,
    use: vi.fn(), detachActiveRun: vi.fn(), addMessage: (message: any) => agent.messages.push(message),
    subscribe: (listener: any) => { listeners.add(listener); return { unsubscribe: () => listeners.delete(listener) }; } };
  const core = { subscribe: () => ({ unsubscribe: vi.fn() }), connectAgent: vi.fn(() => new Promise<void>(resolve => { connect = resolve; })), runAgent: vi.fn(), stopAgent: vi.fn(async () => {}), addContext: vi.fn(() => 'context'), removeContext: vi.fn() };
  f.agent = agent; f.core = core;
  const chat = hyperModelTestChat();
  return { ...chat, agent, core, listeners, joinEffect: h.effects[3], finishConnect: () => connect() };
}
it.each(['channel busy', 'live roster hint'])('retains a delayed replay join when the server reports $0', async mode => {
  const chat = hyperRuntimeTestChat(); let working = mode === 'channel busy';
  const props = { ...chat.props, channel: { ...chat.props.channel, busy: mode === 'channel busy' }, ...(mode === 'live roster hint' ? { rosterSaysWorking: () => working } : {}) };
  render(chat.component, props); const cleanup = h.effects[3](); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void);
  await vi.advanceTimersByTimeAsync(3000); working = true; await vi.advanceTimersByTimeAsync(2000);
  expect(chat.agent.detachActiveRun).not.toHaveBeenCalled(); chat.finishConnect(); await drain();
});
it('does not publish partial stopped work as a successful delegated voice answer', async () => {
  const chat = hyperRuntimeTestChat(); let finish!: () => void;
  chat.core.runAgent.mockImplementation(() => {
    for (const listener of chat.listeners) listener.onRunInitialized?.({ input: { threadId: 'model-thread', runId: 'voice-run' }, messages: chat.agent.messages });
    return new Promise<void>(resolve => { finish = () => { chat.agent.messages.push({ id: 'voice-partial', role: 'assistant', content: 'Partial answer' }); resolve(); }; });
  });
  const tree = render(chat.component, chat.props), controls = find(tree, element => element.type === HyperVoiceControls)!;
  const answer = controls.props.askAgent('Work', new AbortController().signal); await drain();
  await find(tree, element => element.type === HyperComposer)!.props.onStop();
  const rejected = expect(answer).rejects.toThrow('stopped'); finish(); await rejected;
});
it('loads a permission-filtered absent preselected Bot before offering its recipient row and models', async () => {
  const bot = { id: 'hidden-bot', name: 'Hidden Bot', title: '', runsOnOpenBotModel: true, hidden: true };
  f.request.mockImplementation(async (path: string) => path === '/api/agents' ? { agents: [] } : path === '/api/agents/hidden-bot' ? { agent: bot } : path === '/api/models' ? hyperModelCatalogue : { skills: [] });
  const context = { initialAgentIds: [bot.id], startConversation: vi.fn(), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }); mountEffects(); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/agents/hidden-bot');
  let tree = render(HyperNewConversationSection, { context }); h.effects[1](); await drain(); tree = render(HyperNewConversationSection, { context });
  expect(find(tree, element => element.type === 'input' && element.props.type === 'checkbox' && element.props.checked)).toBeDefined();
  expect(find(tree, element => element.type === HyperComposer)!.props.modelPicker).toBeDefined();
});
it.each([
  { path: '/routines/legacy-id', selected: { family: 'routines', id: 'legacy-id' } },
  { path: '/responsibilities/goal-id', selected: { family: 'responsibilities', id: 'goal-id' } },
  { path: '/routines/goals/goal%2Fid?ignored=1#part', selected: { family: 'responsibilities', id: 'goal/id' } },
  { path: '/routines/check-ins/check%20id/', selected: { family: 'proactive/settings', id: 'check id' } },
])('retains compatible opaque-ID routine routing for $path', test => {
  expect(hyperRoutineSelectionFromPath(test.path).selected).toEqual(test.selected);
});
it('preserves the default overview and separates list/new/invalid routine paths from entity IDs', () => {
  expect(hyperRoutineSelectionFromPath('/routines')).toEqual({});
  expect(hyperRoutineSelectionFromPath('/routines/goals')).toEqual({ tab: 'goals' });
  expect(hyperRoutineSelectionFromPath('/routines/schedules')).toEqual({ tab: 'routines' });
  expect(hyperRoutineSelectionFromPath('/routines/check-ins')).toEqual({ tab: 'check-ins' });
  expect(hyperRoutineSelectionFromPath('/routines/new')).toEqual({ tab: 'new' });
  expect(hyperRoutineSelectionFromPath('/routines/goals/%broken').selected).toBeUndefined();
});
it.each(['refused', 'wrong ID'])('never offers or submits a preselected Bot detail that is $0', async mode => {
  f.request.mockImplementation(async (path: string) => {
    if (path === '/api/agents') return { agents: [] };
    if (path === '/api/agents/hidden-bot') { if (mode === 'refused') throw new Error('not shared'); return { agent: { id: 'other-bot', name: 'Other', runsOnOpenBotModel: true } }; }
    return { skills: [] };
  });
  const context = { initialAgentIds: ['hidden-bot'], startConversation: vi.fn(), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }); mountEffects(); await drain();
  const tree = render(HyperNewConversationSection, { context }), composer = find(tree, element => element.type === HyperComposer)!;
  expect(composer.props.disabled).toBe(false); expect(composer.props.submitDisabled).toBe(true); expect(composer.props.modelPicker).toBeUndefined();
  expect(find(tree, element => element.type === 'input' && element.props.type === 'checkbox')).toBeUndefined();
  await expect(composer.props.onSubmit({ text: 'Task', attachments: [], commandIds: [] })).rejects.toThrow('available Bot');
  expect(context.startConversation).not.toHaveBeenCalled(); expect(f.request.mock.calls.some(call => call[0] === '/api/models')).toBe(false);
});
it('does not append a hidden Bot detail after its composition unmounts', async () => {
  let finish!: (value: unknown) => void;
  f.request.mockImplementation(async (path: string) => path === '/api/agents' ? { agents: [] } : path === '/api/agents/hidden-bot' ? new Promise(resolve => { finish = resolve; }) : { skills: [] });
  const context = { initialAgentIds: ['hidden-bot'], startConversation: vi.fn(), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }); mountEffects(); await drain();
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  finish({ agent: { id: 'hidden-bot', name: 'Hidden', runsOnOpenBotModel: true } }); await drain();
  expect(h.states[4]).toEqual([]); expect(f.request.mock.calls.some(call => call[0] === '/api/models')).toBe(false);
});
it('uses the listed Bot without redundant detail lookup and keeps an external hidden Bot model-free', async () => {
  const visible = { id: 'visible', name: 'Visible', runsOnOpenBotModel: false }, hidden = { id: 'hidden', name: 'Hidden', runsOnOpenBotModel: false };
  f.request.mockImplementation(async (path: string) => path === '/api/agents' ? { agents: [visible] } : path === '/api/agents/hidden' ? { agent: hidden } : { skills: [] });
  const context = { initialAgentIds: ['visible', 'hidden'], startConversation: vi.fn(), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }); mountEffects(); await drain();
  const tree = render(HyperNewConversationSection, { context });
  expect(f.request.mock.calls.some(call => call[0] === '/api/agents/visible')).toBe(false);
  expect(h.states[4].map((bot: any) => bot.id)).toEqual(['visible', 'hidden']);
  expect(find(tree, element => element.type === HyperComposer)!.props.modelPicker).toBeUndefined();
});
it('still releases an idle unconfirmed join at the normal deadline', async () => {
  const chat = hyperRuntimeTestChat(); const cleanup = chat.joinEffect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void);
  await vi.advanceTimersByTimeAsync(5000); expect(chat.agent.detachActiveRun).toHaveBeenCalledOnce(); chat.finishConnect(); await drain();
});
it('returns a successful delegated voice answer when no Stop occurred', async () => {
  const chat = hyperRuntimeTestChat();
  chat.core.runAgent.mockImplementation(async () => {
    for (const listener of chat.listeners) listener.onRunInitialized?.({ input: { threadId: 'model-thread', runId: 'voice-success' }, messages: chat.agent.messages });
    chat.agent.messages.push({ id: 'voice-complete', role: 'assistant', content: 'Complete answer' });
  });
  const controls = find(render(chat.component, chat.props), element => element.type === HyperVoiceControls)!;
  await expect(controls.props.askAgent('Do the task', new AbortController().signal)).resolves.toBe('Complete answer');
});
const hyperReachabilityData = {
  delivery: { bindings: [], devices: [], deliveries: [], available: { sms: true, slack: false, teams: false } },
  channels: [{ id: 'channel-a', name: 'A', active: true, agentIds: ['bot-a', 'bot-b'] }, { id: 'channel-b', name: 'B', active: true, agentIds: ['bot-a', 'bot-b'] }],
  bots: [{ id: 'bot-a', name: 'A' }, { id: 'bot-b', name: 'B' }],
};
const hyperReachabilityStates = () => [hyperReachabilityData, false, '', 0, 'channel-a', '+15555550123', '123456', undefined, 'bot-a', '', {}];
function hyperReachabilitySelect(tree: ReactNode, label: string, value: string) {
  const field = find(tree, element => element.type === 'label' && text(element.props.children) === label)!;
  find(field, element => element.type === 'select')!.props.onChange({ target: { value } });
}
const hyperSmsForm = (tree: ReactNode, confirmation = false) => find(tree, element => element.type === 'form' && !!find(element.props.children, input => confirmation ? input.props.autoComplete === 'one-time-code' : input.props.type === 'tel'));
it.each(['Conversation', 'Bot'])('Reaching you invalidates issued SMS confirmation after changing $0', async field => {
  f.request.mockResolvedValue({ challengeId: 'challenge-a' });
  let tree = render(HyperReachability, {}, hyperReachabilityStates()); hyperSmsForm(tree)!.props.onSubmit({ preventDefault() {} }); await drain();
  tree = render(HyperReachability, {}); const oldConfirm = hyperSmsForm(tree, true)!;
  hyperReachabilitySelect(tree, field, field === 'Conversation' ? 'channel-b' : 'bot-b'); tree = render(HyperReachability, {});
  expect(hyperSmsForm(tree, true)).toBeUndefined(); oldConfirm.props.onSubmit({ preventDefault() {} }); await drain();
  expect(f.request.mock.calls.some(call => String(call[0]).includes('/sms/confirm'))).toBe(false);
});
it('Reaching you rejects a late previous-destination SMS response without clearing newer phone input', async () => {
  let finish!: (value: unknown) => void; f.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let tree = render(HyperReachability, {}, hyperReachabilityStates()); hyperSmsForm(tree)!.props.onSubmit({ preventDefault() {} }); await drain();
  hyperReachabilitySelect(render(HyperReachability, {}), 'Conversation', 'channel-b'); tree = render(HyperReachability, {});
  hyperReachabilitySelect(tree, 'Bot', 'bot-b'); tree = render(HyperReachability, {});
  find(tree, element => element.props.type === 'tel')!.props.onChange({ target: { value: '+15555550999' } });
  finish({ challengeId: 'old-challenge' }); await drain(); tree = render(HyperReachability, {});
  expect(hyperSmsForm(tree, true)).toBeUndefined(); expect(find(tree, element => element.props.type === 'tel')!.props.value).toBe('+15555550999');
});
it('lets a new composition accept writing before a Bot is chosen while keeping submission blocked', () => {
  const context = { initialAgentIds: [], startConversation: vi.fn(), openConversation: vi.fn() };
  const tree = render(HyperNewConversationSection, { context });
  const composer = find(tree, element => element.type === HyperComposer)!;
  expect(composer.props.disabled).toBe(false); expect(composer.props.submitDisabled).toBe(true);
});
it('clips only the routing opening without splitting a surrogate pair or clipping the first message', async () => {
  const bot = { id: 'route-bot', name: 'Bot', runsOnOpenBotModel: false }, full = 'x'.repeat(9999) + '😀' + 'trailing message';
  f.request.mockResolvedValue({ agents: [bot], skills: [] });
  const context = { initialAgentIds: [bot.id], startConversation: vi.fn(async () => {}), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, [bot], [bot.id], undefined, 0]); mountEffects(); await drain();
  const composer = find(render(HyperNewConversationSection, { context }), element => element.type === HyperComposer)!;
  await composer.props.onSubmit({ text: full, attachments: [], commandIds: [] });
  expect(f.request.mock.calls.find(call => call[0] === '/api/route')?.[2].text === 'x'.repeat(9999)).toBe(true);
  expect(context.startConversation).toHaveBeenCalledWith([bot.id], { text: full, files: [], commandIds: [], submit: true });
});
it.each(['reconnect', 'shared'])('overrides stale recorded readiness for a %s refusal and offers the appropriate setup', async refusal => {
  const access = { ...botAppAccess('bot', 'app').app, state: 'ready', connectedAt: '2026-11-15T00:00:00Z', request: null, requestKind: null };
  f.request.mockResolvedValue({ app: access }); const props = { agentId: 'bot', app: 'app', refusal, refusalAt: '2026-11-15T01:00:00Z', admin: true, onOpenConnection: vi.fn() };
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  expect(find(tree, element => element.type === 'p' && text(element.props.children).toLowerCase().includes('reconnect'))).toBeDefined();
  expect(button(tree, 'Open app setup and connection')).toBeDefined();
});
it('passes the refusal instant from the authenticated tool marker into its app-access card', () => {
  const at = '2026-11-15T01:00:00Z';
  const tool = { id: 'refusal-time', label: 'app/read', status: 'refused', result: '[connect-app]' + JSON.stringify({ serverId: 'app', agentId: 'bot', title: 'App', message: 'Connection lost', reason: 'reconnect', at }) };
  const tree = render(HyperConversationResult, { tool, callingBotId: 'bot' });
  expect(find(tree, element => element.type === HyperAppAccessAction)!.props.refusalAt).toBe(at);
});
function hyperGrantTestProps(selection: any = { page: 'bot', key: 'server', agentId: 'bot-a' }) {
  return { server, busy: false, admin: true, selection, navigate: vi.fn(), run: async (action: () => Promise<void>) => action() };
}
const hyperGrantStates = () => [bots, '', '', undefined, approval, false, [], [], true, {}, ''];
it('a shared grant read cannot resume after navigating A to B and back to A', async () => {
  let finish!: (value: unknown) => void;
  f.request.mockImplementation(async (path: string) => path === '/api/approvals/shared-use/bot/bot-a' ? new Promise(resolve => { finish = resolve; }) : {});
  const props = hyperGrantTestProps(); const tree = render(HyperPluginGrants, props, hyperGrantStates());
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await drain();
  render(HyperPluginGrants, { ...props, selection: { ...props.selection, agentId: 'bot-b' } }); render(HyperPluginGrants, props);
  finish({ apps: [{ serverId: 'server', needed: approval, approval, covered: true }] }); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
});
it('canceling a shared approval invalidates its cached confirmation before HTTP', async () => {
  f.request.mockResolvedValue({ apps: [{ serverId: 'server', needed: approval, approval: null, covered: false }] });
  const props = hyperGrantTestProps(); let tree = render(HyperPluginGrants, props, hyperGrantStates());
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await drain(); tree = render(HyperPluginGrants, props);
  const dialog = find(tree, element => element.props['aria-label'] === 'Approve shared app access')!, confirm = button(dialog, 'Approve and grant')!;
  button(dialog, 'Cancel')!.props.onClick(); render(HyperPluginGrants, props); confirm.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
});
it('shared read-bulk loads its Bot server-proposed membership before confirmation', async () => {
  const needed = { audience: 'people', outsideInput: true, members: [{ kind: 'user', value: 'member-a' }] };
  f.request.mockResolvedValue({ apps: [{ serverId: 'server', needed, approval: null, covered: false }] });
  const props = hyperGrantTestProps(); const tree = render(HyperPluginGrants, props, hyperGrantStates());
  find(tree, element => typeof element.props.onClick === 'function' && text(element.props.children).startsWith('Grant every read-only action'))!.props.onClick(); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/approvals/shared-use/bot/bot-a');
  const dialog = find(render(HyperPluginGrants, props), element => element.props['aria-label'] === 'Approve shared app access')!;
  expect(find(dialog, element => element.type === HyperSharedApprovalFields)!.props.value).toEqual(needed);
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
});
it('shared batches review and submit the distinct server-proposed members of each Bot', async () => {
  const needed = (bot: string) => ({ audience: 'people', outsideInput: false, members: [{ kind: 'user', value: `member-${bot}` }] });
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/approvals/shared-use/bot/') ? { apps: [{ serverId: 'server', needed: needed(path.endsWith('bot-a') ? 'a' : 'b'), approval: null, covered: false }] } : {});
  const props = hyperGrantTestProps({ page: 'app', key: 'server' }); let tree = render(HyperPluginGrants, props, hyperGrantStates());
  button(tree, 'Choose Bots and tools in a batch')!.props.onClick(); tree = render(HyperPluginGrants, props);
  for (const name of ['A', 'B']) {
    const label = find(tree, element => element.type === 'label' && text(element.props.children) === name)!;
    find(label, element => element.type === 'input')!.props.onChange({ target: { checked: true } }); tree = render(HyperPluginGrants, props);
  }
  const tool = find(tree, element => element.type === 'label' && text(element.props.children).includes('read') && !!find(element.props.children, input => input.type === 'input'))!;
  find(tool, element => element.type === 'input')!.props.onChange({ target: { checked: true } }); tree = render(HyperPluginGrants, props);
  (button(tree, 'Review shared audiences') ?? button(tree, 'Confirm grant batch'))!.props.onClick(); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/approvals/shared-use/bot/bot-a'); expect(f.request).toHaveBeenCalledWith('/api/approvals/shared-use/bot/bot-b');
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
  tree = render(HyperPluginGrants, props); button(tree, 'Confirm grant batch')!.props.onClick(); await drain();
  expect(f.request.mock.calls.filter(call => call[0] === '/api/plugins/grants').map(call => [call[2].agentId, call[2].approval])).toEqual([['bot-a', needed('a')], ['bot-b', needed('b')]]);
});
it('the composer retains editable text while submission alone is disabled', () => {
  const submit = vi.fn();
  let tree = render(HyperComposer, { submitDisabled: true, onSubmit: submit, initialValue: 'Draft first' });
  const input = find(tree, element => element.props['data-slot'] === 'composer-input')!;
  expect(input.props.disabled).toBe(false); input.props.onChange({ target: { value: 'Draft without a recipient' } });
  tree = render(HyperComposer, { submitDisabled: true, onSubmit: submit });
  find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  expect(submit).not.toHaveBeenCalled(); expect(find(tree, element => element.props['data-slot'] === 'composer-input')!.props.value).toBe('Draft without a recipient');
  tree = render(HyperComposer, { submitDisabled: false, onSubmit: submit });
  find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} }); expect(submit).toHaveBeenCalledOnce();
});
it.each(['reconnect', 'shared'])('returns to live readiness after reconnecting since a %s refusal', async refusal => {
  f.request.mockResolvedValue({ app: { ...botAppAccess('bot', 'app').app, state: 'ready', request: null, requestKind: null, connectedAt: '2026-11-15T01:00:01Z' } });
  const props = { agentId: 'bot', app: 'app', refusal, refusalAt: '2026-11-15T01:00:00Z', onOpenConnection: vi.fn() };
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  expect(button(tree, 'Open app setup and connection')).toBeUndefined();
  expect(find(tree, element => element.type === 'p' && text(element.props.children).includes('Ready'))).toBeDefined();
});
it('never offers another user setup for an owner-held reconnect refusal', async () => {
  f.request.mockResolvedValue({ app: { ...botAppAccess('bot', 'app').app, state: 'ready', request: null, requestKind: null, accountHolder: 'owner', connectedAt: null } });
  const props = { agentId: 'bot', app: 'app', refusal: 'reconnect', onOpenConnection: vi.fn() };
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  expect(button(tree, 'Open app setup and connection')).toBeUndefined(); expect(find(tree, element => element.type === 'p' && text(element.props.children).includes('Bot owner'))).toBeDefined();
});
it('connect refusals do not override a live ready state', async () => {
  f.request.mockResolvedValue({ app: { ...botAppAccess('bot', 'app').app, state: 'ready', request: null, requestKind: null } });
  const props = { agentId: 'bot', app: 'app', refusal: 'connect', onOpenConnection: vi.fn() };
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  expect(button(tree, 'Open app setup and connection')).toBeUndefined(); expect(find(tree, element => element.type === 'p' && text(element.props.children).includes('Ready'))).toBeDefined();
});
it('refusal setup navigates to the named app without using stale navigation callbacks', () => {
  let current = true; const navigate = vi.fn(); h.context = { navigate, isCurrentNavigation: () => current };
  const tool = { id: 'refusal-navigation', label: 'app/read', status: 'refused', result: '[connect-app]' + JSON.stringify({ serverId: 'app', agentId: 'bot', title: 'App', message: 'Lost', reason: 'reconnect', at: '2026-11-15T01:00:00Z' }) };
  const tree = render(HyperConversationResult, { tool, callingBotId: 'bot' }), card = find(tree, element => element.type === HyperAppAccessAction)!;
  card.props.onOpenConnection('app/key'); expect(navigate).toHaveBeenCalledWith('connections', { path: '/connections/app%2Fkey' });
  current = false; card.props.onOpenConnection('other'); expect(navigate).toHaveBeenCalledOnce();
});
it('uses a current server proposal instead of narrower old approval for single shared grants', async () => {
  const needed = { audience: 'people', outsideInput: true, members: [{ kind: 'group', value: 'new-members' }] };
  f.request.mockResolvedValue({ apps: [{ serverId: 'server', approval, needed, covered: false }] });
  const props = hyperGrantTestProps(); let tree = render(HyperPluginGrants, props, hyperGrantStates());
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await drain(); tree = render(HyperPluginGrants, props);
  const dialog = find(tree, element => element.props['aria-label'] === 'Approve shared app access')!;
  expect(find(dialog, element => element.type === HyperSharedApprovalFields)!.props.value).toEqual(needed);
  button(dialog, 'Approve and grant')!.props.onClick(); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/plugins/grants', 'POST', { kind: 'mcp', ref: 'server/read', agentId: 'bot-a', approval: needed });
});
it('requires explicit server-resolved confirmation for an unheld shared read-bulk app', async () => {
  f.request.mockResolvedValue({ apps: [] }); const props = hyperGrantTestProps(); const tree = render(HyperPluginGrants, props, hyperGrantStates());
  find(tree, element => typeof element.props.onClick === 'function' && text(element.props.children).startsWith('Grant every read-only action'))!.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
  const dialog = find(render(HyperPluginGrants, props), element => element.props['aria-label'] === 'Approve shared app access')!;
  expect(dialog).toBeDefined(); expect(find(dialog, element => element.type === HyperSharedApprovalFields)).toBeUndefined();
});
it('Reaching you keeps current SMS confirmation usable and sends only its issued challenge', async () => {
  f.request.mockImplementation(async (path: string) => path === '/api/delivery' ? hyperReachabilityData.delivery : path === '/api/channels' ? { channels: hyperReachabilityData.channels } : path === '/api/agents' ? { agents: hyperReachabilityData.bots } : path === '/api/delivery/sms/start' ? { challengeId: 'current-challenge' } : {});
  render(HyperReachability, {}, hyperReachabilityStates()); mountEffects(); await drain();
  hyperSmsForm(render(HyperReachability, {}))!.props.onSubmit({ preventDefault() {} }); await drain();
  render(HyperReachability, {}); const cleanup = h.effects[0](); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); await drain();
  let tree = render(HyperReachability, {});
  find(tree, element => element.props.autoComplete === 'one-time-code')!.props.onChange({ target: { value: '654321' } });
  tree = render(HyperReachability, {}); hyperSmsForm(tree, true)!.props.onSubmit({ preventDefault() {} }); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/delivery/sms/confirm', 'POST', { challengeId: 'current-challenge', code: '654321' });
});
it('Reaching you rejects a cached SMS confirm after unmount', async () => {
  f.request.mockImplementation(async (path: string) => path === '/api/delivery' ? hyperReachabilityData.delivery : path === '/api/channels' ? { channels: hyperReachabilityData.channels } : path === '/api/agents' ? { agents: hyperReachabilityData.bots } : { challengeId: 'current-challenge' });
  render(HyperReachability, {}, hyperReachabilityStates()); mountEffects(); await drain();
  hyperSmsForm(render(HyperReachability, {}))!.props.onSubmit({ preventDefault() {} }); await drain();
  const confirm = hyperSmsForm(render(HyperReachability, {}), true)!;
  for (const cleanup of h.cleanups) cleanup(); h.cleanups = [];
  confirm.props.onSubmit({ preventDefault() {} }); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/delivery/sms/confirm')).toBe(false);
});
it('Reaching you does not revive a confirmation after A to B to A', async () => {
  f.request.mockResolvedValue({ challengeId: 'challenge-a' });
  let tree = render(HyperReachability, {}, hyperReachabilityStates()); hyperSmsForm(tree)!.props.onSubmit({ preventDefault() {} }); await drain();
  tree = render(HyperReachability, {}); const old = hyperSmsForm(tree, true)!;
  hyperReachabilitySelect(tree, 'Conversation', 'channel-b'); tree = render(HyperReachability, {});
  hyperReachabilitySelect(tree, 'Conversation', 'channel-a'); tree = render(HyperReachability, {});
  hyperReachabilitySelect(tree, 'Bot', 'bot-a'); tree = render(HyperReachability, {});
  expect(hyperSmsForm(tree, true)).toBeUndefined(); old.props.onSubmit({ preventDefault() {} }); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/delivery/sms/confirm')).toBe(false);
});
it('canceling shared read-bulk during a write stops later writes without reverting accepted ones', async () => {
  let first!: (value: unknown) => void;
  const doubled = { ...server, tools: [...server.tools, { ...server.tools[0], name: 'second', ref: 'server/second' }] };
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/approvals/shared-use/') ? { apps: [{ serverId: 'server', needed: approval, covered: false }] } : path === '/api/plugins/grants' ? new Promise(resolve => { first = resolve; }) : {});
  const props = { ...hyperGrantTestProps(), server: doubled }; let tree = render(HyperPluginGrants, props, hyperGrantStates());
  find(tree, element => typeof element.props.onClick === 'function' && text(element.props.children).startsWith('Grant every read-only action'))!.props.onClick(); await drain(); tree = render(HyperPluginGrants, props);
  let dialog = find(tree, element => element.props['aria-label'] === 'Approve shared app access')!; button(dialog, 'Approve and grant')!.props.onClick(); await drain();
  dialog = find(render(HyperPluginGrants, props), element => element.props['aria-label'] === 'Approve shared app access')!; button(dialog, 'Cancel')!.props.onClick(); first({}); await drain();
  expect(f.request.mock.calls.filter(call => call[0] === '/api/plugins/grants')).toHaveLength(1);
  expect(f.request.mock.calls.some(call => call[1] === 'DELETE')).toBe(false);
});
it.each(['2026-11-15T01:00:00Z', 'invalid-instant'])('does not infer reconnection from an equal or invalid timestamp %s', async connectedAt => {
  f.request.mockResolvedValue({ app: { ...botAppAccess('bot', 'app').app, state: 'ready', request: null, requestKind: null, connectedAt } });
  const props = { agentId: 'bot', app: 'app', refusal: 'reconnect', refusalAt: '2026-11-15T01:00:00Z', onOpenConnection: vi.fn() };
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  expect(button(tree, 'Open app setup and connection')).toBeDefined();
});
it.each(['single', 'read-bulk', 'batch'])('supports a first shared-app %s grant without fabricating membership', async mode => {
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/approvals/shared-use/') ? { apps: [] } : {});
  const props = hyperGrantTestProps(); let tree = render(HyperPluginGrants, props, hyperGrantStates());
  if (mode === 'single') find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } });
  else if (mode === 'read-bulk') find(tree, element => typeof element.props.onClick === 'function' && text(element.props.children).startsWith('Grant every read-only action'))!.props.onClick();
  else {
    button(tree, 'Choose Bots and tools in a batch')!.props.onClick(); tree = render(HyperPluginGrants, props);
    const label = find(tree, element => element.type === 'label' && text(element.props.children) === 'A')!;
    find(label, element => element.type === 'input')!.props.onChange({ target: { checked: true } }); tree = render(HyperPluginGrants, props);
    const tool = find(tree, element => element.type === 'label' && text(element.props.children).includes('read') && !!find(element.props.children, input => input.type === 'input'))!;
    find(tool, element => element.type === 'input')!.props.onChange({ target: { checked: true } }); tree = render(HyperPluginGrants, props); button(tree, 'Review shared audiences')!.props.onClick();
  }
  await drain(); tree = render(HyperPluginGrants, props);
  expect(find(tree, element => element.type === 'p' && text(element.props.children).includes('server'))).toBeDefined();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
  const confirm = mode === 'batch' ? button(tree, 'Confirm grant batch') : button(tree, 'Approve and grant'); expect(confirm).toBeDefined();
  confirm!.props.onClick(); await drain();
  expect(f.request).toHaveBeenCalledWith('/api/plugins/grants', 'POST', { kind: 'mcp', ref: 'server/read', agentId: 'bot-a' });
});
it('new first-group messages can address one selected Bot', async () => {
  const groupBots = [{ id: 'bot-a', name: 'A' }, { id: 'bot-b', name: 'B' }];
  f.request.mockResolvedValue({ agents: groupBots, skills: [] });
  const context = { initialAgentIds: ['bot-a', 'bot-b'], startConversation: vi.fn(async () => {}), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, groupBots, ['bot-a', 'bot-b'], undefined, 0]); mountEffects(); await drain();
  const composer = find(render(HyperNewConversationSection, { context }), element => element.type === HyperComposer)!;
  expect(composer.props.agents).toEqual(groupBots);
  await composer.props.onSubmit({ text: 'Targeted message', agentId: 'bot-b', attachments: [], commandIds: [] });
  expect(context.startConversation).toHaveBeenCalledWith(['bot-a', 'bot-b'], { text: 'Targeted message', agentId: 'bot-b', files: [], commandIds: [], submit: true });
});
it('native first-group delivery retains the explicitly addressed Bot', async () => {
  const tree = render(HyperOpenBotWorkspace, { viewId: 'addressed-first-group', serviceReady: true }); const context = (tree as ReactElement<any>).props.context;
  const transfer = h.states[13] as HyperInitialDraftTransfer<any>;
  vi.spyOn(transfer, 'start').mockImplementation(async (_ids, initial, deps) => { await deps.receive({ id: 'new-group', agentIds: ['bot-a', 'bot-b'] }, initial!, new AbortController().signal, new Map()); });
  f.request.mockResolvedValue({});
  await context.startConversation(['bot-a', 'bot-b'], { text: 'Targeted', agentId: 'bot-b', files: [], commandIds: [], submit: true });
  expect(f.request).toHaveBeenCalledWith('/api/groups/new-group', 'POST', { id: expect.any(String), text: 'Targeted', agentId: 'bot-b' });
});
it('inline Bot creation appends its result without navigating away or discarding held files', () => {
  const file = new File(['body'], 'held.txt'), attachment = { id: 'held-file', name: file.name, status: 'ready' };
  const context = { initialAgentIds: ['bot-a'], startConversation: vi.fn(), openConversation: vi.fn(), navigate: vi.fn() };
  let tree = render(HyperNewConversationSection, { context }, [[], [{ file, attachment }], [], { model: '', effort: null }, [{ id: 'bot-a', name: 'A' }], ['bot-a'], undefined, 0]);
  button(tree, 'Create a Bot')!.props.onClick(); tree = render(HyperNewConversationSection, { context });
  const editor = find(tree, element => element.type === HyperBotEditor); expect(editor).toBeDefined(); expect(context.navigate).not.toHaveBeenCalled();
  editor!.props.onSaved({ id: 'created-bot', name: 'Created' }); tree = render(HyperNewConversationSection, { context });
  expect(h.states[5]).toEqual(['bot-a', 'created-bot']); expect(h.states[1][0].file).toBe(file);
  expect(find(tree, element => element.type === HyperComposer)!.props.attachments).toEqual([attachment]);
});
it('renders the app card for the pinned Refused prefix before its connect marker', () => {
  const tool = { id: 'prefixed-refusal', label: 'app/read', status: 'refused', result: 'Refused. [connect-app]' + JSON.stringify({ serverId: 'app', agentId: 'bot', title: 'App', message: 'Lost', reason: 'reconnect', at: '2026-11-15T01:00:00Z' }) };
  const tree = render(HyperConversationResult, { tool, callingBotId: 'bot' });
  expect(find(tree, element => element.type === HyperAppAccessAction)).toBeDefined();
});
it('conversation app cards derive direct administrator actions from the authenticated actor', async () => {
  const tool = { id: 'admin-card', label: 'show_app_access', status: 'complete', result: '[connect-app]' + JSON.stringify({ serverId: 'app', agentId: 'bot', title: 'App', message: 'Access', reason: 'access' }) };
  const card = find(render(HyperConversationResult, { tool, callingBotId: 'bot' }), element => element.type === HyperAppAccessAction)!;
  expect(card.props.deriveAdmin).toBe(true);
  h.states = []; h.refs = [];
  f.request.mockImplementation(async (path: string) => path === '/api/me' ? { user: { id: 'actor', role: 'admin' } } : { app: { ...botAppAccess('bot', 'app').app, state: 'not_granted', request: null } });
  render(HyperAppAccessAction, card.props); mountEffects(); await drain(); render(HyperAppAccessAction, card.props); const reload = h.effects[0](); if (typeof reload === 'function') h.cleanups.push(reload as () => void); await drain();
  const tree = render(HyperAppAccessAction, card.props);
  expect(button(tree, 'Enable and grant read-only access')).toBeDefined(); expect(button(tree, 'Request access')).toBeUndefined();
});
it('shared grant exposure read failure still refuses writes instead of guessing membership', async () => {
  f.request.mockRejectedValue(new Error('exposure unavailable')); const props = hyperGrantTestProps();
  const tree = render(HyperPluginGrants, props, hyperGrantStates());
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
  expect(find(render(HyperPluginGrants, props), element => element.props.role === 'alert')).toBeDefined();
});
it('canceling a server-resolved first grant rejects its cached confirm', async () => {
  f.request.mockResolvedValue({ apps: [] }); const props = hyperGrantTestProps(); let tree = render(HyperPluginGrants, props, hyperGrantStates());
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await drain(); tree = render(HyperPluginGrants, props);
  const dialog = find(tree, element => element.props['aria-label'] === 'Approve shared app access')!, confirm = button(dialog, 'Approve and grant')!;
  button(dialog, 'Cancel')!.props.onClick(); render(HyperPluginGrants, props); confirm.props.onClick(); await drain();
  expect(f.request.mock.calls.some(call => call[0] === '/api/plugins/grants')).toBe(false);
});
it('a first-group draft cannot address an unselected Bot', async () => {
  const groupBots = [{ id: 'bot-a', name: 'A' }, { id: 'bot-b', name: 'B' }]; f.request.mockResolvedValue({ agents: groupBots, skills: [] });
  const context = { initialAgentIds: ['bot-a', 'bot-b'], startConversation: vi.fn(), openConversation: vi.fn() };
  render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, groupBots, ['bot-a', 'bot-b'], undefined, 0]); mountEffects(); await drain();
  const composer = find(render(HyperNewConversationSection, { context }), element => element.type === HyperComposer)!;
  await expect(composer.props.onSubmit({ text: 'Targeted', agentId: 'other', attachments: [], commandIds: [] })).rejects.toThrow('selected');
  expect(context.startConversation).not.toHaveBeenCalled();
});
it('unaddressed first-group delivery still uses the default recipient', async () => {
  const tree = render(HyperOpenBotWorkspace, { viewId: 'default-first-group', serviceReady: true }), context = (tree as ReactElement<any>).props.context;
  vi.spyOn(h.states[13] as HyperInitialDraftTransfer<any>, 'start').mockImplementation(async (_ids, initial, deps) => { await deps.receive({ id: 'default-group', agentIds: ['a', 'b'] }, initial!, new AbortController().signal, new Map()); });
  f.request.mockResolvedValue({}); await context.startConversation(['a', 'b'], { text: 'For everyone', files: [], commandIds: [], submit: true });
  expect(f.request).toHaveBeenCalledWith('/api/groups/default-group', 'POST', { id: expect.any(String), text: 'For everyone', agentId: null });
});
it('canceling inline creation invalidates its old completion without dropping the draft', () => {
  const context = { startConversation: vi.fn(), openConversation: vi.fn() };
  let tree = render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, [], [], undefined, 0]); button(tree, 'Create a Bot')!.props.onClick(); tree = render(HyperNewConversationSection, { context });
  const editor = find(tree, element => element.type === HyperBotEditor)!;
  editor.props.onClose(); render(HyperNewConversationSection, { context }); editor.props.onSaved({ id: 'late', name: 'Late' });
  expect(h.states[5]).toEqual([]); expect(h.states[4]).toEqual([]);
});
it('a late inline creation result cannot enter an abandoned navigation', () => {
  let active = true; const context = { startConversation: vi.fn(), openConversation: vi.fn(), isCurrentNavigation: () => active };
  let tree = render(HyperNewConversationSection, { context }, [[], [], [], { model: '', effort: null }, [], [], undefined, 0]); button(tree, 'Create a Bot')!.props.onClick(); tree = render(HyperNewConversationSection, { context });
  const editor = find(tree, element => element.type === HyperBotEditor)!; active = false; editor.props.onSaved({ id: 'late', name: 'Late' });
  expect(h.states[5]).toEqual([]); expect(h.states[4]).toEqual([]);
});
it('complete app-access markers are not extracted from unrelated prefixed result text', () => {
  const tool = { id: 'not-refused', label: 'show_app_access', status: 'complete', result: 'Refused. [connect-app]' + JSON.stringify({ serverId: 'app', title: 'App', message: 'Lost', reason: 'reconnect' }) };
  expect(find(render(HyperConversationResult, { tool, callingBotId: 'bot' }), element => element.type === HyperAppAccessAction)).toBeUndefined();
});
it('a refusal marker for another calling Bot never mounts the access card', () => {
  const tool = { id: 'foreign-refusal', label: 'app/read', status: 'refused', result: 'Refused. [connect-app]' + JSON.stringify({ serverId: 'app', agentId: 'other', title: 'App', message: 'Lost', reason: 'reconnect' }) };
  expect(find(render(HyperConversationResult, { tool, callingBotId: 'bot' }), element => element.type === HyperAppAccessAction)).toBeUndefined();
});
it('authenticated members still get Request access rather than direct approval', async () => {
  f.request.mockImplementation(async (path: string) => path === '/api/me' ? { user: { role: 'member' } } : { app: { ...botAppAccess('bot', 'app').app, state: 'not_granted', request: null, requestKind: 'grant' } });
  const props = { agentId: 'bot', app: 'app', deriveAdmin: true };
  render(HyperAppAccessAction, props); mountEffects(); await drain(); const tree = render(HyperAppAccessAction, props);
  expect(button(tree, 'Request access')).toBeDefined(); expect(button(tree, 'Enable and grant read-only access')).toBeUndefined();
});
it('actor read failure does not infer administrator privilege', async () => {
  f.request.mockImplementation(async (path: string) => { if (path === '/api/me') throw new Error('actor unavailable'); return { app: { ...botAppAccess('bot', 'app').app, state: 'not_granted', request: null, requestKind: 'grant' } }; });
  const props = { agentId: 'bot', app: 'app', deriveAdmin: true };
  render(HyperAppAccessAction, props); mountEffects(); await drain();
  expect(button(render(HyperAppAccessAction, props), 'Enable and grant read-only access')).toBeUndefined();
});
