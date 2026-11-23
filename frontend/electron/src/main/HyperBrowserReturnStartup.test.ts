vi.mock('./HyperOutlookIpc', () => ({ registerHyperOutlookIpc: vi.fn() }));
vi.mock('./HyperAssistantIpc', () => ({ registerHyperAssistantIpc: vi.fn() }));
vi.mock('./HyperOutlookBridge', () => ({ HyperOutlookBridge: class { stop = vi.fn(); setRunning = vi.fn(); onAvailability = vi.fn(() => () => {}); request = vi.fn(() => new Promise(() => {})); } }));
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IpcChannel as C } from '@shared/api';
const f = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), readyCallback: undefined as undefined | (() => Promise<void>), ready: false, listeners: new Set<(state: any) => void>(), window: undefined as any, acquire: vi.fn(), dialog: vi.fn(), quit: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const emptyImg = { isEmpty: () => true, resize: () => emptyImg };
  return {
    app: { isPackaged: false, commandLine: { appendSwitch: vi.fn() }, getLoginItemSettings: () => ({ wasOpenedAtLogin: false }), setLoginItemSettings: vi.fn(), getPath: () => '/tmp/opencode/unused-native-test', getVersion: () => 'test', requestSingleInstanceLock: () => true, on: vi.fn(), whenReady: () => ({ then: (callback: () => Promise<void>) => { f.readyCallback = callback; } }), quit: f.quit },
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, send: vi.fn(), setWindowOpenHandler: vi.fn(), setZoomFactor: vi.fn(), getURL: () => 'file:///test/index.html' });
      constructor() { super(); if (!f.window) f.window = this; }
      isDestroyed() { return false; } isMinimized() { return false; } isVisible() { return true; } show = vi.fn(); hide = vi.fn(); focus = vi.fn(); maximize = vi.fn(); setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn(); setBounds = vi.fn(); destroy = vi.fn(); loadURL = vi.fn(async () => {}); loadFile = vi.fn(async () => {});
    },
    Tray: class extends EventEmitter { setToolTip = vi.fn(); setContextMenu = vi.fn(); isDestroyed() { return false; } destroy = vi.fn(); },
    Menu: { buildFromTemplate: vi.fn(() => ({})) },
    nativeImage: { createFromPath: () => emptyImg, createEmpty: () => emptyImg },
    globalShortcut: { register: vi.fn(() => true), unregister: vi.fn(), unregisterAll: vi.fn() },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: vi.fn(async () => true) },
    ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => f.handlers.set(name, callback), removeHandler: (name: string) => f.handlers.delete(name), on: vi.fn() },
    session: { defaultSession: { webRequest: { onBeforeRequest: vi.fn() }, setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() } },
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

it('hides mainWindow on close when closeToTray is true, and quits cleanly on closed when closeToTray is false', async () => {
  await import('./index'); await f.readyCallback!();
  const sender = f.window.webContents, event = { sender, senderFrame: sender.mainFrame };

  // Default closeToTray = true: close event is prevented and hides mainWindow without quitting.
  const preventDefault1 = vi.fn();
  f.window.emit('close', { preventDefault: preventDefault1 });
  expect(preventDefault1).toHaveBeenCalledOnce();
  expect(f.window.hide).toHaveBeenCalledOnce();
  expect(f.quit).not.toHaveBeenCalled();

  // Turn off closeToTray via desktop IPC: closing mainWindow allows close and triggers app.quit() on 'closed'.
  await f.handlers.get('hyper-desktop:set-settings')!(event, { closeToTray: false });
  const preventDefault2 = vi.fn();
  f.window.emit('close', { preventDefault: preventDefault2 });
  expect(preventDefault2).not.toHaveBeenCalled();
  f.window.emit('closed');
  expect(f.quit).toHaveBeenCalledOnce();
});
