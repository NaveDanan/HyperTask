vi.mock('./HyperOutlookIpc', () => ({ registerHyperOutlookIpc: vi.fn() }));
vi.mock('./HyperOutlookBridge', () => ({ HyperOutlookBridge: class { stop = vi.fn(); } }));
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IpcChannel as C } from '@shared/api';
const f = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), readyCallback: undefined as undefined | (() => Promise<void>), ready: false, listeners: new Set<(state: any) => void>(), window: undefined as any, acquire: vi.fn(), dialog: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: { isPackaged: false, getPath: () => '/tmp/opencode/unused-native-test', getVersion: () => 'test', requestSingleInstanceLock: () => true, on: vi.fn(), whenReady: () => ({ then: (callback: () => Promise<void>) => { f.readyCallback = callback; } }), quit: vi.fn() },
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), setWindowOpenHandler: vi.fn(), setZoomFactor: vi.fn(), getURL: () => 'file:///test/index.html' });
      constructor() { super(); f.window = this; }
      isDestroyed() { return false; } isMinimized() { return false; } show = vi.fn(); focus = vi.fn(); maximize = vi.fn(); loadURL = vi.fn(async () => {}); loadFile = vi.fn(async () => {});
    },
    ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => f.handlers.set(name, callback), on: vi.fn() },
    session: { defaultSession: { webRequest: { onBeforeRequest: vi.fn() } } },
    dialog: { showMessageBox: f.dialog }, clipboard: {}, net: {}, shell: {},
  };
});
vi.mock('./prefs', () => ({ SharedPreferences: class { get = vi.fn(async () => 1); getAll = vi.fn(); set = vi.fn(); setDouble = vi.fn(); remove = vi.fn(); } }));
vi.mock('./core/binary', () => ({ coreBinaryPath: () => '/unused/core' }));
vi.mock('./core/process', async () => { const { EventEmitter } = await import('node:events'); return { CoreProcess: class extends EventEmitter { start = vi.fn(async () => {}); stop = vi.fn(async () => {}); init = vi.fn(async () => 0); request = vi.fn(); log = vi.fn(); } }; });
vi.mock('./window-state', () => ({ restoreWindowBounds: () => ({ rect: { width: 800, height: 800 }, maximized: false }), trackWindowBounds: vi.fn() }));
vi.mock('./capture', () => ({ scheduleCapture: vi.fn() }));
vi.mock('./settings-ipc', () => ({ registerSettingsIpc: vi.fn() }));
vi.mock('./hyper-openbot', () => ({ registerHyperOpenBotFileIpc: vi.fn(), registerHyperOpenBotIpc: () => ({ disconnect: vi.fn() }) }));
vi.mock('./HyperOpenBotServiceIpc', () => ({ registerHyperOpenBotServiceIpc: vi.fn() }));
vi.mock('./HyperOpenBotSession', () => ({ createHyperOpenBotSession: () => ({ acquire: f.acquire, onInvalidate: () => () => {}, beginNativeTransition: () => ({ version: 1, cleared: Promise.resolve() }), completeNativeTransition: vi.fn() }), hyperReadCoreIdentity: vi.fn(), hyperNativeCoreRequest: vi.fn() }));
vi.mock('./HyperOpenBotBackend', () => ({ createHyperOpenBotService: () => ({ snapshot: () => ({ ready: f.ready }), subscribe: (listener: (state: any) => void) => { f.listeners.add(listener); return () => f.listeners.delete(listener); } }) }));
const originalArgv = process.argv;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); f.handlers.clear(); f.listeners.clear(); f.readyCallback = undefined; f.ready = false; f.window = undefined;
  f.acquire.mockResolvedValue({ assertCurrent: vi.fn(), signal: new AbortController().signal }); f.dialog.mockResolvedValue({ response: 1 });
  process.argv = ['node', 'hypertask', 'openbot://open'];
});
afterEach(() => { process.argv = originalArgv; });
it('retains the real launch-return intent through early renderer take and processes it after AI readiness', async () => {
  await import('./index'); await f.readyCallback!();
  const sender = f.window.webContents, event = { sender, senderFrame: sender.mainFrame };
  expect(await f.handlers.get(C.AppTakeLaunchDeepLink)!(event)).toBeNull();
  await Promise.resolve(); expect(f.dialog).not.toHaveBeenCalled();
  await f.handlers.get(C.CoreInit)!(event, { authenticator_type: 2 });
  f.ready = true; for (const listener of f.listeners) listener({ ready: true });
  await vi.waitFor(() => expect(f.dialog).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(sender.send).toHaveBeenCalledWith('hyper-openbot:native-destination', { kind: 'connections', confirmation: 'native-confirmed' }));
  expect(f.acquire).toHaveBeenCalledTimes(2);
  for (const listener of f.listeners) listener({ ready: true }); await Promise.resolve(); expect(f.dialog).toHaveBeenCalledOnce();
});
