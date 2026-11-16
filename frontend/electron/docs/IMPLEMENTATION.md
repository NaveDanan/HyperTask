# HyperTask implementation guide

The desktop application has an Electron/React renderer and a Rust core child process. The historical [parity notes](parity/) document earlier observed behavior and can guide future implementation; references there to the removed client are historical.

## Architecture

- `src/main` manages the window, IPC, preferences and core process.
- `src/preload` exposes the typed API in `src/shared/api.ts`.
- `src/renderer` contains the UI, stores, themes and generated event wrappers.
- `../rust-lib/electron-core` serves requests and forwards notifications and native stream messages over an authenticated loopback connection.

Backend events use protobuf bindings under `src/shared/protobuf`. Stream ports carry text or bytes for search, AI and upload progress. The icon manifest and built-in color schemes are maintained directly in the renderer; source assets are under `resources/assets` and `../resources`.

Follow the project convention to prefix new product modules and widgets with `Hyper`.
