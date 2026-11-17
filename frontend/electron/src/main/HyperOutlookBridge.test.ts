import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
import { HyperOutlookBridge } from './HyperOutlookBridge';
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
  const [a, b] = requests(process);
  process.stdout.write(JSON.stringify({ id: b.id, ok: true, value: { ...status, userName: 'Návé' } }) + '\n');
  const bytes = Buffer.from(JSON.stringify({ id: a.id, ok: true, value: status }) + '\n'); process.stdout.write(bytes.subarray(0, 20)); process.stdout.write(bytes.subarray(20));
  expect(await first).toEqual(status); expect((await second).userName).toBe('Návé'); expect(mock.spawn).toHaveBeenCalledOnce();
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
it('turns a colour id into the Outlook category write and reads the categories back', async () => {
  const process = child(); mock.spawn.mockReturnValue(process);
  const event = { id: 'ABCD', subject: 'Planning', start: '2026-11-16T08:00:00Z', end: '2026-11-16T09:00:00Z', allDay: false, location: '', body: '', organizer: '', isOrganizer: true, responseStatus: 1, attendees: [], attendeeCount: 0, busyStatus: 2, isRecurring: false, recurrenceState: 0, isCancelled: false, isPrivate: false, joinUrl: null, lastModified: '2026-11-16T07:30:00Z', categories: ['HyperTask Blue'] };
  const call = bridge.request('update', { id: 'ABCD', expectedLastModified: '2026-11-16T07:00:00Z', patch: { color: 'blue' }, send: false });
  const [request] = requests(process);
  expect(request.args.patch).toEqual({ color: { name: 'HyperTask Blue', outlook: 8, owned: expect.arrayContaining(['HyperTask Red', 'HyperTask Gray']) } });
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, value: event }) + '\n'); expect(await call).toMatchObject({ categories: ['HyperTask Blue'] });
  const clear = bridge.request('update', { id: 'ABCD', expectedLastModified: '2026-11-16T07:30:00Z', patch: { color: null }, send: false }), [cleared] = requests(process).slice(1);
  expect(cleared.args.patch.color).toMatchObject({ name: null, outlook: 0 }); process.stdout.write(JSON.stringify({ id: cleared.id, ok: true, value: { ...event, categories: [] } }) + '\n'); await clear;
});

