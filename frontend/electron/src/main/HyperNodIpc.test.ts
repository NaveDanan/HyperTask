import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { IpcChannel as C } from '@shared/api';
import type { HyperNodEvent } from '@shared/HyperNod';
const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => ipc.handlers.set(name, fn), on: (name: string, fn: (...args: any[]) => any) => ipc.events.set(name, fn) } }));
import { HyperNodError } from './HyperNodAccess';
import { HyperNodSession } from './HyperNodSession';
import { registerHyperNodIpc } from './HyperNodIpc';
const THREAD = '11111111-1111-4111-8111-111111111111';
const MESSAGE = '33333333-3333-4333-8333-333333333333';
beforeEach(() => { ipc.handlers.clear(); ipc.events.clear(); });
function setup(identity: () => string | null = () => '["local","a"]') {
  const sessions = new HyperNodSession({ readIdentity: async () => identity(), bindOwner: async () => {} });
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, send: vi.fn() });
  const event = { sender, senderFrame: sender.mainFrame };
  let emit: (event: HyperNodEvent) => void = () => {};
  let finish: (error?: unknown) => void = () => {};
  const client = {
    reset: vi.fn(), state: vi.fn(async () => ({ threadId: THREAD })), history: vi.fn(), stop: vi.fn(),
    send: vi.fn(async () => ({ threadId: THREAD, turnId: MESSAGE, messageId: MESSAGE })),
    status: vi.fn(async () => ({ ready: true, problem: 'none' })),
    events: vi.fn((signal: AbortSignal, next: (event: HyperNodEvent) => void) => new Promise<void>((resolve, reject) => {
      emit = next; finish = error => error ? reject(error) : resolve();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })),
  };
  registerHyperNodIpc(() => ({ webContents: sender }) as never, sessions, client as never);
  const call = (channel: string, args?: unknown, from: object = event) => ipc.handlers.get(channel)!(from, args);
  return { sessions, sender, event, client, call, emit: (value: HyperNodEvent) => emit(value), finish: (error?: unknown) => finish(error) };
}
it('refuses untrusted frames before any identity or Nod work', async () => {
  const read = vi.fn(() => '["local","a"]');
  const h = setup(read);
  const subframe = { sender: h.sender, senderFrame: {} };
  for (const channel of [C.NodStatus, C.NodState, C.NodSend, C.NodStop, C.NodSubscribe]) expect(await h.call(channel, undefined, subframe)).toEqual({ ok: false, kind: 'state', message: 'Untrusted Nod caller refused.' });
  expect(read).not.toHaveBeenCalled();
  expect(h.client.state).not.toHaveBeenCalled();
});
it('validates send arguments strictly and passes only the parsed input', async () => {
  const h = setup();
  const base = { text: 'Hi', threadId: THREAD, clientMessageId: MESSAGE };
  for (const args of [{ ...base, text: '   ' }, { ...base, threadId: 'x' }, { ...base, extra: 1 }, { ...base, answer: { kind: 'written' } }, { ...base, replyToMessageId: MESSAGE, answer: { kind: 'choices', choiceIds: [] } }, { ...base, text: 'x'.repeat(100_001) }]) {
    expect(await h.call(C.NodSend, args)).toMatchObject({ ok: false, kind: 'format' });
  }
  expect(h.client.send).not.toHaveBeenCalled();
  expect(await h.call(C.NodSend, { ...base, replyToMessageId: MESSAGE, answer: { kind: 'approval', approvalId: THREAD, approved: true } })).toEqual({ ok: true, value: { threadId: THREAD, turnId: MESSAGE, messageId: MESSAGE } });
  expect(h.client.send).toHaveBeenCalledWith({ ...base, replyToMessageId: MESSAGE, answer: { kind: 'approval', approvalId: THREAD, approved: true } }, expect.any(AbortSignal));
});
it('reports a signed-out status without contacting Nod, and explains failures with their reason', async () => {
  let identity: string | null = null;
  const h = setup(() => identity);
  expect(await h.call(C.NodStatus)).toEqual({ ok: true, value: { ready: false, problem: 'signed_out' } });
  expect(h.client.status).not.toHaveBeenCalled();
  identity = '["local","a"]';
  h.client.state.mockRejectedValueOnce(new HyperNodError('operation_failed', 'Nod returned 500 for GET /api/state.'));
  expect(await h.call(C.NodState)).toEqual({ ok: false, kind: 'other', message: 'The Nod request failed. Nod returned 500 for GET /api/state.' });
  h.client.state.mockRejectedValueOnce(new HyperNodError('unreachable'));
  expect(await h.call(C.NodState)).toMatchObject({ ok: false, kind: 'state', message: expect.stringMatching(/^Nod is not responding on the VM/) });
});
it('drops a result produced across an identity change', async () => {
  const h = setup();
  let finish: (value: { threadId: string }) => void = () => {};
  h.client.state.mockImplementationOnce(() => new Promise<{ threadId: string }>(resolve => { finish = resolve; }));
  const pending = h.call(C.NodState);
  await vi.waitFor(() => expect(h.client.state).toHaveBeenCalled());
  h.sessions.beginNativeTransition();
  finish({ threadId: THREAD });
  expect(await pending).toMatchObject({ ok: false, message: 'Sign in to HyperTask before using the Nod assistant.' });
  expect(h.client.reset).toHaveBeenCalled();
});
it('forwards live events, reports a lost stream, and stays silent after the renderer closes it', async () => {
  const h = setup();
  expect(await h.call(C.NodSubscribe)).toEqual({ ok: true, value: undefined });
  h.emit({ type: 'refresh' });
  h.finish(new HyperNodError('unreachable', 'The Nod event stream ended: reset'));
  await vi.waitFor(() => expect(h.sender.send).toHaveBeenCalledTimes(2));
  expect(h.sender.send.mock.calls).toEqual([[C.NodEvent, { type: 'refresh' }], [C.NodEvent, { type: 'disconnected', reason: expect.stringContaining('The Nod event stream ended: reset') }]]);
  await h.call(C.NodSubscribe);
  ipc.events.get(C.NodUnsubscribe)!(h.event);
  await new Promise(resolve => setTimeout(resolve, 10));
  h.emit({ type: 'refresh' });
  expect(h.sender.send).toHaveBeenCalledTimes(2);
});
it('reports sign-out on an open stream and resubscribing replaces the earlier stream silently', async () => {
  const h = setup();
  await h.call(C.NodSubscribe);
  await h.call(C.NodSubscribe);
  expect(h.client.events).toHaveBeenCalledTimes(2);
  expect(h.sender.send).not.toHaveBeenCalled();
  h.sessions.beginNativeTransition();
  await vi.waitFor(() => expect(h.sender.send).toHaveBeenCalledOnce());
  expect(h.sender.send).toHaveBeenCalledWith(C.NodEvent, { type: 'disconnected', reason: 'Sign in to HyperTask before using the Nod assistant.' });
});
