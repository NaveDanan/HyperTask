# 02 — Desktop Home Shell (parity spec)

Source of truth: `D:\Projects\appflowy\frontend\appflowy_flutter\lib` (Flutter, customized checkout). All paths below are relative to `appflowy_flutter/lib` unless prefixed (`packages/...` = `appflowy_flutter/packages/...`, `rust-lib/...` = `frontend/rust-lib/...`). Mobile (`lib/mobile/**`) is out of scope.

Conventions used in this document:

- `FolderEventXxx(payload)` = Dart dispatch class in `packages/appflowy_backend/lib/dispatch/dart_event/flowy-folder/dart_event.dart`; same for `UserEventXxx` (flowy-user), `SearchEventXxx` (flowy-search), `AIEventXxx` (flowy-ai). Electron calls the same Rust event with the same protobuf payload.
- Protobuf field names are given in snake_case (as in `rust-lib/**/entities/*.rs` / `.proto`); Dart uses camelCase (`parentViewId`).
- Colors: `cs.x` = `Theme.of(context).colorScheme.x` (Material, mapped from `FlowyColorScheme`, see §5.1); `AFThemeExtension.of(context).x` (see §5.2); `AppFlowyTheme.of(context).x` / `theme.x` = new design-system tokens from `packages/appflowy_ui` (see §5.3). Hex values resolved for the default theme ("Default"/`DefaultColorScheme`) light | dark.
- `LocaleKeys.a_b_c` = i18n key `a.b.c` in `resources/translations/en-US.json` (repo root `frontend/resources/translations`). Electron should reuse the JSON files as-is.
- `FlowySvgs.name_s|m|lg|xl` = `appflowy_flutter/assets/flowy_icons/<dir>/name.svg`, exact path in `generated/flowy_svgs.g.dart` (`_s` → `16x/`, `_m` → `20x/` or `24x/` (both exist — look it up), `_lg` → `32x/`, `_xl` → `40x/`). Rendered size is the widget's `size`, else the SVG's intrinsic size (= folder size); tinted with `color` (srcIn) — default color `Theme.iconTheme.color` (light `#333333`, dark `#BBC3CD`) — unless `blendMode: null` (multicolor). `FlowySvg` is additionally scaled by the text scale factor (`textScaleFactor` setting). Electron should import the same SVG files (inline + `currentColor`).
- Hex colors are `#RRGGBB`, or CSS order `#RRGGBBAA` when translucent (Dart `Color(0xAARRGGBB)` literals were converted; values quoted as `Color(0x...)` or `"0xFF..."` are raw Dart/data values).
- `QUIRK` / `BUG-COMPAT` mark current Flutter behaviour that looks unintended but is what users see today; replicate unless a deviation is decided and documented.
- `AMBIGUOUS:` marks behaviour that is unclear, dead, or contradictory in the Flutter source.
- Effective feature flags in this checkout (`shared/feature_flags.dart`, modified): `planBilling` = **OFF** (hard-coded `return false`), `spaceDesign`, `search`, `collaborativeWorkspace`, `membersSettings`, `syncDatabase`, `syncDocument`, `inlineSubPageMention` = **ON** (forced), `sharedSection` = value from KV `featureFlag` JSON, default **OFF**.
- Vendor URLs are blocked in this checkout: `core/helpers/url_launcher.dart` (modified) → `afLaunchUri` returns `false` and calls `onFailure` when `SelfHostedPolicy.isVendorHost(host)` (`env/self_hosted_policy.dart`: host == or endsWith `.appflowy.com|.appflowy.io|.appflowy.cloud`). Every "open appflowy.com/..." link in the shell is therefore a no-op/failure toast. The global `HttpOverrides` also refuses connections to those hosts.
- Auto-update task is removed from startup (`startup/startup.dart` modified: `AutoUpdateTask()` commented out) → no vendor updater; the sidebar "update available" banner can never appear (see §2A.14).

## Contents

- §1 Overall layout — entry/providers (1.1), z-ordered stack (1.2), `HomeLayout` math + `HomeSettingBloc` (1.3), resizer (1.4), collapse/expand (1.5), notification panel (1.6), question bubble (1.7), window frame / Windows title bar (1.8)
- §2 Sidebar — 2A skeleton/header/workspace/footer/local tools, 2B sections & spaces, 2C tree item/actions/DnD/protobufs/notifications/trash
- §3 Tabs and page area — right pane, `TabsBloc`, tab bar, view header (breadcrumbs, favorite, share, more menu), plugin registry
- §4 Data loading, blocs, notifications, keyboard shortcuts, persisted state
- §5 Visual system — Material/AF/AppFlowyTheme tokens resolved to hex, widget primitive defaults

---

## 1. Overall layout

### 1.1 Entry, routing, top-level providers

- Route: `DesktopHomeScreen.routeName = '/DesktopHomeScreen'` (`workspace/presentation/home/desktop_home_screen.dart`). Reached after splash/sign-in (`user/application/auth/auth_router.dart` → `goHomeScreen`).
- `DesktopHomeScreen.build` = `FutureBuilder(Future.wait([FolderEventGetCurrentWorkspaceSetting().send(), getIt<AuthService>().getUser()]))`.
  - `FolderEventGetCurrentWorkspaceSetting` → output `WorkspaceLatestPB { workspace_id: String, latest_view: ViewPB (optional) }`.
  - `AuthService.getUser()` → `UserEventGetUserProfile` → `UserProfilePB`.
  - While pending: `Center(CircularProgressIndicator.adaptive())` (no other chrome).
  - If either fails/null: `WorkspaceFailedScreen` (`home/errors/workspace_failed_screen.dart`): text `LocaleKeys.workspace_failedToLoad`, buttons `LocaleKeys.workspace_errorActions_reportIssue` (opens GitHub issue URL) and `LocaleKeys.workspace_errorActions_reachOut` (opens Discord URL).
- Provider tree (outer → inner), keyed by `ValueKey(userProfile.id)` (a user change rebuilds everything):
  1. `AFFocusManager` (InheritedWidget, `home/af_focus_manager.dart`): exposes `loseFocusNotifier` (ChangeNotifier) + `notifyLoseFocus()`; used to blur the editor when clicking shell chrome. Electron: a global "blurEditor" event bus.
  2. `MultiBlocProvider`:
     - `ReminderBloc` = `getIt<ReminderBloc>()` singleton (started by NotificationButton/UserWorkspaceBloc, see §2A).
     - `TabsBloc` = `getIt<TabsBloc>()` lazy singleton (see §3).
     - `HomeBloc(workspaceLatest)..add(HomeEvent.initial())` (§4.2).
     - `HomeSettingBloc(workspaceLatest, AppearanceSettingsCubit, screenWidthPx)..add(initial)` (§1.3).
     - `FavoriteBloc()..add(FavoriteEvent.initial())` (§2B).
  3. `Scaffold` (FAB only when `enableMemoryLeakDetect`, ignore).
  4. `BlocListener<HomeBloc>` on `latestView` change → if `TabsBloc.state.currentPageManager.plugin.pluginType == PluginType.blank` then `TabsEvent.openPlugin(plugin: view.plugin())`; always `_switchToSpace(view)` = `FolderEventGetViewAncestors(ViewIdPB{value: view.id})` → first ancestor with `isSpace` → `switchToSpaceNotifier.value = space` (global `ValueNotifier<ViewPB?>` in `home/hotkeys.dart`) if id differs.
  5. `BlocBuilder<HomeSettingBloc>` (rebuild on any state change) → `BlocProvider(UserWorkspaceBloc(userProfile, RustWorkspaceRepositoryImpl(userId))..add(UserWorkspaceEvent.initialize()))` (class lives in `features/workspace/logic/workspace_bloc.dart`; `workspace/application/user/user_workspace_bloc.dart` just re-exports it). AMBIGUOUS: because this `BlocProvider.create` sits inside a `BlocBuilder`, Flutter keeps the same bloc instance across rebuilds (provider is not re-created unless the element is replaced) — Electron: create once per user session.
  6. `BlocListener<UserWorkspaceBloc>` on `currentWorkspace` change → `CommandPalette.maybeOf(context)?.updateBlocs(workspaceBloc, spaceBloc)`.
  7. `HomeHotKeys(userProfile)` (§4.4) → `FlowyContainer(cs.surface)` → `_buildBody`.
- `CommandPalette` (search, Ctrl+P) is mounted **above** the home in `startup/tasks/app_widget.dart` (only when `FeatureFlag.search.isOn` and not mobile) — see §2A for the sidebar entry and §4.4 for the shortcut.

### 1.2 Body: z-ordered Stack (`DesktopHomeScreen._layoutWidgets`)

Children in paint order (first = bottom). `layout` = `HomeLayout(context)` (`home/home_layout.dart`), recomputed on every HomeSettingBloc rebuild.

| # | Widget | Position | Animation |
|---|---|---|---|
| 1 | `HomeStack` (tabs + page area, §3) wrapped in `.constrained(minWidth: 500)` | `left: layout.homePageLOffset`, `right: layout.homePageROffset`, `top: 0`, `bottom: 0` | `AnimatedPositioned`, `layout.animDuration`, `Curves.easeOutQuad` |
| 2 | `QuestionBubble` (help "?" button, §1.7) | `right: 20`, `bottom: 16` | `animDuration`, `Curves.easeOut` |
| 3 | `EditPanel` (dead, see below) | `top:0,right:0,bottom:0,width: 400`; slides in X from `closeX=400` | `animatedPanelX`, easeOutQuad |
| 4 | `NotificationPanel` (§1.6) | `left: showMenu ? menuWidth : 0`, `top: showMenu ? 0 : 52`, `bottom: 0`, `width: layout.notificationPanelWidth` | `animatedPanelX(closeX: -notificationPanelWidth, isClosed: !showNotificationPanel)`, easeOutQuad |
| 5 | `HomeSideBar` (§2) inside `FocusTraversalGroup(RepaintBoundary(...))` | `left:0, top:0, bottom:0, width: layout.menuWidth` | `animatedPanelX(closeX: -menuWidth, isClosed: !showMenu)` = translateX(-menuWidth) when hidden; **stays mounted** |
| 6 | `SidebarResizer` (only if `layout.showMenu`, else `SizedBox.shrink`) | `left: layout.menuWidth` (top/bottom unbounded → full height) | `animDuration`, easeOutQuad |

- `SliderMenuHoverTrigger` (`menu/sidebar/slider_menu_hover_trigger.dart`, 50px black container) is constructed but **never placed** in the Stack → not rendered. `MenuStatus.floating` is never emitted anywhere. AMBIGUOUS/dead: do not implement a hover-reveal sidebar.
- `EditPanel` / `HomeSettingEvent.setEditPanel` is never dispatched anywhere in desktop code → always closed (`panelContext == null`); `homePageROffset` is always 0. Dead; Electron may omit.
- `_buildEditPanel`/`sidebar`/`homeStack` are rebuilt when `HomeSettingBloc` emits (resizing re-lays out the whole home).

### 1.3 `HomeLayout` math and `HomeSettingBloc`

`HomeSizes` (`home/home_sizes.dart`): `menuAddButtonHeight 60`, `topBarHeight 44`, `editPanelTopBarHeight 60`, `editPanelWidth 400`, `notificationPanelWidth 380`, `tabBarHeight 40`, `tabBarWidth 200`, `workspaceSectionHeight 32`, `searchSectionHeight 30`, `newPageSectionHeight 30`, `minimumSidebarWidth 268`. `HomeInsets.topBarTitleHorizontalPadding 12`, `topBarTitleVerticalPadding 12`. `HomeSpaceViewSizes.leftPadding 16`, `viewHeight 30`. `PageBreaks` (`packages/flowy_infra/lib/size.dart`): `largePhone 550`, `tabletPortrait 768`, `tabletLandscape 1024`, `desktop 1440`.

`HomeLayout(context)`:

```
menuWidth            = max(268 + state.resizeOffset, 268)          // resizeOffset ∈ [0, 200] → width 268..468
showMenu             = state.menuStatus == MenuStatus.expanded
menuIsDrawer         = showMenu && windowWidth <= 768              // late field; unset when !showMenu
homePageLOffset      = (showMenu && !menuIsDrawer) ? menuWidth : 0 // ≤768px: sidebar overlays the page
menuSpacing          = (!showMenu && macOS) ? 80 : 0               // room for traffic lights; 0 on Windows
animDuration         = state.resizeType == drag ? 30ms : 350ms
showNotificationPanel= !state.isNotificationPanelCollapsed
notificationPanelWidth = windowWidth - (showEditPanel ? 400 : 0)   // full-width transparent overlay
homePageROffset      = showEditPanel ? 400 : 0                     // always 0 in practice
```

Also: every `HomeLayout` construction dispatches `HomeSettingEvent.checkScreenSize(windowWidth)`.

`HomeSettingBloc` (`workspace/application/home/home_setting_bloc.dart`):

| State field | Init | Notes |
|---|---|---|
| `panelContext: EditPanelContext?` | null | dead |
| `workspaceSetting: WorkspaceLatestPB` | ctor arg | updated by `didReceiveWorkspaceSetting` (never dispatched to this bloc; its `FolderListener` is constructed but never `start()`ed) |
| `unauthorized` | false | unused |
| `menuStatus: MenuStatus {hidden, expanded, floating}` | `appearance.isMenuCollapsed ? hidden : expanded` | persisted |
| `isNotificationPanelCollapsed` | true | not persisted |
| `isScreenSmall` | `screenWidth < 1024` | |
| `hasColappsedMenuManually` | false | **never set to true** anywhere |
| `resizeOffset: double` | `appearance.menuOffset` | persisted |
| `resizeStart: double` | 0 | |
| `resizeType: MenuResizeType {slide(350ms), drag(30ms)}` | slide | |

| Event | Behaviour |
|---|---|
| `changeMenuStatus(status)` | no-op if same; if `status != floating` → `AppearanceSettingsCubit.saveIsMenuCollapsed(status != expanded)`; emit. |
| `collapseNotificationPanel()` | toggles `isNotificationPanelCollapsed` (it is a toggle despite the name). |
| `checkScreenSize(w)` | `small = w < 1024`; if unchanged → no-op; since `hasColappsedMenuManually` is always false: small && expanded → `hidden`; !small && hidden → `expanded` (NOT persisted, does not call save). So crossing 1024px auto-hides/auto-shows the sidebar, overriding the user's saved state at that moment. |
| `editPanelResizeStart()` | `resizeType = drag`, `resizeStart = resizeOffset` |
| `editPanelResized(dx)` | `resizeOffset = clamp(resizeStart + dx, 0, 200)` |
| `editPanelResizeEnd()` | `saveMenuOffset(resizeOffset)`; `resizeType = slide` |
| `setEditPanel`/`dismissEditPanel`/`didReceiveWorkspaceSetting`/`initial` | trivial setters / no-op |

Helpers: `collapseMenu()` toggles expanded↔hidden (floating untouched).

Persistence (both via `AppearanceSettingsCubit._saveAppearanceSettings()` → `UserEventSetAppearanceSetting(AppearanceSettingsPB)`; read at startup via `UserEventGetAppearanceSetting`):
- `AppearanceSettingsPB.is_menu_collapsed: bool` (Rust default `false`, `rust-lib/flowy-user/src/entities/user_setting.rs` `APPEARANCE_DEFAULT_IS_MENU_COLLAPSED`).
- `AppearanceSettingsPB.menu_offset: f64` (default `0.0`).
- Electron: always send the full `AppearanceSettingsPB` (read-modify-write) — the Flutter cubit holds the whole PB and re-sends it.

### 1.4 Sidebar resizer (`workspace/presentation/widgets/sidebar_resizer.dart`)

- Hit area: `Container(width: 2, margin: right 2)` → 4px wide strip starting at x = `menuWidth`, full window height (`MediaQuery.size.height`).
- Cursor `SystemMouseCursors.resizeLeftRight` (CSS `col-resize`/`ew-resize`).
- Color: transparent; `Color(0xFF00B5FF)` while hovered or dragging (2px line).
- Drag: start → `editPanelResizeStart`; update → `editPanelResized(details.localPosition.dx)`; end/cancel → `editPanelResizeEnd`. AMBIGUOUS: Flutter passes the pointer x **relative to the resizer's current left edge** (which itself moves) as the offset; net effect ≈ the divider follows the cursor. Electron: `offset = clamp(startOffset + (clientX - startClientX), 0, 200)`, `width = 268 + offset`, persist on mouseup.
- Only rendered while sidebar is expanded.

### 1.5 Sidebar collapse / expand

- Collapse triggers: (a) hover-only `double_back_arrow_m` button in the sidebar top bar (`SidebarTopMenu`, opacity 0 unless pointer is over the sidebar, §2A); (b) hotkeys Ctrl+`\` and Ctrl+`.` (§4.4: if notification panel open, these close the panel instead); (c) automatic when window width crosses below 1024px.
- Expand triggers when hidden:
  - **Windows**: a 24px-wide button in the custom `WindowTitleBar` (§1.8) left area: `FlowyHover` → `Container(width: 24, padding: all 4)` → `RotatedBox(quarterTurns: 2, FlowySvg(FlowySvgs.hide_menu_s))`; on pointer-down toggles `changeMenuStatus(expanded/hidden)`. Tooltip rich text: line 1 `LocaleKeys.sideBar_openSidebar` (tooltip style), line 2 `"Ctrl+\\"` in `Theme.hintColor`.
  - **macOS/Linux** (non-Windows): in `FlowyNavigation._renderCollapse` (`home/navigation.dart`), left of the breadcrumbs: 24×24 `FlowyIconButton` with `FlowySvgs.double_back_arrow_m` rotated 180°, color `theme.iconColorScheme.secondary`, right padding 8, plus `NumberedRedDot.desktop()` (unread-notification badge) aligned top-right. Same tooltip text (`⌘+.` on macOS).
- Hidden sidebar = translated off-screen (not unmounted); the page area animates `left` from `menuWidth` to 0 over 350ms easeOutQuad.

### 1.6 Notification panel (`workspace/presentation/notifications/notification_panel.dart`)

- Opened by the sidebar notification button (§2A) via `HomeSettingEvent.collapseNotificationPanel()` (toggle). Not persisted.
- Full-width transparent backdrop (`GestureDetector` → tap anywhere outside closes) containing a left-aligned 380px panel: `color: theme.backgroundColorScheme.primary` (#FFFFFF | #21232A), `boxShadow: theme.shadow.small` (light `0 2 16 #0000001F`, dark `0 2 16 #0000007A`), `padding: vertical 14`.
- Placement: `left = menuWidth` when sidebar shown (panel appears right next to the sidebar) else `left = 0, top = 52`.
- Title row (h 24, padding h16): `FlowyText.medium(LocaleKeys.notificationHub_title, fontSize 16, figmaLineHeight 24)`; spacer; 24px `FlowyIconButton(FlowySvgs.double_back_arrow_m, color theme.iconColorScheme.secondary)` with rich tooltip `LocaleKeys.notificationHub_closeNotification` + `Ctrl+\` → closes; `HSpace(8)`; more button (24px, `FlowySvgs.three_dots_m`, icon secondary) → `AppFlowyPopover(constraints loose 240×78, offset (-24, 24), margin 0)` containing (padding 8, radius 8, `cardColor`): 
  - 30px `FlowyButton` `LocaleKeys.settings_notifications_settings_markAllAsRead`, icon `FlowySvgs.m_notification_mark_as_read_s` → `ReminderEvent.markAllRead()` + toast `LocaleKeys.notificationHub_markAllAsReadSucceedToast`.
  - `VSpace(2)`; 30px `LocaleKeys.settings_notifications_settings_archiveAll`, icon `FlowySvgs.m_notification_archived_s` → `ReminderEvent.archiveAll()` + toast `LocaleKeys.notificationHub_markAllAsArchivedSucceedToast`.
- `VSpace(12)` → `NotificationTabBar` with 3 tabs (`NotificationTabType.inbox|unread|archive` → `LocaleKeys.settings_notifications_tabs_inbox|unread|archived`; selected label 16px, unselected 15px, line-height 22) → `VSpace(14)` → `TabBarView` of `NotificationTab(tabType)`. Empty state: `LocaleKeys.notificationHub_emptyTitle` (14px) / `LocaleKeys.notificationHub_emptyBody`.
- Data: `ReminderBloc` (`user/application/reminder/reminder_bloc.dart`): `started` → `refresh` = `UserEventGetAllReminders` + `FolderEventGetAllViews` (to drop reminders whose view is gone); periodic timer + app-lifecycle refresh; `markAllRead`/`archiveAll` → `UserEventUpdateReminder` per reminder. Item click navigates via `ActionNavigationBloc` (`ActionType.openView` with `view`, `nodePath`, `blockId`, `rowId` args) handled in `HomeSideBar._onNotificationAction` → `TabsBloc.openPlugin(view, arguments)`. (Full reminder/notification item spec belongs to the notifications doc; shell only needs the panel container.)

### 1.7 Question bubble (`workspace/presentation/widgets/float_bubble/question_bubble.dart`)

- 32×32 at bottom-right of the window (`right 20, bottom 16`), above the page area.
- Visual: `padding 8`, `ShapeDecoration` radius 18, border 0.5px; light: fill `#FFFFFF`, border `#4548492D`, shadow `#00000014` blur 20 offset (0,8), icon black; dark: fill `#242B37`, border `#FFFFFF2D`, icon white. Icon `FlowySvgs.help_center_s`. Tooltip `LocaleKeys.questionBubble_getSupport`. Cursor pointer.
- Click → `PopoverActionList(direction: topWithRightAligned, offset (0,-8), constraints minW 200 maxW 460 maxH 400)` items in order:

| `BubbleAction` | Label key | Icon | Action |
|---|---|---|---|
| `whatsNews` | `questionBubble_whatsNew` | `FlowySvgs.star_s` | open `https://www.appflowy.io/what-is-new` (**blocked** vendor host) |
| `helpAndDocumentation` | `questionBubble_helpAndDocumentation` | `FlowySvgs.help_and_documentation_s` | `https://appflowy.com/guide` (**blocked**) |
| `getSupport` | `questionBubble_getSupport` | `FlowySvgs.message_support_s` | `https://discord.gg/9Q2xaN37tV` |
| `debug` | `questionBubble_debug_name` | `FlowySvgs.debug_s` | copy device info + `Document: <appDataDir>` to clipboard, toast `questionBubble_debug_success` |
| `shortcuts` | `questionBubble_shortcuts` | `FlowySvgs.keyboard_s` | `https://docs.appflowy.io/docs/appflowy/product/shortcuts` (**blocked**) |
| `markdown` | `questionBubble_markdown` | `FlowySvgs.number_s` | `https://docs.appflowy.io/docs/appflowy/product/markdown` (**blocked**) |
| `github` | `questionBubble_feedback` | `FlowySvgs.share_feedback_s` | `https://github.com/AppFlowy-IO/AppFlowy/issues/new/choose` |
| — | `SocialMediaSection` | reddit/x/forum icons | `https://www.reddit.com/r/AppFlowy/`, `https://x.com/appflowy`, `https://forum.appflowy.com/` (**blocked**) |
| — | `FlowyVersionSection` | — | app version text (`ApplicationInfo`) |

- Unused: `fontColor`/`fillColor` getters (`cs.tertiary`/`cs.tertiaryContainer`, primary when open) are computed but the container uses the hard-coded colors above.

### 1.8 Window frame / title bar (Windows)

- `startup/tasks/windows.dart` `InitAppWindowTask`:
  - Window title `'AppFlowy'`; size from KV `windowSize` (`{"height":H,"width":W}`, default 1280×960), clamped to min 640×640, max 8192×8192; position from KV `windowPosition` (`{"dx":X,"dy":Y}`); maximized flag KV `windowMaximized` (`"true"|"false"`).
  - **Windows**: `windowManager.setTitleBarStyle(TitleBarStyle.hidden)` (frameless, native caption removed) + `bitsdojo_window` `doWhenWindowReady` sets min/max/size/position and `maximize()` if previously maximized.
  - Listeners persist: on resize → `windowSize`; on move → `windowPosition`; on maximize/enter-fullscreen → `windowMaximized=true`, `windowPosition={0,0}`; on unmaximize/leave-fullscreen → `windowMaximized=false` + current position.
  - Scale factor (zoom) restored from KV `scaleFactor` (double string, clamp 0.5..2.0) via `ScaledWidgetsFlutterBinding.scaleFactor` (whole-UI zoom). Electron: `webContents.setZoomFactor`.
- Custom title bar `shared/window_title_bar.dart` `WindowTitleBar` — rendered **only on Windows**, as the first child of `HomeStack`'s Column, i.e. it spans **only the page area (right of the sidebar)**, not the sidebar:
  - `height 40`, background `cs.surfaceContainerHighest` (= sidebar bg: light `#F7F8FC`, dark `#232B38`).
  - Entire bar is a `DragToMoveArea` (pan-start → `windowManager.startDragging()`; double-click → toggle maximize). Electron: `-webkit-app-region: drag` on the bar, `no-drag` on buttons; handle dblclick via IPC.
  - Row: `HSpace(4)`, leftChildren = `[toggle-sidebar button]` (only when sidebar is not expanded, §1.5), `Spacer`, `WindowCaptionButton.minimize`, `maximize` or `unmaximize` (tracks `onWindowMaximize/onWindowUnmaximize`), `close`.
  - Caption buttons (window_manager git `5a43aed`): min size 46×32, drawn chrome icons (minimize/maximize/unmaximize/close painters). Bg: normal transparent; hover light `rgba(0,0,0,0.0373)` / dark `rgba(255,255,255,0.0605)`; pressed light `rgba(0,0,0,0.0241)` / dark `rgba(255,255,255,0.0419)`. Icon: light `rgba(0,0,0,0.8956)` (pressed 0.6063), dark white (pressed 0.786). Close: hover/pressed bg `#C42B1C` (pressed 0.9 opacity), icon white.
  - Note the 40px title bar sits above the tabs bar and the page top bar, so on Windows the page area starts at y=40.
- Sidebar top bar on Windows is `45` px tall (vs `HomeSizes.topBarHeight = 44` elsewhere) (`menu/sidebar/header/sidebar_top_menu.dart`), and shows the app logo `FlowySvgs.app_logo_with_text_light_xl` / `_dark_xl` (92×17, padding top 12 left 8); on macOS the logo is hidden. The sidebar area itself is **not** a drag region on Windows (`MoveWindowDetector` only acts on macOS < 15). AMBIGUOUS: the user can only drag the window from the page-area title bar on Windows.
- `MoveWindowDetector` (`core/frameless_window.dart`): no-op on Windows/Linux; macOS < 15 manual drag + double-click zoom. Wraps the sidebar top menu, tabs bar, and page top bar.
- `_HomeStackState` mixes in `WindowListener` and calls `setState` on `onWindowFocus` (window_manager Windows repaint quirk) — Electron: ignore.
- Electron mapping: `new BrowserWindow({frame: false, minWidth: 640, minHeight: 640, width, height, x, y, title: 'AppFlowy'})`, custom 40px caption in the page column with three 46×32 buttons (`win.minimize()`, `maximize()/unmaximize()`, `close()`), listen to `maximize/unmaximize/resize/move` to persist the same KV keys.

---

## 2. Sidebar

Split into three parts: **2A** skeleton (vertical layout, header, workspace switcher, search/new-page/Jira entries, footer, local tools), **2B** sections (Favorites, Shared, Spaces, legacy Workspace/Private/Personal folders, SpaceBloc), **2C** the page-tree row (indentation, hover, icons, `+` and `···` menus, rename, drag-and-drop, ViewBloc, folder protobufs/events/notifications, Trash). Sidebar outer box: width `layout.menuWidth` (268..468, §1.3), background `cs.surfaceContainerHighest` (`#F7F8FC` / `#232B38`), 1px right border `Theme.dividerColor` (`#F2F2F2` / `#363D49`).

## 2A. Sidebar skeleton, header, workspace menu, search/AI entries, footer, local tools

All paths relative to `appflowy_flutter/lib/` unless prefixed. "Light/Dark" hex values are for the built-in **default** color scheme (`packages/flowy_infra/lib/colorscheme/default_colorscheme.dart`); other built-in schemes (dandelion, lavender, lemonade) remap the same tokens. Flutter `Color(0xAARRGGBB)` → CSS `#RRGGBBAA`.

### 2A.0 Tokens and primitives

Resolved theme tokens (light/dark hex), `FlowyText`/`FlowyButton`/`FlowyHover`/`FlowyIconButton`/`FlowyTooltip`/`AppFlowyPopover`/toast defaults: see **§5**. Additional primitives used in this part:

- `FlowyButton` row structure: `[leftIcon in SizedBox(leftIconSize=16×16)] HSpace(iconPadding=6) [text (Expanded if expandText)] HSpace(iconPadding) [rightIcon]`. The `margin` parameter is the inner padding (default h6 v4) and **replaces** the default when provided. `useIntrinsicWidth` → shrink-wrap. Cursor pointer (forbidden when `disable`).
- `FlowyText(figmaLineHeight: X)` → CSS `line-height: Xpx`; `lineHeight: k` → unitless `line-height: k`.
- `FlowyDivider`: 1px line, color `AFThemeExtension.borderColor` (`#EDEDEE` / `#3A3F49`).
- Loading overlay (`shared/loading.dart` `Loading(context)`): `showDialog(barrierDismissible: false)`, transparent barrier, centered `CircularProgressIndicator`; `.start()` / `.stop()`.

### 2A.1 `HomeSideBar` (workspace/presentation/home/menu/sidebar/sidebar.dart) — bloc wiring

Constructor inputs: `UserProfilePB userProfile`, `WorkspaceLatestPB workspaceSetting` (from home load).

Ancestors that must exist (provided by `desktop_home_screen.dart`): `UserWorkspaceBloc` (created there with `RustWorkspaceRepositoryImpl(userId)` and `..add(UserWorkspaceEvent.initialize())`, no `initialWorkspaceId`), `HomeSettingBloc`, `TabsBloc` (also `getIt<TabsBloc>()`, same instance), `FavoriteBloc`, `CommandPaletteBloc`, `NotificationSettingsCubit`, `DocumentAppearanceCubit`.

Tree:
```
BlocProvider<SidebarPlanBloc>(create: SidebarPlanBloc()..add(SidebarPlanEvent.init(workspaceSetting.workspaceId, userProfile)))
 └ BlocConsumer<UserWorkspaceBloc, UserWorkspaceState>
     listenWhen/buildWhen: prev.currentWorkspace?.workspaceId != curr.currentWorkspace?.workspaceId
     listener:
       - if FeatureFlag.search.isOn (always ON): CommandPaletteBloc.add(CommandPaletteEvent.workspaceChanged(workspaceId: state.currentWorkspace?.workspaceId))
       - if currentWorkspace != null: SidebarPlanBloc.add(SidebarPlanEvent.changedWorkspace(workspaceId))
       - getIt<CachedRecentService>().reset()
     builder: currentWorkspace == null → SizedBox.shrink() (empty sidebar)
              else workspaceId = currentWorkspace.workspaceId ?? workspaceSetting.workspaceId
     └ MultiBlocProvider
         - BlocProvider.value(getIt<ActionNavigationBloc>())
         - SidebarSectionsBloc()..add(SidebarSectionsEvent.initial(userProfile, workspaceId))
         - SpaceBloc(userProfile, workspaceId)..add(SpaceEvent.initial(openFirstPage: false))
       └ MultiBlocListener (4 listeners, below)
           └ _Sidebar(userProfile)
```
Note: `MultiBlocProvider` has no key, so on workspace switch Flutter keeps the existing `SidebarSectionsBloc`/`SpaceBloc` instances (provider `create` is not re-run). Workspace switching is propagated through listener #4 (`reload`/`reset`). Electron: either re-create stores keyed by workspaceId, or replicate reset semantics — both acceptable if observable result matches.

Listeners:

| # | Bloc | listenWhen | Action |
|---|---|---|---|
| 1 | `SidebarSectionsBloc` | `p.lastCreatedRootView?.id != c.lastCreatedRootView?.id` | `TabsBloc.add(TabsEvent.openPlugin(plugin: state.lastCreatedRootView!.plugin()))` (open newly created root page; no-space mode) |
| 2 | `SpaceBloc` | `lastCreatedPage?.id` changed OR `isDuplicatingSpace` changed | if `lastCreatedPage == null` or `id.isEmpty` → `TabsEvent.openPlugin(plugin: BlankPagePlugin())`; else open `lastCreatedPage.plugin()`. Then if `isDuplicatingSpace` → show global `Loading` (module-level `_duplicateSpaceLoading`), else stop it. QUIRK: toggling `isDuplicatingSpace` also re-runs the open logic (may reopen last created page or blank). |
| 3 | `ActionNavigationBloc` | `curr.action != null` | `_onNotificationAction` (below) |
| 4 | `UserWorkspaceBloc` | (none — fires on every state emission) | if `state.actionResult?.actionType ∈ {create, delete, open}`: if `SpaceBloc.state.spaces.isEmpty` → `SidebarSectionsEvent.reload(userProfile, currentWorkspace?.workspaceId ?? workspaceSetting.workspaceId)` else `SpaceEvent.reset(userProfile, workspaceId, true /*openFirstPage*/)`; then `FavoriteBloc.add(FavoriteEvent.fetchFavorites())`. QUIRK: no listenWhen ⇒ fires for the loading emission and for later unrelated emissions while `actionResult` stays create/delete/open. `SpaceEvent.reset` early-returns if workspaceId unchanged. Electron: run once per completed action (isLoading=false) to be safe; behaviour is idempotent. |

`_onNotificationAction(context, state)` (reminder/notification click → open page):
- Only `ActionType.openView` (enum `openView | jumpToBlock | openRow`, `workspace/application/action_navigation/navigation_action.dart`).
- `view = action.arguments['view']` (ViewPB). If `arguments['node_path']` present → `PluginArgumentKeys.selection = Selection.collapsed(Position(path: [nodePath]))`.
- `checkForSpace(spaceBloc, view, afterOpen)`: `ViewAncestorCache.getAncestor(view.id)` (→ `FolderEventGetViewAncestors(ViewIdPB{value})`, filtered `parentViewId != '' && id != viewId`); first ancestor = space; if `!= spaceBloc.state.currentSpace?.id` → `ViewBackendService.getView(firstAncestor.id)` (`FolderEventGetView(ViewIdPB)`) → `SpaceEvent.open(space: space, afterOpen: afterOpen)`.
- `openView(...)` is ALSO called immediately (so it runs twice when a space switch happens; second call is de-duplicated by `TabsBloc` 500 ms window if same plugin id). Adds `arguments['block_id'] → PluginArgumentKeys.blockId`, `arguments['row_id'] → PluginArgumentKeys.rowId`, then post-frame `TabsBloc.openPlugin(view, arguments: arguments)`.

---

### 2A.2 `_Sidebar` widget tree (top → bottom, exact order)

`menuHorizontalInset = EdgeInsets.symmetric(horizontal: 8)`.

Root: `MouseRegion` (sets `_isHovered` true/false — drives collapse-button opacity) → `DecoratedBox(color: colorScheme.surfaceContainerHighest, border: right 1px dividerColor)` → `Column(mainAxisSize: min, crossAxisAlignment: center (default))`.

| # | Element | Container geometry | Visibility condition |
|---|---|---|---|
| 1 | `SidebarTopMenu(isSidebarOnHover: _isHovered)` | `Padding(h 8)`; height **45 on Windows**, 44 elsewhere (`HomeSizes.topBarHeight`) | always |
| 2 | Header row: `SidebarWorkspace` or `SidebarUser` (inside `BlocBuilder<UserWorkspaceBloc>`) | `Container(height: 32 = HomeSizes.workspaceSectionHeight, padding: left 8, right 2)` (= inset − right 6) | `state.isCollabWorkspaceOn && state.workspaces.isNotEmpty` → `SidebarWorkspace`; else `SidebarUser` |
| 3 | `VSpace(6)` + search button `_SidebarSearchButton` | `Container(padding: h 8, height: 30 = HomeSizes.searchSectionHeight)` | `FeatureFlag.search.isOn` (always true) |
| 4 | `VSpace(6)` + `SidebarNewPageButton` | own `Container(padding: h 8, height: 30)` (not wrapped in inset) | `UserWorkspaceBloc.state.currentWorkspace?.role != AFRolePB.Guest` (read once, not watched) |
| 5 | **Jira button** (this checkout): `Padding(h 8, child: TextButton.icon(icon: Icon(Icons.task_alt, size: 18), label: Text('Jira'), onPressed: open LocalToolPlugin 'jira'))` | intrinsic width, **horizontally centered** (Column default cross-axis center) | always |
| 6 | `VSpace(12)` | | |
| 7 | Top divider: `Padding(h 12, FlowyDivider)` wrapped in `Opacity(scrollOffset > 0 ? 1 : 0)` | 1px | visible only when the page list is scrolled (`_scrollOffset > 0`) |
| 8 | `_renderFolderOrSpace` → `Expanded` scroll area (2A.3) | flex | only when `SpaceBloc.state.isInitialized`, else `SizedBox.shrink()` (no Expanded!) |
| 9 | Bottom divider `Padding(h 12 (=8+4), FlowyDivider)` | | always |
| 10 | `VSpace(8)` | | |
| 11 | `_renderUpgradeSpaceButton` → `Padding(left 12, right 12, top 8)` + `SpaceMigration()` | | `spaceState.shouldShowUpgradeDialog && workspaceState.isCollabWorkspaceOn` (watches SpaceBloc) |
| 12 | `_buildUpgradeApplicationButton` → `Padding(h 12)` + `SidebarUpgradeApplicationButton` | | `!_muteUpdateButton && ApplicationInfo.isUpdateAvailable` — **never shown in this checkout** (AutoUpdateTask removed from `startup.dart`; `latestVersionNotifier` stays `''`) |
| 13 | `VSpace(8)` | | |
| 14 | `Padding(h 12, SidebarFooter(user: userProfile))` | | always |
| 15 | `VSpace(14)` | | |

Jira `TextButton.icon` styling (Material 2 defaults, no theme override except minimumSize 0): foreground `colorScheme.primary` (`#00BCF0`), label style = M2 `labelLarge`/button (14px, w500, letterSpacing 1.25 — AMBIGUOUS: verify rendered letterSpacing; AppFlowy textTheme does not define `labelLarge`), padding ≈ 8px all sides, icon–label gap 8, hover overlay `primary @ 4%`, pressed `primary @ 12%`, radius 4. Not localized ("Jira" literal).

Scroll state (`_SidebarState`):
- `_scrollController` listener: sets `_isScrolling = true` (setState) and debounces 300 ms → `_isScrolling = false`; updates `_scrollOffset`.
- `isHoverEnabled: !_isScrolling` passed to `SidebarFolder`/`SidebarSpace` (row hover effects disabled while scrolling).

### 2A.3 Folder-vs-Space branch (`_renderFolderOrSpace`)

```
if (!spaceState.isInitialized) return SizedBox.shrink();
containsSpace = context.watch<SidebarSectionsBloc>().state.containsSpace;
if (containsSpace && spaceState.spaces.isEmpty) SpaceBloc.add(SpaceEvent.didReceiveSpaceUpdate());   // side effect in build
useFolder = !containsSpace || spaceState.spaces.isEmpty || !workspaceState.isCollabWorkspaceOn;
```
- Folder mode: `Expanded(Padding(left 8, right 2, SingleChildScrollView(padding: right 6, controller, ClampingScrollPhysics, child: SidebarFolder(userProfile, isHoverEnabled))))` — no visible scrollbar widget (default platform scrollbar behaviour; AMBIGUOUS: Flutter desktop shows a default Scrollbar via ScrollBehavior).
- Space mode: same but wrapped in `FlowyScrollbar(controller)`: thumb visible only while mouse is over the list, radius 12, thickness 4 (theme), and the inner default scrollbar is suppressed.
- Content of `SidebarFolder` / `SidebarSpace` → see parts 2B/2C.

---

### 2A.4 `SidebarTopMenu` (header/sidebar_top_menu.dart)

- `BlocBuilder<SidebarSectionsBloc>` (rebuild only) → `SizedBox(height: Windows 45 / else 44)` → `MoveWindowDetector` (macOS-only drag/double-click-zoom; pass-through on Windows) → `Row[logo, Spacer, collapse]`.
- Logo (hidden on macOS): `Padding(top 12, left 8)` → `FlowySvg(brightness == dark ? FlowySvgs.app_logo_with_text_dark_xl : FlowySvgs.app_logo_with_text_light_xl, size: 92×17, blendMode: null)` (assets `40x/app_logo_with_text_{dark,light}.svg`).
- Collapse button: `Opacity(sidebarHovered ? 1 : 0)` (instant, no animation) → `Padding(top 12, right 6)` → `FlowyTooltip(richMessage)` → `Listener(onPointerDown: HomeSettingBloc.collapseMenu())` → `FlowyHover` (hover bg `colorScheme.secondary`, radius 6) → `SizedBox(width: 24)` → `FlowySvg(FlowySvgs.double_back_arrow_m /*24x*/, color: AppFlowyTheme.iconColorScheme.secondary)`.
  - Fires on pointer DOWN (not click/up), even when invisible (opacity 0 still hit-tests).
  - `HomeSettingBloc.collapseMenu()`: if `isMenuExpanded` → `changeMenuStatus(MenuStatus.hidden)`; if `isMenuHidden` → `changeMenuStatus(MenuStatus.expanded)`.
  - Tooltip: line 1 `LocaleKeys.sideBar_closeSidebar` ("Close sidebar"), tooltipTextStyle; line 2 (only if `HomeSettingBloc.state.isNotificationPanelCollapsed`, default true) `Ctrl+\` (Windows/Linux) / `⌘+.` (macOS), color `hintColor`.

### 2A.5 Header row

#### 2A.5.1 `SidebarWorkspace` (workspace/sidebar_workspace.dart) — shown when collab workspace on

- `BlocConsumer<UserWorkspaceBloc>`; `listenWhen: prev.actionResult != curr.actionResult` → `_showResultDialog` (2A.8.7). Builder: `currentWorkspace == null` → shrink.
- `MouseRegion` (hover state `onHover`) → `Container(margin: right 8, radius 8, color: hovered ? colorScheme.secondary : transparent)` → `Row`:
  1. `Expanded(SidebarSwitchWorkspaceButton(userProfile, currentWorkspace, isHover))`
  2. `UserSettingButton(isHover)` (28×28)
  3. `HSpace(8)`
  4. `NotificationButton(isHover, key: ValueKey(workspaceId))` (28×28)
  5. `HSpace(4)`
- Effective geometry: header container height 32, left padding 8, right padding 2 + margin 8.
- `initState`: subscribes `openWorkspaceNotifier` (invitation deeplink, 2A.8.8).

#### 2A.5.2 `SidebarUser` (header/sidebar_user.dart) — shown when NOT collab (local auth) or no workspaces

- Provides `MenuUserBloc(userProfile, workspaceId)` — NOTE: created **without** `MenuUserEvent.initial()`, so its `UserListener` never starts; displayed name/avatar = profile passed in (no live update). Electron may live-update; flag as AMBIGUOUS parity.
- `Row`: `HSpace(4)`, `UserAvatar(iconUrl, name, size: AFAvatarSize.s /*24*/, decoration: ShapeDecoration(color: #FBE8FB, RoundedRectangleBorder(side: 0.5px #17171719, radius 8)))`, `HSpace(8)`, `Expanded(FlowyText.medium(name, fontSize: 15, color: colorScheme.tertiary, ellipsis))`, `UserSettingButton()`, `HSpace(8)`, `NotificationButton(key: ValueKey(userProfile.id))`, `HSpace(10)`.
- Name: `userProfile.name`, empty → `LocaleKeys.defaultUsername` ("Me").
- No hover background on this row.
- `AFAvatar` (packages/appflowy_ui) renders image from `iconUrl` or initials from `name` (see shared-components doc).

### 2A.6 `UserSettingButton` + settings entry (shared/sidebar_setting.dart)

- `SizedBox.square(28)` → `FlowyTooltip(message: LocaleKeys.settings_menu_open /*"Open Settings"*/)` → `FlowyButton(margin: zero, text: FlowySvg(FlowySvgs.settings_s, color: isHover ? colorScheme.onSurface : null(iconTheme), opacity: 0.7))`. Hover bg default `colorScheme.secondary`, radius 6.
- `initState`: creates `PasswordBloc(userProfile)..add(PasswordEvent.init())..add(PasswordEvent.checkHasPassword())` (kept for dialog).
- Tap → `showSettingsDialog(context, userWorkspaceBloc, passwordBloc)`:
  - `AFFocusManager.maybeOf(context)?.notifyLoseFocus()` first.
  - `showDialog` with `MultiBlocProvider(key: _settingsDialogKey)` providing `PasswordBloc`, `DocumentAppearanceCubit`, `UserWorkspaceBloc` → `SettingsDialog(userProfile, initPage, didLogout: pop + runAppFlowy(), dismissDialog: pop, restartApp: pop + runAppFlowy())`. Settings content → separate parity doc.
- Hotkey `openSettingsHotKey`: `Ctrl+,` (Windows/Linux), `⌘+,` (macOS), `HotKeyScope.inapp`, registered in `hotkeys.dart` list. If dialog not open → `showSettingsDialog`; if open (`_settingsDialogKey.currentContext != null`) → `Navigator.of(rootNavigator).popUntil(isFirst)` (toggle/close).

### 2A.7 `NotificationButton` (workspace/presentation/notifications/widgets/notification_button.dart)

- `initState`: `getIt<ReminderBloc>().add(ReminderEvent.started())` → `refresh`: `UserEventGetAllReminders()` + `FolderEventGetAllViews()` (filters reminders whose views exist).
- Visible only if `NotificationSettingsCubit.state.isShowNotificationsIconEnabled` (KV key `KVKeys.showNotificationIcon = 'showNotificationIcon'`, string "true"/"false", default true; toggled from settings).
- Widget: `SizedBox.square(28)` → `Stack[ Center(SizedBox.square(28, FlowyButton(useIntrinsicWidth, margin: zero, text: FlowySvg(FlowySvgs.notification_s, color: isHover ? onSurface : null, opacity: 0.7)))), Align(topRight, NumberedRedDot.desktop()) ]`.
- Tap → `HomeSettingBloc.add(HomeSettingEvent.collapseNotificationPanel())` = **toggle** `isNotificationPanelCollapsed` (notification panel slides in; panel layout in part 1, width rules in `home_layout.dart`).
- `NumberedRedDot.desktop` (notifications/number_red_dot.dart): count = reminders with `!isRead`; 0 → hidden. Size: 1–9 → 14×14; 10–99 → 17×14; >99 → 24×14 showing `"99+"`. bg `AppFlowyTheme.borderColorScheme.errorThick` (`#E71D32` light), radius = height/2 (7), text white 10px w500 line-height 1, centered.

### 2A.8 Workspace switcher (collab mode)

#### 2A.8.1 `SidebarSwitchWorkspaceButton`

- `AppFlowyPopover(direction: bottomWithCenterAligned, offset: (0, 5), constraints: maxWidth 300 / maxHeight 600, margin: 0, animationDuration: Durations.short3 (150 ms), beginScaleFactor 1.0, beginOpacity 0.8, slideDistance 5 (default), triggerActions: none, onOpen: fetchWorkspaces)`.
- Popup: `BlocBuilder<UserWorkspaceBloc>` → `WorkspacesMenu(userProfile, currentWorkspace, workspaces)`.
- Child `_SideBarSwitchWorkspaceButtonChild`: `MouseRegion(cursor: click)` + `GestureDetector(onTap: add(UserWorkspaceEvent.fetchWorkspaces()); popoverController.show())` (fetch is dispatched twice: onTap + onOpen) → `SizedBox(height: 30)` → `Row`:
  - `HSpace(4)`
  - `WorkspaceIcon(workspaceIcon: icon, workspaceName: name, iconSize: 26, fontSize: 16, emojiSize: 20, isEditable: false, showBorder: false, borderRadius: 8, figmaLineHeight: 18)`
  - `HSpace(6)`
  - `Flexible(FlowyText.medium(name, fontSize: 15, color: isHover ? onSurface : default, ellipsis, withTooltip: true))`
  - if hovered: `HSpace(4)` + `FlowySvg(FlowySvgs.workspace_drop_down_menu_show_s, color: onSurface)`.

#### 2A.8.2 `WorkspaceIcon` (workspace/_sidebar_workspace_icon.dart)

- If `workspaceIcon` (emoji string) non-empty → `FlowyText.emoji(icon, fontSize: emojiSize, figmaLineHeight, optimizeEmojiAlign: true)`, no bg.
- Else → first character `name.substring(0,1)` (empty name → ''), `FlowyText.semibold(fontSize, color: textColor)` on bg `backgroundColor` from `ColorGenerator(name).randomColor()`:
  - `hash = sum of UTF-16 code units of name`; `index = hash % 8`; palette (text, bg):
    0 `#8A2BE2/#F0E6FF`, 1 `#2E8B57/#E0FFF0`, 2 `#1E90FF/#E6F3FF`, 3 `#FF7F50/#FFF0E6`, 4 `#FF69B4/#FFE6F0`, 5 `#20B2AA/#E0FFFF`, 6 `#DC143C/#FFE6E6`, 7 `#8B4513/#FFF0E6`.
- Container `iconSize × iconSize`, centered, radius `borderRadius`, border `1px #7171711A` if `showBorder` (default true).
- `isEditable` (desktop) → wraps in `AppFlowyPopover(offset (0,8), direction: bottomWithLeftAligned, constraints: loose 364×356, clickHandler: gestureDetector, margin 0)` with `FlowyIconEmojiPicker(tabs: [PickerTabType.emoji])`; on select → `onSelected(r.data)`; closes unless `r.keepOpen`. Cursor pointer.

#### 2A.8.3 `WorkspacesMenu` (workspace/_sidebar_workspace_menu.dart) — popup content

`Column(crossAxisAlignment: start, mainAxisSize: min)`:
1. Header `Padding(left 10, top 6, right 10)` → `Row[ Expanded(FlowyText.medium(userInfo, fontSize: 12, ellipsis, color: hintColor)), HSpace(4), WorkspaceMoreButton, HSpace(8) ]`. `userInfo` = email, else name, else `LocaleKeys.defaultUsername` ("Me").
2. `Padding(vertical 8, horizontal 6, Divider(height: 1))` (Material divider, `dividerColor`).
3. `Flexible(SingleChildScrollView(padding: h 6, Column[ for each workspace: WorkspaceMenuItem(key: ValueKey(workspaceId), isSelected: id == current), VSpace(6) ]))`. Order = `state.workspaces` (sorted by `createdAtTimestamp` ascending).
4. `Padding(h 6, _CreateWorkspaceButton)`.
5. Desktop only: `Padding(left 6, top 6, right 6, _ImportNotionButton)`.
6. `VSpace(6)`.
Popover-wide `PopoverMutex` shared by header more button and per-item more menus (only one sub-popover open).

#### 2A.8.4 `WorkspaceMenuItem`

- Provides `WorkspaceMemberBloc(userProfile, workspace)..add(WorkspaceMemberEvent.initial())` per row → `UserEventGetWorkspaceMembers(QueryWorkspacePB{workspaceId})`; `myRole` = member whose `email == userProfile.email` (not found → `Guest`); also triggers invite-code fetch (HTTP) and, if owner, subscription info. Electron can derive role from `UserWorkspacePB.role` but parity requires owner-only actions.
- `SizedBox(height: 44)` → `MouseRegion` (hover) → `Stack(alignment: center)`:
  - `_WorkspaceInfo` (full-width `FlowyButton`, default padding h6 v4, `iconPadding: 10`, `leftIcon: SizedBox.square(32)` placeholder (leftIconSize 32), `rightIcon: HSpace(32)`); text = `Row[ Flexible(Column(start, center)[ FlowyText.medium(name, fontSize 14, figmaLineHeight 17, ellipsis, withTooltip), if role != Guest: FlowyText.regular(memberCount == 0 ? '' : LocaleKeys.settings_appearance_members_membersCount.plural(memberCount) /*"{} member(s)"*/, fontSize 10, figmaLineHeight 12, color hintColor) ]), if role == Guest: HSpace(6) + GuestTag ]`.
    - Tap: if not selected → `getIt<TabsBloc>().add(TabsEvent.switchWorkspace(workspaceId))` (closes every non-pinned tab except the current one and selects index 0; nothing is persisted or restored — §3.2.2) → `UserWorkspaceEvent.openWorkspace(workspaceId, workspaceType)` → `PopoverContainer.of(context).closeAll()`. Selected row: no-op.
  - `Positioned(left: 4)`: `FlowyTooltip(message: LocaleKeys.document_plugins_cover_changeIcon /*"Change icon"*/)` → `WorkspaceIcon(iconSize 36, emojiSize 24, fontSize 18, figmaLineHeight 26, borderRadius 12, isEditable: true, showBorder: true)` → `UserWorkspaceEvent.updateWorkspaceIcon(workspaceId, icon: emoji)`.
  - `Positioned(right: 4)` → `Align` → `Row`:
    - if `!WorkspaceMemberBloc.state.isLoading`: `Padding(left 8, Opacity(hovered ? 1 : 0, WorkspaceMoreActionList))`
    - `HSpace(8)`
    - if selected: `Padding(all 5, FlowySvg(FlowySvgs.workspace_selected_s, blendMode: null, size: 14×14))` + `HSpace(8)`.
- `GuestTag` (features/share_tab/presentation/widgets/guest_tag.dart): padding left/right 8, bottom 2; bg `fillColorScheme.warningLight`; radius 6; text `LocaleKeys.shareTab_guest` ("Guest"), `textStyle.caption.standard(color: textColorScheme.warning)`, line-height 16/12.

#### 2A.8.5 Per-workspace more menu (`WorkspaceMoreActionList`, workspace/_sidebar_workspace_actions.dart)

- Actions by `myRole`: Owner → `[rename, divider, delete]`; `canLeave` (role != Owner) → `[leave]`; none → widget hidden.
- Trigger: `SizedBox.square(24)` → `FlowyButton(margin: h 4, text: FlowySvg(FlowySvgs.workspace_three_dots_s))`; opens only if not already open.
- `PopoverActionList(direction: bottomWithLeftAligned, constraints: minWidth 220, animationDuration: 150 ms, slideDistance 2, beginScaleFactor 1.0, beginOpacity 0.8, asBarrier: true, mutex: shared)`.
- Row widget: `FlowyIconTextButton(margin: all 6, iconPadding: 10, text: FlowyText.regular(name, fontSize 14, figmaLineHeight 18, color: (delete|leave) && hover ? colorScheme.error : default))`. `divider` → Material `Divider()`.
- On tap: close all popovers + close workspace menu, then:

| Action | Icon | Label key | Flow | Bloc event | Backend |
|---|---|---|---|---|---|
| rename | `FlowySvgs.view_item_rename_s` | `button_rename` ("Rename") | `showAFTextFieldDialog(title: LocaleKeys.workspace_renameWorkspace /*"Rename workspace"*/, initialValue: name, hintText: '')` | `UserWorkspaceEvent.renameWorkspace(workspaceId, name)` | `UserEventRenameWorkspace(RenameWorkspacePB{workspace_id, new_name})` |
| delete | `FlowySvgs.trash_s` (error color on hover) | `button_delete` ("Delete") | `showConfirmDeletionDialog(name, description: LocaleKeys.workspace_deleteWorkspaceHintText)`; title = `LocaleKeys.space_deleteConfirmation` ("Delete: ") + name | `UserWorkspaceEvent.deleteWorkspace(workspaceId)` | `UserEventDeleteWorkspace(UserWorkspaceIdPB{workspace_id})` |
| leave | `FlowySvgs.logout_s` (error color on hover) | `workspace_leaveCurrentWorkspace` ("Leave workspace") | `showConfirmDialog(title: workspace_leaveCurrentWorkspace, description: workspace_leaveCurrentWorkspacePrompt, confirmLabel: button_yes)` | `UserWorkspaceEvent.leaveWorkspace(workspaceId)` | `UserEventLeaveWorkspace(UserWorkspaceIdPB)` |

#### 2A.8.6 Header more button (`WorkspaceMoreButton`) / Create / Import Notion

- `WorkspaceMoreButton`: `AppFlowyPopover(direction: bottomWithLeftAligned, offset (0,6), mutex, asBarrier: true)`; trigger `SizedBox.square(24)` → `FlowyButton(useIntrinsicWidth, margin: zero, text: FlowySvg(FlowySvgs.workspace_three_dots_s, size 16×16))`. Popup = single `FlowyButton(margin: h 6 v 7, leftIcon: FlowySvg(FlowySvgs.workspace_logout_s), iconPadding: 10, text: FlowyText.regular(LocaleKeys.button_logout /*"Log out"*/))` → `getIt<AuthService>().signOut()` (`UserEventSignOut()`) → `runAppFlowy()` (full app restart → sign-in screen).
- `_CreateWorkspaceButton` (key `createWorkspaceButton`): `SizedBox(height: 40)` → `FlowyButton(margin: h 4, text: Row[ icon box, HSpace(8), FlowyText.regular(LocaleKeys.workspace_create /*"Create workspace"*/) ])`; icon box = `Container(36×36, padding 7, radius 12, border 0.8px Color(0x01717171) with alpha 0.12 ≈ #7171711F, child: FlowySvg(FlowySvgs.add_workspace_s))`.
  - Tap → `showAFTextFieldDialog(title: workspace_create, initialValue: '')` and `closeAll()`; confirm → `UserWorkspaceEvent.createWorkspace(name, workspaceType: WorkspaceTypePB.ServerW)` (always ServerW) → `UserEventCreateWorkspace(CreateWorkspacePB{name, workspace_type})`; on success bloc auto-dispatches `openWorkspace(new)`.
- `_ImportNotionButton` (key `importNotionButton`, desktop only): same 40px row, same icon box with `add_workspace_s`, label `LocaleKeys.workspace_importFromNotion` ("Import from Notion"); `rightIcon: FlowyTooltip(message: LocaleKeys.workspace_learnMore, preferBelow) → FlowyIconButton(FlowySvg(FlowySvgs.information_s))` → opens `https://docs.appflowy.io/docs/guides/import-from-notion`.
  - Tap → file picker (`FileType.custom`, `allowedExtensions: ['zip']`, single) → `closeAll()` → `NavigatorCustomDialog(hideCancelButton: true, confirm: () {}, child: NotionImporter(filePath))`.
  - `NotionImporter` (workspace/_sidebar_import_notion.dart): `ConstrainedBox(minHeight 30, maxHeight 200)`, runs `ImportBackendService.importZipFiles([ImportZipPB{file_path}])` → `FolderEventImportZipFile(ImportZipPB)`. States: uploading = spinner + `VSpace(12)` + `FlowyText(LocaleKeys.settings_common_uploadingFile, fontSize 16)`; success = `FlowyText(LocaleKeys.settings_common_uploadNotionSuccess, fontSize 16, maxLines 10)`; error = `FlowyText(error.msg, maxLines 10)`.

#### 2A.8.7 Action result feedback (`_SidebarWorkspaceState._showResultDialog`)

Runs on every `actionResult` change:
1. If notification panel open (`HomeSettingBloc.state.isNotificationPanelCollapsed == false`) → `HomeSettingEvent.collapseNotificationPanel()` (toggle = close).
2. `isLoading` → start a `Loading` overlay (once); otherwise stop it.
3. `create` + failure with `ErrorCode.WorkspaceLimitExceeded` → `NavigatorOkCancelDialog(message: LocaleKeys.workspace_createLimitExceeded)`; return.
4. Toast (success/error type by result):

| actionType | success key | failure text |
|---|---|---|
| create | `workspace_createSuccess` | `workspace_createFailed` + `": " + e.msg` |
| delete | `workspace_deleteSuccess` | `workspace_deleteFailed: msg` (incl. "Cannot delete the only workspace") |
| open | `workspace_openSuccess` | `workspace_openFailed: msg` |
| updateIcon | `workspace_updateIconSuccess` | `workspace_updateIconFailed: msg` |
| rename | `workspace_renameSuccess` | `workspace_renameFailed: msg` |
| fetchWorkspaces / none / leave / fetchSubscriptionInfo | no toast | |

Note: "open" success toast appears on every workspace switch.

#### 2A.8.8 Invitation deep link (`workspace_notifier.dart`)

- Global `ValueNotifier<WorkspaceNotifyValue?> openWorkspaceNotifier` ({workspaceId, email}); set by `startup/tasks/deeplink/invitation_deeplink_handler.dart` for URI host `invitation-callback` with query `workspace_id`, `email`.
- Handler: ignore if no id/email, already current, or `email != userProfile.email`. If workspace not in list → `fetchWorkspaces(initialWorkspaceId: id)` and retry after `250 + retryCount*250` ms, max 3 retries, then clear. Else → `openWorkspace(id, workspaceType)` and clear notifier.

---

### 2A.9 `UserWorkspaceBloc` (features/workspace/logic/workspace_bloc.dart, _event.dart, _state.dart)

Repository: `RustWorkspaceRepositoryImpl` (features/workspace/data/repositories/rust_workspace_repository_impl.dart) → `UserBackendService` (user/application/user_service.dart).

#### State `UserWorkspaceState`

| Field | Type | Default |
|---|---|---|
| `currentWorkspace` | `UserWorkspacePB?` | null |
| `workspaces` | `List<UserWorkspacePB>` | [] (always sorted by `createdAtTimestamp` asc where sorting applied) |
| `actionResult` | `WorkspaceActionResult?` {`actionType: WorkspaceActionType`, `isLoading: bool`, `result: FlowyResult<void, FlowyError>?`} | null |
| `isCollabWorkspaceOn` | bool | false; set at init = `userProfile.userAuthType == AuthTypePB.Server && FeatureFlag.collaborativeWorkspace.isOn` (flag always ON) |
| `userProfile` | `UserProfilePB` | ctor arg |
| `workspaceSubscriptionInfo` | `WorkspaceSubscriptionInfoPB?` | null |

`WorkspaceActionType`: `none, create, delete, open, rename, updateIcon, fetchWorkspaces, leave, fetchSubscriptionInfo`. `copyWith` cannot reset fields to null.

#### Events → backend

| Event | Backend calls (in order) | State emissions / follow-ups |
|---|---|---|
| `initialize()` | start `UserListener`; `_fetchWorkspaces(initialWorkspaceId)`; if current found → `fetchWorkspaceSubscriptionInfo`; if `shouldOpenWorkspace` → `UserEventOpenWorkspace` (direct repository call, no actionResult) | emit `{currentWorkspace, workspaces, isCollabWorkspaceOn, actionResult: (none, false, null)}` |
| `fetchWorkspaces({initialWorkspaceId})` | `_fetchWorkspaces` | emit `workspaces`; if fetched current ≠ state current → dispatch `openWorkspace` |
| `createWorkspace(name, workspaceType)` | `UserEventCreateWorkspace(CreateWorkspacePB{name, workspace_type})` → `UserWorkspacePB` | emit (create, loading) → emit sorted list + (create, done, result); success → `openWorkspace(new id, type)` |
| `deleteWorkspace(workspaceId)` | `_fetchWorkspaces()`; if local or remote count ≤ 1 → failure `ErrorCode.Internal` msg `workspace_cannotDeleteTheOnlyWorkspace`; else `UserEventDeleteWorkspace(UserWorkspaceIdPB)`, then `_fetchWorkspaces()` | emit (delete, loading) → emit `{workspaces, (delete, done, result)}`; success & deleted was current → `openWorkspace(first)`; failure & deleted id no longer in list → `openWorkspace(first)` |
| `openWorkspace(workspaceId, workspaceType)` | `UserEventOpenWorkspace(OpenUserWorkspacePB{workspace_id, workspace_type})` | emit (open, loading) → emit `{currentWorkspace: found-in-list on success / unchanged on failure, (open, done, result)}`; success → `fetchWorkspaceSubscriptionInfo`; always `getIt<ReminderBloc>().add(ReminderEvent.started())` |
| `renameWorkspace(workspaceId, name)` | `UserEventRenameWorkspace(RenameWorkspacePB{workspace_id, new_name})` | emit list with name patched + currentWorkspace re-resolved + (rename, done, result). No loading emission. |
| `updateWorkspaceIcon(workspaceId, icon)` | skip if workspace not found or `icon == workspace.icon`; `UserEventChangeWorkspaceIcon(ChangeWorkspaceIconPB{workspace_id, new_icon})` | emit list with icon patched + (updateIcon, done, result) |
| `leaveWorkspace(workspaceId)` | `UserEventLeaveWorkspace(UserWorkspaceIdPB)` | emit list without it + (leave, done, result); success & was current → `openWorkspace(first remaining)` |
| `fetchWorkspaceSubscriptionInfo(workspaceId)` | `isBillingEnabled()` = `UserEventGetCloudConfig()` and serverUrl ∈ {`https://beta.appflowy.cloud`, `https://test.appflowy.cloud`} (+`http://localhost:8000` debug). If enabled → `UserEventGetWorkspaceSubscriptionInfo(UserWorkspaceIdPB)` (fire-and-forget) | dispatches `updateWorkspaceSubscriptionInfo` if still current. For self-hosted servers → no-op. |
| `updateWorkspaceSubscriptionInfo(workspaceId, info)` | — | emit `workspaceSubscriptionInfo` |
| `emitWorkspaces(workspaces)` | — | emit sorted list |
| `emitUserProfile(userProfile)` | — | emit profile |
| `emitCurrentWorkspace(workspace)` | — | emit currentWorkspace |

`_fetchWorkspaces({initialWorkspaceId})`:
1. `FolderEventReadCurrentWorkspace()` → `WorkspacePB{id, name, views, create_time}` (failure → null).
2. `currentId = initialWorkspaceId ?? currentWorkspace?.id`.
3. `UserEventGetAllWorkspace()` → `RepeatedUserWorkspacePB.items` (throws on failure → catch returns current state, `shouldOpenWorkspace: false`).
4. If list empty and folder workspace exists → synthesize `UserWorkspacePB{workspaceId: id, name, createdAtTimestamp: createTime}`.
5. `current = find(currentId) ?? first`; `shouldOpenWorkspace = current?.workspaceId != currentId`.

Listeners (`UserListener`, user/application/user_listener.dart; parser keyed by **user id string**, source = user observable):

| `UserNotification` (value) | Payload | Bloc reaction |
|---|---|---|
| `DidUpdateUserProfile` (2) | `UserProfilePB` | `emitUserProfile` |
| `DidOpenWorkspace` (9) | `UserProfilePB` | `emitUserProfile` |
| `DidUpdateUserWorkspaces` (3) | `RepeatedUserWorkspacePB` | `emitWorkspaces(sorted items)` |
| `DidUpdateUserWorkspace` (5) | `UserWorkspacePB` | if same id as current → `emitCurrentWorkspace` |
| `DidUpdateWorkspaceSetting` (6) | `WorkspaceSettingsPB` | not used by this bloc |

Other enum values: `Unknown 0, UserAuthStateChanged 1, DidUpdateCloudConfig 4, DidLoadUserAwareness 7, DidUpdateReminder 8`.

#### Protobuf shapes used (rust-lib/flowy-user/src/entities/*.rs, flowy-folder/src/entities/*.rs)

```
UserWorkspacePB { 1 workspace_id: string; 2 name: string; 3 created_at_timestamp: i64; 4 icon: string; 5 member_count: i64; 6 role?: AFRolePB (oneof); 7 workspace_type: WorkspaceTypePB }
OpenUserWorkspacePB { 1 workspace_id; 2 workspace_type: WorkspaceTypePB }
CreateWorkspacePB { 1 name; 2 workspace_type: WorkspaceTypePB }
RenameWorkspacePB { 1 workspace_id; 2 new_name }
ChangeWorkspaceIconPB { 1 workspace_id; 2 new_icon }
UserWorkspaceIdPB { 1 workspace_id }
QueryWorkspacePB { 1 workspace_id }
enum WorkspaceTypePB { LocalW = 0 (default); ServerW = 1 }
enum AFRolePB { Owner = 0; Member = 1; Guest = 2 (default) }
enum AuthTypePB { Local = 0 (default); Server = 1 }
WorkspacePB (folder) { 1 id; 2 name; 3 views: ViewPB[]; 4 create_time: i64 }
WorkspaceLatestPB (folder) { 1 workspace_id; 2 latest_view?: ViewPB }
ImportZipPB { 1 file_path }
ImportPayloadPB { 1 parent_view_id; 2 items: ImportItemPayloadPB[] }
ImportItemPayloadPB { 1 name; 2 data?: bytes (oneof); 3 file_path?: string (oneof); 4 view_layout: ViewLayoutPB; 5 import_type: ImportTypePB }
enum ImportTypePB { HistoryDocument = 0; HistoryDatabase = 1; Markdown = 2; AFDatabase = 3; CSV = 4 }
```

---

### 2A.10 Search button → command palette (`_SidebarSearchButton` in sidebar.dart)

- `FlowyTooltip(richMessage: "<LocaleKeys.search_sidebarSearchIcon>\n" + (macOS ? '⌘+P' : 'Ctrl+P') in hintColor)` — "Search and quickly jump to a page".
- `FlowyButton(leftIcon: FlowySvg(FlowySvgs.search_s) /*16*/, iconPadding: 12, margin: EdgeInsets.only(left: 8) /*no vertical padding*/, text: FlowyText.regular(LocaleKeys.search_label /*"Search"*/))` inside the 30px container with h 8 padding. Hover bg `colorScheme.secondary`, radius 6.
- Tap: `EditorNotification.exitEditing().post()` (leave editor edit mode) → `CommandPalette.of(context).toggle(workspaceBloc, spaceBloc)`.
- Command palette (workspace/presentation/command_palette/command_palette.dart; full spec belongs to the search doc): toggled by `Ctrl+P` / `⌘+P` (`FocusableActionDetector` with `LogicalKeySet(control|meta, keyP)`), on open dispatches `CommandPaletteEvent.refreshCachedViews()` and shows `FlowyOverlay` with `FlowyDialog(bg: surfaceColorScheme.layer01, alignment: topCenter, insetPadding: top 100, constraints: min 572×640, max 960×640)`; padding xl(16) l/t/r. Empty query → recent views; results → `SearchResultList`; no results → `NoSearchResultsHint` (+ `SearchAskAiEntrance` when `userProfile.workspaceType == ServerW`).

### 2A.11 AI entries in the sidebar

- **None** in `sidebar/**` (no AI chat / AI meeting button; grep for `ViewLayoutPB.Chat`/`aiChat` in sidebar returns nothing).
- Indirect AI entry points: command palette "Ask AI" (`state.askAI` → `SpaceEvent.createPage(name: '', layout: ViewLayoutPB.Chat, index: 0, openAfterCreate: true)`, only when workspaceType == ServerW); "AI Chat" layout in the page add-button menu (part 2C).

### 2A.12 `SidebarNewPageButton` (shared/sidebar_new_page_button.dart)

- `Container(padding: h 8, height: 30)` → `FlowyButton(leftIcon: FlowySvg(FlowySvgs.new_app_m /*24x*/, blendMode: null /*original colors*/), leftIconSize: 24×24, margin: EdgeInsets.only(left: 4), iconPadding: 8, text: FlowyText.regular(LocaleKeys.newPageText /*"New page"*/, lineHeight: 1.15))`.
- Also triggered by global `createNewPageNotifier` (hotkey `Ctrl+N` / `⌘+N`, `HotKeyScope.inapp`, in `hotkeys.dart`).
- `_createNewPage`:
  - If `SpaceBloc.state.spaces.isNotEmpty` → `SpaceEvent.createPage(name: '', index: 0, layout: ViewLayoutPB.Document, openAfterCreate: true)` → `ViewBackendService.createView` → `FolderEventCreateView(CreateViewPayloadPB{parent_view_id: currentSpace.id, name: '', layout: Document, set_as_current: true, initial_data: [], index: 0})` → `lastCreatedPage` → listener #2 opens it in current tab.
  - Else → `SidebarSectionsEvent.createRootViewInSection(name: '', viewSection: isCollabWorkspaceOn ? ViewSectionPB.Private : ViewSectionPB.Public, index: 0)` → `WorkspaceService.createView` → `FolderEventCreateView(CreateViewPayloadPB{parent_view_id: workspaceId, name: '', layout: Document, section, index: 0})` (no `set_as_current`) → `lastCreatedRootView` → listener #1 opens it.
  - Page is created at index 0 (top) of the current space / section; name empty (displayed with untitled placeholder; see 2C).

### 2A.13 Jira entry (sidebar.dart, this checkout only)

- See 2A.2 #5 for visuals. `onPressed` → `getIt<TabsBloc>().add(TabsEvent.openPlugin(plugin: LocalToolPlugin(toolId: 'jira', title: 'Jira', user: widget.userProfile, page: (user) => JiraDashboardPage(user: user, repository: JiraRepository(store: JiraLocalStore(userId: user.id.toString()), credentialStore: WindowsJiraCredentialStore())))))`.
- Not role-gated (visible to Guests), not localized, visible in both folder and space modes.

### 2A.14 Banners above footer

#### `SpaceMigration` (space/space_migration.dart)
- Placement only (content in part 2B): shown when `SpaceBloc.state.shouldShowUpgradeDialog && isCollabWorkspaceOn`, padding left/right 12, top 8.

#### `SidebarUpgradeApplicationButton` (footer/sidebar_upgrade_application_button.dart) — dead in this checkout
- `Container(padding 12, radius 16, bg light #EBE4FFB2 / dark #39275BB2)` → `Column(start)[ Row[ FlowySvg(sidebar_upgrade_version_s, blendMode null), HSpace 6, FlowyText.medium(LocaleKeys.autoUpdate_bannerUpdateTitle, 14, lh 18), Spacer, FlowyButton(useIntrinsicWidth, FlowySvg(upgrade_close_s)) → mute for app lifetime ], VSpace 2, Opacity 0.7 FlowyText(autoUpdate_bannerUpdateDescription, 13, lh 16), VSpace 10, pill button (padding h10 v6, bg #A44AFD, radius 9, FlowyText.medium(autoUpdate_settingsUpdateButton, white, 12, lh 15)) → versionChecker.checkForUpdate() ]`.
- Electron: omit or keep behind `isUpdateAvailable=false`.

### 2A.15 Footer (footer/sidebar_footer.dart — MODIFIED)

`SidebarFooter({required UserProfilePB user})` → `Column`:
1. `if (FeatureFlag.planBilling.isOn) BillingGateGuard(builder: SidebarToast())` — **never rendered**: `planBilling.isOn` is forced `false` in this checkout (`shared/feature_flags.dart`). (`SidebarToast` = storage/AI-limit upgrade toast driven by `SidebarPlanBloc`; keys `sideBar_upgradeToPro`, `sideBar_upgradeToAIMax`, `sideBar_storageLimitDialogTitle`, `sideBar_aiResponseLimitTitle` … — skip in Electron.)
2. `Row[ Expanded(SidebarTemplateButton(user)), vertical divider, Expanded(SidebarTrashButton()) ]`.
   - Vertical divider: `Container(width 1, height 14, margin h 4, color AFThemeExtension.borderColor)`.

`SidebarFooterButton` (footer/sidebar_footer_button.dart): `SizedBox(height: 32 = HomeSizes.workspaceSectionHeight)` → `FlowyButton(leftIcon, leftIconSize, margin: all 4, expandText: false, text: Padding(right 6, FlowyText(text, fontWeight w400, figmaLineHeight 18)))` — content left-aligned within each half (Row mainAxisAlignment center but `mainAxisSize: min` + parent Expanded → AMBIGUOUS: Flutter Row min-size inside FlowyHover container renders left-aligned; verify against screenshot). Hover bg `colorScheme.secondary`, radius 6, spans the full half width.

| Button | Icon | Icon size | Label | Action |
|---|---|---|---|---|
| Templates (`SidebarTemplateButton`) | `FlowySvgs.icon_template_s` | 16×16 | `LocaleKeys.template_label` ("Templates") | **Changed in this checkout**: was `afLaunchUrlString('https://appflowy.com/templates')`; now `getIt<TabsBloc>().add(TabsEvent.openPlugin(plugin: LocalToolPlugin(toolId: 'templates', title: 'Templates', user, page: (u) => LocalTemplateStorePage(user: u))))` |
| Trash (`SidebarTrashButton`) | `FlowySvgs.icon_delete_s` | 18×18 | `LocaleKeys.trash_text` ("Trash") | `getIt<MenuSharedState>().latestOpenView = null` (clears tree selection highlight) → `TabsEvent.openPlugin(plugin: makePlugin(pluginType: PluginType.trash))`. Rebuilds on `MenuSharedState.notifier` (no visual change). |

Unused: `SidebarWidgetButton` (`FlowySvgs.sidebar_footer_widget_s`, no-op), `SliderMenuHoverTrigger` (50px black container — instantiated in desktop_home_screen; see part 1).

`MenuSharedState` (workspace/presentation/home/menu/menu_shared_state.dart, `getIt` singleton): `ValueNotifier<ViewPB?> latestOpenView`; setter ignores same id. Used by the tree for selection highlight.

---

### 2A.16 `LocalToolPlugin` (features/local_tools/local_tool_plugin.dart — NEW in this checkout)

```
class LocalToolPlugin extends Plugin {
  toolId, title, page: Widget Function(UserProfilePB), user
  id         => 'local-tool:$toolId'      // 'local-tool:jira', 'local-tool:templates'
  pluginType => PluginType.blank
  widgetBuilder => _ToolBuilder(title, page(user))   // page widget built on each getter access
}
_ToolBuilder extends PluginWidgetBuilder:
  viewName        => title
  leftBarItem     => FlowyText.medium(title)      // top bar / breadcrumb area: plain title, no icon, no actions
  tabBarItem(...) => leftBarItem                  // tab label: plain title
  contentPadding  => EdgeInsets.zero
  action          => (_) {}  ; navigationItems => [this]
  buildWidget(...) => page
```
- No `notifier` (no ViewPB), so: no favorite/share/more buttons in the view header, not reflected in sidebar selection.
- Tab behaviour (`TabsState.openPlugin`): if any open tab already has plugin id `local-tool:<id>` → that tab is selected; otherwise the tool **replaces the plugin in the current tab**. Opening the same id twice within 500 ms is ignored (TabsBloc dedup).
- `home_stack.dart` changes (MODIFIED) relevant here:
  - `PageNotifier.setPlugin`: `FolderEventSetLatestView(ViewIdPB{value: plugin.id})` is sent only if `setLatest && id.isNotEmpty && pluginType != PluginType.blank` → local tools never become the workspace "latest view".
  - `PageManager` renders `BlankPage` only when `notifier.plugin is BlankPagePlugin` (previously any `pluginType == blank`), so `LocalToolPlugin` renders its own widget.
- QUIRK (AMBIGUOUS): `desktop_home_screen.dart` HomeBloc listener re-opens `latestView` when `currentPageManager.plugin.pluginType == PluginType.blank`; since local tools report `blank`, a `latestView` change (FolderNotification `DidUpdateWorkspaceSetting`) while a local tool is the current tab replaces it with that view. Other code paths that test `pluginType == blank` (tab persistence/close logic, part 3) will also treat local tools as blank.
- Electron: implement as an internal plugin type `local-tool` with stable ids `local-tool:jira` / `local-tool:templates`, rendered full-bleed (zero padding), title-only tab/header.

### 2A.17 Local template store (features/local_templates/** — NEW)

- Entry: `LocalTemplateStorePage(user)`; data from bundled assets `assets/local_templates/manifest.json` (+ payloads, media; `AssetLocalTemplateSource(root: 'assets/local_templates')`). Offline only. Doc: `../doc/local-templates.md`.
- Bloc: `LocalTemplateStoreCubit(repository, importer, userId, resolveParentViewId: _currentWorkspaceId)..load()`; `_currentWorkspaceId` = `FolderEventReadCurrentWorkspace().id`.
- UI (`Scaffold` body; strings are hard-coded English, not LocaleKeys):
  - loading → centered `CircularProgressIndicator`; failure → centered `FlowyText.regular(message ?? 'Could not load templates.')` (load error message: `'Could not read the bundled template store.'`).
  - ready → `Padding(24)` → `Column(start)`: `FlowyText.semibold('Template store', fontSize 20)`, `SizedBox(4)`, `FlowyText.regular('{availableCount} of {catalogCount} templates downloaded ({documentCount} documents, {databaseCount} databases). Works offline.', color: hintColor)`, `SizedBox(16)`, `FlowyTextField(hintText: 'Search templates', onChanged: cubit.search)`, `SizedBox(12)`, category chips `Wrap(spacing 8, runSpacing 8)` [`All` + each `category.name`; chip = `FlowyButton(useIntrinsicWidth, isSelected, radius 16, margin h12 v6, FlowyText.regular(label))`], `SizedBox(16)`, `Expanded(` empty → `'No templates match.'` else `GridView(maxCrossAxisExtent 320, mainAxisExtent 270, spacing 16/16, padding bottom 24)` of `LocalTemplateCard(entry, importing, onImport, loadPreviewImage)` `)`.
  - Card shows preview image, kind label `'Document' | 'Database' | 'Unavailable'`, name, `'Import'` button (busy while importing). Semantics label `'Preview of {name}…'`.
  - Snackbars (Material `ScaffoldMessenger`): success `'Imported "{name}".'`; failure `'Could not import "{name}".'`.
- Import (`LocalTemplateImporter.importTemplate`, data/local_template_import_service.dart), `parentViewId = current workspace id` (top level of the workspace, same as non-space root views — AMBIGUOUS in Space mode: a workspace-root child is a sibling of spaces; verify how it appears):
  - Document → `FolderEventImportData(ImportPayloadPB{parent_view_id, items: [ImportItemPayloadPB{name, data: DocumentDataPB bytes, view_layout: Document, import_type: Markdown}]})`.
  - Database → `FolderEventCreateView(CreateViewPayloadPB{parent_view_id, name, layout: <db layout>, set_as_current: false, initial_data: DatabaseData JSON bytes})`; then per row page `DocumentEventCreateDocument(CreateDocumentPayloadPB{document_id, initial_data: DocumentDataPB})` and `DatabaseEventUpdateRowMeta(UpdateRowMetaChangesetPB{view_id, id: rowId, is_document_empty: false})`.
  - Media copied to the user data folder before import (`saveLocalTemplateMedia`); remote URLs rejected.
  - Imported page is NOT auto-opened; it appears in the tree via folder notifications.

### 2A.18 Jira dashboard entry (features/jira/** + features/local_tools/jira_windows_credentials.dart — NEW)

- `JiraDashboardPage(user, repository?, databaseMapper?)` → `BlocProvider(JiraBloc(repository, databaseMapper: JiraDatabaseMapper(gateway: BackendJiraDatabaseGateway()))..add(JiraStarted()))` → `ColoredBox(surfaceColorScheme.primary)` → `Padding(h xxl 20, v xl 16)` → `Column(stretch, spacing l 12)[ _Header ('Jira' / 'Jira · {projectKey}', subtitle '{host} · synced {relative}', Sync button 'Sync' / 'Syncing {n}/{total}…'), banners (error / last-sync-failed warning / success / 'Connect to sync' info with 'Enter token'), unconfigured → _EmptyState, else _StatsRow + _Body (issue list) ]`. Loading → centered spinner. Strings hard-coded English.
- Storage: `JiraLocalStore(userId)` on `DartKeyValue` (shared_preferences) keys `appflowy.jira.<userId>.config` (JiraConfig JSON) and `appflowy.jira.<userId>.cache` (snapshot, discarded if `scopeId` ≠ config scope).
- Credentials (`WindowsJiraCredentialStore`): file `<ApplicationSupportDirectory>/jira_credentials/<uuid v5(URL namespace, accountId)>.json` = `{"username": ..., "protected_secret": base64(CryptProtectData(utf8(secret), flags=1 /*UI_FORBIDDEN*/))}` (current-user DPAPI, no entropy; written via `.tmp` + rename). Non-Windows → in-memory `SessionJiraCredentialStore`. Unreadable/foreign file → treated as missing (re-entry).
- Can mirror issues into an AppFlowy database via `FieldBackendService.createField`, `DatabaseEventCreateRow`, `DatabaseViewBackendService.openDatabase` (details in Jira doc `../doc/jira-integration.md`; out of scope here).

### 2A.19 Import panel (sidebar/import/** — opened from the page "+" menu, part 2C)

- `showImportPanel(parentViewId, context, callback)` → `FlowyOverlay.show(FlowyDialog(bg: colorScheme.surface, title: FlowyText.semibold(LocaleKeys.moreAction_import /*"Import"*/, fontSize 20, color: tertiary), child: Padding(v 10, h 20, ImportPanel)))`.
- `ImportPanel`: `KeyboardListener(autofocus)`; Esc → close. `FlowyContainer(surface, width = windowWidth × 0.7, height = width × 0.5)` → `GridView.count(crossAxisCount 2, childAspectRatio 5 (1/.2))` of `Card(FlowyButton(leftIcon: type.icon (tint tertiary), leftIconSize 20, text: FlowyText.medium(label, fontSize 15, ellipsis, color tertiary)))`; loading overlay = centered `CircularProgressIndicator`.
- `ImportType` (import_type.dart) — only `enableOnRelease` types shown in release builds:

| ImportType | Label key (en) | Icon (sic) | Extensions | Release | Payload item |
|---|---|---|---|---|---|
| historyDocument | `importPanel_documentFromV010` ("Document from v0.1.0") | `board_s` | `afdoc` | debug only | migrated doc → DocumentDataPB bytes, layout Document, `ImportTypePB.Markdown` |
| historyDatabase | `importPanel_databaseFromV010` ("Database from v0.1.0") | `document_s` | `afdb` | debug only | utf8 text, layout Grid, `HistoryDatabase` |
| markdownOrText | `importPanel_textAndMarkdown` ("Text & Markdown") | `text_s` | `md`, `txt` | yes | `customMarkdownToDocument` → DocumentDataPB bytes, layout Document, `Markdown` |
| csv | `importPanel_csv` ("CSV") | `board_s` | `csv` | yes | utf8 text, layout Grid, `CSV` |
| afDatabase | `importPanel_database` ("Database") | `board_s` | `afdb` | debug only | utf8 text, layout Grid, `AFDatabase` |

- All allow multi-select. Item `name` = file basename without extension. Sends one `FolderEventImportData(ImportPayloadPB{parent_view_id, items})`, then `callback(type, '', null)` and closes the overlay. Errors are not surfaced.

---

### 2A.20 Other blocs instantiated by this part

| Bloc | Created in | Init | Backend |
|---|---|---|---|
| `SidebarPlanBloc` | `HomeSideBar` | `init(workspaceSetting.workspaceId, userProfile)`; `changedWorkspace(id)` on switch | `UserEventGetWorkspaceUsage(UserWorkspaceIdPB)`; listens `SubscriptionSuccessListenable`, storage notifications, `GlobalErrorCodeNotifier` (`AIResponseLimitExceeded`, `FileStorageLimitExceeded`). Only consumer (`SidebarToast`) is disabled → Electron may skip entirely. |
| `MenuUserBloc` | `SidebarUser` | none dispatched (see 2A.5.2) | (would be `UserListener` + `initUser`) |
| `WorkspaceMemberBloc` | each `WorkspaceMenuItem` | `initial()` | `UserEventGetWorkspaceMembers(QueryWorkspacePB)`, invite code fetch, subscription info if owner |
| `PasswordBloc` | `UserSettingButton` | `init()`, `checkHasPassword()` | see settings doc |
| `ReminderBloc` (global `getIt`) | started by `NotificationButton.initState` and on each `openWorkspace` | `started → refresh` | `UserEventGetAllReminders`, `FolderEventGetAllViews` |
| `LocalTemplateStoreCubit` | `LocalTemplateStorePage` | `load()` | see 2A.17 |
| `JiraBloc` | `JiraDashboardPage` | `JiraStarted()` | Jira HTTP + database events |

### 2A.21 Keyboard shortcuts owned by this part

| Shortcut (Win/Linux) | macOS | Action | Defined in |
|---|---|---|---|
| `Ctrl+\` or `Ctrl+.` | `⌘+\` or `⌘+.` | toggle sidebar (`colappsedMenus` → `HomeSettingBloc.collapseMenu`); tooltip shows `Ctrl+\` (Win/Linux) / `⌘+.` (macOS) | `hotkeys.dart` (part 1) |
| `Ctrl+P` | `⌘+P` | toggle command palette | `command_palette.dart` |
| `Ctrl+N` | `⌘+N` | new page (`createNewPageNotifier++` → `SidebarNewPageButton._createNewPage`) | `hotkeys.dart` |
| `Ctrl+,` | `⌘+,` | open settings / close if open | `sidebar_setting.dart` `openSettingsHotKey` |

### 2A.22 i18n keys used in this part (en-US values)

| Key (`LocaleKeys.x`) | en-US |
|---|---|
| `sideBar_closeSidebar` | Close sidebar |
| `search_sidebarSearchIcon` | Search and quickly jump to a page |
| `search_label` | Search |
| `newPageText` | New page |
| `template_label` | Templates |
| `trash_text` | Trash |
| `settings_menu_open` | Open Settings |
| `defaultUsername` | Me |
| `workspace_create` | Create workspace |
| `workspace_createSuccess` / `_createFailed` | Workspace created successfully / Failed to create workspace |
| `workspace_createLimitExceeded` | You've reached the maximum workspace limit allowed for your account. If you need additional workspaces to continue your work, please request on Github |
| `workspace_deleteSuccess` / `_deleteFailed` | Workspace deleted successfully / Failed to delete workspace |
| `workspace_openSuccess` / `_openFailed` | Opened workspace successfully / Failed to open workspace |
| `workspace_updateIconSuccess` / `_updateIconFailed` | Updated workspace icon successfully / Updated workspace icon failed |
| `workspace_renameSuccess` / `_renameFailed` | Workspace renamed successfully / Failed to rename workspace |
| `workspace_cannotDeleteTheOnlyWorkspace` | Cannot delete the only workspace |
| `workspace_deleteWorkspaceHintText` | Are you sure you want to delete the workspace? This action cannot be undone, and any pages you have published will be unpublished. |
| `workspace_renameWorkspace` | Rename workspace |
| `workspace_leaveCurrentWorkspace` | Leave workspace |
| `workspace_leaveCurrentWorkspacePrompt` | Are you sure you want to leave the current workspace? |
| `workspace_importFromNotion` | Import from Notion |
| `workspace_learnMore` | Learn more |
| `space_deleteConfirmation` | Delete:  (prefix + workspace name) |
| `button_logout` / `button_delete` / `button_rename` / `button_yes` / `button_ok` | Log out / Delete / Rename / Yes / Ok |
| `document_plugins_cover_changeIcon` | Change icon |
| `settings_appearance_members_membersCount` (plural) | zero "{} members", one "{} member", other "{} members" |
| `shareTab_guest` | Guest |
| `settings_common_uploadingFile` | File is uploading. Please do not quit the app |
| `settings_common_uploadNotionSuccess` | Your Notion zip file has been uploaded successfully. Once the import is complete, you will receive a confirmation email |
| `moreAction_import` | Import |
| `importPanel_documentFromV010` / `_databaseFromV010` / `_textAndMarkdown` / `_csv` / `_database` | Document from v0.1.0 / Database from v0.1.0 / Text & Markdown / CSV / Database |
| `autoUpdate_bannerUpdateTitle` / `_bannerUpdateDescription` / `_settingsUpdateButton` | New Version Available! / Get the latest features and fixes. Click "Update" to install now / Update |
| `settings_workspacePage_workspaceIcon_title` | Workspace icon (mobile picker title only) |

Hard-coded (non-i18n) strings added by this checkout: `'Jira'`, `'Templates'` (tab/plugin title), template store and Jira page strings listed in 2A.17/2A.18.

### 2A.23 Quirks / AMBIGUOUS summary

1. Header branch depends on `userAuthType == Server`: local-only users see `SidebarUser` (no workspace switcher); self-hosted cloud users see `SidebarWorkspace`.
2. Collapse button hit-tests while invisible and fires on pointer-down.
3. `UserWorkspaceBloc` listener in `HomeSideBar` has no `listenWhen` → repeated reload/reset; implement idempotently.
4. `SpaceBloc` listener reopens `lastCreatedPage` (or Blank) whenever `isDuplicatingSpace` toggles.
5. Notification-action open runs twice when switching space (dedup 500 ms in TabsBloc).
6. `SidebarUser` does not live-update (MenuUserBloc never initialized).
7. Jira button is a Material `TextButton` (primary color, centered) — visually unlike other sidebar rows; replicate as-is for parity.
8. `LocalToolPlugin.pluginType == blank` → may be replaced by HomeBloc latest-view auto-open; never saved as latest view.
9. Template import parent = workspace id (root), not current space.
10. Upgrade-app banner and `SidebarToast` are unreachable in this checkout (no auto-update task, `planBilling` forced off).
11. `ImportType.icon` mapping looks swapped (historyDatabase → document icon, historyDocument → board icon) — replicate or fix knowingly.
12. Footer button content alignment within each `Expanded` half — verify visually (see 2A.15).

---

## 2B. Sidebar sections: Favorites, Shared, Spaces, legacy Workspace/Private/Personal folders

All paths relative to `appflowy_flutter/lib`. "2C" = the page-tree item spec (`menu/view/**`, `ViewBloc`) documented elsewhere; this part only covers how sections feed it.

### 2B.1 Which section layout renders (decision tree)

Source: `workspace/presentation/home/menu/sidebar/sidebar.dart` → `_SidebarState._renderFolderOrSpace()`.

| Condition (evaluated in order) | Rendered widget |
|---|---|
| `SpaceBloc.state.isInitialized == false` | nothing (`SizedBox.shrink`) |
| `SidebarSectionsState.containsSpace && SpaceState.spaces.isEmpty` | side effect in build: dispatch `SpaceEvent.didReceiveSpaceUpdate()` (then continues below) |
| `!containsSpace` OR `spaces.isEmpty` OR `!UserWorkspaceState.isCollabWorkspaceOn` | **legacy mode** → `SidebarFolder` (`menu/sidebar/shared/sidebar_folder.dart`) |
| otherwise | **space mode** → `SidebarSpace` (`menu/sidebar/space/sidebar_space.dart`) |

- `isCollabWorkspaceOn = userProfile.userAuthType == AuthTypePB.Server && FeatureFlag.collaborativeWorkspace.isOn` (`features/workspace/logic/workspace_bloc.dart` ~L571). `collaborativeWorkspace` is hard-on in `shared/feature_flags.dart`, so effectively: **cloud/self-hosted server login = space mode (if spaces exist); local login = legacy mode**.
- Local default workspace (Rust `flowy-core/src/deps_resolve/folder_deps/folder_deps_doc_impl.rs::create_workspace_view`) contains only a root document "Getting started" (icon `⭐️`), no space → legacy "Personal" section. Server workspaces get spaces from AppFlowy Cloud. AMBIGUOUS: exact default spaces created server-side are not in this repo.
- Both containers are wrapped by the sidebar in: `Expanded > Padding(menuHorizontalInset - EdgeInsets.only(right: 6))` = left 8 / right 2, then `SingleChildScrollView(padding: right 6, physics: ClampingScrollPhysics, controller: _scrollController)`. Space mode additionally wraps in `FlowyScrollbar(controller)`; legacy mode has no visible scrollbar widget.
- `isHoverEnabled: !_isScrolling` is passed down (hover disabled while scrolling; `_isScrolling` resets 300 ms after last scroll offset change).
- Both containers are rebuilt on every `getIt<MenuSharedState>().notifier` change (`ValueListenableBuilder`) — i.e. whenever the latest opened view changes (selection highlight).

### 2B.2 Vertical composition

**Legacy (`SidebarFolder.build`)**
1. `VSpace(4)`
2. Favorites: `BlocBuilder<FavoriteBloc>` → if `state.views.isEmpty` nothing, else `FavoriteFolder(views: state.views.map((e) => e.item))`.
3. `BlocBuilder<SidebarSectionsBloc>`:
   - if `isCollabWorkspaceOn`: `VSpace(16)`, `PublicSectionFolder(views: section.publicViews)`, `VSpace(16)`, `PrivateSectionFolder(views: section.privateViews)`.
   - else: `VSpace(16)`, `PersonalSectionFolder(views: section.publicViews)` (private views are NOT shown in local mode).
4. `VSpace(200)` (bottom scroll slack).

| Class | title (i18n → en) | `spaceType` | expand tooltip (unused, see 2B.4) | add tooltip |
|---|---|---|---|---|
| `PublicSectionFolder` | `LocaleKeys.sideBar_workspace` → "Workspace" | `FolderSpaceType.public` | `sideBar_clickToHideWorkspace` | `sideBar_addAPageToWorkspace` → "Add a page to workspace" |
| `PrivateSectionFolder` | `sideBar_private` → "Private" | `FolderSpaceType.private` | `sideBar_clickToHidePrivate` | `sideBar_addAPageToPrivate` → "Add a page to private space" |
| `PersonalSectionFolder` | `sideBar_personal` → "Personal" | `FolderSpaceType.public` | `sideBar_clickToHidePersonal` | `sideBar_addAPage` → "Add a new page" |

**Space mode (`SidebarSpace.build`)** — provides `Provider.value(value: userProfile)` (consumed by `SpaceMorePopup` for creator check).
1. `VSpace(4)`
2. Favorites: if `FavoriteState.views` non-empty → `Padding(bottom: 16) > FavoriteFolder(...)`.
3. If `FeatureFlag.sharedSection.isOn` → `SharedSection(key: ValueKey(workspaceId), workspaceId)` (it appends its own `VSpace(16)` at the end). Flag default **false** (only on if toggled in KV `featureFlag`).
4. If `currentWorkspace.role ∈ {AFRolePB.Member, AFRolePB.Owner}` → `_Space()` (Guests see no spaces).
5. `VSpace(200)`.

`FolderSpaceType` enum (`workspace/application/sidebar/folder/folder_bloc.dart`): `favorite, private, public, unknown`; `toViewSectionPB`: private→`ViewSectionPB.Private(0)`, public→`ViewSectionPB.Public(1)`, others throw.

### 2B.3 Data loading on home load (sections only)

Created in `sidebar.dart` `MultiBlocProvider` (inside a `BlocConsumer<UserWorkspaceBloc>` whose `buildWhen` = workspaceId changed; the `MultiBlocProvider` is not keyed, so the bloc instances are **kept** across workspace switches and are re-pointed via `SpaceEvent.reset` / `SidebarSectionsEvent.reload` — see 2A.1 listener #4):

| Order | Bloc | Init event | Backend calls (in order) | Listener |
|---|---|---|---|---|
| (home screen) | `FavoriteBloc` (created in `desktop_home_screen.dart`, survives workspace switch) | `FavoriteEvent.initial()` | `FolderEventReadFavorites()` → `RepeatedFavoriteViewPB` | `FavoriteListener` (RustStream, parser id `"favorite"`) |
| 1 | `SidebarSectionsBloc` | `SidebarSectionsEvent.initial(userProfile, workspaceId)` | `FolderEventReadWorkspaceViews(GetWorkspaceViewPB{value: workspaceId})` → `RepeatedViewPB` (public); `FolderEventReadPrivateViews(GetWorkspaceViewPB{value: workspaceId})` → `RepeatedViewPB` (private) | `WorkspaceSectionsListener` (objectId = workspaceId) |
| 2 | `SpaceBloc(userProfile, workspaceId)` | `SpaceEvent.initial(openFirstPage: false)` | same two reads (again); KV `lastOpenedSpaceId`; KV `expandedViews` | `WorkspaceSectionsListener` (second instance) |
| per section | `FolderBloc(type)` | `FolderEvent.initial()` | KV `expandedViews` | – |
| space pages | `ViewBloc(view: currentSpace)` (inside `SpacePages`) | `ViewEvent.initial()` | `FolderEventGetView(ViewIdPB{value: space.id})` (child views) — see 2C | `ViewListener(space.id)` |
| shared | `SharedSectionBloc` (only if flag) | `SharedSectionInitEvent` | `FolderEventGetSharedViews()` → `RepeatedSharedViewResponsePB`; then every 30 s | `FolderNotificationListener(objectId: workspaceId)` |

Notifications consumed by this part:

| `FolderNotification` (value) | objectId (subject id) | Payload | Consumer → action |
|---|---|---|---|
| `DidUpdateSectionViews` (39) | workspaceId | `SectionViewsPB{section: ViewSectionPB, views: [ViewPB]}` — Rust `notify_did_update_section_views` sends TWO notifications back-to-back (Public then Private) whenever a direct child of the workspace changes (`notify_parent_view_did_change` with parent == workspace) | `SidebarSectionsBloc` → `receiveSectionViewsUpdate(pb)` replaces `publicViews` or `privateViews`; `SpaceBloc` → `didReceiveSpaceUpdate()` (full re-read of both lists) |
| `DidFavoriteView` (36) | `"favorite"` | `RepeatedViewPB` | `FavoriteBloc` → `fetchFavorites` (ignored while `isReordering`) |
| `DidUnfavoriteView` (37) | `"favorite"` | `RepeatedViewPB` | same |
| `DidUpdateSharedViews` (40) | workspaceId | `RepeatedSharedViewResponsePB{shared_views: [SharedViewPB{view, access_level}]}` | `SharedSectionBloc` → `updateSharedPages` |
| `DidUpdateView` (10) / `DidUpdateChildViews` (11) | space id | `ViewPB` / `ChildViewUpdatePB{parent_view_id, create_child_views, delete_child_views, update_child_views}` | `ViewBloc` inside `SpacePages` (2C) |

Electron note: `FolderNotificationListener(objectId)` = filter Rust stream `SubscribeObject` by `source == "Workspace"` (FOLDER_OBSERVABLE_SOURCE) and `id == objectId`, then parse `ty` as `FolderNotification`.

### 2B.4 Persisted keys (KeyValueStorage = SharedPreferences; Electron: any string KV)

| Key (`core/config/kv_keys.dart`) | Value | Writer / reader |
|---|---|---|
| `expandedViews` | JSON object `{ "<id or folder type name>": true }` shared by FolderBloc (keys `"favorite"`, `"public"`, `"private"`), SpaceBloc (key = space view id), TabsBloc & ViewBloc (view ids) | `FolderBloc._set/_getFolderExpandStatus`, `SpaceBloc._set/_getSpaceExpandStatus` |
| `lastOpenedSpaceId` | space view id string | `SpaceBloc._openSpace` writes on every `SpaceEvent.open`; `_getLastOpenedSpace` reads (fallback `spaces.first`) |
| `featureFlag` | JSON `{flagName: bool}` | `FeatureFlag` (enables `sharedSection`) |

- Expand semantics: collapse → **key removed**; read → `map[key] ?? true`. BUG-COMPAT: because missing == expanded, collapsed state of Favorites / Workspace / Private / Personal / spaces is NOT restored after restart (everything reopens expanded). Replicate (or deliberately fix; document the deviation).
- `KVKeys.lastOpenedSpace`, `spaceOrder`, `hasUpgradedSpace` ("hasUpgradedSpace060"), `expandedFolders` are not used on desktop.

### 2B.5 Legacy section folder (`folder/_section_folder.dart`, `folder/_folder_header.dart`)

`SectionFolder` (StatefulWidget; params `title, spaceType, views, isHoverEnabled=true, expandButtonTooltip, addButtonTooltip`):
- `MouseRegion` over whole section → `isHovered: ValueNotifier<bool>` (passed to every root `ViewItem`; controls arrow / action visibility, 2C).
- `BlocProvider<FolderBloc>(FolderBloc(type: spaceType)..add(FolderEvent.initial()))`.
- Column: `FolderHeader`, `VSpace(4)`, views (only if `isExpanded`), placeholder (only if `views.isEmpty`, regardless of expansion).

`FolderHeader` visuals:
| Element | Spec |
|---|---|
| Container | `SizedBox(height: HomeSizes.workspaceSectionHeight = 32)` |
| Button | `FlowyButton(margin: EdgeInsets.only(left: 6, right: 4), iconPadding: 10)`; FlowyButton defaults: hover bg `Theme.colorScheme.secondary`, radius `Corners.s6Border` (6), cursor click |
| Text | `Row[FlowyText(title, lineHeight: 1.15)` (default size = `textTheme.bodyMedium` 14, regular), `HSpace(4)`, `FlowySvg(isExpanded ? FlowySvgs.workspace_drop_down_menu_show_s : FlowySvgs.workspace_drop_down_menu_hide_s)]` |
| Right icon | `Opacity(hovered ? 1 : 0)` > `FlowyIconButton(width: 24, iconPadding: EdgeInsets.all(4), tooltipText: addButtonTooltip, icon: FlowySvg(FlowySvgs.view_item_add_s))` — hover tracked by the header's own `MouseRegion`, not the section's |
| `expandButtonTooltip` | accepted but **never rendered** (no tooltip on the title) |

Actions:
- Tap title row → `FolderEvent.expandOrUnExpand()` (toggle; persists, see 2B.4).
- Tap `+` → `SidebarSectionsEvent.createRootViewInSection(name: '', index: 0, viewSection: spaceType.toViewSectionPB)` then `FolderEvent.expandOrUnExpand(isExpanded: true)`.
  - Backend: `FolderEventCreateView(CreateViewPayloadPB{parent_view_id: workspaceId, name: '', layout: ViewLayoutPB.Document, section: <Public|Private>, index: 0})` (`set_as_current` left default false; no `extra`, no `view_id`).
  - Success → state `lastCreatedRootView = view`, `createRootViewResult = success` → `sidebar.dart` `BlocListener` (listenWhen `lastCreatedRootView.id` changed) → `TabsBloc.add(TabsEvent.openPlugin(plugin: view.plugin()))`. Failure → only logged (no toast).
  - Tree update arrives via `DidUpdateSectionViews`.

Root rows: `ViewItem(key: ValueKey('${spaceType.name} ${view.id}'), spaceType, engagedInExpanding: true, isFirstChild: view.id == views.first.id, view, level: 0, leftPadding: HomeSpaceViewSizes.leftPadding (16), isFeedback: false, isHovered, enableRightClickContext: true, isHoverEnabled, onSelected, onTertiarySelected)`.
- `onSelected(viewContext, view)`: if `HardwareKeyboard.instance.isControlPressed` → `TabsBloc.openTab(view)`; then ALWAYS `TabsBloc.openPlugin(view)` (both run on Ctrl+click; net effect = one new foreground tab, see §3.2).
- `onTertiarySelected` (middle click) → `TabsBloc.openTab(view)`.

Empty-section drop target: `ViewItem(spaceType, view: ViewPB(parentViewId: currentWorkspace.workspaceId), level: 0, leftPadding: 16, isFeedback: false, onSelected: noop, isHoverEnabled, isPlaceholder: true)` → renders `SizedBox(height: 4, width: ∞)` that accepts drops (move-to-section DnD, 2C).

`SidebarSectionsBloc` (`workspace/application/menu/sidebar_sections_bloc.dart`):
| Event | Behaviour |
|---|---|
| `initial(userProfile, workspaceId)` | create `WorkspaceService`, start listener, read public+private → emit `section`, `containsSpace` |
| `reset(userProfile, workspaceId)` | stop listener, re-init, re-read |
| `reload(userProfile, workspaceId)` | re-init + re-read, then open first `publicViews[0]` else `privateViews[0]` else `makePlugin(pluginType: PluginType.blank)` via `getIt<TabsBloc>()` `TabsEvent.openPlugin` |
| `createRootViewInSection(name, viewSection, index?)` | see above |
| `moveRootView(fromIndex, toIndex, fromSection, toSection)` | `FolderEventMoveView(MoveViewPayloadPB{view_id, from, to})`; optimistic reorder. Not dispatched anywhere on desktop (DnD uses `ViewBloc` move, 2C) |
| `receiveSectionViewsUpdate(SectionViewsPB)` | replace list for that section; `containsSpace ||= views.any(isSpace)` (never flips back to false) |

State: `section: SidebarSection{publicViews, privateViews}` (`views` getter = public+private), `lastCreatedRootView: ViewPB?`, `createRootViewResult`, `containsSpace` (default **true** before first load). Helper `getViewSection(view)` → Public/Private/null by id membership.

### 2B.6 Favorites (`menu/sidebar/favorites/**`, `workspace/application/favorite/**`)

#### FavoriteBloc (`favorite_bloc.dart`) — provided at home-screen level
State: `views: [SectionViewPB]` (all favorites), `pinnedViews`, `unpinnedViews` (split by `view.item.isPinned`), `isLoading=true`.
`SectionViewPB{item: ViewPB, timestamp: i64 /*seconds, favorite time*/}`; `RepeatedFavoriteViewPB{items: [SectionViewPB]}`.

| Event | Backend / logic |
|---|---|
| `initial()` | start `FavoriteListener`; add `fetchFavorites` |
| `fetchFavorites()` | `FavoriteService.readFavorites()` = `FolderEventReadFavorites()` then **filter out spaces** (`!item.isSpace`); keep backend order; split pinned/unpinned; on error `views: []` |
| `toggle(view)` | if already favorited → `unpinFavorite(view)` (extra `is_pinned:false`); else if `pinnedViews.length < 3` → `pinFavorite(view)` (auto-pin first 3); then `FolderEventToggleFavorite(RepeatedViewIdPB{items:[view.id]})`. Refresh comes from `DidFavoriteView`/`DidUnfavoriteView` |
| `pin(view)` / `unpin(view)` | `pinOrUnpinFavorite`: `extra = jsonEncode(mergeMaps(jsonDecode(view.extra or {}), {"is_pinned": bool}))` → `FolderEventUpdateView(UpdateViewPayloadPB{view_id, extra})`; then `fetchFavorites` (no limit on manual pinning) |
| `reorder(oldIndex, newIndex)` | Flutter ReorderableList index fix (`if old < new: new -= 1`); optimistic `pinnedViews` reorder; then for EACH pinned view in new order: `FolderEventToggleFavorite` twice (unfavorite+refavorite bumps the favorite timestamp → backend order). `isReordering=true` suppresses listener refetches; final `fetchFavorites`. Replicate exactly (it is the only ordering mechanism) |

Extra JSON key: `ViewExtKeys.isPinnedKey = "is_pinned"` (`view.isPinned` getter: `jsonDecode(extra)["is_pinned"] ?? false`, false on parse error).

#### FavoriteFolder (`favorite_folder.dart`)
- Hidden when `views` empty. `MouseRegion` → `isHovered`. `FolderBloc(type: FolderSpaceType.favorite)` → expand key `"favorite"`.
- Column: `FavoriteHeader(onPressed: toggle expand)`, pinned list (if expanded and `pinnedViews` non-empty), then if expanded: `VSpace(2)` + `FavoriteMoreButton`.
- Pinned list: 1 item → plain `buildViewItem`; ≥2 → `ReorderableListView.builder(shrinkWrap, buildDefaultDragHandles: false, padding: zero, NeverScrollableScrollPhysics)` with theme override `canvasColor/shadowColor: transparent`; each row `ReorderableDragStartListener(key: ValueKey(view.id))` (drag starts on immediate press-move, no long-press) → `onReorder` → `FavoriteEvent.reorder`.
- Pinned row = `ViewItem(key: ValueKey('favorite ${view.id}'), spaceType: favorite, isDraggable: false, isFirstChild: view.id == views.first.id /*first of ALL favorites*/, isFeedback: false, view, enableRightClickContext: true, leftPadding: 16, leftIconBuilder: (_, __) => HSpace(16) /*no expand arrow*/, level: 0, isHovered, shouldRenderChildren: false, shouldLoadChildViews: false, onTertiarySelected: openTab, onSelected: ctrl? openTab; openPlugin)`.
  - `rightIconsBuilder` → `[Listener(onPointerDown: ViewEvent.setIsEditing(true)) > FavoriteMoreActions(view), HSpace(8), Listener(onPointerDown: setIsEditing(true)) > FavoritePinAction(view), HSpace(4)]`.

`FavoriteHeader`:
| Prop | Value |
|---|---|
| Widget | `AFGhostIconTextButton.primary(text: LocaleKeys.sideBar_favorites.tr() /*"Favorites"*/, mainAxisAlignment: start, size: AFButtonSize.l, padding: EdgeInsets.symmetric(horizontal: 4, vertical: 6), borderRadius: AppFlowyTheme.borderRadius.s (6))` |
| Icon | `FlowySvg(FlowySvgs.favorite_header_m, blendMode: null)` (multicolor, original colors) |
| Icon↔text gap | `theme.spacing.m` = 8 |
| Text | `theme.textStyle.body.enhanced()` = 14px / line-height 20px / w500, color `textColorScheme.primary` |
| Hover bg | `fillColorScheme.contentHover` (default theme light `#1F23290D`, dark `#F9FAFD0D`), otherwise transparent |
| Expand indicator | none (no arrow, no `+`) |

`FavoriteMoreActions(view)` (`favorite_more_actions.dart`):
- `FlowyTooltip(message: LocaleKeys.menuAppHeader_moreButtonToolTip /*"Remove, rename, and more..."*/)` > `ViewMoreActionPopover(view, spaceType: FolderSpaceType.favorite, isExpanded: false, onEditing → ViewEvent.setIsEditing(v))`; trigger `FlowyIconButton(width: 24, icon: FlowySvg(FlowySvgs.workspace_three_dots_s))`.
- Action list for `spaceType == favorite` (from `view_more_action_button.dart::_buildActionTypes`): `unFavorite` ("disclosureAction_unfavorite", `FlowySvgs.unfavorite_s`), `divider`, `rename` (`disclosureAction_rename`, `view_item_rename_s`), `openInNewTab` (`disclosureAction_openNewTab`, `view_item_open_in_new_tab_s`).
- Handlers: `favorite|unFavorite` → `FavoriteBloc.add(FavoriteEvent.toggle(view))` + `PopoverContainer.maybeOf(context)?.closeAll()`; `rename` → `showAFTextFieldDialog(title: disclosureAction_rename "Rename", initialValue: view.nameOrDefault, maxLength: 256, onConfirm: ViewBackendService.updateView(viewId, name))` → `FolderEventUpdateView{view_id, name}` + closeAll; `openInNewTab` → `getIt<TabsBloc>().openTab(view)`; anything else throws `UnsupportedError`.

`FavoritePinAction(view)` (`favorite_pin_action.dart`):
| `view.isPinned` | tooltip | icon | tap |
|---|---|---|---|
| true | `favorite_removeFromSidebar` "Remove from sidebar" | `FlowySvgs.favorite_section_unpin_s` | `FavoriteEvent.unpin(view)` |
| false | `favorite_addToSidebar` "Pin to sidebar" | `FlowySvgs.favorite_section_pin_s` | `FavoriteEvent.pin(view)` |
Button: `FlowyIconButton(width: 24)`.

`FavoriteMoreButton` (the "More" row under pinned favorites):
- Rendered only if `unpinnedViews` non-empty.
- `AppFlowyPopover(constraints: BoxConstraints(minWidth: 260), margin: EdgeInsets.zero, direction: default PopoverDirection.rightWithTopAligned, trigger: click)`; popup gets `BlocProvider.value` of `FavoriteBloc` + `TabsBloc`, content `FavoriteMenu(minWidth: 260)`.
- Trigger: `FlowyButton(margin: EdgeInsets.symmetric(horizontal: 20, vertical: 7), leftIcon: FlowySvg(FlowySvgs.workspace_three_dots_s), text: FlowyText.regular(LocaleKeys.button_more /*"More"*/))` (leftIconSize 16, iconPadding 6 default).

`FavoriteMenu` (`favorite_menu.dart`, popover body):
- `Padding(all 10)`; own `FavoriteMenuBloc()..add(initial())`.
- Column: `VSpace(4)`, `SpaceSearchField(width: 260 - 2*10 = 240, onSearch → FavoriteMenuEvent.search(text))`, `VSpace(12)`, `_FavoriteGroups`.
- `_FavoriteGroups`: `Container(width: 240, constraints: maxHeight 300) > SingleChildScrollView > Column(crossAxis start)`.
  - Groups: Today (`sideBar_today` "Today"), This week (`sideBar_thisWeek` "This week"), Others (`sideBar_others` "Earlier favorites").
  - Group block = `[header FlowyText(title, fontSize: 12, color: Theme.hintColor), VSpace(2), rows, VSpace(8)]`, omitted when empty.
  - Separators: between Today and This week → `FlowyDivider()` + `VSpace(16)`; before Others (if Today or This week non-empty) → `FlowyDivider()` + `VSpace(16)`.
  - If only Others has items → Others rendered **without header**.
- Row = `ViewItem(key: ValueKey(id), view, spaceType: favorite, level: 0, isFeedback: false, isDraggable: false, shouldRenderChildren: false, leftIconBuilder: HSpace(4), extendBuilder: isPinned ? [HSpace(4), FlowySvg(FlowySvgs.favorite_pin_s, blendMode: null)] : [], rightIconsBuilder: [FavoriteMoreActions, HSpace(6), FavoritePinAction, HSpace(4)], onSelected: TabsBloc.openPlugin(view) + PopoverContainer.maybeOf(context)?.close())`. Note: lists ALL favorites (pinned too).

`FavoriteMenuBloc` (`favorite_menu_bloc.dart`):
- `initial`: one-shot `FolderEventReadFavorites` (space-filtered) → `_source`; bucket by `diff = now.difference(fromMillis(timestamp*1000)).inDays`: `0` → today, `<7` → thisWeek, else other.
- `search(query)`: case-insensitive `name.contains(query)` on every bucket; empty query restores.
- State: `views, queriedViews, todayViews, thisWeekViews, otherViews`.
- AMBIGUOUS/BUG-COMPAT: no notification listener — the open menu does not refresh after pin/unpin/unfavorite inside it (ViewPB objects are stale; pin icon state won't flip until reopened).

`FavoritePinBloc` (`favorite_pin_bloc.dart`): defined but **unused** anywhere — do not port.

### 2B.7 Shared section (`features/shared_section/**`, behind `FeatureFlag.sharedSection`, default OFF)

Data:
- Repository `RustSharePagesRepositoryImpl` (`data/repositories/rust_shared_pages_repository_impl.dart`):
  - `getSharedPages()` → `FolderEventGetSharedViews()` (no payload) → `RepeatedSharedViewResponsePB.shared_views[]` → `SharedPage{view: ViewPB (with all nested children), accessLevel: ShareAccessLevel}` (`AFAccessLevelPB`: `ReadOnly=0, ReadAndComment=1, ReadAndWrite=2, FullAccess=3` → `readOnly, readAndComment, readAndWrite, fullAccess`).
  - `leaveSharedPage(pageId)` → `UserEventGetUserProfile()` (email) → `FolderEventRemoveUserFromSharedPage(RemoveUserFromSharedPagePayloadPB{view_id, emails: [email]})`.
- `LocalSharedPagesRepositoryImpl` = test fixture, ignore.

`SharedSectionBloc(repository, workspaceId, enablePolling: true, pollingIntervalSeconds: 30)`:
| Event | Effect |
|---|---|
| `SharedSectionInitEvent` | start `FolderNotificationListener(objectId: workspaceId)` for `DidUpdateSharedViews`; start `Timer.periodic(30 s)` → `refresh`; emit `isLoading: true, errorMessage: ''`; fetch → `sharedPages` / `errorMessage`, `isLoading: false` |
| `SharedSectionRefreshEvent` | fetch silently (no loading flag) |
| `SharedSectionUpdateSharedPagesEvent(sharedPages)` | replace list |
| `SharedSectionToggleExpandedEvent` | `isExpanded = !isExpanded` (**in-memory only**, default true, not persisted) |
| `SharedSectionLeaveSharedPageEvent(pageId)` | repo leave → remove from list; error → `errorMessage` |
State: `sharedPages=[]`, `isLoading=false`, `errorMessage=''`, `isExpanded=true`.

UI (`presentation/shared_section.dart`):
| State | Render |
|---|---|
| `isLoading` | `Center(CircularProgressIndicator(color: AppFlowyTheme.iconColorScheme.primary))` (shown inline in sidebar during first load) |
| `errorMessage` non-empty | `Padding(all 16) > Text(errorMessage, style: textStyle.body.enhanced(color: textColorScheme.warning))` |
| `sharedPages` empty | nothing |
| else | Column(crossAxis start): `SharedSectionHeader`, if expanded `SharedPageList`, (debug builds only) `RefreshSharedSectionButton` (AFTextMenuItem, `Icons.refresh` 20px `iconColorScheme.secondary`, title "Refresh"), `VSpace(16)` |

`SharedSectionHeader`: same as `FavoriteHeader` but `text: LocaleKeys.shareSection_shared` ("Shared with me"), icon `FlowySvg(FlowySvgs.shared_with_me_m, color: theme.badgeColorScheme.color13Thick2 /* #3267D1 */)`; tap → toggle expanded.

`SharedPageList` rows: `ViewItem(key: ValueKey(view.id), spaceType: FolderSpaceType.public, isFirstChild, view, level: 0, isDraggable: false, leftPadding: 16, isFeedback: false, onSelected, onTertiarySelected, rightIconsBuilder: [IntrinsicWidth(SharedPageActionsButton), SizedBox(width: 4)])` (children render/expand normally; default left icon).
- `onSelected`: ctrl → `openTab`; then `openPlugin`. `onTertiarySelected` → `openTab`.

`SharedPageActionsButton` (`widgets/shared_page_actions_button.dart`):
- Trigger: `FlowyIconButton(width: 24, icon: FlowySvg(FlowySvgs.workspace_three_dots_s))` → `onSetEditing(true)` (`ViewEvent.setIsEditing(true)`) + `controller.show()`; on close → `setIsEditing(false)`.
- Popover: `AFPopover(padding: zero, decoration: BoxDecoration(), anchor: AFAnchorAuto(offset: Offset(98, 8)))` > `AFMenu(width: 240, backgroundColor: Theme.of(context).cardColor)`.
- Items `AFTextMenuItem(leading: FlowySvg(action.leftIconSvg, size 16, color: delete ? colorScheme.error : null), title: action.name, titleColor: delete ? error : null, trailing: action.rightIcon)`; divider `AFDivider(spacing: 4)` (skipped if it would be first).
- Action order: `favorite`/`unFavorite` (by `view.isFavorite`), `leaveSharedPage`; if `accessLevel != readOnly`: `divider`, `rename`, `changeIcon` (if layout != Chat), `delete` (if `fullAccess`); then `divider`, `openInNewTab`.

| Action | Label | Icon | Handler (shared_section.dart) |
|---|---|---|---|
| favorite / unFavorite | `disclosureAction_favorite` / `disclosureAction_unfavorite` | `favorite_s` / `unfavorite_s` | `FavoriteEvent.toggle(view)` |
| leaveSharedPage | hard-coded `'Leave'` (not i18n) | `leave_workspace_s` | `showConfirmDialog(title: 'Remove your own access' (hard-coded), titleStyle: body.standard(textColorScheme.primary), description: '', style: ConfirmPopupStyle.cancelAndOk, confirmLabel: 'Remove')` → `SharedSectionEvent.leaveSharedPage(pageId)` |
| rename | `disclosureAction_rename` | `view_item_rename_s` | `showAFTextFieldDialog(title rename, initial nameOrDefault, maxLength 256)` → `FolderEventUpdateView{view_id, name}` |
| changeIcon | `disclosureAction_changeIcon` | `change_icon_s` | **no-op** (falls to `default: break`) — BUG-COMPAT |
| delete | `disclosureAction_delete` | `trash_s` | **no-op** — BUG-COMPAT |
| openInNewTab | `disclosureAction_openNewTab` | `view_item_open_in_new_tab_s` | `TabsBloc.openTab(view)` |

### 2B.8 Spaces — model & storage

A space = a **root view** (`parent_view_id == workspaceId`, layout `Document`) whose `ViewPB.extra` JSON has `"is_space": true`. Keys (`workspace/application/view/view_ext.dart::ViewExtKeys`):

| Key | Type | Meaning |
|---|---|---|
| `is_space` | bool | marks a space (`view.isSpace`; missing/invalid JSON → false) |
| `space_icon` | string | `"<iconGroupName>/<iconName>"` from `assets/icons/icons.json` (e.g. default `"interface_essential/home-3"` = `kDefaultSpaceIconId`); legacy (< 0.6.7) `"space_icon_1".."space_icon_15"` → asset `assets/flowy_icons/16x/space_icon_N.svg`; `""` = none |
| `space_icon_color` | string | ARGB hex literal parsed with `int.parse`, e.g. `"0xFFA34AFD"` |
| `space_permission` | int | `SpacePermission.index`: `0 = publicToAll`, `1 = private`. Missing key → **1 (private)**; JSON error → private |
| `space_created_at` | int | ms since epoch (written on create, never read on desktop) |
| `space_creator` | – | declared, never written/read |

Example extra written on create: `{"is_space":true,"space_icon":"interface_essential/home-3","space_icon_color":"0xFFA34AFD","space_permission":0,"space_created_at":1731150000000}`.

Built-in palette `builtInSpaceColors` (`space_icon_popup.dart`), index order matters (`first` = default/fallback):
`0xFFA34AFD, 0xFFFB006D, 0xFF00C8FF, 0xFFFFBA00, 0xFFF254BC, 0xFF2AC985, 0xFFAAD93D, 0xFF535CE4, 0xFF808080, 0xFFD2515F, 0xFF409BF8, 0xFFFF8933`.
`builtInSpaceIcons` = `space_icon_1` … `space_icon_15` (legacy set; only used as migration/duplicate fallbacks).

Space list order: `[...publicSpaces, ...privateSpaces]`, each in backend order of `ReadWorkspaceViews` / `ReadPrivateViews`, de-duplicated by id. No client-side reordering on desktop.

`SpaceIcon(dimension, textDimension?, cornerRadius=0, space, svgSize?)` (`space_icon.dart`):
- `ClipRRect(radius) > Container(width = height = dimension, color: bg) > Center(glyph)`.
- `space_icon` null/empty → glyph = first letter of `name` capitalized, `FlowyText.medium(color: colorScheme.surface, fontSize: svgSize, figmaLineHeight: textDimension ?? dimension)`, bg = `builtInSpaceColors.first` (#A34AFD).
- else glyph = `view.buildSpaceIconSvg(context, size: svgSize)`: requires BOTH `space_icon` and `space_icon_color` keys (else null → empty glyph); legacy name → asset svg; else svg string looked up in `kIconGroups` (`shared/icon_emoji_picker/icon_picker.dart`, loaded from `assets/icons/icons.json`) by group name + icon name; tinted `colorScheme.surface` (white in light theme). Bg = parsed `space_icon_color`, transparent if missing/invalid.
- `DefaultSpaceIcon(dimension, iconDimension, cornerRadius)`: `kDefaultSpaceIconId` svg (fallback legacy `space_icon_1`) tinted `surface`, bg `#A34AFD`.

### 2B.9 SpaceBloc (`workspace/application/sidebar/space/space_bloc.dart`)

State (`SpaceState`): `spaces: [ViewPB]=[]`, `currentSpace: ViewPB?`, `isExpanded=true`, `lastCreatedPage: ViewPB?` (a "please open this" signal), `createPageResult`, `shouldShowUpgradeDialog=false`, `isDuplicatingSpace=false`, `isInitialized=false`.

| Event | Logic / backend |
|---|---|
| `initial(openFirstPage)` | start `WorkspaceSectionsListener` (→ `didReceiveSpaceUpdate`); read public+private; `currentSpace = spaces.firstWhere(id == KV lastOpenedSpaceId) ?? spaces.first`; `isExpanded = KV expandedViews[currentSpace.id] ?? true`; emit `isInitialized: true`. If `openFirstPage && currentSpace != null` → `open(currentSpace)`. Desktop sidebar passes `openFirstPage: false` |
| `create(name, icon, iconColor, permission, createNewPageByDefault, openAfterCreate)` | `FolderEventCreateView(CreateViewPayloadPB{parent_view_id: workspaceId, name, layout: Document, section: Public|Private (from permission), set_as_current: true, extra: <json 2B.8>})`; on success append to `spaces`, set `currentSpace`, `open(space)`; if `createNewPageByDefault` → `createPage(name: '', index: 0, layout: Document, openAfterCreate)` |
| `rename(space, name)` | → `update(space, name, icon: space.spaceIcon, iconColor: space.spaceIconColor, permission: space.spacePermission)` (re-sends icon/permission ⇒ also calls visibility API) |
| `changeIcon(space?, icon?, iconColor?)` | → `update(space, icon, iconColor)` |
| `update(space?, name?, icon?, iconColor?, permission?)` | `space ??= currentSpace`. (1) name → `FolderEventUpdateView{view_id, name}`. (2) if any of icon/iconColor/permission non-null → merge into extra (`space_icon`, `space_icon_color`, `space_permission: index`) → `FolderEventUpdateView{view_id, extra}`; **else** (all three null) → remove `space_icon` & `space_icon_color` from extra and save (BUG-COMPAT: Manage dialog "Save" without touching icon/permission wipes the icon). (3) permission → `FolderEventUpdateViewVisibilityStatus(UpdateViewVisibilityStatusPayloadPB{view_ids: [space.id], is_public: permission == publicToAll})` |
| `open(space, afterOpen?)` | KV `lastOpenedSpaceId = space.id`; read expand status; `FolderEventGetView(ViewIdPB{value: space.id})` → rebuild `currentSpace` with fresh `childViews`; emit. **Desktop**: emit `lastCreatedPage = childViews.first` or `ViewPB()` (empty) ⇒ sidebar listener opens first page of the space, or `BlankPagePlugin` if the space is empty. Then `afterOpen?.call()` |
| `expand(space, isExpanded)` | persist to KV `expandedViews`; emit |
| `createPage(name, layout, index?, openAfterCreate)` | parent = `currentSpace.id` (abort if null) → `FolderEventCreateView(CreateViewPayloadPB{parent_view_id: spaceId, name, layout, set_as_current: openAfterCreate, initial_data: [], index})` (no section); success → `lastCreatedPage = openAfterCreate ? view : null`, `createPageResult = success`; failure → `createPageResult = failure` (not surfaced in UI on desktop) |
| `delete(space?)` | no-op if `spaces.length <= 1`; target `space ?? currentSpace` → `FolderEventDeleteView(RepeatedViewIdPB{items: [id]})` (moves to trash). UI refresh via `DidUpdateSectionViews` → `didReceiveSpaceUpdate` (falls back to `spaces.first`; no page is auto-opened) |
| `didReceiveSpaceUpdate()` | re-read both lists; `currentSpace` re-resolved from KV `lastOpenedSpaceId` (fallback first); emit `spaces`, `currentSpace` (childViews from section payload) |
| `reset(userProfile, workspaceId, openFirstPage)` | if same workspaceId → return; stop listener, swap ids, `initial(openFirstPage)` |
| `switchToNextSpace()` | `open(spaces[(indexOf(current)+1) % len])` |
| `duplicate(space?)` | `isDuplicatingSpace: true` (sidebar shows full-screen `Loading(context)` overlay); `_createSpace(name: '${name} (copy)', icon: space.spaceIcon or builtInSpaceIcons.first, iconColor: space.spaceIconColor or builtInSpaceColors.first, permission: same)`; for each `space.childViews` (from current state) → `FolderEventDuplicateView(DuplicateViewPayloadPB{view_id, open_after_duplicate: true, include_children: true, parent_view_id: newSpace.id, suffix: '', sync_after_create: true})`; then `didReceiveSpaceUpdate` + `open(newSpace)`; `isDuplicatingSpace: false` |
| `migrate()` | see 2B.13 |

Sidebar listeners (`sidebar.dart`):
- `BlocListener<SpaceBloc>` (listenWhen `lastCreatedPage.id` changed OR `isDuplicatingSpace` changed): if `lastCreatedPage == null || id.isEmpty` → `TabsEvent.openPlugin(plugin: BlankPagePlugin())`; else `openPlugin(lastCreatedPage.plugin())`. Note: fires also when only `isDuplicatingSpace` toggles (re-opens current `lastCreatedPage`).
- `BlocListener<UserWorkspaceBloc>`: on `actionResult.actionType ∈ {create, delete, open}`: if `SpaceState.spaces.isEmpty` → `SidebarSectionsEvent.reload(user, wsId)`; else `SpaceEvent.reset(user, wsId, true)`; always `FavoriteEvent.fetchFavorites()`.
- Notification deep-link (`_onNotificationAction`, `ActionType.openView`): `checkForSpace` → `getIt<ViewAncestorCache>().getAncestor(view.id)`; if first ancestor ≠ current space → `FolderEventGetView(ancestor.id)` → `SpaceEvent.open(space, afterOpen: openView)`; then `openView` again post-frame (opens twice).

Global notifiers (`workspace/presentation/home/hotkeys.dart`):
- `switchToTheNextSpace: ValueNotifier<int>` ← hotkey **Ctrl+O** (Cmd+O on macOS), scope in-app → `_Space` → `SpaceEvent.switchToNextSpace()`.
- `switchToSpaceNotifier: ValueNotifier<ViewPB?>` ← set by (a) `desktop_home_screen.dart::_switchToSpace(view)` when `HomeBloc.latestView` changes (first ancestor with `isSpace` from `FolderEventGetViewAncestors(ViewIdPB)`), (b) `view_item.dart::moveViewCrossSpace` (DnD/move into another space). `_Space` → `SpaceEvent.open(space)` ⇒ also opens that space's first page (AMBIGUOUS: on startup this races with restoring the latest view; `_Space` only listens once mounted).
- `createNewPageNotifier` ← **Ctrl+N** → `SidebarNewPageButton._createNewPage`: if `spaces` non-empty → `SpaceEvent.createPage(name: '', index: 0, layout: Document, openAfterCreate: true)` (into current space); else `SidebarSectionsEvent.createRootViewInSection(name: '', index: 0, viewSection: isCollabWorkspaceOn ? Private : Public)`.

### 2B.10 Space section UI (`sidebar_space.dart::_Space`)

- `BlocBuilder<SpaceBloc>`: nothing if `spaces.isEmpty`; `currentSpace = state.currentSpace ?? spaces.first`.
- Column: `SidebarSpaceHeader(isExpanded, space: currentSpace, onAdded: layout → SpaceEvent.createPage(name: '', layout, index: 0, openAfterCreate: true) + SpaceEvent.expand(space, true), onCreateNewSpace: _showCreateSpaceDialog, onCollapseAllPages: isExpandedNotifier.value = true)`; if `isExpanded`: `MouseRegion(isHovered) > SpacePages(...)`.
- `isExpandedNotifier: PropertyValueNotifier<bool>(false)` (appflowy_editor; notifies on every assignment even if unchanged) — setting `true` makes every root `ViewItem` of the space dispatch `ViewEvent.collapseAllPages()` (2C).
- Create-space dialog: `showDialog > Dialog(shape: RoundedRectangleBorder(radius 12)) > BlocProvider.value(SpaceBloc) > CreateSpacePopup()`.

`SpacePages` (`shared_widget.dart`):
- `BlocProvider(ViewBloc(view: space)..add(ViewEvent.initial()))` → children = `state.view.childViews` (filtered by optional `shouldIgnoreView != hide`).
- Key on `SpacePages`: `ValueKey(Object.hashAll([workspaceId, currentSpace.id]))` (remount per space).
- Row: `ViewItem(key: ValueKey('${space.id} ${view.id}'), spaceType: space.spacePermission == publicToAll ? FolderSpaceType.public : FolderSpaceType.private, isFirstChild, view, level: 0, leftPadding: 16, isFeedback: false, isHovered, enableRightClickContext: !disableSelectedStatus, disableSelectedStatus, isExpandedNotifier, rightIconsBuilder (null → default "…" and "+"), onSelected, onTertiarySelected, shouldIgnoreView)`. No `engagedInExpanding` (default false) unlike legacy sections.
- Sidebar callbacks: `onSelected` = ctrl → `openTab`; then `openPlugin`. `onTertiarySelected` = `openTab`.
- No empty-space placeholder row (an empty space shows only its header).

### 2B.11 Space header (`sidebar_space_header.dart`)

Layout:
| Element | Spec |
|---|---|
| Root | `MouseRegion` (hover) > `GestureDetector(onTap: SpaceEvent.expand(space, !isExpanded))` |
| Box | `Container(height: 32, decoration: BoxDecoration(borderRadius: 6, color: hovered ? colorScheme.secondary : null))` > `Stack(alignment: center)` |
| Left | `Positioned(left: 3, top: 3, bottom: 3, right: (hovered or editing) ? 88 : 0)` > `SpacePopup(showCreateButton: true, child: FlowyTooltip(richMessage) > CurrentSpace(space, isHovered))` |
| Tooltip | rich: line 1 `LocaleKeys.space_quicklySwitch` ("Quickly switch to the next space") + `\n` in `context.tooltipTextStyle()`; line 2 `"Ctrl+O"` (`"⌘+O"` on macOS) same style with `color: Theme.hintColor` |
| Right | `Positioned(right: 4)` > `Opacity(hovered or editing ? 1 : 0)` > `Row[SpaceMorePopup, HSpace(8), FlowyTooltip(message: sideBar_addAPage "Add a new page") > ViewAddButton(parentViewId: space.id, isHovered)]` |

`CurrentSpace(space, isHovered)`: `Row(min)[SpaceIcon(dimension: 22, svgSize: 12, cornerRadius: 8), HSpace(10), Flexible(FlowyText.medium(name, fontSize: 14, figmaLineHeight: 18, ellipsis, color: hovered ? colorScheme.onSurface : null)), HSpace(4), FlowySvg(SpaceBloc.isExpanded ? workspace_drop_down_menu_show_s : workspace_drop_down_menu_hide_s, color: hovered ? onSurface : null)]`. (`onTapBlankArea` variant with tooltip `space_movePageToSpace` is used only by move-to UI.)

`SpacePopup` (switcher trigger): `SizedBox(height: height ?? 32) > AppFlowyPopover(constraints: maxWidth 260, direction: bottomWithLeftAligned, clickHandler: PopoverClickHandler.gestureDetector, offset: Offset(0, 4), popup: BlocProvider.value(SpaceBloc) > SidebarSpaceMenu(showCreateButton))` > `FlowyButton(useIntrinsicWidth: true, expand: false, margin: EdgeInsets.only(left: 3, right: 4), iconPadding: 10, text: child)`. Click on the name opens the switcher; click on the rest of the header row toggles expand.

`ViewAddButton` in header (layout list and popover → 2C): `onSelected(pluginBuilder, name, initialDataBytes, openAfterCreated, createNewView)` → only when `createNewView` → `onAdded(pluginBuilder.layoutType!)` (name/initial data ignored; always `name: ''`, `index: 0`, `openAfterCreate: true`, then expand).

Header action dispatch (`_onAction`):
| `SpaceMoreActionType` | Handler |
|---|---|
| `rename` | `showAFTextFieldDialog(title: space_rename "Rename Space", initialValue: space.name, hintText: space_spaceName "Space name")` → `SpaceEvent.rename(space, name)` (no max length client-side; Rust limit 256 graphemes) |
| `changeIcon` | data = `SelectedEmojiIconResult`; if `type == FlowyIconType.icon`: `IconsData.fromJson(jsonDecode(data.emoji))` (`{groupName, iconName, color?}`) → `SpaceEvent.changeIcon(icon: '$groupName/$iconName', iconColor: color)`; FormatException → `changeIcon(icon: '')` |
| `manage` | `showDialog > Dialog(radius 12) > BlocProvider.value(SpaceBloc) > ManageSpacePopup()` |
| `addNewSpace` | create-space dialog |
| `collapseAllPages` | `isExpandedNotifier.value = true` |
| `delete` | `showConfirmDeletionDialog(name: currentSpace.name, description: space_deleteConfirmationDescription)` → `SpaceEvent.delete(null)` |
| `duplicate` | `SpaceEvent.duplicate()` |

`showConfirmDeletionDialog` (`workspace/presentation/widgets/dialogs.dart`): `Dialog(radius 12) > SizedBox(width: 440) > ConfirmPopup(title: space_deleteConfirmation + name ("Delete: <name>"), description, style cancelAndOk)`; confirm button label default `space_delete` "Delete", bg `colorScheme.error`.

### 2B.12 Space menus & dialogs

**Space switcher** `SidebarSpaceMenu(showCreateButton)` (`sidebar_space_menu.dart`):
- `Column(min)[VSpace(4), for each space: SizedBox(height: 30 /*HomeSpaceViewSizes.viewHeight*/) > SidebarSpaceMenuItem(space, isSelected: currentSpace.id == space.id), if showCreateButton: Padding(vertical 8) > FlowyDivider(), SizedBox(height: 30) > _CreateSpaceButton]`.
- `SidebarSpaceMenuItem`: `FlowyButton(iconPadding: 10, leftIcon: SpaceIcon(dimension: 20, svgSize: 12, cornerRadius: 6), leftIconSize: 20x20, text: Row[Flexible(FlowyText.regular(name, ellipsis)), HSpace(6), if private: FlowyTooltip(message: space_privatePermissionDescription "Only you can access this space") > FlowySvg(FlowySvgs.space_lock_s)], rightIcon: selected ? FlowySvg(FlowySvgs.workspace_selected_s, blendMode: null) : null)`; tap → `SpaceEvent.open(space)` + close popover.
- `_CreateSpaceButton`: `FlowyButton(iconPadding: 10, leftIcon: FlowySvg(FlowySvgs.space_add_s), text: FlowyText.regular(space_createNewSpace "Create a new space"))` → close popover → create-space dialog.

**Space "…" menu** `SpaceMorePopup` (`space_more_popup.dart`):
- Trigger: `FlowyIconButton(width: 24, icon: FlowySvg(FlowySvgs.workspace_three_dots_s, color: hovered ? colorScheme.onSurface : null), tooltipText: space_manage "Manage Space")`; press → `onEditing(true)` (keeps header right icons visible and name area shrunk) + show; `onClosed` → `onEditing(false)`.
- `PopoverActionList(direction: bottomWithLeftAligned, offset: Offset(0, 8), constraints: BoxConstraints(minWidth: 260))`.
- Order: `rename, changeIcon, manage, duplicate, divider, addNewSpace, collapseAllPages, divider, delete`.

| Type | Label key → en | Icon |
|---|---|---|
| rename | `space_rename` → "Rename Space" | `FlowySvgs.view_item_rename_s` |
| changeIcon | `space_changeIcon` → "Change icon" | `FlowySvgs.change_icon_s` |
| manage | `space_manage` → "Manage Space" | `FlowySvgs.space_manage_s` |
| duplicate | `space_duplicate` → "Duplicate Space" | `FlowySvgs.duplicate_s` |
| addNewSpace | `space_addNewSpace` → "Create Space" | `FlowySvgs.space_add_s` |
| collapseAllPages | `space_collapseAllSubPages` → "Collapse all subpages" | `FlowySvgs.collapse_all_page_s` |
| delete | `space_delete` → "Delete" | `FlowySvgs.trash_s` |

- Item: `Container(height: 34, padding: vertical 2) > Opacity(disabled ? 0.3 : 1) > FlowyIconTextButton(disable, margin: horizontal 6, iconPadding: 10, left icon, text FlowyText.regular(name, fontSize: 14, figmaLineHeight: 18))`; delete row: icon + text `colorScheme.error` on hover. Right icon: none for all.
- Divider: `Padding(all 8) > FlowyDivider()` (1px, `AFThemeExtension.borderColor`).
- Delete disabled rules (tooltip on the row): `spaces.length <= 1` → `space_unableToDeleteLastSpace` "Unable to delete the last Space"; else if NOT (`currentWorkspace.role.isOwner` OR `currentSpace.createdBy == UserProfilePB.id`) → `space_unableToDeleteSpaceNotCreatedByYou` "Unable to delete spaces created by others". (Checks `currentSpace`, not the row's space.)
- changeIcon row opens a nested `AppFlowyPopover(constraints: loose 360x432, margin: 0, clickHandler: gestureDetector, offset: Offset(0, -40))` with `FlowyIconEmojiPicker(tabs: [PickerTabType.icon])`; selection → `onTap(controller, result)` → handler above + close.

**Create space dialog** `CreateSpacePopup` (`create_space_popup.dart`), inside `Dialog(radius 12)`:
| Part | Spec |
|---|---|
| Container | `padding: vertical 16, horizontal 24`, `width: 524`, Column(min) |
| Title | `FlowyText(space_createNewSpace "Create a new space", fontSize: 18, figmaLineHeight: 24)` |
| gap | `VSpace(2)` |
| Description | `FlowyText(space_createSpaceDescription, fontSize: 14, fontWeight: w300, color: hintColor, figmaLineHeight: 18, maxLines: 2)` |
| gap | `VSpace(16)` |
| Icon picker | `SizedBox.square(56) > SpaceIconPopup(onIconChanged)` (cornerRadius 16 default) |
| gap | `VSpace(8)` |
| Name | label `FlowyText.regular(space_spaceName "Space name", 14, hintColor, figmaLineHeight 18)`, `VSpace(6)`, `SizedBox(height: 40) > FlowyTextField(hintText: space_spaceNamePlaceholder "e.g. Marketing, Engineering, HR", enableBorderColor: context.enableBorderColor, onChanged, onSubmitted → create)` — field starts empty |
| gap | `VSpace(20)` |
| Permission | `SpacePermissionSwitch(onPermissionChanged)` |
| gap | `VSpace(20)` |
| Buttons | `SpaceCancelOrConfirmButton(confirmButtonName: button_create "Create")` |

Initial values: `spaceName = space_defaultSpaceName` ("General") — used if the field is never edited; `spaceIcon = kDefaultSpaceIconId` (`interface_essential/home-3`); `spaceIconColor = '0xFFA34AFD'`; `permission = publicToAll`. No empty-name validation on desktop (clearing the field creates a space named `''`). Confirm/Enter → `SpaceEvent.create(name, icon, iconColor, permission, createNewPageByDefault: true, openAfterCreate: true)` + `Navigator.pop`.

**Manage space dialog** `ManageSpacePopup` (`manage_space_popup.dart`), inside `Dialog(radius 12)`:
- `Container(padding: vertical 16, horizontal 24, width: 500)`; title `FlowyText(space_manage "Manage Space", fontSize: 18)`; `VSpace(16)`.
- Name block: label `FlowyText.regular(space_spaceName, 14, hintColor)`, `VSpace(8)`, `SizedBox(height: 40) > Row[SizedBox.square(40) > SpaceIconPopup(space: currentSpace, cornerRadius: 12, icon: space.spaceIcon, iconColor: space.spaceIconColor), HSpace(12), Expanded(SizedBox(height 40) > FlowyTextField(text: space.name, onChanged))]`.
- `VSpace(16)`, `SpacePermissionSwitch(spacePermission: currentSpace.spacePermission)`, `VSpace(16)`, `SpaceCancelOrConfirmButton(confirmButtonName: button_save "Save")`.
- Save → `SpaceEvent.update(name: changed?, icon: changed?, iconColor: changed?, permission: changed?)` (each null unless touched) + pop. See BUG-COMPAT in 2B.9 `update`.

**`SpaceIconPopup(icon?, iconColor?, cornerRadius=16, space?, onIconChanged)`** (`space_icon_popup.dart`):
- `AppFlowyPopover(offset: Offset(0, 4), constraints: loose 360x432, margin: 0, direction: bottomWithCenterAligned)` > `FlowyIconEmojiPicker(tabs: [PickerTabType.icon])`.
- On select (icon type): `selectedIcon = '$groupName/$iconName'`; `selectedColor = iconsData.color ?? previous`; `onIconChanged(icon, color)`; close. FormatException → icon `''`.
- Preview (fills the parent square; cursor click): `selectedIcon == null` → `DefaultSpaceIcon(dimension 32, iconDimension 32)` if no `space`, else `SpaceIcon(dimension 32, svgSize 24)`; legacy `space_icon_N` → color bg + asset svg 42px tinted `colorScheme.surface`; otherwise `kIconGroups.findSvgContent(value)` svg 24px tinted `surface` on `Color(int.parse(color))`, clipped `cornerRadius`. Hover → preview at `Opacity(0.2)` + centered `FlowySvg(FlowySvgs.view_item_rename_s, size 20)`.
- Icon picker colors (`icon_color_picker.dart`) use the same `builtInSpaceColors` strings, so returned `color` is `"0xFFxxxxxx"`.
- `SpaceIconPicker`, `_Colors`, `_Icons` in the same file are unused on desktop (do not port).

**`SpacePermissionSwitch(spacePermission?, onPermissionChanged, showArrow=false)`** (`shared_widget.dart`):
- Label `FlowyText.regular(space_permission "Space permission", 14, hintColor, figmaLineHeight 18)`, `VSpace(6)`.
- `AppFlowyPopover(controller, direction: bottomWithCenterAligned, constraints: maxWidth 500, offset: Offset(0, 4), margin: 0)`; trigger `DecoratedBox(ShapeDecoration(RoundedRectangleBorder(side: context.enableBorderColor, radius 10))) > SpacePermissionButton(showArrow: true, permission: current)`; popup `SizedBox(width: 452) > Column[SpacePermissionButton(publicToAll), SpacePermissionButton(private)]` → select = callback + close.
- `SpacePermissionButton`: `FlowyButton(margin: horizontal 14, vertical 12, radius: showArrow ? 10 : 0, iconPadding: 16, leftIcon: FlowySvg(public ? FlowySvgs.space_permission_public_s : FlowySvgs.space_permission_private_s), leftIconSize: 20x20, rightIcon: showArrow ? FlowySvg(FlowySvgs.space_permission_dropdown_s) : null, borderColor: light 0x1E171717 / dark 0xFF3A3F49, text: Column(start)[FlowyText.regular(title), VSpace(4), FlowyText.regular(desc, fontSize: 12, color: hintColor)])`.
  - Public: `space_publicPermission` "Public" / `space_publicPermissionDescription` "All workspace members with full access".
  - Private: `space_privatePermission` "Private" / `space_privatePermissionDescription` "Only you can access this space".
- `context.enableBorderColor` (`_extension.dart`): light `Color(0x1E171717)`, dark `Color(0xFF3A3F49)`.

**`SpaceCancelOrConfirmButton(onCancel, onConfirm, confirmButtonName, confirmButtonColor?, confirmButtonBuilder?)`**: `Row(mainAxis end)[AFOutlinedTextButton.normal(size: AFButtonSize.m, text: button_cancel "Cancel", textStyle: body.standard(color: textColorScheme.primary)), HSpace(12), DecoratedBox(color: confirmButtonColor ?? colorScheme.primary, radius 8) > FlowyButton(useIntrinsicWidth, margin: horizontal 16, vertical 9, radius 8, text: FlowyText.regular(name, lineHeight: 1.0, color: colorScheme.onPrimary))]`.

**`ConfirmPopup`** (used by delete): container radius `theme.borderRadius.xl` (16), bg `surfaceColorScheme.primary`, padding `spacing.xxl` (20) all sides; title `textStyle.heading4.prominent(textColorScheme.primary)` ellipsis + close `AFGhostButton.normal(size s, padding spacing.xs=4)` with `FlowySvgs.password_close_m` 20px; description `body.standard(primary)` maxLines 5 after `VSpace(spacing.l=12)`; buttons after `VSpace(20)`. Keyboard: Esc (key down) → pop; Enter (key UP) → confirm + pop.

**`SpaceSearchField(width, onSearch)`** (used by Favorites "More" menu): `Container(height: 30, width, clip antiAlias, ShapeDecoration(RoundedRectangleBorder(side: BorderSide(width: 1.2, strokeAlign: outside, color: Color(0xFF00BCF0)), radius 8)))` > `CupertinoSearchTextField(padding: zero, autofocus via focusNode.requestFocus() in initState, placeholder: search_label "Search", prefixIcon: FlowySvg(FlowySvgs.magnifier_s), prefixInsets: left 12 right 8, suffixIcon: Icon(Icons.close), suffixInsets: right 8, itemSize: 16, decoration: transparent, style/placeholderStyle: textTheme.bodyMedium w400 (placeholder color hintColor))`; fires `onSearch` on every change.

### 2B.13 Space migration (`space_migration.dart`, `SpaceBloc.migrate`)

- Shown by `sidebar.dart::_renderUpgradeSpaceButton` iff `SpaceState.shouldShowUpgradeDialog && isCollabWorkspaceOn`, placed below the tree divider with padding `menuHorizontalInset + (left 4, right 4, top 8)`.
- `shouldShowUpgradeDialog` is set `false` on `initial` and only becomes `true` when a `migrate()` run returns false; the helper `SpaceBloc.shouldShowUpgradeDialog({spaces, publicViews, privateViews})` is never called ⇒ the banner is effectively **dead UI** on desktop. Port only if desired; low priority.
- Visual (if ported): container `padding 12`, bg light `0x66F5EAFF` / dark `0x1AFFFFFF`, border `0x339327FF` (outside), radius 10. Collapsed: `Row[FlowySvg(FlowySvgs.upgrade_s, blendMode: null), HSpace(8), Expanded(ShaderMask gradient #8032FF→#EF35FF stops 0.1545/0.8225 > FlowyText(space_upgradeYourSpace "Create multiple Spaces")), FlowySvg(FlowySvgs.space_arrow_right_s, blendMode: null)]`, tap → expanded. Expanded: title row (`upgrade_s` + `space_upgradeSpaceTitle` "Enable Spaces", maxLines 3, lineHeight 1.2), `VSpace(6)`, `Opacity(0.7) FlowyText.regular(space_upgradeSpaceDescription, 13, lineHeight 1.3)`, `VSpace(12)`, button `Container(padding h10 v8, color 0xFFA44AFD, radius 9) > FlowyText(space_upgrade "Update", white, 12)` → `SpaceEvent.migrate()`. (`_MigrationTitle.onClose` is never wired to a widget.)
- `migrate()` algorithm: `UserEventGetUserProfile` → `UserEventGetWorkspaceMembers(QueryWorkspacePB{workspace_id})`; if no members → true. If single member or current user is Owner: non-space public root views exist and no public space → create space "Shared" (`builtInSpaceIcons.first`, `builtInSpaceColors.first`, publicToAll, `view_id: fixedUuid(uid + workspaceId.hashCode, UuidType.publicSpace)`) and move each (reverse order) via `FolderEventMoveNestedView(MoveNestedViewPayloadPB{view_id, new_parent_id: space.id, prev_view_id: null})`. Then private: non-space private roots exist and no private space → create "Private" (`builtInSpaceIcons.last`, `builtInSpaceColors.last`, private, `view_id: fixedUuid(uid, UuidType.privateSpace)`) and move likewise. Exceptions → false. AMBIGUOUS: `fixedUuid` = Dart `uuid.v4` with `MathRNG(seed: seed + type.index)` and Dart `String.hashCode` — not reproducible in JS; use random v4 in Electron.

### 2B.14 Legacy `FolderBloc` (`workspace/application/sidebar/folder/folder_bloc.dart`)

- `FolderBloc({required FolderSpaceType type})`; state `{type, isExpanded=true}`.
- `initial()` → read KV `expandedViews[type.name] ?? true`.
- `expandOrUnExpand({bool? isExpanded})` → `isExpanded ?? !state.isExpanded`; persist (true → set key; false → remove key).

### 2B.15 Related misc in scope

- `workspace/application/sidebar/space/space_search_bloc.dart` (`SpaceSearchBloc`: `initial` → `FolderEventGetAllViews()`; `search(query)` → name contains) — used only by move-to menu (`move_to/move_page_menu.dart`, other part).
- `workspace/application/sidebar/rename_view/rename_view_bloc.dart` — used by hotkeys/app widget (F2 rename), other part.
- `workspace/application/menu/menu_user_bloc.dart` — header/user part, not sections.
- Mobile-only: `features/shared_section/presentation/m_*`, `mobile/presentation/home/tab/space_order_bloc.dart` (`spaceOrder`, `lastOpenedSpace` keys) — ignore.

### 2B.16 Electron checklist (sections)

1. Two section lists from `ReadWorkspaceViews` + `ReadPrivateViews`; keep them live via `DidUpdateSectionViews` (two payloads per change).
2. Space detection strictly via `extra.is_space === true`; permission default = private when key absent.
3. Favorites: `ReadFavorites` minus spaces; pinned (`extra.is_pinned`) shown inline (auto-pin first 3 on favorite), rest under "More" popover grouped by favorite timestamp (seconds); reorder = double `ToggleFavorite` per pinned view.
4. Opening a space (switcher, Ctrl+O, cross-space move, deep link) always opens its first child page (or the blank page) in the current tab and writes `lastOpenedSpaceId`.
5. Collapse state persistence quirk (removal == expanded) and Manage-dialog icon wipe quirk are current behaviour; decide explicitly whether to mirror.
6. Shared section is behind a default-off flag; changeIcon/delete in its menu are no-ops.
7. Required assets: `assets/icons/icons.json` (icon groups for space icons), `assets/flowy_icons/16x/space_icon_1..15.svg` (legacy), and the FlowySvgs listed above.

---

## 2C. Page tree item, view actions, create/move/rename, folder events & notifications

Paths relative to `appflowy_flutter/lib`. Rust paths relative to `rust-lib/`. Colors given for the default theme (`packages/flowy_infra/lib/colorscheme/default_colorscheme.dart`, mapped to Material in `workspace/application/settings/appearance/desktop_appearance.dart`).

### 2C.0 Tokens used in this section

Resolved token values and shared widget defaults: see **§5**. Section-specific notes:

- Row hover **and** selected background are both `colorScheme.secondary` (`#1F23290F` / `#FFFFFF1A`); while hovered/selected `FlowyHover` re-tints descendant text and icons with `foregroundColorOnHover ?? colorScheme.onSurface` (`#333333` / `#FFFFFFE5`).
- Delete-item hover uses `colorScheme.error` (`#FB006D`).
- Drag-and-drop indicator: hard-coded `Color(0xFF00C8FF)` = `#00C8FF` (both themes).
- `PopoverActionList` defaults (`workspace/presentation/widgets/pop_up_action.dart`): direction `rightWithTopAligned`, constraints `minWidth 120, maxWidth 460, maxHeight 300`; plain `ActionCell` rows via `HoverButton`: item height 20 + vertical padding 6×2 = **32px**, horizontal padding 10, icon→text gap 10 (`ActionListSizes`), text `FlowyText.regular` 14px lineHeight 1.15.
- Base font 14px w400, letterSpacing = 0.005 × fontSize; `FlowyText(figmaLineHeight: X, fontSize: F)` ⇒ CSS `line-height: X/F`.

---

### 2C.1 Widget tree of one sidebar tree node

```
ViewItem (StatelessWidget)                         workspace/presentation/home/menu/view/view_item.dart
 └ BlocProvider<ViewBloc>(ViewBloc(view, shouldLoadChildViews, engagedInExpanding)..add(initial))
    └ BlocConsumer<ViewBloc,ViewState>  listener: lastCreatedView changed → TabsBloc.openPlugin(lastCreatedView)
       └ [if shouldIgnoreView(view)==disable] Opacity(.5)+FlowyTooltip(space_cannotMovePageToDatabase)+cursor forbidden+IgnorePointer
          └ InnerViewItem (Stateful)
             ├ ValueListenableBuilder(getIt<MenuSharedState>().notifier)  → isSelected = latestOpenView.id == view.id
             │  └ SingleInnerViewItem  (the 30px row)
             ├ if isExpanded && shouldRenderChildren && childViews.isNotEmpty: Column[row, ...childViews.map(ViewItem(level+1))]
             └ wrapped in DraggableViewItem (drag source + drop target) if (isDraggable || isPlaceholder) && !isReferencedDatabaseView
                else Padding(top: 2) (to keep same height as the draggable's divider)
```

#### ViewItem constructor parameters (all must be supported by the React component)

| Param | Default | Meaning |
|---|---|---|
| `view: ViewPB` | req | node data |
| `parentView: ViewPB?` | null | used for `isReferencedDatabaseView` |
| `spaceType: FolderSpaceType` | req | `favorite \| private \| public \| unknown` (`workspace/application/sidebar/folder/folder_bloc.dart`). `toViewSectionPB`: private→`ViewSectionPB.Private`, public→`Public`, favorite/unknown → throws |
| `level: int` | req | depth; indentation = `level * leftPadding` |
| `leftPadding: double` | **10** | per-level indent; every real sidebar caller passes `HomeSpaceViewSizes.leftPadding = 16` and children inherit it |
| `onSelected(ctx, view)` | req | left click |
| `onTertiarySelected(ctx, view)` | null | middle-button *tap down* |
| `isFirstChild` | false | first child gets an extra 2px top drop-divider |
| `isDraggable` | true | false for favorites, shared pages, move-to menu, feedback |
| `isFeedback` | req | true when rendered as drag ghost |
| `height` | `HomeSpaceViewSizes.viewHeight` = **30** | row height |
| `isHoverEnabled` | false on `ViewItem` (but `InnerViewItem`/`SingleInnerViewItem` default **true**; ViewItem does NOT forward it to InnerViewItem except via children → effectively hover is enabled) | AMBIGUOUS: `ViewItem.isHoverEnabled` is passed to `InnerViewItem` (`isHoverEnabled: isHoverEnabled`) but `InnerViewItem` does not pass it on to `SingleInnerViewItem` (whose default is `true`). Net effect: hover always enabled except where `SingleInnerViewItem` is built directly. |
| `isPlaceholder` | false | renders a 4px-tall empty drop zone (empty section) |
| `isHovered: ValueNotifier<bool>?` | null | section-level hover; controls expand-arrow opacity |
| `shouldRenderChildren` | true | favorites/search pass false |
| `leftIconBuilder` | null → default expand arrow | favorites pass `HSpace(16)` |
| `rightIconsBuilder` | null → default `···` + `+` | favorites/shared/move-to override |
| `shouldLoadChildViews` | true | favorites pass false |
| `isExpandedNotifier: PropertyValueNotifier<bool>?` | null | "collapse all" broadcast from space header |
| `extendBuilder(view)` | null | extra widgets after the name (Row[Flexible(name), ...extra]) |
| `disableSelectedStatus` | null | move-to menu passes true |
| `shouldIgnoreView(view) → IgnoreViewType` | null | `none / hide / disable` filter for children |
| `enableRightClickContext` | false | true in spaces, sections, favorites |
| `engagedInExpanding` | false | registers a `ViewExpander` (auto-expand on open); true only in `_section_folder.dart` (non-space mode) roots and inherited by their descendants |

### 2C.2 Row layout (`SingleInnerViewItem._buildViewItem`)

```
GestureDetector(translucent, onTap: throttled onSelected, onTertiaryTapDown: onTertiarySelected)
 └ SizedBox(height: 30)
    └ Padding(left: level * leftPadding)            // 0, 16, 32, 48 ... px
       └ Listener(onPointerDown: right button && enableRightClickContext → viewMoreActionController.showAt(pointer + (4,0)))
          └ Row[
              HSpace(2),
              leftIcon (16px wide),                 // expand arrow / blank / dot
              HSpace(2),
              viewIcon (SizedBox width 16),
              HSpace(6),
              Expanded(name),
              ...(if showActions || hovered) rightIcons,
            ]
```

- Wrapped in `FlowyHover(style: HoverStyle(hoverColor: colorScheme.secondary), resetHoverOnRebuild: showActions || !isIconPickerOpened, buildWhenOnHover: !showActions && !_isDragging && !isIconPickerOpened, isSelected: showActions || isSelected)` → background `colorScheme.secondary`, radius **6**, full row width (indent is inside the highlight, i.e. highlight starts at x=0 of the row, not at the indent).
- Selected and hovered use the **same** color; `showActions` (= `ViewState.isEditing`, true while the `···` or `+` popover is open) keeps the highlight on.
- `isFeedback || !isHoverEnabled` → no FlowyHover; drawn plain (`isSelected` only if `!isHoverEnabled`).
- `isPlaceholder` → `SizedBox(height: 4, width: ∞)` only.
- `disableSelectedStatus == true` → never highlighted as selected.
- Global flag `_isDragging` (module-level bool set by `DraggableViewItem.onDragging`) suppresses hover changes while any drag is in progress.
- Click throttle: taps within **200 ms** of the previous tap on the same row are ignored (`_clickThrottleDuration`).

#### Name text
- `FlowyText.regular(view.nameOrDefault, fontSize: 14, figmaLineHeight: 18, overflow: ellipsis)`; single line.
- `nameOrDefault` = `name.isEmpty ? LocaleKeys.menuAppHeader_defaultNewPageName ("Untitled") : name` (`workspace/application/view/view_ext.dart`).
- Color: default text color; while hovered/selected `colorScheme.onSurface` (via FlowyHover theme override).

#### Left icon (`ViewItemDefaultLeftIcon`)
| Condition | Render |
|---|---|
| `isReferencedDatabaseView(view, parentView)` (view is Grid/Board/Calendar AND parent is Grid/Board/Calendar = linked database view) | `_DotIconWidget`: `Padding(all 6)` + 4×4 circle, radius 2, color `iconTheme.color` (total 16×16) |
| `ViewBloc.state.view.childViews.isEmpty` | `HSpace(leftPadding)` (16px blank) |
| else | `FlowyHover` + `FlowySvg(isExpanded ? FlowySvgs.view_item_expand_s : FlowySvgs.view_item_unexpand_s, size 16×16)`; tap → `ViewEvent.setIsExpanded(!isExpanded)`. Two distinct svgs, **no rotation animation**. |
| if `isHovered` notifier provided (spaces, section folders, favorites) | arrow wrapped in `Opacity(isHovered ? 1 : 0)` — arrows are invisible until the mouse is anywhere inside the whole section/space list (`MouseRegion` around the list). Still hit-testable while invisible. |

Children presence is known because every `ViewBloc.initial` with `shouldLoadChildViews` fetches `FolderEventGetView(ViewIdPB{value: view.id})` and stores `childViews` (one level). So each visible row triggers one `GetView`.

#### View icon (`_buildViewIconButton`)
- `iconData = view.icon.toEmojiIconData()` (`shared/icon_emoji_picker/flowy_icon_emoji_picker.dart`): `ViewIconPB.ty` → `FlowyIconType`: `Emoji→emoji`, `Icon→icon`, `Url→custom`; `value` string.
- Non-empty → `RawEmojiIconWidget(emoji: iconData, emojiSize: 16, lineHeight: 18/16)` (`plugins/document/presentation/editor_plugins/header/emoji_icon_widget.dart`):
  - `emoji`: emoji text 16px.
  - `icon`: `value` is JSON `{"groupName":..,"iconName":..,"color":..?}` → svg from built-in icon groups (`kIconGroups`), 16px, tinted with `color` (hex string) if present.
  - `custom`: URL → network svg/image 16×16 with header `Authorization: Bearer <jsonDecode(user.token).access_token>`; non-URL → local file path (svg or raster, `BoxFit.cover`). Error → "❓".
- Empty → `Opacity(0.6, view.defaultIcon())`; default icon per layout (`ViewLayoutExtension.icon`):

| `ViewLayoutPB` | Default svg |
|---|---|
| Document (0) | `FlowySvgs.icon_document_s` |
| Grid (1) | `FlowySvgs.icon_grid_s` |
| Board (2) | `FlowySvgs.icon_board_s` |
| Calendar (3) | `FlowySvgs.icon_calendar_s` |
| Chat (4) | `FlowySvgs.chat_ai_page_s` |

- Wrapper: `SizedBox(width: 16)`, `FlowyTooltip(LocaleKeys.document_plugins_cover_changeIcon "Change icon")`, inner `GestureDetector(onTap: (){})` swallows the row tap.
- Click → `AppFlowyPopover(direction: rightWithCenterAligned, offset: (20,0), constraints: loose(364×356), margin: 0)` containing `FlowyIconEmojiPicker(initialType: current type tab, tabs: [emoji, icon, custom], documentId: view.id)`. On select → `ViewBackendService.updateViewIcon(view, r.data)`; closes unless `r.keepOpen` (random pick).
- `view.isLocked == true` → icon wrapped in `LockPageButtonWrapper` = `FlowyTooltip(LocaleKeys.lockPage_lockedOperationTooltip "Page locked to prevent accidental editing.") + IgnorePointer` (no visual dimming).

#### Right icons (shown only while hovered or `showActions`)
Default (no `rightIconsBuilder`):
1. `···` button: `FlowyTooltip(LocaleKeys.menuAppHeader_moreButtonToolTip "Remove, rename, and more...")` → `FlowyIconButton(width: 24 (24×24), icon: FlowySvg(FlowySvgs.workspace_three_dots_s))`, radius 6, hover bg `colorScheme.secondary`; press → open more-actions popover (2C.4).
2. Only if `view.layout == ViewLayoutPB.Document`: `HSpace(8)` + `+` button: `FlowyTooltip(LocaleKeys.menuAppHeader_addPageTooltip "Quickly add a page inside")` → `ViewAddButton` (24×24, `FlowySvgs.view_item_add_s`) (2C.3).
3. `HSpace(4)`.

Overrides used elsewhere:
- Favorites (`favorites/favorite_folder.dart`): `[Listener(FavoriteMoreActions), HSpace(8), Listener(FavoritePinAction), HSpace(4)]`; pointer-down on them sets `ViewEvent.setIsEditing(true)`.
- Shared section (`features/shared_section/presentation/widgets/shared_page_list.dart`): `[IntrinsicWidth(SharedPageActionsButton(... FlowyIconButton 24, workspace_three_dots_s)), SizedBox(width 4)]`.
- Move-to menu: `[]` (no buttons).

#### Inline rename popover (F2)
- Only the row with `isSelected == true` wraps itself in `AppFlowyPopover(controller: getIt<RenameViewBloc>().state.controller, triggerActions: none, offset: (0,5), direction: bottomWithLeftAligned)` with `RenameViewPopover(view, name: view.name, emoji, showIconChanger: false)` (`workspace/presentation/widgets/rename_view_popover.dart`).
- Hotkey `F2` (scope in-app, `workspace/presentation/home/hotkeys.dart`) → `getIt<RenameViewBloc>().add(RenameViewEvent.open())` → `controller.show()`.
- Popover content: `SizedBox(height 32, width 220)` `FlowyTextField(maxLength 256, showCounter false)`, initial text = `view.name` fully selected.
- Submit (Enter) or cancel (`onCanceled`, i.e. Esc/blur) both call `_updateViewName(text)`: if `name.isNotEmpty && name != original` → `FolderEventUpdateView(UpdateViewPayloadPB{view_id, name})` then close. Empty or unchanged → popover stays open (AMBIGUOUS: only Esc/outside-click closes it then).
- AMBIGUOUS: the single shared `PopoverController` is attached by every row that is currently selected; if the same view is visible twice (e.g. Favorites + Space), the last-built one is the anchor.

### 2C.3 "+" add-child button (`view_add_button.dart`)

- `PopoverActionList<PopoverAction>(direction: bottomWithLeftAligned, offset: (0,8), constraints: minWidth 200)`; trigger `FlowyIconButton(width 24, FlowySvg(FlowySvgs.view_item_add_s, color: isHovered ? colorScheme.onSurface : null))`; press → `onEditing(true)` (keeps row highlighted) + show.
- Items = `pluginBuilders()` (`startup/plugin/plugin.dart`: all registered builders whose `PluginConfig.creatable != false`, in registration order from `startup/tasks/load_plugin.dart`), then one "Import" item per registered `DocumentPluginBuilder`:

| # | Item | Icon (16×16) | Label | Layout |
|---|---|---|---|---|
| 1 | `DocumentPluginBuilder` | `FlowySvgs.icon_document_s` | `LocaleKeys.document_menuName` "Document" | Document |
| 2 | `GridPluginBuilder` | `FlowySvgs.icon_grid_s` | `LocaleKeys.grid_menuName` "Grid" | Grid |
| 3 | `BoardPluginBuilder` | `FlowySvgs.icon_board_s` | `LocaleKeys.board_menuName` "Board" | Board |
| 4 | `CalendarPluginBuilder` | `FlowySvgs.icon_calendar_s` | `LocaleKeys.calendar_menuName` "Calendar" | Calendar |
| 5 | `AIChatPluginBuilder` | `FlowySvgs.chat_ai_page_s` | literal `"AI Chat"` (not localized) | Chat |
| 6 | `ViewImportActionWrapper` | `FlowySvgs.icon_import_s` | `LocaleKeys.moreAction_import` "Import" | — |

Not offered (creatable=false): Blank, Trash, DatabaseDocument. No feature-flag gating of AI Chat in this checkout.

- On select: `onEditing(false)`, popover closes, then:
  - Layout item → `onSelected(builder, null, null, openAfterCreated=true, createNewView=true)`.
  - Import → `showImportPanel(parentViewId, ...)` (2C.3.1); after import completes → `onSelected(DocumentPluginBuilder, null, null, true, createNewView=false)`.
- `SingleInnerViewItem._onSelected` (row "+"):
  - `name = layout in [Document, Chat] ? '' : LocaleKeys.menuAppHeader_defaultNewPageName ("Untitled")`.
  - `ViewBloc.add(ViewEvent.createView(name, layout, openAfterCreated: true, section: spaceType.toViewSectionPB))` then `ViewEvent.setIsExpanded(true)`.
  - BUG/AMBIGUOUS: `createNewView` is ignored here, so "Import" from a row's `+` additionally creates an empty Document child and opens it. (The space-header `+` honours `createNewView`.) Decide whether to replicate.

#### 2C.3.1 Import panel (`menu/sidebar/import/import_panel.dart`, `import_type.dart`)
- `FlowyOverlay.show` → `FlowyDialog(bg colorScheme.surface, title FlowyText.semibold(LocaleKeys.moreAction_import, fontSize 20, color colorScheme.tertiary))`, body padding v10 h20; panel size width = 70% window width, height = width × 0.5; `GridView.count(crossAxisCount 2, childAspectRatio 5)` of `Card(FlowyButton(leftIcon 20×20 tinted tertiary, FlowyText.medium 15px tertiary))`; Esc closes; centered `CircularProgressIndicator` while importing.
- Types (release build shows only those with `enableOnRelease`):

| `ImportType` | Label key | Icon | Extensions | Release? | `ImportTypePB` / layout |
|---|---|---|---|---|---|
| historyDocument | `importPanel_documentFromV010` | `board_s` | afdoc | debug only | Markdown / Document (migrated via `EditorMigration`) |
| historyDatabase | `importPanel_databaseFromV010` | `document_s` | afdb | debug only | HistoryDatabase / Grid |
| markdownOrText | `importPanel_textAndMarkdown` "Text & Markdown" | `text_s` | md, txt | yes | Markdown / Document (`customMarkdownToDocument` → `DocumentDataPB` bytes) |
| csv | `importPanel_csv` "CSV" | `board_s` | csv | yes | CSV / Grid (utf8 bytes) |
| afDatabase | `importPanel_database` | `board_s` | afdb | debug only | AFDatabase / Grid |

- Multi-select allowed for all. Name = file basename without extension.
- Event: `FolderEventImportData(ImportPayloadPB{parent_view_id, items: [ImportItemPayloadPB{name, data: bytes, view_layout, import_type}]})` → `RepeatedViewPB`.

### 2C.4 "More" (`···`) menu — `view_more_action_button.dart`, `view_action_type.dart`

Container: `PopoverActionList<ViewMoreActionTypeWrapper>(direction: bottomWithLeftAligned, offset: (0,8), constraints: BoxConstraints(minWidth: 260), showAtCursor: false)`; `onPopupBuilder` → `onEditing(true)`; `onClosed` → `onEditing(false)`. Right-click opens the same popover at `pointer + (4,0)` via `controller.showAt`.

The more-button is wrapped in a **fresh** `SpaceBloc(userProfile, workspaceId)..add(SpaceEvent.initial(openFirstPage: false))` per row (used for the Move-to submenu).

#### Action order (exact)

Tree rows (`spaceType` private/public/unknown):
1. `favorite` if `!view.isFavorite`, else `unFavorite`
2. `divider`
3. `rename`
4. `changeIcon` — only if `layout != Chat`
5. `duplicate` — only if `layout != Chat`
6. `moveTo` — rendered as `SizedBox.shrink()` (hidden) unless `SpaceBloc.userProfile.workspaceType == WorkspaceTypePB.ServerW` (cloud/self-hosted server workspace; hidden for local workspaces)
7. `delete`
8. `divider`
9. `collapseAllPages` + `divider` — only if `layout != Chat && view.childViews.isNotEmpty && isExpanded`
10. `openInNewTab`

Favorites rows (`spaceType == favorite`, via `FavoriteMoreActions`): `unFavorite`, `divider`, `rename`, `openInNewTab`.

Shared-section rows (`SharedPageActionsButton`, different widget, same enum): `favorite|unFavorite`, `leaveSharedPage`, then if access != readOnly: `divider`, `rename`, `changeIcon` (non-Chat), `delete` (only fullAccess); then `divider`, `openInNewTab`.

#### Action metadata

| `ViewMoreActionType` | Label key → en-US | Left icon | Disabled when `view.isLocked` |
|---|---|---|---|
| `favorite` | `disclosureAction_favorite` "Add to Favorites" | `FlowySvgs.favorite_s` | no |
| `unFavorite` | `disclosureAction_unfavorite` "Remove from Favorites" | `FlowySvgs.unfavorite_s` | no |
| `rename` | `disclosureAction_rename` "Rename" | `FlowySvgs.view_item_rename_s` | **yes** |
| `changeIcon` | `disclosureAction_changeIcon` "Change icon" | `FlowySvgs.change_icon_s` | **yes** |
| `duplicate` | `disclosureAction_duplicate` "Duplicate" | `FlowySvgs.duplicate_s` | no |
| `moveTo` | `disclosureAction_moveTo` "Move to" | `FlowySvgs.move_to_s` | **yes** |
| `delete` | `disclosureAction_delete` "Delete" | `FlowySvgs.trash_s` | **yes** |
| `collapseAllPages` | `disclosureAction_collapseAllPages` "Collapse all subpages" | `FlowySvgs.collapse_all_page_s` | no |
| `openInNewTab` | `disclosureAction_openNewTab` "Open in a new tab" | `FlowySvgs.view_item_open_in_new_tab_s` | no |
| `lockPage` (not in sidebar menu) | `disclosureAction_lockPage` "Lock page" | `FlowySvgs.lock_page_s` | — |
| `leaveSharedPage` | literal `'Leave'` | `FlowySvgs.leave_workspace_s` | — |
| `copyLink` (unused) | `disclosureAction_copyLink` "Copy link" | throws (no icon) | — |
| `divider`, `lastModified`, `created` | '' | — (lastModified/created render empty 40px boxes; unused) | — |

- Locked-disabled items are wrapped in `LockPageButtonWrapper` (tooltip `lockPage_lockedOperationTooltip`, `IgnorePointer`); no dimming.
- `rightIcon` is `SizedBox.shrink()` for every type (no chevrons, even for submenus).

#### Item visuals (`ViewMoreActionTypeWrapper._buildActionButton`)
- `Container(height: 34, padding: vertical 2)` → `FlowyIconTextButton(margin: horizontal 6 (vertical 0), iconPadding 10, leftIconSize 16×16, hover radius 6, hover bg colorScheme.secondary)`.
- Text: `FlowyText.regular(name, fontSize 14, lineHeight 1.0, figmaLineHeight 18)`.
- `delete` on hover: icon and text color → `colorScheme.error` (#FB006D).
- Divider: `Padding(all 8)` + `FlowyDivider` (1px, `AFThemeExtension.borderColor`) → 17px tall.

#### Action handlers (in `SingleInnerViewItem._buildViewMoreActionButton.onAction`)

Every item tap first calls `onEditing(false)`, then the handler, then closes the popover (except icon-picker results with `keepOpen`).

| Action | Behaviour / events |
|---|---|
| favorite / unFavorite | `FavoriteBloc.add(FavoriteEvent.toggle(view))` → if already favorited: unpin (`UpdateView` extra `is_pinned:false`); else if `pinnedViews.length < 3`: pin (`FolderEventUpdateView(UpdateViewPayloadPB{view_id, extra: jsonEncode(merge(oldExtra, {"is_pinned": true}))})`); then `FolderEventToggleFavorite(RepeatedViewIdPB{items:[id]})`. Backend emits `DidFavoriteView`/`DidUnfavoriteView` (subject `"favorite"`) + `DidUpdateView` (subject view id). |
| rename | `showAFTextFieldDialog` (2C.6) → `ViewEvent.rename(newValue)` |
| changeIcon | submenu `AppFlowyPopover(constraints loose 364×356, margin 0, clickHandler gestureDetector, direction default rightWithTopAligned)` → `FlowyIconEmojiPicker(tabs: [emoji, icon, custom], documentId: view.id)` → `ViewBackendService.updateViewIcon` (2C.7) |
| duplicate | `ViewEvent.duplicate()` (2C.7) |
| moveTo | submenu (2C.5) → `moveViewCrossSpace(ctx, space, view, parentView, spaceType, view, target.id)` |
| delete | `ViewBackendService.containPublishedPage(view)` (recursive `GetView` of all descendants + `FolderEventGetPublishInfo(ViewIdPB)` per view; success ⇒ published). If any published → `showConfirmDeletionDialog(name: view.name, description: LocaleKeys.publish_containsPublishedPage)` and delete on confirm; **otherwise delete immediately, no confirmation**. → `ViewEvent.delete()` |
| openInNewTab | `TabsBloc.openTab(view)` = `TabsEvent.openTab(plugin: view.plugin(), view: view)` |
| collapseAllPages | `ViewEvent.collapseAllPages()` |
| others | throw `UnsupportedError` |

Favorites variant handlers (`favorite_more_actions.dart`): unFavorite → `FavoriteEvent.toggle` + close all popovers; rename → same dialog but calls `ViewBackendService.updateView(viewId, name)` directly; openInNewTab → `getIt<TabsBloc>().openTab(view)`.

`showConfirmDeletionDialog` (`workspace/presentation/widgets/dialogs.dart`): `Dialog(radius 12)` → `SizedBox(width 440)` → `ConfirmPopup(title: LocaleKeys.space_deleteConfirmation ("Delete: ") + name, description, style cancelAndOk)`; confirm label `LocaleKeys.space_delete` "Delete", confirm color `colorScheme.error`; Esc closes, Enter (key-up) confirms; container radius `theme.borderRadius.xl`, padding `theme.spacing.xxl`, bg `AppFlowyTheme.surfaceColorScheme.primary`; title style `textStyle.heading4.prominent`; description `textStyle.body.standard`, maxLines 5; close button `FlowySvgs.password_close_m` 20px.

### 2C.5 Move-to submenu (`menu/sidebar/move_to/move_page_menu.dart`)

- Popover: `AppFlowyPopover(constraints: maxWidth 260, maxHeight 345, margin: h14 v12, clickHandler gestureDetector, direction: rightWithTopAligned)`; shares the row's `SpaceBloc`.
- Content (`MovePageMenu(sourceView, onSelected(space, view))`), `SpaceSearchBloc` (`workspace/application/sidebar/space/space_search_bloc.dart`):
  1. `SpaceSearchField(width 240)`: height 30, 1.2px outside border, autofocus; typing → `SpaceSearchEvent.search(text)`.
  2. `VSpace(10)`.
  3. No query: `SpacePopup(height 30, expand, showCreateButton false)` with tooltip `LocaleKeys.space_switchSpace` "Switch space" around `CurrentSpace` (tap on blank area → `onSelected(space, space)` = move to the root of the current space); below, scrollable `SpacePages(space: currentSpace, isHovered: ValueNotifier(true) (arrows always visible), isExpandedNotifier: PropertyValueNotifier(true), disableSelectedStatus: true, rightIconsBuilder: [] , shouldIgnoreView: view.id == source.id → hide (hides the source and its subtree); layout != Document → disable (opacity .5, forbidden cursor, tooltip `space_cannotMovePageToDatabase` "Cannot move page to database"), onSelected: (view) → onSelected(space, view))`.
  4. With query: flat list of `ViewItem(level 0, spaceType unknown, isDraggable false, shouldRenderChildren false, leftIcon HSpace(0), rightIcons [])` of results excluding the source and spaces. AMBIGUOUS: non-document results are NOT disabled here.
- Not available for local workspaces (item hidden).
- `moveViewCrossSpace(context, toSpace, view, parentView, spaceType, from, toId)` (`view_item.dart`):
  1. return if `isReferencedDatabaseView(view, parentView)` or `from.id == toId`.
  2. if `SpaceBloc.state.currentSpace.id != toSpace.id` → `ViewEvent.unpublish(sync: false)` (fire-and-forget unpublish of view + published descendants) and `switchToSpaceNotifier.value = toSpace` (sidebar switches to target space).
  3. `ViewEvent.move(from, toId, prevId: null, fromSection: null, toSection: null)` → moved view becomes **first** child of target.

### 2C.6 Rename flows summary

| Entry | UI | Validation | Event |
|---|---|---|---|
| More menu → Rename (tree) | `showAFTextFieldDialog` (`workspace/presentation/widgets/dialog_v2.dart`): `AFModal(maxWidth AFModalDimension.S = 400)`; `AFModalHeader(leading Text(LocaleKeys.disclosureAction_rename "Rename"), trailing AFGhostButton.normal(FlowySvgs.toast_close_s 20px, padding theme.spacing.xs))`; `AFModalBody(AFTextField(autoFocus, size m, maxLength 256, initial nameOrDefault, all selected))`; `AFModalFooter(trailing: AFOutlinedTextButton.normal(button_cancel "Cancel"), AFFilledTextButton.primary(button_confirm "Confirm", disabled when trim() empty))`; barrier color `AppFlowyTheme.surfaceColorScheme.overlay`, barrierDismissible | trimmed, non-empty; Rust `ViewName::parse`: > 256 graphemes → `ErrorCode::ViewNameTooLong` | `ViewEvent.rename(name)` → `FolderEventUpdateView(UpdateViewPayloadPB{view_id, name})`; on success bloc locally rebuilds `state.view.name` |
| More menu → Rename (favorites) | same dialog | same | `ViewBackendService.updateView(viewId, name)` directly |
| F2 | inline popover under selected row (2C.2) | non-empty and changed; not trimmed | `FolderEventUpdateView(name)` |

No inline (in-row) text editing exists in the desktop sidebar.

### 2C.7 ViewBloc (`workspace/application/view/view_bloc.dart`)

Constructor: `ViewBloc({required ViewPB view, bool shouldLoadChildViews = true, bool engagedInExpanding = false})`; creates `ViewListener(viewId: view.id)` and `FavoriteListener()`; if `engagedInExpanding` registers `ViewExpander(() => state.isExpanded, () => add(setIsExpanded(true)))` in `getIt<ViewExpanderRegistry>()` (`util/expand_views.dart`) under `view.id`. Note `view` (constructor arg) is never updated; several handlers use it (`view.id`, `view.childViews`).

State `ViewState`:
| Field | Init | Meaning |
|---|---|---|
| `view: ViewPB` | ctor view | current node incl. one level `childViews` |
| `isEditing: bool` | false | a row popover is open (keeps highlight + action icons) |
| `isExpanded: bool` | false | children visible |
| `successOrFailure` | success | last op result |
| `isDeleted` | false | set after delete |
| `isLoading` | true | |
| `lastCreatedView: ViewPB?` | null | triggers `TabsBloc.openPlugin` in `ViewItem` listener |

Events:
| Event | Handler |
|---|---|
| `initial()` | start `ViewListener` (onViewUpdated → `viewDidUpdate`, onViewChildViewsUpdated → `_updateChildViews` → `viewUpdateChildView`); start `FavoriteListener` (if payload contains this view id → `viewDidUpdate(thatView)`); `isExpanded = KV['expandedViews'][view.id] ?? false`; if `shouldLoadChildViews` → `FolderEventGetView(ViewIdPB{value: id})` and replace `childViews` |
| `setIsEditing(bool)` | emit |
| `setIsExpanded(bool)` | if expanding from collapsed → reload children via `GetView`, emit expanded; else emit; persist in KV `expandedViews` (add `id:true` / remove key) |
| `viewDidUpdate(result)` | re-fetch `FolderEventGetView(view.id)`; emit `view: fetched ?? notified` |
| `rename(newName)` | `ViewBackendService.updateView(viewId, name)` |
| `delete()` | `_unpublishPage` (for each published page in subtree: `FolderEventUnpublishViews(UnpublishViewsPayloadPB{view_ids:[id]})`), then `FolderEventDeleteView(RepeatedViewIdPB{items:[id]})` (moves to trash), emit `isDeleted: true`, then `CachedRecentService.updateRecentViews([id], false)` → `FolderEventUpdateRecentViews(UpdateRecentViewPayloadPB{view_ids:[id], add_in_recent:false})` |
| `duplicate()` | `FolderEventDuplicateView(DuplicateViewPayloadPB{view_id, open_after_duplicate: true, include_children: true, sync_after_create: true, suffix: ' (' + LocaleKeys.menuAppHeader_pageNameSuffix ("Copy") + ')'})`; parent_view_id unset (same parent). Backend: root copy name = `(name.isEmpty ? "Untitled" : name) + suffix`, descendants keep names; copy inserted at `index` = source's index among non-trashed siblings (AMBIGUOUS whether before/after source — collab insert-at-index semantics); root copy created with `set_as_current = true` → `DidUpdateWorkspaceSetting` → `HomeBloc.latestView` → opened by the home screen listener (not by ViewBloc). |
| `move(from, newParentId, prevId?, fromSection?, toSection?)` | `FolderEventMoveNestedView(MoveNestedViewPayloadPB{view_id: from.id, new_parent_id, prev_view_id?, from_section?, to_section?})`. `prev_view_id` null ⇒ first child. Backend rejects locked views (`view_is_locked`); if `from_section != to_section`: to Private ⇒ add to private ids, else remove from private ids; then `notify_parent_view_did_change([new_parent, old_parent])` |
| `createView(name, layout, {openAfterCreated = true, section?})` | `ViewBackendService.createView(parentViewId: view.id, name, layoutType, ext: {}, openAfterCreate, section)`; emit `lastCreatedView` |
| `viewUpdateChildView(ViewPB)` | emit `view` |
| `updateViewVisibility(view, isPublic)` | `FolderEventUpdateViewVisibilityStatus(UpdateViewVisibilityStatusPayloadPB{view_ids:[id], is_public})` |
| `updateIcon(String?)` | re-sends current icon (effectively no-op) |
| `collapseAllPages()` | for each **direct** child of ctor `view`: remove from KV `expandedViews`; then `setIsExpanded(false)` |
| `unpublish({sync})` | `_unpublishPage` awaited or not |

`_updateChildViews(ChildViewUpdatePB u)`:
- `u.create_child_views` non-empty → refetch parent `GetView(u.parent_view_id)` and use it.
- `u.delete_child_views` non-empty → remove those ids from local `childViews`.
- `u.update_child_views` non-empty → refetch parent; replace only if child order/length differs (otherwise no change — per-child updates come via each child's own `DidUpdateView`).

#### Collapse-all broadcast
- `SidebarSpace` keeps `isExpandedNotifier = PropertyValueNotifier(false)`; space menu "collapse all" sets `.value = true`; every `InnerViewItem` listens and, when value is true, dispatches `collapseAllPages` on its own ViewBloc.

#### Expansion persistence & auto-expand
- KV key `KVKeys.expandedViews = 'expandedViews'`, value JSON `{"<viewId>": true, ...}` (collapsed ids are removed). Read only in `ViewEvent.initial`.
- Adding a child via row `+` → `setIsExpanded(true)` on the parent.
- Opening a page (`TabsBloc` openPlugin with `setLatest`, non-space view) → `_expandAncestors(view)` (`workspace/application/tabs/tabs_bloc.dart`): if `ViewExpanderRegistry.isViewExpanded(view.parentViewId)` return; else `FolderEventGetViewAncestors(ViewIdPB{value: view.id})` → set every ancestor id `true` in `expandedViews`, then call `expand()` on the first registered-but-collapsed ancestor expander. AMBIGUOUS: expanders are registered only by `engagedInExpanding` items (section-folder mode); in Space mode only the KV is updated, so the live tree may not expand until rebuilt.

#### Selection
- Selected row = `getIt<MenuSharedState>().latestOpenView?.id == view.id` (`workspace/presentation/home/menu/menu_shared_state.dart`, `ValueNotifier<ViewPB?>`).
- Set by `TabsBloc._setLatestOpenView` on open/select/close tab (from the active page manager's `ViewPluginNotifier.view`). Set to `null` when opening Trash, Templates (footer), command palette actions, and `view_title_bar.dart` line ~313.
- Space views are never set as latest (`view.isSpace` filtered).

#### Click semantics (all sidebar callers: `sidebar_space.dart`, `_section_folder.dart`, `favorite_folder.dart`)
- Left click: `if (HardwareKeyboard.instance.isControlPressed) TabsBloc.openTab(view);` **then always** `TabsBloc.openPlugin(view)`. (Ctrl only — no Meta check; on Windows Ctrl+click opens a new tab and also switches current tab content.) Resolved (verified in `tabs_bloc.dart`): `openTab` → `TabsState.openView` appends a new `PageManager` with the plugin and selects it (or selects the existing tab with that `plugin.id`); the following `openPlugin` → `TabsState.openPlugin` finds that same id at `currentIndex` and returns state unchanged (it only re-runs `_setLatestOpenView` + `_expandAncestors`). Net effect of Ctrl+click = exactly one new foreground tab (or focus of the existing one).
- Middle button down: `TabsBloc.openTab(view)`.
- Right click: more-actions popover at cursor (when `enableRightClickContext`).
- Tap on icon: icon picker (does not select). Tap on arrow: toggle expand only.

### 2C.8 Drag & drop (`draggable_view_item.dart`, `workspace/presentation/widgets/draggable_item/draggable_item.dart`)

Structure (desktop):
```
DraggableItem<ViewPB>(data: view)           // DragTarget + Draggable around the WHOLE node (row + expanded children)
 └ Column[
     if isFirstChild: Divider(height 2, thickness 2, color: top ? #00C8FF : transparent),
     DecoratedBox(radius 6, color: center ? #00C8FF @ 50% : transparent, child: node),
     Divider(height 2, thickness 2, color: bottom ? #00C8FF : transparent),
   ]
```
- Every draggable row therefore occupies 30 + 2 (bottom divider) px; first child 30 + 4. Non-draggable rows add `Padding(top: 2)` to match.
- Drag source: Flutter desktop `Draggable` (starts after pointer slop, no long-press). `childWhenDragging` = original (source stays visible). Feedback: `IntrinsicWidth(Opacity(0.5, Container(width 250, color: light ? white : black54, radius 8, child: ViewItem(isFeedback: true, isDraggable: false, same level/leftPadding))))`, anchored so the ghost keeps the grab offset.
- Auto-scroll: `EdgeDraggingAutoScroller(velocityScalar: 20)` on the enclosing scrollable, hit rect = pointer position & 100×100; disabled while hovering an open document (`disableAutoScrollWhenDragging`).
- `onDragging(true/false)` sets module flag `_isDragging` (freezes hover highlight changes).

Hover-position computation (`onMove`): `offset = renderBox.globalToLocal(details.offset)` where `details.offset` is the **ghost's top-left** (pointer minus grab offset), and `renderBox` is the whole `DraggableViewItem` (row + expanded children + dividers).
- `offset.dx > width` → ignore.
- `threshold = height / 5`.
- `isFirstChild && offset.dy < -5` → `top`.
- `offset.dy > threshold` → `bottom`.
- else → `center`.
- Position applied only if `_shouldAccept(data, position)`; `onLeave` → none.

`_shouldAccept(dragged, position)`:
- target is database (Grid/Board/Calendar) && position == center → reject.
- `dragged.id == target.id` → reject.
- target is inside dragged's subtree (`dragged.containsView(target)` over loaded `childViews`) → reject.
- `onWillAcceptWithDetails` always true (the DragTarget always accepts; invalid positions just don't update the indicator — AMBIGUOUS: dropping when the last valid position is stale will use that stale position).

Drop (`_move(from, to)`):
| Position | Guard | Event |
|---|---|---|
| center | `to.layout != Document` → no-op (also blocks Chat) | `ViewEvent.move(from, newParentId: to.id, prevId: to.childViews.lastOrNull?.id, fromSection, toSection)` → becomes last child of target |
| top (first child only) | — | `move(from, to.parentViewId, prevId: null, ...)` → becomes first child of target's parent |
| bottom | — | `move(from, to.parentViewId, prevId: to.id, ...)` → placed right after target |
- `fromSection/toSection = SidebarSectionsBloc.getViewSection(view)`: `Public` if id ∈ `state.section.publicViews` (root level), `Private` if ∈ `privateViews`, else null (any nested view, and all views inside spaces since only spaces are root).
- The event is dispatched on the **target row's** ViewBloc (`context.read<ViewBloc>()` of the drop target); result only stored in that bloc.
- Placeholder (`isPlaceholder`, used when a section is empty in non-space mode, `ViewPB(parentViewId: workspaceId)`): `onMove` override → `moveViewCrossSpace(ctx, null, placeholderView, parentView, spaceType, from, to.parentViewId)` → `move(from, workspaceId, null, null, null)`.
- Not drop targets: favorites rows, shared rows, linked-database child rows (`isReferencedDatabaseView`), move-to menu rows.
- Dropping a sidebar row onto an open document editor (`plugins/document/presentation/editor_drop_handler.dart`, `DragTarget<ViewPB>`, rejects the document's own id) inserts `pageMentionNode(view.id)` at the drop path (not a move).
- Mobile variant (ignore): Stack + `colorScheme.secondary` indicators, haptics.

### 2C.9 "Add new page" — all creation paths from the sidebar

| Entry | Condition | Call | `CreateViewPayloadPB` | Open after |
|---|---|---|---|---|
| Row `+` → layout (2C.3) | row is Document | `ViewBloc.createView` → `ViewBackendService.createView` | `parent_view_id = row.id`, `name` = '' (Document/Chat) or "Untitled", `layout`, `set_as_current = true`, `initial_data = []`, `meta` empty, `section = spaceType.toViewSectionPB` (Private/Public), `index` unset (append), `view_id` unset | `ViewItem` listener → `TabsBloc.openPlugin(lastCreatedView)`; parent auto-expanded |
| Space header `+` (`space/sidebar_space_header.dart`, tooltip `LocaleKeys.sideBar_addAPage` "Add a new page") | spaces exist; same `ViewAddButton` items | `SpaceEvent.createPage(name: '', layout, index: 0, openAfterCreate: true)` + `SpaceEvent.expand(space, true)` | `parent_view_id = currentSpace.id`, `name = ''` (all layouts), `layout`, `set_as_current = true`, `index = 0` (top), no section | `Sidebar` `BlocListener<SpaceBloc>` on `lastCreatedPage` → `TabsEvent.openPlugin(plugin: page.plugin())` (empty id → `BlankPagePlugin`) |
| "New page" button (`shared/sidebar_new_page_button.dart`; label `LocaleKeys.newPageText` "New page"; `FlowySvgs.new_app_m` 24×24 untinted; height 30 (`HomeSizes.newPageSectionHeight`), padding h8, margin left 4, iconPadding 8, `FlowyText.regular` lineHeight 1.15) and hotkey **Ctrl/Cmd+N** (`createNewPageNotifier`) | spaces exist | `SpaceEvent.createPage(name: '', index: 0, layout: Document, openAfterCreate: true)` | as above, Document | as above |
| same | no spaces (legacy) | `SidebarSectionsEvent.createRootViewInSection(name: '', viewSection: isCollabWorkspaceOn ? Private : Public, index: 0)` → `WorkspaceService.createView` | `parent_view_id = workspaceId`, `name ''`, `layout Document`, `section`, `index 0`; `set_as_current` unset (false) | `BlocListener<SidebarSectionsBloc>` on `lastCreatedRootView` → `openPlugin` |
| Section folder header `+` (`folder/_section_folder.dart`, non-space mode) | — | `createRootViewInSection(name '', index 0, viewSection: spaceType.toViewSectionPB)` + expand folder | as above | as above |

- Default names: `ViewLayoutExtension.defaultName` = '' for Document, `LocaleKeys.menuAppHeader_defaultNewPageName` ("Untitled") otherwise; display always uses `nameOrDefault`.
- Backend: `create_view_handler` → `create_view_with_params(params, notify=true)`; `set_as_current` → `set_current_view` (adds to recent, sends `DidUpdateWorkspaceSetting`). Collab observer then emits `DidUpdateChildViews(parent, create_child_views:[v])` and `DidUpdateView(parent with children)` or, for workspace-root parents, `DidUpdateWorkspaceViews` + 2× `DidUpdateSectionViews`.

### 2C.10 Other view service calls (`workspace/application/view/view_service.dart`)

| Static method | Event | Payload fields set |
|---|---|---|
| `createView({layoutType, parentViewId, name, openAfterCreate=false, initialDataBytes, ext={}, index, section, viewId})` | `FolderEventCreateView` | parent_view_id, name, layout, set_as_current, initial_data (or []), meta (= ext, e.g. `{"database_id": id}` for linked views), index?, section?, view_id? |
| `createOrphanView({viewId, layoutType, name, initialDataBytes})` | `FolderEventCreateOrphanView` | view_id, name, layout, initial_data |
| `createDatabaseLinkedView({parentViewId, databaseId, layoutType, name})` | `FolderEventCreateView` | meta `{"database_id": databaseId}` |
| `getChildViews({viewId})` | `FolderEventGetView` | `ViewIdPB{value}` → `.childViews` |
| `getView(viewId)` | `FolderEventGetView` | |
| `deleteView({viewId}) / deleteViews({viewIds})` | `FolderEventDeleteView` | `RepeatedViewIdPB{items}` |
| `duplicate({view, openAfterDuplicate, includeChildren, parentViewId?, suffix?, syncAfterDuplicate})` | `FolderEventDuplicateView` | view_id, open_after_duplicate, include_children, sync_after_create, parent_view_id?, suffix? (backend default suffix " (copy)") |
| `favorite({viewId})` | `FolderEventToggleFavorite` | `RepeatedViewIdPB` |
| `updateView({viewId, name?, isFavorite?, extra?})` | `FolderEventUpdateView` | view_id + set optionals |
| `updateViewIcon({view, viewIcon})` | `FolderEventUpdateViewIcon` | `UpdateViewIconPayloadPB{view_id, icon: ViewIconPB{ty, value}}`; if old icon was `custom` and value changed → also `DocumentEventDeleteFile(DeleteFilePB{url: oldValue})` |
| `moveView({viewId, fromIndex, toIndex})` (deprecated) | `FolderEventMoveView` | `MoveViewPayloadPB{view_id, from, to}` |
| `moveViewV2({viewId, newParentId, prevViewId?, fromSection?, toSection?})` | `FolderEventMoveNestedView` | `MoveNestedViewPayloadPB` |
| `getAllViews()` | `FolderEventGetAllViews` | — |
| `getViewAncestors(viewId)` | `FolderEventGetViewAncestors` | `ViewIdPB` → `RepeatedViewPB` (root→leaf, AMBIGUOUS order) |
| `updateViewsVisibility(views, isPublic)` | `FolderEventUpdateViewVisibilityStatus` | view_ids, is_public |
| `getPublishInfo(view)` | `FolderEventGetPublishInfo` | `ViewIdPB` (error ⇒ not published) |
| `publish(view, {name, selectedViewIds})` | `FolderEventPublishView` | `PublishViewParamsPB{view_id, publish_name?, selected_view_ids?}` |
| `unpublish(view)` | `FolderEventUnpublishViews` | `UnpublishViewsPayloadPB{view_ids:[id]}` |
| `lockView / unlockView(viewId)` | `FolderEventLockView / UnlockView` | `ViewIdPB` (used by view header, not the sidebar) |
| `getMentionPageStatus(pageId)` | `GetView`, fallback `ListTrashItems` | — |

`ViewPB` derived getters (`view_ext.dart`): `extra` JSON keys `ViewExtKeys`: `font`, `font_layout`, `line_height_layout`, `cover{type,value}`, `is_pinned`, `is_space`, `space_creator`, `space_created_at`, `space_icon` (`"<group>/<icon>"`, legacy `space_icon_N` ⇒ `assets/flowy_icons/16x/<name>.svg`), `space_icon_color`, `space_permission` (0 = `publicToAll`, 1 = `private`; default 1). `pluginType`: Board→board, Calendar→calendar, Document→document, Grid→grid, Chat→chat. `plugin(arguments)`: Grid/Board/Calendar → `DatabaseTabBarViewPlugin(view, pluginType, initialRowId: args['row_id'])`; Document → `DocumentPlugin(view, initialSelection: args['selection'], initialBlockId: args['block_id'])`; Chat → `AIChatPagePlugin(view)`.

### 2C.11 Protobuf reference (flowy-folder)

Wire: each Dart `FolderEventX(req).send()` sends `FFIRequest{event: FolderEvent.X.toString() (enum name, e.g. "CreateView"), payload: req.writeToBuffer()}` via `Dispatch.asyncRequest`; success bytes decoded as the output PB, failure as `FlowyError`.

`rust-lib/flowy-folder/src/entities/view.rs`:

| Message | Fields (index: name type) |
|---|---|
| `ViewPB` | 1 id string; 2 parent_view_id string; 3 name string; 4 create_time i64 (s); 5 child_views repeated ViewPB (only first level, often empty); 6 layout ViewLayoutPB; 7 icon ViewIconPB? (oneof); 8 is_favorite bool; 9 extra string? (JSON); 10 created_by i64?; 11 last_edited i64; 12 last_edited_by i64?; 13 is_locked bool? |
| `ViewLayoutPB` (enum) | Document=0, Grid=1, Board=2, Calendar=3, Chat=4 |
| `ViewSectionPB` (enum) | Private=0 (default), Public=1 |
| `ChildViewUpdatePB` | 1 parent_view_id; 2 create_child_views repeated ViewPB; 3 delete_child_views repeated string; 4 update_child_views repeated ViewPB |
| `SectionViewsPB` | 1 section ViewSectionPB; 2 views repeated ViewPB |
| `RepeatedViewPB` | 1 items repeated ViewPB |
| `RepeatedFavoriteViewPB` / `RepeatedRecentViewPB` | 1 items repeated SectionViewPB |
| `SectionViewPB` | 1 item ViewPB; 2 timestamp i64 |
| `ReadRecentViewsPB` | 1 start u64; 2 limit u64 |
| `RepeatedViewIdPB` | 1 items repeated string |
| `ViewIdPB` | 1 value string |
| `CreateViewPayloadPB` | 1 parent_view_id; 2 name; 3 thumbnail string?; 4 layout; 5 initial_data bytes; 6 meta map<string,string>; 7 set_as_current bool; 8 index u32?; 9 section ViewSectionPB?; 10 view_id string? (UUID, generated if absent/invalid); 11 extra string? |
| `CreateOrphanViewPayloadPB` | 1 view_id; 2 name; 3 layout; 4 initial_data |
| `UpdateViewPayloadPB` | 1 view_id; 2 name?; 3 desc?; 4 thumbnail?; 5 layout?; 6 is_favorite?; 7 extra? (JSON; for documents: `cover{type:"0".."5",value}`, `line_height_layout`, `font_layout`) |
| `DeletedViewPB` | 1 view_id; 2 index i32? |
| `MoveViewPayloadPB` | 1 view_id; 2 from i32; 3 to i32 |
| `MoveNestedViewPayloadPB` | 1 view_id; 2 new_parent_id; 3 prev_view_id?; 4 from_section ViewSectionPB?; 5 to_section ViewSectionPB? |
| `DuplicateViewPayloadPB` | 1 view_id; 2 open_after_duplicate; 3 include_children; 4 parent_view_id?; 5 suffix?; 6 sync_after_create |
| `UpdateRecentViewPayloadPB` | 1 view_ids repeated; 2 add_in_recent bool |
| `UpdateViewVisibilityStatusPayloadPB` | 1 view_ids repeated; 2 is_public |
| `SetPublishNamePB` | 1 view_id; 2 new_name |
| `AFAccessLevelPB` | ReadOnly=0, ReadAndComment=1, ReadAndWrite=2, FullAccess=3 |
| `AFRolePB` | Owner=0, Member=1, Guest=2 |
| `SharedUserPB` | 1 email; 2 name; 3 role; 4 access_level; 5 avatar_url? |
| `RepeatedSharedUserPB` | 1 items |
| `SharedViewPB` / `RepeatedSharedViewResponsePB` | {1 view ViewPB; 2 access_level} / {1 shared_views} |
| `SharedViewSectionPB` | PrivateSection=0, PublicSection=1, SharedSection=2 |
| `SharePageWithUserPayloadPB` | 1 view_id; 2 emails; 3 access_level; 4 auto_confirm |
| `RemoveUserFromSharedPagePayloadPB` | 1 view_id; 2 emails |
| `GetSharedUsersPayloadPB` | 1 view_id |

`icon.rs`: `ViewIconTypePB` Emoji=0, Url=1, Icon=2; `ViewIconPB{1 ty, 2 value}`; `UpdateViewIconPayloadPB{1 view_id, 2 icon ViewIconPB? (absent ⇒ remove icon)}`.

`trash.rs`: `TrashPB{1 id, 2 name, 3 modified_time i64 (s), 4 create_time i64 (s)}`; `RepeatedTrashPB{1 items}`; `TrashIdPB{1 id}`; `RepeatedTrashIdPB{1 items repeated TrashIdPB}`.

`workspace.rs`: `WorkspacePB{1 id, 2 name, 3 views repeated ViewPB, 4 create_time}`; `RepeatedWorkspacePB{1 items}`; `WorkspaceIdPB{1 value}`; `GetWorkspaceViewPB{1 value}`; `WorkspaceLatestPB{1 workspace_id, 2 latest_view ViewPB?}`; `UpdateWorkspacePayloadPB{1 id, 2 name?, 3 desc?}`; `FolderSyncStatePB{1 is_syncing, 2 is_finish}`; `FolderSnapshotPB{1 snapshot_id, 2 snapshot_desc, 3 created_at, 4 data}`.

`import.rs`: `ImportTypePB` HistoryDocument=0, HistoryDatabase=1, Markdown=2, AFDatabase=3, CSV=4; `ImportItemPayloadPB{1 name, 2 data bytes?, 3 file_path?, 4 view_layout, 5 import_type}`; `ImportPayloadPB{1 parent_view_id, 2 items}`; `ImportZipPB{1 file_path}`.

#### FolderEvent table (`packages/appflowy_backend/lib/dispatch/dart_event/flowy-folder/dart_event.dart`, numbers from `rust-lib/flowy-folder/src/event_map.rs`)

"Shell" = used by the desktop home shell (sidebar/tabs/trash/header); "Other" = used elsewhere in desktop; "—" = unused by desktop Dart.

| # | Event | Input | Output | Use |
|---|---|---|---|---|
| 0 | CreateFolderWorkspace | — | void | — |
| 1 | GetCurrentWorkspaceSetting | — | WorkspaceLatestPB | Shell (home load) |
| 2 | ReadCurrentWorkspace | — | WorkspacePB | Shell |
| 3 | DeleteWorkspace | WorkspaceIdPB | void | — |
| 5 | ReadWorkspaceViews | GetWorkspaceViewPB | RepeatedViewPB | Shell (public section views) |
| 10 | CreateView | CreateViewPayloadPB | ViewPB | Shell |
| 11 | GetView | ViewIdPB | ViewPB | Shell |
| 12 | UpdateView | UpdateViewPayloadPB | ViewPB (Rust handler returns `()`, Dart decodes empty ViewPB) | Shell |
| 13 | DeleteView | RepeatedViewIdPB | void | Shell (moves to trash) |
| 14 | DuplicateView | DuplicateViewPayloadPB | ViewPB | Shell |
| 15 | CloseView | ViewIdPB | void | Other (document/database/chat dispose) |
| 16 | CreateOrphanView | CreateOrphanViewPayloadPB | ViewPB | Other |
| 17 | GetAllViews | — | RepeatedViewPB | Other |
| 20 | CopyLink | — | void | — |
| 21 | SetLatestView | ViewIdPB | void | Shell (`home_stack.dart` on plugin open; skipped for blank plugin in this checkout) |
| 22 | MoveView | MoveViewPayloadPB | void | deprecated |
| 23 | ListTrashItems | — | RepeatedTrashPB | Shell (Trash) |
| 24 | RestoreTrashItem | TrashIdPB | void | Shell |
| 25 | PermanentlyDeleteTrashItem | RepeatedTrashIdPB | void | Shell |
| 26 | RecoverAllTrashItems | — | void | Shell |
| 27 | PermanentlyDeleteAllTrashItem | — | void | Shell |
| 30 | ImportData | ImportPayloadPB | RepeatedViewPB | Shell (import panel; also local templates) |
| 31 | GetFolderSnapshots | WorkspaceIdPB | RepeatedFolderSnapshotPB | — |
| 32 | MoveNestedView | MoveNestedViewPayloadPB | void | Shell |
| 33 | ReadFavorites | — | RepeatedFavoriteViewPB | Shell |
| 34 | ToggleFavorite | RepeatedViewIdPB | void | Shell |
| 35 | UpdateViewIcon | UpdateViewIconPayloadPB | void | Shell |
| 36 | ReadRecentViews | ReadRecentViewsPB | RepeatedRecentViewPB | Shell (recents/search) |
| 37 | UpdateRecentViews | UpdateRecentViewPayloadPB | void | Shell |
| 39 | ReadPrivateViews | GetWorkspaceViewPB | RepeatedViewPB | Shell (private section) |
| 40 | ReadCurrentWorkspaceViews | — | RepeatedViewPB | — (not referenced in Dart lib) |
| 41 | UpdateViewVisibilityStatus | UpdateViewVisibilityStatusPayloadPB | void | Shell (spaces) |
| 42 | GetViewAncestors | ViewIdPB | RepeatedViewPB | Shell (auto-expand, breadcrumbs) |
| 43 | PublishView | PublishViewParamsPB | void | Other (share) |
| 44 | GetPublishInfo | ViewIdPB | PublishInfoResponsePB | Shell (delete check) |
| 45 | GetPublishNamespace | — | PublishNamespacePB | Other |
| 46 | SetPublishNamespace | SetPublishNamespacePayloadPB | void | Other |
| 47 | UnpublishViews | UnpublishViewsPayloadPB | void | Shell (delete/move) |
| 48 | ImportZipFile | ImportZipPB | void | Other (Notion import) |
| 49 | ListPublishedViews | — | RepeatedPublishInfoViewPB | Other (settings/sites) |
| 50 | GetDefaultPublishInfo | — | PublishInfoResponsePB | Other |
| 51 | SetDefaultPublishView | ViewIdPB | void | Other |
| 52 | SetPublishName | SetPublishNamePB | void | Other |
| 53 | RemoveDefaultPublishView | — | void | Other |
| 54 | LockView | ViewIdPB | void | Shell (view header) |
| 55 | UnlockView | ViewIdPB | void | Shell (view header) |
| 56 | SharePageWithUser | SharePageWithUserPayloadPB | void | Other (share tab) |
| 57 | RemoveUserFromSharedPage | RemoveUserFromSharedPagePayloadPB | void | Shell (shared section "Leave") / share tab |
| 58 | GetSharedUsers | GetSharedUsersPayloadPB | RepeatedSharedUserPB | Other |
| 59 | GetSharedViews | — | RepeatedSharedViewResponsePB | Shell (shared section) |
| 60 | GetSharedViewSection | ViewIdPB | GetSharedViewSectionResponsePB | Other (page access level) |

#### FolderNotification (`rust-lib/flowy-folder/src/notification.rs`)

Transport: Rust `NotificationBuilder::new(id, ty, source="Workspace")` → Dart `RustStreamReceiver` `SubscribeObject{1 source, 2 ty i32, 3 id, 4 payload bytes, 5 error bytes}`. `FolderNotificationParser` (`core/notification/folder_notification.dart`) accepts only `source == "Workspace"`, maps `ty` via `FolderNotification.valueOf`, and filters `subject.id == id` when an id is given; error bytes → `FlowyError`. `FolderNotificationListener(objectId, handler)` is the generic helper.

| # | Name | Sent by (Rust) | Subject id | Payload | Desktop Dart consumer |
|---|---|---|---|---|---|
| 0 | Unknown | — | — | — | — |
| 1 | DidCreateWorkspace | never sent | — | — | none |
| 2 | DidUpdateWorkspace | never sent by flowy-folder | workspace id | WorkspacePB | `WorkspaceListener` (`workspace/application/workspace/workspace_listener.dart`) — no desktop subscribers (dead) |
| 3 | DidUpdateWorkspaceViews | `notify_did_update_workspace` (parent == workspace in `notify_parent_view_did_change`; after every `update_view_with_params`) | workspace id | RepeatedViewPB (workspace public root views) | `WorkspaceListener` (dead on desktop) |
| 4 | DidUpdateWorkspaceSetting | `set_current_view` (CreateView/Duplicate with set_as_current, SetLatestView) | workspace id | WorkspaceLatestPB | `FolderListener` (`user/application/user_listener.dart`) → `HomeBloc.didReceiveWorkspaceSetting` (opens `latest_view` unless `isSpace`); `HomeSettingBloc` and `MenuUserBloc` construct a `FolderListener` but never `start()` it (dead) |
| 10 | DidUpdateView | (a) collab `ViewChange::DidUpdate` → ViewPB **without** children; (b) `notify_parent_view_did_change` for non-workspace parents → parent ViewPB **with** first-level non-trashed children (after create/move/trash/restore); (c) `update_view_with_params` (rename/extra/etc.); (d) toggle favorite | view id | ViewPB | `ViewListener.onViewUpdated` → `ViewBloc.viewDidUpdate` (re-`GetView`); `ViewPluginNotifier` (`plugins/util.dart`, keeps tab's view fresh); `ViewTitleBarBloc`, `ViewTitleBloc`, `DocumentBloc`, `ShareBloc`, `TabBarBloc` (database), cover/icon blocs |
| 11 | DidUpdateChildViews | `notify_child_views_changed` on collab create/delete/update and on move-to-trash | **parent** view id | ChildViewUpdatePB (one entry per notification) | `ViewListener.onViewChildViewsUpdated` → `ViewBloc._updateChildViews` |
| 12 | DidDeleteView | never sent | view id | ViewPB | `ViewListener.onViewDeleted` (DocumentBloc, MentionPageBloc) — dead |
| 13 | DidRestoreView | never sent | view id | ViewPB | `ViewListener.onViewRestored` (DocumentBloc) — dead |
| 14 | DidMoveViewToTrash | `move_view_to_trash` (DeleteView) | view id | DeletedViewPB{view_id, index: none} | `ViewPluginNotifier.isDeleted` (open tab shows deleted banner), `DocumentBloc`, `ShareBloc` |
| 15 | DidUpdateTrash | trash observer on add/remove (full `RepeatedTrashPB`); `restore_all_trash`, `delete_my_trash` (empty list) | `"trash"` | RepeatedTrashPB | `TrashListener` (`plugins/trash/application/trash_listener.dart`) → `TrashBloc`, `ViewTitleBarBloc`, `CommandPaletteBloc`, `MentionPageBloc`, sub-page block |
| 16 | DidUpdateFolderSnapshotState | never sent | — | — | none |
| 17 | DidUpdateFolderSyncUpdate | folder sync-state watcher | workspace id | FolderSyncStatePB | none |
| 36 | DidFavoriteView | `send_toggle_favorite_notification` | `"favorite"` | RepeatedViewPB [view] | `FavoriteListener` (`workspace/application/favorite/favorite_listener.dart`) → `FavoriteBloc`; every `ViewBloc` (refresh if its id present) |
| 37 | DidUnfavoriteView | toggle favorite; `move_view_to_trash` (all favorited descendants) | `"favorite"` | RepeatedViewPB | same |
| 38 | DidUpdateRecentViews | `send_update_recent_views_notification` | `"recent_views"` | RepeatedViewIdPB | `RecentViewsListener` (`workspace/application/recent/recent_listener.dart`) → `CachedRecentService` (note: listener does not check `ty`) |
| 39 | DidUpdateSectionViews | `notify_did_update_section_views` (whenever workspace root children change) — sent twice: Public then Private | workspace id | SectionViewsPB | `WorkspaceSectionsListener` (`workspace/application/workspace/workspace_sections_listener.dart`) → `SidebarSectionsBloc.receiveSectionViewsUpdate`, `SpaceBloc` |
| 40 | DidUpdateSharedViews | shared-views fetch (cloud) | workspace id | RepeatedSharedViewResponsePB | `SharedSectionBloc` (`features/shared_section/logic/shared_section_bloc.dart`) |
| 41 | DidUpdateSharedUsers | share/remove/refresh page members | page (view) id | RepeatedSharedUserPB | `ShareTabBloc` (`features/share_tab/logic/share_tab_bloc.dart`) |

Typical notification sequences:
- **Create child** (parent P): `DidUpdateChildViews(P, create=[v])` → `DidUpdateView(P with children)`; if `set_as_current`: `DidUpdateWorkspaceSetting`. Root parent (workspace): `DidUpdateWorkspaceViews` + `DidUpdateSectionViews`×2.
- **Rename / extra / icon**: `DidUpdateView(v)` (+ collab `DidUpdateView(v)`, `DidUpdateChildViews(parent, update=[v])`, `DidUpdateView(parent)`), `DidUpdateWorkspaceViews`.
- **Move** (old O → new N): collab update events for v, then `notify_parent_view_did_change([N, O])` → `DidUpdateView(N)`, `DidUpdateView(O)` (or workspace/section notifications if root).
- **Delete**: [`DidUnfavoriteView`], `DidMoveViewToTrash(v)`, `DidUpdateChildViews(parent, delete=[v])`, `DidUpdateTrash`, `DidUpdateView(parent)` / section notifications.
- **Restore**: `DidUpdateTrash`, `DidUpdateView(parent)` / section notifications.

### 2C.12 Trash

#### Sidebar entry (`menu/sidebar/footer/sidebar_footer.dart` `SidebarTrashButton`)
- `SidebarFooterButton` (`footer/sidebar_footer_button.dart`): `SizedBox(height: HomeSizes.workspaceSectionHeight = 32)` → `FlowyButton(leftIcon: FlowySvg(FlowySvgs.icon_delete_s), leftIconSize 18×18, margin all 4, expandText false, text: Padding(right 6, FlowyText(LocaleKeys.trash_text "Trash", fontWeight w400, figmaLineHeight 18)))`; hover bg `colorScheme.secondary` radius 6.
- Placed right half of the footer row: `Row[Expanded(SidebarTemplateButton), vertical divider, Expanded(SidebarTrashButton)]` (footer layout itself: see sidebar part).
- Tap: `getIt<MenuSharedState>().latestOpenView = null` (clears sidebar selection) then `getIt<TabsBloc>().add(TabsEvent.openPlugin(plugin: makePlugin(pluginType: PluginType.trash)))`.
- No badge/count shown.

#### Trash plugin (`plugins/trash/trash.dart`)
- `TrashPluginBuilder`: menuName `"TrashPB"`, icon `FlowySvgs.trash_m`, `pluginType: PluginType.trash`, `layoutType: Document` (nominal); `TrashPluginConfig.creatable = false`.
- `TrashPlugin.id = "TrashStack"` (constant ⇒ only one trash tab); `widgetBuilder = TrashPluginDisplay`: `viewName = LocaleKeys.trash_text`, `leftBarItem = FlowyText.medium("Trash")`, `tabBarItem = leftBarItem`, `rightBarItem = null`, `navigationItems = [this]`, default `contentPadding` (h40 v28) — applied by `PageManager.stackWidget` as `Padding(builder.contentPadding, ...)` (§3.1.2).

#### Trash page (`plugins/trash/trash_page.dart`, `src/*`)
Layout: `SizedBox.expand(Column[topBar, VSpace(32), list])`, padding horizontal **80**, vertical **48**.

Top bar (height 36, Row stretch):
- `FlowyText.semibold(LocaleKeys.trash_text "Trash", fontSize 16, color colorScheme.tertiary)`, `Spacer`.
- `IntrinsicWidth(FlowyButton(leftIcon FlowySvg(FlowySvgs.restore_s), text FlowyText.medium(LocaleKeys.trash_restoreAll "Restore All", lineHeight 1.0)))` → `showCancelAndConfirmDialog(title: trash_confirmRestoreAll_title "Restore all pages in trash", description: trash_confirmRestoreAll_caption "This action cannot be undone.", confirmLabel: trash_restore "Restore")` → `TrashEvent.restoreAll`.
- `HSpace(6)`.
- `IntrinsicWidth(FlowyButton(leftIcon FlowySvg(FlowySvgs.delete_s), text FlowyText.medium(LocaleKeys.trash_deleteAll "Delete All", lineHeight 1.0)))` → `showConfirmDeletionDialog(name: trash_confirmDeleteAll_title "All pages in trash" (⇒ title "Delete: All pages in trash"), description: trash_confirmDeleteAll_caption "Are you sure you want to delete everything in Trash? This action cannot be undone.")` → `TrashEvent.deleteAll`.
- Buttons are shown even when the trash is empty; no empty-state widget on desktop.

List (`TrashSizes`, `scale = 0.8`): fixed table width `totalWidth = (320+230+230+40+2×40)×0.8 = 720`, horizontal scroll if narrower (`StyledSingleChildScrollView`, bar 6px), vertical `CustomScrollView` with `ScrollbarListStack(barSize 6, scrollbarPadding top 48)`.
- Pinned header (`TrashHeaderDelegate`, height `60×0.8 = 48`, bg `colorScheme.surface`): columns `trash_pageHeader_fileName` "File name" (256), `trash_pageHeader_lastModified` "Last Modified" (184), `trash_pageHeader_created` "Created" (184); `FlowyText` default 14px, color `Theme.disabledColor`.
- Rows (`TrashCell`, height 42): name (256, `FlowyText`, empty → "Untitled"), `modified_time` (184), `create_time` (184) formatted `DateFormat('MM/dd/yyyy hh:mm a')` from seconds×1000 (local time), `Spacer`, restore `FlowyIconButton(width 32, iconPadding 5, FlowySvgs.restore_s, iconColorOnHover colorScheme.onSurface)`, `HSpace(20)`, delete `FlowyIconButton(width 32, iconPadding 5, FlowySvgs.delete_s)`.
- Row restore → `showCancelAndConfirmDialog(title: LocaleKeys.trash_restorePage_title.tr(args:[name]) "Restore: {name}", description: trash_restorePage_caption "Are you sure you want to restore this page?", confirmLabel: trash_restore)` → `TrashEvent.putback(id)`.
- Row delete → `showConfirmDeletionDialog(name: name.trim().isEmpty ? "Untitled" : name, description: deletePagePrompt_deletePermanentDescription "Are you sure you want to delete this page permanently? This is irreversible.")` → `TrashEvent.delete(trash)`.
- `showCancelAndConfirmDialog`: same `Dialog(radius 12, width 440) + ConfirmPopup` as deletion but confirm color `colorScheme.primary`, cancel+confirm buttons.

#### TrashBloc (`plugins/trash/application/trash_bloc.dart`; `getIt.registerFactory<TrashBloc>`)
| Event | Action |
|---|---|
| `initial` | `TrashListener.start` (subject `"trash"`, `DidUpdateTrash` → `didReceiveTrash(items)`); `FolderEventListTrashItems()` → `objects` |
| `didReceiveTrash(List<TrashPB>)` | replace `objects` |
| `putback(trashId)` | `FolderEventRestoreTrashItem(TrashIdPB{id})` |
| `delete(TrashPB)` | `FolderEventPermanentlyDeleteTrashItem(RepeatedTrashIdPB{items:[TrashIdPB{id}]})` |
| `restoreAll` | `FolderEventRecoverAllTrashItems()` |
| `deleteAll` | `FolderEventPermanentlyDeleteAllTrashItem()` |
State: `TrashState{objects: List<TrashPB>, successOrFailure}`; list order = backend order (`get_my_trash_info`). Errors are only stored, not shown.

Other trash consumers: an open page whose view is trashed gets `ViewPluginNotifier.isDeleted` (DeletedViewPB) → deleted-page banner with `deletePagePrompt_text` "This page is in Trash", `deletePagePrompt_restore` "Restore page", `deletePagePrompt_deletePermanent` "Delete permanently" (rendered by the page area — see §3).

### 2C.13 Ambiguities / implementation notes collected
- Row "+" Import also creates an empty Document (ignored `createNewView`).
- Delete without published descendants has **no confirmation** dialog.
- Selected and hover share one color; no separate "active" color or left accent bar.
- Expand arrows are invisible (opacity 0) until the pointer enters the section/space list, but remain clickable.
- `FolderEventUpdateView` response is empty bytes on success.
- `ViewBloc` uses the constructor `view` for ids and `collapseAllPages` children, so children loaded later are not reset by collapse-all.
- `RecentViewsListener` ignores `ty` (any notification with subject `"recent_views"`).
- Move-to search results allow selecting non-document targets.
- Ctrl+click dispatches `openTab` then `openPlugin`; net effect = one new foreground tab (see 2C.7 click semantics, §3.2).

---

## 3. Tabs and page area

All paths relative to `appflowy_flutter/lib`. Generated icon names map to asset files via `generated/flowy_svgs.g.dart` (`_s` = `assets/flowy_icons/16x/…`, `_m` = `20x/` or `24x/`; file names do not always match, e.g. `three_dots_s` = `16x/three-dots.svg`). Use that file as the lookup table.

### 3.0 Tokens

Resolved token values and shared widget defaults (`FlowyHover`, `FlowyButton`, `FlowyText`, `FlowyIconButton`, `FlowyTooltip`, `AppFlowyPopover`, `AppFlowyTheme` spacing/radius/type): see **§5**.

---

### 3.1 Right-pane composition (`workspace/presentation/home/home_stack.dart`, MODIFIED)

`HomeStack` (StatefulWidget, `with WindowListener`) – provides `getIt<TabsBloc>()` and rebuilds on every `TabsState`:

```
Column
├─ if Windows: WindowTitleBar(leftChildren: [_buildToggleMenuButton])     // h40 (shared/window_title_bar.dart)
├─ Padding(left: layout.menuSpacing) → TabsManager(onIndexChanged)         // h40, hidden when 1 tab
└─ Expanded → IndexedStack(index: selectedIndex /*local state*/,
      children: state.pageManagers.map(pm => LayoutBuilder(
        Row[
          Expanded(Column[ pm.stackTopBar(layout) /*HomeTopBar h56*/,
                           Expanded(PageStack(pm)) ]),
          SecondaryView(pm, adaptedPercentageWidth: maxWidth*3/7)
        ])))
```

- `layout.menuSpacing` (`home_layout.dart`): `80.0` only when sidebar hidden AND macOS, else `0`. On Windows always 0.
- Every tab keeps its widget tree alive (`IndexedStack` + `PageStack` `AutomaticKeepAliveClientMixin`). Electron: keep each tab's page mounted (CSS `display:none`), do not unmount on tab switch.
- `selectedIndex` is local state synced by `TabsManager`'s `BlocConsumer` listener (`listenWhen: prev.currentIndex != curr.currentIndex || prev.pages != curr.pages`) → `onIndexChanged(index)` → `FocusScope.unfocus()` (hides editor selection toolbar) + `TabsEvent.selectTab(index)` + `setState(selectedIndex = index)`.
- `onWindowFocus()` → `setState` (window_manager workaround; no-op for Electron).

#### 3.1.1 Windows title bar (inside right pane)
`shared/window_title_bar.dart` `WindowTitleBar`: `Container(height 40, color colorScheme.surfaceContainerHighest)` → `DragToMoveArea` → `Row[HSpace 4, ...leftChildren, Spacer, minimize, maximize|unmaximize (tracks onWindowMaximize/Unmaximize), close]` (`WindowCaptionButton.*` with current brightness). Electron: frameless window + `-webkit-app-region: drag` on this 40px strip, no-drag on buttons.

`_buildToggleMenuButton` (Windows only, rendered only when `HomeSettingBloc.isMenuExpanded == false`):
- `FlowyTooltip(richMessage: "${LocaleKeys.sideBar_openSidebar}\n" + ("⌘+." on mac | "Ctrl+\\"))`; first line `tooltipTextStyle()`, second line same style with `color: Theme.hintColor`.
- `Listener(onPointerDown)` → `HomeSettingEvent.changeMenuStatus(isMenuExpanded ? MenuStatus.hidden : MenuStatus.expanded)`.
- `FlowyHover` → `Container(width 24, padding all 4)` → `RotatedBox(quarterTurns: 2, FlowySvg(FlowySvgs.hide_menu_s))` (16px icon rotated 180°).
- No red-dot badge on Windows (see 3.4.1 for non-Windows variant).

`MoveWindowDetector` (`core/frameless_window.dart`) wraps tab bar and top bars: no-op on Windows/Linux and on macOS ≥ 15; on older macOS it implements drag-to-move + double-click zoom. Electron: equivalent is `app-region: drag` on empty tab-bar/top-bar space.

#### 3.1.2 `PageStack` / `PageManager.stackWidget`
- `PageStack`: `Container(color: colorScheme.surface)` → `FocusTraversalGroup` → `pm.stackWidget(userProfile, onDeleted: delegate.didDeleteStackWidget)`.
- `stackWidget` (MODIFIED): `Consumer<PageNotifier>`:
  - if `notifier.plugin is BlankPagePlugin` → `BlankPage` (MODIFIED: previously `pluginType == blank`; now type check so `LocalToolPlugin`, which reports `PluginType.blank`, still renders).
  - else `FadingIndexedStack(index: PluginSandbox.indexOf(plugin.pluginType), children: one per registered PluginType)`; only the slot whose type == current plugin type builds `Padding(builder.contentPadding, builder.buildWidget(PluginContext(onDeleted, userProfile), shrinkWrap: false))`, other slots = `BlankPage`.
  - `FadingIndexedStack`: when `index` changes (i.e. plugin TYPE changes in this tab) opacity jumps to 0 then animates 0→1 over 250 ms; same-type plugin swap = no fade. Its `initState` calls `initToastWithContext(context)`.
- `BlankPage` (`plugins/blank/blank.dart`): `SizedBox.expand(Container(color: colorScheme.surface, Padding(10, SizedBox.shrink())))` – an empty surface.
- `HomeStackDelegate.didDeleteStackWidget(view, index)` (impl `DesktopHomeScreenStackAdaptor` in `desktop_home_screen.dart`): called when an open page is permanently deleted (document `DocumentState.forceClose`, database `notifier.isDeleted` with index). Does `FolderEventGetView(ViewIdPB(view.parentViewId))`; if parent has children → open `childViews[index-1]` when `index != null && index != 0 && length > index-1`, else `childViews.last`, via `TabsEvent.openPlugin`; if no children → `TabsEvent.openPlugin(BlankPagePlugin())`.

#### 3.1.3 `HomeTopBar` (per tab, main view header)
`PageManager.stackTopBar` → `ChangeNotifierProvider(_notifier)` → `Selector(titleWidget)` → `MoveWindowDetector(HomeTopBar(layout))`.

```
Container(color: colorScheme.surface, height: HomeSizes.topBarHeight(44) + HomeInsets.topBarTitleVerticalPadding(12) = 56)
 └ Padding(h: 12, v: 12)            // inner row height 32
   └ Row[ HSpace(layout.menuSpacing),
          FlowyNavigation()          // Expanded: [collapse button?] + title (leftBarItem)
          HSpace(16),
          Consumer<PageNotifier>(plugin.widgetBuilder.rightBarItem ?? SizedBox.shrink) ]
```
No bottom border/divider under the top bar.

#### 3.1.4 Secondary (side) view – per tab
Used only by AI chat "open page from message" (`plugins/ai_chat/presentation/message/message_util.dart` `openPageFromMessage` → `TabsEvent.openSecondaryPlugin(plugin: view.plugin())` on desktop).
- `PageManager` has `_secondaryNotifier` (initially blank) + `showSecondaryPluginNotifier` (bool).
- `SecondaryView`: width when shown = `max(450, 3/7 × tab content width)`; open/close animation 300 ms `Curves.easeOut` (width 0→w and slide-in from x=1.0 → 0). On close, after reverse animation width set to 0.
- Left edge = `SecondaryViewResizer`: 1px line `Theme.dividerColor`; overlay hit area 11px wide, cursor `resizeLeftRight`; hover (after 500 ms delay) or drag shows a 2px line `colorScheme.primary` (color tween 100 ms); drag sets width = `windowWidth - pointer.x`, only applied when ≥ 450.
- Secondary top bar `HomeSecondaryTopBar`: `Container(color: surfaceContainerHighest, height 56, padding h12 v12)` → `Row[ FlowyIconButton(width 24, radius 8, tooltip LocaleKeys.sideBar_closeSidebar "Close sidebar", icon FlowySvgs.show_menu_s 16) → TabsEvent.closeSecondaryPlugin, HSpace 8, FlowyIconButton(width 24, radius 8, tooltip LocaleKeys.sideBar_expandSidebar "Expand as full page", icon FlowySvgs.full_view_s 16) → TabsEvent.expandSecondaryPlugin, Expanded(Align(centerEnd, secondary plugin rightBarItem)) ]`.
- Secondary content: `widgetBuilder.buildWidget(context: PluginContext() /*no userProfile*/, shrinkWrap: false)` (no contentPadding applied).
- Collapsed re-open handle: when hidden but secondary plugin type != blank: overlay anchored top-right of the tab, offset `(0, 120)`; 36×36 box, radius `topLeft/bottomLeft 12`, bg `colorScheme.surface`, shadow `0 4 20` light `#1F23291F` / dark `shadowColor@0.08`, FlowyHover with border (left/top/bottom, light `#1F232914` / dark `dividerColor`), icon `FlowySvgs.rename_s` 16. Tap → show. Appear/disappear via size transition 150 ms.

---

### 3.2 `TabsBloc` (`workspace/application/tabs/tabs_bloc.dart`)

Registration: `getIt.registerLazySingleton<TabsBloc>(() => TabsBloc())` (`startup/deps_resolver.dart:158`) – one app-wide instance; also `MenuSharedState` singleton (`workspace/presentation/home/menu/menu_shared_state.dart`: `ValueNotifier<ViewPB?> latestOpenView`, setter ignores same id) which drives sidebar selection highlight.

#### 3.2.1 State
```
TabsState { int currentIndex = 0; List<PageManager> _pageManagers = [PageManager()] }
  pages = _pageManagers.length
  currentPageManager = _pageManagers[currentIndex]
  isAllPinned = every(pm.isPinned)
PageManager { PageNotifier _notifier (plugin, default BlankPagePlugin);
              PageNotifier _secondaryNotifier; bool isPinned = false;
              ValueNotifier<bool> showSecondaryPluginNotifier = false }
```
Initial state: one tab with `BlankPagePlugin` (id `""`). Tab identity = `plugin.id` (view id for view plugins; `"TrashStack"` for trash; `"local-tool:<toolId>"` for local tools; `rowId` for databaseDocument; `""` for blank).

`PageNotifier.setPlugin(newPlugin, {setLatest, disposeExisting = true})`:
1. if `newPlugin.id != plugin.id && disposeExisting` → `oldPlugin.dispose()` (closes its blocs/listeners).
2. if `setLatest && newPlugin.id.isNotEmpty && newPlugin.pluginType != PluginType.blank` → `FolderEventSetLatestView(ViewIdPB(value: newPlugin.id))` (MODIFIED: blank-type guard added so `LocalToolPlugin` ids are never sent to Rust).
3. replace + notify.

`PageManager.setPlugin(plugin, setLatest, [init = true])` calls `plugin.init()` first (creates `ViewInfoBloc`, `PageAccessLevelBloc` for view plugins).

#### 3.2.2 Events (exact semantics)

| Event | Behaviour |
|---|---|
| `selectTab(int index)` | Ignored if `index == currentIndex` or out of `[0, pages)` (no wrap-around). Else `currentIndex = index`, then `_setLatestOpenView()` (sidebar highlight ← current tab's `ViewPluginNotifier.view` if any). Does NOT send `SetLatestView`. |
| `moveTab()` | No-op (no payload, no drag-reorder implemented). |
| `closeTab(String pluginId)` | Ignored if that tab is pinned. Else `state.closeView(pluginId)`, `_setLatestOpenView()`. |
| `closeCurrentTab()` | Ignored if current tab pinned. Else `closeView(current.plugin.id)`. |
| `closeOtherTabs(String pluginId)` | New list = tabs where `id == pluginId || isPinned` (original order). `currentIndex` = unchanged number if the current tab is pinned (AMBIGUOUS: number may now point to a different tab after removal), else index of `pluginId` in new list (0 if not found). `_setLatestOpenView()`. |
| `togglePin(String pluginId)` | Pin: move tab to `lastPinnedIndex + 1` (right after last pinned). Unpin: move tab to index of first unpinned tab (i.e. end of pinned group), or end if none. `currentIndex` adjusted to keep the same tab selected (`_adjustCurrentIndex`). Flip `isPinned`. |
| `openTab({plugin, view})` | Current tab: `hideSecondaryPlugin()` + `setSecondaryPlugin(BlankPagePlugin())`. Then `state.openView(plugin)`: if a tab with `plugin.id` exists → select it (no new tab); else append `PageManager()..setPlugin(plugin, true)` (→ `SetLatestView`) and select it (foreground). `_setLatestOpenView(view)`. No ancestor expansion. |
| `openPlugin({plugin, view?, setLatest = true})` | Dedup: skip if same `plugin.id` AND same `view?.id` as the previous `openPlugin` within 500 ms. Reset current tab's secondary (as above). `state.openPlugin`: if a tab with `plugin.id` already exists → select it; else REPLACE the plugin of the current tab (`pageManagers[currentIndex].setPlugin(plugin, setLatest)`), even if the current tab is pinned. If `setLatest`: return early when `view.isSpace`; `_setLatestOpenView(view)`; if `view != null` → `_expandAncestors(view)`. |
| `openSecondaryPlugin({plugin, view?})` | Current tab: `setSecondaryPlugin(plugin)` (init) + show. |
| `closeSecondaryPlugin()` | Current tab: hide (plugin retained → re-open handle visible). |
| `expandSecondaryPlugin()` | Current tab: hide secondary, then main notifier `setPlugin(secondary.plugin, setLatest: true)`, secondary ← `BlankPagePlugin` with `disposeExisting: false`. `_setLatestOpenView()`. |
| `switchWorkspace(String workspaceId)` | Sent by workspace menu `_openWorkspace` (`menu/sidebar/workspace/_sidebar_workspace_menu.dart:323`) BEFORE `UserWorkspaceEvent.openWorkspace`. Closes every tab that is not pinned and not the current one; if anything was closed emits `currentIndex: 0` (AMBIGUOUS: if pinned tabs precede the current tab, index 0 selects a pinned tab, not the kept current tab). Tabs are not saved/restored per workspace despite the code comment. |

`closeView(pluginId)` (shared): if only 1 tab → no-op (last tab can never close; Ctrl+W on last tab does nothing). Remove tab; `newIndex = (currentIndex > pages-1 && currentIndex > 0) ? currentIndex-1 : currentIndex`. Consequences (replicate exactly):
- Closing the selected tab → the tab to its right becomes active (or the left neighbour if it was last).
- Closing a tab LEFT of the selected one → selection index number stays, so the active tab shifts one to the right (e.g. `[A,B*,C]` close A → `[B,C*]`). This is the Flutter behaviour (arguably a bug); decide deliberately.
- Removed `PageManager`s are not disposed (Electron should dispose/unmount).

`_setLatestOpenView([view])`: if view given → `MenuSharedState.latestOpenView = view`; else if current plugin's notifier is `ViewPluginNotifier` with a different id → set it. Non-view plugins (Trash, LocalTool, Blank) leave the previous sidebar highlight unchanged.

`_expandAncestors(view)`: skip if `ViewExpanderRegistry.isViewExpanded(view.parentViewId)`; else read KV `KVKeys.expandedViews` (`'expandedViews'`, JSON `{viewId: true}`), `FolderEventGetViewAncestors(ViewIdPB(view.id))` → mark every ancestor id `true`, save KV, call `expand()` on the first registered, not-yet-expanded `ViewExpander` among ancestors (sidebar tree reveals the page).

Helpers: `TabsBloc.openTab(ViewPB)` = `TabsEvent.openTab(plugin: view.plugin(), view)`; `TabsBloc.openPlugin(ViewPB, {arguments})` = `TabsEvent.openPlugin(plugin: view.plugin(arguments: arguments), view: view)`.

Limits: no max tab count. No tab persistence across restarts; no "reopen closed tab".

#### 3.2.3 Persistence / restore on launch
- Only the "latest view" is persisted, in Rust: every main-pane `setPlugin` with `setLatest` (view plugins only) sends `FolderEventSetLatestView(ViewIdPB)`. Rust emits `FolderNotification.DidUpdateWorkspaceSetting` (id = workspace id, payload `WorkspaceLatestPB { workspace_id: string, latest_view?: ViewPB }`) consumed by `FolderListener` → `HomeBloc` (`workspace/application/home/home_bloc.dart`).
- `HomeBloc` ignores a latest view that `isSpace`. `DesktopHomeScreen` `BlocListener<HomeBloc>` (`listenWhen latestView changed`): if current tab's plugin `pluginType == PluginType.blank` → `TabsEvent.openPlugin(plugin: latestView.plugin())`; always `_switchToSpace(view)` (ancestors → first `isSpace` → `switchToSpaceNotifier`).
  - AMBIGUOUS: `LocalToolPlugin` reports `PluginType.blank`, so a `DidUpdateWorkspaceSetting` with a changed latest view while a Jira/Templates tab is active replaces that tool with the latest view.
- Restart result: a single tab containing the latest view; pinned state and other tabs lost.
- `TabsEvent.openPlugin` from the latest-view path uses `view.plugin()` without `view` arg → no ancestor expansion from TabsBloc (space switch done by home screen).

#### 3.2.4 Who opens what (desktop callers)
| Trigger | Call | Effect |
|---|---|---|
| Sidebar page click (`folder/_section_folder.dart`, `space/sidebar_space.dart`, `favorites/favorite_folder.dart`, `features/shared_section/presentation/shared_section.dart`) | `if (HardwareKeyboard.instance.isControlPressed) openTab(view);` then always `openPlugin(view)` | Plain click: replace current tab (or select existing tab). Ctrl+click: new foreground tab (or select existing). Only Control is checked – Cmd on macOS does NOT open a new tab. View row click is throttled in `view_item.dart` `_handleViewTap` (`_clickThrottleDuration` = 200 ms). |
| Sidebar middle click (`onTertiaryTapDown` in `view_item.dart:607`) | `openTab(view)` | New foreground tab. |
| Sidebar "more" → `ViewMoreActionType.openInNewTab` ("Open in a new tab", `FlowySvgs.view_item_open_in_new_tab_s`) | `openTab(view)` | Same. |
| Tab bar middle click | – | Not implemented (tabs only react to primary button + right-click). |
| Breadcrumb ancestor click (`ViewTitle` uneditable) | `TabsBloc.openPlugin(ancestorView)` | Replace current tab. |
| Trash breadcrumb / sidebar Trash / command palette | `TabsEvent.openPlugin(plugin: makePlugin(pluginType: PluginType.trash))` (breadcrumb first sets `MenuSharedState.latestOpenView = null`) | Replace current tab with Trash (id `TrashStack`). |
| Sidebar "Jira" button / footer "Templates" (modified `sidebar.dart`, `footer/sidebar_footer.dart`) | `TabsEvent.openPlugin(plugin: LocalToolPlugin(toolId: 'jira'|'templates', …))` | Replace current tab (or select existing `local-tool:*` tab). No `SetLatestView`, no sidebar highlight change. |
| New root page created (`SidebarSectionsBloc.lastCreatedRootView`) / `SpaceBloc.lastCreatedPage` (blank → `BlankPagePlugin`) | `TabsEvent.openPlugin(plugin: view.plugin())` | Replace current tab. |
| Command palette result, action navigation (`startup/tasks/app_widget.dart`, `ActionType.openView` with `PluginArgumentKeys.selection`/`blockId`) | `TabsBloc.openPlugin(view, arguments: {...})` | Replace current tab; document scrolls to block. If view missing → toast `LocaleKeys.search_pageNotExist` ("This page doesn't exist"). |
| Row "Open as full page" (`plugins/database/widgets/row/row_detail.dart`) | `TabsEvent.openPlugin(plugin: DatabaseDocumentPlugin(...), setLatest: false)` | Replace current tab, no SetLatestView. |
| Relation cell / "view database" button / sub-page block | `TabsEvent.openPlugin(...)` | Replace current tab. |
| AI chat "open page" from message | `TabsEvent.openSecondaryPlugin` | Side view. |

#### 3.2.5 Tab hotkeys (`workspace/presentation/home/hotkeys.dart`, scope `inapp`, modifier = Meta on macOS, Control elsewhere)
| Keys | Action |
|---|---|
| Ctrl+W | `TabsEvent.closeCurrentTab()` (no-op if pinned or last tab) |
| Ctrl+PageUp | `selectTab(currentIndex - 1)` (no wrap) |
| Ctrl+PageDown | `selectTab(currentIndex + 1)` (no wrap) |
| F2 | `getIt<RenameViewBloc>().add(RenameViewEvent.open())` → opens rename popover on the selected sidebar item (`view_item.dart:631`), not on the breadcrumb |
No Ctrl+Tab / Ctrl+T / Ctrl+1..9.

---

### 3.3 Tab bar UI

#### 3.3.1 `TabsManager` (`workspace/presentation/home/tabs/tabs_manager.dart`)
- Hidden (`SizedBox.shrink`) when `state.pages == 1`.
- `Container(alignment: bottomLeft, height: HomeSizes.tabBarHeight = 40, color: colorScheme.surfaceContainerHighest)` → `MoveWindowDetector` → `Row` of `Flexible(ConstrainedBox(maxWidth: HomeSizes.tabBarWidth = 200, FlowyTab(key: ValueKey('tab-${pm.plugin.id}'), isCurrent, isAllPinned, onTap)))`. Tabs shrink equally when space is short (flex), never scroll, no "+" button, no overflow menu.
- `onTap` → if not current → `onIndexChanged(indexOf(pm))` (HomeStack sends `selectTab`).

#### 3.3.2 `FlowyTab` (`workspace/presentation/home/tabs/flowy_tab.dart`)
- Outer `SizedBox(width: isPinned ? 54 : null)`; tooltip `FlowyTooltip(message: widgetBuilder.viewName)` when non-null.
- `FlowyHover(resetHoverOnRebuild: false, style: HoverStyle(borderRadius: zero, backgroundColor: isCurrent ? colorScheme.surface : colorScheme.surfaceContainerHighest, hoverColor: isCurrent ? colorScheme.surface : null /*→ colorScheme.secondary*/))`. So: active tab = page-surface colour (visually merges with the page top bar); inactive = sidebar bg; inactive hover = secondary overlay. No borders/separators, square corners, no active underline.
- Content: `Padding(h 16)` → `Listener(onPointerDown: if buttons == kPrimaryButton → onTap)` (selection on pointer DOWN) → `GestureDetector(onPanStart: {})` (blocks window drag) → `Container(constraints: maxWidth 200, minWidth isPinned ? 54 : 100; height 40)` → `Row(spaceBetween)[ Flexible(notifier.tabBarWidget(pluginId, shortForm: isPinned)), if !isPinned: Visibility(visible: isHovering, SizedBox(26×26, FlowyIconButton(icon: FlowySvg(FlowySvgs.close_s, size 22), onPressed: closeTab(pluginId)))) ]`.
- Close button only appears on hover (also on the active tab); pinned tabs never show it.
- Right click: `AppFlowyPopover(triggerActions: PopoverTriggerFlags.secondaryClick, showAtCursor: true, offset: (4,4))` → `TabMenu`.

#### 3.3.3 `TabMenu` (context menu)
`SeparatedColumn(separator: VSpace(4), mainAxisSize: min)`, default popover constraints (maxWidth 240):
| # | Item | i18n (en-US) | Enabled | Event |
|---|---|---|---|---|
| 1 | `FlowyButton(FlowyText.regular)` | `LocaleKeys.tabMenu_close` "Close" | disabled + opacity 0.5 + tooltip `tabMenu_closeDisabledHint` ("Cannot close a pinned tab, please unpin first") when pinned | `TabsEvent.closeTab(pageId)` |
| 2 | same | `tabMenu_closeOthers` "Close other tabs"; tooltip always: `tabMenu_closeOthersHint` ("This will close all unpinned tabs except this one") or, if all pinned, `tabMenu_closeOthersDisabledHint` ("All tabs are pinned, cannot find any tabs to close") | disabled + opacity 0.5 when `isAllPinned` | `TabsEvent.closeOtherTabs(pageId)` |
| – | `Divider(height: 0.5)` | | | |
| 3 | same | `tabMenu_pinTab` "Pin" / `tabMenu_unpinTab` "Unpin" | always | `TabsEvent.togglePin(pageId)` |
Each action closes the popover.

#### 3.3.4 Tab label (`plugin.widgetBuilder.tabBarItem(pluginId, shortForm)`)
| Plugin | Label widget |
|---|---|
| Document / Grid / Board / Calendar / Chat | `ViewTabBarItem` (`workspace/presentation/widgets/tab_bar_item.dart`) |
| Trash | `FlowyText.medium(LocaleKeys.trash_text)` "Trash" |
| Blank | `FlowyText.medium(LocaleKeys.blankPageTitle)` "Blank page" |
| LocalTool | `FlowyText.medium(title)` ("Jira" / "Templates", hard-coded English) |
| DatabaseDocument (row page) | `SizedBox.shrink()` → empty tab label (only close button) |

`ViewTabBarItem`: subscribes `ViewListener(viewId).start(onViewUpdated)` (`FolderNotification.DidUpdateView`, payload `ViewPB`) to live-update the name. `Row(mainAxisAlignment: shortForm ? center : start)[ if view.icon.value non-empty: RawEmojiIconWidget(emoji: view.icon.toEmojiIconData(), emojiSize: 16); if !shortForm && icon: HSpace(6); if !shortForm || no icon: Flexible(FlowyText.medium(view.nameOrDefault, ellipsis)) ]`. No layout-type fallback icon (a page without emoji shows text only). Pinned (shortForm): icon only if it has one, else the name (squeezed into 54px).
- Quirk: the icon is read from the initial `widget.view` (not the updated one) → icon changes do not refresh the tab until reopened; name does refresh.
- `nameOrDefault`: empty name → `LocaleKeys.menuAppHeader_defaultNewPageName` "Untitled".

---

### 3.4 View header (top bar contents)

#### 3.4.1 `FlowyNavigation` (`workspace/presentation/home/navigation.dart`)
`Expanded(Row[ _renderCollapse, Expanded(Row(_renderNavigationItems(plugin.widgetBuilder.navigationItems))) ])`.
- Every plugin returns `navigationItems => [this]`, so the "navigation" is exactly one item: `NaviItemWidget` = `Expanded(item.leftBarItem.padding(h 2, v 2))`. (The `_filter` >4 items + `EllipsisNaviItem` "..." (`FontSizes.s16`) and `'/'` separators are dead code for desktop plugins.) Real breadcrumbs live inside `ViewTitleBar` (3.4.2).
- `_renderCollapse` (non-Windows only, when `HomeSettingState.menuStatus == MenuStatus.hidden`): `Padding(right 8) → SizedBox(24×24) → Stack[ rotated 180° FlowyTooltip(richMessage "Open sidebar\nCtrl+\\" / "⌘+.") → Listener(onPointerDown: HomeSettingBloc.collapseMenu()) → FlowyIconButton(width 24, icon FlowySvg(FlowySvgs.double_back_arrow_m, color: AppFlowyTheme.iconColorScheme.secondary)), Align(topRight, NumberedRedDot.desktop()) ]`.
- `NumberedRedDot.desktop` (`workspace/presentation/notifications/number_red_dot.dart`): count = unread reminders (`ReminderBloc.state.reminders.where(!isRead)`); hidden at 0; size 14×14 (1–9), 17×14 (10–99), 24×14 (>99, text "99+"); bg `AppFlowyTheme.borderColorScheme.errorThick`, radius = height/2, text white 10px w500 lineHeight 1.

#### 3.4.2 `ViewTitleBar` – breadcrumbs (`workspace/presentation/widgets/view_title_bar.dart`)
Used as `leftBarItem` by Document, Grid/Board/Calendar, Chat plugins (wrapped in `BlocProvider.value(pageAccessLevelBloc)`).

Data: `ViewTitleBarBloc` (`workspace/application/view_title/view_title_bar_bloc.dart`):
- `reload`: `FolderEventGetViewAncestors(ViewIdPB(view.id))` → `RepeatedViewPB.items` = `[workspaceRoot, (space), …parents, view]`; plus `FolderEventListTrashItems()` → `isDeleted = trash.items.any(id == view.id)`.
- Triggers: on create; `ViewListener(view.id).onViewChildViewsUpdated` (`FolderNotification.DidUpdateChildViews`, payload `ChildViewUpdatePB`); `ViewTitle.onUpdated` (any rendered ancestor's `DidUpdateView`).
- `TrashListener` `FolderNotification.DidUpdateTrash` (payload `RepeatedTrashPB`) → `isDeleted = true` if contained (never resets to false except via reload).

Layout: `SingleChildScrollView(horizontal) → SizedBox(height 24) → Row[ ..._buildViewTitles, HSpace(theme.spacing.m = 8), _buildLockPageStatus ]`. Empty ancestors → nothing.

`_buildViewTitles` algorithm:
1. If `isDeleted` → `[TrashBreadcrumb, FlowySvg(FlowySvgs.title_bar_divider_s), FlowyTooltip(view.name, ViewTitle(view /*default behaviour = editable*/))]`.
2. If `views.length <= 1` → `[]` (no section chip either).
3. `lowerBound = 2`, `upperBound = views.length - 2` (computed BEFORE the guest filter).
4. If `UserWorkspaceBloc.state.currentWorkspace.role == AFRolePB.Guest` → remove `isSpace` views.
5. For `i = 1 … len-1` (index 0 = workspace root, skipped): if `2 <= i < upperBound` → once add `FlowyText.regular(' ... ')` + `FlowySvg(title_bar_divider_s)`, skip; else add `FlowyTooltip(message: view.name, ViewTitle(view, behavior: (i == last && !view.isLocked && pageAccessLevelState.isEditable) ? editable : uneditable, onUpdated: reload))`, followed by `FlowySvg(title_bar_divider_s)` unless last.
   - Examples: `[root,a,b]` → `a › b`; `[root,a,b,c,d,e]` → `a › ... › d › e`.
6. Append `HSpace(theme.spacing.xs = 4)` + section chip (`BlocBuilder` on `sectionType`).

Section chip `_buildSectionIcon` (hidden when `currentWorkspace.workspaceType == WorkspaceTypePB.LocalW`, i.e. the default in this self-hosted checkout unless signed into a self-hosted server):
| `SharedSectionType` | Icon (20px, color `AppFlowyTheme.iconColorScheme.tertiary`) | Text (hard-coded EN, `textStyle.caption.enhanced` 12/18 w500, color `textColorScheme.tertiary`) | Tooltip |
|---|---|---|---|
| `public` | `FlowySvgs.public_section_icon_m` | `Team space` | `Everyone at {workspaceName} has access` |
| `private` | `FlowySvgs.private_section_icon_m` | `Private` | `Only you have access` |
| `shared` | `FlowySvgs.shared_section_icon_m` | `Shared` | `` (empty) |
| `unknown` | throws | | |
Row: `HSpace 4, icon, HSpace 4, text, HSpace 4` (baseline aligned). Section type source: `PageAccessLevelBloc` (3.4.6) initially from `FolderEventGetSharedViewSection(ViewIdPB)` → `GetSharedViewSectionResponsePB.section: SharedViewSectionPB {PrivateSection=0, PublicSection=1, SharedSection=2}` (fallback public on error); updated by `ViewTitleBar` listener from the first `isSpace` ancestor's `spacePermission` (`publicToAll → public`, `private → private`) unless the page `isShared`.

`ViewTitle` (per crumb; `ViewTitleBloc` listens `DidUpdateView` for that id → name/icon/view):
| Case | Rendering |
|---|---|
| `view.parentViewId.isEmpty` (root) | `Row[FlowyText.regular(name), HSpace 4]` |
| `view.isSpace` | `Container(margin h6, center, _buildIconAndName(editable: false))` – not clickable |
| uneditable | `Listener(onPointerDown → TabsBloc.openPlugin(view))` → `SizedBox(h 32) → FlowyButton(useIntrinsicWidth, margin h6, text: _buildIconAndName(false))` |
| editable (last crumb) | `AppFlowyPopover(constraints maxWidth 300 maxHeight 44, direction bottomWithLeftAligned, offset (0,6), popup RenameViewPopover)` → `SizedBox(h 32) → FlowyButton(useIntrinsicWidth, margin h6, text: _buildIconAndName(true))` |

`_buildIconAndName`: `Row[ if emoji/icon: RawEmojiIconWidget(emojiSize 14) + HSpace 4; if space with icon: SpaceIcon(dimension 14, svgSize 8.5, cornerRadius 4) + HSpace 6; Opacity(editable ? 1.0 : 0.5, FlowyText.regular(name or "Untitled", fontSize 14, figmaLineHeight 18, ellipsis)) ]`. Every non-last crumb (and the last one when locked/read-only) is drawn at 50 % opacity.

`RenameViewPopover` (`workspace/presentation/widgets/rename_view_popover.dart`): `Row[ SizedBox(w 30, EmojiPickerButton(emoji, defaultIcon: view.defaultIcon(), direction bottomWithCenterAligned, offset (0,18), tabs [emoji, icon, custom])), HSpace 6, SizedBox(h 32, w 220, FlowyTextField(maxLength 256, showCounter false, text pre-selected)) ]`.
- Submit (Enter) or cancel (Esc) → if `name.isNotEmpty && name != original` → `FolderEventUpdateView(UpdateViewPayloadPB{ view_id, name })` and close popover. Empty name = ignored (popover stays).
- Icon pick → `FolderEventUpdateViewIcon(UpdateViewIconPayloadPB{ view_id, icon: ViewIconPB{ ty: ViewIconTypePB(Emoji=0|Url=1|Icon=2), value } })`; closes unless `keepOpen`.

`TrashBreadcrumb`: `SizedBox(h 32) → FlowyButton(useIntrinsicWidth, margin h6, text Row[FlowySvg(FlowySvgs.trash_s, 14), HSpace 4, FlowyText.regular(LocaleKeys.trash_text "Trash", 14, figmaLineHeight 18, ellipsis)])` → `MenuSharedState.latestOpenView = null` + open Trash plugin.

Lock status chip (`_buildLockPageStatus`, after `HSpace 8`):
- `isLocked` → `LockedPageStatus`: tooltip `LocaleKeys.lockPage_lockTooltip` ("Page locked to prevent accidental editing. Click to unlock."); `DecoratedBox(border 1px #D95A0B, radius 6, bg light white@0.75 / dark #1B1A22B2)` → `FlowyButton(useIntrinsicWidth, margin 4 all, iconPadding 4, leftIcon FlowySvgs.lock_page_fill_s (native colours), text FlowyText.regular(LocaleKeys.lockPage_lockPage "Locked", 12, color #D95A0B), hoverColor #D95A0B@0.1)` → tap `PageAccessLevelEvent.unlock()`.
- `!isLocked && lockCounter > 0` (unlocked during this session) → `ReLockedPageStatus`: border `#8F959E`, same bg/radius/margins, leftIcon `FlowySvgs.unlock_page_s` color `#8F959E`, text `LocaleKeys.lockPage_reLockPage` "Re-lock" 12 (default colour), no tooltip → tap `PageAccessLevelEvent.lock()`.
- else nothing.
- Toast: listener `listenWhen: prev.isLoadingLockStatus == curr.isLoadingLockStatus && !curr.isLoadingLockStatus` → if `isLocked` show `LocaleKeys.lockPage_pageLockedToast` ("Page locked. Editing is disabled until someone unlocks it."). AMBIGUOUS: fires on any post-load state change while locked (e.g. right after locking), not on the initial load transition.

Database row page (`DatabaseDocumentPlugin`) uses `ViewTitleBarWithRow` (`plugins/database_document/presentation/database_document_title.dart`, bloc `DatabaseDocumentTitleBloc`): height 24; if ancestors > 2 → `[ViewTitle(ancestors[1]), ›, ' ... ', ›, ViewTitle(last), ›, RowName]`, else every ancestor + `›` + `RowName`; all crumbs uneditable; `RowName` is an editable text cell with placeholder `LocaleKeys.grid_row_titlePlaceholder`. (`›` = `FlowySvgs.title_bar_divider_s`.)

#### 3.4.3 Right bar items per plugin (`rightBarItem`)
| Plugin | Row contents (left → right) |
|---|---|
| Document (`plugins/document/document.dart`) | `[DocumentCollaborators(width 120, height 32), HSpace 16]` (since `FeatureFlag.syncDocument` is forced ON; the avatar stack itself renders nothing when there are no remote collaborators, but the 16px gap stays) `ShareButton`, `HSpace 10`, `ViewFavoriteButton`, `HSpace 4`, `MoreViewActions(view)` |
| Grid / Board / Calendar (`plugins/database/tab_bar/tab_bar_view.dart` `DatabasePluginWidgetBuilder`) | `ShareButton`, `HSpace 10`, `ViewFavoriteButton`, `HSpace 4`, `MoreViewActions(view)` |
| AI Chat (`plugins/ai_chat/chat.dart`) | hidden while `ChatSelectMessageState.isSelectingMessages`; else `ViewFavoriteButton`, `HSpace 4`, `MoreViewActions(view, customActions: [CustomViewAction("Add messages to page"), divider])` — no Share button |
| Trash / Blank / LocalTool | none |
| DatabaseDocument (row page) | `SizedBox.shrink()` |
Providers: Document/Database/Chat wrap the row in `BlocProvider.value(ViewInfoBloc)` + `BlocProvider.value(PageAccessLevelBloc)` created in `Plugin.init()`.

#### 3.4.4 Favorite button (`workspace/presentation/widgets/favorite_button.dart` `ViewFavoriteButton`)
- State: `FavoriteBloc` (provided by `DesktopHomeScreen`), `isFavorite = state.views.any(v.item.id == view.id)`.
- `Listener(onPointerDown → FavoriteEvent.toggle(view))` → `FlowyTooltip(isFavorite ? LocaleKeys.button_removeFromFavorites "Remove from Favorites" : LocaleKeys.button_addToFavorites "Add to Favorites")` → `FlowyHover(resetHoverOnRebuild false)` → `Padding(6)` → `FlowySvg(isFavorite ? FlowySvgs.favorited_s : FlowySvgs.favorite_s, size 18, blendMode: isFavorite ? null /*native colours*/ : BlendMode.srcIn /*tinted with icon colour*/)`. Total 30×30, hover radius 6, hover bg `colorScheme.secondary`.
- `FavoriteEvent.toggle` (`workspace/application/favorite/favorite_bloc.dart`): if already favorite → `unpinFavorite(view)`; else if `pinnedViews.length < 3` → `pinFavorite(view)`; then `FolderEventToggleFavorite(RepeatedViewIdPB{ items: [view.id] })`. List refresh via `FolderNotification.DidFavoriteView` / `DidUnfavoriteView` (handled by FavoriteListener, see sidebar section).

#### 3.4.5 More menu (`workspace/presentation/widgets/more_view_actions/more_view_actions.dart` `MoreViewActions`)
Trigger `_ThreeDots`: `FlowyTooltip(LocaleKeys.moreAction_moreOptions "More options")` → `FlowyHover(style: foregroundColorOnHover: colorScheme.onPrimary)` → `Padding(6)` → `FlowySvg(FlowySvgs.three_dots_s, 18, color: hovering ? colorScheme.onSurface : iconTheme.color)`.

Popover: `AppFlowyPopover(mutex: PopoverMutex (shared with sub-popovers), constraints maxWidth 245, direction bottomWithRightAligned, offset (0, 12))`. On open it creates fresh `ViewBloc(view)..initial`, `SpaceBloc(userProfile, workspaceId)..initial(openFirstPage: false)`, reuses `PageAccessLevelBloc`. While `SpaceBloc.spaces.isEmpty && userProfile.workspaceType == ServerW` → empty (loading). Content: `ListView(shrinkWrap, padding 0)`.

Item order (`_buildActions`):
| # | Condition | Item | Icon | i18n (en-US) | Action / event |
|---|---|---|---|---|---|
| 0 | `customActions` (Chat only) | `CustomViewAction` | `FlowySvgs.ai_add_to_page_s` | `moreAction_saveAsNewPage` "Add messages to page"; disabled tooltip `moreAction_saveAsNewPageDisabled` "No messages available" (disabled when `!ChatSelectMessageState.enabled`) | `ChatSelectMessageEvent.toggleSelectingMessages()` |
| 0b | Chat | divider | | | |
| 1 | `view.isDocument` | `FontSizeAction` | Material `Icons.format_size_sharp` 18, `iconTheme.color` | `moreAction_fontSize` "Font size" (14, color `AFThemeExtension.textColor`, hover `AFThemeExtension.lightGreyHover`) | sub-popover (below) |
| 1b | document | divider | | | |
| 2 | `ViewInfoState.workspaceType == WorkspaceTypePB.ServerW && (isDocument || isDatabase) && !pageAccessLevelState.isReadOnly` | `LockPageAction` | `FlowySvgs.lock_page_s` 16 | `disclosureAction_lockPage` "Lock page" + right `CupertinoSwitch` | toggle lock/unlock |
| 2b | same | divider | | | |
| 3 | `accessLevel != readOnly` and layout != Chat | `ViewAction(duplicate)` | `FlowySvgs.duplicate_s` | `disclosureAction_duplicate` "Duplicate" | `ViewEvent.duplicate` |
| 4 | `accessLevel != readOnly` | `ViewAction(moveTo)` – rendered only when `userProfile.workspaceType == ServerW`, else `SizedBox.shrink` | `FlowySvgs.move_to_s` | `disclosureAction_moveTo` "Move to" | sub-popover `MovePageMenu` |
| 5 | `accessLevel != readOnly` | `ViewAction(delete)` | `FlowySvgs.trash_s` (icon+text turn `colorScheme.error` on hover) | `disclosureAction_delete` "Delete" | delete flow |
| 5b | `accessLevel != readOnly` | divider | | | |
| 6 | `documentCounters != null || createdAt != null` | `ViewMetaInfo` + `VSpace 4` | | see below | |

In the default LocalW workspace the menu is therefore: Font size (docs), divider, Duplicate (not chat), Delete, divider, meta info. With `FeatureFlag.sharedSection` OFF (default; can be overridden by KV `KVKeys.featureFlag`) `accessLevel` is always `fullAccess`.

Row metrics (`ViewMoreActionTypeWrapper._buildActionButton`, `menu/view/view_more_action_button.dart`; `CustomViewAction`, `LockPageAction` identical): `Container(height 34, padding v2)` → `FlowyIconTextButton(margin h6, iconPadding 10, leftIcon 16, text FlowyText.regular 14 lineHeight 1.0 figmaLineHeight 18)`. Divider = `Padding(all 8, FlowyDivider())`. Items in `ViewMoreActionType.disableInLockedView` (`delete, rename, moveTo, changeIcon`) are wrapped in `LockPageButtonWrapper` when `view.isLocked`: `IgnorePointer` + tooltip `LocaleKeys.lockPage_lockedOperationTooltip` ("Page locked to prevent accidental editing."). Disabled custom items use `Theme.disabledColor` for icon and text.

Font size sub-popover (`widgets/font_size_action.dart`): `AppFlowyPopover(direction leftWithCenterAligned, constraints maxHeight 40 maxWidth 240, offset (-10, 0))` → `FontSizeStepper(min 10, max 24, divisions 8 /*step 1.75*/, value DocumentAppearanceCubit.fontSize (default 16))`: `Padding(h 10) Row[FlowyText('A', 14), HSpace 6, Expanded(Slider(thumb radius 8, overlay radius 16, no value indicator)), HSpace 6, FlowyText('A', 20)]`. `onChanged` → `DocumentAppearanceCubit.syncFontSize(v)` → SharedPreferences `KVKeys.kDocumentAppearanceFontSize` (`'kDocumentAppearanceFontSize'`), applies to all documents.

Lock switch (`widgets/lock_page_action.dart`): `Container(30×20, margin right 6, FittedBox(CupertinoSwitch(value isLocked, activeTrackColor colorScheme.primary)))`, hidden while `isLoadingLockStatus`. Tap row or switch → `PageAccessLevelEvent.lock()` → `FolderEventLockView(ViewIdPB)` / `unlock()` → `FolderEventUnlockView(ViewIdPB)` (unlock increments `lockCounter`).

Duplicate (`ViewBloc.duplicate`, `workspace/application/view/view_bloc.dart`): `FolderEventDuplicateView(DuplicateViewPayloadPB{ view_id, open_after_duplicate: true, include_children: true, suffix: " (" + LocaleKeys.menuAppHeader_pageNameSuffix ("Copy") + ")", sync_after_create: true })` (no `parent_view_id` → same parent). Opening of the copy is driven by Rust/section notifications (`open_after_duplicate`).

Delete: `ViewBackendService.containPublishedPage(view)` (= `FolderEventGetPublishInfo(ViewIdPB)` for the view and every descendant, success ⇒ published). If any published → `showConfirmDeletionDialog(name: view.nameOrDefault, description: LocaleKeys.publish_containsPublishedPage)` → on confirm `ViewEvent.delete`; else `ViewEvent.delete` immediately (no confirm). `ViewEvent.delete`: unpublish published pages (`FolderEventUnpublishViews(UnpublishViewsPayloadPB{view_ids})`), `FolderEventDeleteView(RepeatedViewIdPB{items:[id]})` (moves to trash), then `FolderEventUpdateRecentViews(UpdateRecentViewPayloadPB{view_ids:[id], add_in_recent:false})`. Result: Rust sends `FolderNotification.DidMoveViewToTrash` (payload `DeletedViewPB{view_id, index?}`) → `ViewPluginNotifier.isDeleted`; the page stays open; Document shows `DocumentBanner` (bg `surfaceContainerHighest`, text `deletePagePrompt_text` "This page is in Trash", buttons `deletePagePrompt_restore` "Restore page" / `deletePagePrompt_deletePermanent` "Delete permanently"); breadcrumb switches to `Trash › Page`. Permanent delete → `forceClose` → `didDeleteStackWidget` (3.1.2).

Move to (ServerW only): sub-popover `AppFlowyPopover(constraints maxWidth 260 maxHeight 345, margin h14 v12, direction leftWithTopAligned, offset (-10, 0), clickHandler gestureDetector)` → `MovePageMenu(sourceView)` (`menu/sidebar/move_to/move_page_menu.dart`, documented with the sidebar). On select `(space, target)`: `FolderEventGetView(ViewIdPB(view.parentViewId))` → `moveViewCrossSpace` (`menu/view/view_item.dart:884`): abort if referenced-database child or `from.id == toId`; if target space ≠ current space → `ViewEvent.unpublish(sync:false)` + `switchToSpaceNotifier.value = toSpace`; then `ViewEvent.move(from, toId, null, null, null)` → `FolderEventMoveNestedView(MoveNestedViewPayloadPB{ view_id, new_parent_id: toId, prev_view_id: unset, from_section: unset, to_section: unset })` (appends as last child).

`ViewMetaInfo` (`widgets/view_meta_info.dart`): `Padding(h 6) Column(start)`; all lines `FlowyText.regular(fontSize 12, color Theme.hintColor)`:
- if `documentCounters && titleCounters`: `moreAction_wordCount` "Word count: {n}" (doc + title words, `NumberFormat()` grouping), `VSpace 2`, `moreAction_charCount` "Character count: {n}".
- if `createdAt`: (`VSpace 2` if counters shown) `moreAction_createdAt` "Created: {date}" via `UserDateFormatPB.formatDate(createdAt, withTime: true, UserTimeFormatPB)` from `AppearanceSettingsCubit`, maxLines 2.
`ViewInfoBloc` (`workspace/application/view_info/view_info_bloc.dart`): `started` → `createdAt = view.createTime` (seconds → DateTime), `titleCounters = view.name.getCounter()`; `registerEditorState` (document editor) → live `WordCountService` counters; `workspaceType` from `UserEventGetUserProfile()` → `UserProfilePB.workspaceType`. Databases/chat therefore show only "Created: …".

#### 3.4.6 `PageAccessLevelBloc` (`features/page_access_level/logic/page_access_level_bloc.dart`)
Created per view plugin in `init()` with `PageAccessLevelEvent.initial()`:
- Starts `ViewListener(view.id).onViewUpdated` → `updateLockStatus(view.isLocked)` (`DidUpdateView`).
- `sectionType` ← `FolderEventGetSharedViewSection(ViewIdPB)` (fallback `public`).
- If `!FeatureFlag.sharedSection.isOn` (default) → `accessLevel = fullAccess`, `isLocked = view.isLocked`, `isLoadingLockStatus = false`.
- Else → `FolderEventGetView` (latest `is_locked`) + `getAccessLevel` (local user/local workspace/page creator/owner+member on public ⇒ full; else `FolderEventGetSharedUsers(GetSharedUsersPayloadPB)` lookup; failure ⇒ `readOnly`).
- State: `view, isLocked, lockCounter, isLoadingLockStatus (init true), accessLevel (ShareAccessLevel), sectionType (SharedSectionType), myRole`; `isEditable = sharedSection ? accessLevel != readOnly && !isLocked : !isLocked`; `isReadOnly = accessLevel == readOnly`.
Header effects: last crumb editable only if `isEditable && !view.isLocked`; lock chip; more-menu lock row hidden for read-only; Duplicate/Move/Delete hidden for read-only.

#### 3.4.7 Share button (`plugins/shared/share/share_button.dart`, `_shared.dart`, `share_menu.dart`)
Providers per button: `ShareBloc(view)..initial` (via getIt factory), `DatabaseTabBarBloc` for database views, `ShareTabBloc(RustShareWithUserRepositoryImpl, pageId, workspaceId)` (`initialize` only if workspace ≠ LocalW).
- Button: `AFFilledTextButton.primary(text: LocaleKeys.shareAction_buttonText "Share")` – size m: padding h16 v6, radius 8, text `textStyle.body.enhanced` (14/20 w500) color `textColorScheme.onFill`, bg `fillColorScheme.themeThick` (hover `themeThickHover`).
- Click → `popoverController.show()` + `ShareTabEvent.loadSharedUsers()`; on open `ShareEvent.updatePublishStatus()` → `FolderEventGetPublishInfo(ViewIdPB)` (`PublishInfoResponsePB`; `RecordNotFound`/`LocalVersionNotSupport` = not published), `UserEventGetUserProfile` (`enablePublish = workspaceType == ServerW`).
- Popover: `AFPopover(anchor: AFAnchorAuto(offset (-176, 12)))`, `maxWidth 460`.
- Tabs = `[if enablePublish: Share, Publish] + [Export as]` → in LocalW only "Export as". Labels: `shareAction_shareTab` "Share", `shareAction_publishTab` "Publish" (prefixed by `FlowySvgs.published_checkmark_s` + HSpace 6 when published), `shareAction_exportAsTab` "Export as".
- Menu layout: `VSpace 4`, tab bar (height 28, scrollable `TabBar`, indicator `RoundUnderlineTabIndicator(width 68, color colorScheme.primary, thickness 3, insets bottom -1)`, segment padding bottom 6, text `body.enhanced` color `textColorScheme.primary` when selected/hovered else `.secondary`), `AFDivider`, content `Padding(h 8)`.
- Share tab: `FeatureFlag.sharedSection` ON → `features/share_tab` `ShareTab` (invite people, guests; upgrade dialogs `shareTab_upgradeToInviteGuest_*`); OFF (default) → `plugins/shared/share/share_tab.dart` (copy publish link). Publish tab: `publish_tab.dart` (events `FolderEventPublishView`, `FolderEventUnpublishViews`, `FolderEventSetPublishName`, `FolderEventGetPublishNamespace`, `FolderEventSetPublishNamespace`).
- Export tab (`export_tab.dart`), buttons `FlowyButton(margin v10 h14, iconPadding 12, border 1px light #14171B1E / dark white@0.1, radius 10, FlowyText lineHeight 1.0)` separated by `VSpace 10`:
  - Document: `shareAction_html` "HTML" (`FlowySvgs.export_html_s`), `shareAction_markdown` "Markdown" (`export_markdown_s`), `shareAction_clipboard` "Copy to clipboard" (`duplicate_s`), debug-only "JSON (Debug Mode)". Data: `DocumentEventOpenDocument(OpenDocumentPayloadPB{document_id})` then client-side conversion (appflowy_editor markdown/HTML encoders, `customDocumentToMarkdown`, `documentToHTML`) – Electron must port these converters. Save via native save dialog; clipboard copy toast `LocaleKeys.message_copy_success`.
  - Database: `shareAction_csv` "CSV" (`FlowySvgs.database_layout_s`) → `DatabaseEventExportCSV(DatabaseViewIdPB{value: viewId})` → `DatabaseExportDataPB.data`; debug-only "Raw Database Data (Debug Mode)" → `DatabaseEventExportRawDatabaseData`.
  - Toasts: success `settings_files_exportFileSuccess` "Export file successfully!"; failure `"${settings_files_exportFileFail}: ${error.code}"` ("Export file failed!: …").

#### 3.4.8 Notifications related to the header
| Notification (id) | Payload | Consumer → effect |
|---|---|---|
| `FolderNotification.DidUpdateView` (10, id = viewId) | `ViewPB` | `ViewPluginNotifier.view` (tab tooltip/name), `ViewTabBarItem` name, `ViewTitleBloc` crumb name/icon, `PageAccessLevelBloc` lock status |
| `DidUpdateChildViews` (11, id = viewId) | `ChildViewUpdatePB` | `ViewTitleBarBloc.reload` |
| `DidMoveViewToTrash` (14, id = viewId) | `DeletedViewPB{view_id, index?}` | `ViewPluginNotifier.isDeleted` → deleted banner, delete index for `didDeleteStackWidget` |
| `DidDeleteView` (12) / `DidRestoreView` (13) | `ViewPB` | ViewListener callbacks (document bloc) |
| `DidUpdateTrash` (15) | `RepeatedTrashPB` | `ViewTitleBarBloc.trashUpdated` |
| `DidUpdateWorkspaceSetting` (4, id = workspaceId) | `WorkspaceLatestPB` | `HomeBloc.latestView` → open in blank tab |
| `DidFavoriteView` (36) / `DidUnfavoriteView` (37) | see sidebar section | `FavoriteBloc` → star state |

---

### 3.5 Plugin registry (`startup/plugin/plugin.dart`, `startup/plugin/src/sandbox.dart`, `startup/tasks/load_plugin.dart`)

#### 3.5.1 API
```dart
enum PluginType { document, blank, trash, grid, board, calendar, databaseDocument, chat }
abstract class Plugin { PluginId get id; PluginWidgetBuilder get widgetBuilder;
  PluginNotifier? get notifier => null; PluginType get pluginType; void init(){}; void dispose(){ notifier?.dispose(); } }
abstract class PluginNotifier<T> { ValueNotifier<T> get isDeleted; void dispose(){} }
abstract class PluginBuilder { Plugin build(dynamic data); String get menuName; FlowySvgData get icon;
  PluginType get pluginType; ViewLayoutPB? get layoutType; }
abstract class PluginConfig { bool get creatable => true; }
abstract class PluginWidgetBuilder with NavigationItem {
  List<NavigationItem> get navigationItems;
  EdgeInsets get contentPadding => EdgeInsets.symmetric(horizontal: 40, vertical: 28);
  Widget buildWidget({required PluginContext context, required bool shrinkWrap, Map<String,dynamic>? data}); }
abstract mixin class NavigationItem {        // home_stack.dart
  String? get viewName; Widget get leftBarItem; Widget? get rightBarItem => null;
  Widget tabBarItem(String pluginId, [bool shortForm = false]); NavigationCallback get action; }
class PluginContext { Function(ViewPB, int?)? onDeleted; UserProfilePB? userProfile; }
registerPlugin({builder, config})  // ignores duplicates of the same PluginType
makePlugin({pluginType, data})     // unknown type → BlankPluginBuilder().build()
pluginBuilders()                   // builders whose config.creatable != false
```
`PluginSandbox` keeps a `LinkedHashMap<PluginType, PluginBuilder>`; registration order defines the `FadingIndexedStack` slot index (`indexOf` throws for unregistered types).

Registration order (`PluginLoadTask.initialize`): `blank(0, creatable false)`, `trash(1, false)`, `document(2, default true)`, `grid(3, true)`, `board(4, true)`, `calendar(5, true)`, `databaseDocument(6, false)` (registered twice, second ignored), `chat(7, true)`.
`pluginBuilders()` → `[document, grid, board, calendar, chat]` (used by `menu/view/view_add_button.dart` add-page menu).

#### 3.5.2 `ViewLayoutPB` → plugin (`workspace/application/view/view_ext.dart` `ViewExtension.plugin({arguments})`)
`ViewLayoutPB { Document = 0, Grid = 1, Board = 2, Calendar = 3, Chat = 4 }`.
| ViewLayoutPB | PluginType | Plugin class | `arguments` used |
|---|---|---|---|
| Document | `document` | `DocumentPlugin(view, pluginType, initialSelection, initialBlockId)` | `PluginArgumentKeys.selection` (Selection), `PluginArgumentKeys.blockId` |
| Grid / Board / Calendar | `grid` / `board` / `calendar` | `DatabaseTabBarViewPlugin(view, pluginType, initialRowId)` | `PluginArgumentKeys.rowId` |
| Chat | `chat` | `AIChatPagePlugin(view)` | – |
Default icons (`ViewLayoutPB.icon` / `ViewPB.defaultIcon`): Document `FlowySvgs.icon_document_s`, Grid `icon_grid_s`, Board `icon_board_s`, Calendar `icon_calendar_s`, Chat `chat_ai_page_s`.

#### 3.5.3 Every plugin – what the shell must host
| Plugin (file) | `id` | menuName / icon | Tab label | `leftBarItem` | `rightBarItem` | `contentPadding` | Body (`buildWidget`) |
|---|---|---|---|---|---|---|---|
| `BlankPagePlugin` (`plugins/blank/blank.dart`) | `""` | "Blank" / `FlowySvgData('')` | "Blank page" | `FlowyText.medium("Blank page")` | – | (not applied; `BlankPage` rendered directly) | empty `surface` |
| `TrashPlugin` (`plugins/trash/trash.dart`) | `"TrashStack"` | "TrashPB" / `FlowySvgs.trash_m` | "Trash" | `FlowyText.medium("Trash")` | null | default `h40 v28` | `TrashPage` (`plugins/trash/trash_page.dart`, `TrashBloc`): title `trash_text`, "Restore all" (`trash_restoreAll`, confirm `trash_confirmRestoreAll_*`) → `FolderEventRecoverAllTrashItems`, "Delete all" (`trash_deleteAll`, confirm `trash_confirmDeleteAll_*`) → `FolderEventPermanentlyDeleteAllTrashItem`; rows: restore (`trash_restorePage_*`) → `FolderEventRestoreTrashItem`, delete (`deletePagePrompt_deletePermanentDescription`) → `FolderEventPermanentlyDeleteTrashItem`; list `FolderEventListTrashItems` + `DidUpdateTrash` |
| `DocumentPlugin` (`plugins/document/document.dart`) | view.id | `document_menuName` "Document" / `icon_document_s` | `ViewTabBarItem` | `ViewTitleBar` | collaborators, Share, Favorite, More | `EdgeInsets.zero` | `DocumentPage` (editor; reads `DocumentAppearanceCubit`; deleted banner) – separate parity doc |
| `DatabaseTabBarViewPlugin` grid/board/calendar (`plugins/database/tab_bar/tab_bar_view.dart`; builders `plugins/database/{grid,board,calendar}/*.dart`) | view.id | `grid_menuName` "Grid" / `icon_grid_s`; `board_menuName` "Board" / `icon_board_s`; `calendar_menuName` "Calendar" / `icon_calendar_s` | `ViewTabBarItem` | `ViewTitleBar` | Share, Favorite, More | `EdgeInsets.only(top: 28)` | `DatabaseTabBarView` (own linked-views tab bar + grid/board/calendar), horizontal padding `GridSize.horizontalHeaderPadding + 40` = 80 on desktop (scale 1) |
| `DatabaseDocumentPlugin` (`plugins/database_document/database_document_plugin.dart`) | rowId | `document_menuName` / `icon_document_s` | empty | `ViewTitleBarWithRow` | `SizedBox.shrink` | zero | `DatabaseDocumentPage(view, databaseId, rowId, documentId)` – row page opened full-page, `setLatest: false` |
| `AIChatPagePlugin` (`plugins/ai_chat/chat.dart`) | view.id | "AI Chat" / `chat_ai_page_s` | `ViewTabBarItem` | `ViewTitleBar` | Favorite, More(+custom) | zero | `AIChatPage(userProfile, view)`; renders empty `SizedBox` when `PluginContext.userProfile == null` (e.g. in the secondary view) |
| `LocalToolPlugin` (`features/local_tools/local_tool_plugin.dart`, NEW) | `"local-tool:$toolId"` | not registered | `FlowyText.medium(title)` | `FlowyText.medium(title)` | none | zero | `page(user)` widget: `toolId 'jira'` → `JiraDashboardPage(user, JiraRepository(store: JiraLocalStore(userId), credentialStore: WindowsJiraCredentialStore()))`; `toolId 'templates'` → `LocalTemplateStorePage(user)` |

`LocalToolPlugin` details: bypasses the registry (constructed directly, never through `makePlugin`); `pluginType => PluginType.blank`, so it occupies the blank slot (index 0) of `FadingIndexedStack`; `notifier` null (no delete tracking, no sidebar highlight); `action => (_) {}`; `navigationItems => [this]`; `viewName = title` (tab tooltip). Titles are hard-coded English ("Jira", "Templates"). A new `_ToolBuilder` (and a new page widget instance) is created on every `widgetBuilder` access – Electron should mount the tool page once per tab.

Placeholders the Electron shell needs: `document`, `database(grid|board|calendar)`, `databaseDocument(row page)`, `chat`, `trash`, `blank`, `local-tool:jira`, `local-tool:templates`; each exposes `{id, tabLabel, tooltip(viewName), leftBar, rightBar, contentPadding, body, onDeleted}`.

#### 3.5.4 `ViewPluginNotifier` (`plugins/util.dart`)
`ViewPluginNotifier(view)` starts `ViewListener(view.id)`: `onViewUpdated` → replaces `view` (no notify); `onViewMoveToTrash` → `isDeleted.value = DeletedViewPB`. Disposed with the plugin. Database plugin calls `context.onDeleted(view, deleted.index)` immediately when `isDeleted` has an index; document/chat record the index and call `onDeleted` only on permanent delete (`forceClose`).

---

### 3.6 Electron implementation checklist (derived)
- One global `TabsStore` = `{currentIndex, tabs: [{plugin, isPinned, secondary: {plugin, shown, width}}]}` with the exact reducer rules of 3.2.2 (dedup 500 ms, last tab never closes, pinned tabs immune to close/closeOthers/switchWorkspace, close-left-tab index quirk, openPlugin replaces even pinned tab).
- Send `FolderEventSetLatestView` only when a view plugin (non-blank type, non-empty id) is set with `setLatest`.
- Render the tab strip only when `tabs.length > 1`; selection on mousedown; close button on hover; right-click menu (Close / Close other tabs / — / Pin|Unpin).
- Header = `menuSpacing` + [collapse button when sidebar hidden, non-Windows] + plugin `leftBar` (breadcrumbs) + 16px + plugin `rightBar`; height 56 (12px padding, 32px content), bg `surface`.
- Keep inactive tabs mounted; fade 250 ms only when the plugin type changes within a tab.
- Windows: 40px custom title bar above the tab strip with min/max/close and the "open sidebar" toggle when collapsed.

---

## 4. Workspace data loading, blocs, shortcuts

### 4.1 Startup sequence (desktop home)

Order of backend traffic when `/DesktopHomeScreen` mounts (times are relative; Flutter fires most in parallel):

| # | Trigger | Backend call(s) (input → output) | Result used for |
|---|---|---|---|
| 1 | `DesktopHomeScreen` FutureBuilder | `FolderEventGetCurrentWorkspaceSetting()` → `WorkspaceLatestPB{workspace_id, latest_view}`; `UserEventGetUserProfile()` → `UserProfilePB` | gate the whole screen; failure → `WorkspaceFailedScreen` |
| 2 | `HomeBloc.initial` | none; after **300 ms** re-dispatches `didReceiveWorkspaceSetting(initial WorkspaceLatestPB)`; subscribes `FolderNotification.DidUpdateWorkspaceSetting` (subject = workspace_id, payload `WorkspaceLatestPB`) via `FolderListener` (`user/application/user_listener.dart`) | `latestView` → open in first (blank) tab + switch space (§1.1 item 4) |
| 3 | `FavoriteBloc.initial` | subscribes `FavoriteListener` (`FolderNotification.DidFavoriteView`/`DidUnfavoriteView`); `fetchFavorites` → `FolderEventReadFavorites()` → `RepeatedFavoriteViewPB{items: [SectionViewPB]}` | Favorites section (§2B) |
| 4 | `UserWorkspaceBloc.initialize` (`features/workspace/logic/workspace_bloc.dart`) | `UserListener.start` (UserNotification: profile updated, workspace list updated, workspace updated); `repository.getCurrentWorkspace()` = `FolderEventReadCurrentWorkspace()` → `WorkspacePB`; `repository.getWorkspaces()` = `UserEventGetAllWorkspace()` → `RepeatedUserWorkspacePB`; if the resolved current workspace id ≠ backend current → `UserEventOpenWorkspace(UserWorkspaceIdPB{workspace_id, workspace_type})`; `fetchWorkspaceSubscriptionInfo` (billing; `isBillingEnabled()` false in self-hosted/`planBilling` off → no-op) | `currentWorkspace`, `workspaces` (sorted by `created_at_timestamp` asc), `isCollabWorkspaceOn = userProfile.user_auth_type == AuthTypePB.Server && collaborativeWorkspace flag` (§2A) |
| 5 | `HomeSideBar` (`menu/sidebar/sidebar.dart`) once `currentWorkspace != null` | `SidebarPlanBloc.init(workspaceId, user)` → `UserEventGetWorkspaceUsage(UserWorkspaceIdPB)` (fails silently when unsupported); `SidebarSectionsBloc.initial(user, workspaceId)` → `FolderEventReadWorkspaceViews(GetWorkspaceViewPB{value: workspaceId})` (public) + `FolderEventReadPrivateViews(GetWorkspaceViewPB)` (private) + `WorkspaceSectionsListener` (`FolderNotification.DidUpdateSectionViews`, payload `SectionViewsPB`); `SpaceBloc.initial(openFirstPage: false)` → same two reads, filters `isSpace` views, reads KV `lastOpenedSpaceId` + `expandedViews`, may create default spaces / migrate (§2B) | Sidebar tree |
| 6 | Each visible `ViewItem` (`menu/view/view_item.dart`) | `ViewBloc.initial` → `ViewListener.start` (`FolderNotification.DidUpdateView` subject = view id, `DidUpdateChildViews` subject = parent id, `DidFavoriteView`/`DidUnfavoriteView` subject `"favorite"`) + `FolderEventGetView`/child loading when expanded; reads KV `expandedViews` | Tree rows (§2C) |
| 7 | `NotificationButton` init (§2A) and `UserWorkspaceBloc` on workspace open | `ReminderEvent.started` → `UserEventGetAllReminders()` + `FolderEventGetAllViews()` | unread badge, notification panel |
| 8 | `TabsBloc` (singleton; state survives across workspace switches until `switchWorkspace`) | on open: `FolderEventSetLatestView(ViewIdPB)` (skipped for blank-type plugins — modified rule, §3). Rust `set_current_view` also appends the id to the recent list (`add_recent_view_ids`) and emits `DidUpdateRecentViews`; the client never calls `UpdateRecentViews(add_in_recent: true)` on desktop open | §3 |
| 9 | `CommandPalette` (lazy, on open) | `FolderEventReadRecentViews(ReadRecentViewsPB{start: 0, limit: 100})` (via `CachedRecentService`); `SearchEventStreamSearch(...)` | search |

Workspace switch (from workspace menu, §2A): `UserEventOpenWorkspace` → `UserWorkspaceBloc` emits new `currentWorkspace` with `actionResult.actionType == open` → `HomeSideBar` rebuilds (`buildWhen` on `currentWorkspace.workspace_id`) but its un-keyed `MultiBlocProvider` keeps the **same** `SidebarSectionsBloc`/`SpaceBloc` instances (Flutter only re-runs `create` when the element is replaced) → the switch is applied by the `UserWorkspaceBloc` listener, which dispatches `SpaceEvent.reset(user, workspaceId, openFirstPage: true)` (or `SidebarSectionsEvent.reload` when no spaces) + `FavoriteEvent.fetchFavorites`; `CommandPaletteEvent.workspaceChanged`; `SidebarPlanEvent.changedWorkspace`; `getIt<CachedRecentService>().reset()`; `TabsEvent.switchWorkspace(workspaceId)` is sent by the workspace menu **before** `openWorkspace`: closes all non-pinned tabs except the current one, `currentIndex = 0` (§3.2.2); the old page stays open until the new space/first page is opened by `SpaceEvent.reset(openFirstPage: true)`. Same reload happens for `WorkspaceActionType.create` and `.delete`.

### 4.2 Blocs on the home screen (who owns what)

| Bloc / notifier | File | Scope / lifetime | Owns | Detailed in |
|---|---|---|---|---|
| `HomeBloc` | `workspace/application/home/home_bloc.dart` | per home mount | `HomeState{isLoading, workspaceSetting: WorkspaceLatestPB, latestView: ViewPB?}`; events `initial`, `showLoading(bool)`, `didReceiveWorkspaceSetting(WorkspaceLatestPB)` — ignores `latestView` if it `isSpace` (state not emitted at all in that case) | §4.1 |
| `HomeSettingBloc` | `workspace/application/home/home_setting_bloc.dart` | per home mount | sidebar status/width, notification panel | §1.3 |
| `UserWorkspaceBloc` | `features/workspace/logic/workspace_bloc.dart` (+ `_event.dart`, `_state.dart`) | per user | workspaces list, current workspace, role, member counts, action results | §2A |
| `SidebarPlanBloc` | `workspace/application/sidebar/billing/sidebar_plan_bloc.dart` | per sidebar mount (`changedWorkspace` on switch) | storage/AI limit toast in sidebar footer (`SidebarToast`) | §2A |
| `SidebarSectionsBloc` | `workspace/application/menu/sidebar_sections_bloc.dart` | per sidebar mount; re-pointed by `reload` on workspace switch (only when no spaces) | public/private root views (non-space mode), `lastCreatedRootView` (auto-opens) | §2B |
| `SpaceBloc` | `workspace/application/sidebar/space/space_bloc.dart` | per sidebar mount; re-pointed by `reset(user, wsId, openFirstPage: true)` on workspace switch | spaces, current space, expand state, `lastCreatedPage` (auto-opens), duplicating flag | §2B |
| `FolderBloc` | `workspace/application/sidebar/folder/folder_bloc.dart` | per section header | section expand state (KV `expandedViews`) | §2B |
| `FavoriteBloc` | `workspace/application/favorite/favorite_bloc.dart` | per home mount | favorite views, pinned, others | §2B |
| `ViewBloc` | `workspace/application/view/view_bloc.dart` | per tree row (`getIt.registerFactoryParam<ViewBloc, ViewPB>`) | one view + its children, expand/rename/delete/duplicate/move | §2C |
| `TabsBloc` | `workspace/application/tabs/tabs_bloc.dart` | app singleton (`registerLazySingleton`) | page managers (tabs), current index | §3 |
| `MenuSharedState` | `workspace/presentation/home/menu/menu_shared_state.dart` | app singleton | `latestOpenView` (ValueNotifier) — drives sidebar selection highlight; set by TabsBloc on select/open | §2C, §3 |
| `RenameViewBloc` | `workspace/application/sidebar/rename_view/rename_view_bloc.dart` | app singleton wrapping one `PopoverController` | F2 rename | §2C, §4.4 |
| `ActionNavigationBloc` | `workspace/application/action_navigation/action_navigation_bloc.dart` | app singleton | deep-link navigation requests (reminders, mentions) → `HomeSideBar._onNotificationAction` → `TabsBloc.openPlugin(view, arguments: {selection(nodePath), blockId, rowId})` | §2A |
| `ReminderBloc` | `user/application/reminder/reminder_bloc.dart` | app singleton | reminders / notifications | §1.6 |
| `CommandPaletteBloc` | `workspace/application/command_palette/command_palette_bloc.dart` | app level | search | §4.4 |
| `CachedRecentService` | `workspace/application/recent/cached_recent_service.dart` | lazy singleton, reset on workspace change | recent views | §3 |

### 4.3 Notifications consumed by the shell (summary)

All shell notifications arrive through the Rust notification stream filtered by `SubscribeObject.source` (`"Workspace"` for FolderNotification, `"User"`, `"Document"`, `"Database"`; search uses `"<source><channel>"`) and `SubscribeObject.id` (subject id) (`core/notification/folder_notification.dart` `FolderNotificationListener(objectId, handler)`, `core/notification/user_notification.dart`). Full `FolderNotification` table with payload types and listeners is in §2C; the shell-level ones:

| Notification | Subject id | Payload | Consumer |
|---|---|---|---|
| `FolderNotification.DidUpdateWorkspaceSetting` | workspace id | `WorkspaceLatestPB` | `HomeBloc` (latest view) |
| `FolderNotification.DidUpdateSectionViews` | workspace id | `SectionViewsPB{section, views}` | `SidebarSectionsBloc`, `SpaceBloc` |
| `FolderNotification.DidFavoriteView` / `DidUnfavoriteView` | `"favorite"` (literal) | `RepeatedViewPB` | `FavoriteBloc` (§2B) |
| `FolderNotification.DidUpdateSharedViews` | workspace id | see §2B | Shared section (flag off by default) |
| `FolderNotification.DidUpdateView` (10) | view id | `ViewPB` | `ViewBloc`, `ViewPluginNotifier` (tab title/icon), `ViewTitleBarBloc` |
| `FolderNotification.DidUpdateChildViews` (11) | **parent** view id | `ChildViewUpdatePB` | `ViewBloc` of the parent |
| `FolderNotification.DidMoveViewToTrash` (14) | view id | `DeletedViewPB` | `ViewPluginNotifier.isDeleted` (open tab shows deleted banner) |
| (`DidDeleteView` 12 / `DidRestoreView` 13 are never sent by Rust — do not rely on them) | | | |
| `FolderNotification.DidUpdateRecentViews` (38) | `"recent_views"` | `RepeatedViewIdPB` | `CachedRecentService` |
| `FolderNotification.DidUpdateTrash` (15) | `"trash"` | `RepeatedTrashPB` | Trash page, `ViewTitleBarBloc`, `CommandPaletteBloc` |
| `UserNotification.DidUpdateUserProfile` | user id | `UserProfilePB` | `UserWorkspaceBloc.emitUserProfile` |
| `UserNotification.DidUpdateUserWorkspaces` | user id | `RepeatedUserWorkspacePB` | `UserWorkspaceBloc.emitWorkspaces` |
| `UserNotification.DidUpdateUserWorkspace` | user id | `UserWorkspacePB` | `UserWorkspaceBloc.emitCurrentWorkspace` (if id matches) |
| `UserNotification.DidOpenWorkspace` | user id | `UserProfilePB` | `UserListener` profile notifier → `UserWorkspaceBloc.emitUserProfile` |
| `UserNotification.DidUpdateWorkspaceSetting` | user id | `WorkspaceSettingsPB` | `UserListener.onUserWorkspaceSettingUpdated` (settings pages; not used by home) |
| `UserNotification.DidUpdateReminder` / `DidLoadUserAwareness` | — | `ReminderPB` / — | `ReminderBloc` via `ReminderListener` |

(Exact enum names/values are verified in §2C/§2A; where this table and those differ, those sections win.)

### 4.4 Keyboard shortcuts registered on the home screen

Registered by `HomeHotKeys` (`workspace/presentation/home/hotkeys.dart`) via `hotkey_manager` with `HotKeyScope.inapp` (only while the app window is focused; **not** OS-global). Registered in `initState` and again in every `didChangeDependencies` (re-registering replaces). `HotKeyTask` (`startup/tasks/hot_key.dart`) calls `hotKeyManager.unregisterAll()` at startup. "Mod" = Ctrl on Windows/Linux, Cmd on macOS. Electron: implement as renderer `keydown` handlers on `window` (capture phase so they work while the editor has focus), not `globalShortcut`.

| Keys | Action | Implementation |
|---|---|---|
| Mod+`\` | Toggle sidebar; if notification panel is open, close it instead | `colappsedMenus()` → `HomeSettingEvent.collapseNotificationPanel()` if `!isNotificationPanelCollapsed`, else `HomeSettingBloc.collapseMenu()` (expanded↔hidden, persisted) |
| Mod+`.` | same as Mod+`\` | |
| Mod+Shift+L | Toggle light/dark | `AppearanceSettingsCubit.toggleThemeMode()` (persists `AppearanceSettingsPB.theme_mode`) |
| Mod+W | Close current tab | `TabsEvent.closeCurrentTab()` (§3) |
| Mod+PageUp | Previous tab | `TabsEvent.selectTab(currentIndex - 1)` (no wrap; TabsBloc ignores out-of-range — see §3) |
| Mod+PageDown | Next tab | `TabsEvent.selectTab(currentIndex + 1)` |
| F2 | Rename current view | `getIt<RenameViewBloc>().add(RenameViewEvent.open())` → shows the rename popover attached to the **currently selected sidebar view item** (`view_item.dart` L631 binds `RenameViewBloc.state.controller` to the selected item; see §2C) |
| Mod+`=` / Mod+NumpadAdd / Mod+`+` (KeyCode.add) | Zoom in +0.1 | `_scaleWithStep(0.1)`: `scale = clamp(current + 0.1, 0.5, 2.0)` rounded to 2 decimals → `ScaledWidgetsFlutterBinding.scaleFactor` + KV `scaleFactor` |
| Mod+`-` / Mod+NumpadSubtract | Zoom out −0.1 | same, −0.1 |
| Mod+`0` / Mod+Numpad0 | Reset zoom to 1.0 | `_scale(1)` |
| Mod+O | Switch to next space | `switchToTheNextSpace.value++` (global `ValueNotifier<int>`) → `SidebarSpace._switchToNextSpace` (§2B) |
| Mod+N | Create new page | `createNewPageNotifier.value++` → `SidebarNewPageButton._createNewPage` (§2A) |
| Mod+`,` | Open settings dialog; if any dialog/route is open over the home, pop to first route instead | `openSettingsHotKey(context)` (`menu/sidebar/shared/sidebar_setting.dart`): `_settingsDialogKey.currentContext == null` → `showSettingsDialog(context, userWorkspaceBloc)`, else `Navigator.popUntil(isFirst)` |
| Mod+P | Toggle command palette (search) | Not a hotkey_manager key: `FocusableActionDetector` with `LogicalKeySet(Ctrl/Meta, KeyP)` in `CommandPalette` (`workspace/presentation/command_palette/command_palette.dart`), mounted above the whole app when `FeatureFlag.search.isOn` (true). Opens `CommandPaletteModal` (FlowyDialog, top-aligned, inset top 100, min 572×640, max 960×640, bg `theme.surfaceColorScheme.layer01`, padding xl=16). Empty query → `RecentViewsList` (`FolderEventReadRecentViews`); query → `SearchEventStreamSearch`; no results + `workspaceType == ServerW` → "Ask AI" entry that creates a `ViewLayoutPB.Chat` page via `SpaceEvent.createPage(name:'', layout: Chat, index: 0, openAfterCreate: true)`. (Search UI spec belongs to the search parity doc.) |

Other in-shell keyboard handling: `Esc`/`Enter` in space create/rename dialogs (`menu/sidebar/space/shared_widget.dart` `KeyboardListener`), `Esc` in import panel; tab-specific and editor shortcuts are outside the shell.

Global notifiers in `hotkeys.dart` (Electron: a tiny event bus / store):
- `switchToTheNextSpace: ValueNotifier<int>` — increment = "go to next space".
- `createNewPageNotifier: ValueNotifier<int>` — increment = "create page in current space".
- `switchToSpaceNotifier: ValueNotifier<ViewPB?>` — set by `DesktopHomeScreen._switchToSpace` (latest view's space) and others; `SidebarSpace` listens and switches the current space.
- `appflowyScaleFactor` (test-only).

### 4.5 Persisted shell state (all stores)

Client KV = `KeyValueStorage` → `DartKeyValue` (`core/config/kv.dart`) = `shared_preferences` (on Windows a JSON file under `%APPDATA%`; Flutter prefixes stored keys with `flutter.` — AMBIGUOUS whether Electron must read the Flutter file for migration; a fresh store is acceptable). Values are always strings.

| Store | Key / field | Value format | Written by | Read by |
|---|---|---|---|---|
| KV | `windowSize` | `{"height":960.0,"width":1280.0}` | `InitAppWindowTask.onWindowResize` | window init |
| KV | `windowPosition` | `{"dx":X,"dy":Y}` | move / unmaximize | window init |
| KV | `windowMaximized` | `"true"`/`"false"` | maximize / fullscreen listeners | window init (Windows: re-maximize) |
| KV | `scaleFactor` | `"1.1"` (0.5..2.0) | zoom hotkeys | startup |
| KV | `textScaleFactor` | `"0.9"` (0.7..1.0) | settings | `AppearanceSettingsCubit` |
| KV | `expandedViews` | `{"<viewId>|favorite|public|private": true}` (collapsed = key removed; missing = expanded) | `ViewBloc`, `SpaceBloc`, `FolderBloc`, `TabsBloc` (expands ancestors on open) | same |
| KV | `lastOpenedSpaceId` | space view id | `SpaceBloc._openSpace` | `SpaceBloc.initial` |
| KV | `showNotificationIcon` | `"true"`/`"false"` | settings | `NotificationSettingsCubit` (sidebar notification button visibility, §2A) |
| KV | `featureFlag` | `{"sharedSection":true,...}` | dev settings | `FeatureFlag.initialize` |
| KV | `kRecentIcons` | JSON `RecentIcons` | icon picker | icon picker |
| `AppearanceSettingsPB` (Rust, `UserEventSet/GetAppearanceSetting`) | `is_menu_collapsed`, `menu_offset`, `theme`, `theme_mode`, `font`, `monospace_font`, `layout_direction`, `text_direction`, `enable_rtl_toolbar_items`, `locale`, `document_setting{cursor_color, selection_color}`, `setting_key_value` | PB | `AppearanceSettingsCubit` | startup |
| Folder (Rust) | workspace `latest_view` | via `FolderEventSetLatestView(ViewIdPB)` | `TabsBloc` on open (not for blank plugin) | `FolderEventGetCurrentWorkspaceSetting` on next launch → `HomeBloc.latestView` |
| Folder (Rust) | recent views | appended by Rust inside `FolderEventSetLatestView`; removed via `FolderEventUpdateRecentViews(UpdateRecentViewPayloadPB{view_ids, add_in_recent: false})` from `ViewBloc.delete` (`CachedRecentService.updateRecentViews`) | command palette (`FolderEventReadRecentViews`) |
| Folder (Rust) | favorites, sections, spaces (`ViewPB.extra`), view icon, lock | folder events | sidebar | sidebar |
| — | open tabs, pinned tabs, notification panel open, sidebar hover state | **not persisted** (only the latest view is restored on launch, in tab 0) | | |

Unused keys on desktop: `expandedFolders`, `lastOpenedSpace`, `spaceOrder`, `hasUpgradedSpace060` (mobile only), `lastOpenedWorkspaceId` (deprecated), `showRenameDialogWhenCreatingNewFile` (deprecated).

---

## 5. Visual system (shared tokens used by every shell widget)

Sections 2A–3 cite tokens symbolically; this section resolves them for the default theme. Theme selection: `AppearanceSettingsPB.theme` (default `"Default"`, Rust `APPEARANCE_DEFAULT_THEME`), `theme_mode` (default `ThemeMode.system`), `font` (default `""` = platform font; Windows → Segoe UI), monospace default `"SF Mono"` (Flutter uses `RobotoMono` as built-in code font). Other built-in color schemes: `Dandelion`, `Lavender`, `Lemonade` (`packages/flowy_infra/lib/colorscheme/*.dart`) + user plugin themes — same token names, different values. `AppFlowyTheme` (appflowy_ui) **always** uses `AppFlowyDefaultTheme` regardless of the selected color scheme (`startup/tasks/app_widget.dart` L150, `AnimatedAppFlowyTheme`).

Global text scale: KV `textScaleFactor` (double string, clamped 0.7..1.0) applied via `MediaQuery.textScaler` to all text and to `FlowySvg` (icons are `Transform.scale`d by the same factor). Global UI zoom: KV `scaleFactor` (0.5..2.0, §4.4). Material 3 is **off** (`useMaterial3: false`), `VisualDensity.standard`, `MaterialTapTargetSize.shrinkWrap`.

### 5.1 Material `ColorScheme` / `ThemeData` (desktop) — `workspace/application/settings/appearance/desktop_appearance.dart`

Source `FlowyColorScheme` = `DefaultColorScheme.light()/dark()` (`packages/flowy_infra/lib/colorscheme/default_colorscheme.dart`). Hex with alpha is CSS order `#RRGGBBAA` (Dart `Color(0xAARRGGBB)` converted).

| Token (`cs.` = colorScheme) | FlowyColorScheme field | Light | Dark |
|---|---|---|---|
| `cs.primary` | `primary` (main1) | `#00BCF0` | `#00BCF0` |
| `cs.onPrimary` | `onPrimary` | `#FFFFFF` | `#131720` |
| `cs.primaryContainer` | `main2` | `#00B7EA` | `#00B7EA` |
| `cs.onPrimaryContainer` | const white | `#FFFFFF` | `#FFFFFF` |
| `cs.secondary` (FlowyHover / FlowyButton default hover) | `hoverBG1` | `#1F23290F` (rgba(31,35,41,.06)) | `#FFFFFF1A` (white 10%) |
| `cs.onSecondary` | `shader1` | `#333333` | `#131720` |
| `cs.secondaryContainer` | `selector` | `#F2FCFF` | `#1A202C` |
| `cs.onSecondaryContainer` | `topbarBg` | `#FFFFFF` | `#131720` |
| `cs.tertiary` | `shader7` | `#333333` | `#FFFFFF` |
| `cs.onTertiary` | `toolbarColor` | `#333333` | `#282E3A` |
| `cs.tertiaryContainer` | `questionBubbleBG` | `#F2FCFF` | `#363D49` |
| `cs.surface` (page bg, scaffold, dialogs, canvas) | `surface` | `#FFFFFF` | `#1A202C` |
| `cs.onSurface` (text/icon on hover) | `hoverFG` | `#333333` | `#FFFFFFE5` |
| `cs.inverseSurface` (grey hover) | `hoverBG3` | `#F2F2F2` | `#363D49` |
| `cs.error` / `cs.onError` | `red` / `onPrimary` | `#FB006D` / `#FFFFFF` | `#FB006D` / `#131720` |
| `cs.outline` | `shader4` | `#BDBDBD` | `#505469` |
| `cs.surfaceContainerHighest` (**sidebar bg**, Windows title bar) | `sidebarBg` | `#F7F8FC` | `#232B38` |
| `cs.shadow` | `shadow` | `rgba(0,0,0,.15)` | `#0F131C` |
| `Theme.dividerColor` (sidebar right border) | `divider` | `#F2F2F2` | `#363D49` |
| `Theme.hintColor` (shortcut hints in tooltips, placeholders) | `hint` | `#828282` | `#59647A` |
| `Theme.hoverColor` (action-list item hover) | `hoverBG2` | `#E0F8FF` | `#00BCF0` |
| `Theme.disabledColor` | `shader4` | `#BDBDBD` | `#505469` |
| `Theme.highlightColor` / `indicatorColor` | `main1` | `#00BCF0` | `#00BCF0` |
| `Theme.cardColor` (popover bg) | `input` | `#FFFFFF` | `#282E3A` |
| `Theme.iconTheme.color` (default FlowySvg color) | `icon` | `#333333` | `#BBC3CD` |
| text color (`textTheme.*.color`) | `text` | `#333333` | `#BBC3CD` |
| Scrollbar thumb (normal / hover-pressed-dragged) | `scrollbarColor` / `scrollbarHoverColor` | `#1717173F` / `#1717177F` | `#FFFFFF40` / `#FFFFFF80` |

Scrollbar: thickness 4, crossAxisMargin 0, mainAxisMargin 6, radius 10. Text selection cursor/handle: `main2` `#00B7EA`.

`textTheme` (`base_appearance.dart`; letterSpacing = `fontSize * 0.005`): `displayLarge` 32/w600/lh 42 (sic: Flutter `height` is a multiplier; 42.0 here is a bug-level value — AMBIGUOUS, unused in shell), `displayMedium` 24/w600, `displaySmall` 20/w600, `titleLarge` 18/w600, `titleMedium` 16/w600, `titleSmall` 14/w600, `bodyMedium` 14/w400 (**default for FlowyText**), `bodySmall` 14/w400.

### 5.2 `AFThemeExtension.of(context)` (`packages/flowy_infra/lib/theme_extension.dart`)

| Field | Light | Dark |
|---|---|---|
| `warning` | `#FFD667` | `#F7CF46` |
| `success` | `#66CF80` | `#66CF80` |
| `tint1..tint9` | `#E8E0FF #FFE7FD #FFE7EE #FFEFE3 #FFF2CD #F5FFDC #DDFFD6 #DEFFF1 #E1FBFF` | `#502FD64D #BF1CC04D #C42A534D #D779224D #C59A1A4D #A4C8244D #23CA2E4D #19CCAC4D #04A9D74D` |
| `textColor` / `onBackground` | `#333333` | `#BBC3CD` |
| `secondaryTextColor` | `#4F4F4F` | `#BBC3CD` |
| `strongText` | `#000000` | `#FFFFFF` |
| `greyHover` | `#1F23290F` | `#FFFFFF1A` |
| `greySelect` | `#E2E4EB` | `#00BCF0` |
| `lightGreyHover` / `calloutBGColor` | `#F2F2F2` | `#363D49` |
| `toggleOffFill` / `toggleButtonBGColor` | `#E0E0E0` / `#E0E0E0` | `#BBC3CD` / `#828282` |
| `progressBarBGColor` | `#E1FBFF` | `#363D49` |
| `calendarWeekendBGColor` | `#FBFBFC` | `#131720` |
| `gridRowCountColor` | `#333333` | `#BBC3CD` |
| `background` / `tableCellBGColor` | `#FFFFFF` | `#1A202C` |
| `borderColor` | `#EDEDEE` | `#3A3F49` |
| `lightIconColor` | `#8F959E` | `#8F959E` |
| `toolbarHoverColor` | `#F2F4F7` | `#F2F2F2` |
| `caption` | 11px w400 `hint` color | same, dark hint |
| `callout` | 11px `shader3` (`#828282` / `#363D49`) | |
| `code` | code font, `shader3` | |

### 5.3 `AppFlowyTheme.of(context)` (`packages/appflowy_ui/lib/src/theme/data/appflowy_default/semantic.dart` + `primitive.dart`, resolved)

ARGB alpha noted as `aXX` (e.g. `#1F23290D` = rgba(31,35,41,0.051)).

| Token | Light | Dark |
|---|---|---|
| `textColorScheme.primary` | `#21232A` | `#E4E8F5` |
| `textColorScheme.secondary` | `#6F748C` | `#989EB7` |
| `textColorScheme.tertiary` | `#989EB7` | `#6F748C` |
| `textColorScheme.quaternary` | `#E4E8F5` | `#21232A` |
| `textColorScheme.onFill` | `#FFFFFF` | `#FFFFFF` |
| `textColorScheme.action` / `actionHover` | `#0092D6` / `#0078C0` | `#00B5FF` / `#4EC1FF` |
| `textColorScheme.error` / `errorHover` | `#E71D32` / `#AD1625` | `#F33641` / `#FF5050` |
| `textColorScheme.warning` / `success` / `featured` | `#DB7E21` / `#248569` / `#9327FF` | same |
| `iconColorScheme.primary` | `#21232A` | `#E4E8F5` |
| `iconColorScheme.secondary` | `#6F748C` | `#B5BBD3` |
| `iconColorScheme.tertiary` | `#B5BBD3` | `#6F748C` |
| `iconColorScheme.quaternary` | `#E4E8F5` | `#21232A` |
| `iconColorScheme.errorThick` / `featuredThick` | `#E71D32` / `#9327FF` | `#F33641` / `#9327FF` |
| `borderColorScheme.primary` / `primaryHover` | `#E4E8F5` / `#CED3E6` | `#3D404F` / `#54596E` |
| `borderColorScheme.secondary` / `tertiary` | `#3D404F` / `#21232A` | `#CED3E6` / `#F8FAFF` |
| `borderColorScheme.themeThick` / `themeThickHover` | `#00B5FF` / `#0092D6` | `#00B5FF` / `#0092D6` |
| `borderColorScheme.errorThick` | `#E71D32` | `#F33641` |
| `fillColorScheme.primary` / `primaryHover` | `#F8FAFF` / `#E4E8F5` | `#272930` / `#3D404F` |
| `fillColorScheme.secondary` / `tertiary` / `quaternary` | `#CED3E6` / `#6F748C` / `#21232A` | `#6F748C` / `#CED3E6` / `#F8FAFF` |
| `fillColorScheme.content` | transparent | transparent |
| `fillColorScheme.contentHover` / `contentVisible` | `#1F23290D` | `#F9FAFD0D` |
| `fillColorScheme.contentVisibleHover` | `#1F23291A` | `#F9FAFD1A` |
| `fillColorScheme.themeThick` / `themeThickHover` | `#00B5FF` / `#0092D6` | same |
| `fillColorScheme.themeSelect` (selected row) | `#00B5FF26` (15%) | same |
| `fillColorScheme.textSelect` | `#00B5FF33` | same |
| `fillColorScheme.errorThick` / `errorLight` / `errorSelect` | `#E71D32` / `#FFD2DD` / `#F336411A` | `#F33641` / `#FFA5B4` / `#F336411A` |
| `fillColorScheme.infoLight` / `warningLight` / `successLight` / `featuredLight` | `#E3F6FF` / `#FFF3D5` / `#ECF9F5` / `#F1E0FF` | `#A9E2FF` / `#FFE4AB` / `#C3E5D8` / `#E1B3FF` |
| `surfaceColorScheme.primary` / `layer01` | `#FFFFFF` | `#272930` |
| `surfaceColorScheme.primaryHover` / `layer01Hover` | `#F8FAFF` | `#3D404F` |
| `surfaceColorScheme.layer02` / `layer03` / `layer04` | `#FFFFFF` | `#32343F` / `#32343F` / `#363845` |
| `surfaceColorScheme.inverse` (toast bg) | `#21232A` | `#3D404F` |
| `surfaceColorScheme.overlay` (modal scrim) | `#00000099` | same |
| `surfaceContainerColorScheme.layer01/02/03` | `#F8FAFF` / `#E4E8F5` / `#CED3E6` | `#272930` / `#3D404F` / `#54596E` |
| `backgroundColorScheme.primary` | `#FFFFFF` | `#21232A` |
| `brandColorScheme.skyline/aqua/violet/amethyst/berry/coral/golden/amber/lemon` | `#00B5FF #00C8FF #9327FF #8427E0 #E3006D #FB006D #F7931E #FFBD00 #FFCE00` | same |
| `otherColorsColorScheme.textHighlight` | `#A9E2FF` | same |
| `badgeColorScheme.color{1..20}{Light1..3,Thick1..3}` | subtle palette (Rose, Papaya, Tangerine, Mango, Lemon, Olive, Lime, Grass, Forest, Jade, Aqua, Azure, Denim, Mauve, Lavender, Lilac, Mallow, Camellia, Smoke, Iron) 100..600 in `primitive.dart` | |

- `spacing`: `xs 4`, `s 6`, `m 8`, `l 12`, `xl 16`, `xxl 20`.
- `borderRadius`: `xs 4`, `s 6`, `m 8`, `l 12`, `xl 16`, `xxl 20`.
- `shadow.small`: light `0 2px 16px #0000001F`, dark `0 2px 16px #0000007A`; `shadow.medium`: `0 4px 32px` same colors.
- `textStyle.<type>.standard|enhanced|prominent|underline(color:)` → weight w400 | w500 | w700 | w400+underline; `inherit:false`, `leadingDistribution: even`. Sizes / line heights: `heading1` 36/40, `heading2` 24/32, `heading3` 20/28, `heading4` 16/22, `headline` 24/36, `title` 20/28, `body` 14/20, `caption` 12/18 (`definition/text_style/base/default_text_style.dart`).

### 5.4 Shared widget primitives (defaults the shell relies on)

| Widget | Defaults (Electron component should replicate) |
|---|---|
| `FlowyText` (`packages/flowy_infra_ui/lib/style_widget/text.dart`) | font size = `fontSize ?? textTheme.bodyMedium.fontSize (14)`; `FlowyText.regular` w400, `.medium` w500, `.semibold` w600, `.small` w400 **12px**; `maxLines` default 1 with ellipsis (`overflow`); `figmaLineHeight` → `lineHeight = figmaLineHeight / fontSize`; color default = text color (§5.1). Emoji text on Windows scaled ×0.9. |
| `FlowyHover` (`style_widget/hover.dart`) | `HoverStyle(borderRadius: 6, contentMargin: 0, backgroundColor: transparent, hoverColor: cs.secondary)`; on hover foreground text/icon color → `foregroundColorOnHover ?? cs.onSurface`; `isSelected()` keeps hover bg. |
| `FlowyButton` (`style_widget/button.dart`) | padding (`margin`) `EdgeInsets.symmetric(h 6, v 4)`; radius `Corners.s6Border` (6); hover `cs.secondary`; `leftIconSize 16×16`; `iconPadding 6` between icon and text; `disableOpacity 0.5`; `expandText true`. |
| `FlowyIconButton` (`style_widget/icon_button.dart`) | `width 30` (square unless height given), `fillColor transparent`, `hoverColor` default = `cs.secondary`, `iconPadding 0`, radius 6, icon color on hover `iconColorOnHover ?? iconTheme.color`, tooltip via `tooltipText`/`richTooltipText`. |
| `FlowyTooltip` (`packages/flowy_infra_ui/lib/widget/flowy_tooltip.dart`) | wait 300ms; `verticalOffset 16`; padding h12 v8; bg light `#1D2129`, dark `#E5E5E5E5`; radius 10; text 14px w400 line-height 20, color white (light) / black (dark); hint line (shortcut) uses `Theme.hintColor` or `tooltipHintTextStyle` (70% alpha). Rich tooltips used throughout: `"<label>\n<shortcut>"`. |
| `AppFlowyPopover` (`packages/flowy_infra_ui/lib/src/flowy_overlay/appflowy_popover.dart`) | default `direction: rightWithTopAligned`, `constraints: maxWidth 240, maxHeight 600`, `margin (inner padding): 6`, `windowPadding 8`, trigger = click, no barrier; decoration `getPopoverDecoration`: bg `Theme.cardColor` (`#FFFFFF`/`#282E3A`), 1px outside border `#EDEDEE`/`#3A3F49`, radius 10, shadow light `0 4px 20px #1F23291A`, dark `0 2px 16px #0000007A`. Open animation: slide 5px + scale 0.9→1 + fade (duration 0 by default → instant). |
| `PopoverActionList` / `ActionCell` | list of 30px-ish rows built from `FlowyButton`; hover `Theme.hoverColor`; used by question bubble & many "more" menus (row specifics in 2C/3). |
| Desktop toast `showToastNotification` (`workspace/presentation/widgets/dialogs.dart` L262) | bottom-center, auto-close 3000ms; `DesktopToast`: max width 360, padding h16 v12, margin-bottom 32, bg `theme.surfaceColorScheme.inverse`, radius 12, `shadow.small`; 20px icon `FlowySvgs.toast_checked_filled_s` / `toast_warning_filled_s` / `toast_error_filled_s` (multicolor), gap 8, text `body.standard` `textColorScheme.onFill`, max 2 lines; optional close button 24px. |
| `showSnackBarMessage` / `showMessageToast` (`workspace/presentation/home/toast.dart`) | FToast-based legacy toast, 14px desktop text, white on dark; used by "debug info copied" etc. |
| `VSpace(n)` / `HSpace(n)` | fixed spacer n px. |
