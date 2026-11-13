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

The pinned `collab-plugins` crate is kept in `../rust-lib/vendor/collab-plugins` so backups can archive a closed database copied from one RocksDB snapshot. Its [upstream record](../rust-lib/vendor/collab-plugins/UPSTREAM.md) identifies the source revision, license, local changes and focused tests. Keep both Cargo source patches aligned when updating this dependency.

Native UI tests need Electron and a display. PDF integration tests also need Poppler's `pdfinfo`, `pdftotext` and `pdffonts`; they skip when the required tools are unavailable. PDF export in the application uses Electron and needs no separate PDF tools.

Equation rendering uses pinned KaTeX and STIX Two Math assets without an npm dependency. Keep the parser's [MIT license and provenance](src/renderer/features/document-equation/vendor/katex-0.19.1/provenance.json) and the font's [OFL license](src/shared/math/STIX-OFL.txt) with the assets. The shared font metadata records its upstream revision and SHA-256. Portable HTML embeds the font once; PDF verifies the bundled bytes and loads a binary FontFace while retaining `font-src 'none'`. Unsupported MathML and equations larger than a PDF page must report an error with their source intact.

## Desktop identity and embedded video

HyperTask uses `io.github.navedanan.hypertask` as its desktop identity. This leaves the existing application name, support directories, credentials, preferences and `appflowy-flutter://` protocol compatible. YouTube videos load only after an explicit action. Their requests identify this application without including local paths or workspace data.

For Linux packaging, run `npm run stage:identity -- linux /absolute/staging-root` to stage the desktop manifest under `share/applications`. This writes the manifest only; the packager must supply the application executable and install the completed package. It does not register an application or create an installer.

For macOS packaging, run `npm run stage:identity -- darwin /absolute/HyperTask.app` on macOS before code signing. This sets the main bundle and related helper bundle identifiers. A stock development `Electron.app` cannot claim HyperTask's identity, so its embedded player remains unavailable until the bundle has the correct identifier. Windows sets the application user model ID at startup.

Linux application registration, real YouTube playback and encrypted-storage compatibility have been checked in disposable profiles. Native Windows/macOS packaging, playback and keychain behavior still need platform verification.

## Tray and startup

Closing the desktop window hides it in the system tray and keeps the app running. Click the tray icon or choose **Open HyperTask** to return. Choose **Quit HyperTask** from the tray menu to stop the app and its core process.

Packaged builds enable startup on first launch. Use **Settings → Account & App → Desktop → Start HyperTask when I sign in** to toggle it. Startup launches with the window hidden. Development builds do not register startup entries.

Windows and macOS use [Electron login items](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings). Linux uses `$XDG_CONFIG_HOME/autostart/hypertask.desktop`, falling back to `~/.config/autostart/hypertask.desktop`. AppImage entries point to the original AppImage file. Disabling startup removes HyperTask's entry; quitting from the tray leaves the startup preference unchanged.

## Existing data

The application retains the existing Windows support directory and preference keys to read existing workspaces. Avoid running two applications against the same local data directory simultaneously. For isolated development, set `APPFLOWY_SUPPORT_DIR` to a scratch directory; `APPFLOWY_CORE_BINARY` selects a different core executable.

See [STATUS.md](docs/STATUS.md) for implemented features and known gaps.
