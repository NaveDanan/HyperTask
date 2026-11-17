import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IpcChannel as C } from '@shared/api';
const mock = vi.hoisted(() => ({ handlers: new Map<string, Function>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: Function) => mock.handlers.set(name, handler), removeHandler: (name: string) => mock.handlers.delete(name) } }));
import { registerHyperOutlookPresenceIpc } from './HyperOutlookPresenceIpc';
const sender = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
const owner = { webContents: sender, isDestroyed: () => false }, event = { sender, senderFrame: sender.mainFrame };
const state = { installed: true, running: false, connected: false };
const presence = { current: vi.fn(() => state), launch: vi.fn(async () => undefined), onChange: vi.fn() };
let dispose: () => void, change: (value: typeof state) => void;
beforeEach(() => { vi.clearAllMocks(); mock.handlers.clear(); presence.onChange.mockImplementation(listener => { change = listener; return vi.fn(); }); dispose = registerHyperOutlookPresenceIpc(presence as never, () => owner as never); });
afterEach(() => dispose());
it('refuses other windows and subframes before reading presence or launching', async () => {
  for (const handle of mock.handlers.values()) for (const from of [{ sender: {}, senderFrame: sender.mainFrame }, { sender, senderFrame: {} }]) expect(await handle(from)).toMatchObject({ ok: false, kind: 'state' });
  expect(presence.current).not.toHaveBeenCalled(); expect(presence.launch).not.toHaveBeenCalled();
});
it('accepts no renderer-supplied arguments, paths, commands or switches', async () => {
  for (const handle of mock.handlers.values()) for (const args of [[{}], ['outlook.exe'], [{ path: 'evil.exe' }], [null], [undefined], [false], [1], [[], {}]]) expect(await handle(event, ...args)).toMatchObject({ ok: false, kind: 'format' });
  expect(presence.current).not.toHaveBeenCalled(); expect(presence.launch).not.toHaveBeenCalled();
});
it('reads current presence, launches, forwards changes and removes handlers', async () => {
  expect(await mock.handlers.get(C.OutlookPresenceRead)!(event)).toEqual({ ok: true, value: state });
  expect(await mock.handlers.get(C.OutlookLaunch)!(event)).toEqual({ ok: true, value: undefined });
  change(state); expect(sender.send).toHaveBeenCalledWith(C.OutlookPresence, state);
  presence.launch.mockRejectedValueOnce(new Error('Could not open Outlook')); expect(await mock.handlers.get(C.OutlookLaunch)!(event)).toMatchObject({ ok: false, message: 'Could not open Outlook' });
  dispose(); expect(mock.handlers.size).toBe(0);
});
