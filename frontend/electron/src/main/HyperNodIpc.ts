import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { IpcChannel as C } from '@shared/api';
import { HYPER_NOD_MESSAGES, HYPER_NOD_TEXT_LIMIT, type HyperNodEvent } from '@shared/HyperNod';
import { HyperNodError } from './HyperNodAccess';
import type { HyperNodClient } from './HyperNodClient';
import type { HyperNodLease, HyperNodSession } from './HyperNodSession';
import { SettingsError, toIpcResult } from './settings-error';
const uuid = z.uuid();
export const HyperNodArgs = {
  history: z.strictObject({ threadId: uuid, before: z.iso.datetime({ offset: true }), beforeId: uuid }),
  send: z.strictObject({
    text: z.string().max(HYPER_NOD_TEXT_LIMIT, 'Messages are limited to 100,000 characters.'),
    threadId: uuid, clientMessageId: uuid, replyToMessageId: uuid.optional(),
    answer: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('choices'), choiceIds: z.array(uuid).min(1).max(6), custom: z.literal(true).optional() }),
      z.strictObject({ kind: z.literal('written') }),
      z.strictObject({ kind: z.literal('approval'), approvalId: uuid, approved: z.boolean() }),
    ]).optional(),
  }).refine(value => value.text.trim().length > 0, 'Write a message first.')
    .refine(value => !value.answer || value.replyToMessageId, 'An answer must reply to its question.'),
};
/** The renderer sees the problem's guidance plus Nod's specific reason, never tokens or transport details. */
export function hyperNodFailure(error: unknown): SettingsError {
  if (error instanceof HyperNodError) {
    const guidance = HYPER_NOD_MESSAGES[error.problem];
    return new SettingsError(error.problem === 'operation_failed' ? 'other' : 'state', error.detail && error.detail !== error.problem ? `${guidance} ${error.detail}` : guidance);
  }
  if (error instanceof SettingsError) return error;
  return new SettingsError('other', `${HYPER_NOD_MESSAGES.operation_failed} ${error instanceof Error ? error.message : String(error)}`);
}
export function registerHyperNodIpc(window: () => BrowserWindow | null, sessions: HyperNodSession, client: HyperNodClient) {
  const streams = new Map<WebContents, AbortController>();
  const watched = new WeakSet<WebContents>();
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => event.sender === window()?.webContents && event.senderFrame === event.sender.mainFrame;
  // Lease aborts end every stream and report it; the token and pooled connections are forgotten.
  sessions.onInvalidate(() => client.reset());
  /** Results produced for a replaced identity never reach the renderer. */
  const leased = <T>(event: IpcMainInvokeEvent, run: (lease: HyperNodLease) => Promise<T>) => toIpcResult(async () => {
    if (!trusted(event)) throw new SettingsError('state', 'Untrusted Nod caller refused.');
    try {
      const lease = await sessions.acquire();
      const value = await run(lease);
      lease.assertCurrent();
      return value;
    } catch (error) { throw hyperNodFailure(error); }
  });
  const parse = <T extends z.ZodType>(schema: T, args: unknown): z.output<T> => {
    const valid = schema.safeParse(args);
    if (!valid.success) throw new SettingsError('format', valid.error.issues[0]?.message ?? 'Invalid Nod request.');
    return valid.data;
  };
  ipcMain.handle(C.NodStatus, event => toIpcResult(async () => {
    if (!trusted(event)) throw new SettingsError('state', 'Untrusted Nod caller refused.');
    let lease: HyperNodLease;
    try { lease = await sessions.acquire(); }
    catch (error) { if (error instanceof HyperNodError) return { ready: false, problem: error.problem }; throw hyperNodFailure(error); }
    try { const status = await client.status(lease.signal); lease.assertCurrent(); return status; }
    catch (error) { throw hyperNodFailure(error); }
  }));
  ipcMain.handle(C.NodState, event => leased(event, lease => client.state(lease.signal)));
  ipcMain.handle(C.NodHistory, (event, args: unknown) => leased(event, lease => client.history(parse(HyperNodArgs.history, args), lease.signal)));
  ipcMain.handle(C.NodSend, (event, args: unknown) => leased(event, lease => client.send(parse(HyperNodArgs.send, args), lease.signal)));
  ipcMain.handle(C.NodStop, event => leased(event, lease => client.stop(lease.signal)));
  ipcMain.handle(C.NodSubscribe, event => leased(event, async lease => {
    const sender = event.sender;
    streams.get(sender)?.abort(new Error('Nod events resubscribed'));
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, lease.signal]);
    streams.set(sender, controller);
    if (!watched.has(sender)) { watched.add(sender); sender.once('destroyed', () => { streams.get(sender)?.abort(); streams.delete(sender); }); }
    const send = (value: HyperNodEvent) => { if (!sender.isDestroyed()) sender.send(C.NodEvent, value); };
    // A renderer's own close or resubscribe is silent; a lost connection or identity change is reported.
    const ended = (reason: string) => { if (!controller.signal.aborted) send({ type: 'disconnected', reason }); };
    void client.events(signal, value => { if (!signal.aborted) send(value); }).then(
      () => ended(lease.signal.aborted ? HYPER_NOD_MESSAGES.signed_out : 'Nod closed the event stream.'),
      error => ended(hyperNodFailure(lease.signal.aborted ? new HyperNodError('signed_out') : error).message),
    ).finally(() => { if (streams.get(sender) === controller) streams.delete(sender); });
  }));
  ipcMain.on(C.NodUnsubscribe, event => {
    if (!trusted(event)) return;
    streams.get(event.sender)?.abort(new Error('Nod events closed'));
    streams.delete(event.sender);
  });
}
