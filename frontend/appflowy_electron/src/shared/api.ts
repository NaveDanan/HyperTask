// The API the preload script exposes to the renderer as `window.appflowy`.

export interface CoreReply {
  /** 0 = ok, 1 = FlowyError payload, 2 = internal error text. */
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
  /** 0 = local, 2 = AppFlowy Cloud (AuthenticatorType). */
  authenticator_type: number;
  appflowy_cloud_config: { base_url: string; ws_base_url: string; gotrue_url: string };
  envs: Record<string, string>;
}

export interface AppInfo {
  version: string;
  platform: string;
  isPackaged: boolean;
  /** Electron's app.getPath values, plus `support`: Flutter's application support directory. */
  paths: { appData: string; documents: string; home: string; temp: string; userData: string; support: string };
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface HyperGeneratedImageAsset extends HyperImportedAsset {
  width: number;
  height: number;
}

export interface HyperImportedAsset {
  /** Absolute managed path, compatible with existing LocalFile media cells. */
  path: string;
  name: string;
  size: number;
  previewUrl: string;
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

/** Saved keys stay protected; a typed unsaved key is transient and is never persisted by testing. */
export interface OpenAIEndpointTestRequest {
  baseUrl: string;
  model: string;
  protectedKey: string;
  /** Transient unsaved override; explicit empty string tests without a saved key. */
  apiKey?: string;
}

/** Unsaved keys are used only for this discovery request and are never persisted. */
export interface OpenAIEndpointDiscoveryRequest {
  baseUrl: string;
  protectedKey: string;
  apiKey?: string;
  requestId?: string;
}

/** A `<name>.flowy_plugin` theme folder: the raw light and dark JSON texts. */
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

/** One newer stable GitHub release (main-updates feature, ported from CPA-Desktop). */
export interface AppUpdateRelease {
  version: string;
  /** The GitHub release page. */
  url: string;
  /** The installer asset to download, when the release attaches one with a sha256 digest. */
  installer: { name: string; size: number; sha256: string; url: string } | null;
  notes: string;
}

export type AppUpdateStatus =
  | 'idle' | 'checking' | 'current' | 'available' | 'error' | 'downloading' | 'downloaded' | 'installing';

export interface AppUpdateState {
  currentVersion: string;
  status: AppUpdateStatus;
  release: AppUpdateRelease | null;
  error: string | null;
  /** The platform can hand off to the downloaded installer and restart. */
  canInstall: boolean;
  progress: { received: number; total: number } | null;
}

export interface HyperStartupState {
  enabled: boolean;
  available: boolean;
  reason?: string;
}

export interface HyperBookmarkOwner { actorId: string; workspaceId: string }
export interface HyperBookmarkMetadataReply { url: string; html: string }

export interface AppFlowyApi {
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
    /** Registers the appflowy-flutter:// scheme (self-hosted mode only, as in Flutter). */
    registerDeepLinkScheme(): void;
    /** Deep links received while running, and the one the app was launched with. */
    onDeepLink(listener: (url: string) => void): () => void;
    takeLaunchDeepLink(): Promise<string | null>;
    /** shareLogFiles: zips log.* files under the support directory; null when there are none. */
    exportLogs(): Promise<string | null>;
    /** FlowyCacheManager.clearAllCache(). */
    clearCache(): Promise<void>;
    getStartup(): Promise<HyperStartupState>;
    setStartup(enabled: boolean): Promise<HyperStartupState>;
  };
  /** HTTP from the main process (no CORS); vendor hosts are refused. */
  net: {
    request(options: { url: string; method: string; headers?: Record<string, string>; body?: string }): Promise<HttpResponse>;
  };
  bookmarks: {
    /** Explicit bounded HTML metadata request without cookies or authentication; at most three validated redirects. */
    load(url: string, owner: HyperBookmarkOwner): Promise<HyperBookmarkMetadataReply>;
    /** Explicit credential-free fetch, validated and copied as a managed PNG snapshot. */
    loadThumbnail(url: string, owner: HyperBookmarkOwner): Promise<HyperGeneratedImageAsset>;
    /** Embedded raster bytes from a reviewed HTML import, without network access. */
    importThumbnail(dataUrl: string, owner: HyperBookmarkOwner): Promise<HyperGeneratedImageAsset>;
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
  assets: {
    /** Copies a selected file into the active data directory, independent of the original. */
    importFile(sourcePath: string, kind?: 'image' | 'file'): Promise<HyperImportedAsset>;
    /** Validates a core-generated image URL and copies it into managed image storage. */
    importGeneratedImage(fileUrl: string): Promise<HyperGeneratedImageAsset>;
    /** Returns a read-only URL for a file in managed images/ or files/ storage. */
    previewUrl(path: string): Promise<string>;
    /** Native authenticated, owner-scoped raster preview; never a persisted attachment URL. */
    previewCloud(url: string, owner: { actorId: string; workspaceId: string }): Promise<string>;
    /** Copies a managed attachment to a unique export path; refuses to replace an existing file. */
    exportFile(sourcePath: string, targetPath: string): Promise<void>;
    /** Reads a managed attachment as a data URL, up to 16 MiB, for clipboard export. */
    inlineUrl(path: string): Promise<string>;
    /** Atomically replaces the selected export file after flushing its text. */
    writeExportText(path: string, content: string): Promise<void>;
    /** Atomically replaces a selected binary export after the complete content is ready. */
    writeExportBytes(path: string, content: Uint8Array): Promise<void>;
  };
  documentExport: {
    /** Renders self-contained HTML in an isolated PDF print window. */
    renderPdf(html: string): Promise<Uint8Array>;
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
  /** Platform credential protection. The namespace stays compatible with the Windows port. */
  dpapi: {
    /** Windows DPAPI or a versioned native-secure-storage envelope; '' for ''. */
    protect(value: string): Promise<IpcResult<string>>;
  };
  /** OpenAI-compatible endpoint settings (C.8). */
  aiEndpoint: {
    /** Writes `<support>/local_ai/openai-endpoint.json` (flushed) and returns its absolute path. */
    writeSettings(json: string): Promise<IpcResult<string>>;
    /** POST <base>/chat/completions, 30 s timeouts, redirects not followed, vendor hosts refused. */
    test(request: OpenAIEndpointTestRequest): Promise<IpcResult<void>>;
    discover(request: OpenAIEndpointDiscoveryRequest): Promise<IpcResult<{ models: string[] }>>;
  };
  /** CompanyCertificateStore over the Windows CurrentUser Root store (C.9). */
  certificates: {
    list(): Promise<IpcResult<CompanyCertificate[]>>;
    inspectFile(path: string): Promise<IpcResult<CompanyCertificate[]>>;
    importCertificate(certificate: CompanyCertificate): Promise<IpcResult<void>>;
    removeCertificate(certificate: CompanyCertificate): Promise<IpcResult<void>>;
  };
  /** Custom `<name>.flowy_plugin` themes in the user's Documents folder (C.17). */
  themes: {
    list(): Promise<CustomThemeFiles[]>;
    /** FlowyDynamicPlugin.decode's file checks: folder extension and the light/dark JSON files. */
    readPluginDirectory(path: string): Promise<IpcResult<CustomThemeFiles>>;
    /** Writes `<Documents>/<name>.flowy_plugin/<name>.light.json` and `.dark.json`. */
    install(theme: CustomThemeFiles): Promise<void>;
    remove(name: string): Promise<void>;
  };
  fonts: {
    /** Google Fonts faces for a family; `text` subsets the font to those characters (previews). */
    loadGoogleFont(family: string, text?: string): Promise<GoogleFontFace[]>;
  };
  /** App updates from GitHub Releases (check, download, restart-and-install). */
  updates: {
    state(): Promise<AppUpdateState>;
    check(): Promise<AppUpdateState>;
    download(): Promise<AppUpdateState>;
    cancelDownload(): Promise<AppUpdateState>;
    install(): Promise<AppUpdateState>;
    /** Opens the known release page; false when there is none. */
    openRelease(): Promise<boolean>;
    /** State pushes from the main process (automatic checks included). */
    onChange(listener: (state: AppUpdateState) => void): () => void;
  };
}

export const IpcChannel = {
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
  HyperStartupGet: 'hyper:startup-get',
  HyperStartupSet: 'hyper:startup-set',
  NetRequest: 'net:request',
  HyperBookmarkLoad: 'hyper:bookmark-load',
  HyperBookmarkThumbnailLoad: 'hyper:bookmark-thumbnail-load',
  HyperBookmarkThumbnailImport: 'hyper:bookmark-thumbnail-import',
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
  AssetsImportFile: 'assets:import-file',
  AssetsImportGeneratedImage: 'assets:import-generated-image',
  AssetsPreviewUrl: 'assets:preview-url',
  AssetsPreviewCloud: 'assets:preview-cloud',
  AssetsExportFile: 'assets:export-file',
  AssetsInlineUrl: 'assets:inline-url',
  AssetsWriteExportText: 'assets:write-export-text',
  AssetsWriteExportBytes: 'assets:write-export-bytes',
  DocumentExportPdf: 'document-export:pdf',
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
  AiEndpointDiscover: 'ai-endpoint:discover',
  CertificatesList: 'certificates:list',
  CertificatesInspectFile: 'certificates:inspect-file',
  CertificatesImport: 'certificates:import',
  CertificatesRemove: 'certificates:remove',
  ThemesList: 'themes:list',
  ThemesReadPluginDirectory: 'themes:read-plugin-directory',
  ThemesInstall: 'themes:install',
  ThemesRemove: 'themes:remove',
  FontsLoadGoogleFont: 'fonts:load-google-font',
  UpdateState: 'update:state',
  UpdateCheck: 'update:check',
  UpdateDownload: 'update:download',
  UpdateCancelDownload: 'update:cancel-download',
  UpdateInstall: 'update:install',
  UpdateOpenRelease: 'update:open-release',
  UpdateStateChanged: 'update:state-changed',
} as const;
