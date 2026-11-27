import { registerHyperEntraIpc } from './HyperEntraIpc';
import { HyperDevJwtBootstrap } from './HyperDevJwtBootstrap';
import { HyperOutlookCalendarCache } from './HyperOutlookCalendarCache';
import { HyperOutlookBridge } from './HyperOutlookBridge';
import { HyperOutlookPresence } from './HyperOutlookPresence';
import { HyperOutlookWindows } from './HyperOutlookPresenceWindows';
import { registerHyperOutlookPresenceIpc } from './HyperOutlookPresenceIpc';
import { registerHyperOutlookIpc } from './HyperOutlookIpc';
import { hyperHubSummaryTransport } from './hyper-task-hub/HyperHubSummaryTransport';
import { HyperHubJiraCredentials, HyperHubNewsletterConnection, registerHyperTaskHubIpc } from './hyper-task-hub/HyperTaskHubIpc';
import { hyperClassifyBrowserReturn } from './HyperBrowserReturn';
import { HyperBrowserReturnQueue } from './HyperBrowserReturnQueue';
import type { HyperOpenBotService } from './HyperOpenBotService';
import { createHyperOpenBotService } from './HyperOpenBotBackend';
import { registerHyperOpenBotServiceIpc } from './HyperOpenBotServiceIpc';
import { createHyperOpenBotSession, hyperReadCoreIdentity, hyperNativeCoreRequest } from './HyperOpenBotSession';
import { registerHyperOpenBotFileIpc, registerHyperOpenBotIpc } from './hyper-openbot';
import { hyperNodReadAccess } from './HyperNodAccess';
import { HyperNodClient } from './HyperNodClient';
import { registerHyperNodIpc } from './HyperNodIpc';
import { createHyperNodSession, hyperNodNativeCoreRequest } from './HyperNodSession';
import { HyperNodTunnel } from './HyperNodTunnel';
import { HyperBotsStore } from './HyperBotsStore';
import { HyperBotsOpenAIEngine, hyperBotsReadEndpoint } from './HyperBotsEngine';
import { HyperBotsRuntime } from './HyperBotsRuntime';
import { HyperBotsTools, hyperBotsConnections, hyperBotsOutlookTools, hyperBotsReadJira } from './HyperBotsConnectors';
import { hyperBotsJiraTools } from './HyperBotsJiraTools';
import { hyperBotsNewsletterTools } from './HyperBotsNewsletterTools';
import type { HyperNewsletterConnection } from './HyperNewsletterConnection';
import { HyperBotsProjectTasks } from './HyperBotsProjectTasks';
import { hyperCoreWithGeneralKanban } from './HyperGeneralKanbanCore';
import { hyperBotsProjectTools } from './HyperBotsProjectTools';
import { registerHyperBotsIpc, registerHyperBotsUnavailable } from './HyperBotsIpc';
import { registerHyperAssistantIpc } from './HyperAssistantIpc';
import { registerHyperDesktopIpc } from './HyperDesktopIpc';
import { HyperDesktopSettings, isHyperAutoStartLaunch } from './HyperDesktopSettings';
import { HyperGlobalShortcuts } from './HyperGlobalShortcuts';
import { HyperTray } from './HyperTray';
import { HyperTrustedWindows } from './HyperTrustedWindows';
import { HyperVoiceOverlayWindow } from './HyperVoiceOverlayWindow';
import { registerHyperVoiceIpc, type HyperVoiceMain } from './hyper-voice/HyperVoiceIpc';
import { HYPER_BOTS_SIGN_IN, HyperBotsHub, hyperBotsReadIdentity, type HyperBotsUser } from './HyperBotsHub';
import { unprotect } from './dpapi';
import { listEndpointModels } from './openai-endpoint';
import fs from 'node:fs/promises';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { supportPath } from './support-path';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, net, session, shell } from 'electron';
import { IpcChannel as C, type AppInfo, type CoreInitConfig, type FileFilter } from '@shared/api';
import { HyperDesktopChannel, type HyperDesktopOpenMainTarget } from '@shared/HyperDesktop';
import { isVendorUrl } from '@shared/self-hosted-policy';
import { scheduleCapture } from './capture';
import { coreBinaryPath } from './core/binary';
import { CoreProcess } from './core/process';
import { createCoreOutputWriter } from './core/output';
import { readDeviceId } from './device-id';
import { exportLogs } from './logs';
import { SharedPreferences } from './prefs';
import { restoreWindowBounds, trackWindowBounds } from './window-state';
import { registerSettingsIpc } from './settings-ipc';

const DEEP_LINK_SCHEME = 'hypertask-flutter';
const TRUSTED_WEB_PERMISSIONS = new Set(['media', 'audioCapture', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'notifications']);

// Match electron-builder's appId so Windows associates the taskbar window with HyperTask.exe.
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('io.hypertask.hypertask');

// Allow WebAudio/AudioWorklet capture to resume immediately when triggered via global hotkey IPC.
app.commandLine?.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/**
 * Flutter's getApplicationSupportDirectory(): `%APPDATA%\<CompanyName>\<ProductName>` on
 * Windows (windows/runner/Runner.rc), the bundle id directory elsewhere. The core's data,
 * hypertask.yaml and shared_preferences.json live here, shared with the Flutter build.
 */
function supportDirectory(): string {
  // Development/testing: point the app at a scratch directory instead of the real data.
  if (process.env.HYPERTASK_SUPPORT_DIR && !app.isPackaged) return process.env.HYPERTASK_SUPPORT_DIR;
  return supportPath(process.platform, app.getPath('appData'), os.homedir(), existsSync);
}

const appRoot = path.resolve(__dirname, '../..');
const prefs = new SharedPreferences(path.join(supportDirectory(), 'shared_preferences.json'));
const jiraCredentials = new HyperHubJiraCredentials(supportDirectory);
const core = new CoreProcess(coreBinaryPath(appRoot, app.isPackaged));
const requestCore = hyperCoreWithGeneralKanban(core.request.bind(core));
const hyperOutlook = new HyperOutlookBridge();
const hyperNodTunnel = new HyperNodTunnel();
const hyperDevJwt = new HyperDevJwtBootstrap({ packaged: app.isPackaged, rendererUrl: process.env.ELECTRON_RENDERER_URL, enabled: process.env.HYPER_DEV_JWT_ENABLED, sessionFile: process.env.HYPER_DEV_JWT_SESSION_FILE });
let coreStarted: Promise<void> | null = null;
let hyperBots: HyperBotsHub | null = null;
/** Voice input (local speech models, cloud transcription, transcript cleanup), ported from t3code. */
let hyperVoice: HyperVoiceMain | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const trustedWindows = new HyperTrustedWindows();
const voiceOverlay = new HyperVoiceOverlayWindow({
  preloadPath: path.join(__dirname, '../preload/index.js'),
  rendererHtmlPath: path.join(__dirname, '../renderer/index.html'),
  rendererUrl: process.env.ELECTRON_RENDERER_URL,
  isPackaged: app.isPackaged,
  trustedWindows,
});
const globalShortcuts = new HyperGlobalShortcuts({
  onTrigger: () => {
    void voiceOverlay.trigger('hotkey');
  },
});
const desktopSettings = new HyperDesktopSettings({
  prefs,
  isPackaged: app.isPackaged,
  hotkeyStatus: () => globalShortcuts.status(),
});
const wasOpenedAtLogin =
  process.platform === 'darwin' && typeof app.getLoginItemSettings === 'function'
    ? Boolean(app.getLoginItemSettings().wasOpenedAtLogin)
    : false;
const startedHidden = isHyperAutoStartLaunch(process.argv, process.platform, wasOpenedAtLogin);
const hyperTray = new HyperTray({
  appRoot,
  isMainVisible: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
  onAskVoice: () => {
    void voiceOverlay.trigger('tray');
  },
  onShowMain: () => {
    void openMainTarget();
  },
  onHideMain: () => {
    mainWindow?.hide();
    hyperTray.refreshMenu();
  },
  onOpenSettings: () => {
    void openMainTarget({ route: 'settings' });
  },
  onQuit: () => {
    isQuitting = true;
    app.quit();
  },
});
const hyperOutlookWindows = new HyperOutlookWindows();
const hyperOutlookPresence = new HyperOutlookPresence(hyperOutlook, { detect: () => hyperOutlookWindows.detect(), launch: () => hyperOutlookWindows.launch(), hidden: () => !mainWindow || mainWindow.isMinimized() || !mainWindow.isVisible() });
let launchDeepLink: string | null = findDeepLink(process.argv);
const initialBrowserReturn = launchDeepLink !== null && hyperClassifyBrowserReturn(launchDeepLink) === 'return';
if (launchDeepLink && hyperClassifyBrowserReturn(launchDeepLink) !== 'ordinary') launchDeepLink = null;
let handleBrowserReturn: (() => Promise<void>) | undefined;
let browserReturnReady = () => false;
const browserReturns = new HyperBrowserReturnQueue(() => browserReturnReady(), async () => { await handleBrowserReturn?.(); });
if (initialBrowserReturn) browserReturns.request();
function deliverDeepLink(url: string) {
  const kind = hyperClassifyBrowserReturn(url);
  if (kind === 'reject') return;
  if (kind === 'return') {
    browserReturns.request();
    return;
  }
  if (mainWindow) mainWindow.webContents.send(C.AppDeepLink, url);
  else launchDeepLink = url;
}

function findDeepLink(argv: string[]): string | null {
  return argv.find((arg) => (arg.startsWith(`${DEEP_LINK_SCHEME}:`) || /^openbot:/i.test(arg))) ?? null;
}

const writeCoreOutput = app.isPackaged ? () => {} : createCoreOutputWriter(process.stdout);

function startCore(): Promise<void> {
  coreStarted ??= core.start(writeCoreOutput);
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
  if (isVendorUrl(target)) throw new Error('Hypertask hosted services are disabled in this self-hosted app.');
  await shell.openExternal(target);
}

async function createWindow({ showOnReady = !startedHidden }: { showOnReady?: boolean } = {}) {
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
    title: hyperDevJwt.enabled ? 'HyperTask — DEV JWT' : 'HyperTask',
    icon: path.join(appRoot, 'resources/hypertask.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  trustedWindows.add(mainWindow);
  if (bounds.maximized && showOnReady) mainWindow.maximize();
  trackWindowBounds(mainWindow, prefs);
  scheduleCapture(mainWindow);

  const zoom = Number(await prefs.get('scaleFactor'));
  if (Number.isFinite(zoom) && zoom > 0) mainWindow.webContents.setZoomFactor(Math.min(2, Math.max(0.5, zoom)));

  mainWindow.on('ready-to-show', () => {
    if (showOnReady) mainWindow?.show();
    hyperTray.refreshMenu();
  });
  mainWindow.on('show', () => hyperTray.refreshMenu());
  mainWindow.on('hide', () => hyperTray.refreshMenu());
  mainWindow.on('maximize', () => mainWindow?.webContents.send(C.WindowMaximizedChanged, true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send(C.WindowMaximizedChanged, false));
  mainWindow.on('close', (event) => {
    if (!isQuitting && desktopSettings.shouldCloseToTray) {
      event.preventDefault();
      mainWindow?.hide();
      hyperTray.refreshMenu();
    }
  });
  mainWindow.on('closed', () => {
    if (mainWindow) trustedWindows.remove(mainWindow);
    mainWindow = null;
    hyperTray.refreshMenu();
    if (!isQuitting && !desktopSettings.shouldCloseToTray) {
      isQuitting = true;
      app.quit();
    }
  });

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
  hyperTray.refreshMenu();
}

async function openMainTarget(target?: HyperDesktopOpenMainTarget): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow({ showOnReady: true });
  }
  focusWindow();
  if (target?.route && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(HyperDesktopChannel.MainEvent, {
      type: 'navigate',
      route: target.route,
      ...(target.roomId ? { roomId: target.roomId } : {}),
      ...(target.settingsPage ? { settingsPage: target.settingsPage } : {}),
    });
  }
}

/**
 * HyperBots runs in main: one runtime for the HyperTask account the core says is signed in, with its own state file
 * under <support>/hyper_bots/users and that account's configured connections.
 */
function createHyperBots(newsletter: HyperNewsletterConnection) {
  const endpoint = () => hyperBotsReadEndpoint(supportDirectory(), unprotect);
  const jira = (user: HyperBotsUser) => hyperBotsReadJira(prefs, jiraCredentials, user.userId);
  const netFetch = ((input, init) => net.fetch(input as string, init)) as typeof fetch;
  const engine = new HyperBotsOpenAIEngine({ endpoint, fetch: netFetch });
  const defaultModel = async () => { try { return (await endpoint()).defaultModel || null; } catch { return null; } };
  hyperBots = new HyperBotsHub({
    directory: path.join(supportDirectory(), 'hyper_bots', 'users'),
    identity: async () => { await startCore(); return hyperBotsReadIdentity((event, payload) => core.request(event, payload)); },
    // Jira and native task tools are bound to the account that owns the bot runtime.
    create: (user, stateFile) => new HyperBotsRuntime({
      store: new HyperBotsStore(stateFile), engine, defaultModel,
      tools: new HyperBotsTools([
        ...hyperBotsOutlookTools(hyperOutlook),
        ...hyperBotsJiraTools({ access: () => jira(user), fetch: netFetch }),
        ...hyperBotsNewsletterTools({ access: () => newsletter.access(user.key), fetch: netFetch }),
        ...hyperBotsProjectTools(new HyperBotsProjectTasks(requestCore, user.key)),
      ]),
    }),
  });
  return {
    hub: hyperBots,
    newsletter,
    onOutlookPresenceChange: hyperOutlookPresence.onChange,
    connections: (user: HyperBotsUser) => hyperBotsConnections({ endpoint, outlook: hyperOutlook, jira: () => jira(user), newsletter: () => newsletter.status(user.key) }),
    models: async () => {
      try {
        const saved = JSON.parse(await fs.readFile(path.join(supportDirectory(), 'local_ai', 'openai-endpoint.json'), 'utf8'));
        return await listEndpointModels({ baseUrl: String(saved.base_url ?? ''), protectedKey: String(saved.protected_key ?? '') });
      } catch { return []; }
    },
  };
}

function registerIpc() {
  const newsletter = new HyperHubNewsletterConnection(path.join(supportDirectory(), 'hyper_bots', 'newsletter'), (input, init) => net.fetch(String(input), init));
  const calendar = new HyperOutlookCalendarCache(hyperOutlook);
  const taskHub = registerHyperTaskHubIpc({ calendar, window: () => mainWindow, directory: supportDirectory(), prefs, credentials: jiraCredentials,
    summaryConfigured: () => hyperBotsReadEndpoint(supportDirectory(), unprotect).then(() => true, () => false),
    summary: hyperHubSummaryTransport(() => hyperBotsReadEndpoint(supportDirectory(), unprotect), (url, init) => net.fetch(String(url), init)),
    newsletter, outlook: hyperOutlook, outlookAvailable: () => hyperOutlookPresence.current().connected,
    active: () => !!mainWindow?.isVisible() && !mainWindow.isMinimized(),
    request: async (event, payload) => { await startCore(); return requestCore(event, payload); } });
  app.on('browser-window-focus', () => taskHub.wakeOutlook());
  hyperOutlookPresence.onChange(state => { if (state.connected) taskHub.outlookRecovered(); else calendar.reset(); });
  core.on('notification', taskHub.notify);
  jiraCredentials.changed = taskHub.connectionChanged;
  newsletter.changed = taskHub.newsletterChanged;
  core.on('exit', taskHub.invalidate);
  calendar.meetings = taskHub.meetingIds;
  registerHyperOutlookIpc(hyperOutlook, trustedWindows, calendar);
  registerHyperOutlookPresenceIpc(hyperOutlookPresence, trustedWindows);
  registerHyperEntraIpc(() => mainWindow);
  const openBotSessions = createHyperOpenBotSession(app.getPath('userData'), async () => { await startCore(); return hyperReadCoreIdentity((event, payload) => core.request(event, payload)); });
  const nodSessions = createHyperNodSession(app.getPath('userData'), async () => { await startCore(); return hyperReadCoreIdentity((event, payload) => core.request(event, payload)); });
  nodSessions.onInvalidate(() => hyperNodTunnel.close());
  registerHyperNodIpc(() => mainWindow, nodSessions, new HyperNodClient({ socketPath: () => hyperNodTunnel.socketPath(), readAccess: signal => hyperNodReadAccess(signal) }));
  hyperVoice = registerHyperVoiceIpc({ window: () => mainWindow, trustedWindows, userData: app.getPath('userData'), supportDirectory });
  let openBotService: HyperOpenBotService | undefined;
  const openBotBridge = registerHyperOpenBotIpc(() => mainWindow, openBotSessions, () => openBotService?.snapshot().ready === true);
  openBotService = createHyperOpenBotService(app.getPath('userData'), openBotSessions, openBotBridge.disconnect);
  registerHyperOpenBotServiceIpc(() => mainWindow, openBotService);
  // HyperBots state that cannot be opened must not stop the app from starting: the hub reports it per account from current().
  try { registerHyperBotsIpc(trustedWindows, createHyperBots(newsletter)); } catch (error) {
    hyperBots = null;
    console.error('[hyper-bots] unavailable', error);
    registerHyperBotsUnavailable(error instanceof Error ? error.message : String(error));
  }
  if (hyperBots) {
    registerHyperAssistantIpc({ trustedWindows, botsHub: hyperBots, outlookBridge: hyperOutlook });
  }
  registerHyperDesktopIpc({
    trustedWindows,
    getSettings: () => desktopSettings.getSnapshot(),
    setSettings: (patch) => desktopSettings.update(patch),
    resizeOverlay: (bounds) => voiceOverlay.resize(bounds),
    hideOverlay: () => voiceOverlay.hide(),
    openMain: (target) => openMainTarget(target),
  });
  // Re-reads who is signed in: switches or stops the bots runtime so one account's work never runs as another's.
  const reconcileBots = () => { void hyperBots?.current().catch((error: unknown) => { if (!(error instanceof Error && error.message === HYPER_BOTS_SIGN_IN)) console.error('[hyper-bots] unavailable for this account', error); }); };
  let returnBusy = false;
  handleBrowserReturn = async () => {
    if (returnBusy) return;
    const owner = mainWindow;
    if (!owner || owner.isDestroyed() || !openBotService?.snapshot().ready) return;
    returnBusy = true;
    const controller = new AbortController();
    const stop = () => controller.abort();
    const unsubscribe = openBotSessions.onInvalidate(stop);
    owner.webContents.once('destroyed', stop);
    owner.webContents.once('did-start-navigation', stop);
    try {
      const lease = await openBotSessions.acquire();
      const answer = await dialog.showMessageBox(owner, { title: 'HyperTask connections', message: 'Return to Connections?', detail: 'The browser returned from OpenBot. This does not confirm a successful connection. Check the account status in Connections.', buttons: ['Cancel', 'Open Connections'], defaultId: 0, cancelId: 0, signal: controller.signal });
      await openBotSessions.acquire(); lease.assertCurrent();
      if (answer.response === 1 && !controller.signal.aborted && mainWindow === owner && !owner.isDestroyed() && openBotService?.snapshot().ready) owner.webContents.send('hyper-openbot:native-destination', { kind: 'connections', confirmation: 'native-confirmed' });
    } catch { /* Sensitive callback and native failures never enter renderer error strings. */ }
    finally { returnBusy = false; unsubscribe(); owner.webContents.removeListener('destroyed', stop); owner.webContents.removeListener('did-start-navigation', stop); }
  };
  browserReturnReady = () => !!mainWindow && !mainWindow.isDestroyed() && !!openBotService?.snapshot().ready && !!handleBrowserReturn;
  openBotService.subscribe(() => { void browserReturns.flush(); });
  core.on('exit', () => { void openBotSessions.beginNativeTransition().cleared.catch(() => {}); nodSessions.beginNativeTransition(); });
  ipcMain.handle(C.CoreInit, async (_, config: CoreInitConfig) => {
    const transition = openBotSessions.beginNativeTransition(false);
    const nodTransition = nodSessions.beginNativeTransition();
    await startCore();
    await transition.cleared;
    const finishHubTransition = taskHub.begin('CoreInit');
    const result = await core.init(config).finally(finishHubTransition);
    openBotSessions.completeNativeTransition(transition.version, result === 0);
    nodSessions.completeNativeTransition(nodTransition, result === 0);
    if (hyperDevJwt.enabled) hyperDevJwt.coreReady(result === 0 && config.authenticator_type === 2 ? config.hypertask_cloud_config.base_url : null);
    reconcileBots();
    return result;
  });
  ipcMain.handle(C.CoreRequest, async (_, event: string, payload: Uint8Array) => {
    const finishHubTransition = taskHub.begin(event);
    const reply = await hyperNodNativeCoreRequest(nodSessions, event, () => hyperNativeCoreRequest(openBotSessions, event, async () => {
      await startCore();
      return requestCore(event, payload);
    })).finally(finishHubTransition);
    if (['SignOut', 'DeleteAccount', 'SignUp', 'OauthSignIn', 'SignInWithEmailPassword', 'PasscodeSignIn', 'MagicLinkSignIn', 'InitUser', 'OpenAnonUser'].includes(event)) reconcileBots();
    return reply;
  });
  ipcMain.on(C.CoreLog, (_, level: number, message: string) => core.log(level, message));

  ipcMain.handle(C.AppInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    developmentJwt: hyperDevJwt.enabled,
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
    isQuitting = true;
    globalShortcuts.dispose();
    hyperTray.dispose();
    voiceOverlay.dispose();
    await core.stop();
    app.relaunch();
    app.exit(0);
  });
  ipcMain.on(C.AppSetZoomFactor, (_, factor: number) => mainWindow?.webContents.setZoomFactor(factor));
  ipcMain.on(C.AppRegisterDeepLinkScheme, () => {
    if (app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    else app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(appRoot)]);
  });
  ipcMain.handle(C.AppTakeLaunchDeepLink, (event) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return null;
    void browserReturns.flush();
    const link = launchDeepLink;
    launchDeepLink = null;
    return link;
  });
  ipcMain.handle(C.AuthDevJwtSession, async (event) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return null;
    try { return await hyperDevJwt.take(); }
    catch { throw new Error('Development JWT session did not match the initialized server. Restart with npm run dev:jwt.'); }
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
        throw new Error('Hypertask hosted services are disabled in this self-hosted app.');
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
  ipcMain.handle(C.PrefsSet, async (_, key: string, value: unknown) => { await prefs.set(key, value); taskHub.preferenceChanged(key); });
  ipcMain.handle(C.PrefsSetDouble, (_, key: string, value: number) => prefs.setDouble(key, value));
  ipcMain.handle(C.PrefsRemove, async (_, key: string) => { await prefs.remove(key); taskHub.preferenceChanged(key); });

  registerHyperOpenBotFileIpc(app.getPath('userData'));

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
    jiraCredentials,
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
    if (link) deliverDeepLink(link);
    focusWindow();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverDeepLink(url);
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) void createWindow({ showOnReady: true });
    else focusWindow();
  });

  app.whenReady().then(async () => {
    // SelfHostedPolicy.installNetworkPolicy: no request may reach Hypertask hosted services.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: isVendorUrl(details.url) });
    });
    session.defaultSession.setPermissionCheckHandler?.((webContents, permission) => {
      return TRUSTED_WEB_PERMISSIONS.has(permission) && trustedWindows.hasWebContents(webContents);
    });
    session.defaultSession.setPermissionRequestHandler?.((webContents, permission, callback) => {
      callback(TRUSTED_WEB_PERMISSIONS.has(permission) && trustedWindows.hasWebContents(webContents));
    });
    await desktopSettings.init();
    globalShortcuts.register();
    registerIpc();
    try {
      hyperTray.init();
    } catch (error) {
      console.warn('[hyper-desktop] system tray unavailable', error);
    }
    hyperOutlookPresence.start();
    // The renderer-reported 'last Bots user' is retired: the account now always comes from the core.
    void Promise.resolve().then(() => prefs.remove('hyperBots.userId')).catch(() => {});
    // Once the core is up, approved work resumes for the signed-in account only (none when signed out).
    void startCore().then(() => hyperBots?.current()).catch((error: unknown) => { if (!(error instanceof Error && error.message === HYPER_BOTS_SIGN_IN)) console.error('[hyper-bots] could not resume runs', error); });
    await createWindow({ showOnReady: !startedHidden });
    void voiceOverlay.prewarm();
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    isQuitting = true;
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    globalShortcuts.dispose();
    hyperTray.dispose();
    voiceOverlay.dispose();
    hyperOutlookPresence.stop();
    hyperNodTunnel.close();
    // Bots stop first, so no connector call starts against a stopped Outlook bridge. Bounded: an Outlook read can
    // take up to a minute; a call still running at quit is recovered as 'unknown' and never re-run.
    const botsStopped = Promise.race([Promise.resolve().then(() => hyperBots?.stop()), new Promise(resolve => setTimeout(resolve, 5000))]);
    // The speech runtime kills its native worker; bounded so a stuck worker cannot hold the app open.
    const voiceStopped = Promise.race([Promise.resolve().then(() => hyperVoice?.dispose()), new Promise(resolve => setTimeout(resolve, 3000))]);
    void Promise.all([botsStopped.catch(() => {}), voiceStopped.catch(() => {})]).then(() => { hyperOutlook.stop(); return core.stop(); }).finally(() => app.quit());
  });
  app.on('window-all-closed', () => {
    if (isQuitting || !desktopSettings.shouldCloseToTray) app.quit();
  });
}
