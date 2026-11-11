import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, powerMonitor, safeStorage, session, shell } from 'electron';
import { IpcChannel as C, type AppInfo, type CoreInitConfig, type FileFilter } from '@shared/api';
import { isVendorUrl } from '@shared/self-hosted-policy';
import { scheduleCapture } from './capture';
import { coreBinaryPath } from './core/binary';
import { CoreProcess } from './core/process';
import { readDeviceId } from './device-id';
import { exportLogs } from './logs';
import { CHECK_INTERVAL, cleanupUpdateCache, createUpdateChecker, launchInstaller, takeInstallError } from './updates';
import { SharedPreferences } from './prefs';
import { restoreWindowBounds, trackWindowBounds } from './window-state';
import { registerSettingsIpc } from './settings-ipc';
import { HyperStartup } from './HyperStartup';
import { HyperTray } from './HyperTray';
import { hyperBindDesktopIdentity } from './HyperDesktopIdentity';
import { hyperInstallYouTubeClient } from './HyperYouTubeClient';
import { HyperRowActivityIpc, HyperRowActivityIpcError, hyperBindRowActivityRenderer, hyperRowActivityTrustedSender } from './HyperRowActivityIpc';
import { createHyperRowActivityNative, hyperRowActivityErrorReply } from './HyperRowActivityNative';
import { HyperBookmarkMetadata } from './HyperBookmarkMetadata';
import { HyperBookmarkThumbnails } from './HyperBookmarkThumbnails';
import { hyperNormalizeBookmarkThumbnail } from './HyperBookmarkThumbnailImage';
import { createHyperBookmarkBackend } from './HyperBookmarkBackend';
import { HyperAICredentials } from './HyperAICredentials';
import { HyperAssets } from './HyperAssets';
import { createHyperCloudPreviewBackend, hyperIsAssetOwnerMutation } from './HyperCloudPreviewBackend';
import { HyperCloudPreviews } from './HyperCloudPreviews';
import { createHyperCloudPreviewDownload, hyperCloudPreviewIpc } from './HyperCloudPreviewIpc';
import { HyperGeneratedImages, hyperCoreCloudBaseUrl, resolveHyperCoreStorageDirectory } from './HyperGeneratedImages';
import { hyperRenderDocumentPdf } from './HyperDocumentPdf';
import { hyperHandleAssetProtocol, hyperRegisterAssetScheme } from './HyperAssetProtocol';

const desktopIdentityBound = hyperBindDesktopIdentity(app, process.platform);

const DEEP_LINK_SCHEME = 'appflowy-flutter';
hyperRegisterAssetScheme();

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
const aiCredentials = new HyperAICredentials({ supportDirectory, platform: process.platform, safeStorage });
const core = new CoreProcess(coreBinaryPath(appRoot, app.isPackaged), () => aiCredentials.coreEnvironment());
let coreStarted: Promise<void> | null = null;
let coreInitialization: Promise<unknown> = Promise.resolve();
const rowActivityNative = createHyperRowActivityNative(core);
const rowActivities = new HyperRowActivityIpc({ existingCore: () => coreStarted ? rowActivityNative.cleanup : null });
let rowActivityRenderer: ReturnType<typeof hyperBindRowActivityRenderer> | null = null;
let assetDataDirectory: string | null = null;
let assetContextRevision = 0;
let assetInitializationRevision = 0;
let assetServerBaseURL: string | null = null;
const bookmarkMetadata = new HyperBookmarkMetadata(createHyperBookmarkBackend(core, () => assetContextRevision));
const assets = new HyperAssets(() => assetDataDirectory, () => assetContextRevision);
const bookmarkThumbnails = new HyperBookmarkThumbnails({ ...createHyperBookmarkBackend(core, () => assetContextRevision), root: () => assetDataDirectory, normalize: hyperNormalizeBookmarkThumbnail, importImage: (bytes, info) => assets.importGeneratedImage(bytes, info) });
const cloudPreviews = new HyperCloudPreviews(createHyperCloudPreviewBackend(core, () => ({ root: assetDataDirectory, server: assetServerBaseURL, revision: assetContextRevision }), createHyperCloudPreviewDownload(core)));
const generatedImages = new HyperGeneratedImages({ applicationRoot: () => assetDataDirectory, importImage: (bytes, info) => assets.importGeneratedImage(bytes, info) });
let mainWindow: BrowserWindow | null = null;
let trustedRendererURL: string | null = null;
let launchDeepLink: string | null = findDeepLink(process.argv);
let updates: ReturnType<typeof createUpdateChecker> | null = null;
let tray: HyperTray | null = null;
let quitting = false;
let showOnReady = !process.argv.includes('--background') || launchDeepLink !== null;
const startup = new HyperStartup({
  app, prefs, platform: process.platform, executable: process.execPath,
  appImage: process.env.APPIMAGE, home: os.homedir(), configHome: process.env.XDG_CONFIG_HOME,
});

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
  rowActivities.coreExited();
  assetContextRevision++;
  assetInitializationRevision++;
  cloudPreviews.invalidate(); bookmarkMetadata.invalidate(); bookmarkThumbnails.invalidate();
  assetDataDirectory = null;
  assetServerBaseURL = null;
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
      // Reminders and renderer-side sync must continue while hidden in the tray.
      backgroundThrottling: false,
    },
  });
  const activityRenderer = hyperBindRowActivityRenderer(rowActivities, mainWindow.webContents);
  rowActivityRenderer = activityRenderer;
  trackWindowBounds(mainWindow, prefs);
  scheduleCapture(mainWindow);
  tray?.attach(mainWindow, () => quitting);
  mainWindow.on('session-end', () => { quitting = true; });

  const zoom = Number(await prefs.get('scaleFactor'));
  if (Number.isFinite(zoom) && zoom > 0) mainWindow.webContents.setZoomFactor(Math.min(2, Math.max(0.5, zoom)));

  mainWindow.once('ready-to-show', () => {
    // maximize() can show a hidden window on some platforms.
    if (bounds.maximized && showOnReady) mainWindow?.maximize();
    if (showOnReady || !tray) mainWindow?.show();
    else if (bounds.maximized) mainWindow?.once('show', () => mainWindow?.maximize());
  });
  mainWindow.on('maximize', () => mainWindow?.webContents.send(C.WindowMaximizedChanged, true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send(C.WindowMaximizedChanged, false));
  mainWindow.on('closed', () => { if (rowActivityRenderer === activityRenderer) rowActivityRenderer = null; mainWindow = null; trustedRendererURL = null; });

  // Links open in the system browser, as url_launcher does in the Flutter app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    trustedRendererURL = new URL(process.env.ELECTRON_RENDERER_URL).href;
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    trustedRendererURL = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function focusWindow() {
  showOnReady = true;
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * GitHub Releases updater (CPA-Desktop's flow): check on launch and every 6h, download on
 * request, and hand the install off only when the platform can actually install.
 */
function setupUpdates() {
  const cacheDir = path.join(app.getPath('userData'), 'updates');
  // In-app install works for the packaged Windows NSIS build and the packaged Linux AppImage;
  // anywhere else the panel falls back to "View release on GitHub".
  const canInstall = app.isPackaged &&
    (process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.APPIMAGE)));
  void (async () => {
    await cleanupUpdateCache(cacheDir);
    const installationError = await takeInstallError(cacheDir);
    updates = createUpdateChecker({
      currentVersion: app.getVersion(),
      installationError,
      ...(canInstall ? {
        cacheDir,
        installUpdate: async (update) => {
          await launchInstaller({ ...update, cacheDir, parentPid: process.pid, appPath: process.execPath, appImage: process.env.APPIMAGE ?? null });
          setImmediate(() => app.quit());
        },
      } : {}),
      onChange: (state) => mainWindow?.webContents.send(C.UpdateStateChanged, state),
    });
    void updates.check();
    const timer = setInterval(() => void updates?.check(), CHECK_INTERVAL);
    timer.unref();
  })();
}

function registerIpc() {
  ipcMain.handle(C.CoreInit, (_, config: CoreInitConfig) => {
    const initialization = ++assetInitializationRevision;
    assetContextRevision++;
    cloudPreviews.invalidate(); bookmarkMetadata.invalidate(); bookmarkThumbnails.invalidate();
    assetDataDirectory = null;
    assetServerBaseURL = null;
    const server = hyperCoreCloudBaseUrl(config);
    const initialized = coreInitialization.then(async () => {
      assetDataDirectory = null;
      const dataDirectory = await resolveHyperCoreStorageDirectory(config);
      await startCore();
      const result = await core.init(config);
      if (result === 0) rowActivities.coreReplaced();
      // Identity changes invalidate previews but do not change this initialized root.
      if (result === 0 && initialization === assetInitializationRevision) { assetDataDirectory = dataDirectory; assetServerBaseURL = server || null; }
      return result;
    });
    coreInitialization = initialized.catch(() => {});
    return initialized;
  });
  ipcMain.handle(C.CoreRequest, async (message, event: string, payload: Uint8Array) => {
    if (event === 'HyperUpdateRowActivity') {
      try {
        const contents = mainWindow?.webContents;
        const owner = contents && trustedRendererURL ? { webContentsId: contents.id, mainFrame: contents.mainFrame, rendererURL: trustedRendererURL, isDestroyed: () => contents.isDestroyed() } : null;
        if (!rowActivityRenderer || !hyperRowActivityTrustedSender(message.sender, message.senderFrame, owner)) throw new HyperRowActivityIpcError('retired');
        return await rowActivityNative.forward(rowActivities, rowActivityRenderer.capture(), payload, startCore);
      } catch (error) { return hyperRowActivityErrorReply(error); }
    }
    if (hyperIsAssetOwnerMutation(event)) { assetContextRevision++; cloudPreviews.invalidate(); bookmarkMetadata.invalidate(); bookmarkThumbnails.invalidate(); }
    await startCore();
    return core.request(event, payload);
  });
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
  ipcMain.handle(C.HyperStartupGet, () => startup.get());
  ipcMain.handle(C.HyperStartupSet, (_, enabled: boolean) => startup.set(enabled));
  ipcMain.on(C.AppRelaunch, async () => {
    quitting = true;
    await core.stop();
    app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== '--background') });
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

  ipcMain.handle(C.UpdateState, () => updates?.getState() ?? null);
  ipcMain.handle(C.UpdateCheck, () => updates?.check() ?? null);
  ipcMain.handle(C.UpdateDownload, () => updates?.download() ?? null);
  ipcMain.handle(C.UpdateCancelDownload, () => updates?.cancelDownload() ?? null);
  ipcMain.handle(C.UpdateInstall, () => updates?.install() ?? null);
  ipcMain.handle(C.UpdateOpenRelease, async () => {
    const release = updates?.getState().release;
    if (!release) return false;
    await openExternal(release.url);
    return true;
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
  ipcMain.handle(C.HyperBookmarkLoad, (_, url: unknown, owner: unknown) => bookmarkMetadata.loadUrl(url, owner));
  ipcMain.handle(C.HyperBookmarkThumbnailLoad, (_, url: unknown, owner: unknown) => bookmarkThumbnails.loadUrl(url, owner));
  ipcMain.handle(C.HyperBookmarkThumbnailImport, (_, data: unknown, owner: unknown) => bookmarkThumbnails.importData(data, owner));
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
  ipcMain.handle(C.AssetsImportFile, (_, sourcePath: string, kind?: 'image' | 'file') => assets.importFile(sourcePath, kind));
  ipcMain.handle(C.AssetsImportGeneratedImage, (_, fileUrl: string) => generatedImages.importUrl(fileUrl));
  ipcMain.handle(C.AssetsPreviewUrl, (_, target: string) => assets.previewUrl(target));
  ipcMain.handle(C.AssetsPreviewCloud, (_, url: unknown, owner: unknown) => hyperCloudPreviewIpc(cloudPreviews, url, owner));
  ipcMain.handle(C.AssetsExportFile, (_, source: string, target: string) => assets.exportFile(source, target));
  ipcMain.handle(C.AssetsInlineUrl, (_, target: string) => assets.inlineUrl(target));
  ipcMain.handle(C.AssetsWriteExportText, (_, target: string, content: string) => assets.writeExportText(target, content));
  ipcMain.handle(C.AssetsWriteExportBytes, (_, target: string, content: Uint8Array) => assets.writeExportBytes(target, content));
  ipcMain.handle(C.DocumentExportPdf, (_, html: string) => hyperRenderDocumentPdf(html));

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
    aiCredentials,
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
    if (link) {
      if (mainWindow) mainWindow.webContents.send(C.AppDeepLink, link);
      else launchDeepLink = link;
    }
    if (link || !argv.includes('--background')) focusWindow();
  });
  app.on('activate', focusWindow);
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow) mainWindow.webContents.send(C.AppDeepLink, url);
    else launchDeepLink = url;
    focusWindow();
  });

  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin && !launchDeepLink) showOnReady = false;
    // A shutdown must bypass close-to-tray just like an explicit Quit.
    powerMonitor.on('shutdown', () => { quitting = true; });
    try {
      const iconPath = path.join(appRoot, 'resources', process.platform === 'win32' ? 'hypertask.ico' : 'hypertask.png');
      const icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) throw new Error(`Could not load tray icon: ${iconPath}`);
      tray = new HyperTray(process.platform === 'win32' ? iconPath : icon.resize({ width: 20, height: 20 }), focusWindow, () => app.quit());
    } catch (error) {
      // Keep a visible, normally closable window if the tray cannot be created.
      console.error('[tray]', error);
    }
    await startup.initialize().catch((error) => console.error('[startup]', error));
    // SelfHostedPolicy.installNetworkPolicy: no request may reach AppFlowy hosted services.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: isVendorUrl(details.url) });
    });
    hyperInstallYouTubeClient(session.defaultSession, () => desktopIdentityBound && mainWindow && !mainWindow.isDestroyed() && trustedRendererURL ? { webContentsId: mainWindow.webContents.id, mainFrame: mainWindow.webContents.mainFrame, rendererURL: trustedRendererURL, isDestroyed: () => !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed() } : null);
    hyperHandleAssetProtocol(assets);
    registerIpc();
    void startCore();
    await createWindow();
    setupUpdates();
  });

  let cleanupFinished = false;
  let cleanupStarted = false;
  app.on('before-quit', (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true;
    quitting = true;
    void Promise.all([core.stop(), updates?.stop()]).finally(() => {
      cleanupFinished = true;
      app.quit();
    });
  });
  app.on('will-quit', () => tray?.destroy());
  app.on('window-all-closed', () => app.quit());
}
