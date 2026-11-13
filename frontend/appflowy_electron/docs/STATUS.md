# HyperTask Electron port status

The foundation and app shell are in place. Core-backed document, database, AI chat and organization implementations are under active development. They cover part of the upstream feature set; see [FEATURE_PARITY.md](FEATURE_PARITY.md) for verified behavior and remaining work.

The planned OpenBot integration is tracked in [epic #2](https://github.com/NaveDanan/HyperTask/issues/2). The [baseline audit](HYPER_OPENBOT_AUDIT.md) records the architecture and PR #1 reuse decision; the [progress record](HYPER_OPENBOT_PROGRESS.md) tracks review and delivery. This planning work does not implement chat or change the capabilities listed below.

## Done

**Local tools**
- Jira dashboard (Server / Data Center): connection settings, sync with offline cache, stats, filters and search, create/edit with conflict handling, status transitions, database mirror. Settings, cache and DPAPI credential files are shared with the Flutter build.
- Local template store: the 50 bundled templates, offline, imported as documents and databases with their media.

**Interface**
- Redesigned on Tailwind v4, shadcn/ui (base-nova, Base UI primitives) and ReUI: inset content panel, zinc tokens with colour-scheme accents, Geist fonts, lucide icons. The rules and per-screen specs are in [design/HYPERTASK_UI.md](design/HYPERTASK_UI.md).

**Platform**
- Rust core as a child process (`rust-lib/electron-core`): same `init_sdk` configuration, all 230 events, notifications, and stream ports (search results, AI streaming, upload progress) via the native Rust stream bridge.
- Generated TypeScript protobuf bindings and event wrappers, the Flutter icon set, translations (easy_localization semantics), fonts and all four built-in color schemes plus the appflowy_ui tokens.
- Same data and settings locations as the Flutter build; shared_preferences.json read and written compatibly (including Dart doubles), same device id.
- Frameless window with the Windows caption bar, saved size/position/maximized state and zoom, single instance, `appflowy-flutter://` deep links in self-hosted mode, vendor hosts blocked.
- System tray with Open and Quit actions; closing the window keeps the app and core running. Packaged builds start in the background at login by default, with a toggle under Settings → Account & App → Desktop.

**Startup and sign-in**
- `runHyperTask` sequence, local mode with the automatic guest account, self-hosted mode with email/password, magic link/passcode, forgot/reset password, anonymous mode, the sign-in Settings dialog (language, Storage & server, export logs, clear cache), skip-login, workspace-error and workspace-failed screens.

**Home shell**
- Layout with sidebar resize/collapse, notification panel, help bubble, home shortcuts (Ctrl+\\, Ctrl+Shift+L, Ctrl+W, Ctrl+PageUp/Down, F2, zoom, Ctrl+O, Ctrl+N, Ctrl+,, Ctrl+P).
- Sidebar: workspace switcher and actions, Search, New page, Jira and Templates entries, Favorites, spaces and the Personal section, the page tree with `+` and `···` menus, rename, move to, drag and drop, Trash, import of Markdown/text and CSV.
- Tabs (pin, close, close others), page header with breadcrumbs, favorite, share/publish/export menu, more menu, lock, the Trash page, the side view, and the command palette with live search.
- Settings dialog: Account, Workspace and appearance, Members, Manage data, Notifications, Storage & server, Certificates, Shortcuts, AI settings, Sites, Feature flags. AI settings keep the existing endpoint file and Windows DPAPI format, and add native secure storage on Linux/macOS, automatic endpoint model discovery and a saved default model. See [AI_ENDPOINTS.md](AI_ENDPOINTS.md).

## Placeholders and simplified parts

- Documents support common text blocks, formatting, slash insertion, keyboard editing, simple tables, block and inline equations, footnotes/citations, an outline, page links/backlinks, images, attachments, link cards with saved thumbnails, explicit-load YouTube video and inline databases. Page appearance controls support icons, covers, bundled presets and managed/public images. Protected raster media uses authenticated native previews and portable export. An isolated actual five-service probe passed exact-byte upload/completed download; container/proxy and broader transfer recovery remain. Canvas mode shares the same document. Database views, row content, organization and AI chat have core-backed implementations with local integration tests. The current desktop checkpoint passes 1,627 tests in 265 files; see [feature parity](FEATURE_PARITY.md). Advanced blocks and complete feature parity remain open.
- Canvas AI generates mind maps and presentations in a temporary preview before adding editable elements. Generated assistant images use validated managed storage and can be saved explicitly. Canvas images support descriptions, movement, resizing and embedded exports. See [HYPER_AI_PROGRESS.md](HYPER_AI_PROGRESS.md) for source selection and verification limits.
- Unsaved database cell and form drafts are shared across open panes in the same account/workspace and retained through view refreshes while the app stays open. Copy/Discard recovery remains available for hidden or changed properties. Explicit retries check current permissions, field configuration and saved bytes; simultaneous external writes still need an atomic core operation.
- Calendar day, week and month periods use the native saved settings, with timezone-aware browsing and bounded date ranges. Week/month views include a saved Sunday/Monday week-start picker. Native Page/preload/core/restart checks verify keyboard focus, linked-view isolation and preserved date data. Scoped row subscriptions preserve overlapping and empty panes and pass actual-server checks beyond the 50-row idle cache; row finalization now waits safely for concurrent readers and rejects cancelled work.
- Code blocks support language selection, exact-source copying, indentation and local worker syntax highlighting with ten bundled grammars. Highlighting preserves saved text, authored formatting, selections and IME input. Focused native checks, typechecking, an isolated build and the complete desktop checkpoint pass.
- Inline equations support insertion, editing, Unwrap and exact source Copy using the upstream formula attributes. Native/core tests cover Undo/Redo, restart, merged atoms, locks and row binding. HTML/PDF renders trusted math with the bundled font; Markdown preserves exact source and attributes for reimport. Oversized or malformed content retains a read-only source fallback. These checks pass in the complete desktop checkpoint, along with typechecking and an isolated production build.
- Property filters support text/URL/AI text, exact decimal numbers, integer-minute Time values, checkbox/checklist, single/multi-select, media/relation emptiness and created/edited timestamps. Time filters pass native exact-integer, empty/zero, prefill, lock and restart checks plus Electron UI validation. Lists are bounded; unchanged and future criteria retain their raw bytes. Time-cell editing/property creation and the complete sort/group/calculation matrix remain.
- Filter groups support adding a criterion while keeping its source, separate All/Any changes and nested-group removal. The native parent lookup now deletes the exact child. Model/service, Electron interaction and real Page/core/restart checks pass, including row membership, native locks, stale owners and uncertain-save recovery. Future or oversized trees remain read-only. Direct grouped date creation and move/ungroup controls remain.
- Date cells support ranges, seconds, IANA zones and explicit choices for repeated times at DST transitions. Date filters expose all 16 operators with explicit timezone opt-in and preserved legacy settings; calendar ranges span visible days with bounded card counts. Document date mentions and in-app reminders coordinate Undo/Redo with native timers and explicit recovery. Copied pages, datasets and rows get independent body/date-cell reminder IDs and exact schedules. Native copy/restart tests pass; OS alerts remain. Column insertion and adjacent widths preserve the upstream format. PDF export prints supported blocks and stored images; unsupported or unavailable content stops the export.
- HTML/Markdown/clipboard export uses document data after pending saves finish. Managed attachments are packaged with file exports or inlined for clipboard; drawings are included as SVG. Keep companion files beside the exported page. Unsupported block types report an error rather than producing incomplete exports. CSV export remains available.
- Formatted whitespace/newlines and adjacent code runs round-trip through Markdown with exact text and attributes. Ordinary valid output stays unchanged; bounded source spans handle the edge cases. Converter, inert HTML and native import/restart checks pass. The week-start, Time-filter and Markdown follow-up passes focused regressions, all three TypeScript checks and a fresh isolated production build; it is also included in the final full-suite checkpoint.
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
