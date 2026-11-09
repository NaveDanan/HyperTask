# Electron port: implementation guide

This app re-implements the AppFlowy Flutter desktop UI (`../appflowy_flutter/lib`) in Electron + React, on top of the unchanged Rust core. Parity specs live in `docs/parity/` (`01-startup-auth.md`, `02-home-shell.md`, `03-settings-theme-assets.md`). **The Flutter source is the source of truth**; the specs are a map into it. When a spec and the Dart code disagree, the Dart code wins.

## Architecture

```
src/main/        Electron main process: window, IPC, core process manager, prefs (shared_preferences.json)
src/preload/     contextBridge → window.appflowy (typed in src/shared/api.ts)
src/shared/      api.ts (IPC contract), protobuf/ (generated), self-hosted-policy.ts
src/renderer/    React app
  backend/       dispatch.ts (request/FlowyResult), notifications.ts (listen), events/ (generated, 229 events)
  i18n/          tr()/useTr() over frontend/resources/translations (easy_localization semantics)
  icons/         FlowySvg + flowy-svgs.ts (same names as Dart FlowySvgs)
  theme/         CSS variables from the Flutter color schemes; appearance-store (AppearanceSettingsCubit)
  ui/            shared primitives (see below)
  startup/       runAppFlowy launcher, cloud env, KV storage, deep links, app-store (routes)
  features/      screens and feature stores
rust-lib/electron-core   the Rust core as a child process (same events as dart-ffi)
```

## Conventions

- **Backend calls**: `import { FolderEventCreateView } from '@/backend/events'`. Every event returns `Promise<FlowyResult<T>>` = `{ ok: true, value } | { ok: false, error: FlowyError }`. Event function names equal the Dart class names (`FolderEventCreateView`). Payloads are protobuf init objects with camelCase fields (`{ parentViewId, name, layout }`).
- **Protobuf**: types/enums from `@shared/protobuf/<crate>/<file>_pb`. Build with `create(XSchema, {...})`, decode bytes with `fromBinary(XSchema, bytes)` (`@bufbuild/protobuf`). Proto `oneof` fields are `{ case, value }` objects named `oneOfX` (e.g. `view.oneOfIcon.case === 'icon'`). `int64` is `bigint`.
- **Notifications**: `listen<FolderNotification>(NotificationSource.Folder, (ty, result) => ..., objectId?)` from `@/backend/notifications`; returns an unsubscribe function. `result.value` is the payload bytes.
- **Stream ports** (Dart `RawReceivePort`): events with a `stream_port` field (search, AI chat answers/questions, completions, file upload progress) take `openReceivePort(onMessage).port` from `@/backend/ports`; the core posts each message (bytes as `Uint8Array`, strings, numbers, arrays) to it. Close the port when done.
- **Typed shared preferences**: values Flutter writes with `prefs.setDouble` must use `window.appflowy.prefs.setDouble` so the file keeps `1920.0` (Dart's `getDouble` rejects ints). Strings go through `KeyValueStorage`.
- **State**: one zustand store per Flutter bloc/cubit, named after it in a comment (`/** ViewBloc (workspace/application/view/view_bloc.dart) */`). Put store files next to their feature. Keep bloc event semantics (guards, ordering, quirks) unless the spec flags a bug that would break the app; note any deliberate deviation in a comment.
- **i18n**: `const { tr } = useTr(); tr('sideBar.addAPage')` — Dart `LocaleKeys.sideBar_addAPage` → `'sideBar.addAPage'`. Args: `tr(key, { args: [...] , namedArgs: {...} })`; plurals: `plural(key, n)`. Hard-coded English in the Dart source stays hard-coded English.
- **Icons**: `<FlowySvg svg="add_s" size={16} color="var(--af-icon-secondary)" />`. Names are the Dart `FlowySvgs.*` names. `blendMode={null}` for multicolor icons. Default color = `var(--icon-color)` (Theme.iconTheme.color).
- **Colors** (CSS variables, set by theme/theme.ts): `--cs-*` = `Theme.of(context).colorScheme.*` (e.g. `--cs-surface-container-highest`, `--cs-secondary`, `--cs-on-surface`), `--th-*` = other ThemeData colors (`--th-divider`, `--th-hint`, `--th-hover`, `--th-card`), `--afx-*` = `AFThemeExtension` (`--afx-text`, `--afx-grey-hover`, `--afx-border`...), `--af-*` = `AppFlowyTheme` tokens (`--af-text-primary`, `--af-icon-secondary`, `--af-fill-content-hover`, `--af-fill-theme-select`, `--af-border-primary`, `--af-surface-primary`, `--af-shadow-small`...), `--icon-color`, `--text-color`. Font sizes scale with `calc(Npx * var(--text-scale, 1))` (FlowyText does this).
- **UI primitives** (`@/ui`): `FlowyText` (+`.regular/.medium/.semibold/.small`), `VSpace/HSpace`, `FlowyDivider`, `AFDivider`, `Spinner`, `FlowyHover`, `FlowyButton`, `FlowyIconButton`, `FlowyTextButton`, `AFButton` (variants filledPrimary/filledDestructive/outlinedNormal/outlinedDestructive/ghostPrimary, sizes s/m/l/xl), `ActionRow` (PopoverActionList rows), `AFTextField`, `Toggle`, `AFAvatar`, `Tooltip` (+`shortcutTooltip(label, shortcut)`), `Popover`/`AppFlowyPopover` (directions, mutex, asBarrier, controllerRef, showAtCursor), `showDialog`, `MaterialDialog`, `FlowyDialog`, `AFModal`, `showSimpleAFDialog`, `showAFTextFieldDialog`, `showConfirmDialog`, `showConfirmDeletionDialog`, `showToast`. `WindowTitleBar` is in `@/ui/WindowTitleBar`. Settings layout widgets are in `features/settings/shared.tsx`. Add a primitive to `src/renderer/ui/` only if it is generic and missing; prefer composing.
- **KV storage** (shared_preferences): `KeyValueStorage.get/getJson/set/remove` with keys from `KVKeys` (`@/startup/kv`). Values are strings.
- **Tabs**: `tabsActions.openView(view)` (plain click), `tabsActions.openViewInNewTab(view)` (Ctrl+click), `tabsActions.openPlugin(trashPlugin())`, `localToolPlugin('jira'|'templates')`; `useTabsStore(s => s.latestOpenView)` is the sidebar selection highlight (MenuSharedState). `registerViewExpander(viewId, {isExpanded, expand})` lets opening a page reveal it in the tree. Plugin model: `features/tabs/plugin.ts`.
- **Home**: `useHomeStore` (user, workspaceSetting, latestView), `useHomeSettingStore` / `homeSettingActions` (sidebar collapse/width, notification panel), `useHomeLayout`, global notifiers in `features/home/notifiers.ts` (`createNewPage`, `switchToNextSpace`, `openSettings`, `renameSelectedView`, `toggleCommandPalette`, `loseFocus`, `useSwitchToSpace`).
- **View helpers**: `features/view/view-ext.ts` (`isSpace`, `spaceIcon`, `spaceIconColor`, `spacePermission`, `nameOrDefault`, `viewExtra`). Extend it rather than re-parsing `extra` elsewhere.
- **Vendor policy**: links to appflowy.com/.io/.cloud are refused by `window.appflowy.shell.openExternal` (it rejects); always `.catch(() => {})`.
- **Code style**: TypeScript strict, function components, inline styles or small CSS files next to the component; comments name the Dart widget/file they mirror. No new npm dependencies without a strong reason.

## Verification

- `npx tsc --noEmit -p tsconfig.web.json` and `npx tsc --noEmit -p tsconfig.node.json` must pass.
- `npx vitest run` must pass. Unit-test non-trivial store logic (reducers, ordering, KV formats) with vitest, mocking `@/backend/events` like `features/tabs/tabs-store.test.ts` does.
- Do **not** launch Electron (`npx electron .`): the binary is currently blocked on this machine, and launching would touch real user data. Integration screenshots are taken separately.
