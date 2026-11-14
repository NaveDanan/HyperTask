import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import HyperSettingsSection, { HyperSettingsGeneral } from './settings/HyperSettingsSection';
import { HyperSettingsAutomation } from './settings/HyperSettingsAutomation';
import { HyperHomeComposer } from './onboarding/HyperHomeComposer';
import HyperSetupSection from './onboarding/HyperSetupSection';
import HyperApprovalsSection from './approvals-inbox/HyperApprovalsSection';
import { HyperKinds, HyperTransports } from './approvals-inbox/HyperNotificationsApi';
import HyperVaultSection from './vault/HyperVaultSection';
import { HyperSignInForm } from './vault/HyperSignInForm';

// Retain hook state across manual renders and invoke the actual component handlers.
// Child primitives render normally; no fake DOM or backend is involved.
const h = vi.hoisted(() => ({ active: false, states: [] as any[], refs: [] as any[], effects: [] as (() => unknown)[], cleanups: [] as (() => void)[], stateIndex: 0, refIndex: 0 }));
const f = vi.hoisted(() => ({ startHome: vi.fn(), user: vi.fn(), caps: vi.fn(), setup: vi.fn(), repositories: vi.fn(), connect: vi.fn(), inbox: vi.fn(), delivery: vi.fn(), routing: vi.fn(), route: vi.fn(), vCaps: vi.fn(), vLogins: vi.fn(), vPending: vi.fn(), vKeys: vi.fn(), vDelete: vi.fn(), vRevoke: vi.fn(), signIn: vi.fn(), answer: vi.fn() }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useState: (initial: any) => {
      if (!h.active) return react.useState(initial);
      const index = h.stateIndex++;
      if (!(index in h.states)) h.states[index] = typeof initial === 'function' ? initial() : initial;
      return [h.states[index], (next: any) => { h.states[index] = typeof next === 'function' ? next(h.states[index]) : next; }];
    },
    useRef: (initial: any) => { if (!h.active) return react.useRef(initial); const index = h.refIndex++; return h.refs[index] ?? (h.refs[index] = { current: initial }); },
    useEffect: (...args: Parameters<typeof react.useEffect>) => { if (h.active) h.effects.push(args[0]); else react.useEffect(...args); },
  };
});
vi.mock('./transport', async original => ({ ...await original<typeof import('./transport')>(), hyperOpenBotRequest: vi.fn().mockResolvedValue({ edition: 'personal' }) }));
vi.mock('./onboarding/HyperHomeApi', async original => ({ ...await original<typeof import('./onboarding/HyperHomeApi')>(), HyperStartHomeDraft: f.startHome }));
vi.mock('./onboarding/HyperOnboardingApi', async original => ({ ...await original<typeof import('./onboarding/HyperOnboardingApi')>(), HyperReadUser: f.user, HyperReadCapabilities: f.caps, HyperReadSetup: f.setup, HyperRecheckSetup: f.setup }));
vi.mock('./settings/HyperSettingsApi', async original => { const api = await original<typeof import('./settings/HyperSettingsApi')>(); return { ...api, hyperSettingsApi: { ...api.hyperSettingsApi, repositories: f.repositories, connectRepository: f.connect } }; });
vi.mock('./approvals-inbox/HyperApprovalsApi', async original => ({ ...await original<typeof import('./approvals-inbox/HyperApprovalsApi')>(), HyperLoadInbox: f.inbox }));
vi.mock('./approvals-inbox/HyperNotificationsApi', async original => ({ ...await original<typeof import('./approvals-inbox/HyperNotificationsApi')>(), HyperLoadDelivery: f.delivery, HyperLoadRouting: f.routing, HyperRouteUpdates: f.route }));
vi.mock('./vault/HyperVaultApi', async original => { const api = await original<typeof import('./vault/HyperVaultApi')>(); return { ...api, hyperVaultApi: { ...api.hyperVaultApi, capabilities: f.vCaps, logins: f.vLogins, pending: f.vPending, keys: f.vKeys, removeLogin: f.vDelete, revokeKey: f.vRevoke, readSignIn: f.signIn, answerSignIn: f.answer } }; });

const context = { openConversation: vi.fn(), startConversation: vi.fn().mockResolvedValue(undefined), initialDraftSupported: true };
const preferences = { skin: 'openbot', messageListEmphasis: 'thread', proactive: 'on' };
const inbox = { requests: [], questions: [], rules: [], teamRules: [], enabled: true, preferences: { hostCommands: 'ask' } };
const routing = () => Object.fromEntries(HyperKinds.map(kind => [kind, []]));
const delivery = { available: Object.fromEntries(HyperTransports.map((transport, index) => [transport, index === 0])), devices: [], deliveries: [] };
const login = { id: 'login', origin: 'https://example.test', username: 'synthetic', lastUsedAt: null };
const logins = { passwordManager: true, logins: [login] };
const key = { id: 'key', provider: 'example', kind: 'connector', keyId: 'synthetic', revokedAt: null };
const signIn = { id: 'request', botId: 'bot', origin: 'https://example.test', reason: null, status: 'pending', outcome: null, passwordManager: true, savedLogins: [{ id: 'login', username: 'synthetic' }] };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  h.active = false; h.states = []; h.refs = []; h.effects = []; h.cleanups = [];
  f.startHome.mockRejectedValue(new Error('refused')); f.user.mockResolvedValue({ id: 'user', role: 'user' }); f.caps.mockResolvedValue({ localEvaluation: true });
  f.repositories.mockReset().mockResolvedValue([]); f.connect.mockResolvedValue({});
  f.inbox.mockResolvedValue(inbox); f.delivery.mockReset().mockResolvedValue(delivery); f.routing.mockReset().mockResolvedValue(routing()); f.route.mockResolvedValue(undefined);
  f.vCaps.mockResolvedValue({ edition: 'personal' }); f.vLogins.mockReset().mockResolvedValue(logins); f.vPending.mockResolvedValue([]); f.vKeys.mockReset().mockResolvedValue({ credentials: [key] }); f.vDelete.mockResolvedValue(undefined); f.vRevoke.mockResolvedValue(undefined);
  f.signIn.mockReset().mockResolvedValue(signIn); f.answer.mockReset().mockResolvedValue(signIn);
});
afterEach(() => { for (const cleanup of h.cleanups) cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
function render(component: (props: any) => ReactNode, props: any, states?: any[], refs?: any[]) {
  if (states) h.states = states;
  if (refs) h.refs = refs;
  h.stateIndex = 0; h.refIndex = 0; h.effects = []; h.active = true;
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
const approvalState = (tab: string, error = '', writing = false, unconfirmed = false) => [tab, inbox, delivery, routing(), error, false, true, 0, false, writing, unconfirmed];
const approvalRefs = (target = 'none') => [{ current: false }, { current: false }, { current: target }, { current: true }, { current: 0 }];
const vaultState = () => ['personal', logins, { credentials: [key] }, [], '', false, false];

it('keeps a failed starter separate from existing Home text, files and commands', async () => {
  const files = [new File(['synthetic'], 'draft.txt')];
  const tree = render(HyperHomeComposer, { context, bots: [{ id: 'bot', name: 'Helper', visibility: 'public' }], userId: 'home-test' }, ['Existing draft', files, ['skill'], [], '', false, '']);
  const starter = find(tree, element => (element.type as any).name === 'HyperStarterTasks')!;
  await expect(starter.props.onSelect('Starter task')).rejects.toThrow();
  expect(h.states[0]).toBe('Existing draft'); expect(h.states[1]).toBe(files); expect(h.states[2]).toEqual(['skill']);
  expect(f.startHome.mock.calls[0][2]).toMatchObject({ text: 'Starter task', files: [], commandIds: [] });
});
it('retains Setup retry when capability discovery fails', async () => {
  f.caps.mockRejectedValueOnce(new Error('unavailable'));
  render(HyperSetupSection, { context }); mountEffects(); await drain();
  const tree = render(HyperSetupSection, { context });
  expect(button(tree, 'Check again')).toBeDefined();
  expect(h.states[1]).toContain('Check again'); expect(h.states[3]).not.toBe(false);
});
it('preserves other settings fields when independently completed saves overlap', () => {
  const data = { user: { id: 'user', name: 'Old' }, instructions: 'Old', preferences, edition: 'personal' };
  const tree = render(HyperSettingsSection, { context }, ['general', data, '', 0]);
  const general = find(tree, element => element.type === HyperSettingsGeneral)!;
  general.props.onPreferences({ ...preferences, skin: 'plain' });
  general.props.onUser({ id: 'user', name: 'New' });
  general.props.onInstructions('New instructions');
  expect(h.states[1]).toMatchObject({ user: { name: 'New' }, instructions: 'New instructions', preferences: { skin: 'plain' } });
});
it('shows a successful repository connection with failed readback outside its closed dialog', async () => {
  f.repositories.mockRejectedValueOnce(new Error('readback failed'));
  const tree = render(HyperSettingsAutomation, { preferences, onPreferences: vi.fn() }, [true, [], '', 0, false, true, 'owner/repo', 'synthetic-secret', '']);
  await find(tree, element => element.type === 'form')!.props.onSubmit({ preventDefault() {} });
  expect(h.states[5]).toBe(false); expect(h.states[8]).toBe('');
  expect(h.states[2]).toMatch(/connected.*(?:refresh|reload)/i);
});
it('does not restore notification routing from a load that predates a completed write', async () => {
  let stale!: (value: ReturnType<typeof routing>) => void;
  const next = { ...routing(), [HyperKinds[0]]: [HyperTransports[0]] };
  f.routing.mockImplementationOnce(() => new Promise(resolve => { stale = resolve; })).mockResolvedValueOnce(next);
  const tree = render(HyperApprovalsSection, { context }, approvalState('Notifications'), approvalRefs());
  button(tree, 'Notifications').props.onClick();
  find(tree, element => element.type === 'input' && element.props.type === 'checkbox')!.props.onChange({ target: { checked: true } });
  await drain(); expect(h.states[3]).toEqual(next);
  stale(routing()); await drain(); expect(h.states[3]).toEqual(next);
});
it('retries the unconfirmed notification resource even after switching to Inbox', async () => {
  const tree = render(HyperApprovalsSection, { context }, approvalState('Inbox', 'Readback failed', false, true), approvalRefs('notifications'));
  button(tree, 'Retry').props.onClick(); await drain();
  expect(f.delivery).toHaveBeenCalledOnce(); expect(f.routing).toHaveBeenCalledOnce(); expect(f.inbox).not.toHaveBeenCalled();
  expect(h.states[10]).toBe(false);
});
it('disables every rule draft field while its save is pending', () => {
  const parent = render(HyperApprovalsSection, { context }, approvalState('Standing rules', '', true), approvalRefs());
  const form = find(parent, element => (element.type as any).name === 'HyperRuleForm')!;
  const tree = render(form.type as any, form.props, [{ botId: '*', toolRef: 'tool', effect: '*', scope: '*', behaviour: 'ask' }], []);
  const input = find(tree, element => element.props.required && element.props.onChange)!;
  expect(input.props.disabled).toBe(true);
  expect(find(tree, element => element.type === 'select')!.props.disabled).toBe(true);
});
it('does not restore a deleted Vault login from an older refresh', async () => {
  let stale!: (value: typeof logins) => void;
  f.vLogins.mockImplementationOnce(() => new Promise(resolve => { stale = resolve; })).mockResolvedValueOnce({ ...logins, logins: [] });
  const tree = render(HyperVaultSection, { context }, vaultState());
  button(tree, 'Refresh').props.onClick();
  button(tree, 'Delete login for https://example.test').props.onClick(); await drain();
  expect(h.states[1].logins).toEqual([]);
  stale(logins); await drain(); expect(h.states[1].logins).toEqual([]);
});
it('does not restore a revoked Vault key from an older separate keys read', async () => {
  let stale!: (value: { credentials: typeof key[] }) => void;
  f.vKeys.mockImplementationOnce(() => new Promise(resolve => { stale = resolve; })).mockResolvedValueOnce({ credentials: [{ ...key, revokedAt: '2026-11-15' }] });
  const tree = render(HyperVaultSection, { context }, vaultState());
  button(tree, 'Refresh').props.onClick(); await drain();
  button(tree, 'Revoke').props.onClick(); await drain();
  expect(h.states[2].credentials[0].revokedAt).toBe('2026-11-15');
  stale({ credentials: [key] }); await drain(); expect(h.states[2].credentials[0].revokedAt).toBe('2026-11-15');
});
it('retains a terminal sign-in poll result when an answer later returns filling', async () => {
  let poll!: (value: typeof signIn) => void, answer!: (value: typeof signIn) => void;
  f.signIn.mockResolvedValueOnce(signIn).mockImplementationOnce(() => new Promise(resolve => { poll = resolve; }));
  f.answer.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  render(HyperSignInForm, { requestId: 'request' }, [signIn, '', false]); mountEffects(); await drain();
  await vi.advanceTimersByTimeAsync(3000);
  const tree = render(HyperSignInForm, { requestId: 'request' });
  button(tree, 'Confirm and sign in').props.onClick();
  poll({ ...signIn, status: 'signed_in' }); await drain();
  answer({ ...signIn, status: 'filling' }); await drain();
  expect(h.states[0].status).toBe('signed_in');
  await vi.advanceTimersByTimeAsync(6000); expect(f.signIn).toHaveBeenCalledTimes(2);
});
