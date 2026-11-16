import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { HyperAudit } from './admin-governance/HyperAudit';
import { HyperInteractiveResult } from './screens-gen/HyperInteractiveResult';
import HyperSettingsSection from './settings/HyperSettingsSection';
import { HyperFiles } from './computer-browser/HyperFiles';
import { HyperConnectionsPanel } from './connections/HyperConnectionsPanel';
import { HYPER_OPENBOT_SECTIONS, hyperRenderConnections } from './HyperOpenBotSections';
import { HyperGroupChat } from './conversations/HyperGroupChat';
import { HyperComposer } from './composer';
import { HyperDeliveryControls } from './conversations/HyperDeliveryControls';

// Drive production handlers with retained hook state, including effect dependency ordering.
const h = vi.hoisted(() => ({ active: false, states: [] as any[], refs: [] as any[], effects: [] as (() => unknown)[], deps: [] as (readonly unknown[] | undefined)[], cleanups: [] as (() => void)[], stateIndex: 0, refIndex: 0 }));
const f = vi.hoisted(() => ({ fetch: vi.fn(), request: vi.fn(), decision: vi.fn(), published: vi.fn(), list: vi.fn(), read: vi.fn(), write: vi.fn(), connections: vi.fn(), enable: vi.fn(), connect: vi.fn(), browse: vi.fn(), delivery: vi.fn(), startSms: vi.fn(), confirmSms: vi.fn() }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  const effect = (...args: Parameters<typeof react.useEffect>) => { if (h.active) { h.effects.push(args[0]); h.deps.push(args[1]); } else react.useEffect(...args); };
  return { ...react,
    useState: (initial: any) => {
      if (!h.active) return react.useState(initial);
      const index = h.stateIndex++;
      if (!(index in h.states)) h.states[index] = typeof initial === 'function' ? initial() : initial;
      return [h.states[index], (next: any) => { h.states[index] = typeof next === 'function' ? next(h.states[index]) : next; }];
    },
    useRef: (initial: any) => { if (!h.active) return react.useRef(initial); const index = h.refIndex++; return h.refs[index] ?? (h.refs[index] = { current: initial }); },
    useEffect: effect, useLayoutEffect: effect,
    useCallback: (callback: any, deps: unknown[]) => h.active ? callback : react.useCallback(callback, deps),
    useMemo: (create: () => unknown, deps: unknown[]) => h.active ? create() : react.useMemo(create, deps),
  };
});
vi.mock('./transport', async original => ({ ...await original<typeof import('./transport')>(), hyperOpenBotRequest: f.request, hyperOpenBotFetch: f.fetch }));
vi.mock('./admin-governance/HyperGovernanceUi', async original => ({ ...await original<typeof import('./admin-governance/HyperGovernanceUi')>(), useHyperResource: () => ({ data: undefined, loading: false, reload: vi.fn() }), useHyperAction: () => ({ busy: false, error: '', run: async (action: () => Promise<void>) => action() }) }));
vi.mock('@copilotkit/react-core/v2', () => ({ OpenGenerativeUIActivityRenderer: () => null }));
vi.mock('./screens-gen/HyperGalleryRegistry', () => ({ hyperGalleryComponent: () => undefined }));
vi.mock('./screens-gen/HyperScreensApi', async original => { const api = await original<typeof import('./screens-gen/HyperScreensApi')>(); return { ...api, hyperScreensApi: { ...api.hyperScreensApi, decision: f.decision, published: f.published } }; });
vi.mock('./computer-browser/HyperWorkspaceApi', async original => ({ ...await original<typeof import('./computer-browser/HyperWorkspaceApi')>(), hyperListFiles: f.list, hyperReadFile: f.read, hyperWriteFile: f.write }));
vi.mock('./connections/HyperConnectionsApi', async original => ({ ...await original<typeof import('./connections/HyperConnectionsApi')>(), hyperLoadConnections: f.connections, hyperStartConnection: f.connect }));
vi.mock('./connections/HyperPluginDetailsApi', async original => ({ ...await original<typeof import('./connections/HyperPluginDetailsApi')>(), hyperBrowseApps: f.browse, hyperEnableBrokerApp: f.enable, hyperLoadAccounts: vi.fn().mockResolvedValue({ accounts: [] }) }));
vi.mock('./conversations/HyperDeliveryApi', async original => ({ ...await original<typeof import('./conversations/HyperDeliveryApi')>(), hyperReadDelivery: f.delivery, hyperStartSms: f.startSms, hyperConfirmSms: f.confirmSms }));
vi.mock('./useHyperConversationDraft', () => ({ useHyperConversationDraft: () => ({ draft: { text: 'addressed follow-up' }, updateDraft: vi.fn() }) }));

const context = { openConversation: vi.fn(), startConversation: vi.fn() };
const reachability = { bindings: [], devices: [], deliveries: [], available: { sms: true, slack: false, teams: false, push: false } };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); h.active = false; h.states = []; h.refs = []; h.effects = []; h.deps = []; h.cleanups = [];
  f.request.mockReset().mockResolvedValue({ user: { id: 'owner' } }); f.decision.mockReset(); f.published.mockReset(); f.connect.mockReset();
  f.delivery.mockResolvedValue(reachability); f.startSms.mockResolvedValue('challenge-a'); f.confirmSms.mockResolvedValue({});
  const values = new Map<string, string>(); vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: () => true });
});
afterEach(() => { for (const cleanup of h.cleanups) cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function render(component: (props: any) => ReactNode, props: any, states?: any[]) {
  if (states) h.states = states;
  h.stateIndex = 0; h.refIndex = 0; h.effects = []; h.deps = []; h.active = true;
  try { return component(props); } finally { h.active = false; }
}
function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } }
  else if (node && typeof node === 'object' && 'props' in node) { const element = node as ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); }
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : '';
const button = (tree: ReactNode, label: string) => find(tree, element => text(element.props.children) === label && typeof element.props.onClick === 'function')!;
const drain = () => vi.advanceTimersByTimeAsync(0);
function mountEffects() { for (const effect of h.effects) { const cleanup = effect(); if (typeof cleanup === 'function') h.cleanups.push(cleanup as () => void); } }

it('warns administrators when the downloaded audit CSV omits events', async () => {
  f.fetch.mockResolvedValue(new Response('csv', { headers: { 'x-audit-export-truncated': '10000' } }));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) });
  const tree = render(HyperAudit, {}); await button(tree, 'Export matching CSV').props.onClick(); await drain();
  const updated = render(HyperAudit, {});
  const warning = find(updated, element => element.props.role === 'status' && text(element.props.children).includes('Narrow'));
  expect(warning).toBeDefined(); expect(text(warning?.props.children)).toContain('not all');
});
it('does not restore a revoked sandbox from an older overlapping source fetch', async () => {
  let finish!: (value: any[]) => void;
  f.decision.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, reason: 'Revoked' });
  f.published.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const props = { name: 'custom_test', agentId: 'bot', args: {} };
  render(HyperInteractiveResult, props); mountEffects(); await drain();
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.states[0]).toMatchObject({ allowed: false, reason: 'Revoked' });
  finish([{ name: 'custom_test', html: 'old content', css: '', jsFunctions: '' }]); await drain();
  expect(h.states[0]).toMatchObject({ allowed: false, reason: 'Revoked' });
});
it('does not fetch published source for an obsolete permission decision', async () => {
  let finish!: (value: { allowed: boolean }) => void;
  f.decision.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ allowed: false, reason: 'Revoked' });
  const props = { name: 'custom_test', agentId: 'bot', args: {} };
  render(HyperInteractiveResult, props); mountEffects(); await vi.advanceTimersByTimeAsync(5000);
  finish({ allowed: true }); await drain();
  expect(f.published).not.toHaveBeenCalled(); expect(h.states[0]).toMatchObject({ allowed: false, reason: 'Revoked' });
});
it('keeps Activity selected when only the workspace navigation callback changes', () => {
  const data = { user: { id: 'owner' }, instructions: '', preferences: {}, edition: 'personal' };
  const props = { context: { ...context, navigate: vi.fn() }, path: '/settings' };
  const first = render(HyperSettingsSection, props, ['general', data, '', 0]); h.effects[0]();
  const deps = h.deps[0]!; button(first, 'Activity').props.onClick();
  render(HyperSettingsSection, { ...props, context: { ...context, navigate: vi.fn() } });
  if (h.deps[0]!.some((value, index) => !Object.is(value, deps[index]))) h.effects[0]();
  expect(h.states[0]).toBe('activity');
  render(HyperSettingsSection, { ...props, path: '/settings/general' }); h.effects[0](); expect(h.states[0]).toBe('general');
});
it('invalidates overwrite confirmation when the user changes the workspace path', () => {
  const props = { agentId: 'bot' }; const file = { path: 'file-a', text: 'original', bytes: 8, truncated: false };
  const first = render(HyperFiles, props, ['file-a', undefined, file, 'edited A', '', false, false]);
  button(first, 'Save changes…').props.onClick();
  let tree = render(HyperFiles, props);
  find(tree, element => element.props['aria-label'] === 'Workspace path')!.props.onChange({ target: { value: 'file-b' } });
  tree = render(HyperFiles, props);
  expect(find(tree, element => element.props['aria-label'] === 'Overwrite file')).toBeUndefined();
  expect(button(tree, 'Save changes…').props.disabled).toBe(true); expect(f.write).not.toHaveBeenCalled();
});
it('writes only the read file and confirmed contents after a valid overwrite confirmation', async () => {
  const props = { agentId: 'bot' }; const file = { path: 'file-a', text: 'original', bytes: 8, truncated: false };
  f.write.mockResolvedValue({ ...file, text: 'edited A' });
  let tree = render(HyperFiles, props, ['file-a', undefined, file, 'edited A', '', false, undefined]);
  button(tree, 'Save changes…').props.onClick(); tree = render(HyperFiles, props);
  button(tree, 'Replace file').props.onClick(); await drain();
  expect(f.write).toHaveBeenCalledWith('bot', 'file-a', 'edited A');
  expect(find(render(HyperFiles, props), element => element.props['aria-label'] === 'Overwrite file')).toBeUndefined();
});
it('keeps the Admin connection instance alive when navigating from directory to credential fields', async () => {
  const section = HYPER_OPENBOT_SECTIONS.find(section => section.id === 'admin-plugins')!;
  const first = section.render({ ...context, navigationIntent: { path: '/admin/plugins/composio' } }) as ReactElement<any>;
  const second = section.render({ ...context, navigationIntent: { path: '/admin/plugins/server' } }) as ReactElement<any>;
  const lazyChild = (tree: ReactNode) => find(tree, element => typeof element.type === 'object' && '$$typeof' in element.type)!;
  expect(lazyChild(first).key).toBe(lazyChild(second).key);
  const personalFirst = hyperRenderConnections({ ...context, navigationIntent: { path: '/connections/composio' } });
  const personalSecond = hyperRenderConnections({ ...context, navigationIntent: { path: '/connections/server' } });
  expect(lazyChild(personalFirst).key).toBe(lazyChild(personalSecond).key);
  const app = { slug: 'mail', name: 'Mail', description: '', categories: [], actionCount: 1, connection: { kind: 'fields' }, classifiedCount: 1, permissionCount: null };
  const row = { key: 'server', title: 'Mail', summary: '', state: 'Off', connections: [], server: { id: 'server', url: 'composio://mail', tools: [] } };
  f.connections.mockResolvedValue([row]); f.enable.mockResolvedValue({ server: { id: 'server' } });
  f.connect.mockResolvedValue({ fields: [{ name: 'key', label: 'Service key', secret: true, required: true }] });
  const props = { admin: true, selection: { page: 'browse' }, onSelectionChange: vi.fn() };
  render(HyperConnectionsPanel, props); h.states[0] = []; h.states[1] = false; h.states[17] = [app];
  // Find the directory state by its production index, then drive the real Add handler.
  const tree = render(HyperConnectionsPanel, props);
  await button(tree, 'Add and connect').props.onClick(); await drain();
  const updated = render(HyperConnectionsPanel, { ...props, selection: { page: 'app', key: 'server' } });
  expect(find(updated, element => (element.type as any).name === 'HyperConnectionSecrets' && element.props.fields?.[0]?.label === 'Service key')).toBeDefined();
});
it('matches upstream group chat by refusing mid-turn submission instead of dropping its recipient', () => {
  const group = { people: [], bots: [{ id: 'bot-a', name: 'A' }, { id: 'bot-b', name: 'B' }], messages: [{ id: 'running', status: 'running', text: '', agentId: 'bot-a' }] };
  const tree = render(HyperGroupChat, { channelId: 'group', serviceReady: true }, [[], false, group]);
  const composer = find(tree, element => element.type === HyperComposer)!;
  expect(composer.props.pending).toBe(true); expect(composer.props.allowQueue).toBe(false);
  h.states = []; h.refs = [];
  let input = render(HyperComposer, composer.props);
  find(input, element => element.props['aria-label'] === 'Mention a Bot')!.props.onChange({ target: { value: 'bot-a' } });
  input = render(HyperComposer, composer.props);
  find(input, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  input = render(HyperComposer, composer.props);
  expect(find(input, element => element.props['aria-label'] === 'Queued messages')).toBeUndefined();
});
it('restores SMS challenges only in their original owner, channel and Bot context', async () => {
  let props = { channelId: 'channel-a', bots: [{ id: 'bot-a', name: 'A' }, { id: 'bot-b', name: 'B' }], enabled: true };
  render(HyperDeliveryControls, props); mountEffects(); await drain();
  let tree = render(HyperDeliveryControls, props);
  const start = find(tree, element => element.type === 'form')!; start.props.onSubmit({ preventDefault() {} }); await drain();
  tree = render(HyperDeliveryControls, props); expect(find(tree, element => element.props['aria-label'] === 'Verification code')).toBeDefined();
  props = { ...props, channelId: 'channel-b' };
  render(HyperDeliveryControls, props); mountEffects(); await drain();
  tree = render(HyperDeliveryControls, props); expect(find(tree, element => element.props['aria-label'] === 'Verification code')).toBeUndefined();
  props = { ...props, channelId: 'channel-a' };
  render(HyperDeliveryControls, props); mountEffects(); await drain();
  tree = render(HyperDeliveryControls, props); expect(find(tree, element => element.props['aria-label'] === 'Verification code')).toBeDefined();
  find(tree, element => element.props['aria-label'] === 'Delivery Bot')!.props.onChange({ target: { value: 'bot-b' } });
  render(HyperDeliveryControls, props); mountEffects(); await drain();
  tree = render(HyperDeliveryControls, props); expect(find(tree, element => element.props['aria-label'] === 'Verification code')).toBeUndefined();
  expect(f.confirmSms).not.toHaveBeenCalled();
});
it('does not restore a late SMS challenge in a newly selected conversation', async () => {
  let finish!: (id: string) => void;
  f.startSms.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const props = { channelId: 'channel-a', bots: [{ id: 'bot', name: 'Bot' }], enabled: true };
  render(HyperDeliveryControls, props); mountEffects(); await drain();
  find(render(HyperDeliveryControls, props), element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  const next = { ...props, channelId: 'channel-b' };
  render(HyperDeliveryControls, next); mountEffects(); await drain(); finish('late-challenge-a'); await drain();
  expect(find(render(HyperDeliveryControls, next), element => element.props['aria-label'] === 'Verification code')).toBeUndefined();
});
