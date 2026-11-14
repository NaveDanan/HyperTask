import { createHyperOpenBotSession, hyperReadCoreIdentity, hyperNativeCoreRequest } from './HyperOpenBotSession';
import { registerHyperOpenBotIpc } from './hyper-openbot';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, net, session, shell } from 'electron';
import { IpcChannel as C, type AppInfo, type CoreInitConfig, type FileFilter } from '@shared/api';
import { isVendorUrl } from '@shared/self-hosted-policy';
import { scheduleCapture } from './capture';
import { coreBinaryPath } from './core/binary';
import { CoreProcess } from './core/process';
import { readDeviceId } from './device-id';
import { exportLogs } from './logs';
import { SharedPreferences } from './prefs';
import { restoreWindowBounds, trackWindowBounds } from './window-state';
import { registerSettingsIpc } from './settings-ipc';

const DEEP_LINK_SCHEME = 'appflowy-flutter';

/**
 * Flutter's getApplicationSupportDirectory(): `%APPDATA%\<CompanyName>\<ProductName>` on
 * Windows (windows/runner/Runner.rc), the bundle id directory elsewhere. The core's data,
 * appflowy.yaml and shared_preferences.json live here, shared with the Flutter build.
 */
function supportDirectory(): string {
  // Development/testing: point the app at a scratch directory instead of the real data.
  if (process.env.APPFLOWY_SUPPORT_DIR && !app.isPackaged) return process.env.APPFLOWY_SUPPORT_DIR;
  if (process.platform === 'win32') return path.join(app.getPath('appData'), 'io.appflowy', 'AppFlowy');
  if (process.platform === 'darwin') return path.join(app.getPath('appData'), 'io.appflowy.appflowy');
  return path.join(os.homedir(), '.local', 'share', 'io.appflowy.appflowy');
}

const appRoot = path.resolve(__dirname, '../..');
const prefs = new SharedPreferences(path.join(supportDirectory(), 'shared_preferences.json'));
const core = new CoreProcess(coreBinaryPath(appRoot, app.isPackaged));
let coreStarted: Promise<void> | null = null;
let mainWindow: BrowserWindow | null = null;
let launchDeepLink: string | null = findDeepLink(process.argv);

function findDeepLink(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}:`)) ?? null;
}

function startCore(): Promise<void> {
  coreStarted ??= core.start((chunk) => {
    if (!app.isPackaged) process.stdout.write(chunk);
  });
  return coreStarted;
}

core.on('notification', (payload) => mainWindow?.webContents.send(C.CoreNotification, payload));
core.on('portMessage', (port, value) => mainWindow?.webContents.send(C.CorePortMessage, port, value));
core.on('exit', (code) => {
  console.error(`[core] exited unexpectedly with code ${code}`);
  coreStarted = null;
  mainWindow?.webContents.send(C.CoreExit, code);
});

/** afLaunchUri: refuses vendor hosts and adds https:// when no scheme is given. */
async function openExternal(url: string): Promise<void> {
  const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  if (isVendorUrl(target)) throw new Error('AppFlowy hosted services are disabled in this self-hosted app.');
  await shell.openExternal(target);
}

async function createWindow() {
  const bounds = await restoreWindowBounds(prefs);
  mainWindow = new BrowserWindow({
    ...bounds.rect,
    minWidth: 640,
    minHeight: 640,
    maxWidth: 8192,
    maxHeight: 8192,
    show: false,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#FFFFFF',
    title: 'HyperTask',
    icon: path.join(appRoot, 'resources/hypertask.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  if (bounds.maximized) mainWindow.maximize();
  trackWindowBounds(mainWindow, prefs);
  scheduleCapture(mainWindow);

  const zoom = Number(await prefs.get('scaleFactor'));
  if (Number.isFinite(zoom) && zoom > 0) mainWindow.webContents.setZoomFactor(Math.min(2, Math.max(0.5, zoom)));

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('maximize', () => mainWindow?.webContents.send(C.WindowMaximizedChanged, true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send(C.WindowMaximizedChanged, false));
  mainWindow.on('closed', () => (mainWindow = null));

  // Links open in the system browser, as url_launcher does in the Flutter app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function focusWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerIpc() {
  const openBotSessions = createHyperOpenBotSession(app.getPath('userData'), async () => { await startCore(); return hyperReadCoreIdentity((event, payload) => core.request(event, payload)); });
  registerHyperOpenBotIpc(() => mainWindow, openBotSessions);
  core.on('exit', () => { void openBotSessions.beginNativeTransition().cleared.catch(() => {}); });
  ipcMain.handle(C.CoreInit, async (_, config: CoreInitConfig) => {
    const transition = openBotSessions.beginNativeTransition(false);
    await startCore();
    await transition.cleared;
    const result = await core.init(config);
    openBotSessions.completeNativeTransition(transition.version, result === 0);
    return result;
  });
  ipcMain.handle(C.CoreRequest, (_, event: string, payload: Uint8Array) => hyperNativeCoreRequest(openBotSessions, event, async () => {
    await startCore();
    return core.request(event, payload);
  }));
  ipcMain.on(C.CoreLog, (_, level: number, message: string) => core.log(level, message));

  ipcMain.handle(C.AppInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    paths: {
      appData: app.getPath('appData'),
      documents: app.getPath('documents'),
      home: app.getPath('home'),
      temp: app.getPath('temp'),
      userData: app.getPath('userData'),
      support: supportDirectory(),
    },
  }));
  ipcMain.handle(C.AppDeviceId, () => readDeviceId());
  ipcMain.on(C.AppRelaunch, async () => {
    await core.stop();
    app.relaunch();
    app.exit(0);
  });
  ipcMain.on(C.AppSetZoomFactor, (_, factor: number) => mainWindow?.webContents.setZoomFactor(factor));
  ipcMain.on(C.AppRegisterDeepLinkScheme, () => {
    if (app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    else app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(appRoot)]);
  });
  ipcMain.handle(C.AppTakeLaunchDeepLink, () => {
    const link = launchDeepLink;
    launchDeepLink = null;
    return link;
  });

  ipcMain.handle(C.AppExportLogs, () => exportLogs(supportDirectory()));
  ipcMain.handle(C.AppClearCache, async () => {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'shadercache'] });
  });

  ipcMain.handle(
    C.NetRequest,
    async (_, options: { url: string; method: string; headers?: Record<string, string>; body?: string }) => {
      if (!/^https?:/i.test(options.url) || isVendorUrl(options.url)) {
        throw new Error('AppFlowy hosted services are disabled in this self-hosted app.');
      }
      const response = await net.fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        redirect: 'error',
      });
      return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
    },
  );
  ipcMain.on(C.ClipboardWriteText, (_, text: string) => clipboard.writeText(text));
  ipcMain.handle(C.ClipboardReadText, () => clipboard.readText());

  ipcMain.handle(C.PrefsGetAll, () => prefs.getAll());
  ipcMain.handle(C.PrefsSet, (_, key: string, value: unknown) => prefs.set(key, value));
  ipcMain.handle(C.PrefsSetDouble, (_, key: string, value: number) => prefs.setDouble(key, value));
  ipcMain.handle(C.PrefsRemove, (_, key: string) => prefs.remove(key));

  ipcMain.handle(C.FsExists, async (_, target: string) => {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle(C.FsEnsureDir, (_, target: string) => fs.mkdir(target, { recursive: true }).then(() => undefined));
  ipcMain.handle(C.FsReadText, async (_, target: string) => {
    try {
      return await fs.readFile(target, 'utf8');
    } catch {
      return null;
    }
  });
  ipcMain.handle(C.FsWriteBytes, async (_, target: string, data: Uint8Array) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  });
  ipcMain.handle(C.FsWriteText, async (_, target: string, content: string) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  });

  ipcMain.on(C.WindowMinimize, () => mainWindow?.minimize());
  ipcMain.on(C.WindowToggleMaximize, () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on(C.WindowClose, () => mainWindow?.close());
  ipcMain.handle(C.WindowIsMaximized, () => mainWindow?.isMaximized() ?? false);
  ipcMain.on(C.WindowSetFullScreen, (_, fullScreen: boolean) => mainWindow?.setFullScreen(fullScreen));

  ipcMain.handle(C.ShellOpenExternal, (_, url: string) => openExternal(url));
  ipcMain.handle(C.ShellOpenPath, (_, target: string) => shell.openPath(target));
  ipcMain.on(C.ShellShowItemInFolder, (_, target: string) => shell.showItemInFolder(target));

  ipcMain.handle(C.DialogPickDirectory, async (_, title?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, { title, properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle(
    C.DialogPickFiles,
    async (_, options: { title?: string; filters?: FileFilter[]; multiple?: boolean }) => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: options.title,
        filters: options.filters,
        properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      });
      return result.canceled ? [] : result.filePaths;
    },
  );
  ipcMain.handle(
    C.DialogSaveFile,
    async (_, options: { title?: string; defaultPath?: string; filters?: FileFilter[] }) => {
      const result = await dialog.showSaveDialog(mainWindow!, options);
      return result.canceled ? null : (result.filePath ?? null);
    },
  );

  registerSettingsIpc({
    supportDirectory,
    documentsDirectory: () => app.getPath('documents'),
    getWindow: () => mainWindow,
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch forwards its deep link to this instance and brings the window forward.
  app.on('second-instance', (_, argv) => {
    const link = findDeepLink(argv);
    if (link) mainWindow?.webContents.send(C.AppDeepLink, link);
    focusWindow();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow) mainWindow.webContents.send(C.AppDeepLink, url);
    else launchDeepLink = url;
  });

  app.whenReady().then(async () => {
    // SelfHostedPolicy.installNetworkPolicy: no request may reach AppFlowy hosted services.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: isVendorUrl(details.url) });
    });
    registerIpc();
    void startCore();
    await createWindow();
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void core.stop().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
