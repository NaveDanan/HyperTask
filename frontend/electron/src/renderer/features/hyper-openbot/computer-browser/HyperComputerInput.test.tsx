import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { ReactElement, ReactNode } from 'react';
import { HyperTerminal } from './HyperTerminal';
import { HyperLiveScreen } from './HyperLiveScreen';

const hooks = vi.hoisted(() => ({ current: undefined as any }));
const f = vi.hoisted(() => ({ request: vi.fn(), sockets: [] as any[], terminals: [] as any[], raf: [] as (() => void)[] }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useState: (initial: any) => { const h = hooks.current, i = h.index++; if (!(i in h.values)) h.values[i] = typeof initial === 'function' ? initial() : initial; return [h.values[i], (v: any) => { h.values[i] = typeof v === 'function' ? v(h.values[i]) : v; }]; },
    useRef: (initial: any) => { const h = hooks.current, i = h.index++; return h.values[i] ??= { current: initial }; },
    useEffect: (effect: any, deps: any[]) => { const h = hooks.current, i = h.index++; const old = h.effects[i]; if (!old || !deps || deps.some((v, j) => v !== old.deps[j])) h.pending.push(() => { old?.cleanup?.(); h.effects[i] = { deps, cleanup: effect() }; }); },
    useCallback: (callback: any) => callback, useImperativeHandle: () => {},
  };
});
vi.mock('../transport', () => ({ hyperOpenBotRequest: f.request }));
vi.mock('../socket', () => ({ HyperOpenBotSocket: class {
  readyState = 1; onopen: any; onclose: any; onmessage: any; onerror: any;
  send = vi.fn(); close = vi.fn(); binaryType = '';
  constructor(public url: string) { f.sockets.push(this); }
} }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options: any; cols = 80; rows = 24; data: any; binary: any;
  constructor(options: any) { this.options = options; f.terminals.push(this); }
  open() {} loadAddon() {} write(_bytes: any, done?: () => void) { done?.(); } reset() {} dispose() {} focus() {}
  onData(callback: any) { this.data = callback; return { dispose() {} }; }
  onBinary(callback: any) { this.binary = callback; return { dispose() {} }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
const mounted: any[] = [];
function walk(node: ReactNode, visit: (e: ReactElement<any>) => void) {
  if (Array.isArray(node)) node.forEach(child => walk(child, visit));
  else if (node && typeof node === 'object' && 'props' in node) { const e = node as ReactElement<any>; visit(e); walk(e.props.children, visit); }
}
function mount(component: any, props: any) {
  const h: any = { values: [], effects: [], pending: [], index: 0, props,
    render(next = h.props) {
      h.props = next; h.index = 0; hooks.current = h; const tree = component(next); hooks.current = undefined;
      walk(tree, e => { if (typeof e.type === 'string' && e.props.ref && typeof e.props.ref === 'object') e.props.ref.current ??= {
        clientWidth: 400, clientHeight: 300, width: 400, height: 300, focus() {}, addEventListener() {}, removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }), getContext: () => ({ clearRect() {}, drawImage() {} }),
      }; });
      for (const effect of h.pending.splice(0)) effect(); return tree;
    },
    unmount() { for (const effect of h.effects) effect?.cleanup?.(); h.effects = []; },
  }; mounted.push(h); return h;
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const messages = () => f.sockets.flatMap(socket => socket.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw)));
let gate: boolean;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); f.sockets = []; f.terminals = []; f.raf = []; gate = true;
  f.request.mockImplementation(async (path: string) => path === '/api/me' ? { user: { id: 'actor' } } : { holder: 'human', heldBy: 'actor', transitioning: false });
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  vi.stubGlobal('document', { visibilityState: 'visible', hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => { f.raf.push(run); return f.raf.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { for (const h of mounted.splice(0)) h.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function terminal() {
  const wrapper = mount(HyperTerminal, { computerId: 'bot', driving: true, canInput: () => gate }); const tree = wrapper.render();
  let child: any; walk(tree, e => { if (typeof e.type === 'function' && e.props.computerId) child = e; });
  const h = mount(child.type, child.props); h.render(); return h;
}
it('gates both actual xterm data callbacks at dispatch, preserving a current holder', async () => {
  const h = terminal(); f.terminals[0].data('valid'); f.terminals[0].binary('mouse');
  expect(messages().filter(m => m.type === 'input').map(m => m.data)).toEqual(['valid', 'mouse']);
  gate = false; f.terminals[0].data('other'); f.terminals[0].binary('other');
  expect(messages().filter(m => m.type === 'input')).toHaveLength(2);
  h.unmount(); gate = true; f.terminals[0].data('cached'); expect(messages().filter(m => m.type === 'input')).toHaveLength(2);
});
it('does not let retained terminal callbacks send to another Bot after navigation', () => {
  const h = terminal(), old = f.terminals[0].data;
  h.render({ ...h.props, computerId: 'next' }); old('old');
  expect(messages().filter(m => m.type === 'input')).toEqual([]);
  f.terminals.at(-1).data('new'); expect(messages().filter(m => m.type === 'input').map(m => m.data)).toEqual(['new']);
});
it('keeps legacy terminal callers passive when no current owner guard was supplied', () => {
  const h = terminal(); h.render({ ...h.props, canInput: undefined }); f.terminals[0].data('unknown');
  expect(messages().filter(m => m.type === 'input')).toEqual([]);
});
it('rebinds terminal typing without discarding output, and old ownership callbacks cannot adopt the new owner', () => {
  const h = terminal(); let generation = 1;
  h.render({ ...h.props, canInput: () => generation === 1 }); const old = f.terminals[0].data;
  generation = 2; h.render({ ...h.props, canInput: () => generation === 2 });
  old('cached'); f.terminals[0].data('current');
  expect(f.terminals).toHaveLength(1);
  expect(messages().filter(m => m.type === 'input').map(m => m.data)).toEqual(['current']);
});
async function screen() {
  const h = mount(HyperLiveScreen, { computerId: 'bot', driving: true, canInput: () => gate });
  h.render(); await f.sockets[0].onopen();
  f.sockets[0].onmessage({ data: JSON.stringify({ type: 'frame', data: 'YQ==', width: 400, height: 300 }) }); await settle();
  const canvas = () => { let result: any; walk(h.render(), e => { if (e.type === 'canvas') result = e; }); return result; };
  return { h, canvas };
}
const mouse = () => ({ clientX: 10, clientY: 10, button: 0, buttons: 0, detail: 1, currentTarget: { focus() {} }, preventDefault() {}, nativeEvent: {} });
it('rejects a held screen move after ownership changes, while valid click input still works', async () => {
  const { canvas } = await screen(); const c = canvas();
  c.props.onMouseDown(mouse()); expect(messages().some(m => m.type === 'mouse' && m.event === 'pressed')).toBe(true);
  c.props.onMouseMove(mouse()); gate = false; for (const run of f.raf.splice(0)) run();
  expect(messages().filter(m => m.type === 'mouse' && m.event === 'moved')).toEqual([]);
  c.props.onMouseDown(mouse()); expect(messages().filter(m => m.type === 'mouse' && m.event === 'pressed')).toHaveLength(1);
});
it('rejects cached screen input after Bot navigation and unmount', async () => {
  const { h, canvas } = await screen(); const old = canvas();
  h.render({ ...h.props, computerId: 'next' }); old.props.onMouseDown(mouse());
  expect(messages().filter(m => m.type === 'mouse')).toEqual([]);
  h.unmount(); old.props.onMouseDown(mouse()); expect(messages().filter(m => m.type === 'mouse')).toEqual([]);
});
it.each(['other holder', 'unknown identity', 'unknown heldBy', 'transitioning'])('keeps screen input paused after reconnect with %s', async reason => {
  const { canvas } = await screen(); f.sockets[0].onclose();
  f.request.mockImplementation(async (path: string) => path === '/api/me' ? { user: reason === 'unknown identity' ? null : { id: 'actor' } } : { holder: 'human', heldBy: reason === 'unknown heldBy' ? undefined : reason === 'other holder' ? 'other' : 'actor', transitioning: reason === 'transitioning' });
  await vi.advanceTimersByTimeAsync(500); await f.sockets.at(-1).onopen();
  f.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'frame', data: 'YQ==', width: 400, height: 300 }) }); await settle();
  canvas().props.onMouseDown(mouse()); expect(messages().filter(m => m.type === 'mouse')).toEqual([]);
});
it('preserves current-holder input after a real reconnect ownership read', async () => {
  const { canvas } = await screen(); f.sockets[0].onclose();
  await vi.advanceTimersByTimeAsync(500); await f.sockets.at(-1).onopen();
  f.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'frame', data: 'YQ==', width: 400, height: 300 }) }); await settle();
  canvas().props.onMouseDown(mouse()); expect(messages().filter(m => m.type === 'mouse' && m.event === 'pressed')).toHaveLength(1);
});
it('proves why the pinned real terminal dispatcher needs the authenticated-holder caller gate', async () => {
  // Byte-for-byte pinned agent-computer/src/terminal-socket.ts. Strip types only, without starting a server.
  const source = readFileSync(new URL('./HyperPinnedTerminal.fixture.txt', import.meta.url), 'utf8');
  const js = stripTypeScriptTypes(source);
  const { createTerminalSockets } = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const input = vi.fn();
  const handler = createTerminalSockets({ shellFor: async () => ({}), mayType: () => true, takeControlFirst: 'Take control first', describe: () => '' }).around({ message() {} });
  const ws = { data: { kind: 'terminal', botId: 'isolated-shared-bot', shell: { input } }, send: vi.fn() };
  handler.message(ws, JSON.stringify({ type: 'input', data: 'viewer-B' }));
  expect(input).toHaveBeenCalledWith('viewer-B'); // No actor is carried or checked by this production dispatcher.
  terminal(); gate = false; f.terminals[0].data('viewer-B');
  for (const message of messages()) handler.message(ws, JSON.stringify(message));
  expect(input).toHaveBeenCalledTimes(1);
});
