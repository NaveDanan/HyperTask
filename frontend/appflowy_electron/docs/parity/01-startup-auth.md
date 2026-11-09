# 01 — Startup, SDK init, auth flow, window (Windows desktop) — parity spec

Source of truth: `frontend/appflowy_flutter` in this checkout (modified, self-hosted build) + the modified Rust core (`frontend/rust-lib`, reused unchanged by Electron). Desktop/Windows only; mobile branches omitted. All paths below are relative to `appflowy_flutter/lib` unless prefixed.

Conventions:
- `Event(Payload{field…}) -> Response` = FFI request. Event string sent to Rust = enum variant name (e.g. `"SignInWithEmailPassword"`), see §7.
- i18n keys written dotted (`signIn.settings`) = `LocaleKeys.signIn_settings`; English (`assets/translations/en-US.json`, `@:appName` = `AppFlowy`) in §17.
- Theme tokens = `AppFlowyTheme.of(context)` (`packages/appflowy_ui`); numeric values in §16.
- **[BUG]** = observed behaviour that is probably unintended; **[AMBIG]** = cannot be resolved from code. Parity default = reproduce observed behaviour unless the note says otherwise.

---

## 0. Checkout-specific changes that matter here (vs upstream AppFlowy)

| Area | Upstream | This checkout |
|---|---|---|
| Default cloud | First launch auto-writes AppFlowy Cloud (`https://beta.appflowy.cloud`, type 2) | **Local** unless `kCloudType=="3"` AND stored URL passes `SelfHostedPolicy.validateServerUrl`; every other state is rewritten to local (`env/cloud_env.dart:getAuthenticatorType`) |
| `Env.enableCustomCloud` / `.env` cloud | Used | Removed; only shared-prefs config is used |
| `authenticator_type` sent to Rust | `env.authenticatorType.value` (0/2/3/4) | `isLocal ? 0 : 2` (`startup/tasks/rust_sdk.dart`) |
| Splash `isAnon` | `config.isAnon` | `config.isAnon \|\| isLocalAuthEnabled` (`startup/entry_point.dart`) → local mode auto-creates a guest user |
| `AutoUpdateTask` | Runs on desktop | **Removed** from task list (`startup/startup.dart`); no vendor updater |
| Vendor network | — | `SelfHostedPolicy.installNetworkPolicy()` blocks `appflowy.com/.io/.cloud` (+subdomains) for all Dart `HttpClient`s; `afLaunchUri` refuses vendor hosts; Rust `is_self_hosted_url` drops vendor cloud config |
| Company CA certs | — | `CompanyCertificateStore().restoreTrust()` before startup |
| Desktop sign-in | Email + OR divider + 3rd-party OAuth buttons + `SignInAgreement` | Email/password only + text `'Sign in to your collaboration server'`; OAuth buttons, `_OrDivider`, agreement removed |
| Settings "Cloud" page | `SettingCloud` with AppFlowy Cloud / self-host / local switcher | Label `'Storage & server'`, body = `SelfHostedSettingsView` (§13); also used inside the sign-in "Settings" dialog |
| Feature flags | — | `FeatureFlag.planBilling.isOn` hard-wired `false` (§15) |
| Rust core | — | `ServerProvider` forced to `AuthType::Local` when cloud config is absent/vendor; `AFCloudConfiguration::from_env` filtered by `is_self_hosted_url` |

The server origin `http://collaboration.example.com:8080` is **not hard-coded** anywhere in Dart. It exists only as user configuration (shared prefs `kAppFlowyCloudBaseURL` / `kAppFlowyBaseShareDomain`, set through "Storage & server"), docs (`doc/self-hosted-server.md`) and a Rust unit test. Current dev machine prefs: `kCloudType="3"`, both URLs `"http://collaboration.example.com:8080"`.

---

## 1. Native process layer (`windows/runner/*.cpp`) — replicate in Electron main

1. `wWinMain`: `CreateMutex(NULL, TRUE, L"AppFlowyMutex")`.
   - If `ERROR_ALREADY_EXISTS` (second instance): build a FlutterWindow only to call `SendAppLinkToInstance(L"AppFlowy")` → finds `FindWindow("FLUTTER_RUNNER_WIN32_WINDOW", "AppFlowy")`, forwards command line via `app_links` `SendAppLink(hwnd)` (WM_COPYDATA), restores it (`SW_SHOWMAXIMIZED` if maximized, `SW_RESTORE` if minimized, else `SW_NORMAL`), `SetForegroundWindow`; process exits. Fallback: `ShowWindow(FindWindowA(NULL,"AppFlowy"), SW_NORMAL)`; return 0.
   - Electron: `app.requestSingleInstanceLock()`; on `second-instance(argv)` → extract `appflowy-flutter:` URL from argv → feed into deep-link pipeline (§11), restore/maximize/focus as above.
2. Console attach (dev only), `CoInitializeEx(APARTMENTTHREADED)`, Dart entrypoint args = command-line args (UTF-8).
3. Window: class `FLUTTER_RUNNER_WIN32_WINDOW`, title `"AppFlowy"`, style `WS_OVERLAPPEDWINDOW`, origin (10,10), size **1280×720** logical (scaled by monitor DPI/96), shown immediately (`SW_SHOWNORMAL`), quit on close. DWM `DWMWA_USE_IMMERSIVE_DARK_MODE` = (`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme` == 0), re-evaluated on theme change. Dart later makes it frameless and resizes it (§14).
4. Exe version resource (`Runner.rc`): `CompanyName "io.appflowy"`, `ProductName "AppFlowy"`, `FileDescription/InternalName "AppFlowy"`, `OriginalFilename "AppFlowy.exe"`, `ProductVersion = FLUTTER_VERSION` = pubspec `version: 0.11.4` → `"0.11.4"`. These determine the support directory (§5) and `app_version` (§4).

---

## 2. `main()` (`main.dart`), before any task

```
SelfHostedPolicy.installNetworkPolicy();          // HttpOverrides.global
ScaledWidgetsFlutterBinding.ensureInitialized(scaleFactor: (_) => 1.0);
try { await CompanyCertificateStore().restoreTrust(); } catch (_) {}   // never blocks startup
await runAppFlowy();                               // isAnon=false
```

- `SelfHostedPolicy` (`env/self_hosted_policy.dart`):
  - `isVendorHost(host)`: lowercase, strip one trailing `.`; true if equal to or ends with `.appflowy.com`, `.appflowy.io`, `.appflowy.cloud`.
  - Network policy: every Dart `HttpClient` gets a `connectionFactory` that fails with `HttpException('AppFlowy hosted services are disabled in this self-hosted app.')` for vendor hosts (also on redirects); direct HTTPS uses `SecureSocket.startConnect` (normal cert validation), proxied connections plain socket. Electron: block the same hosts in `session.webRequest` + main-process fetch; does not apply to Rust (Rust has its own filter, §4).
  - `validateServerUrl(value)` (used by settings + `getAuthenticatorType`): throws `FormatException('Enter your server origin, such as https://appflowy.internal, without a path or credentials.')` unless scheme ∈ {http, https}, host non-empty, no userinfo, no query, no fragment, path empty or `/`; then throws `FormatException('AppFlowy hosted services are disabled. Enter your own server address.')` if vendor host.
- `restoreTrust()` (`features/company_certificates/company_certificate_store.dart`): reads `<support>\company_certificates\*.json` (`{subject, issuer, thumbprint, sha256, notBefore, notAfter, der(base64), installedByApp}`); for each with `notAfter > now`: `SecurityContext.defaultContext.setTrustedCertificatesBytes(PEM)`. Electron: add these CAs to Node/Electron trust (e.g. `app.on('certificate-error')` allow-list by SHA-256 or extra CA in `https.globalAgent`); details belong to the Certificates spec.

---

## 3. `runAppFlowy` / `FlowyRunner.run` (`startup/startup.dart`)

`runAppFlowy({isAnon=false})` = full soft restart; it is called for every sign-in success via deep-link path, sign-out, server switch, anonymous-user open, invalid auth, etc. Sequence:

1. `Log.info('restart AppFlowy: isAnon: $isAnon')`. Mode: release build → `IntegrationMode.release`; debug/profile (this checkout runs the **Debug** bundle, `scripts/run-dev.cmd`) → `develop`; env `FLUTTER_TEST` → unitTest.
2. `Log.shared.disableLog = mode.isTest`.
3. If an `AppLauncher` exists: `dispose()` every task in order (window listener removed, auth listener stopped, network listener stopped, …). Then `await getIt.reset()` (disposes singletons: `FlowySDK` (no-op), `AppFlowyCloudDeepLink` (cancels link subscription), `FileStorageService`).
4. `LaunchConfiguration(isAnon, version: PackageInfo.fromPlatform().version /*"0.11.4"*/, rustEnvs: rustEnvsBuilder?.call() ?? {} /* always {} outside integration tests */)`.
5. `initGetIt` → registers `EntryPoint`, lazy `FlowySDK`, lazy `AppLauncher`, `PluginSandbox`, `ViewExpanderRegistry`, `LinkHoverTriggers`, `AFNavigatorObserver`, `FloatingToolbarController`, then `DependencyResolver.resolve` (§3.1).
6. `applicationDataDirectory = Directory(await getIt<ApplicationDataStorage>().getPath())` (§5.2).
7. Tasks added and awaited **sequentially** (each logs `LaunchTask: <Type> initialize`, timing via `AppLauncher: task X initialized in N ms`). Desktop non-test list, in order:

| # | Task | Desktop behaviour |
|---|---|---|
| 1 | `PlatformErrorCatcherTask` | Non-debug: `PlatformDispatcher.onError` logs `'Uncaught platform error'` and swallows. `ErrorWidget.builder`: debug → 30px red bar `'ERROR: <exception>'` white text; release → empty. |
| 2 | `MemoryLeakDetectorTask` | No-op (`enableMemoryLeakDetect=false`). |
| 3 | `DebugTask` | Debug only: Bloc observer (Talker, disabled). No behaviour. |
| 4 | `FeatureFlagTask` | **Debug only** (`!kDebugMode → return`): `FeatureFlag.initialize()` from KV `featureFlag`. Release: overrides never loaded. |
| 5 | `InitLocalizationTask` | `EasyLocalization.ensureInitialized()`, logger off. |
| 6 | `InitAppWindowTask` | Window setup (§14). |
| 7 | `InitRustSDKTask(customApplicationPath: applicationDataDirectory)` | `init_sdk` (§4). |
| 8 | `PluginLoadTask` | Registers view plugins: Blank, Trash, Document, Grid, Board, Calendar, DatabaseDocument (registered twice), AIChat. UI-only. |
| 9 | `FileStorageTask` | Registers `FileStorageService`: opens a receive port and sends `FileStorageEventRegisterStream(RegisterStreamPB{port: int64})`; Rust posts JSON strings `{"file_url","progress"(num),"error"?}` → per-URL progress notifiers; `FileStorageEventQueryFile(QueryFilePB{url})` for initial state. Electron needs an equivalent stream channel. |
| 10 | `ApplicationInfoTask` | `ApplicationInfo.applicationVersion`=`"0.11.4"`, `buildNumber`=`""`, `deviceId`=SQMClient MachineId (§4), `architecture`=`'x86_64'`, `os`=`'windows'`. |
| — | ~~`AutoUpdateTask`~~ | Removed (comment: "Updates are built from this checkout; no vendor updater runs."). `ApplicationInfo.latestVersion` stays `''` → `isUpdateAvailable=false`. |
| 11 | `HotKeyTask` | `hotKeyManager.unregisterAll()` (clears OS-global hotkeys of previous run). Registers nothing. |
| 12 | `InitAppFlowyCloudTask` | **Only if `isAppFlowyCloudEnabled`** (self-host). Starts `UserAuthStateListener` (§12). |
| 13 | `InitAppWidgetTask` | `NotificationService.initialize()` (`local_notifier.setup(appName:'AppFlowy', shortcutPolicy: requireNoCreate)`), `loadIconGroups()`, `UserEventGetAppearanceSetting() -> AppearanceSettingsPB` and `UserEventGetDateTimeSettings() -> DateTimeSettingsPB` (**error → throws `FlowySDKException(AppearanceSettingsIsEmpty)`; startup aborts**), theme `AppTheme.fromName(appearance.theme)` (fallback on error/empty), then `runApp(EasyLocalization(33 locales, path 'assets/translations', fallback en-US, child: ApplicationWidget(key: ValueKey(context), child: SplashScreen(...))))`. `runApp` returns immediately → UI starts while tasks 14–15 run. |
| 14 | `InitPlatformServiceTask` | `NetworkListener.start()`: connectivity → `UserEventUpdateNetworkState(NetworkStatePB{ty})`, `ty` ∈ `NetworkUnknown=0, Wifi=1, Cell=2, Ethernet=3, Bluetooth=4, VPN=5` (`none`/`other` → `NetworkUnknown`); re-sent on every change. |
| 15 | `RecentServiceTask` | Log only. |

`ApplicationWidget`: `MaterialApp.router` (GoRouter, `initialLocation '/'`, `navigatorKey AppGlobals.rootNavKey`), light/dark theme from `AppearanceSettingsCubit` (locale from `AppearanceSettingsPB`; if `resetToDefault` → device locale, saved back), `textScaler = TextScaler.linear(state.textScaleFactor)`, `ToastificationWrapper`, `CommandPalette` overlay (search flag is on), `Tooltip.dismissAllToolTips()` on any scroll pointer signal.

### 3.1 DependencyResolver (`startup/deps_resolver.dart`) — auth-relevant parts

1. `KeyValueStorage` = `DartKeyValue` (shared_preferences, §5.3).
2. `_resolveCloudDeps`: `env = await AppFlowyCloudSharedEnv.fromEnv()` (§6) — **computed once per runAppFlowy**; `Log.info("cloud setting: $env")`; registered as factory returning that instance. If `isAppFlowyCloudEnabled`: `registerSingleton(AppFlowyCloudDeepLink())` — constructor runs now (registers protocol + link listener, §11).
3. `_resolveUserDeps` by `currentCloudType()`:
   - `local` → `AuthService = BackendAuthService(AuthTypePB.Local)`
   - `appflowyCloud | appflowyCloudSelfHost | appflowyCloudDevelop` → `AppFlowyCloudAuthService()` (wraps `BackendAuthService(AuthTypePB.Server)`).
   - Factories: `AuthRouter`, `SignInBloc(getIt<AuthService>())`, `SignUpBloc`, `SplashRouter`, `SplashBloc`, lazy `NetworkListener`, …
4. `ApplicationDataStorage` factory, `FlowyCacheManager` (temp dir cache, image cache, feature-flag cache) etc.
5. **Not registered: `WorkspaceBloc`** → `WorkspaceStartScreen` throws at runtime (§9.12).

---

## 4. `init_sdk` — exact JSON and Rust-side handling

Dart (`startup/tasks/rust_sdk.dart` → `packages/appflowy_backend/lib/appflowy_backend.dart` `FlowySDK.init`):

```
ffi.set_stream_port(RustStreamReceiver.shared.port);   // notifications, §7.2
ffi.store_dart_post_cobject(NativeApi.postCObject);    // Dart-isolate plumbing (no Electron analogue)
// set_log_stream_port only on iOS debug → NOT on Windows
code = ffi.init_sdk(0, jsonString.toNativeUtf8());     // non-zero → throw Exception('Failed to initialize the SDK')
```

JSON (`env/backend_env.dart`, json_serializable key order exactly as below):

| Field | Type | Value / computation |
|---|---|---|
| `root` | string | `getApplicationSupportDirectory().path` → `%APPDATA%\io.appflowy\AppFlowy` (§5.1) |
| `app_version` | string | `PackageInfo.version` = exe `ProductVersion` split on `+`, first part → `"0.11.4"`. Rust: semver parse, fallback/minimum `0.5.8`. |
| `custom_app_path` | string | `customApplicationPath ?? appFlowyApplicationDataDirectory()`; `customApplicationPath` = `ApplicationDataStorage.getPath()` result (§5.2) — always supplied by FlowyRunner. |
| `origin_app_path` | string | `appFlowyApplicationDataDirectory()` = `<root>\data` (release) or `<root>\data_dev` (debug/profile/develop). Directory is **not created** by Dart (Rust `ensure_path` creates it). |
| `device_id` | string | `getDeviceId()` (`user/application/auth/device_id.dart`): Windows → `device_info_plus` `windowsInfo.deviceId` = registry `HKLM\SOFTWARE\Microsoft\SQMClient` value `MachineId` (38-char uppercase GUID with braces, e.g. `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`); `PlatformException` → `''`; tests → `"test_device_id"`. **Not stored by the app**; re-read on each call. Electron must read the same registry value to keep sessions/device identity identical. |
| `platform` | string | `Platform.operatingSystem` → `"windows"` |
| `authenticator_type` | int | `env.authenticatorType.isLocal ? 0 : 2` (Rust `AuthenticatorType` is `Deserialize_repr u8` with only `0`/`2`; any other value panics in `serde_json::from_str(...).unwrap()`). |
| `appflowy_cloud_config` | object | `env.appflowyCloudConfig` (§6.4): `{base_url, ws_base_url, gotrue_url, enable_sync_trace, base_web_domain}`. Rust `AFCloudConfiguration` only reads `base_url`, `ws_base_url`, `gotrue_url` (others ignored). |
| `envs` | map<string,string> | `{}` (integration tests only inject values). Rust `std::env::set_var` each. |

Example — local mode, Debug build:
```json
{"root":"C:\\Users\\<u>\\AppData\\Roaming\\io.appflowy\\AppFlowy","app_version":"0.11.4",
 "custom_app_path":"C:\\Users\\<u>\\AppData\\Roaming\\io.appflowy\\AppFlowy\\data_dev",
 "origin_app_path":"C:\\Users\\<u>\\AppData\\Roaming\\io.appflowy\\AppFlowy\\data_dev",
 "device_id":"{GUID}","platform":"windows","authenticator_type":0,
 "appflowy_cloud_config":{"base_url":"","ws_base_url":"","gotrue_url":"","enable_sync_trace":false,"base_web_domain":"https://appflowy.com"},
 "envs":{}}
```
Example — self-host `http://collaboration.example.com:8080`:
```json
{..., "authenticator_type":2,
 "appflowy_cloud_config":{"base_url":"http://collaboration.example.com:8080","ws_base_url":"ws://collaboration.example.com:8080/ws/v1",
   "gotrue_url":"http://collaboration.example.com:8080/gotrue","enable_sync_trace":false,"base_web_domain":"http://collaboration.example.com:8080"},
 "envs":{}}
```
(Note host lowercased only in `ws_base_url` — Dart `Uri` normalizes host; `base_url`/`gotrue_url` are raw string concatenations. Verified with the Dart SDK.)

Rust `init_sdk(_port, json)` (`rust-lib/dart-ffi/src/lib.rs`), for parity of the Electron binding:
1. Null pointer → return `-1`. Parse JSON (panics on bad JSON).
2. `write_env()`: `APPFLOWY_CLOUD_ENV_CLOUD_TYPE` = `0|2`; `APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_BASE_URL`, `..._WS_BASE_URL`, `..._GOTRUE_URL` = values (empty strings in local mode); then each `envs` entry.
3. If `authenticator_type == 2`: append config to `<root>\appflowy.yaml` (`cloud_config: [ {base_url, ws_base_url, gotrue_url}, … ]`) unless an entry with same `base_url` exists.
4. `AppFlowyCoreConfig::new(version, custom_app_path, origin_app_path, device_id, platform, "appflowy")`:
   - `cloud_config = AFCloudConfiguration::from_env()` (Err if any URL empty) **filtered by `is_self_hosted_url`** on all three URLs (scheme http/https/ws/wss, no credentials, host not vendor). Local → `None`.
   - `storage_path`: `None` → `custom_app_path`. `Some` → `make_user_data_folder(custom_app_path, base_url)`: candidate `<custom>_<base64url-padded(base_url)>`; if that doesn't exist → `<custom>_<host>` (host lowercased by `url` crate) e.g. `...\data_dev_collaboration.example.com`; if still doesn't exist **and** `<custom>` exists → **recursively copy `<custom>` into it** (first switch to a server clones the local data folder); copy error → fall back to `<custom>`.
   - `ensure_path()` creates `storage_path` and `application_path` (= origin_app_path).
   - Log filter `info` (or `RUST_LOG`), crates incl. `sync_trace_log`.
5. If a core already exists (re-init on runAppFlowy) → `close_db()`; new task runner thread; `AppFlowyCore::new` (blocking). Logging initialized only once per process (`INIT_LOG`). Returns `0`.
6. Rust logs: `<storage_path>\log.<YYYY-MM-DD>` (daily, max 6) + hourly sync log (max 24).
7. `ServerProvider` (modified): if `cloud_config` is `None`, auth type is pinned to `Local` regardless of later `set_auth_type`.

---

## 5. Windows data locations and persisted state

### 5.1 Paths
| Purpose | Path |
|---|---|
| Support dir (`root`) | `%APPDATA%\io.appflowy\AppFlowy` (path_provider_windows: RoamingAppData + `CompanyName\ProductName` from exe VERSIONINFO, sanitized; created if missing) |
| Shared prefs | `<root>\shared_preferences.json` (flat JSON object; keys prefixed `flutter.`; all values written by this app are strings) |
| Default user data | `<root>\data` (release) / `<root>\data_dev` (debug) |
| Server-scoped data | `<custom>_<host>` e.g. `<root>\data_dev_collaboration.example.com` (or legacy `<custom>_<base64url(url)>` if present) |
| Cloud config log | `<root>\appflowy.yaml` |
| Company CAs | `<root>\company_certificates\<THUMBPRINT>.json` |
| Log export zip | `<root>\appflowy_logs.zip` (all files under `<root>` recursively whose name starts with `log.`) |
| Custom data dir | `<picked>\AppFlowyDataDoNotRename` (§5.2) |

Observed on the dev machine: `data_dev`, `data_dev_beta.appflowy.cloud` (legacy), `data_dev_collaboration.example.com`, `appflowy.yaml`, `shared_preferences.json`.

### 5.2 `ApplicationDataStorage` (`workspace/application/settings/application_data_storage.dart`)
- `getPath()`: cached; else KV `io.appflowy.appflowy_flutter.path_location` (prefs key `flutter.io.appflowy.appflowy_flutter.path_location`) or default `appFlowyApplicationDataDirectory()`. **If the resulting directory does not exist → `KeyValueStorage.clear()` (wipes ALL shared prefs: server config, window state, flags…) and return the default path.** [BUG-ish] On the very first launch the default dir doesn't exist yet, so prefs are wiped right after `getAuthenticatorType()` wrote local values (harmless); a deleted custom folder resets the whole app to local mode. The env for the current run was already computed, so it is unaffected.
- `setCustomPath(path)`: Windows `/`→`\`; append `AppFlowyDataDoNotRename` unless basename already equals it; create dir recursively; `setPath` → KV write, cache cleared.

### 5.3 Shared-pref keys read/written during startup/auth (`core/config/kv_keys.dart`; stored as `flutter.<key>`)
| Key | Format | Used by |
|---|---|---|
| `kCloudType` | `"0"` local, `"2"` AppFlowy Cloud, `"3"` self-host, `"4"` develop | §6 |
| `kAppFlowyCloudBaseURL` | origin string, no trailing `/` (`''` in local) | §6 |
| `kAppFlowyBaseShareDomain` | string (`''` in local) | §6 (`base_web_domain`) |
| `kAppFlowyEnableSyncTrace` | `"true"`/`"false"` (no UI reaches it in this checkout) | `enable_sync_trace` |
| `io.appflowy.appflowy_flutter.path_location` | absolute path | §5.2 |
| `windowSize` | `{"height":h,"width":w}` (doubles) | §14 |
| `windowPosition` | `{"dx":x,"dy":y}` | §14 |
| `windowMaximized` | `"true"`/`"false"` | §14 |
| `scaleFactor` | double string, clamped 0.5–2.0 | §14 |
| `featureFlag` | JSON `{flagName: bool}` (debug only) | §15 |
| `textScaleFactor` | double string | ApplicationWidget |

Electron: keep using the exact same JSON file/keys if side-by-side compatibility with the Flutter build is required; otherwise mirror keys 1:1 in its own store. **[AMBIG]** spec does not decide which; same file is recommended for migration.

---

## 6. `env/cloud_env.dart` (full behaviour)

### 6.1 `AuthenticatorType`
`local(0)`, `appflowyCloud(2)`, `appflowyCloudSelfHost(3)`, `appflowyCloudDevelop(4)` (1 = removed Supabase). `isLocal`; `isAppFlowyCloudEnabled` = 2|3|4. `fromValue` unknown → local. `kAppflowyCloudUrl = "https://beta.appflowy.cloud"` (only referenced by dead `ChangeCloudModeButton`).

### 6.2 Reading the type — `getAuthenticatorType()` (has write side-effects)
```
value = KV[kCloudType]; url = KV[kAppFlowyCloudBaseURL]
if value == '3' && url != null:
    try validateServerUrl(url); return appflowyCloudSelfHost
    on FormatException: fallthrough           // old vendor settings never restored
await useLocalServer()                         // writes kCloudType="0", URL="", shareDomain=""
return local
```
So types 2 and 4 can never be active; any non-self-host state is normalized to local on every call (startup and every open of the Storage & server view).

### 6.3 Setters
- `_setAuthenticatorType(t)` writes `kCloudType` = `"0"|"2"|"3"|"4"`.
- `useLocalServer()`: type `"0"`, `kAppFlowyCloudBaseURL=""`, `kAppFlowyBaseShareDomain=""`.
- `useBaseWebDomain(url)`: `kAppFlowyBaseShareDomain = url ?? ''`.
- `useAppFlowyBetaCloudWithURL(url, ty)`: `validateServerUrl(url)` (throws), store `url` with **one** trailing `/` removed, type **always `"3"`** (ignores `ty`).
- `useSelfHostedAppFlowyCloud(url)` → type 3 + raw url; `useAppFlowyCloudDevelop(url)` → type 4 + url (unused).
- Sync trace: `getSyncLogEnabled()` (`"true"` case-insensitive) / `setSyncLogEnabled(bool)`.

### 6.4 `AppFlowyCloudSharedEnv.fromEnv()`
```
type = await getAuthenticatorType()
config = type.isLocal ? AppFlowyCloudConfiguration.defaultConfig()
                      : await getAppFlowyCloudConfig(type)
```
- `defaultConfig()` = `{base_url:'', ws_base_url:'', gotrue_url:'', enable_sync_trace:false, base_web_domain:'https://appflowy.com'}`.
- `getAppFlowyCloudConfig(type)`: `baseURL = KV url ?? ''`, `shareDomain = KV ?? ''`; `configurationFromUri`:
  - develop(4): `base_url "$baseUrl:8000"`, `ws "ws://<host>:8000/ws/v1"`, `gotrue "$baseUrl:9999"`, trace true, `base_web_domain 'test.appflowy.com'` (unreachable).
  - else: `base_url = baseURL`; `ws_base_url = Uri(scheme: https? 'wss':'ws', host: uri.host, port: uri.hasPort ? uri.port : null, path:'/ws/v1')` (parse error → `''`); `gotrue_url = "$baseURL/gotrue"`; `enable_sync_trace = getSyncLogEnabled()`; `base_web_domain = type==appflowyCloud ? 'https://appflowy.com' : shareDomain`.
  - Any exception → `defaultConfig()`.
- `isValid` = all three URLs non-empty.

### 6.5 Derived getters
- `isAuthEnabled` = `authenticatorType.isAppFlowyCloudEnabled && appflowyCloudConfig.isValid`.
- `isLocalAuthEnabled` = `currentCloudType().isLocal`.
- `isAppFlowyCloudEnabled` = `currentCloudType().isAppFlowyCloudEnabled`.
- `currentCloudType()` = registered env's type (fixed for the run; switching requires `runAppFlowy`).

---

## 7. Backend bridge semantics

### 7.1 Requests (`packages/appflowy_backend/lib/dispatch/dispatch.dart`)
- `FFIRequest{ event: string (1), payload: bytes (2) }`, `event` = Dart enum `toString()` = variant name, e.g. `UserEvent.SignInWithEmailPassword` → `"SignInWithEmailPassword"`, `FolderEvent.GetCurrentWorkspaceSetting` → `"GetCurrentWorkspaceSetting"`. Payload = protobuf bytes of the input message (empty for no-input events).
- `FFIResponse{ payload: bytes (1), code: FFIStatusCode (2) }`, `Ok=0` → decode output message; `Err=1` → payload is `FlowyError{code: ErrorCode(1), msg: string(2), payload: bytes(3)}` and is also pushed to `GlobalErrorCodeNotifier` (notifies listeners only when code changes); `Internal=2` → payload is UTF-8 text, logged, returned as failure with empty bytes (→ default `FlowyError`, code `Internal`).
- Dart `async_event(port, bytes, len)`; `sync_event` unimplemented.

### 7.2 Notification stream
- `set_stream_port(port)`: Rust `unregister_all_notification_sender()` then registers a sender that posts each `SubscribeObject` protobuf to the port: `{source: string(1), ty: int32(2), id: string(3), oneof payload bytes(4), oneof error bytes(5)}`. Re-registered on every `runAppFlowy`.
- Dart `RustStreamReceiver` decodes and rebroadcasts; parsers filter by `source` (`"User"` for user notifications) and optional `id`. Deserialize error → logged and rethrown.
- Auth-relevant: `source "User"`, `id "auth_state_change_notification"`, `ty UserNotification.UserAuthStateChanged (1)`, payload `AuthStateChangedPB{state: AuthStatePB(1), message: string(2)}`; `AuthStatePB`: `AuthStateUnknown=0, AuthStateSignIn=1, AuthStateSignOut=2, InvalidAuth=3`. Other `UserNotification` values: `DidUpdateUserProfile=2, DidUpdateUserWorkspaces=3, DidUpdateCloudConfig=4, DidUpdateUserWorkspace=5, DidUpdateWorkspaceSetting=6, DidLoadUserAwareness=7, DidUpdateReminder=8, DidOpenWorkspace=9`.

### 7.3 Log stream / logging
- `set_log_stream_port` is **only called on iOS debug** → never on Windows. (If set: Rust posts UTF-8 log lines, Dart `Log.info`s them.) Electron: not required; optionally pipe for dev console.
- Dart `Log.*`: debug build → printed via Talker console only (not persisted); release → `rust_log(level, msg)` with level `info=0, debug=1, trace=2, warn=3, error=4` → written by Rust as `[Flutter]: <msg>` into the Rust log files. Release filters out debug-level Dart logs. Electron renderer/main logs should go through the same `rust_log` FFI in production for single-file logs.

---

## 8. Auth / routing decision flow

### 8.1 Routes (GoRouter, `startup/tasks/generate_router.dart`, desktop)
| Path | Screen | Transition |
|---|---|---|
| `/` | `SplashScreen` (EntryPoint child) via `MaterialExtendedPage` | redirect (below) |
| `/SignInScreen` | `SignInScreen` | fade, 700 ms (`RouteDurations.slow`) |
| `/SkipLogInScreen` | `SkipLogInScreen` | fade 700 ms |
| `/WorkspaceErrorScreen` | `WorkspaceErrorScreen(extra{error, userFolder})` | fade 700 ms |
| `/DesktopHomeScreen` | `DesktopHomeScreen` | fade 700 ms |
| `/WorkspaceStartScreen` | `WorkspaceStartScreen(extra{userProfile})` | fade 700 ms |

Root redirect (runs before Splash builds, every navigation to `/`): `getIt<AuthService>().getUser()` = `UserEventGetUserProfile() -> UserProfilePB`; success → redirect to `/DesktopHomeScreen` (Splash never shown); failure → stay on `/`.

`UserProfilePB`: `id int64(1), email(2), name(3), token(4), iconUrl(5), userAuthType AuthTypePB(6), workspaceType WorkspaceTypePB(7)`; `AuthTypePB Local=0, Server=1`; `WorkspaceTypePB LocalW=0, ServerW=1`.

### 8.2 SplashScreen logic (`user/presentation/screens/splash_screen.dart`)
`isAnon = config.isAnon || isLocalAuthEnabled`.
1. If `isAnon`: render `SizedBox.shrink()` until `_registerIfNeeded()` completes: `UserEventGetUserProfile()`; on failure → `getIt<AuthService>().signUpAsGuest()` (result ignored).
2. `SplashBloc` → `getIt<AuthService>().getUser()` (`UserEventGetUserProfile`) → `AuthState.authenticated(profile)` | `unauthenticated(error)`.
3. Authenticated → `FolderEventGetCurrentWorkspaceSetting() -> WorkspaceLatestPB{workspaceId(1), latestView ViewPB(2)}`: success → `context.go('/DesktopHomeScreen')`; failure → `handleOpenWorkspaceError(context, error)` (§8.4).
4. Unauthenticated → `isAuthEnabled` ? `context.go('/SignInScreen')` : `context.go('/SkipLogInScreen')`.

`signUpAsGuest()` (both services; `user/application/auth/backend_auth_service.dart`): `UserEventSignUp(SignUpPayloadPB{email(1):"anon@appflowy.io", name(2): tr('defaultUsername')="Me", password(3):"Guest!@123456", authType(4): Local, deviceId(5): getDeviceId()}) -> UserProfilePB`. (Note `email` is a vendor-domain literal; it's just an identifier, not a network call.)

### 8.3 Effective flows
**Local mode** (`kCloudType` ≠ valid "3"):
- Existing user: `/` redirect → GetUserProfile OK → `/DesktopHomeScreen`.
- First run: redirect fails → Splash (blank while registering) → SignUp guest → GetUserProfile OK → GetCurrentWorkspaceSetting → home.
- Guest sign-up failed → `/SkipLogInScreen`.
- `/SignInScreen` is unreachable in local mode on desktop (so `SignInAnonymousButtonV3` branch is dead code).

**Self-host mode** (`kCloudType="3"` + valid URL):
- Signed-in session in Rust: redirect → home.
- No session: Splash (cover image + spinner) → `/SignInScreen`.
- `AppFlowyCloudDeepLink` + `UserAuthStateListener` active.

### 8.4 `handleOpenWorkspaceError(context, FlowyError)` (`user/presentation/helpers/handle_open_workspace_error.dart`)
| `error.code` | Action |
|---|---|
| `WorkspaceDataNotSync (76)` | `UserFolderPB.fromBuffer(error.payload)` (`uid int64(1)`, `workspaceId(2)`) → `context.push('/WorkspaceErrorScreen', extra:{userFolder, error})` |
| `InvalidEncryptSecret (74)`, `NetworkError (59)` | error toast `error.msg`; user stays on Splash (no retry UI) |
| other | error toast `error.msg`; on toast dismissed (auto 3 s) → `AuthService.signOut()` (`UserEventSignOut`) → `runAppFlowy()` |

There is **no encrypt-secret screen** in this codebase (only the toast above).

### 8.5 After sign-in (`AuthRouter.goHomeScreen`, `user/presentation/router.dart`)
Used by `SignInScreen` listener (successOrFail success) and `SkipLogInScreen` auto-register: `FolderEventGetCurrentWorkspaceSetting()` → success → `context.go('/DesktopHomeScreen')`; failure → `SplashRouter.pushWorkspaceStartScreen` → `context.push('/WorkspaceStartScreen')` → **crashes** (§9.12) [BUG].

### 8.6 DesktopHomeScreen entry guard
`Future.wait([FolderEventGetCurrentWorkspaceSetting(), AuthService.getUser()])`; while pending → loading widget; if either fails → `WorkspaceFailedScreen` (§9.13); else home (spec 02).

### 8.7 Sign-out / restart
All sign-out/server-switch paths call `UserEventSignOut()` (where applicable) then `runAppFlowy()`; the flow restarts at §3 with a fresh env.

---

## 9. Screens

Common: desktop window is frameless (§14). Only `SignInScreen` renders the custom 40px `WindowTitleBar`; Splash, SkipLogIn, WorkspaceError, WorkspaceStart, WorkspaceFailed have **no caption buttons and no drag area** on Windows (OS resize borders only) — reproduce, or add a drag strip [AMBIG: probably unintended].

### 9.1 SplashScreen
- `isAnon` pre-phase: `SizedBox.shrink()` with no Scaffold [AMBIG: renders app/router background; use theme surface].
- Body: `Scaffold` → `Container(alignment: center)` → `_DesktopSplashBody`: `SingleChildScrollView` → `Stack(alignment: center)`: `Image.asset('assets/images/appflowy_launch_splash.jpg', fit: cover, width/height = window size)` + `CircularProgressIndicator.adaptive()` (Material spinner, 36px, theme primary).

### 9.2 SignInScreen (`sign_in_screen/sign_in_screen.dart` + `desktop_sign_in_screen.dart`, modified)
Wrapper: `BlocProvider(getIt<SignInBloc>())` + `BlocConsumer` listener: `state.successOrFail` success → `AuthRouter.goHomeScreen(context, profile)`; failure → `Log.error('Sign in error: …')` only.

Layout:
```
Scaffold(background: theme surface — light #FFFFFF / dark #1A202C)
 appBar: PreferredSize(height 40) → WindowTitleBar
 body: Center → AuthFormContainer(width 320; Column mainAxisSize.min, center) — fills height because of Spacers
   Spacer
   FlowyLogoTitle(title: tr('welcomeText') "Welcome to AppFlowy", logoSize 36×36)
       = Column[ AFLogo(FlowySvgs.app_logo_xl → assets/flowy_icons/40x/app_logo.svg, original colors, 36×36),
                 VSpace(20),
                 Text(title, heading3.enhanced = 20/28 w600, textColorScheme.primary) ]
   VSpace(spacing.xxl = 20)
   isLocalAuthEnabled ? SignInAnonymousButtonV3 (dead) : ContinueWithEmailAndPassword (§9.3)
   VSpace(20)
   if isAuthEnabled: Text('Sign in to your collaboration server', body.standard 14/20 w400, color: inherited default) — hard-coded English, no i18n key
   Spacer
   Row(min): [ DesktopSignInSettingsButton, HSpace(20), SignInAnonymousButtonV2 ]
   VSpace(20)
```
- `DesktopSignInSettingsButton`: `AFGhostIconTextButton` size `s`, padding h `spacing.m`=8 / v `spacing.xs`=4, radius 8, transparent bg (no hover bg), icon `FlowySvgs.settings_s` (16x asset drawn 20×20, color `textColorScheme.secondary`), gap 8, text `tr('signIn.settings')` "Settings" body.enhanced 14/20 w500 secondary. Tap → `showSimpleSettingsDialog` (§9.9).
- `SignInAnonymousButtonV2`: same style, icon `FlowySvgs.anonymous_mode_m` (20×20 asset, secondary), text `tr('signIn.anonymousMode')` "Anonymous mode". Behaviour §9.8.
- Removed vs upstream: OR divider (`signIn.or`), third-party buttons, `SignInAgreement`.
- `WindowTitleBar` (`shared/window_title_bar.dart`): height 40, bg `Theme.colorScheme.surfaceContainerHighest` (= `sidebarBg`: light `#F7F8FC`, dark `#232B38`), whole bar is `DragToMoveArea` (pan → `startDragging`; double-click toggles maximize/unmaximize). Row: `HSpace(4)`, (no left children), `Spacer`, caption buttons (window_manager `WindowCaptionButton`, min 46×32, vertically centered, 16×16 painted icons): minimize → `windowManager.minimize()`; maximize/unmaximize (toggles by `isMaximized`, tracked via listener) ; close → `windowManager.close()`. Non-close hover bg light `rgba(0,0,0,0.0373)`; close hover `#C42B1C` with white icon; icon light `rgba(0,0,0,0.8956)`, dark white.

### 9.3 ContinueWithEmailAndPassword (`widgets/continue_with/continue_with_email_and_password.dart`)
```
Column[
  AFTextField(key emailKey, size l, hint tr('signIn.pleaseInputYourEmail'), onSubmitted → _signInWithEmail(value)),
  VSpace(spacing.l = 12),
  AFFilledTextButton.primary(tr('signIn.continueWithEmail'), size l, full width) → _signInWithEmail(controller.text),
  VSpace(12),
  AFOutlinedTextButton.normal(tr('signIn.continueWithPassword'), size l, full width) → password path
]
```
- `AFTextField` l: content padding v10 h8, radius 10, 1px border `borderColorScheme.primary` (light `#E4E8F5`), focus `themeThick` (`#00B5FF`), error `errorThick`; text body.standard primary; hint body.standard `textColorScheme.tertiary`; error text below (gap 4) caption.standard 12/18 `textColorScheme.error`. `syncError(text)` sets error, `clearError()` clears.
- Buttons size l: padding h16 v10, radius 10, text body.enhanced 14/20 w500, height ≈ 40, stretch to 320 (alignment set). Primary: bg `themeThick` `#00B5FF` hover `#0092D6`, text white. Outlined normal: transparent bg (hover `contentHover`), border `#E4E8F5` (hover `#CED3E6`), text primary.
- Email validation = `string_validator.isEmail`. Invalid → `syncError(tr('signIn.invalidEmail'))`, nothing sent.
- **Continue with email** (valid): `SignInEvent.signInWithMagicLink(email)` AND push `ContinueWithMagicLinkOrPasscodePage` (Navigator `MaterialPageRoute`, guarded by `_hasPushed…` flag, reset on its back button).
- **Continue with password** (valid): push `ContinueWithPasswordPage` with `RouteSettings(name: '/continue-with-password')`.
- Bloc listener on this widget: `successOrFail` success → `clearError`; failure → `emailKey.syncError(error.msg)`; null & not submitting → clear.

### 9.4 ContinueWithMagicLinkOrPasscodePage
`Scaffold` (no title bar) → `Center` → `SizedBox(width 320)` → `Column(center)`:
- Mode A (default, `isEnteringPasscode=false`): `TitleLogo(title: tr('signIn.checkYourEmail'), description: tr('signIn.temporaryVerificationLinkSent'), info: Text(email, body.enhanced primary))`; `AFFilledTextButton.primary(tr('signIn.enterCodeManually'), l)` → mode B; `VSpace(20)`; `BackToLoginButton`.
- Mode B: `TitleLogo(title: tr('signIn.enterCode'), description: tr('signIn.temporaryVerificationCodeSent'), info: email centered)`; `AFTextField(hint tr('signIn.enterCode'), keyboard number, autofocus)`; `VSpace(12)`; submitting ? `VerifyingButton` : `ContinueWithButton(tr('signIn.continueWithLoginCode'))`; `VSpace(20)`; `BackToLoginButton`.
  - Submit (Enter or button): empty → `syncError(tr('signIn.invalidVerificationCode'))`; else `SignInEvent.signInWithPasscode(email, passcode)`.
- `TitleLogo`: `AFLogo` 36×36, VSpace 20, title heading3.enhanced primary, VSpace 20, description body.standard primary centered (contains `\n`), info widget, VSpace 20.
- `BackToLoginButton`: `AFGhostTextButton(tr('signIn.backToLogin'), size s, padding 0)`, text `textColorScheme.action` (`#0092D6`), hover `actionHover` (`#0078C0`). Here → `Navigator.pop`, clear email error, reset push flag.
- `ContinueWithButton`: primary filled l, text body.enhanced `onFill`.
- `VerifyingButton`: `Opacity(0.7)` disabled filled l, bg `themeThick`; Row center: 15×15 `CircularProgressIndicator(stroke 3, color onFill)`, HSpace 12, `tr('signIn.verifying')` body.enhanced onFill.
- Listener: any `successOrFail` failure → passcode field error `tr('signIn.tokenHasExpiredOrInvalid')` (only visible in mode B); mirrors `isSubmitting`.
- Magic-link completion arrives as deep link (§11) → `runAppFlowy()`; this page is discarded with the old tree.
- Self-host note (`doc/self-hosted-server.md`): magic links/passcodes require SMTP which is not configured → `MagicLinkSignIn` errors → mapped message under the email field of the screen underneath.

### 9.5 ContinueWithPasswordPage
`Scaffold` → `Center` → `SizedBox(320)` → `Column(center)`:
- `TitleLogo(title: tr('signIn.enterPassword'), info: RichText[ tr('signIn.loginAs') body.standard primary, ' $email' body.enhanced primary ])`.
- `AFTextField(hint tr('signIn.enterPassword'), autofocus, obscure, autofillHints [password], suffix PasswordSuffixIcon (FlowySvgs.show_s when obscured / hide_s when visible, 20×20, secondary, right padding 8, click cursor; toggles `syncObscured`), suffix constraints 28×20)`; Enter → `onEnterPassword(text)`.
- `VSpace(8)`; left-aligned `AFGhostTextButton(tr('signIn.forgotPassword'), s, padding 0, body.standard action/actionHover)` → push `ForgotPasswordPage` (route name `/forgot-password`, `baseUrl = getAppFlowyCloudUrl()`).
- `VSpace(20)`; submitting ? `VerifyingButton` : `ContinueWithButton(tr('web.continue') "Continue")` → `onEnterPassword(controller.text)` (no empty check).
- `VSpace(20)`; `BackToLoginButton` → clear email error + `Navigator.pop`.
- `onEnterPassword` → `SignInEvent.signInWithEmailAndPassword(email, password)`.
- Listener: any `successOrFail` failure OR `passwordError != null` → field error `tr('signIn.invalidLoginCredentials')` (regardless of actual message); else clear. Mirrors `isSubmitting`.
- `onForgotPassword` callback is a TODO no-op (the visible link uses `_pushForgotPasswordPage`).

### 9.6 ForgotPasswordPage
Layout like 9.5: `TitleLogo(title tr('signIn.resetPassword'), description tr('signIn.resetPasswordDescription'))`; `AFTextField` **prefilled with the email**, hint `tr('signIn.enterPassword')` [BUG: wrong hint], autofocus; `VSpace(20)`; Verifying | `ContinueWithButton(tr('button.submit'))`; `VSpace(20)`; `BackToLoginButton(widget.backToLogin)`.
- Submit: `isEmail` else `syncError(tr('signIn.invalidEmail'))`; local `isSubmitting=true`; `PasswordHttpService(baseUrl, authToken:'').forgotPassword(email)` = **direct HTTP** `POST {baseUrl}/gotrue/recover`, headers `Content-Type: application/json`, `Authorization: Bearer ` (empty), body `{"email": email}`. 200 → push `ResetPasswordPage` (`/reset-password`); else field error `error.toString()` [BUG: protobuf debug string of FlowyError].
- `backToLogin` here = the password page's callback → pops only the top route (returns to the password page, not to sign-in) [AMBIG naming].

### 9.7 ResetPasswordPage (`reset_password_page.dart`)
State `enterPasscode` → `ResetPasswordWidget`; on token validated → `setNewPassword` → `SetNewPasswordWidget`.
- `ResetPasswordWidget`: `TitleLogo(checkYourEmail / temporaryVerificationLinkSent / email)`; code field (number, autofocus; Enter with empty → `invalidVerificationCode`, non-empty Enter does nothing [BUG]); `VSpace(12)`; Verifying | `ContinueWithButton(tr('signIn.continueToResetPassword'))` → empty check → `SignInEvent.validateResetPasswordToken(email, token)`; `VSpace(20)`; BackToLogin. Bloc: `POST {baseUrl}/gotrue/verify` body `{"type":"recovery","email","token"}` → `access_token` stored in `SignInBloc.passwordService.authToken`. Failure → field error `tr('signIn.resetPasswordFailed')`.
- `SetNewPasswordWidget`: `TitleLogo(title resetPassword, info RichText[enterNewPasswordFor, email(enhanced)] centered)`; labels caption.enhanced secondary + `VSpace(8)`: `tr('signIn.newPassword')` + obscure field hint `tr('signIn.enterNewPassword')`; `VSpace(16)`; `tr('signIn.confirmPassword')` + field hint `tr('signIn.confirmNewPassword')`; `VSpace(20)`; Verifying | `ContinueWithButton(tr('signIn.resetPassword'))`; `VSpace(20)`; BackToLogin.
  - Validation order: new empty → `newPasswordCannotBeEmpty` (on new field); confirm empty → `confirmPasswordCannotBeEmpty` (confirm field); mismatch → `passwordsDoNotMatch` (confirm field).
  - `SignInEvent.resetPassword(email, newPassword)` → `POST {baseUrl}/gotrue/user/change-password` with `Authorization: Bearer <recovery access_token>`, body `{"password": newPassword}`.
  - Success → toast `tr('signIn.resetPasswordSuccess')` + `Navigator.popUntil(route.name == '/continue-with-password')`. Failure: HTTP 422 → code `NewPasswordTooWeak` → `tr('signIn.passwordMustContain')`; else `error.msg` (server `msg` or `'Failed to setup password'`).
- `PasswordHttpService` generic: 200 + body → JSON; 200 empty → `true`; non-200 → `FlowyError(code: 422→NewPasswordTooWeak else Internal, msg: body.msg ?? default)`; exception → `FlowyError(msg:'Network error: $e')`. Defaults: recover `'Failed to send password reset email'`, verify `'Failed to verify reset password token'`. Base URL from `kAppFlowyCloudBaseURL` (loaded async in `SignInBloc` ctor; `null` service → events silently no-op).

### 9.8 Anonymous buttons + `AnonUserBloc` (`user/application/anon_user_bloc.dart`)
- On create: `UserEventGetAnonUser() -> UserProfilePB`; success → `anonUsers=[user]`; error code ≠ `RecordNotFound(3)` → logged.
- Tap with no anon user → `SignInEvent.signInAsGuest` → `signUpAsGuest()` (§8.2 payload; `authType Local` even in server mode) → success → `successOrFail` success → `AuthRouter.goHomeScreen`.
- Tap with anon user → `UserEventOpenAnonUser()` → `openedAnonUser=user` → listener `runAppFlowy()`.
- V3 (dead on desktop): `AFFilledTextButton.primary(tr('signIn.continueWithLocalModel'), l)` same logic.
- `ChangeCloudModeButton` (`tr('signIn.switchToAppFlowyCloud')`, `cloud_mode_m`) — unused; would throw (vendor URL rejected).

### 9.9 Sign-in "Settings" dialog — `SimpleSettingsDialog` (`workspace/presentation/settings/settings_dialog.dart`)
`showDialog` (barrier dismissible, default Material barrier) → `FlowyDialog(width: 0.7 × window width, constraints min 564 / max 784, radius 16, bg Theme.cardColor)` → `SingleChildScrollView` → `Padding(24)` → `Column(start)`:
1. `FlowyText(tr('signIn.settings'), fontSize 36, w600)`; `VSpace(18)`.
2. `SettingsCategory(title tr('settings.workspacePage.language.title'))` → `LanguageDropdown`; `VSpace(22)`.
3. `SelfHostedSettingsView(restartApp: () => runAppFlowy())` (§13; dialog is not popped — replaced by the restart); `VSpace(22)`.
4. `SettingsCategory(tr('settings.mobile.support'))`: Row[`tr('workspace.errorActions.exportLogFiles')`, Spacer, `OutlinedRoundedButton(tr('settings.files.export'), minWidth 78)` → `shareLogFiles` (zip `log.*` under support dir → `<support>\appflowy_logs.zip` → open via `afLaunchUri(file uri)`; none → error toast `tr('noLogFiles')`)]; Row[`tr('settings.files.clearCache')`, Spacer, `OutlinedRoundedButton(tr('button.clear'))` → `FlowyCacheManager.clearAllCache()` → toast `tr('settings.manageDataPage.cache.dialog.successHint')`].
- `SettingsCategory`: title heading4.enhanced 16/22 w600 primary, `VSpace(16)`, children separated by `VSpace(16)` when >1.

### 9.10 SkipLogInScreen (`skip_log_in_screen.dart`) — local fallback only
```
Scaffold
 appBar: _SkipLoginMoveWindow (preferred height 55; on Windows renders nothing → 55px empty band, not draggable)
 body: Center → Column(center)[
   Spacer,
   FlowyLogoTitle(tr('welcomeText'), logo 40×40),
   VSpace(32),
   GoButton,
   VSpace(32),
   SizedBox(width: 70% window) → FolderWidget,
   Spacer,
   SkipLoginPageFooter,
   VSpace(20) ]
```
- `GoButton`: `AnonUserBloc`; `SizedBox(340×48)` `FlowyButton(isSelected: true, radius 6)` with centered `FlowyText.medium(14)`: `tr('letsGoButtonText')` "Quick Start" if no anon user, else `tr('signIn.continueAnonymousUser')`. Tap: anon user → `OpenAnonUser` → `runAppFlowy()`; else if folder customized → `runAppFlowy(isAnon: true)`; else `signUpAsGuest()` → success `AuthRouter.goHomeScreen` / failure `Log.error` only (no UI).
- `FolderWidget` (`user/presentation/widgets/folder_widget.dart`), options page only (create page unreachable): `Card` → `Padding(16)` → Row[`FlowySvgs.archive_m`, 16, Expanded Column[Row[`FlowyText.regular(tr('settings.files.defineWhereYourDataIsStored'), 14, Poppins w500, ellipsis)`, warning icon `Icons.warning_amber_rounded` 20 `Colors.orangeAccent` with tooltip `tr('settings.menu.customPathPrompt')` (maxWidth 450, padding 10, surface bg, radius 6, above)], VSpace 4, `FlowyText.regular(<current data path>, 12, Poppins w300, ellipsis)`], 16, `SecondaryTextButton(tr('settings.files.set'), small)`]. "Set" → native folder picker → `ApplicationDataStorage.setCustomPath(picked)` (§5.2) → `_didCustomizeFolder = true` → rebuild.
- `SkipLoginPageFooter`: `Padding(h16)` Row[HSpace 180, Expanded `SubscribeButtons`, SizedBox(180×28) Row[Spacer, `LanguageSelectorOnWelcomePage`]].
  - `SubscribeButtons`: centered `Wrap` of two rows: [`tr('youCanAlso')` 12, link `tr('githubStarText')` (w500, `colorScheme.primary`, h-padding 4, transparent hover) → `https://github.com/AppFlowy-IO/appflowy`], [`tr('and')` 12, link `tr('subscribeNewsletterText')` → `https://www.appflowy.io/blog` — **blocked by vendor policy, silently no-op**].
  - `LanguageSelectorOnWelcomePage`: popover (offset (0,−450), bottom-right aligned); trigger `FlowyButton` intrinsic: [`ethernet_m` 20, 4, language name, `drop_menu_hide_m` 20]; list max height 400 of 32px items `FlowyText.medium(languageFromLocale)` + `check_s` on current → `AppearanceSettingsCubit.setLocale` + close.

### 9.11 WorkspaceErrorScreen (`workspace_error_screen.dart`)
`Scaffold(extendBody)` → `Center` → `SizedBox(width 500)` → `IntrinsicHeight` → Column[ Column(start)[`FlowyText.medium(error.msg, 14, maxLines 10)`, `FlowyText.medium("Error code: ${code.value}", 12)` (hard-coded English, int code)], `VSpace(50)`, `SizedBox(200×40) FlowyButton(FlowyText.medium(tr('settings.menu.logout') "Log out", center))`, `VSpace(20)` ].
Log out → bloc `logout` → `AuthService.signOut()` (`UserEventSignOut`) → `runAppFlowy()`. Bloc `loadingState.finish(error)` → snackbar (`showSnapBar(err.msg)`) — unreachable (no reset action UI).

### 9.12 WorkspaceStartScreen (vestigial) [BUG]
`getIt<WorkspaceBloc>(param1: userProfile)` — **WorkspaceBloc is not registered** → GetIt throws when this route is pushed (only reachable when `GetCurrentWorkspaceSetting` fails right after a successful sign-in). Intended layout (if implemented): `Padding(60)` Column[ list of workspaces (`FlowyTextButton` 46px, 14) or `AppFlowyErrorPage(error)`, `FlowyTextButton(tr('workspace.create'))` 200×40 → `UserEventCreateWorkspace(CreateWorkspacePB{name: tr('workspace.hint') "workspace", workspaceType: ServerW})` ]; bloc init calls `UserEventGetAllWorkspace` but discards results (always empty list). Electron recommendation: treat as an error → show WorkspaceFailedScreen-like error; flag for product decision.

### 9.13 WorkspaceFailedScreen (`workspace/presentation/home/errors/workspace_failed_screen.dart`)
`Material/Scaffold` → `Center` → `SizedBox(400)` → Column(center)[ `Text(tr('workspace.failedToLoad'))`, `VSpace(20)`, Row[ Flexible `RoundedTextButton(tr('workspace.errorActions.reportIssue'), h40)` → GitHub new-issue URL with `version` (PackageInfo) & `os=windows`; `HSpace(20)`; Flexible `RoundedTextButton(tr('workspace.errorActions.reachOut'), h40)` → `https://discord.gg/JucBXeU2FE` ] ].

---

## 10. `SignInBloc` (`user/application/sign_in_bloc.dart`)

State: `{email?, password?, isSubmitting, passwordError?, emailError?, successOrFail?: Result<UserProfilePB,FlowyError>, forgotPasswordSuccessOrFail?, validateResetPasswordTokenSuccessOrFail?, resetPasswordSuccessOrFail?, loginType = signIn}`.

Constructor (only if `isAppFlowyCloudEnabled`): subscribe to `AppFlowyCloudDeepLink` loading state → `deepLinkStateChange`; create `PasswordHttpService(baseUrl: kAppFlowyCloudBaseURL, authToken: '')` asynchronously.

| Event | Guard | Backend | Result handling |
|---|---|---|---|
| `signInWithEmailAndPassword(email,pw)` | — | `UserEventSignInWithEmailPassword(SignInPayloadPB{email(1), password(2), name(3) unset, authType(4): Server(1) in self-host / Local in local, deviceId(5)}) -> GotrueTokenResponsePB` | OK → `AppFlowyCloudDeepLink.passGotrueTokenResponse(token)` (not awaited) and `isSubmitting=false`; Err → `_stateFromCode` |
| `signInWithMagicLink(email)` | ignored if `isSubmitting` | `UserEventMagicLinkSignIn(MagicLinkSignInPB{email(1), redirectTo(2): ''}) -> UserProfilePB` | OK → `isSubmitting=false`; Err → `_stateFromCode` |
| `signInWithPasscode(email,code)` | ignored if submitting | `UserEventPasscodeSignIn(PasscodeSignInPB{email(1), passcode(2)}) -> GotrueTokenResponsePB` | OK → `passGotrueTokenResponse`; Err → `_stateFromCode` |
| `signInAsGuest` | — | `UserEventSignUp` guest payload (§8.2) | OK → `successOrFail=success(profile)`; Err → `_stateFromCode` |
| `signInWithOAuth(platform)` | — | `UserEventGetOauthURLWithProvider(OauthProviderPB{provider})` → open URL externally → await deep link completer | Unreachable on desktop (buttons removed) |
| `emailChanged`/`passwordChanged` | — | — | set value, clear its error + `successOrFail` |
| `cancel` | — | — | reset submitting/errors/successOrFail |
| `forgotPassword(email)` | ignored if submitting | HTTP recover | `forgotPasswordSuccessOrFail` (bloc path unused by UI; UI calls service directly) |
| `validateResetPasswordToken(email, token)` | ignored if submitting | HTTP verify | stores token; `validateResetPasswordTokenSuccessOrFail` |
| `resetPassword(email, pw)` | ignored if submitting | HTTP change-password | `resetPasswordSuccessOrFail` |
| `deepLinkStateChange(r)` | — | — | `loading` → `isSubmitting=true`, clear errors; `finish` → only acts if `r.result != null` (never, see §11) ; `error` → `isSubmitting=false` |
| `switchLoginType` | — | — | UI-unused |

Every "start" emits `isSubmitting=true, emailError=null, passwordError=null, successOrFail=null` first.

`_stateFromCode(FlowyError e)`:
| `e.code` | Resulting state |
|---|---|
| `EmailFormatInvalid (20)` | `emailError = e.msg` |
| `PasswordFormatInvalid (25)` | `passwordError = e.msg` |
| `UserUnauthorized (2)` | `successOrFail = failure(FlowyError(msg: m))`, `m` = `msg` contains `'rate limit'` or `'For security purposes'` → `tr('signIn.tooFrequentVerificationCodeRequest')`; else contains `'invalid'` → `tr('signIn.tokenHasExpiredOrInvalid')`; else contains `'Invalid login credentials'` → `tr('signIn.invalidLoginCredentials')`; else `tr('signIn.generalError')`. All `contains` checks are case-sensitive and evaluated in this order (so a message with lowercase `invalid` maps to "code expired" even for password logins). |
| other | `successOrFail = failure(FlowyError(msg: tr('signIn.generalError')))` |
All set `isSubmitting=false`.

`GotrueTokenResponsePB`: `accessToken(1), tokenType(2), expiresIn int64(3), expiresAt int64(4), refreshToken(5), providerAccessToken(6), providerRefreshToken(7)`.

---

## 11. Deep links (`startup/tasks/appflowy_cloud_task.dart`, `startup/tasks/deeplink/*`)

Active **only when `isAppFlowyCloudEnabled`** (self-host). There is no `appflowy://` scheme; the scheme is **`appflowy-flutter`**.

Registration (constructor of `AppFlowyCloudDeepLink`, at DI time, every launch): `registerProtocolHandler('appflowy-flutter')` (url_protocol) writes `HKCU\SOFTWARE\Classes\appflowy-flutter`: `(Default)="URL:Appflowy-flutter"`, `URL Protocol=""`, `shell\open\command\(Default)= <Platform.resolvedExecutable> "%1"` (no quotes around exe path). Electron: `app.setAsDefaultProtocolClient('appflowy-flutter')` (or write identical keys) — only in self-host mode to match.

Intake: `app_links` `uriLinkStream` (static `_AppLinkWrapper`, survives restarts; links arrive from the single-instance forwarder §1). Cold-start launch URL delivery [AMBIG: depends on app_links Windows impl; Electron should also check `process.argv` at startup]. Each link: `Log.info('onDeepLink: <scheme>://<host><path>')` → `_handleUri`.

`_handleUri(uri)`: set state `none`; `null` → complete pending completer with `AuthError.emptyDeepLink` (`'Unexpected empty DeepLink'`). Else first matching handler (registration order):
1. `LoginDeepLinkHandler`: `uri.fragment` contains `access_token` → state `loading` → `UserEventOauthSignIn(OauthSignInPB{map(1): {"sign_in_url": uri.toString(), "device_id": getDeviceId()}, authType(2): Server}) -> UserProfilePB` → state `finish` → result.
2. `PaymentDeepLinkHandler`: host `payment-success` → `SubscriptionSuccessListenable.onPaymentSuccess(query.plan)` (irrelevant here).
3. `InvitationDeepLinkHandler`: host `invitation-callback` with query `workspace_id` and `email` → `openWorkspaceNotifier.value = {workspaceId, email}`.
4. `ExpireLoginDeepLinkHandler`: `uri.toString()` contains `error=access_denied` → failure `'Magic link is invalid or has expired'` → error toast.
5. `OpenAppDeepLinkHandler`: exactly `appflowy-flutter://` → success, no-op.
No match → `FlowyError('No handler found for DeepLink: <uri>')` → toast (error) or completer failure.

Login result: if no completer registered (all email/password/passcode/magic-link flows) → success ⇒ `runAppFlowy()`; failure ⇒ toast `err.msg` (success-type styling [BUG]); with completer (OAuth only) → complete it.

Token bridging `passGotrueTokenResponse(t)`: builds `appflowy-flutter://login-callback#` + `&`-joined `encodeComponent(k)=encodeComponent(v)` in this order, each only if present/non-empty: `access_token`, `expires_at`, `expires_in`, `provider_refresh_token`, `provider_token` (=providerAccessToken), `refresh_token`, `token_type`; no params → `null` URI. Then `_handleUri` locally (no OS round-trip). Electron must reproduce this exact URL string because Rust parses `sign_in_url`.

[BUG] Because `DeepLinkResult(state: finish)` never carries `result`, `SignInBloc` stays `isSubmitting=true` ("Verifying…") after a failed OauthSignIn; only a toast appears. On success the restart hides it.

---

## 12. Auth-state listener & restart (`InitAppFlowyCloudTask`, `user/application/user_auth_listener.dart`)
Self-host only. Subscribes to notifications (§7.2) `id="auth_state_change_notification"`, `source="User"`, `ty=UserAuthStateChanged`:
- `AuthStateSignIn` → `isLoggingOut=false`.
- `InvalidAuth` → `Log.error(message)`; `if (!isLoggingOut) runAppFlowy()` (flag is never set true → always restarts) → user lands on Sign-in.
- Others ignored. Stopped on task dispose.

---

## 13. "Storage & server" — `SelfHostedSettingsView` (`features/self_hosting/self_hosted_settings_view.dart`)
Used in: sign-in Settings dialog (restart = `runAppFlowy()`), and full Settings → menu item `'Storage & server'` (icon `FlowySvgs.settings_page_cloud_m`, `SettingsPage.cloud`; `SettingCloud` → this view; restart = pop dialog + `runAppFlowy()`). Also a new menu item `'Certificates'` (`Icons.verified_user_outlined` 20) → separate spec.

Load: `getAuthenticatorType()` (normalizes/writes, §6.2), `getAppFlowyCloudUrl()`, `getAppFlowyShareDomain()`; `_shared = !type.isLocal`; fields prefilled (empty in local mode because the normalization just cleared them). Loading → centered adaptive spinner.

UI (raw Material widgets; all strings hard-coded English, no i18n):
```
SettingsBody(title 'Storage & server')  // SingleChildScrollView padding 24; header heading2.enhanced 24/32 w600 primary;
                                        // then divider spacer (12 top/12 bottom, Divider color borderColorScheme.primary) between every child
  Text('Your data stays on this PC or your own collaboration server. AppFlowy hosted services and automatic vendor updates are disabled.', textTheme.bodyMedium)
  DropdownButtonFormField<bool>(label 'Workspace storage', items: false→'Local workspace on this PC', true→'My collaboration server'; disabled while saving)
  if _shared:
    TextField(label 'Server URL', hint 'https://appflowy.internal', disabled while saving)
    TextField(label 'Web and shared-page URL', hint 'Same as server if left blank', disabled while saving)
    Text('Sign in to your own server to collaborate. Local workspaces remain separate; export/import them to move existing content.')
  if _error: Text(_error, color colorScheme.error)
  Align(left): FilledButton(saving ? 'Applying…' : 'Apply and restart', disabled while saving)
```
Apply (`_save`): `_saving=true, _error=null`;
- shared: `validateServerUrl(server.trim())`; `web = web.trim().isEmpty ? server.trim() : web.trim()`; `validateServerUrl(web)`; `useBaseWebDomain(web)` (stored as typed, trailing `/` kept); `useAppFlowyBetaCloudWithURL(server.trim(), selfHost)` (strips one trailing `/`, type `"3"`); restart.
- local: `useLocalServer()`; restart.
- Any exception → `_error = error.toString()` (e.g. `"FormatException: Enter your server origin, such as https://appflowy.internal, without a path or credentials."`), `_saving=false`.
- No confirmation dialog, no reachability check. Switching modes never deletes data (local data stays in `<custom>`; server data in `<custom>_<host>`).
- Dead code in `setting_cloud.dart`: `CloudTypeSwitcher`/`CloudTypeItem` (would show `tr('settings.menu.changeServerTip')` dialog), `titleFromCloudType` → `'Local workspace'` / `'My collaboration server'`.

---

## 14. Window management, hotkeys, updater, misc

`InitAppWindowTask` (`startup/tasks/windows.dart` + `app_window_size_manager.dart`), skipped in tests:
1. `windowManager.ensureInitialized()`; add itself as `WindowListener`.
2. `size = getSize()`: KV `windowSize` JSON (default `{"height":960,"width":1280}`), missing keys → 640; clamp width/height to [640, 8192].
3. Options: min `640×640`, max `8192×8192`, title `'AppFlowy'`.
4. `position = getPosition()`: KV `windowPosition` `{dx,dy}` or null.
5. Windows: `windowManager.setTitleBarStyle(TitleBarStyle.hidden)` (frameless; OS resize borders kept; app draws its own caption on Sign-in and Home only). `doWhenWindowReady` (bitsdojo, fires after first rasterized frame; immediately on restarts): `appWindow.minSize`, `maxSize`, `size = stored` (bitsdojo `SetWindowPos` raw values), `position = stored` if any, `maximize()` if KV `windowMaximized == "true"`.
   - [AMBIG] Size is saved via window_manager `getSize()` (logical px) but applied via bitsdojo `SetWindowPos` (physical px); at >100% DPI they diverge. Electron: use DIP consistently.
6. Async: `ScaledWidgetsFlutterBinding.scaleFactor = KV scaleFactor` (double, default 1.0, clamp 0.5–2.0) — global UI zoom (Electron: `webContents.setZoomFactor`).
7. Persistence listeners: `onWindowResize` → `windowSize` = current size clamped; `onWindowMoved` → `windowPosition`; `onWindowMaximize`/`onWindowEnterFullScreen` → `windowMaximized="true"`, `windowPosition={0,0}`; `onWindowUnmaximize`/`onWindowLeaveFullScreen` → `"false"` + current position.
8. Re-run on every `runAppFlowy` (re-applies stored size/position/maximize).

Electron mapping: `BrowserWindow({ frame:false, title:'AppFlowy', width, height, x?, y?, minWidth:640, minHeight:640, maxWidth:8192, maxHeight:8192, show:true })`, maximize if flag; persist on `resize`/`move`/`maximize`/`unmaximize`/`enter-full-screen`/`leave-full-screen` with the same KV keys/format.

Other:
- Hotkeys: only `hotKeyManager.unregisterAll()` at startup; app shortcuts are in-app (spec 02+).
- Auto-updater: **disabled** (task removed; `auto_updater` package still linked; no feed URL contacted). Do not implement Sparkle/appcast.
- Local notifications: `local_notifier` app name `'AppFlowy'`, no shortcut creation.
- Toasts (`showToastNotification`): bottom-center, auto close 3000 ms, default type success, desktop `DesktopToast`.
- URL launching: `afLaunchUri` refuses vendor hosts (returns false, calls `onFailure`); on Windows prefixes `https://` if no scheme.
- `MoveWindowDetector` is macOS-only (renders child or nothing on Windows).
- `DesktopSignInScreen.onWindowFocus` → `setState` but listener is never added (dead).

---

## 15. Feature flags (`shared/feature_flags.dart`) & disabled features
- `planBilling.isOn` → **always false** (checkout change; plan/billing settings hidden).
- Always on (hard-coded list): `spaceDesign, search, collaborativeWorkspace, membersSettings, syncDatabase, syncDocument, inlineSubPageMention`.
- `sharedSection`, `unknown`: false unless KV override, and overrides are only loaded in **debug** builds.
- Disabled/removed in this checkout (auth/startup scope): vendor cloud (`https://beta.appflowy.cloud`) and any type other than local/self-host; third-party OAuth sign-in UI; sign-in agreement; auto-update; vendor-host HTTP (Dart + Rust); vendor links (newsletter); cloud develop mode.

---

## 16. Design tokens used (light / dark) — `packages/appflowy_ui`
- Spacing: `xs 4, s 6, m 8, l 12, xl 16, xxl 20`. Radius: `xs 4, s 6, m 8, l 12`; button/textfield size `l` radius 10.
- Text (font = app font family): `heading2 24/32`, `heading3 20/28`, `heading4 16/22` (standard w400, enhanced w600); `body 14/20` (standard w400, enhanced w500); `caption 12/18` (standard w400, enhanced w500).
- `textColorScheme`: primary `#21232A`/`#E4E8F5`; secondary `#6F748C`/`#989EB7`; tertiary `#989EB7`/`#6F748C`; onFill `#FFFFFF`; action `#0092D6`/`#00B5FF`; actionHover `#0078C0`/blue400; error red600 `#E71D32`/red500.
- `fillColorScheme`: themeThick `#00B5FF`, themeThickHover `#0092D6`; content transparent; contentHover `rgba(31,35,41,0.05)` / `rgba(249,250,253,0.05)`.
- `borderColorScheme`: primary `#E4E8F5`/`#3D404F`(neutral800), primaryHover `#CED3E6`, themeThick `#00B5FF`.
- Button sizes: `s` padding h12 v4 (overridden to h8 v4 on sign-in ghost buttons), radius 8; `l` padding h16 v10, radius 10; text body.enhanced. Focus ring 2px `themeThick` @50% alpha, outside.
- Material theme (flowy_infra): scaffold surface `#FFFFFF`/`#1A202C`; title bar `#F7F8FC`/`#232B38`.

---

## 17. i18n keys used (en-US)
| Key | English |
|---|---|
| `welcomeText` | Welcome to AppFlowy |
| `signIn.settings` | Settings |
| `signIn.anonymousMode` | Anonymous mode |
| `signIn.continueWithLocalModel` | Continue with local model |
| `signIn.switchToAppFlowyCloud` | AppFlowy Cloud |
| `signIn.pleaseInputYourEmail` | Please enter your email address |
| `signIn.invalidEmail` | Please enter a valid email address |
| `signIn.continueWithEmail` | Continue with email |
| `signIn.continueWithPassword` | Continue with password |
| `signIn.checkYourEmail` | Check your email |
| `signIn.temporaryVerificationLinkSent` | A temporary verification link has been sent.\nPlease check your inbox at |
| `signIn.temporaryVerificationCodeSent` | A temporary verification code has been sent.\nPlease check your inbox at |
| `signIn.enterCodeManually` | Enter code manually |
| `signIn.enterCode` | Enter code |
| `signIn.invalidVerificationCode` | Please enter a valid verification code |
| `signIn.continueWithLoginCode` | Continue with login code |
| `signIn.backToLogin` | Back to login |
| `signIn.verifying` | Verifying... |
| `signIn.enterPassword` | Enter password |
| `signIn.loginAs` | Login as |
| `signIn.forgotPassword` | Forgot Password? |
| `web.continue` | Continue |
| `signIn.invalidLoginCredentials` | Your password is incorrect, please try again |
| `signIn.resetPassword` | Reset password |
| `signIn.resetPasswordDescription` | Enter your email to reset your password |
| `button.submit` | Submit |
| `signIn.resetPasswordFailed` | Failed to reset password |
| `signIn.continueToResetPassword` | Continue to reset password |
| `signIn.resetPasswordSuccess` | Password reset successfully |
| `signIn.passwordMustContain` | Password must contain at least one letter, one number, and one symbol. |
| `signIn.enterNewPasswordFor` | Enter new password for␠ |
| `signIn.newPassword` | New password |
| `signIn.enterNewPassword` | Enter new password |
| `signIn.confirmPassword` | Confirm password |
| `signIn.confirmNewPassword` | Enter new password |
| `signIn.newPasswordCannotBeEmpty` | New password cannot be empty |
| `signIn.confirmPasswordCannotBeEmpty` | Confirm password cannot be empty |
| `signIn.passwordsDoNotMatch` | Passwords do not match |
| `signIn.generalError` | Something went wrong. Please try again later |
| `signIn.tooFrequentVerificationCodeRequest` | You have made too many requests. Please try again later. |
| `signIn.tokenHasExpiredOrInvalid` | The code has expired or is invalid. Please try again. |
| `signIn.continueAnonymousUser` | Continue with an anonymous session |
| `defaultUsername` | Me |
| `letsGoButtonText` | Quick Start |
| `youCanAlso` / `and` | You can also / and |
| `githubStarText` | Star on GitHub |
| `subscribeNewsletterText` | Subscribe to Newsletter |
| `settings.files.defineWhereYourDataIsStored` | Define where your data is stored |
| `settings.files.set` | Set |
| `settings.menu.customPathPrompt` | Storing the AppFlowy data folder in a cloud-synced folder such as Google Drive can pose risks. If the database within this folder is accessed or modified from multiple locations at the same time, it may result in synchronization conflicts and potential data corruption |
| `settings.menu.logout` | Log out |
| `settings.workspacePage.language.title` | Language |
| `settings.mobile.support` | Support |
| `workspace.errorActions.exportLogFiles` | Export log files |
| `settings.files.export` | Export |
| `settings.files.clearCache` | Clear cache |
| `button.clear` | Clear |
| `settings.manageDataPage.cache.dialog.successHint` | Cache cleared! |
| `workspace.failedToLoad` | Something went wrong! Failed to load the workspace. Try to close any open instance of AppFlowy and try again. |
| `workspace.errorActions.reportIssue` | Report an issue |
| `workspace.errorActions.reachOut` | Reach out on Discord |
| `workspace.create` / `workspace.hint` | Create workspace / workspace |
| `settings.menu.changeServerTip` (dead) | After changing the server, you must click the restart button for the changes to take effect |

Hard-coded English (no key): `'Sign in to your collaboration server'`, all of §13, `'Error code: N'`, `'Storage & server'`, `'Certificates'`.

---

## 18. Open points / decisions for the Electron implementation
1. Shared-prefs compatibility (§5.3): reuse `%APPDATA%\io.appflowy\AppFlowy\shared_preferences.json` with `flutter.` prefixes, or migrate once? Data dirs (`data`/`data_dev`, `_<host>`) must match exactly to reuse existing user data.
2. Release vs debug data dir: the Flutter dev build uses `data_dev`; an Electron release build would use `data` → different user data unless deliberately pointed at `data_dev`.
3. Reproduce or fix: prefs wipe when data dir missing (§5.2); stuck "Verifying…" on failed OauthSignIn (§11); WorkspaceStartScreen crash (§9.12); Forgot-password wrong hint and `toString()` error text (§9.6); no title bar on Splash/SkipLogIn/WorkspaceError (§9); success-styled error toast for failed deep-link login.
4. Device id: must be SQMClient `MachineId` verbatim (braces, uppercase), not an Electron-generated id.
5. `init_sdk` is called again on every soft restart (`runAppFlowy`); the Electron binding must support re-init in-process (Rust closes the old DB) and re-register the notification sink each time.
