export type HyperCallbackKeyAction = 'create' | 'rotate' | 'revoke';
export interface HyperCallbackKeyResult { status: 'issued' | 'revoked' | 'cancelled' | 'refused' | 'failed' }
export interface HyperNativeDestination { kind: 'connections'; confirmation: 'native-confirmed'; serverId?: string }
import type { HyperOpenBotServiceAction, HyperOpenBotServiceState } from './HyperOpenBotService';
import type { HyperNodEvent, HyperNodHistoryCursor, HyperNodHistoryPage, HyperNodSendInput, HyperNodSnapshot, HyperNodStatus, HyperNodSubmitted } from './HyperNod';
import type { HyperBotsApi } from './HyperBots';
// The API the preload script exposes to the renderer as `window.hypertask`.

export interface CoreReply {
  /** 0 = ok, 1 = HyperError payload, 2 = internal error text. */
  status: number;
  payload: Uint8Array;
}

/** The JSON document dart-ffi's init_sdk takes (rust-lib/dart-ffi/src/env_serde.rs). */
export interface CoreInitConfig {
  root: string;
  app_version: string;
  custom_app_path: string;
  origin_app_path: string;
  device_id: string;
  platform: string;
  /** 0 = local, 2 = Hypertask Cloud (AuthenticatorType). */
  authenticator_type: number;
  hypertask_cloud_config: { base_url: string; ws_base_url: string; gotrue_url: string };
  envs: Record<string, string>;
}

export interface AppInfo {
  version: string;
  platform: string;
  isPackaged: boolean;
  /** Explicit unverified-JWT development launch; always false in packaged apps. */
  developmentJwt?: boolean;
  /** Electron's app.getPath values, plus `support`: Flutter's application support directory. */
  paths: { appData: string; documents: string; home: string; temp: string; userData: string; support: string };
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface HttpResponse {
  status: number;
  /** Response headers, lower-case names (absent from older harness builds). */
  headers?: Record<string, string>;
  body: string;
}

// ---- Settings dialog additions (DPAPI, AI endpoint, company certificates, themes, fonts) ----

/**
 * Errors that cross IPC keep the Dart exception kind, because the settings pages format
 * FormatException/StateError messages differently from other failures.
 */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'format' | 'state' | 'unsupported' | 'other'; message: string };

/** CompanyCertificate JSON (features/company_certificates/company_certificate_store.dart). */
/** A Jira secret (PAT or password) and the Basic-auth username (lib/features/jira/data/jira_credential_store.dart). */
export interface JiraCredentials {
  username: string;
  secret: string;
}

/** CompanyCertificate JSON (features/company_certificates/company_certificate_store.dart). */
export interface CompanyCertificate {
  subject: string;
  issuer: string;
  /** SHA-1 hex (40 chars). */
  thumbprint: string;
  /** Uppercase hex of SHA-256(RawData), no separators. */
  sha256: string;
  /** UTC ISO-8601 (Dart toIso8601String). */
  notBefore: string;
  notAfter: string;
  /** base64 DER. */
  der: string;
  installedByApp: boolean;
}

/** OpenAIEndpointSettings.testConnection() inputs; the key stays DPAPI-protected across IPC. */
export interface OpenAIEndpointTestRequest {
  baseUrl: string;
  model: string;
  protectedKey: string;
}

/** Model discovery needs only an endpoint and credential, before a model is selected. */
export type HyperEndpointModelsRequest = Pick<OpenAIEndpointTestRequest, 'baseUrl' | 'protectedKey'>;

/** A `<name>.hyper_plugin` theme folder: the raw light and dark JSON texts. */
export interface CustomThemeFiles {
  name: string;
  light: string;
  dark: string;
}

/** One @font-face of a Google Fonts family, fetched by the main process (the renderer CSP blocks it). */
export interface GoogleFontFace {
  weight: string;
  style: string;
  unicodeRange?: string;
  data: Uint8Array;
}

export interface HyperOpenBotRequest { id: string; path: string; method: string; body?: string | Uint8Array; contentType?: string }
export interface HyperOpenBotChunk { id: string; chunk?: Uint8Array; done?: boolean; error?: string }
export interface HyperOpenBotSocketEvent { id: string; type: 'open' | 'message' | 'error' | 'close'; data?: string | Uint8Array; code?: number; reason?: string }
export interface HyperOutlookAttendee { name: string; email: string; type: number; response: number }
export type { HyperOutlookPresenceState } from './HyperOutlookPresence';
export interface HyperOutlookStatus { available: boolean; userName: string; email: string; reason?: string }
export interface HyperOutlookEvent {
  id: string; subject: string; start: string; end: string; allDay: boolean; location: string; body: string;
  organizer: string; isOrganizer: boolean; responseStatus: number; attendees: HyperOutlookAttendee[]; attendeeCount: number;
  busyStatus: number; isRecurring: boolean; recurrenceState: number; isCancelled: boolean; isPrivate: boolean; joinUrl: string | null; lastModified: string;
}
export interface HyperOutlookRange { start: string; end: string }
export interface HyperOutlookFields extends HyperOutlookRange { subject: string; allDay: boolean; location: string; body: string }
export interface HyperOutlookCreate extends HyperOutlookFields { attendees: string[]; send: boolean }
export interface HyperOutlookUpdate { id: string; expectedLastModified: string; patch: Partial<HyperOutlookFields>; send: boolean }
export interface HyperOutlookDelete { id: string; send: boolean }
export interface HyperOutlookRespond extends HyperOutlookDelete { response: 'accept' | 'tentative' | 'decline' }
export interface HyperPerson { name: string; email: string; title: string; department: string; phone: string; office: string; company: string; photo?: string; source: 'ad' | 'outlook' }
export interface HyperOutlookApi {
  people: { search(args: { query: string; limit?: number }): Promise<IpcResult<HyperPerson[]>>; lookup(args: { email: string }): Promise<IpcResult<HyperPerson | null>> };
  status(): Promise<IpcResult<HyperOutlookStatus>>;
  presence(): Promise<IpcResult<import('./HyperOutlookPresence').HyperOutlookPresenceState>>;
  launch(): Promise<IpcResult<void>>;
  onPresence(listener: (state: import('./HyperOutlookPresence').HyperOutlookPresenceState) => void): () => void;
  list(range: HyperOutlookRange): Promise<IpcResult<HyperOutlookEvent[]>>;
  create(args: HyperOutlookCreate): Promise<IpcResult<HyperOutlookEvent>>;
  update(args: HyperOutlookUpdate): Promise<IpcResult<HyperOutlookEvent>>;
  delete(args: HyperOutlookDelete): Promise<IpcResult<null>>;
  respond(args: HyperOutlookRespond): Promise<IpcResult<null>>;
  open(args: { id: string }): Promise<IpcResult<null>>;
}

export interface HyperNodApi {
  status(): Promise<IpcResult<HyperNodStatus>>;
  state(): Promise<IpcResult<HyperNodSnapshot>>;
  history(cursor: HyperNodHistoryCursor): Promise<IpcResult<HyperNodHistoryPage>>;
  send(input: HyperNodSendInput): Promise<IpcResult<HyperNodSubmitted>>;
  /** Stops every session and task of the assistant. */
  stop(): Promise<IpcResult<void>>;
  /** Opens the live event stream, which ends with a disconnected event. Reload state after each connect. */
  subscribe(): Promise<IpcResult<void>>;
  unsubscribe(): void;
  onEvent(listener: (event: HyperNodEvent) => void): () => void;
}

export interface HypertaskApi {
  auth: { devJwtSession(): Promise<string | null>; entraIdToken(config: import('./HyperEntra').HyperEntraConfig): Promise<IpcResult<import('./HyperEntra').HyperEntraToken>>; entraCancel(): Promise<void> };
  outlook: HyperOutlookApi;
  /** The Nod personal assistant on the VM. Main owns its token and transport. */
  hyperNod: HyperNodApi;
  /** HyperBots: bots in rooms. Main owns the runtime, storage, approvals and connectors. */
  hyperBots: HyperBotsApi;
  hyperOpenBot: {
    callbackKey(input: { action: HyperCallbackKeyAction; agentId: string }): Promise<HyperCallbackKeyResult>;
    onNativeDestination(listener: (destination: HyperNativeDestination) => void): () => void;
    service: {
      state(): Promise<HyperOpenBotServiceState>;
      run(action: HyperOpenBotServiceAction): Promise<HyperOpenBotServiceState>;
      configure(autoStart: boolean): Promise<HyperOpenBotServiceState>;
      onState(listener: (state: HyperOpenBotServiceState) => void): () => void;
    };
    start(request: HyperOpenBotRequest): Promise<{ status: number; headers: Record<string, string> }>;
    cancel(id: string): void;
    socketOpen(id: string, path: string, protocols: string[]): Promise<void>;
    socketSend(id: string, data: string | Uint8Array): void;
    socketClose(id: string, code?: number, reason?: string): void;
    onSocket(listener: (event: HyperOpenBotSocketEvent) => void): () => void;
    onChunk(listener: (event: HyperOpenBotChunk) => void): () => void;
  };
  core: {
    init(config: CoreInitConfig): Promise<number>;
    request(event: string, payload: Uint8Array): Promise<CoreReply>;
    log(level: number, message: string): void;
    onNotification(listener: (payload: Uint8Array) => void): () => void;
    /** Messages the core posts to stream ports (search, AI streaming, upload progress). */
    onPortMessage(listener: (port: bigint, value: unknown) => void): () => void;
    onExit(listener: (code: number | null) => void): () => void;
  };
  app: {
    info(): Promise<AppInfo>;
    /** HKLM\SOFTWARE\Microsoft\SQMClient\MachineId, as device_info_plus reports it. */
    deviceId(): Promise<string>;
    relaunch(): void;
    setZoomFactor(factor: number): void;
    /** Registers the hypertask-flutter:// scheme (self-hosted mode only, as in Flutter). */
    registerDeepLinkScheme(): void;
    /** Deep links received while running, and the one the app was launched with. */
    onDeepLink(listener: (url: string) => void): () => void;
    takeLaunchDeepLink(): Promise<string | null>;
    /** shareLogFiles: zips log.* files under the support directory; null when there are none. */
    exportLogs(): Promise<string | null>;
    /** HyperCacheManager.clearAllCache(). */
    clearCache(): Promise<void>;
  };
  /** HTTP from the main process (no CORS); vendor hosts are refused. */
  net: {
    request(options: { url: string; method: string; headers?: Record<string, string>; body?: string }): Promise<HttpResponse>;
  };
  clipboard: {
    writeText(text: string): void;
    readText(): Promise<string>;
  };
  /** Persistent key-value storage, the counterpart of Flutter's KeyValueStorage. */
  prefs: {
    getAll(): Promise<Record<string, unknown>>;
    set(key: string, value: unknown): Promise<void>;
    /** SharedPreferences.setDouble: written as a Dart double (1920.0). */
    setDouble(key: string, value: number): Promise<void>;
    remove(key: string): Promise<void>;
  };
  fs: {
    exists(path: string): Promise<boolean>;
    ensureDir(path: string): Promise<void>;
    readText(path: string): Promise<string | null>;
    writeText(path: string, content: string): Promise<void>;
    /** Writes binary content, creating parent directories. */
    writeBytes(path: string, data: Uint8Array): Promise<void>;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(listener: (maximized: boolean) => void): () => void;
    setFullScreen(fullScreen: boolean): void;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): void;
  };
  dialog: {
    pickDirectory(title?: string): Promise<string | null>;
    pickFiles(options: { title?: string; filters?: FileFilter[]; multiple?: boolean }): Promise<string[]>;
    saveFile(options: { title?: string; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>;
  };
  /**
   * Jira credentials (lib/features/local_tools/jira_windows_credentials.dart), compatible with the
   * Flutter build: `<support>/jira_credentials/<uuid v5(URL, accountId)>.json` holding the username
   * and the DPAPI-protected secret. Off Windows they live in memory for the session.
   */
  jira: {
    readCredentials(accountId: string): Promise<IpcResult<JiraCredentials | null>>;
    writeCredentials(accountId: string, credentials: JiraCredentials): Promise<IpcResult<void>>;
    deleteCredentials(accountId: string): Promise<IpcResult<void>>;
    /** Whether stored secrets survive a restart (false off Windows). */
    isPersistent(): Promise<boolean>;
  };
  /** Windows DPAPI (CurrentUser, CRYPTPROTECT_UI_FORBIDDEN, no entropy), as openai_endpoint_settings.dart. */
  dpapi: {
    /** encryptKey(): base64 of the raw DPAPI blob; '' for ''. */
    protect(value: string): Promise<IpcResult<string>>;
  };
  /** OpenAI-compatible endpoint settings (C.8). */
  aiEndpoint: {
    /** Writes `<support>/local_ai/openai-endpoint.json` (flushed) and returns its absolute path. */
    writeSettings(json: string): Promise<IpcResult<string>>;
    /** POST <base>/chat/completions, 30 s timeouts, redirects not followed, vendor hosts refused. */
    test(request: OpenAIEndpointTestRequest): Promise<IpcResult<void>>;
    /** GET <base>/models, with the same credential and redirect policy as testing. */
    listModels(request: HyperEndpointModelsRequest): Promise<IpcResult<string[]>>;
  };
  /** CompanyCertificateStore over the Windows CurrentUser Root store (C.9). */
  certificates: {
    list(): Promise<IpcResult<CompanyCertificate[]>>;
    inspectFile(path: string): Promise<IpcResult<CompanyCertificate[]>>;
    importCertificate(certificate: CompanyCertificate): Promise<IpcResult<void>>;
    removeCertificate(certificate: CompanyCertificate): Promise<IpcResult<void>>;
  };
  /** Custom `<name>.hyper_plugin` themes in the user's Documents folder (C.17). */
  themes: {
    list(): Promise<CustomThemeFiles[]>;
    /** HyperDynamicPlugin.decode's file checks: folder extension and the light/dark JSON files. */
    readPluginDirectory(path: string): Promise<IpcResult<CustomThemeFiles>>;
    /** Writes `<Documents>/<name>.hyper_plugin/<name>.light.json` and `.dark.json`. */
    install(theme: CustomThemeFiles): Promise<void>;
    remove(name: string): Promise<void>;
  };
  fonts: {
    /** Google Fonts faces for a family; `text` subsets the font to those characters (previews). */
    loadGoogleFont(family: string, text?: string): Promise<GoogleFontFace[]>;
  };
}

export const IpcChannel = {
  AuthDevJwtSession: 'auth:hyper-dev-jwt-session',
  AuthEntraIdToken: 'auth.entraIdToken',
  AuthEntraCancel: 'auth.entraCancel',
  OutlookPeopleSearch: 'outlook.people.search',
  OutlookPeopleLookup: 'outlook.people.lookup',
  OutlookPresence: 'hyper-outlook:presence',
  OutlookPresenceRead: 'hyper-outlook:presence-read',
  OutlookLaunch: 'hyper-outlook:launch',
  OutlookStatus: 'outlook:status',
  OutlookList: 'outlook:list',
  OutlookCreate: 'outlook:create',
  OutlookUpdate: 'outlook:update',
  OutlookDelete: 'outlook:delete',
  OutlookRespond: 'outlook:respond',
  OutlookOpen: 'outlook:open',
  NodStatus: 'hyper-nod:status',
  NodState: 'hyper-nod:state',
  NodHistory: 'hyper-nod:history',
  NodSend: 'hyper-nod:send',
  NodStop: 'hyper-nod:stop',
  NodSubscribe: 'hyper-nod:subscribe',
  NodUnsubscribe: 'hyper-nod:unsubscribe',
  NodEvent: 'hyper-nod:event',
  CoreInit: 'core:init',
  CoreRequest: 'core:request',
  CoreLog: 'core:log',
  CoreNotification: 'core:notification',
  CorePortMessage: 'core:port-message',
  CoreExit: 'core:exit',
  AppInfo: 'app:info',
  AppDeviceId: 'app:device-id',
  AppRelaunch: 'app:relaunch',
  AppSetZoomFactor: 'app:set-zoom-factor',
  AppRegisterDeepLinkScheme: 'app:register-deep-link-scheme',
  AppDeepLink: 'app:deep-link',
  AppTakeLaunchDeepLink: 'app:take-launch-deep-link',
  AppExportLogs: 'app:export-logs',
  AppClearCache: 'app:clear-cache',
  NetRequest: 'net:request',
  ClipboardWriteText: 'clipboard:write-text',
  ClipboardReadText: 'clipboard:read-text',
  PrefsGetAll: 'prefs:get-all',
  PrefsSet: 'prefs:set',
  PrefsSetDouble: 'prefs:set-double',
  PrefsRemove: 'prefs:remove',
  FsExists: 'fs:exists',
  FsEnsureDir: 'fs:ensure-dir',
  FsReadText: 'fs:read-text',
  FsWriteText: 'fs:write-text',
  FsWriteBytes: 'fs:write-bytes',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowIsMaximized: 'window:is-maximized',
  WindowMaximizedChanged: 'window:maximized-changed',
  WindowSetFullScreen: 'window:set-full-screen',
  ShellOpenExternal: 'shell:open-external',
  ShellOpenPath: 'shell:open-path',
  ShellShowItemInFolder: 'shell:show-item-in-folder',
  DialogPickDirectory: 'dialog:pick-directory',
  DialogPickFiles: 'dialog:pick-files',
  DialogSaveFile: 'dialog:save-file',
  DpapiProtect: 'dpapi:protect',
  JiraReadCredentials: 'jira:read-credentials',
  JiraWriteCredentials: 'jira:write-credentials',
  JiraDeleteCredentials: 'jira:delete-credentials',
  JiraCredentialsPersistent: 'jira:credentials-persistent',
  AiEndpointWriteSettings: 'ai-endpoint:write-settings',
  AiEndpointTest: 'ai-endpoint:test',
  HyperAiEndpointModels: 'ai-endpoint:list-models',
  CertificatesList: 'certificates:list',
  CertificatesInspectFile: 'certificates:inspect-file',
  CertificatesImport: 'certificates:import',
  CertificatesRemove: 'certificates:remove',
  ThemesList: 'themes:list',
  ThemesReadPluginDirectory: 'themes:read-plugin-directory',
  ThemesInstall: 'themes:install',
  ThemesRemove: 'themes:remove',
  FontsLoadGoogleFont: 'fonts:load-google-font',
} as const;
