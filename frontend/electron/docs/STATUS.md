# HyperTask Electron port status

Milestone 1 (foundation and app shell) is in place. The database data layer and linked-view shell are implemented; Grid, Board, Calendar and Gantt view bodies are the next milestone. The document editor remains a placeholder.

The planned OpenBot integration is tracked in [epic #2](https://github.com/NaveDanan/HyperTask/issues/2). The [baseline audit](HYPER_OPENBOT_AUDIT.md) records the architecture and PR #1 reuse decision; the [progress record](HYPER_OPENBOT_PROGRESS.md) tracks review and delivery. This planning work does not implement chat or change the capabilities listed below.

## Done

**Databases**
- Live `HyperDatabaseController`: typed cells for all 15 core field types, bounded lazy cell loading,
  core notifications, row/field/cell/group/calendar/meta mutations, and a shared linked-view tab bar.
- Grid/Board/Calendar route to `HyperDatabasePage`; Gantt uses compatible Grid +
  `ViewPB.extra.hyper_layout`, including the add-page menus. Four independent view seams are ready.
- Free ReUI Data Grid, Kanban, Event Calendar and Gantt families are vendored with all dependencies.
- Headless Linux core/harness tooling, realistic sample seed and an opt-in real-core smoke test.
  Linux core build, 48-row live mutation smoke, light/dark shell PNGs, typecheck, tests and
  production build are verified.
  API and executor ownership: `src/renderer/features/hyper-database/README.md`.

**Local tools**
- Jira dashboard (Server / Data Center): connection settings, sync with offline cache, stats, filters and search, create/edit with conflict handling, status transitions, database mirror. Settings, cache and DPAPI credential files are shared with the Flutter build.
- Local template store: the 50 bundled templates, offline, imported as documents and databases with their media.

**Interface**
- Redesigned on Tailwind v4, shadcn/ui (base-nova, Base UI primitives) and ReUI: inset content panel, zinc tokens with colour-scheme accents, Geist fonts, lucide icons. The rules and per-screen specs are in [design/HYPERTASK_UI.md](design/HYPERTASK_UI.md).

**Platform**
- Rust core as a child process (`rust-lib/electron-core`): same `init_sdk` configuration, all 229 events, notifications, and stream ports (search results, AI streaming, upload progress) via the native Rust stream bridge.
- Generated TypeScript protobuf bindings and event wrappers, the Flutter icon set, translations (easy_localization semantics), fonts and all four built-in color schemes plus the hypertask_ui tokens.
- Same data and settings locations as the Flutter build; shared_preferences.json read and written compatibly (including Dart doubles), same device id.
- Frameless window with the Windows caption bar, saved size/position/maximized state and zoom, single instance, `hypertask-flutter://` deep links in self-hosted mode, vendor hosts blocked.

**Startup and sign-in**
- `runHypertask` sequence, local mode with the automatic guest account, self-hosted mode with email/password, magic link/passcode, forgot/reset password, anonymous mode, the sign-in Settings dialog (language, Storage & server, export logs, clear cache), skip-login, workspace-error and workspace-failed screens.

**Home shell**
- Layout with sidebar resize/collapse, notification panel, help bubble, home shortcuts (Ctrl+\\, Ctrl+Shift+L, Ctrl+W, Ctrl+PageUp/Down, F2, zoom, Ctrl+O, Ctrl+N, Ctrl+,, Ctrl+P).
- Sidebar: workspace switcher and actions, Search, New page, Jira and Templates entries, Favorites, spaces and the Personal section, the page tree with `+` and `···` menus, rename, move to, drag and drop, Trash, import of Markdown/text and CSV.
- Tabs (pin, close, close others), page header with breadcrumbs, favorite, share/publish/export menu, more menu, lock, the Trash page, the side view, and the command palette with live search.
- Settings dialog: Account, Workspace and appearance, Members, Manage data, Notifications, Storage & server, Certificates, Shortcuts, AI settings (endpoint file and DPAPI key compatible with the Flutter build), Sites, Feature flags.

## Placeholders and simplified parts

- Document editor and row pages: placeholder bodies. Database view bodies (Grid/Board/Calendar/Gantt) are small dispatcher placeholders on the live foundation. Pages imported from templates or mirrored from Jira are created correctly but open with these placeholders.
- Document export to HTML/Markdown/clipboard needs the editor's converters ("Unimplemented" for now); CSV export works.
- Icon and emoji pickers have no upload tab, skin tones or recent icons. The colour picker uses the native colour input.
- Notification items show plain text instead of the mini editor.
- Members-only share tab ("shared section" flag) and the space-migration banner are not ported.

## Deliberate differences from the Flutter app

These fix behaviour the parity specs flagged as broken:
- A failed sign-in through the deep-link path reports an error instead of leaving "Verifying…" spinning.
- The forgot-password field asks for an email (Flutter shows the password hint) and shows a readable error.
- A missing custom data folder only resets that path, instead of wiping all shared preferences.
- Requests sent before the core is initialized are answered with an error instead of never completing.
- Every sign-in sub-page keeps the window caption bar, so the frameless window can still be moved and closed.
- "Show notifications icon" is saved when toggled.

## Known issues

- Microsoft Defender quarantined the official Electron 45.2.3 executable on this machine. Development now uses the official Electron 44.10.2 runtime, verified against the checksum in its npm package; the native desktop app launched successfully and loaded the existing workspace. Defender settings were not changed.
- No installer yet (electron-builder is not set up); the core binary must be built with `npm run build:core`.
