import { beforeEach, expect, it, vi } from 'vitest';
import { IpcChannel as C } from '@shared/api';
const mock = vi.hoisted(() => ({ handlers: new Map<string, Function>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: Function) => mock.handlers.set(name, handler) } }));
import { registerHyperOutlookIpc } from './HyperOutlookIpc';
const sender = { mainFrame: {} }, bridge = { request: vi.fn(async () => null) }, event = { sender, senderFrame: sender.mainFrame };
beforeEach(() => { vi.clearAllMocks(); mock.handlers.clear(); registerHyperOutlookIpc(bridge as never, () => ({ webContents: sender }) as never); });
it('refuses other windows and subframes for every Outlook operation', async () => {
  for (const handler of mock.handlers.values()) {
    expect(await handler({ sender: {}, senderFrame: sender.mainFrame })).toMatchObject({ ok: false, kind: 'state' });
    expect(await handler({ sender, senderFrame: {} })).toMatchObject({ ok: false, kind: 'state' });
  }
  expect(bridge.request).not.toHaveBeenCalled();
});
it('validates dates, closed patches, ids, and explicit send consent before dispatch', async () => {
  const create = { subject: 'HyperTask test', start: '2026-11-16T12:00:00Z', end: '2026-11-16T13:00:00Z', allDay: false, location: '', body: '', attendees: [], send: false };
  const invalid = [[C.OutlookList, { start: create.end, end: create.start }], [C.OutlookOpen, { id: 'ABCD', code: 'Send()' }], [C.OutlookCreate, { ...create, attendees: ['person@example.invalid'] }], [C.OutlookCreate, { ...create, allDay: true }], [C.OutlookUpdate, { id: 'ABCD', expectedLastModified: create.start, send: true, patch: { attendees: [] } }], [C.OutlookRespond, { id: 'ABCD', send: true, response: 'send' }], [C.OutlookDelete, { id: 'ABCD' }]] as const;
  for (const [channel, args] of invalid) expect(await mock.handlers.get(channel)!(event, args)).toMatchObject({ ok: false, kind: 'format' });
  expect(bridge.request).not.toHaveBeenCalled();
  expect(await mock.handlers.get(C.OutlookCreate)!(event, create)).toEqual({ ok: true, value: null }); expect(bridge.request).toHaveBeenCalledWith('create', create);
});
it('serializes status and bridge errors as IpcResult', async () => {
  expect(await mock.handlers.get(C.OutlookStatus)!(event)).toEqual({ ok: true, value: null });
  bridge.request.mockRejectedValueOnce(new Error('Outlook unavailable') as never);
  expect(await mock.handlers.get(C.OutlookOpen)!(event, { id: 'ABCD|2026-11-16T12:00:00.0000000Z' })).toMatchObject({ ok: false, message: 'Outlook unavailable' });
});
