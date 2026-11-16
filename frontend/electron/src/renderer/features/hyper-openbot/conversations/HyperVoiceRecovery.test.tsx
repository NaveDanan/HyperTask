import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { HyperVoiceControls } from './HyperVoiceControls';
import type { SaveHyperVoiceSessionInput, HyperVoiceSessionRecord } from './HyperVoiceContracts';
import type { VoiceEvent } from './HyperVoiceTypes';

// Real controls, archive writes and session events; only HTTP/audio hardware and React scheduling are replaced.
const h = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], memos: [] as any[], deps: [] as any[], effects: [] as { index: number; effect: () => unknown }[], cleanups: [] as (undefined | (() => void))[], si: 0, ri: 0, mi: 0, ei: 0 }));
const f = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), connect: vi.fn(), send: vi.fn(), event: undefined as undefined | ((event: VoiceEvent) => void), listeners: new Set<(state: any) => void>() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.states)) h.states[i] = typeof initial === 'function' ? initial() : initial; const states = h.states; return [states[i], (next: any) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
  useRef: (initial: any) => { const i = h.ri++; return h.refs[i] ?? (h.refs[i] = { current: initial }); },
  useMemo: (create: () => unknown, deps: unknown[]) => { const i = h.mi++, prior = h.memos[i]; if (!prior || deps.some((v, n) => !Object.is(v, prior.deps[n]))) h.memos[i] = { deps, value: create() }; return h.memos[i].value; },
  useEffect: (effect: () => unknown, deps: unknown[]) => { const index = h.ei++, prior = h.deps[index]; if (!prior || !deps || deps.some((v, n) => !Object.is(v, prior[n]))) { h.deps[index] = deps; h.effects.push({ index, effect }); } },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../transport', () => ({ hyperOpenBotRequest: f.request, hyperOpenBotFetch: f.fetch, HYPER_OPENBOT_ORIGIN: 'https://hyper-openbot.invalid' }));
vi.mock('./HyperVoiceWebrtc', () => ({ connectWebRtc: f.connect }));
vi.mock('./HyperVoiceWebsocket', () => ({ connectWebSocket: f.connect }));
const props = (channelId = 'recovery-channel') => ({ channelId, disabled: false, context: () => 'typed history', askAgent: vi.fn(async () => 'answer'), anchorMessageId: () => 'message-anchor', onHistory: vi.fn() });
let currentProps: ReturnType<typeof props> | undefined;
function render(p: ReturnType<typeof props>) { currentProps = p; h.si = h.ri = h.mi = h.ei = 0; h.effects = []; const tree = HyperVoiceControls(p); for (const { index, effect } of h.effects) { h.cleanups[index]?.(); const cleanup = effect(); h.cleanups[index] = typeof cleanup === 'function' ? cleanup as () => void : undefined; } return tree; }
const mount = render;
function unmount() { currentProps = undefined; for (const cleanup of h.cleanups.splice(0)) cleanup?.(); h.states = []; h.refs = []; h.memos = []; h.deps = []; }
const drain = async () => { for (let i = 0; i < 40; i++) { await Promise.resolve(); if (currentProps) render(currentProps); } };
function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } }
  else if (node && typeof node === 'object' && 'props' in node) { const element = node as ReactElement<any>; return predicate(element) ? element : find(element.props.children, predicate); }
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : node && typeof node === 'object' && 'props' in node ? text((node as ReactElement<any>).props.children) : '';
const button = (node: ReactNode, label: string) => find(node, el => typeof el.props.onClick === 'function' && text(el.props.children) === label);
async function start(p: ReturnType<typeof props>) { button(render(p), 'Start voice call')!.props.onClick(); await drain(); }
function speak(words: string) { f.event!({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'voice-line', transcript: words }); }
async function end(p: ReturnType<typeof props>) { button(render(p), 'End call')!.props.onClick(); await drain(); }
function record(n: number): HyperVoiceSessionRecord { return { id: `call-${n}`, channelId: 'recovery-channel', anchorMessageId: 'message-anchor', startedAt: `2026-11-15T10:${String(n).padStart(2, '0')}:00.000Z`, endedAt: `2026-11-15T10:${String(n).padStart(2, '0')}:30.000Z`, transcript: [{ id: `line-${n}`, role: 'user', text: `saved discussion ${n}!` }], durationSeconds: 30, summary: null, summaryStatus: 'ready' }; }
let owner: string, archive: HyperVoiceSessionRecord[], live: boolean;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); h.states = []; h.refs = []; h.memos = []; h.deps = []; h.cleanups = []; owner = 'owner'; archive = []; live = true;
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
  vi.stubGlobal('localStorage', { get length() { throw new Error('Transcript persistence is forbidden'); }, getItem: vi.fn(() => { throw new Error('Transcript persistence is forbidden'); }), setItem: vi.fn(() => { throw new Error('Transcript persistence is forbidden'); }), removeItem: vi.fn() });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), hypertask: { hyperOpenBot: { service: { onState: (listener: (s: any) => void) => { f.listeners.add(listener); return () => f.listeners.delete(listener); } } } } });
  f.request.mockImplementation(async (path: string) => path === '/api/me' ? { user: { id: owner } } : path === '/api/capabilities' ? { voice: live } : path === '/api/voice/config' ? { transport: 'webrtc' } : { sessions: archive, nextCursor: null });
  f.fetch.mockImplementation(async (_path: string, init: RequestInit) => { const call = JSON.parse(init.body as string) as SaveHyperVoiceSessionInput; const saved = { ...call, durationSeconds: 1, summary: null, summaryStatus: 'ready' as const }; archive.push(saved); return new Response(JSON.stringify({ session: saved })); });
  f.connect.mockImplementation(async (options: any) => { f.event = options.onEvent; return { stream: {}, send: f.send, close: vi.fn(), mute: vi.fn() }; });
});
afterEach(() => { unmount(); for (const listener of f.listeners) listener({ problem: 'signed_out' }); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('retries the failed initial actor read before connecting, then explicitly saves after a failed save owner read', async () => {
  const original = f.request.getMockImplementation()!; let actorReads = 0;
  f.request.mockImplementation(async (path: string) => { if (path === '/api/me' && ++actorReads <= 2) throw new Error('actor temporarily unavailable'); return original(path); });
  const p = props(); mount(p); await drain(); await start(p);
  expect(f.connect).not.toHaveBeenCalled();
  await start(p); expect(f.connect).toHaveBeenCalledOnce(); speak('Retain these exact words');
  f.request.mockImplementation(async (path: string) => { if (path === '/api/me') throw new Error('save owner temporarily unavailable'); return original(path); });
  await end(p); expect(button(render(p), 'Retry saving')).toBeDefined(); expect(f.fetch).not.toHaveBeenCalled();
  f.request.mockImplementation(original); button(render(p), 'Retry saving')!.props.onClick(); await drain();
  expect(f.fetch).toHaveBeenCalledOnce(); expect(JSON.parse(f.fetch.mock.calls[0][1].body).transcript[0].text).toBe('Retain these exact words');
  expect(JSON.parse(f.fetch.mock.calls[0][1].body).anchorMessageId).toBe('message-anchor');
});
it('retains an unsaved call across same-owner navigation without browser storage or automatic retry', async () => {
  const p = props(); mount(p); await drain(); await start(p); speak('navigation transcript'); f.fetch.mockRejectedValue(new Error('offline')); await end(p);
  unmount(); mount(props('other-channel')); await drain(); expect(button(render(props('other-channel')), 'Retry saving')).toBeUndefined(); unmount();
  mount(p); await drain(); expect(button(render(p), 'Retry saving')).toBeDefined(); expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(localStorage.setItem).not.toHaveBeenCalled();
  f.fetch.mockResolvedValue(new Response(JSON.stringify({ session: { ...record(1), id: JSON.parse(f.fetch.mock.calls[0][1].body).id } })));
  button(render(p), 'Retry saving')!.props.onClick(); await drain(); expect(f.fetch).toHaveBeenCalledTimes(2);
});
it('awaits saved archive context for successive calls and projects the latest twelve chronologically', async () => {
  archive = Array.from({ length: 13 }, (_, i) => record(i + 1)); const p = props(); mount(p); await drain();
  const history = p.onHistory.mock.calls.at(-1)![0]; expect(history).not.toContain('saved discussion 1!'); expect(history).toContain('saved discussion 13!'); expect(history.indexOf('saved discussion 2!')).toBeLessThan(history.indexOf('saved discussion 13!'));
  await start(p); expect(JSON.stringify(f.send.mock.calls)).toContain('saved discussion 13!'); expect(JSON.stringify(f.send.mock.calls)).toContain('typed history');
  speak('discussion from first call'); await end(p); await start(p);
  expect(JSON.stringify(f.send.mock.calls.at(-1))).toContain('discussion from first call');
});
it.each(['live disabled', 'microphone absent'])('keeps archive and summary recovery in an archive-only environment: %s', async mode => {
  if (mode === 'live disabled') live = false; else vi.stubGlobal('navigator', {});
  archive = [{ ...record(1), summaryStatus: 'failed' }]; const p = props(); mount(p); await drain(); const tree = render(p);
  expect(text(tree)).toContain('saved discussion 1!'); expect(p.onHistory).toHaveBeenCalledWith(expect.stringContaining('saved discussion 1!'));
  expect(button(tree, 'Start voice call')).toBeUndefined(); button(tree, 'Retry summary')!.props.onClick(); await drain(); expect(f.fetch).toHaveBeenCalledOnce(); expect(f.connect).not.toHaveBeenCalled();
});

it.each(['signed_out', 'profile_required', 'unsupported'])('clears pending calls on trusted %s even with every voice view unmounted', async problem => {
  const p = props(); mount(p); await drain(); await start(p); speak('private pending words'); f.fetch.mockRejectedValue(new Error('offline')); await end(p);
  const retry = button(render(p), 'Retry saving')!; unmount();
  for (const listener of f.listeners) listener({ problem });
  retry.props.onClick(); await drain(); expect(f.fetch).toHaveBeenCalledTimes(1);
  mount(p); await drain(); expect(button(render(p), 'Retry saving')).toBeUndefined(); expect(text(render(p))).not.toContain('private pending words');
});
it('retains recovery through ordinary service failure but never lends it to another owner', async () => {
  const p = props(); mount(p); await drain(); await start(p); speak('owner A words'); f.fetch.mockRejectedValue(new Error('offline')); await end(p);
  for (const listener of f.listeners) listener({ problem: 'services_unhealthy' });
  expect(button(render(p), 'Retry saving')).toBeDefined();
  owner = 'other-owner'; button(render(p), 'Retry saving')!.props.onClick(); await drain(); expect(f.fetch).toHaveBeenCalledTimes(1);
  unmount(); mount(p); await drain(); expect(button(render(p), 'Retry saving')).toBeUndefined(); expect(text(render(p))).not.toContain('owner A words');
});
it('rejects a deferred save owner read and its settlement across identity epochs', async () => {
  const p = props(); mount(p); await drain(); await start(p); speak('pending epoch words');
  const original = f.request.getMockImplementation()!; let resolveOwner!: (v: unknown) => void;
  f.request.mockImplementation((path: string) => path === '/api/me' ? new Promise(resolve => { resolveOwner = resolve; }) : original(path));
  await end(p); expect(f.fetch).not.toHaveBeenCalled();
  for (const listener of f.listeners) listener({ problem: 'profile_required' });
  resolveOwner({ user: { id: 'owner' } }); await drain(); expect(f.fetch).not.toHaveBeenCalled(); expect(button(render(p), 'Retry saving')).toBeUndefined();
  unmount(); f.request.mockImplementation(original); mount(p); await drain(); expect(button(render(p), 'Retry saving')).toBeUndefined();
});
it('captures an active call on unmount without an automatic background save and rejects its cached Start', async () => {
  const p = props(); mount(p); await drain(); const cachedStart = button(render(p), 'Start voice call')!;
  await start(p); speak('captured at navigation'); unmount(); cachedStart.props.onClick(); await drain(); expect(f.fetch).not.toHaveBeenCalled(); expect(f.connect).toHaveBeenCalledOnce();
  mount(p); await drain(); expect(text(render(p))).toContain('captured at navigation'); expect(button(render(p), 'Retry saving')).toBeDefined(); expect(f.fetch).not.toHaveBeenCalled();
});
it('uses a new channel session and rejects callbacks captured from the previous channel', async () => {
  const a = props(); mount(a); await drain(); const cachedStart = button(render(a), 'Start voice call')!;
  await start(a); speak('channel A words'); const b = props('channel-b'); render(b); await drain();
  cachedStart.props.onClick(); await drain(); expect(f.connect).toHaveBeenCalledOnce(); expect(text(render(b))).not.toContain('channel A words');
  await start(b); expect(f.connect.mock.calls.at(-1)![0].channelId).toBe('channel-b'); expect(f.fetch).not.toHaveBeenCalled();
});
it('waits for every authenticated archive page before opening a call', async () => {
  const original = f.request.getMockImplementation()!; let finishPage: undefined | ((value: unknown) => void);
  f.request.mockImplementation(async (path: string) => path.startsWith('/api/voice/sessions?') ? path.includes('cursor=page-two') ? new Promise(resolve => { finishPage = resolve; }) : { sessions: Array.from({ length: 12 }, (_, i) => record(i + 1)), nextCursor: 'page-two' } : original(path));
  const p = props(); mount(p); await drain(); finishPage!({ sessions: [record(13)], nextCursor: null }); await drain();
  await start(p); expect(f.connect).not.toHaveBeenCalled();
  finishPage!({ sessions: [record(13)], nextCursor: null }); await drain();
  expect(f.connect).toHaveBeenCalledOnce(); const opening = JSON.stringify(f.send.mock.calls);
  expect(opening).toContain('saved discussion 13!'); expect(opening).not.toContain('saved discussion 1!');
});
it.each(['unknown owner', 'history unavailable'])('refuses to start without authenticated context: %s', async reason => {
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path: string) => { if (path === '/api/me' && reason === 'unknown owner') return { user: {} }; if (path.startsWith('/api/voice/sessions?') && reason === 'history unavailable') throw new Error('archive offline'); return original(path); });
  const p = props(); mount(p); await drain(); await start(p); expect(f.connect).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled(); expect(find(render(p), el => el.props.role === 'alert')).toBeDefined();
});
it.each(['live disabled', 'microphone absent'])('keeps unsaved recovery available after navigation into %s', async mode => {
  const p = props(); mount(p); await drain(); await start(p); speak('recover without live audio'); f.fetch.mockRejectedValue(new Error('offline')); await end(p); unmount();
  if (mode === 'live disabled') live = false; else vi.stubGlobal('navigator', {});
  mount(p); await drain(); const tree = render(p); expect(button(tree, 'Start voice call')).toBeUndefined(); expect(text(tree)).toContain('recover without live audio');
  button(tree, 'Retry saving')!.props.onClick(); await drain(); expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.connect).toHaveBeenCalledOnce();
});
it('surfaces permission refusal and allows a fresh current call retry', async () => {
  const original = f.connect.getMockImplementation()!; f.connect.mockRejectedValueOnce(new Error('Microphone access was denied.'));
  const p = props(); mount(p); await drain(); await start(p); expect(text(render(p))).toContain('Microphone access was denied.'); expect(f.fetch).not.toHaveBeenCalled();
  f.connect.mockImplementation(original); await start(p); expect(button(render(p), 'End call')).toBeDefined();
});
it('does not publish an abandoned archive response or use it for another channel', async () => {
  let finishArchive!: (value: unknown) => void; const original = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string) => path.startsWith('/api/voice/sessions?') && path.includes('recovery-channel') ? new Promise(resolve => { finishArchive = resolve; }) : original(path));
  const a = props(); mount(a); await drain(); const b = props('channel-b'); render(b); await drain();
  finishArchive({ sessions: [record(1)], nextCursor: null }); await drain(); expect(a.onHistory).not.toHaveBeenCalledWith(expect.stringContaining('saved discussion')); expect(text(render(b))).not.toContain('saved discussion');
});
it('ignores a pre-save history read that settles after the saved readback', async () => {
  archive = [{ ...record(1), summaryStatus: 'failed' }];
  const p = props(); mount(p); await drain(); await start(p); speak('fresh saved words');
  let finishOld!: (value: unknown) => void, reads = 0; const original = f.request.getMockImplementation()!;
  f.request.mockImplementation((path: string) => path.startsWith('/api/voice/sessions?') && ++reads === 1 ? new Promise(resolve => { finishOld = resolve; }) : original(path));
  button(render(p), 'Retry summary')!.props.onClick(); await drain();
  await end(p); expect(p.onHistory.mock.calls.at(-1)![0]).toContain('fresh saved words');
  finishOld({ sessions: [record(1)], nextCursor: null }); await drain();
  expect(p.onHistory.mock.calls.at(-1)![0]).toContain('fresh saved words');
});
