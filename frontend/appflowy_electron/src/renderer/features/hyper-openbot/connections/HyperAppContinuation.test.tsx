import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { HyperOpenBotWorkspace } from '../HyperOpenBotPage';
import { HyperTranscript } from '../transcript';
import { HyperComposer } from '../composer';
import { HyperConversationActions } from '../HyperConversationActions';
import { HyperConversationResult } from '../screens-gen/HyperConversationResult';
import { HyperAppAccessAction } from './HyperAppAccessAction';
import { hyperAcquireConversationDraft } from '../useHyperConversationDraft';

const h = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], effects: [] as (() => unknown)[], cleanups: [] as (() => void)[], s: 0, r: 0 }));
const f = vi.hoisted(() => ({ request: vi.fn(), agent: undefined as any, core: undefined as any, working: false, identityListener: undefined as undefined | ((state: any) => void) }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useState: (initial: any) => { const i = h.s++; if (!(i in h.states)) h.states[i] = typeof initial === 'function' ? initial() : initial; return [h.states[i], (next: any) => { h.states[i] = typeof next === 'function' ? next(h.states[i]) : next; }]; },
    useRef: (initial: any) => { const i = h.r++; return h.refs[i] ?? (h.refs[i] = { current: initial }); },
    useEffect: (effect: () => unknown) => { h.effects.push(effect); }, useLayoutEffect: (effect: () => unknown) => { h.effects.push(effect); },
    useMemo: (create: () => unknown) => create(), useCallback: (callback: any) => callback, useContext: () => undefined,
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  };
});
vi.mock('../transport', async original => ({ ...await original<typeof import('../transport')>(), hyperOpenBotRequest: f.request }));
vi.mock('@copilotkit/react-core/v2', () => ({ useCopilotKit: () => ({ copilotkit: f.core }), useAgent: () => ({ agent: f.agent, isReady: true }), OpenGenerativeUIActivityRenderer: () => null }));
vi.mock('../provider', () => ({ HyperOpenBotProvider: () => null }));
vi.mock('../HyperComputerPanel', () => ({ HyperComputerPanel: () => null }));
vi.mock('../conversations/HyperChannelEvents', async original => ({ ...await original<typeof import('../conversations/HyperChannelEvents')>(), hyperWatchChannelEvents: () => () => {}, hyperMarkChannelRead: vi.fn() }));
const tool = { id: 'access-call', label: 'show_app_access', status: 'complete', result: '[connect-app]' + JSON.stringify({ serverId: 'mail', title: 'Mail', agentId: 'bot', message: '', reason: 'access', blocked: true }) };
function reset() { h.states = []; h.refs = []; h.effects = []; h.cleanups = []; }
function render(component: any, props: any) { h.s = h.r = 0; h.effects = []; return component(props); }
function effects() { for (const effect of h.effects) { const cleanup = effect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); } }
function find(node: ReactNode, predicate: (el: ReactElement<any>) => boolean): ReactElement<any> | undefined { if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } } else if (node && typeof node === 'object' && 'props' in node) { const el = node as ReactElement<any>; return predicate(el) ? el : find(el.props.children, predicate); } }
const channel = { id: 'app-channel', threadId: 'app-thread', agentIds: ['bot'], active: true, name: 'Task' };
async function chatFixture() {
  render(HyperOpenBotWorkspace, { viewId: 'app-test', serviceReady: true }); effects(); await vi.advanceTimersByTimeAsync(0);
  let tree = render(HyperOpenBotWorkspace, { viewId: 'app-test', serviceReady: true }); (tree as ReactElement<any>).props.context.openConversation(channel.id);
  tree = render(HyperOpenBotWorkspace, { viewId: 'app-test', serviceReady: true });
  const chat = find(tree, el => typeof el.type === 'function' && el.type.name === 'HyperChannelChat')!;
  for (const cleanup of h.cleanups) cleanup(); reset();
  // History is already restored in this deterministic caller fixture. All handlers are production.
  h.states = [undefined, false];
  const props = { ...chat.props, rosterSaysWorking: () => f.working };
  const draw = () => render(chat.type, props);
  const drawn = draw();
  const transcript = find(drawn, el => el.type === HyperTranscript)!;
  const result = transcript.props.renderTool(tool) as ReactElement<any>;
  return { draw, props, tree: drawn, result, carry: result.props.appCarryOn };
}
beforeEach(() => {
  vi.useFakeTimers(); reset(); f.working = false;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), appflowy: { shell: { openExternal: vi.fn() }, hyperOpenBot: { service: { onState: (listener: (state: any) => void) => { f.identityListener = listener; return () => {}; } } } } });
  f.agent = { agentId: 'channel:app-channel', runtimeAgentId: 'bot', threadId: 'app-thread', messages: [
    { id: 'user', role: 'user', content: 'Original task' },
    { id: 'assistant', role: 'assistant', content: 'Please connect Mail', toolCalls: [{ id: tool.id, function: { name: tool.label, arguments: '{}' } }] },
    { id: 'tool-result', role: 'tool', toolCallId: tool.id, content: tool.result },
  ], isRunning: false, pendingInterrupts: [], addMessage: vi.fn(), subscribe: vi.fn(observer => { observer.onRunInitialized?.({}); return { unsubscribe() {} }; }) };
  f.core = { runAgent: vi.fn(async () => {}), stopAgent: vi.fn() };
  f.request.mockReset().mockImplementation(async path => path === '/api/channels' ? { channels: [channel], nextCursor: null } : path === '/api/channels/app-channel' ? { channel } : path.startsWith('/api/plugins/for/') ? { skills: [] } : {});
  hyperAcquireConversationDraft(channel.id).update(current => ({ ...current, text: '', attachments: [], commandIds: [], retry: undefined, activeAttachments: undefined }));
});
afterEach(() => { for (const cleanup of h.cleanups) cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('wires a blocked card to the actual current channel core without creating a user prompt', async () => {
  const fixture = await chatFixture(), before = [...f.agent.messages];
  expect(fixture.carry.latest()).toBe(true);
  expect(await fixture.carry.resume()).toBe(true);
  expect(f.core.runAgent).toHaveBeenCalledWith({ agent: f.agent });
  expect(f.agent.messages).toEqual(before); expect(f.agent.addMessage).not.toHaveBeenCalled();
  expect(await fixture.carry.resume()).toBe(false); expect(f.core.runAgent).toHaveBeenCalledOnce();
  reset(); const result = render(HyperConversationResult, fixture.result.props);
  const card = find(result, el => el.type === HyperAppAccessAction)!;
  expect(card.props.carryOn.blockedWhenAsked).toBe(true); expect(card.props.carryOn.resume).toBe(fixture.carry.resume);
});
it.each(['server continuation', 'server work', 'running', 'question', 'draft', 'queued intent', 'owner', 'service', 'inactive', 'old card', 'core replacement'])('blocks a cached card continuation on %s', async gate => {
  const fixture = await chatFixture();
  if (gate === 'server continuation') find(fixture.tree, el => el.type === HyperConversationActions)!.props.onCarryOnChange(true);
  if (gate === 'server work') f.working = true;
  if (gate === 'running') f.agent.isRunning = true;
  if (gate === 'question') find(fixture.tree, el => el.type === HyperConversationActions)!.props.onQuestions([{ id: 'q', threadId: channel.threadId }]);
  if (gate === 'draft') hyperAcquireConversationDraft(channel.id).update(current => ({ ...current, text: 'A different task' }));
  if (gate === 'queued intent') { const composer = find(fixture.tree, el => el.type === HyperComposer)!; composer.props.onTextChange('queued correction'); composer.props.onTextChange(''); }
  if (gate === 'owner') f.identityListener?.({ problem: 'signed_out', ready: false });
  if (gate === 'service') { fixture.props.serviceReady = false; fixture.draw(); }
  if (gate === 'inactive') { fixture.props.channel = { ...channel, active: false }; fixture.draw(); }
  if (gate === 'old card') f.agent.messages.push({ id: 'new-user', role: 'user', content: 'Another task' });
  if (gate === 'core replacement') { f.core = { runAgent: vi.fn(), stopAgent: vi.fn() }; fixture.draw(); }
  if (gate === 'owner') await expect(fixture.carry.resume()).rejects.toThrow('identity changed');
  else expect(await fixture.carry.resume()).toBe(false);
  expect(f.core.runAgent).not.toHaveBeenCalled(); expect(f.request.mock.calls.some(call => call[0].endsWith('/busy') && call[1] === 'POST')).toBe(false);
});
