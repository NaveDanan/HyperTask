import { registerHyperEntraIpc } from './HyperEntraIpc';
import { HyperDevJwtBootstrap } from './HyperDevJwtBootstrap';
import { HyperOutlookBridge } from './HyperOutlookBridge';
import { HyperOutlookPresence } from './HyperOutlookPresence';
import { HyperOutlookWindows } from './HyperOutlookPresenceWindows';
import { registerHyperOutlookPresenceIpc } from './HyperOutlookPresenceIpc';
import { registerHyperOutlookIpc } from './HyperOutlookIpc';
import { hyperBotTranscribe } from './HyperBotSpeech';
import { HyperBotFiles } from './HyperBotFiles';
import { HyperBotWorkspace, hyperBotWebOrigins, hyperBotWorkspaceTools } from './HyperBotWorkspace';
import { HyperBotVault } from './HyperBotVault';
import { SettingsError } from './settings-error';
import { HyperBotsHostClient } from './HyperBotsHostClient';
import { HyperBotsStore } from './HyperBotsStore';
import { HyperBotsOpenAIEngine, hyperBotsReadEndpoint } from './HyperBotsEngine';
import { HyperBotsRuntime } from './HyperBotsRuntime';
import { HyperBotsTools, hyperBotsConnections, hyperBotsJiraTool, hyperBotsOutlookTools, hyperBotsReadJira } from './HyperBotsConnectors';
import { registerHyperBotsIpc, registerHyperBotsUnavailable } from './HyperBotsIpc';
import { HYPER_BOTS_SIGN_IN, HyperBotsHub, hyperBotsReadIdentity, type HyperBotsUser } from './HyperBotsHub';
import { JiraCredentialFiles } from './jira-credentials';
import { unprotect } from './dpapi';
import { listEndpointModels } from './openai-endpoint';
import fs from 'node:fs/promises';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { supportPath } from './support-path';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, net, safeStorage, session, shell } from 'electron';
import { IpcChannel as C, type AppInfo, type CoreInitConfig, type FileFilter } from '@shared/api';
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
const core = new CoreProcess(coreBinaryPath(appRoot, app.isPackaged));
const hyperOutlook = new HyperOutlookBridge();
const hyperDevJwt = new HyperDevJwtBootstrap({ packaged: app.isPackaged, rendererUrl: process.env.ELECTRON_RENDERER_URL, enabled: process.env.HYPER_DEV_JWT_ENABLED, sessionFile: process.env.HYPER_DEV_JWT_SESSION_FILE });
let coreStarted: Promise<void> | null = null;
let hyperBots: HyperBotsHub | null = null;
let mainWindow: BrowserWindow | null = null;
const hyperOutlookWindows = new HyperOutlookWindows();
const hyperOutlookPresence = new HyperOutlookPresence(hyperOutlook, { detect: () => hyperOutlookWindows.detect(), launch: () => hyperOutlookWindows.launch(), hidden: () => !mainWindow || mainWindow.isMinimized() || !mainWindow.isVisible() });
let launchDeepLink: string | null = findDeepLink(process.argv);
function deliverDeepLink(url: string) {
  if (!url.startsWith(DEEP_LINK_SCHEME + ':')) return;
  if (mainWindow) mainWindow.webContents.send(C.AppDeepLink, url);
  else launchDeepLink = url;
}

function findDeepLink(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(DEEP_LINK_SCHEME + ':')) ?? null;
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
    title: hyperDevJwt.enabled ? 'HyperTask — DEV JWT' : 'HyperTask',
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

/**
 * HyperBots runs in main: one runtime for the HyperTask account the core says is signed in, with its own state file
 * under <support>/hyper_bots/users, the Settings → AI endpoint, classic Outlook and that account's Jira tab access.
 */
function createHyperBots() {
  const host = HyperBotsHostClient.fromEnvironment(process.env);
  const webOrigins = hyperBotWebOrigins(process.env.HYPER_BOTS_WEB_ORIGINS);
  const endpoint = () => hyperBotsReadEndpoint(supportDirectory(), unprotect);
  const jira = (user: HyperBotsUser) => hyperBotsReadJira(prefs, new JiraCredentialFiles(supportDirectory), user.userId);
  const netFetch = ((input, init) => net.fetch(input as string, init)) as typeof fetch;
  const engine = new HyperBotsOpenAIEngine({ endpoint, fetch: netFetch });
  const defaultModel = async () => { try { return (await endpoint()).defaultModel || null; } catch { return null; } };
  let lastPrintedOwner: string | undefined;
  hyperBots = new HyperBotsHub({
    directory: path.join(supportDirectory(), 'hyper_bots', 'users'),
    startOnResolve: !host,
    identity: async () => {
      await startCore();
      const identity = await hyperBotsReadIdentity((event, payload) => core.request(event, payload));
      if (identity && process.env.HYPER_BOTS_PRINT_OWNER === '1' && identity.key !== lastPrintedOwner) {
        lastPrintedOwner = identity.key;
        console.info('[hyper-bots] host owner key', identity.key);
      }
      return identity;
    },
    // Each runtime's Jira tool is bound to its own account; nothing global decides whose Jira receives a write.
    create: (user, stateFile) => {
      const workspace = new HyperBotWorkspace(path.join(path.dirname(stateFile), 'workspace'));
      return new HyperBotsRuntime({
      workspace,
      store: new HyperBotsStore(stateFile), files: new HyperBotFiles(path.join(path.dirname(stateFile), 'attachments')), engine, defaultModel,
      vault: new HyperBotVault(path.join(path.dirname(stateFile), 'vault.enc'), () => {
        if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
          throw new SettingsError('unsupported', 'Unlock the operating system’s password storage to use the vault.');
        }
        return { seal: value => safeStorage.encryptString(value), open: value => safeStorage.decryptString(value) };
      }),
      transcribe: async (audio, signal) => hyperBotTranscribe(audio, await endpoint(), netFetch, signal),
      tools: new HyperBotsTools([...hyperBotsOutlookTools(hyperOutlook), hyperBotsJiraTool({ access: () => jira(user), fetch: netFetch }), ...hyperBotWorkspaceTools(workspace, webOrigins, netFetch)]),
      });
    },
  });
  return {
    hub: hyperBots,
    host,
    onOutlookPresenceChange: hyperOutlookPresence.onChange,
    connections: (user: HyperBotsUser) => hyperBotsConnections({ endpoint, outlook: hyperOutlook, jira: () => jira(user) }),
    models: async () => {
      try {
        const saved = JSON.parse(await fs.readFile(path.join(supportDirectory(), 'local_ai', 'openai-endpoint.json'), 'utf8'));
        return await listEndpointModels({ baseUrl: String(saved.base_url ?? ''), protectedKey: String(saved.protected_key ?? '') });
      } catch { return []; }
    },
  };
}

function registerIpc() {
  registerHyperOutlookIpc(hyperOutlook, () => mainWindow);
  registerHyperOutlookPresenceIpc(hyperOutlookPresence, () => mainWindow);
  registerHyperEntraIpc(() => mainWindow);
  // HyperBots state that cannot be opened must not stop the app from starting: the hub reports it per account from current().
  try { registerHyperBotsIpc(() => mainWindow, createHyperBots()); } catch (error) {
    hyperBots = null;
    console.error('[hyper-bots] unavailable', error);
    registerHyperBotsUnavailable(error instanceof Error ? error.message : String(error));
  }
  // Re-reads who is signed in: switches or stops the bots runtime so one account's work never runs as another's.
  const reconcileBots = () => { void hyperBots?.current().catch((error: unknown) => { if (!(error instanceof Error && error.message === HYPER_BOTS_SIGN_IN)) console.error('[hyper-bots] unavailable for this account', error); }); };
  ipcMain.handle(C.CoreInit, async (_, config: CoreInitConfig) => {
    await startCore();
    const result = await core.init(config);
    if (hyperDevJwt.enabled) hyperDevJwt.coreReady(result === 0 && config.authenticator_type === 2 ? config.hypertask_cloud_config.base_url : null);
    reconcileBots();
    return result;
  });
  ipcMain.handle(C.CoreRequest, async (_, event: string, payload: Uint8Array) => {
    await startCore();
    const reply = await core.request(event, payload);
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
  ipcMain.handle(C.PrefsSet, (_, key: string, value: unknown) => prefs.set(key, value));
  ipcMain.handle(C.PrefsSetDouble, (_, key: string, value: number) => prefs.setDouble(key, value));
  ipcMain.handle(C.PrefsRemove, (_, key: string) => prefs.remove(key));


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
    if (link) deliverDeepLink(link);
    focusWindow();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverDeepLink(url);
  });

  app.whenReady().then(async () => {
    // SelfHostedPolicy.installNetworkPolicy: no request may reach Hypertask hosted services.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: isVendorUrl(details.url) });
    });
    registerIpc();
    hyperOutlookPresence.start();
    // The renderer-reported 'last Bots user' is retired: the account now always comes from the core.
    void Promise.resolve().then(() => prefs.remove('hyperBots.userId')).catch(() => {});
    // Once the core is up, approved work resumes for the signed-in account only (none when signed out).
    void startCore().then(() => hyperBots?.current()).catch((error: unknown) => { if (!(error instanceof Error && error.message === HYPER_BOTS_SIGN_IN)) console.error('[hyper-bots] could not resume runs', error); });
    await createWindow();
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    hyperOutlookPresence.stop();
    // Bots stop first, so no connector call starts against a stopped Outlook bridge. Bounded: an Outlook read can
    // take up to a minute; a call still running at quit is recovered as 'unknown' and never re-run.
    const botsStopped = Promise.race([Promise.resolve().then(() => hyperBots?.stop()), new Promise(resolve => setTimeout(resolve, 5000))]);
    void botsStopped.catch(() => {}).then(() => { hyperOutlook.stop(); return core.stop(); }).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
