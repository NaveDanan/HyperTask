import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
import { readFileSync } from 'node:fs';
import { HyperOutlookBridge, HyperOutlookLost } from './HyperOutlookBridge';
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const status = { available: true, userName: 'Test', email: 'test@example.invalid' };
let bridge: HyperOutlookBridge;
function child() { return Object.assign(new EventEmitter(), { stdin: Object.assign(new EventEmitter(), { write: vi.fn() }), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() }); }
function requests(process: ReturnType<typeof child>) { return process.stdin.write.mock.calls.map(([line]) => JSON.parse(line)); }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); Object.defineProperty(process, 'platform', { ...platform, value: 'win32' }); bridge = new HyperOutlookBridge(); });
afterEach(() => { bridge.stop(); vi.useRealTimers(); Object.defineProperty(process, 'platform', platform); });
it('matches replies by id, buffers split UTF-8 lines and reuses a single hidden STA host', async () => {
  const process = child(); mock.spawn.mockReturnValue(process);
  const first = bridge.request('status', undefined), second = bridge.request('status', undefined);
  // One request at a time: the second is sent once the first is answered.
  const [a] = requests(process); expect(requests(process)).toHaveLength(1);
  const bytes = Buffer.from(JSON.stringify({ id: a.id, ok: true, value: status }) + '\n'); process.stdout.write(bytes.subarray(0, 20)); process.stdout.write(bytes.subarray(20));
  expect(await first).toEqual(status);
  const [, b] = requests(process);
  process.stdout.write(JSON.stringify({ id: b.id, ok: true, value: { ...status, userName: 'Návé' } }) + '\n');
  expect((await second).userName).toBe('Návé'); expect(mock.spawn).toHaveBeenCalledOnce();
  expect(mock.spawn.mock.calls[0][1]).toContain('-Sta'); expect(mock.spawn.mock.calls[0][2].windowsHide).toBe(true);
});
it('times out all in-flight calls, kills the host, and reconnects only for a new request', async () => {
  const process = child(); mock.spawn.mockReturnValue(process);
  const call = bridge.request('status', undefined), failed = expect(call).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30000); await failed; expect(process.kill).toHaveBeenCalled(); expect(mock.spawn).toHaveBeenCalledOnce();
  const next = child(); mock.spawn.mockReturnValue(next); const retry = bridge.request('status', undefined); const [request] = requests(next);
  next.stdout.write(JSON.stringify({ id: request.id, ok: true, value: status }) + '\n'); expect(await retry).toEqual(status); expect(mock.spawn).toHaveBeenCalledTimes(2);
});
it('allows 60 seconds for list and fails pending work on exit without replay', async () => {
  const process = child(); mock.spawn.mockReturnValue(process);
  const call = bridge.request('list', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' }), failed = expect(call).rejects.toThrow('Classic Outlook');
  await vi.advanceTimersByTimeAsync(30000); expect(process.kill).not.toHaveBeenCalled(); process.emit('close', 1); await failed;
  const next = child(); mock.spawn.mockReturnValue(next); const retry = bridge.request('status', undefined); const [request] = requests(next);
  next.stdout.write(JSON.stringify({ id: request.id, ok: true, value: status }) + '\n'); await retry;
});
it.each(['not json\n', JSON.stringify({ id: 'x', ok: true, value: {}, injected: true }) + '\n'])('rejects malformed or unexpected protocol frames', async frame => {
  const process = child(); mock.spawn.mockReturnValue(process); const call = bridge.request('status', undefined), failed = expect(call).rejects.toThrow('invalid response'); process.stdout.write(frame); await failed;
});
it('validates operation payloads and maps stale writes to the renderer conflict message', async () => {
  const process = child(); mock.spawn.mockReturnValue(process);
  const call = bridge.request('status', undefined), failed = expect(call).rejects.toThrow('invalid response'); const [request] = requests(process);
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, value: { available: 'yes' } }) + '\n'); await failed;
  const next = child(); mock.spawn.mockReturnValue(next); const conflict = bridge.request('update', { id: 'ABCD', expectedLastModified: '2026-11-16T08:00:00Z', patch: { subject: 'Test' }, send: false }); const rejected = expect(conflict).rejects.toThrow('Changed in Outlook — reloaded');
  const [update] = requests(next); next.stdout.write(JSON.stringify({ id: update.id, ok: false, kind: 'conflict', message: 'hyper_conflict' }) + '\n'); await rejected;
});
it('guards unsupported platforms and rejects invalid input before spawning', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' }); await expect(bridge.request('status', undefined)).rejects.toMatchObject({ kind: 'unsupported' });
  await expect(bridge.request('open', { id: '../unsafe' })).rejects.toMatchObject({ kind: 'format' }); expect(mock.spawn).not.toHaveBeenCalled();
});
it('stops pending requests and never starts another child after shutdown', async () => {
  mock.spawn.mockReturnValue(child()); const call = bridge.request('status', undefined); const rejected = expect(call).rejects.toThrow('stopped'); bridge.stop(); await rejected;
  await expect(bridge.request('status', undefined)).rejects.toThrow('stopped'); expect(mock.spawn).toHaveBeenCalledOnce();
});

it('starts a request\'s timeout when it is sent: a short request queued behind a long one cannot time it out', async () => {
  const process = child(); mock.spawn.mockReturnValue(process);
  const create = bridge.request('create', { subject: 'Teams', start: '2026-11-18T10:00:00Z', end: '2026-11-18T10:30:00Z', allDay: false, location: '', body: '', attendees: [], send: false, onlineMeeting: 'teams' });
  const probe = bridge.request('status', undefined);
  await vi.advanceTimersByTimeAsync(40000);
  expect(process.kill).not.toHaveBeenCalled(); expect(requests(process)).toHaveLength(1);
  const [made] = requests(process);
  const event = { id: 'AB', subject: 'Teams', start: '2026-11-18T10:00:00.000Z', end: '2026-11-18T10:30:00.000Z', allDay: false, location: 'Microsoft Teams Meeting', body: '', organizer: 'Nave', isOrganizer: true, responseStatus: 1,
    attendees: [], attendeeCount: 0, busyStatus: 2, isRecurring: false, recurrenceState: 0, isCancelled: false, isPrivate: false, joinUrl: null, lastModified: '2026-11-17T06:00:00.000Z' };
  process.stdout.write(JSON.stringify({ id: made.id, ok: true, value: event }) + '\n');
  expect(await create).toMatchObject({ id: 'AB' });
  const [, asked] = requests(process); process.stdout.write(JSON.stringify({ id: asked.id, ok: true, value: status }) + '\n');
  expect(await probe).toEqual(status);
});
it('a write that failed after Outlook began it is an unknown outcome; queued requests that never left are definitely not done', async () => {
  const process = child(); mock.spawn.mockReturnValue(process);
  const send = bridge.request('mail.send', { to: ['a@corp.example'], cc: [], subject: 'x', body: 'y', delivery: 'send', account: 'nave@corp.example' });
  const [sent] = requests(process);
  process.stdout.write(JSON.stringify({ id: sent.id, ok: false, kind: 'unknown', message: 'Outlook failed after it began saving or sending.' }) + '\n');
  await expect(send).rejects.toBeInstanceOf(HyperOutlookLost);
  const running = bridge.request('mail.account', undefined), queued = bridge.request('status', undefined);
  const lost = expect(running).rejects.toBeInstanceOf(HyperOutlookLost);
  const notSent = queued.then(() => null, error => error);
  process.emit('close', 1); await lost;
  const error = await notSent;
  expect(error).not.toBeInstanceOf(HyperOutlookLost); expect(error.message).toMatch(/not sent to Outlook/);
});
it('writes the host script as ASCII with a byte order mark, so any Windows code page reads it alike', () => {
  mock.spawn.mockReturnValue(child()); void bridge.request('status', undefined).catch(() => {});
  const args = mock.spawn.mock.calls[0][1] as string[], text = readFileSync(args[args.length - 1], 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(/[^\x00-\x7f]/.test(text.slice(1))).toBe(false);
});

it('fails immediately while presence is closed, resets only the helper, and reconnects on the next new request', async () => {
  const first = child(); mock.spawn.mockReturnValue(first);
  const listeners = vi.fn(), off = bridge.onAvailability(listeners);
  const pending = bridge.request('status', undefined), rejected = expect(pending).rejects.toBeInstanceOf(HyperOutlookLost);
  const queued = bridge.request('status', undefined), notSent = expect(queued).rejects.toThrow('not sent to Outlook');
  bridge.setRunning(false); await rejected; await notSent;
  expect(first.kill).toHaveBeenCalledOnce(); await expect(bridge.request('status', undefined)).rejects.toThrow('Outlook is closed'); expect(mock.spawn).toHaveBeenCalledOnce();
  const next = child(); mock.spawn.mockReturnValue(next); bridge.setRunning(true);
  const retry = bridge.request('status', undefined); const [request] = requests(next);
  // Late output from the old helper cannot satisfy or reset a new request.
  first.stdout.write('invalid old host data\n');
  next.stdout.write(JSON.stringify({ id: request.id, ok: true, value: status }) + '\n');
  expect(await retry).toEqual(status); expect(listeners.mock.calls).toEqual([[false], [true]]); off();
});
it('drops a disconnected COM host without replaying work, then attaches for the next request', async () => {
  const first = child(); mock.spawn.mockReturnValue(first);
  const call = bridge.request('open', { id: 'ABCD' }), rejected = expect(call).rejects.toThrow('0x80010108'); const [sent] = requests(first);
  const queued = bridge.request('status', undefined), unsent = expect(queued).rejects.toThrow('not sent to Outlook');
  first.stdout.write(JSON.stringify({ id: sent.id, ok: false, kind: 'state', message: 'COM 0x80010108 RPC_E_DISCONNECTED' }) + '\n');
  await rejected; await unsent; expect(first.kill).toHaveBeenCalledOnce(); expect(mock.spawn).toHaveBeenCalledOnce();
  const next = child(); mock.spawn.mockReturnValue(next); const retry = bridge.request('status', undefined); const [request] = requests(next);
  next.stdout.write(JSON.stringify({ id: request.id, ok: true, value: status }) + '\n'); expect(await retry).toEqual(status);
});
it('retains the unknown outcome of an in-progress write when presence detects Outlook closing', async () => {
  const host = child(); mock.spawn.mockReturnValue(host);
  const write = bridge.request('mail.send', { to: ['a@corp.example'], cc: [], subject: 'x', body: 'y', delivery: 'send', account: 'nave@corp.example' });
  const unknown = expect(write).rejects.toBeInstanceOf(HyperOutlookLost); bridge.setRunning(false); await unknown;
  expect(mock.spawn).toHaveBeenCalledOnce(); expect(requests(host)).toHaveLength(1);
});
