# HyperTask for Electron

HyperTask is developed by NaveDanan. Its Electron + React desktop shell reuses the existing AppFlowy Rust core (`../rust-lib`). It is a port of the Flutter desktop app in `../appflowy_flutter`, aiming for the same functionality and UI/UX.

## How it fits together

```
Electron renderer (React)  ──IPC──▶  Electron main  ──loopback TCP──▶  appflowy_core (Rust)
   UI, stores, i18n, theme            window, prefs,                    rust-lib/electron-core:
   backend/events (229 events)        core process,                     AppFlowyCore + the same
   protobuf (generated)               dialogs, shell                    event dispatcher dart-ffi uses
```

- The Rust core runs as a child process (`rust-lib/electron-core`) instead of the `dart-ffi` library. It accepts the same `init_sdk` JSON, dispatches the same event names and protobuf payloads, and streams the same `SubscribeObject` notifications. The connection is authenticated with a one-time token and only listens on 127.0.0.1.
- TypeScript protobuf bindings are generated from `rust-lib/*/resources/proto`. Event wrappers are generated from `rust-lib/*/src/event_map.rs` and named like the Dart ones (`FolderEventCreateView`).
- Translations (`../resources/translations`), icons (`../resources/flowy_icons`, same `FlowySvgs` names), fonts and color schemes are taken from the Flutter project.

## Data compatibility

The app uses the same locations as the Flutter build:

- Settings: `%APPDATA%\io.appflowy\AppFlowy\shared_preferences.json` (same `flutter.`-prefixed keys: server choice, window size, expanded pages, Jira config…).
- Data: `%APPDATA%\io.appflowy\AppFlowy\data_dev` in development and `data` when packaged (or the custom data path), plus `data_dev_<host>` for a collaboration server.
- Device id: `HKLM\SOFTWARE\Microsoft\SQMClient\MachineId`, as the Flutter app reads it.

Do not run the Flutter app and this app at the same time against the same data folder.

## Development

Prerequisites: Node.js, the Rust toolchain used for the Flutter backend (1.85, offline crate cache), and the Windows build tools listed in `../../doc/windows-development.md`.

```powershell
npm install            # this npm blocks install scripts; electron's is allowed in package.json
npm run build:core     # builds rust-lib/electron-core (same target/features as dart-ffi)
npm run gen            # regenerate protobuf, events, icons, color schemes after Rust/Flutter changes
npm run dev            # electron-vite dev server with HMR
npm run build && npm start
npm test               # unit tests + a real-core integration test
npm run typecheck
```

Environment variables (development only):

| Variable | Effect |
|---|---|
| `APPFLOWY_SUPPORT_DIR` | Use another support directory (settings + data), e.g. a scratch folder for testing |
| `APPFLOWY_CORE_BINARY` | Path to a different `appflowy_core` executable |
| `APPFLOWY_CAPTURE` / `APPFLOWY_CAPTURE_DELAY` | Save a PNG of the window after N ms and quit |

## Status

See `docs/STATUS.md` for what is ported, what is a placeholder, and the deliberate differences from the Flutter app. Parity specs are in `docs/parity/`, conventions in `docs/IMPLEMENTATION.md`.
