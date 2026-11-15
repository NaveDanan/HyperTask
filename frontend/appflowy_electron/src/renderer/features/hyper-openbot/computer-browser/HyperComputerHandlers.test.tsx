import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { HyperBotComputerTab } from './HyperBotComputerTab';
import { HyperBrowserView } from './HyperBrowserSection';
import HyperComputerSettings from './HyperComputerSettings';
import { HyperNarrationControl } from './HyperNarrationControl';
import { HyperTerminal } from './HyperTerminal';
import { HyperPrivateHandoffs } from './HyperPrivateHandoffs';
import { HyperSignInForm } from '../vault';
import { speechEvent } from './HyperNarration.fixture';
import { everyLanguage, withOnDevice } from './HyperOnDeviceSpeech.fixture';
import type { Recognition, RecognitionResultEvent } from './HyperNarration';

// Actual production effects and event callbacks, with deterministic hooks and transport.
const hooks = vi.hoisted(() => ({ current: undefined as any }));
const f = vi.hoisted(() => ({ request: vi.fn(), instances: [] as any[] }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useState: (initial: any) => { const h = hooks.current, i = h.index++; if (!(i in h.values)) h.values[i] = typeof initial === 'function' ? initial() : initial; return [h.values[i], (v: any) => { h.values[i] = typeof v === 'function' ? v(h.values[i]) : v; }]; },
    useRef: (initial: any) => { const h = hooks.current, i = h.index++; return h.values[i] ??= { current: initial }; },
    useEffect: (effect: any, deps: any[]) => { const h = hooks.current, i = h.index++; const old = h.effects[i]; if (!old || !deps || deps.some((v, j) => v !== old.deps[j])) h.pending.push(() => { old?.cleanup?.(); h.effects[i] = { deps, cleanup: effect() }; }); },
    useCallback: (callback: any) => callback,
    useImperativeHandle: () => {},
  };
});
vi.mock('../transport', () => ({ hyperOpenBotRequest: f.request }));
vi.mock('../HyperServiceStatus', () => ({ HyperServiceStatus: () => null, useHyperOpenBotService: () => ({}) }));
vi.mock('./HyperLiveScreen', () => ({ HyperLiveScreen: () => null }));
vi.mock('./HyperTerminal', () => ({ HyperTerminal: () => null }));
vi.mock('./HyperHostFolders', () => ({ HyperHostFolders: () => null }));
vi.mock('./HyperBrowsersSection', () => ({ default: () => null }));
vi.mock('../vault', () => ({ HyperSignInForm: () => null }));

class HyperRecognition implements Recognition {
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
  onstart: (() => void) | null = null; onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onresult: ((event: RecognitionResultEvent) => void) | null = null;
  constructor() { f.instances.push(this); }
  start() {}
  stop() { this.onend?.(); }
  abort() {}
}
const mounted: any[] = [];
function mount(component: (props: any) => ReactNode, props: any) {
  const h: any = { values: [] as any[], effects: [] as any[], pending: [] as (() => void)[], index: 0, props,
    render(next = h.props) { h.props = next; h.index = 0; hooks.current = h; const tree = component(next); hooks.current = undefined; for (const effect of h.pending.splice(0)) effect(); return tree; },
    unmount() { for (const effect of h.effects) effect?.cleanup?.(); h.effects = []; },
  }; mounted.push(h); return h;
}
function find(node: ReactNode, predicate: (e: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } }
  else if (node && typeof node === 'object' && 'props' in node) { const e = node as ReactElement<any>; return predicate(e) ? e : find(e.props.children, predicate); }
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : '';
const button = (tree: ReactNode, label: string) => find(tree, e => text(e.props.children) === label && !!e.props.onClick)!;
const input = (tree: ReactNode, label: string) => find(tree, e => e.props['aria-label'] === label)!;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let control: any, browser: any, identity: any, edition: string;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); f.instances = [];
  identity = { user: { id: 'actor', role: 'admin' } }; edition = 'personal';
  delete (HyperSignInForm as any).hyperComputerGuard;
  control = { holder: 'human', heldBy: 'actor', transitioning: false, request: { id: 'handoff', source: 'model', status: 'taken' } };
  browser = { open: true, mine: true, recordingIsMine: true, tabs: [{ id: 'a', active: true, title: 'A', url: 'https://a.test' }], recorder: { phase: 'idle', actions: 0 } };
  f.request.mockImplementation(async (path: string) => {
    if (path === '/api/me') return identity;
    if (path === '/api/capabilities') return { edition };
    if (path === '/api/sign-in-requests') return { requests: [] };
    if (path === '/api/computers/fleet') return { computers: [{ computer: 'bot:personal', kind: 'bot', botId: `person-${'a'.repeat(32)}`, running: true }] };
    if (path.endsWith('/control')) return control;
    if (path.endsWith('/browser') || path === '/api/browser') return browser;
    return {};
  });
  vi.stubGlobal('navigator', { language: 'en-US' });
  const SpeechRecognition = withOnDevice(class extends HyperRecognition {}, everyLanguage());
  vi.stubGlobal('window', { SpeechRecognition }); vi.stubGlobal('SpeechRecognition', SpeechRecognition);
});
afterEach(() => { for (const h of mounted.splice(0)) h.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('does not hand back or type in another person’s shared Bot terminal, including an admin viewer', async () => {
  control = { ...control, heldBy: 'somebody-else' };
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle();
  let tree = h.render(); expect(button(tree, 'Hand back').props.disabled).toBe(true);
  button(tree, 'terminal').props.onClick(); tree = h.render();
  expect(find(tree, e => e.type === HyperTerminal)!.props.driving).toBe(false);
});

it('resets the address draft when the server reports a different active tab', async () => {
  const h = mount(HyperBrowserView, { agentId: 'bot' }); h.render(); await settle();
  input(h.render(), 'Browser address').props.onChange({ target: { value: 'https://draft.test' } });
  browser = { ...browser, tabs: [{ id: 'b', active: true, title: 'B', url: 'https://b.test' }] };
  await vi.advanceTimersByTimeAsync(1000); h.render();
  expect(input(h.render(), 'Browser address').props.value).toBe('');
});

it('clears the personal browser through Recorder cleanup and reopen, never fleet reset', async () => {
  const h = mount(HyperComputerSettings, {}); h.render(); await settle();
  const tree = h.render(); (button(tree, 'Clear browser data…') ?? button(tree, 'reset…')).props.onClick();
  const dialog = find(h.render(), e => e.props.role === 'alertdialog')!;
  (button(dialog, 'Clear browser') ?? button(dialog, 'Confirm reset')).props.onClick(); await settle();
  expect(f.request).toHaveBeenCalledWith('/api/browser/clear', 'POST', undefined);
  expect(f.request.mock.calls.some(([path, method]) => path === '/api/computers/fleet' && method === 'POST')).toBe(false);
});

async function startNarrator() {
  const h = mount(HyperNarrationControl, { agentId: 'bot', recording: true, enabled: true, stopRef: { current: null } });
  button(h.render(), 'Narrate on this device').props.onClick(); await settle(); return h;
}
it('turns narration off during a network retry so the retry cannot restart recognition', async () => {
  const h = await startNarrator(); const recognition = f.instances.at(-1);
  recognition.onstart(); recognition.onerror({ error: 'network' }); recognition.onend();
  const tree = h.render(); (button(tree, 'Mute narration') ?? button(tree, 'Narrate on this device')).props.onClick();
  const count = f.instances.length; await vi.advanceTimersByTimeAsync(120000);
  expect(f.instances).toHaveLength(count);
});
it('posts the first 4000 characters of a real recognizer phrase with its original timing', async () => {
  await startNarrator(); const recognition = f.instances.at(-1); recognition.onstart();
  recognition.onresult(speechEvent({ type: 'result', at: 0, resultIndex: 0, results: [['x'.repeat(4001), true, 1]] }));
  await settle();
  const phrase = f.request.mock.calls.find(([, , body]) => body?.text)?.[2];
  expect(phrase?.text).toHaveLength(4000); expect(phrase).toMatchObject({ startedAt: expect.any(Number), endedAt: expect.any(Number), sentAt: expect.any(Number) });
});

const writes = () => f.request.mock.calls.filter(([, method]) => method === 'POST');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
it.each([
  ['missing identity', { user: null }, {}],
  ['admin label without identity', { user: { role: 'admin' } }, {}],
  ['unknown holder', undefined, { heldBy: undefined }],
  ['transitioning', undefined, { transitioning: true }],
  ['unknown transition', undefined, { transitioning: undefined }],
  ['other holder', undefined, { heldBy: 'other' }],
])('fails closed for %s even when a disabled callback is called directly', async (_name, me, changes) => {
  if (me !== undefined) identity = me;
  control = { ...control, ...changes };
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle(); const tree = h.render();
  for (const label of ['Take control', 'Hand back', 'Decline handoff']) {
    const b = button(tree, label); expect(b.props.disabled).toBe(true); b.props.onClick();
  }
  await settle(); expect(writes()).toEqual([]);
});
it.each(['user', 'admin'])('preserves the authenticated current %s holder’s terminal and hand-back', async role => {
  identity = { user: { id: 'actor', role } };
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle(); let tree = h.render();
  expect(button(tree, 'Hand back').props.disabled).toBe(false);
  button(tree, 'terminal').props.onClick(); tree = h.render();
  const terminal = find(tree, e => e.type === HyperTerminal)!; expect(terminal.props.driving).toBe(true); expect(terminal.props.canInput()).toBe(true);
  button(tree, 'Hand back').props.onClick(); await settle();
  expect(writes()).toEqual([['/api/computers/bot/control/release', 'POST', { requestId: 'handoff' }]]);
});
it.each(['take', 'cancel'])('preserves a valid waiting handoff %s', async action => {
  control = { ...control, holder: 'bot', heldBy: undefined, request: { ...control.request, status: 'waiting' } };
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle();
  button(h.render(), action === 'take' ? 'Take control' : 'Decline handoff').props.onClick(); await settle();
  expect(writes()).toEqual([[`/api/computers/bot/control/${action}`, 'POST', { requestId: 'handoff' }]]);
});
it('rejects a cached hand-back after ownership is lost and regained', async () => {
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle();
  const old = button(h.render(), 'Hand back').props.onClick;
  control = { ...control, heldBy: 'other' }; await vi.advanceTimersByTimeAsync(1000); h.render();
  control = { ...control, heldBy: 'actor' }; await vi.advanceTimersByTimeAsync(1000); h.render(); old(); await settle();
  expect(writes()).toEqual([]);
  button(h.render(), 'Hand back').props.onClick(); await settle(); expect(writes()).toHaveLength(1);
});
it.each(['identity', 'owner', 'Bot', 'unmount'])('rejects a deferred hand-back after %s changes', async change => {
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle(); const tree = h.render();
  const pending = deferred<any>(); const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => (change === 'identity' ? path === '/api/me' : path.endsWith('/control')) ? pending.promise : base(path, ...args));
  button(tree, 'Hand back').props.onClick(); await settle();
  if (change === 'Bot') h.render({ agentId: 'next' });
  if (change === 'unmount') h.unmount();
  if (change === 'identity') identity = { user: { id: 'other' } };
  if (change === 'owner') control = { ...control, heldBy: 'other' };
  pending.resolve(change === 'identity' ? identity : control);
  await settle(); expect(writes()).toEqual([]);
});
it('rechecks the actor at the mutation seam even before the next poll', async () => {
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle(); const tree = h.render();
  identity = { user: { id: 'other', role: 'admin' } };
  button(tree, 'Hand back').props.onClick(); await settle(); expect(writes()).toEqual([]);
});
it('does not let an old poll overwrite a completed hand-back', async () => {
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle();
  const pending = deferred<any>(); const base = f.request.getMockImplementation()!;
  f.request.mockImplementationOnce(() => identity).mockImplementationOnce(() => pending.promise);
  await vi.advanceTimersByTimeAsync(1000);
  f.request.mockImplementation((path: string, ...args: any[]) => path.endsWith('/control/release') ? Promise.resolve({ holder: 'bot', transitioning: false }) : base(path, ...args));
  button(h.render(), 'Hand back').props.onClick(); await settle();
  pending.resolve(control); await settle(); expect(button(h.render(), 'Hand back').props.disabled).toBe(true);
});
it('rechecks a newly created manual request before taking and refuses a new other owner', async () => {
  control = { holder: 'bot', transitioning: false };
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle();
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => {
    if (path.endsWith('/control/request')) { control = { holder: 'human', heldBy: 'other', transitioning: false, request: { id: 'new', status: 'taken' } }; return Promise.resolve(control); }
    return base(path, ...args);
  });
  button(h.render(), 'Take control').props.onClick(); await settle();
  expect(writes().map(([path]) => path)).toEqual(['/api/computers/bot/control/request']);
});
it('preserves a manual take with the exact request body and no invented actor payload', async () => {
  control = { holder: 'bot', transitioning: false };
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle();
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => {
    if (path.endsWith('/control/request')) { control = { ...control, request: { id: 'manual', status: 'waiting' } }; return Promise.resolve(control); }
    return base(path, ...args);
  });
  button(h.render(), 'Take control').props.onClick(); await settle();
  expect(writes()).toEqual([
    ['/api/computers/bot/control/request', 'POST', { source: 'manual', reason: 'I want to take control of the browser.' }],
    ['/api/computers/bot/control/take', 'POST', { requestId: 'manual' }],
  ]);
});
it('pauses on a failed ownership read and restores a valid current holder on retry', async () => {
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle();
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => path === '/api/me' ? Promise.reject(Error('offline')) : base(path, ...args));
  await vi.advanceTimersByTimeAsync(1000); expect(button(h.render(), 'Hand back').props.disabled).toBe(true);
  f.request.mockImplementation(base); await vi.advanceTimersByTimeAsync(1000);
  expect(button(h.render(), 'Hand back').props.disabled).toBe(false);
});
it('resets a draft after navigation and ownership loss, and rejects the old form', async () => {
  const h = mount(HyperBrowserView, { agentId: 'bot' }); h.render(); await settle();
  input(h.render(), 'Browser address').props.onChange({ target: { value: 'draft.test' } });
  let tree = h.render(); const form = find(tree, e => e.type === 'form')!;
  form.props.onSubmit({ preventDefault() {} }); await settle();
  expect(writes()).toContainEqual(['/api/computers/bot/browser/navigate', 'POST', { url: 'https://draft.test' }]);
  expect(input(h.render(), 'Browser address').props.value).toBe('');
  input(h.render(), 'Browser address').props.onChange({ target: { value: 'another.test' } }); tree = h.render();
  const oldForm = find(tree, e => e.type === 'form')!;
  browser = { ...browser, mine: false }; await vi.advanceTimersByTimeAsync(1000); h.render();
  browser = { ...browser, mine: true }; await vi.advanceTimersByTimeAsync(1000); h.render();
  oldForm.props.onSubmit({ preventDefault() {} }); await settle();
  expect(writes()).toHaveLength(1); expect(input(h.render(), 'Browser address').props.value).toBe('');
});
it('rejects a deferred browser submission after tab change or Bot navigation', async () => {
  const h = mount(HyperBrowserView, { agentId: 'bot' }); h.render(); await settle();
  input(h.render(), 'Browser address').props.onChange({ target: { value: 'draft.test' } });
  const pending = deferred<any>(); const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => path.endsWith('/control') ? pending.promise : base(path, ...args));
  find(h.render(), e => e.type === 'form')!.props.onSubmit({ preventDefault() {} }); await settle();
  h.render({ agentId: 'next' }); pending.resolve(control); await settle(); expect(writes()).toEqual([]);
});
it('does not stop another person’s recording even if the current viewer holds the wheel', async () => {
  browser = { ...browser, recordingIsMine: false, recorder: { phase: 'recording', actions: 0 } };
  const h = mount(HyperBrowserView, { agentId: 'bot' }); h.render(); await settle();
  const tree = h.render(); const form = find(tree, e => e.type === 'form' && text(find(e.props.children, c => c.props.type === 'submit')?.props.children) === 'Stop recording')!;
  form.props.onSubmit({ preventDefault() {} }); await settle(); expect(writes()).toEqual([]);
});
it.each(['other', undefined])('hides private handoff controls for holder %s and rejects cached secret submission', async holder => {
  control = { ...control, secretWanted: 'Private field' };
  const h = mount(HyperPrivateHandoffs, { agentId: 'bot', onOpenBrowser: vi.fn() }); h.render(); await settle(); const tree = h.render();
  const form = find(tree, e => e.type === 'form')!; expect(form).toBeDefined();
  control = { ...control, heldBy: holder }; await vi.advanceTimersByTimeAsync(1000);
  expect(find(h.render(), e => e.type === 'form')).toBeUndefined();
  const reset = vi.fn(); form.props.onSubmit({ preventDefault() {}, currentTarget: { reset } }); await settle();
  expect(reset).toHaveBeenCalled(); expect(writes()).toEqual([]);
});
it('preserves a Bot-requested private field without taking the wheel and clears the field before HTTP', async () => {
  control = { holder: 'bot', transitioning: false, secretWanted: 'Private field', secretRef: 'field' };
  const h = mount(HyperPrivateHandoffs, { agentId: 'bot', onOpenBrowser: vi.fn() }); h.render(); await settle();
  const reset = vi.fn(); vi.stubGlobal('FormData', class { get() { return 'test-only-value'; } });
  find(h.render(), e => e.type === 'form')!.props.onSubmit({ preventDefault() {}, currentTarget: { reset } });
  expect(reset).toHaveBeenCalled(); expect(writes()).toEqual([]); await settle();
  expect(writes()).toEqual([['/api/computers/bot/human/secret', 'POST', { text: 'test-only-value' }]]);
});
it.each(['team', 'personal'])('keeps ordinary Bot reset on the fleet route in %s edition', async value => {
  edition = value; const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => path === '/api/computers/fleet' ? Promise.resolve({ computers: [{ computer: 'bot:b', kind: 'bot', botId: 'b', running: true }] }) : base(path, ...args));
  const h = mount(HyperComputerSettings, {}); h.render(); await settle(); button(h.render(), 'reset…').props.onClick(); button(h.render(), 'Confirm reset').props.onClick(); await settle();
  expect(writes()).toEqual([['/api/computers/fleet', 'POST', { action: 'reset', computer: 'bot:b', botId: 'b' }]]);
});
it.each(['cancel', 'unmount', 'unknown edition'])('rejects the personal clear after %s', async action => {
  const h = mount(HyperComputerSettings, {}); h.render(); await settle(); button(h.render(), 'Clear browser data…').props.onClick();
  const tree = h.render(), confirm = button(tree, 'Clear browser').props.onClick;
  if (action === 'cancel') button(tree, 'Cancel').props.onClick();
  if (action === 'unmount') h.unmount();
  if (action === 'unknown edition') edition = 'unknown';
  confirm(); await settle(); expect(writes()).toEqual([]);
});
it('lets narration turn off while recognition is starting and back on explicitly', async () => {
  const h = await startNarrator(); expect(f.instances).toHaveLength(1);
  button(h.render(), 'Mute narration').props.onClick(); await settle(); await vi.advanceTimersByTimeAsync(5000); expect(f.instances).toHaveLength(1);
  button(h.render(), 'Narrate on this device').props.onClick(); await settle(); expect(f.instances).toHaveLength(2);
});
it('drops queued narration after its Bot changes and rejects a cached toggle', async () => {
  const h = await startNarrator(), tree = h.render(); const oldToggle = button(tree, 'Mute narration').props.onClick;
  const pending = deferred<any>(); f.request.mockReturnValueOnce(pending.promise);
  const recognition = f.instances.at(-1); recognition.onstart();
  recognition.onresult(speechEvent({ type: 'result', at: 0, resultIndex: 0, results: [['first', true, 1]] })); await settle();
  recognition.onresult(speechEvent({ type: 'result', at: 1, resultIndex: 1, results: [['first', true, 1], ['second', true, 1]] }));
  h.render({ ...h.props, agentId: 'next' }); oldToggle(); pending.resolve({}); await settle();
  expect(writes().map(([, , body]) => body.text)).not.toContain('second');
});
it('keeps unguarded Vault sign-in controls unavailable until the other owner connects the typed guard', async () => {
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => path === '/api/sign-in-requests' ? Promise.resolve({ requests: [{ id: 'sign-in', botId: 'bot' }] }) : base(path, ...args));
  const h = mount(HyperPrivateHandoffs, { agentId: 'bot', onOpenBrowser: vi.fn() }); h.render(); await settle();
  expect(find(h.render(), e => e.type === HyperSignInForm)).toBeUndefined();
  expect(find(h.render(), e => e.props.role === 'status')).toBeDefined();
  (HyperSignInForm as any).hyperComputerGuard = 1;
  const child = find(h.render(), e => e.type === HyperSignInForm)!; const run = vi.fn(async () => {});
  await child.props.computerGuard.run(run); expect(run).toHaveBeenCalledTimes(1);
  control = { ...control, heldBy: 'other' }; await vi.advanceTimersByTimeAsync(1000);
  expect(child.props.computerGuard.current()).toBe(false);
  await child.props.computerGuard.run(run); expect(run).toHaveBeenCalledTimes(1);
  expect(find(h.render(), e => e.type === HyperSignInForm)).toBeUndefined();
});
it('retains a refused control action as an error, then permits a current retry', async () => {
  const h = mount(HyperBotComputerTab, { agentId: 'bot' }); h.render(); await settle();
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => path.endsWith('/control/release') ? Promise.reject(Error('refused')) : base(path, ...args));
  button(h.render(), 'Hand back').props.onClick(); await settle();
  expect(find(h.render(), e => e.props.role === 'alert')).toBeDefined();
  f.request.mockImplementation(base); await vi.advanceTimersByTimeAsync(1000);
  button(h.render(), 'Hand back').props.onClick(); await settle(); expect(writes()).toHaveLength(2);
});
it('checks the new active tab at the actual browser mutation seam', async () => {
  const h = mount(HyperBrowserView, { agentId: 'bot' }); h.render(); await settle();
  input(h.render(), 'Browser address').props.onChange({ target: { value: 'draft.test' } });
  const tree = h.render(); browser = { ...browser, tabs: [{ id: 'b', active: true, title: 'B', url: 'https://b.test' }] };
  find(tree, e => e.type === 'form')!.props.onSubmit({ preventDefault() {} }); await settle();
  expect(writes()).toEqual([]); expect(input(h.render(), 'Browser address').props.value).toBe('');
});
it('keeps a refused navigation draft for retry and clears it only after success', async () => {
  const h = mount(HyperBrowserView, { agentId: 'bot' }); h.render(); await settle();
  input(h.render(), 'Browser address').props.onChange({ target: { value: 'draft.test' } }); const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => path.endsWith('/navigate') ? Promise.reject(Error('refused')) : base(path, ...args));
  find(h.render(), e => e.type === 'form')!.props.onSubmit({ preventDefault() {} }); await settle();
  expect(input(h.render(), 'Browser address').props.value).toBe('draft.test');
  f.request.mockImplementation(base); await vi.advanceTimersByTimeAsync(1000);
  find(h.render(), e => e.type === 'form')!.props.onSubmit({ preventDefault() {} }); await settle();
  expect(input(h.render(), 'Browser address').props.value).toBe(''); expect(writes()).toHaveLength(2);
});
it('keeps the team own-browser reset on the fleet contract', async () => {
  edition = 'team'; const h = mount(HyperComputerSettings, {}); h.render(); await settle();
  button(h.render(), 'reset…').props.onClick(); button(h.render(), 'Confirm reset').props.onClick(); await settle();
  expect(writes()).toEqual([['/api/computers/fleet', 'POST', { action: 'reset', computer: 'bot:personal', botId: `person-${'a'.repeat(32)}` }]]);
});
it('retains a failed personal clear confirmation and allows a deliberate retry', async () => {
  const h = mount(HyperComputerSettings, {}); h.render(); await settle(); button(h.render(), 'Clear browser data…').props.onClick();
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string, ...args: any[]) => path === '/api/browser/clear' ? Promise.reject(Error('refused')) : base(path, ...args));
  button(h.render(), 'Clear browser').props.onClick(); await settle(); expect(button(h.render(), 'Clear browser')).toBeDefined();
  f.request.mockImplementation(base); button(h.render(), 'Clear browser').props.onClick(); await settle();
  expect(writes().map(([path]) => path)).toEqual(['/api/browser/clear', '/api/browser/clear']);
  expect(find(h.render(), e => e.props.role === 'alertdialog')).toBeUndefined();
});
it('cancels a pending speech installation and never starts after it resolves', async () => {
  const pending = deferred<boolean>(); (globalThis as any).SpeechRecognition.install = () => pending.promise;
  const h = mount(HyperNarrationControl, { agentId: 'bot', recording: true, enabled: true, stopRef: { current: null } });
  button(h.render(), 'Narrate on this device').props.onClick(); await settle();
  const mute = button(h.render(), 'Mute narration'); expect(mute.props.disabled).toBe(false); mute.props.onClick();
  pending.resolve(true); await settle(); expect(f.instances).toEqual([]);
});
it('preserves automatic network retry while narration remains requested on', async () => {
  await startNarrator(); const recognition = f.instances.at(-1); recognition.onstart(); recognition.onerror({ error: 'network' }); recognition.onend();
  await vi.advanceTimersByTimeAsync(2000); expect(f.instances).toHaveLength(2);
});
it('flushes a final partial phrase and waits for narration delivery before Stop resolves', async () => {
  const h = await startNarrator(), recognition = f.instances.at(-1); recognition.onstart();
  recognition.onresult(speechEvent({ type: 'result', at: 0, resultIndex: 0, results: [['last words', false, 1]] })); await settle();
  // Like the captured upstream stop fixture, Chrome answers stop with a final phrase before end.
  recognition.stop = () => { recognition.onresult(speechEvent({ type: 'result', at: 1, resultIndex: 0, results: [['last words', true, 1]] })); recognition.onend(); };
  const pending = deferred<any>(); f.request.mockReturnValueOnce(pending.promise);
  let finished = false; const stopping = h.props.stopRef.current().then(() => { finished = true; }); await settle();
  expect(finished).toBe(false); expect(writes().some(([, , body]) => body.text === 'last words')).toBe(true);
  pending.resolve({}); await stopping; expect(finished).toBe(true);
});
it('rejects a cached narrator toggle after ownership is lost and regained', async () => {
  const h = await startNarrator(), old = button(h.render(), 'Mute narration').props.onClick;
  h.render({ ...h.props, enabled: false }); await settle(); h.render({ ...h.props, enabled: true });
  old(); await settle(); expect(f.instances).toHaveLength(1);
});
it('never applies a supplied authority for a different Bot', async () => {
  const parent = mount(HyperBotComputerTab, { agentId: 'bot' }); parent.render(); await settle();
  const child = find(parent.render(), e => e.type === HyperBrowserView)!;
  const browser = mount(HyperBrowserView, { agentId: 'other', authority: child.props.authority }); browser.render(); await settle();
  const tree = browser.render(); expect(input(tree, 'Browser address').props.disabled).toBe(true);
  button(tree, 'New tab').props.onClick(); await settle(); expect(writes()).toEqual([]);
});
