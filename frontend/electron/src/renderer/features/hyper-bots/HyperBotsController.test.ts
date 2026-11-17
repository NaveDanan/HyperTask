import { beforeEach, expect, it, vi } from 'vitest';
import type { IpcResult } from '@shared/api';
import { HYPER_BOTS_DEFAULT_SETTINGS, hyperBotsWithDirectRooms, type HyperBotsApi, type HyperBotsEvent, type HyperBotsSnapshot } from '@shared/HyperBots';
import { HyperBotsController, HyperBotsOutbox, hyperBotsDraftAfterSend, hyperBotsOutbox } from './HyperBotsController';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ok = <T,>(value: T): IpcResult<T> => ({ ok: true, value });
const fail = (message: string): IpcResult<never> => ({ ok: false, kind: 'other', message });
const snapshot = (patch: Partial<HyperBotsSnapshot> = {}): HyperBotsSnapshot => ({
  settings: HYPER_BOTS_DEFAULT_SETTINGS, roomId: 'ops', messages: [], runs: [], approvals: [],
  connections: { model: { ready: true, detail: 'gpt-x at https://host/v1', defaultModel: 'gpt-x' }, outlook: { ready: true, detail: 'Classic Outlook' }, jira: { ready: true, detail: 'OPS', projectKey: 'OPS' } }, ...patch,
});
const posted = ok({ message: {} as never, created: true, runs: [] });
let listener: (event: HyperBotsEvent) => void;
let off: ReturnType<typeof vi.fn>;
let api: { [K in keyof HyperBotsApi]: ReturnType<typeof vi.fn> };
let ids: number;
let outbox: HyperBotsOutbox;
const controller = () => new HyperBotsController(api as unknown as HyperBotsApi, outbox, () => id(900 + ids++));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let settle: (value: IpcResult<unknown>) => void = () => {}; const promise = new Promise<IpcResult<unknown>>(resolve => { settle = resolve; }); return { promise, settle }; };
beforeEach(() => {
  ids = 0; outbox = new HyperBotsOutbox(); off = vi.fn();
  api = {
    open: vi.fn(async () => ok(snapshot())), snapshot: vi.fn(async () => ok(snapshot())), post: vi.fn(async () => posted),
    decide: vi.fn(async () => ok({})), saveSettings: vi.fn(async (settings: unknown) => ok(settings)), models: vi.fn(async () => ok(['gpt-x', 'gpt-y'])),
    onEvent: vi.fn(next => { listener = next; return off; }),
  };
});
async function opened(bots = controller()) { await bots.start(); return bots; }
it('listens before opening the room, loads models once, and refreshes for events that arrived while opening', async () => {
  let release: (value: IpcResult<HyperBotsSnapshot>) => void = () => {};
  api.open.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const bots = controller();
  const starting = bots.start();
  expect(api.onEvent.mock.invocationCallOrder[0]).toBeLessThan(api.open.mock.invocationCallOrder[0]);
  expect(api.open).toHaveBeenCalledWith({ roomId: undefined });
  expect(bots.getState().phase).toBe('opening');
  listener({ type: 'message', roomId: 'ops', messageId: id(1) });
  release(ok(snapshot()));
  await starting;
  expect(bots.getState()).toMatchObject({ phase: 'ready', snapshot: { roomId: 'ops' }, models: ['gpt-x', 'gpt-y'] });
  expect(api.snapshot).toHaveBeenCalledWith({ roomId: 'ops' });
  bots.dispose();
  await bots.start();
  expect(api.models).toHaveBeenCalledOnce();
  expect(api.open).toHaveBeenLastCalledWith({ roomId: 'ops' });
});
it('shows an open failure as syncError and opens again on reload', async () => {
  api.open.mockResolvedValueOnce(fail('Untrusted Bots caller refused.'));
  const bots = await opened();
  expect(bots.getState()).toMatchObject({ phase: 'unavailable', snapshot: null, syncError: 'Untrusted Bots caller refused.' });
  await bots.reload();
  expect(api.open).toHaveBeenCalledTimes(2);
  expect(bots.getState()).toMatchObject({ phase: 'ready', syncError: undefined });
});
it('coalesces event bursts into one read plus one follow-up and ignores other rooms', async () => {
  const bots = await opened();
  let release: (value: IpcResult<HyperBotsSnapshot>) => void = () => {};
  api.snapshot.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  listener({ type: 'message', roomId: 'elsewhere', messageId: id(1) });
  expect(api.snapshot).not.toHaveBeenCalled();
  for (let n = 0; n < 5; n++) listener({ type: 'run', roomId: 'ops', runId: id(n), status: 'running' });
  listener({ type: 'settings' });
  expect(api.snapshot).toHaveBeenCalledOnce();
  release(ok(snapshot({ messages: [] })));
  await vi.waitFor(() => expect(api.snapshot).toHaveBeenCalledTimes(2));
  release(ok(snapshot()));
  await flush();
  expect(api.snapshot).toHaveBeenCalledTimes(2);
  api.snapshot.mockResolvedValueOnce(fail('The room could not be read.'));
  await bots.refresh();
  expect(bots.getState().syncError).toBe('The room could not be read.');
});
it('starts again after dispose, as a StrictMode replay does, and drops results from before', async () => {
  const bots = controller();
  let release: (value: IpcResult<HyperBotsSnapshot>) => void = () => {};
  api.open.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const replayed = bots.start();
  bots.dispose();
  expect(off).toHaveBeenCalledOnce();
  await bots.start();
  release(ok(snapshot({ roomId: 'stale' })));
  await replayed;
  expect(bots.getState().snapshot?.roomId).toBe('ops');
  expect(api.onEvent).toHaveBeenCalledTimes(2);
  bots.dispose();
  listener({ type: 'settings' });
  expect(api.snapshot).not.toHaveBeenCalled();
});
it('keeps one client message ID across failed retries and a new one for changed text', async () => {
  const bots = await opened();
  api.post.mockResolvedValueOnce(fail('The room did not answer.'));
  expect(await bots.send('File it', 'gpt-y')).toBe(false);
  expect(bots.getState()).toMatchObject({ sending: false, error: 'The room did not answer.' });
  expect(await bots.send('File it', 'gpt-y')).toBe(true);
  expect(bots.getState().error).toBeUndefined();
  expect(await bots.send('File it', null)).toBe(true);
  api.post.mockResolvedValueOnce(fail('x'));
  await bots.send('Other', null);
  await bots.send('Other again', null);
  expect(api.post.mock.calls.map(([input]) => input.clientMessageId)).toEqual([id(900), id(900), id(901), id(902), id(903)]);
  expect(api.post.mock.calls[0][0]).toEqual({ roomId: 'ops', clientMessageId: id(900), text: 'File it', model: 'gpt-y' });
  expect(api.post.mock.calls[2][0].model).toBeNull();
  expect(await bots.send('   ', null)).toBe(false);
});
it('reuses an uncertain post\'s ID after the page is reopened, until the room accepts it', async () => {
  const first = await opened();
  api.post.mockResolvedValueOnce(fail('The response was interrupted.'));
  await first.send('Book it');
  first.dispose();
  const reopened = await opened(controller());
  await reopened.send('Book it');
  await reopened.send('Book it');
  expect(api.post.mock.calls.map(([input]) => input.clientMessageId)).toEqual([id(900), id(900), id(901)]);
  expect(outbox.list('ops')).toEqual([]);
});
it('counts an attempt that failed after an identical overlapping attempt was accepted as sent', async () => {
  const first = await opened();
  let settleFirst: (value: IpcResult<unknown>) => void = () => {};
  let settleSecond: (value: IpcResult<unknown>) => void = () => {};
  api.post.mockImplementationOnce(() => new Promise(resolve => { settleFirst = resolve; })).mockImplementationOnce(() => new Promise(resolve => { settleSecond = resolve; }));
  const a = first.send('Book it');
  first.dispose();
  const reopened = await opened(controller());
  const b = reopened.send('Book it');
  settleFirst(posted);
  await a;
  settleSecond(fail('interrupted'));
  expect(await b).toBe(true);
  expect(reopened.getState().error).toBeUndefined();
  expect(api.post.mock.calls.map(([input]) => input.clientMessageId)).toEqual([id(900), id(900)]);
  expect(outbox.list('ops')).toEqual([]);
});
it('audit #2: a send accepted by a closed page after Bots reopened clears the draft, and the retry reused its ID', async () => {
  outbox.setDraft('ops', 'File OPS-1');
  const first = await opened();
  const late = deferred(), retry = deferred();
  api.post.mockImplementationOnce(() => late.promise).mockImplementationOnce(() => retry.promise);
  const a = first.send('File OPS-1', 'gpt-y');
  first.dispose(); // Bots closed while the post is in flight
  const reopened = await opened(controller());
  expect(outbox.draft('ops')).toBe('File OPS-1'); // the new composer reads the store, not a copy
  const b = reopened.send('File OPS-1', 'gpt-y');
  expect(outbox.list('ops')).toMatchObject([{ clientMessageId: id(900), state: 'sending', attempts: 2 }]);
  retry.settle(fail('The response was interrupted.'));
  expect(await b).toBe(false);
  expect(outbox.list('ops')).toMatchObject([{ clientMessageId: id(900), state: 'sending', attempts: 1 }]);
  expect(outbox.draft('ops')).toBe('File OPS-1');
  const seen = vi.fn(() => outbox.draft('ops'));
  outbox.subscribe(seen);
  late.settle(posted); // the disposed controller learns of success
  expect(await a).toBe(true);
  expect(seen).toHaveLastReturnedWith('');
  expect(outbox.draft('ops')).toBe('');
  expect(outbox.list('ops')).toEqual([]);
  expect(api.post.mock.calls.map(([input]) => input.clientMessageId)).toEqual([id(900), id(900)]);
});
it('audit #2: the old page succeeding before the reopened page retries leaves nothing stale to send under a new ID', async () => {
  outbox.setDraft('ops', 'Book it');
  const first = await opened();
  const late = deferred();
  api.post.mockImplementationOnce(() => late.promise);
  const a = first.send('Book it');
  first.dispose();
  const reopened = await opened(controller());
  late.settle(posted);
  await a;
  expect(outbox.draft('ops')).toBe('');
  expect(await reopened.send(outbox.draft('ops'))).toBe(false);
  expect(api.post).toHaveBeenCalledOnce();
});
it('audit #2: a draft typed while the send was in flight survives its acceptance', async () => {
  outbox.setDraft('ops', 'Book it');
  const bots = await opened();
  const late = deferred();
  api.post.mockImplementationOnce(() => late.promise);
  const sending = bots.send('Book it');
  outbox.setDraft('ops', 'Book it and more');
  late.settle(posted);
  expect(await sending).toBe(true);
  expect(outbox.draft('ops')).toBe('Book it and more');
});
it('audit #2: two different uncertain texts each keep their own ID for their own retry', async () => {
  const bots = await opened();
  api.post.mockResolvedValueOnce(fail('interrupted')).mockResolvedValueOnce(fail('interrupted'));
  await bots.send('First');
  await bots.send('Second');
  expect(outbox.list('ops')).toMatchObject([{ text: 'First', clientMessageId: id(900), state: 'uncertain' }, { text: 'Second', clientMessageId: id(901), state: 'uncertain' }]);
  const reopened = await opened(controller());
  expect(await reopened.send('First')).toBe(true);
  expect(await reopened.send('Second')).toBe(true);
  expect(await reopened.send('First', 'gpt-y')).toBe(true); // another model is another message
  expect(api.post.mock.calls.map(([input]) => input.clientMessageId)).toEqual([id(900), id(901), id(900), id(901), id(902)]);
  expect(outbox.list('ops')).toEqual([]);
});
it('keeps one outbox per signed-in user and the composer model in it', () => {
  expect(hyperBotsOutbox('42')).toBe(hyperBotsOutbox('42'));
  expect(hyperBotsOutbox('43')).not.toBe(hyperBotsOutbox('42'));
  const seen = vi.fn();
  outbox.subscribe(seen);
  outbox.setModel('gpt-y');
  outbox.setModel('gpt-y');
  expect(outbox.getModel()).toBe('gpt-y');
  expect(seen).toHaveBeenCalledOnce();
});
it('marks each approval busy while its decision is in flight and refuses a second click', async () => {
  const bots = await opened();
  let settle: (value: IpcResult<unknown>) => void = () => {};
  api.decide.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const deciding = bots.decide(id(5), true);
  expect(bots.getState().deciding).toEqual([id(5)]);
  expect(await bots.decide(id(5), false)).toBe(false);
  api.decide.mockResolvedValueOnce(fail('This approval is no longer pending.'));
  expect(await bots.decide(id(6), false)).toBe(false);
  expect(bots.getState()).toMatchObject({ deciding: [id(5)], error: 'This approval is no longer pending.' });
  settle(ok({}));
  expect(await deciding).toBe(true);
  expect(bots.getState().deciding).toEqual([]);
  expect(api.decide.mock.calls.map(([args]) => args)).toEqual([{ approvalId: id(5), approved: true }, { approvalId: id(6), approved: false }]);
});
it('saves settings, applies the saved copy, and keeps a refusal as settingsError', async () => {
  const bots = await opened();
  const next = { ...HYPER_BOTS_DEFAULT_SETTINGS, policy: { outlook_list_events: 'allow' as const } };
  api.snapshot.mockImplementation(() => new Promise(() => {}));
  expect(await bots.saveSettings(next)).toBe(true);
  expect(bots.getState()).toMatchObject({ saving: false, snapshot: { settings: next } });
  api.saveSettings.mockResolvedValueOnce(fail('A bot needs a name.'));
  expect(await bots.saveSettings(next)).toBe(false);
  expect(bots.getState()).toMatchObject({ saving: false, settingsError: 'A bot needs a name.' });
});
it('clears only the sent draft, keeping anything typed while sending', () => {
  expect(hyperBotsDraftAfterSend('Hello', 'Hello')).toBe('');
  expect(hyperBotsDraftAfterSend('Hello, and also', 'Hello')).toBe('Hello, and also');
});
it('a rejected invoke (no handler, closing window) never leaves the page opening or busy', async () => {
  const gone = () => Promise.reject(new Error("No handler registered for 'hyper-bots:open'"));
  api.open.mockImplementationOnce(gone);
  api.models.mockImplementationOnce(gone);
  const bots = await opened();
  await flush();
  expect(bots.getState()).toMatchObject({ phase: 'unavailable', syncError: expect.stringContaining('No handler registered') });
  await bots.start();
  expect(bots.getState().phase).toBe('ready');
  api.post.mockImplementationOnce(gone);
  expect(await bots.send('hello')).toBe(false);
  expect(bots.getState()).toMatchObject({ sending: false, error: expect.stringContaining('No handler') });
  const firstId = api.post.mock.calls[0]![0].clientMessageId;
  expect(await bots.send('hello')).toBe(true);
  expect(api.post.mock.calls[1]![0].clientMessageId).toBe(firstId);
  api.decide.mockImplementationOnce(gone);
  expect(await bots.decide(id(5), true)).toBe(false);
  expect(bots.getState().deciding).toEqual([]);
  api.saveSettings.mockImplementationOnce(gone);
  expect(await bots.saveSettings(HYPER_BOTS_DEFAULT_SETTINGS)).toBe(false);
  expect(bots.getState().saving).toBe(false);
  api.snapshot.mockImplementationOnce(gone);
  await bots.refresh();
  expect(bots.getState().syncError).toMatch(/No handler/);
});

it('selects direct/group rooms, preserves per-room drafts, and ignores a late previous selection', async () => {
  const settings = hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS);
  api.open.mockImplementation(async ({ roomId }: { roomId?: string }) => ok(snapshot({ settings, roomId: roomId ?? 'ops' })));
  api.snapshot.mockImplementation(async ({ roomId }: { roomId: string }) => ok(snapshot({ settings, roomId })));
  const bots = await opened();
  outbox.setDraft('ops', 'Group draft'); outbox.setDraft('dm-scout', 'Scout draft');
  const late = deferred(); api.open.mockImplementationOnce(() => late.promise);
  const first = bots.select('dm-scout');
  await bots.select('dm-scribe');
  late.settle(ok(snapshot({ settings, roomId: 'dm-scout' }))); await first;
  expect(bots.getState().snapshot?.roomId).toBe('dm-scribe');
  await bots.select('dm-scout');
  expect(bots.getState().snapshot?.roomId).toBe('dm-scout');
  expect(outbox.draft('ops')).toBe('Group draft'); expect(outbox.draft('dm-scout')).toBe('Scout draft');
  expect(bots.getState().summaries?.['dm-scout']?.unread).toBe(false);
  await bots.select('missing'); expect(bots.getState().snapshot?.roomId).toBe('dm-scout');
});
it('sweeps the other rooms once, coalesces their events, marks unread and clears it on selection', async () => {
  const settings = hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS);
  api.open.mockImplementation(async ({ roomId }: { roomId?: string }) => ok(snapshot({ settings, roomId: roomId ?? 'ops' })));
  api.snapshot.mockImplementation(async ({ roomId }: { roomId: string }) => ok(snapshot({ settings, roomId, messages: [{ id: id(50), roomId, text: 'Last message', author: { kind: 'bot', botId: 'scout' }, clientMessageId: id(51), runId: null, model: null, hop: 0, createdAt: '2026-11-17T10:00:00Z' }], approvals: [{ status: 'pending' } as never], runs: [{ status: 'running' } as never] })));
  const bots = await opened(); await flush();
  expect(api.snapshot.mock.calls.map(([args]) => args.roomId).sort()).toEqual(['dm-scout', 'dm-scribe']);
  expect(bots.getState().summaries?.['dm-scout']).toEqual({ preview: 'Last message', pendingApprovals: 1, activeRun: true, unread: false });
  const late = deferred(); api.snapshot.mockImplementationOnce(() => late.promise);
  for (let i = 0; i < 5; i++) listener({ type: 'message', roomId: 'dm-scout', messageId: id(i) });
  expect(bots.getState().summaries?.['dm-scout']?.unread).toBe(true);
  expect(bots.getState().snapshot?.roomId).toBe('ops');
  expect(api.snapshot).toHaveBeenCalledTimes(3);
  late.settle(ok(snapshot({ settings, roomId: 'dm-scout' }))); await flush();
  expect(api.snapshot).toHaveBeenCalledTimes(4);
  expect(bots.getState().summaries?.['dm-scout']?.unread).toBe(true);
  await bots.select('dm-scout');
  expect(bots.getState().summaries?.['dm-scout']?.unread).toBe(false);
  const before = api.snapshot.mock.calls.length; bots.dispose();
  listener({ type: 'message', roomId: 'dm-scribe', messageId: id(20) });
  expect(api.snapshot).toHaveBeenCalledTimes(before);
});
it('a send completing after navigation clears only the originating draft and retains its retry ID', async () => {
  const settings = hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS);
  api.open.mockImplementation(async ({ roomId }: { roomId?: string }) => ok(snapshot({ settings, roomId: roomId ?? 'ops' })));
  api.snapshot.mockImplementation(async ({ roomId }: { roomId: string }) => ok(snapshot({ settings, roomId })));
  const bots = await opened(), late = deferred();
  outbox.setDraft('ops', 'For the group'); outbox.setDraft('dm-scout', 'For Scout');
  api.post.mockImplementationOnce(() => late.promise);
  const sending = bots.send('For the group', 'gpt-y'); await bots.select('dm-scout');
  late.settle(posted); expect(await sending).toBe(true);
  expect(outbox.draft('ops')).toBe(''); expect(outbox.draft('dm-scout')).toBe('For Scout');
  expect(api.post.mock.calls[0]![0]).toMatchObject({ roomId: 'ops', clientMessageId: id(900), model: 'gpt-y' });
  expect(bots.getState()).toMatchObject({ snapshot: { roomId: 'dm-scout' }, sending: false });
});
it('falls back to a surviving direct room after settings remove the selected room', async () => {
  const settings = hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS);
  api.open.mockImplementation(async ({ roomId }: { roomId?: string }) => ok(snapshot({ settings, roomId: roomId ?? 'ops' })));
  api.snapshot.mockImplementation(async ({ roomId }: { roomId: string }) => ok(snapshot({ settings, roomId })));
  const bots = await opened();
  const next = { ...settings, rooms: settings.rooms.filter(room => room.id !== 'ops') };
  await bots.saveSettings(next);
  expect(bots.getState().snapshot?.roomId).toBe('dm-scout');
});

it('a late pre-save snapshot cannot erase a newly created direct room or its settings', async () => {
  const settings = hyperBotsWithDirectRooms(HYPER_BOTS_DEFAULT_SETTINGS);
  api.open.mockImplementation(async ({ roomId }: { roomId?: string }) => ok(snapshot({ settings, roomId: roomId ?? 'ops' })));
  api.snapshot.mockImplementation(async ({ roomId }: { roomId: string }) => ok(snapshot({ settings, roomId })));
  const bots = await opened(); await flush();
  const late = deferred(); api.snapshot.mockImplementationOnce(() => late.promise);
  const reading = bots.refresh();
  const next = hyperBotsWithDirectRooms({ ...settings, bots: [...settings.bots, { ...settings.bots[0]!, id: 'new', name: 'New' }] });
  api.snapshot.mockImplementation(async ({ roomId }: { roomId: string }) => ok(snapshot({ settings: next, roomId })));
  expect(await bots.saveSettings(next)).toBe(true);
  late.settle(ok(snapshot({ settings }))); await reading;
  expect(bots.getState().snapshot?.settings).toEqual(next);
  await bots.select('dm-new'); expect(api.open).toHaveBeenLastCalledWith({ roomId: 'dm-new' });
});
