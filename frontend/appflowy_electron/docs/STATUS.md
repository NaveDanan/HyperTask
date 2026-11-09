# HyperTask Electron port status

Milestone 1 (foundation and app shell) is in place. The document editor, databases, AI chat and the Jira/Templates tools are later milestones; their pages open with a placeholder body, while their tabs, headers and menus are real.

## Done

**Platform**
- Rust core as a child process (`rust-lib/electron-core`): same `init_sdk` configuration, all 229 events, notifications, and stream ports (search results, AI streaming, upload progress) via the native Rust stream bridge.
- Generated TypeScript protobuf bindings and event wrappers, the Flutter icon set, translations (easy_localization semantics), fonts and all four built-in color schemes plus the appflowy_ui tokens.
- Same data and settings locations as the Flutter build; shared_preferences.json read and written compatibly (including Dart doubles), same device id.
- Frameless window with the Windows caption bar, saved size/position/maximized state and zoom, single instance, `appflowy-flutter://` deep links in self-hosted mode, vendor hosts blocked.

**Startup and sign-in**
- `runAppFlowy` sequence, local mode with the automatic guest account, self-hosted mode with email/password, magic link/passcode, forgot/reset password, anonymous mode, the sign-in Settings dialog (language, Storage & server, export logs, clear cache), skip-login, workspace-error and workspace-failed screens.

**Home shell**
- Layout with sidebar resize/collapse, notification panel, help bubble, home shortcuts (Ctrl+\\, Ctrl+Shift+L, Ctrl+W, Ctrl+PageUp/Down, F2, zoom, Ctrl+O, Ctrl+N, Ctrl+,, Ctrl+P).
- Sidebar: workspace switcher and actions, Search, New page, Jira and Templates entries, Favorites, spaces and the Personal section, the page tree with `+` and `···` menus, rename, move to, drag and drop, Trash, import of Markdown/text and CSV.
- Tabs (pin, close, close others), page header with breadcrumbs, favorite, share/publish/export menu, more menu, lock, the Trash page, the side view, and the command palette with live search.
- Settings dialog: Account, Workspace and appearance, Members, Manage data, Notifications, Storage & server, Certificates, Shortcuts, AI settings (endpoint file and DPAPI key compatible with the Flutter build), Sites, Feature flags.

## Placeholders and simplified parts

- Document editor, grid/board/calendar, row pages, AI chat, Jira dashboard and the local template store: placeholder bodies.
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
