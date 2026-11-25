import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel as C, type HypertaskApi } from '@shared/api';
import { HyperBotsChannel as B } from '@shared/HyperBots';
import { HyperDesktopChannel as D } from '@shared/HyperDesktop';
import { HyperAssistantChannel as A } from '@shared/HyperAssistant';
import { HyperVoiceChannel as V } from '@shared/hyper-voice/api';

function on<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

/**
 * Buffers events that arrive before the first renderer listener subscribes (e.g. cold-launch
 * overlay triggers while React.lazy mounts) and flushes them in a microtask so React StrictMode's
 * mount/unmount/remount cycle never drops or double-delivers a queued event.
 */
export function createHyperBufferedListener<T>(
  channel: string,
  bus: Pick<typeof ipcRenderer, 'on'> = ipcRenderer,
): (listener: (value: T) => void) => () => void {
  const listeners = new Set<(value: T) => void>();
  const pending: T[] = [];
  let flushScheduled = false;

  const scheduleFlush = () => {
    if (flushScheduled || pending.length === 0 || listeners.size === 0) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      if (listeners.size === 0 || pending.length === 0) return;
      const queued = pending.splice(0, pending.length);
      for (const item of queued) {
        for (const listener of [...listeners]) listener(item);
      }
    });
  };

  bus.on(channel, (_: IpcRendererEvent, value: T) => {
    if (listeners.size === 0) {
      if (pending.length >= 8) pending.shift();
      pending.push(value);
      return;
    }
    for (const listener of [...listeners]) listener(value);
  });

  return (listener) => {
    listeners.add(listener);
    scheduleFlush();
    return () => {
      listeners.delete(listener);
    };
  };
}

const onOverlayEvent = createHyperBufferedListener<import('@shared/HyperDesktop').HyperDesktopOverlayEvent>(D.OverlayEvent);
const onMainEvent = createHyperBufferedListener<import('@shared/HyperDesktop').HyperDesktopMainEvent>(D.MainEvent);

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
  hyperNod: {
    status: () => ipcRenderer.invoke(C.NodStatus),
    state: () => ipcRenderer.invoke(C.NodState),
    history: cursor => ipcRenderer.invoke(C.NodHistory, cursor),
    send: input => ipcRenderer.invoke(C.NodSend, input),
    stop: () => ipcRenderer.invoke(C.NodStop),
    subscribe: () => ipcRenderer.invoke(C.NodSubscribe),
    unsubscribe: () => ipcRenderer.send(C.NodUnsubscribe),
    onEvent: listener => on(C.NodEvent, listener),
  },
  hyperBots: {
    // Only the room travels: main reads who is signed in from the core.
    open: args => ipcRenderer.invoke(B.Open, args?.roomId === undefined ? {} : { roomId: args.roomId }),
    snapshot: args => ipcRenderer.invoke(B.Snapshot, args),
    post: input => ipcRenderer.invoke(B.Post, input),
    decide: args => ipcRenderer.invoke(B.Decide, args),
    saveSettings: settings => ipcRenderer.invoke(B.SaveSettings, settings),
    models: () => ipcRenderer.invoke(B.Models),
    newsletterConnection: () => ipcRenderer.invoke(B.NewsletterConnection),
    saveNewsletterConnection: input => ipcRenderer.invoke(B.SaveNewsletterConnection, input),
    onEvent: listener => on(B.Event, listener),
  },
  desktop: {
    getSettings: () => ipcRenderer.invoke(D.GetSettings),
    setSettings: patch => ipcRenderer.invoke(D.SetSettings, patch),
    resizeOverlay: bounds => ipcRenderer.invoke(D.OverlayResize, bounds),
    hideOverlay: () => ipcRenderer.invoke(D.OverlayHide),
    openMain: target => ipcRenderer.invoke(D.OverlayOpenMain, target),
    onOverlayEvent: listener => onOverlayEvent(listener),
    onMainEvent: listener => onMainEvent(listener),
  },
  assistant: {
    parseCommand: input => ipcRenderer.invoke(A.ParseCommand, input),
    searchPeople: input => ipcRenderer.invoke(A.SearchPeople, input),
    dispatch: input => ipcRenderer.invoke(A.Dispatch, input),
    execution: input => ipcRenderer.invoke(A.Execution, input),
    decideApproval: input => ipcRenderer.invoke(A.DecideApproval, input),
    listBots: () => ipcRenderer.invoke(A.ListBots),
    openGroup: input => ipcRenderer.invoke(A.OpenGroup, input),
  },
  hyperVoice: {
    status: () => ipcRenderer.invoke(V.Status),
    models: includeBenchmarks => ipcRenderer.invoke(V.Models, includeBenchmarks),
    downloadModel: modelId => ipcRenderer.invoke(V.DownloadModel, modelId),
    selectModel: modelId => ipcRenderer.invoke(V.SelectModel, modelId),
    cancelModelDownload: modelId => ipcRenderer.invoke(V.CancelModelDownload, modelId),
    removeModel: modelId => ipcRenderer.invoke(V.RemoveModel, modelId),
    linkModels: path => ipcRenderer.invoke(V.LinkModels, path),
    pickModelPath: kind => ipcRenderer.invoke(V.PickModelPath, kind),
    prepareModel: () => ipcRenderer.invoke(V.PrepareModel),
    updateAcceleration: acceleration => ipcRenderer.invoke(V.UpdateAcceleration, acceleration),
    updateModelUnloadTimeout: timeout => ipcRenderer.invoke(V.UpdateModelUnloadTimeout, timeout),
    transcribe: (pcm, options) => ipcRenderer.invoke(V.Transcribe, pcm, options),
    streamStart: options => ipcRenderer.invoke(V.StreamStart, options),
    streamFeed: (streamId, pcm) => ipcRenderer.invoke(V.StreamFeed, streamId, pcm),
    streamFinish: streamId => ipcRenderer.invoke(V.StreamFinish, streamId),
    streamCancel: streamId => ipcRenderer.send(V.StreamCancel, streamId),
    cloudKeys: () => ipcRenderer.invoke(V.CloudKeys),
    setCloudKey: (provider, key) => ipcRenderer.invoke(V.SetCloudKey, provider, key),
    cloudModels: () => ipcRenderer.invoke(V.CloudModels),
    transcribeCloud: (provider, pcm, options, model) => ipcRenderer.invoke(V.TranscribeCloud, provider, pcm, options, model),
    postProcess: request => ipcRenderer.invoke(V.PostProcess, request),
    cleanupModels: () => ipcRenderer.invoke(V.CleanupModels),
    setCleanupModel: model => ipcRenderer.invoke(V.SetCleanupModel, model),
  },
  hyperOpenBot: {
    callbackKey: input => ipcRenderer.invoke('hyper-openbot:callback-key', input),
    onNativeDestination: listener => on('hyper-openbot:native-destination', listener),
    service: {
      state: () => ipcRenderer.invoke('hyper-openbot:service-state'),
      run: action => ipcRenderer.invoke('hyper-openbot:service-action', action),
      configure: autoStart => ipcRenderer.invoke('hyper-openbot:service-configure', autoStart),
      onState: listener => on('hyper-openbot:service-changed', listener),
    },
    start: (request) => ipcRenderer.invoke('hyper-openbot:start', request),
    cancel: (id) => ipcRenderer.send('hyper-openbot:cancel', id),
    onChunk: (listener) => on('hyper-openbot:chunk', listener),
    socketOpen: (id, path, protocols) => ipcRenderer.invoke('hyper-openbot:socket-open', id, path, protocols),
    socketSend: (id, data) => ipcRenderer.send('hyper-openbot:socket-send', id, data),
    socketClose: (id, code, reason) => ipcRenderer.send('hyper-openbot:socket-close', id, code, reason),
    onSocket: (listener) => on('hyper-openbot:socket', listener),
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
