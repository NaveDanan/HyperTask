import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel as C, type HypertaskApi } from '@shared/api';
import { HyperBotsChannel as B } from '@shared/HyperBots';

function on<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: HypertaskApi = {
  auth: { devJwtSession: () => ipcRenderer.invoke(C.AuthDevJwtSession), entraIdToken: config => ipcRenderer.invoke(C.AuthEntraIdToken, config), entraCancel: () => ipcRenderer.invoke(C.AuthEntraCancel) },
  outlook: {
    people: { search: args => ipcRenderer.invoke(C.OutlookPeopleSearch, args), lookup: args => ipcRenderer.invoke(C.OutlookPeopleLookup, args) },
    status: () => ipcRenderer.invoke(C.OutlookStatus),
    presence: () => ipcRenderer.invoke(C.OutlookPresenceRead),
    launch: () => ipcRenderer.invoke(C.OutlookLaunch),
    onPresence: listener => on(C.OutlookPresence, listener),
    list: args => ipcRenderer.invoke(C.OutlookList, args),
    create: args => ipcRenderer.invoke(C.OutlookCreate, args),
    update: args => ipcRenderer.invoke(C.OutlookUpdate, args),
    delete: args => ipcRenderer.invoke(C.OutlookDelete, args),
    respond: args => ipcRenderer.invoke(C.OutlookRespond, args),
    open: args => ipcRenderer.invoke(C.OutlookOpen, args),
  },
  hyperBots: {
    // Only the room travels: main reads who is signed in from the core.
    open: args => ipcRenderer.invoke(B.Open, args?.roomId === undefined ? {} : { roomId: args.roomId }),
    snapshot: args => ipcRenderer.invoke(B.Snapshot, args),
    post: input => ipcRenderer.invoke(B.Post, input),
    decide: args => ipcRenderer.invoke(B.Decide, args),
    saveSettings: settings => ipcRenderer.invoke(B.SaveSettings, settings),
    models: () => ipcRenderer.invoke(B.Models),
    attachment: args => ipcRenderer.invoke(B.Attachment, args),
    transcribe: audio => ipcRenderer.invoke(B.Transcribe, audio),
    forget: args => ipcRenderer.invoke(B.Forget, args),
    workspace: {
      list: () => ipcRenderer.invoke(B.WorkspaceList),
      command: args => ipcRenderer.invoke(B.WorkspaceCommand, args),
      read: args => ipcRenderer.invoke(B.WorkspaceRead, args),
    },
    vault: {
      list: () => ipcRenderer.invoke(B.VaultList),
      add: args => ipcRenderer.invoke(B.VaultAdd, args),
      remove: args => ipcRenderer.invoke(B.VaultRemove, args),
      copy: args => ipcRenderer.invoke(B.VaultCopy, args),
    },
    onEvent: listener => on(B.Event, listener),
  },
  core: {
    init: (config) => ipcRenderer.invoke(C.CoreInit, config),
    request: (event, payload) => ipcRenderer.invoke(C.CoreRequest, event, payload),
    log: (level, message) => ipcRenderer.send(C.CoreLog, level, message),
    onNotification: (listener) => on(C.CoreNotification, listener),
    onPortMessage: (listener) => {
      const handler = (_: IpcRendererEvent, port: bigint, value: unknown) => listener(port, value);
      ipcRenderer.on(C.CorePortMessage, handler);
      return () => ipcRenderer.off(C.CorePortMessage, handler);
    },
    onExit: (listener) => on(C.CoreExit, listener),
  },
  app: {
    info: () => ipcRenderer.invoke(C.AppInfo),
    deviceId: () => ipcRenderer.invoke(C.AppDeviceId),
    relaunch: () => ipcRenderer.send(C.AppRelaunch),
    setZoomFactor: (factor) => ipcRenderer.send(C.AppSetZoomFactor, factor),
    registerDeepLinkScheme: () => ipcRenderer.send(C.AppRegisterDeepLinkScheme),
    onDeepLink: (listener) => on(C.AppDeepLink, listener),
    takeLaunchDeepLink: () => ipcRenderer.invoke(C.AppTakeLaunchDeepLink),
    exportLogs: () => ipcRenderer.invoke(C.AppExportLogs),
    clearCache: () => ipcRenderer.invoke(C.AppClearCache),
  },
  net: {
    request: (options) => ipcRenderer.invoke(C.NetRequest, options),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.send(C.ClipboardWriteText, text),
    readText: () => ipcRenderer.invoke(C.ClipboardReadText),
  },
  prefs: {
    getAll: () => ipcRenderer.invoke(C.PrefsGetAll),
    set: (key, value) => ipcRenderer.invoke(C.PrefsSet, key, value),
    setDouble: (key, value) => ipcRenderer.invoke(C.PrefsSetDouble, key, value),
    remove: (key) => ipcRenderer.invoke(C.PrefsRemove, key),
  },
  fs: {
    exists: (path) => ipcRenderer.invoke(C.FsExists, path),
    ensureDir: (path) => ipcRenderer.invoke(C.FsEnsureDir, path),
    readText: (path) => ipcRenderer.invoke(C.FsReadText, path),
    writeText: (path, content) => ipcRenderer.invoke(C.FsWriteText, path, content),
    writeBytes: (path, data) => ipcRenderer.invoke(C.FsWriteBytes, path, data),
  },
  window: {
    minimize: () => ipcRenderer.send(C.WindowMinimize),
    toggleMaximize: () => ipcRenderer.send(C.WindowToggleMaximize),
    close: () => ipcRenderer.send(C.WindowClose),
    isMaximized: () => ipcRenderer.invoke(C.WindowIsMaximized),
    onMaximizedChange: (listener) => on(C.WindowMaximizedChanged, listener),
    setFullScreen: (fullScreen) => ipcRenderer.send(C.WindowSetFullScreen, fullScreen),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(C.ShellOpenExternal, url),
    openPath: (path) => ipcRenderer.invoke(C.ShellOpenPath, path),
    showItemInFolder: (path) => ipcRenderer.send(C.ShellShowItemInFolder, path),
  },
  dialog: {
    pickDirectory: (title) => ipcRenderer.invoke(C.DialogPickDirectory, title),
    pickFiles: (options) => ipcRenderer.invoke(C.DialogPickFiles, options),
    saveFile: (options) => ipcRenderer.invoke(C.DialogSaveFile, options),
  },
  jira: {
    readCredentials: (accountId) => ipcRenderer.invoke(C.JiraReadCredentials, accountId),
    writeCredentials: (accountId, credentials) => ipcRenderer.invoke(C.JiraWriteCredentials, accountId, credentials),
    deleteCredentials: (accountId) => ipcRenderer.invoke(C.JiraDeleteCredentials, accountId),
    isPersistent: () => ipcRenderer.invoke(C.JiraCredentialsPersistent),
  },
  dpapi: {
    protect: (value) => ipcRenderer.invoke(C.DpapiProtect, value),
  },
  aiEndpoint: {
    writeSettings: (json) => ipcRenderer.invoke(C.AiEndpointWriteSettings, json),
    test: (request) => ipcRenderer.invoke(C.AiEndpointTest, request),
    listModels: (request) => ipcRenderer.invoke(C.HyperAiEndpointModels, request),
  },
  certificates: {
    list: () => ipcRenderer.invoke(C.CertificatesList),
    inspectFile: (path) => ipcRenderer.invoke(C.CertificatesInspectFile, path),
    importCertificate: (certificate) => ipcRenderer.invoke(C.CertificatesImport, certificate),
    removeCertificate: (certificate) => ipcRenderer.invoke(C.CertificatesRemove, certificate),
  },
  themes: {
    list: () => ipcRenderer.invoke(C.ThemesList),
    readPluginDirectory: (path) => ipcRenderer.invoke(C.ThemesReadPluginDirectory, path),
    install: (theme) => ipcRenderer.invoke(C.ThemesInstall, theme),
    remove: (name) => ipcRenderer.invoke(C.ThemesRemove, name),
  },
  fonts: {
    loadGoogleFont: (family, text) => ipcRenderer.invoke(C.FontsLoadGoogleFont, family, text),
  },
};

if (process.isMainFrame) contextBridge.exposeInMainWorld('hypertask', api);
