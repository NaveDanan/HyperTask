# HyperTask desktop

HyperTask is developed by NaveDanan. The desktop application uses Electron and React, backed by the Rust core in `../rust-lib`.

## Architecture

The renderer sends typed protobuf events over Electron IPC to a Rust child process through an authenticated loopback connection. The core sends notifications and native stream messages for search, AI and upload progress. Icons and translations live in `../resources`; fonts, appearance images and icon-picker data live in `resources/assets`. Built-in icon and color tables are maintained in `src/renderer/icons` and `src/renderer/theme`.

## Development

Install Node.js, Rust 1.85 and the native build dependencies for your platform. On Windows, Visual Studio C++ build tools, LLVM/libclang, pkgconf and vcpkg are needed.

```powershell
npm install
npm run build:core     # builds rust-lib/electron-core
npm run gen            # regenerate protobuf bindings and event wrappers after Rust changes
npm run dev            # desktop development mode
npm run build          # production build
npm test
npm run typecheck
```

The core build generates Rust and protobuf types; run it before `npm run gen`. The core binary is expected under `../rust-lib/target/<platform>/debug`.

## Existing data

The application retains the existing Windows support directory and preference keys to read existing workspaces. Avoid running two applications against the same local data directory simultaneously. For isolated development, set `APPFLOWY_SUPPORT_DIR` to a scratch directory; `APPFLOWY_CORE_BINARY` selects a different core executable.

See [STATUS.md](docs/STATUS.md) for implemented features and known gaps.
