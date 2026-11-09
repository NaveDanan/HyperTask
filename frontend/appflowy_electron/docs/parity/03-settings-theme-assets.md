# 03 — Settings, theme & assets (Flutter → Electron/React parity spec)

> Historical reference: the previous client source has been removed; paths below describe the original implementation.

Reference spec for re-implementing the customized AppFlowy desktop app (Flutter) 1:1 in Electron + React. The Rust core is reused unchanged. Renderer calls go through the same protobuf events (`appflowy_flutter/packages/appflowy_backend/lib/dispatch/dart_event/<crate>/dart_event.dart`).

- Baseline: git HEAD `8fcee27d9` plus the uncommitted customizations in this checkout. **[CUSTOM]** = differs from upstream HEAD (checked with `git diff`/`git status`). **[UPSTREAM]** = unchanged upstream code.
- Flutter SDK 3.27.4 (CI pin). Framework defaults quoted below come from that SDK (Material 2 defaults, `useMaterial3: false`).
- Everything below was read from source. Items that could not be settled from code are marked **AMBIGUOUS:**. Upstream bugs are documented as they behave; where the port should decide whether to copy them, the section says so.

## 0. Conventions (read first)

| Topic | Rule |
|---|---|
| Path root | All paths are relative to `D:\Projects\appflowy\frontend`. |
| Path abbreviations | Sections A.1–A.6 and B: `AF/` = `appflowy_flutter/`. Sections A.7, C, D: `lib/` = `appflowy_flutter/lib/`, `packages/<pkg>` = `appflowy_flutter/packages/<pkg>`. Rust paths: `rust-lib/...`. |
| Color notation | CSS hex everywhere: `#RRGGBB` (opaque) or `#RRGGBBAA` (**alpha last**). When Flutter source is quoted it stays as `0xAARRGGBB` / `Color(0xAARRGGBB)` (**alpha first**). Never paste a Flutter `0x...` value into CSS without moving the alpha byte. |
| "L / D" | Light / dark value in the **Default** color scheme unless a section says otherwise. |
| Theme-token prefixes | Sections A and C: `MT.*` = `Theme.of(context)` (Material, built from `FlowyColorScheme`); `AFExt.*` = `AFThemeExtension.of(context)`; `AFT.*` = `AppFlowyTheme.of(context)` (appflowy_ui). Section D uses `MS.*` (= `Theme.of(context).colorScheme`), `TD.*` (ThemeData field), `TT.*` (textTheme), `AFX.*` (= AFThemeExtension) and `AF.<group>.*` (= AppFlowyTheme). Each section's preamble restates its legend. |
| i18n keys | Dotted JSON keys from `resources/translations/en-US.json`, with the English text. Dart `LocaleKeys.a_b_c` = key `a.b.c`. `@:appName` resolves to "AppFlowy". Strings in `'single quotes'` are hardcoded literals (not localized). |
| Sizes | Flutter logical pixels = CSS px (the app forces `ScaledWidgetsFlutterBinding` scale factor 1.0). Flutter `TextStyle.height` is a multiplier; sections give the computed px line height where it matters. |

## Contents

- **A. Theme system**: A.1 Layering overview · A.2 FlowyColorScheme fields · A.3 Built-in color schemes (hex) · A.4 AFThemeExtension · A.5 Material ThemeData (desktop) · A.6 Appearance state & persistence · A.7 appflowy_ui AppFlowyTheme (design tokens, with copy-paste CSS in A.7.7)
- **B. Assets**: B.1 Fonts · B.2 Other bundled assets · B.3 SVG icons (FlowySvgs) · B.4 i18n (easy_localization)
- **C. Settings dialog**: C.1 Dialog shell & entry points · C.2 Left menu · C.3 SettingsDialogBloc · C.4 Shared settings layout widgets · C.5 Account page · C.6 Workspace page · C.7 Cloud / Storage & server (+ self-hosting) · C.8 AI settings (OpenAI-compatible endpoint) · C.9 Company certificates · C.9a Startup wiring · C.10 Members · C.11 Shortcuts · C.12 Notifications · C.13 Manage data / storage · C.14 Plan & Billing · C.15 Sites · C.16 Feature flags · C.17 Other settings widgets · C.18 Settings-related KV keys
- **D. Shared UI primitives**: D.1 Size constants & spacing · D.2 flowy_infra_ui primitives · D.3 Popover system · D.4 appflowy_ui components · D.5 Dialogs & toasts · D.6 React component checklist

## 0.1 Key facts for the port

Theme
1. Three color layers. (1) `FlowyColorScheme` (55 fields; built-ins **Default, Dandelion, Lemonade, Lavender**, each light + dark; custom themes are `<name>.flowy_plugin` folders in the user's Documents folder, each holding a light and a dark JSON file) feeds (2) Material `ThemeData` (`useMaterial3: false`) and `AFThemeExtension`. (3) appflowy_ui `AppFlowyTheme` **always uses `AppFlowyDefaultTheme`**: it changes only with light/dark mode and the font, never with the selected color scheme or a custom theme. In CSS, keep two variable sets: `--afl-*` (scheme-dependent, A.2/A.3) and `--af-*` (fixed tokens, A.7.7).
2. Default UI font is `''`, which means the platform default font (Segoe UI on Windows). Code text always uses bundled `RobotoMono`; the backend `monospace_font` field is never read. The only bundled UI font family is `Poppins` (9 weights). The 1,598 user-selectable fonts are google_fonts downloads from `fonts.gstatic.com` at runtime.
3. Appearance is persisted in Rust via `UserEventSetAppearanceSetting` / `AppearanceSettingsPB` (theme, theme_mode, font, locale, text direction, layout direction, document cursor/selection colors) and `UserEventSetDateTimeSettings` / `DateTimeSettingsPB`. The editor caret and selection colors are additionally read from SharedPreferences (`kDocumentAppearanceCursorColor`, `kDocumentAppearanceSelectionColor`), see A.6 and C.6.
4. The desktop text scale is effectively fixed at 1.0. The setting is clamped to 0.7–1.0 in code, and nothing on desktop sets it.

Assets
5. Icons: 742 SVGs under `resources/flowy_icons/{16x,20x,24x,32x,40x}`. The generated identifier suffix comes from the folder: 16x→`_s`, 20x and 24x→`_m`, 32x→`_lg`, 40x→`_xl`. Tinting is `BlendMode.srcIn` with the icon color; reproduce it with a CSS `mask-image` + `background-color` (B.3.5). 65 Material Icons are also used, some in custom features.
6. i18n: 36 translation files, 33 selectable locales, fallback `en-US`. Plural selection uses zero/one/two/other by number only, in every language. B.4.8 recommends porting easy_localization's lookup logic (about 80 lines) instead of mapping to i18next; i18next settings are given as an alternative. **All custom screens use hardcoded English** (no new translation keys were added).

Settings dialog [CUSTOM in this checkout]
7. Menu order (C.2): Account & App · Workspace · [Members] · Manage data · Notifications · **Storage & server** · **Certificates** · Shortcuts · **AI Settings** · [Sites] · [Plan, Billing] · [Feature Flags]. Members and Sites appear only in a self-hosted server workspace (`WorkspaceTypePB.ServerW`) for non-guests. Plan and Billing never appear (`FeatureFlag.planBilling` is forced off). Feature Flags appears in debug builds only.
8. Storage & server = `SelfHostedSettingsView`: local / self-host dropdown plus Server URL and Web URL. Saved to SharedPreferences `kCloudType`, `kAppFlowyCloudBaseURL`, `kAppFlowyBaseShareDomain`. The core receives them via the init JSON (`authenticator_type` 0 or 2). "Apply and restart" re-initializes the core in the same process (`runAppFlowy()`), not an OS restart (C.7, C.9a).
9. AI Settings = `OpenAIEndpointSettingsView` (always, regardless of workspace type). Settings are stored in `<appSupport>/local_ai/openai-endpoint.json` (`base_url`, `model`, `embedding_model`, `image_model`, `protected_key`, `enabled`). The API key is stored only as base64 of a Windows DPAPI blob, which Rust decrypts on each request. Save calls the existing `AIEventUpdateLocalAISetting` with `LocalAISettingPB{server_url: "openai+file:<path>", global_chat_model, embedding_model_name}`. Test runs in the renderer: `POST <base>/chat/completions`, prompt "Reply with OK.", 30 s timeout, no redirects (C.8).
10. Certificates: `.cer` / `.crt` / `.pem` files are validated and installed into the Windows CurrentUser Root store by a PowerShell script. Metadata goes to `company_certificates/<THUMBPRINT>.json`. Dart adds the stored certificates to its trust list at startup; Rust gets nothing and relies on the OS store (C.9).
11. `SelfHostedPolicy` blocks vendor hosts (`appflowy.com`, `appflowy.io`, `appflowy.cloud`) for URL launching and HTTP. Side effects: "Learn more" links and the About update check are dead.
12. Shortcuts: 79 commands (C.11). Custom bindings are saved to `<data folder>/shortcuts/shortcuts.json`.

UI primitives
13. Popovers open on mouse-down, are clamped to the window and never flipped. Only the first popover adds a click-outside layer, and an outside click closes stacked popovers down to the first one marked `asBarrier`. `AppFlowyPopover` has no animation by default (D.3).
14. The `AFAvatar` name-to-color hash relies on Dart's 64-bit integer arithmetic; use `BigInt` in JS, or names longer than about 10 characters get different colors (D.4.9).

## 0.2 Consolidated decisions / ambiguities (details in the referenced sections)

| # | Item | Where |
|---|---|---|
| 1 | Display text styles pass 42/34/28 as a `height` *multiplier* (upstream bug); unused on desktop | A.5.3, D |
| 2 | Lavender reuses `#D8D6FC` (light) for its dark toolbar hover, light divider and light hover | A.3.4 |
| 3 | Backend text direction "fallback" maps to LTR in the app (not to the layout direction, as the backend comment says) | A.6 |
| 4 | Stored default locale `en` + empty country resolves to en-US only through the unsupported-locale fallback | A.6, B.4.5 |
| 5 | Flutter shadow blur is not the same as CSS blur: A.7.7 uses 19.5 px / 38 px to match the rendered pixels of design values 16 / 32 | A.7.3, A.7.7 |
| 6 | Poppins pubspec swaps Thin/ExtraLight and Black/ExtraBold weights. Use standard weights in CSS | B.1.1 |
| 7 | AI Save may report "Could not apply AI endpoint settings: …" even though the file and Rust setting were written (model-not-in-list check). Not verified at runtime | C.8.5 |
| 8 | Whether the Rust cloud client uses rustls with its own roots (which would ignore the Windows store) is unverified | C.9.4 |
| 9 | Manage data "Change path" never takes effect: the code compares a path to itself and returns early | C.13 |
| 10 | "Show notifications icon" is saved only if the other notifications toggle changes afterwards; nothing reads "Enable notifications" | C.12 |
| 11 | Theme upload with a missing light or dark JSON throws an uncaught error, and the dialog stays on "processing" | C.17 |
| 12 | Settings menu uses the profile/role snapshot from when the dialog opened (no live refresh) | C.1–C.6 ambiguities |
| 13 | `combineHexWithOpacity` does not zero-pad alpha below 7% (wrong color) | C.4, C.6 |
| 14 | `FlowyButton` never applies its disabled opacity; outlined destructive buttons render red text on red fill in some states; `AFTextField` hover color has no effect | D |
| 15 | Every custom settings page draws a divider between every child, including spacers | C.7–C.9 |

---

## A. Theme system

Source root: `D:\Projects\appflowy\frontend` (paths below are relative to it; `appflowy_flutter/` abbreviated `AF/`).
Flutter SDK pinned by CI: 3.27.4 (`.github/workflows/flutter_ci.yaml`, `FLUTTER_VERSION`). Framework defaults below were read from the local 3.27.4 SDK (`D:\Tools\flutter`).

Color notation (normalized for this document): CSS hex `#RRGGBB` (opaque) or `#RRGGBBAA` (alpha LAST). Flutter source `Color(0xAARRGGBB)` was converted (e.g. `0x0F1F2329` → `#1F23290F`). Translucent values also get an `rgba()` form.

**Local customization check (git diff vs HEAD 8fcee27d9):** none of the theme files were changed: `AF/packages/flowy_infra/**`, `AF/packages/flowy_infra_ui/**`, `AF/packages/appflowy_ui/**`, `AF/lib/workspace/application/settings/appearance/**`, `AF/lib/workspace/application/appearance_defaults.dart`, `AF/lib/startup/tasks/app_widget.dart`, `AF/lib/core/config/kv_keys.dart`, `AF/lib/workspace/presentation/settings/pages/settings_workspace_view.dart`, `rust-lib/flowy-user/src/entities/user_setting.rs`. Related changes made in this checkout:
- `AF/lib/main.dart`: adds `SelfHostedPolicy.installNetworkPolicy()` and `CompanyCertificateStore().restoreTrust()`. The `ScaledWidgetsFlutterBinding.ensureInitialized(scaleFactor: (_) => 1.0)` call is unchanged.
- `AF/lib/core/helpers/url_launcher.dart`: `afLaunchUri` now refuses vendor hosts (`appflowy.com|appflowy.io|appflowy.cloud`). Side effect: the theme-upload "Learn more" button (`https://docs.appflowy.io/docs/appflowy/product/themes`) always takes its `onFailure` path and shows the error dialog "Failed to open url: {url}".
- `AF/pubspec.yaml`: adds assets (`assets/local_templates/**`) only. The fonts block is unchanged: `Poppins` (weights 100–900) and `RobotoMono` (regular + italic) are bundled, and the `WHITE_LABEL_FONT` placeholder is empty.
- `AF/lib/workspace/presentation/settings/settings_dialog.dart` / `settings_menu.dart`: add a `companyCertificates` page. The Workspace/Appearance page is unaffected.
- `google_fonts` runtime fetching from `fonts.gstatic.com` is still allowed: `SelfHostedPolicy` blocks only the vendor hosts.

---

### A.1 Layering overview

| Layer | Class / file | Built from | Drives | Varies with selected built-in/custom theme? |
|---|---|---|---|---|
| 1. FlowyColorScheme (palette) | `FlowyColorScheme` — `AF/packages/flowy_infra/lib/colorscheme/colorscheme.dart` | `themeMap` built-ins, or plugin JSON (`FlowyColorScheme.fromJsonSoft`) | Input for layers 2 and 3 only. No widget reads it directly; the one exception is the theme dropdown swatch, which reads `sidebarBg` | yes (55 color fields × light/dark) |
| 1a. AppTheme | `AppTheme{builtIn, themeName, lightTheme, darkTheme}` — `AF/packages/flowy_infra/lib/theme.dart` | `AppTheme.fromName(name)` / `AppTheme.fallback` | Pair of FlowyColorSchemes held in `AppearanceSettingsState.appTheme` | — |
| 2. Material `ThemeData` | `DesktopAppearance.getThemeData()` — `AF/lib/workspace/application/settings/appearance/desktop_appearance.dart` (extends `BaseAppearance`, `base_appearance.dart`) | FlowyColorScheme + brightness + workspace font + code font `RobotoMono` | `Theme.of(context)`: `colorScheme.*`, `textTheme.*`, `hintColor`, `dividerColor`, `hoverColor`, `cardColor`, scrollbar, tooltip, selection, icon color, and so on. Most legacy widgets (`FlowyText`, `FlowyHover`, `FlowyButton`, popovers) use this | yes |
| 2a. AFThemeExtension | `AFThemeExtension` — `AF/packages/flowy_infra/lib/theme_extension.dart`, registered in `ThemeData.extensions` | FlowyColorScheme (same builder) | `AFThemeExtension.of(context).*`: text colors, tints, grey hovers, callout/code/caption styles, border/scrollbar colors | yes |
| 3. appflowy_ui `AppFlowyTheme` | `AnimatedAppFlowyTheme(data: AppFlowyDefaultTheme().light/dark(fontFamily:))` — `AF/packages/appflowy_ui/lib/src/theme/**`, injected in `AF/lib/startup/tasks/app_widget.dart` `MaterialApp.router(builder:)` | **Always `AppFlowyDefaultTheme`**. Only brightness (taken from `Theme.of(context).brightness`) and the workspace font change it | `AppFlowyTheme.of(context)` tokens (`textColorScheme`, `surfaceColorScheme`, `spacing`, `borderRadius`, `shadow`, `textStyle`) used by newer `AF*` widgets | **no**. Dandelion/Lemonade/Lavender/custom plugins do NOT affect appflowy_ui tokens. Another agent documents the token values |
| Mobile only | `MobileAppearance` — `mobile_appearance.dart` | hard-coded mobile palette (e.g. `_primaryColor = #00BCF0`) + FlowyColorScheme | Used only when `UniversalPlatform.isMobile` (`AF/lib/startup/deps_resolver.dart`: `registerFactory<BaseAppearance>(() => isMobile ? MobileAppearance() : DesktopAppearance())`). Not relevant to desktop parity | — |

Brightness selection: `MaterialApp.router(theme: state.lightTheme, darkTheme: state.darkTheme, themeMode: state.themeMode)`. With `ThemeMode.system`, the OS `platformBrightness` decides. Theme changes animate: MaterialApp default `themeAnimationDuration = kThemeAnimationDuration = 200 ms`, `Curves.linear`. `AnimatedAppFlowyTheme` uses the same 200 ms linear lerp. `AFThemeExtension.lerp` lerps all colors and swaps `code/callout/caption` without interpolating them.

Suggested CSS layering for Electron:
- `[data-theme="<name>"][data-mode="light|dark"]` sets the `--afl-*` palette.
- Derived `--afm-*` (Material) and `--afx-*` (extension) vars use `var(--afl-…)`.
- appflowy_ui `--af-*` tokens depend only on mode.

---

### A.2 FlowyColorScheme fields

The class is `FlowyColorScheme` (`@JsonSerializable(converters: [ColorConverter()])`). All 55 fields are `required Color`. Each JSON key is the exact field name (no renames).

JSON value format:
- `ColorConverter.toJson` emits a lowercase `"0xaarrggbb"` string.
- `fromJson` runs `int.tryParse(str)`, which accepts a `0x`-prefixed hex string or a decimal string. An unparsable string becomes `Colors.transparent` (`#00000000`).
- A non-string value throws a cast error, which surfaces as the plugin error "The light/dark theme json file is not valid."

The "Desktop consumers" column below lists where `DesktopAppearance` routes each field: CS = Material `ColorScheme`, TD = `ThemeData` property, AFX = `AFThemeExtension`.

| # | Field | Meaning / source comment | Desktop consumers | Suggested CSS var |
|---|---|---|---|---|
| 1 | `surface` | Main page/content background | CS.surface; TD.scaffoldBackgroundColor, TD.canvasColor ("dropdown menu color"), TD.dialogBackgroundColor; AFX.background, AFX.tableCellBGColor; tooltipTheme text color | `--afl-surface` |
| 2 | `hover` | Legacy hover tint. **Unused on desktop** (not referenced by DesktopAppearance) | — | `--afl-hover` |
| 3 | `selector` | "hover effect on setting value" | CS.secondaryContainer | `--afl-selector` |
| 4 | `red` | Error / destructive | CS.error | `--afl-red` |
| 5 | `yellow` | Warning | AFX.warning | `--afl-yellow` |
| 6 | `green` | Success | AFX.success | `--afl-green` |
| 7 | `shader1` | Darkest neutral (light) / near-black (dark) | CS.onSecondary | `--afl-shader-1` |
| 8 | `shader2` | Neutral. **Unused on desktop** | — | `--afl-shader-2` |
| 9 | `shader3` | Mid grey | AFX.code color, AFX.callout color | `--afl-shader-3` |
| 10 | `shader4` | "disable text color" | CS.outline; TD.disabledColor | `--afl-shader-4` |
| 11 | `shader5` | Light grey | AFX.toggleOffFill | `--afl-shader-5` |
| 12 | `shader6` | Lightest grey. **Unused on desktop** | — | `--afl-shader-6` |
| 13 | `shader7` | Strong neutral | CS.tertiary | `--afl-shader-7` |
| 14 | `bg1` | Accent background (sidebar accent in old design). **Unused on desktop** | — | `--afl-bg-1` |
| 15 | `bg2` | **Unused on desktop** | — | `--afl-bg-2` |
| 16 | `bg3` | "Hover color on trash button"; selection grey | AFX.greySelect | `--afl-bg-3` |
| 17 | `bg4` | **Unused on desktop** | — | `--afl-bg-4` |
| 18 | `tint1` | Tint palette 1 (purple). Used for text/background colors in docs/DB via `FlowyTint` | AFX.tint1 | `--afl-tint-1` |
| 19 | `tint2` | Tint 2 (pink) | AFX.tint2 | `--afl-tint-2` |
| 20 | `tint3` | Tint 3 (red/rose) | AFX.tint3 | `--afl-tint-3` |
| 21 | `tint4` | Tint 4 (orange) | AFX.tint4 | `--afl-tint-4` |
| 22 | `tint5` | Tint 5 (yellow) | AFX.tint5 | `--afl-tint-5` |
| 23 | `tint6` | Tint 6 (lime) | AFX.tint6 | `--afl-tint-6` |
| 24 | `tint7` | Tint 7 (green) | AFX.tint7 | `--afl-tint-7` |
| 25 | `tint8` | Tint 8 (aqua) | AFX.tint8 | `--afl-tint-8` |
| 26 | `tint9` | Tint 9 (blue) | AFX.tint9 | `--afl-tint-9` |
| 27 | `main1` | Brand accent | TD.highlightColor, TD.indicatorColor | `--afl-main-1` |
| 28 | `main2` | Brand accent 2 / "cursor color" | CS.primaryContainer; textSelectionTheme.cursorColor + selectionHandleColor | `--afl-main-2` |
| 29 | `shadow` | Shadow color | CS.shadow | `--afl-shadow` |
| 30 | `sidebarBg` | Sidebar background; also the swatch in the theme dropdown | CS.surfaceContainerHighest | `--afl-sidebar-bg` |
| 31 | `divider` | Divider lines | TD.dividerColor | `--afl-divider` |
| 32 | `topbarBg` | Top bar background | CS.onSecondaryContainer | `--afl-topbar-bg` |
| 33 | `icon` | Default icon color | TD.iconTheme.color | `--afl-icon` |
| 34 | `text` | Default text color | textTheme (all defined styles) color; AFX.textColor, AFX.onBackground | `--afl-text` |
| 35 | `secondaryText` | Secondary text | AFX.secondaryTextColor | `--afl-secondary-text` |
| 36 | `strongText` | Emphasised text | AFX.strongText | `--afl-strong-text` |
| 37 | `input` | Input/card/popover fill | TD.cardColor (popover default background) | `--afl-input` |
| 38 | `hint` | Hint/placeholder text | TD.hintColor; AFX.caption color | `--afl-hint` |
| 39 | `primary` | Primary brand | CS.primary (snackbar bg, default doc cursor, selection color base) | `--afl-primary` |
| 40 | `onPrimary` | Content on primary | CS.onPrimary, CS.onError | `--afl-on-primary` |
| 41 | `hoverBG1` | "page title hover effect" / "hover color in sidebar" | CS.secondary; AFX.greyHover | `--afl-hover-bg-1` |
| 42 | `hoverBG2` | "action item hover effect" / "tool bar hover color" | TD.hoverColor | `--afl-hover-bg-2` |
| 43 | `hoverBG3` | Grey hover | CS.inverseSurface ("grey hover color"); AFX.lightGreyHover, AFX.calloutBGColor | `--afl-hover-bg-3` |
| 44 | `hoverFG` | "the text color when it is hovered" | CS.onSurface ("text&icon color when it is hovered"); snackbar text | `--afl-hover-fg` |
| 45 | `questionBubbleBG` | AI chat question bubble | CS.tertiaryContainer | `--afl-question-bubble-bg` |
| 46 | `progressBarBGColor` | Progress bar track | AFX.progressBarBGColor | `--afl-progress-bar-bg` |
| 47 | `toolbarColor` | "editor toolbar BG color" | CS.onTertiary | `--afl-toolbar` |
| 48 | `toggleButtonBGColor` | Toggle button background | AFX.toggleButtonBGColor | `--afl-toggle-button-bg` |
| 49 | `calendarWeekendBGColor` | Calendar weekend cell bg | AFX.calendarWeekendBGColor | `--afl-calendar-weekend-bg` |
| 50 | `gridRowCountColor` | "grid bottom count color" | AFX.gridRowCountColor | `--afl-grid-row-count` |
| 51 | `borderColor` | Borders (divider, outline border) | AFX.borderColor | `--afl-border` |
| 52 | `scrollbarColor` | Scrollbar thumb at rest | scrollbarTheme.thumbColor (default state); AFX.scrollbarColor | `--afl-scrollbar` |
| 53 | `scrollbarHoverColor` | Scrollbar thumb when hovered/pressed/dragged | scrollbarTheme.thumbColor (interactive); AFX.scrollbarHoverColor | `--afl-scrollbar-hover` |
| 54 | `lightIconColor` | Light/secondary icon color | AFX.lightIconColor | `--afl-light-icon` |
| 55 | `toolbarHoverColor` | Toolbar item hover | AFX.toolbarHoverColor | `--afl-toolbar-hover` |

Helpers:
- `FlowyColorScheme.fromJsonSoft(json, [brightness = light])` starts from `DefaultColorScheme.light()` or `.dark().toJson()` and overlays the plugin JSON. Missing keys therefore inherit Default values.
- `FlowyColorScheme.getMissingKeys(json)` lists the keys absent compared with the Default light scheme.

Theme-independent constants that some widgets use directly, ignoring the selected scheme:
- `ColorSchemeConstants.lightBorderColor #EDEDEE` / `darkBorderColor #3A3F49`, used by the popover border in `AF/packages/flowy_infra_ui/lib/src/flowy_overlay/appflowy_popover.dart` and by the AI writer "more" button.

#### Theme registry / loading (`AF/packages/flowy_infra/lib/theme.dart`, `colorscheme.dart`)

| Item | Value |
|---|---|
| `BuiltInTheme` names | `defaultTheme = 'Default'`, `dandelion = 'Dandelion'`, `lemonade = 'Lemonade'`, `lavender = 'Lavender'` |
| `themeMap` order (= dropdown order) | Default → Dandelion → Lemonade → Lavender. Each entry is `[light, dark]` |
| Display name | Same as `themeName`, shown untranslated in the settings dropdown |
| `AppTheme.builtins` | `themeMap` mapped to `AppTheme(builtIn: true, …)` |
| `AppTheme.themes(service)` | `[...builtins, ...plugin themes]` |
| `AppTheme.fromName(name)` | Linear search through `themes()` (rescans the plugin dir on every call). If no match: `ArgumentError('The theme $name does not exist.')` |
| `AppTheme.fallback` | `AppTheme(builtIn: true, themeName: 'Default', lightTheme: DefaultColorScheme.light(), darkTheme: DefaultColorScheme.dark())` |
| Startup resolution | `appTheme(themeName)` in `app_widget.dart`: empty name or a throw → `AppTheme.fallback` |
| Runtime `setTheme(name)` | Saves the name to the backend first, then `fromName`. On failure it logs and, **on macOS only**, shows the toast `settings.workspacePage.theme.failedToLoadThemes` while keeping the previous state theme |
| Custom theme plugin location | `FlowyPluginService.instance` → `PluginLocationService(fallback: getApplicationDocumentsDirectory())`, i.e. the user's Documents folder (Windows: `%USERPROFILE%\Documents`). `setLocation()` is never called in the app |
| Plugin detection | Direct children of that dir that are `Directory` and whose `p.extension(path)` **contains** `flowy_plugin` |
| Plugin type (`PluginType.from`) | `theme` if the dir contains a file ending `light.json` AND a file ending `dark.json`. Otherwise `PluginCompilationException('Could not determine the plugin type from source `$src`.')` |
| Theme name | `basenameWithoutExtension(dir).split('.').first` |
| Light/dark file pick | The first file whose basename contains `light.json` / `dark.json` |
| Parse | `FlowyColorScheme.fromJsonSoft(json)` (light) / `fromJsonSoft(json, Brightness.dark)` (dark). `builtIn: false` |
| Error messages | `'The plugin directory must have the extension `.flowy_plugin`.'`; `'The theme plugin does not adhere to the following format: `<plugin_name>.flowy_plugin`.'`; `'The light theme json file is not valid.'`; `'The dark theme json file is not valid.'` |
| Upload (`DynamicPluginBloc.addPlugin`) | 1. `FilePicker().getDirectoryPath()` → `decode()` (validate). 2. `addPlugin`: `encode()` re-serializes in memory as `<name>.flowy_plugin/{<name>.light.json,<name>.dark.json}` (full 55-key `toJson`). 3. That is copied to `Documents/<name>.flowy_plugin` |
| Delete (`removePlugin(name)`) | `lookup(name)` → `Directory.delete(recursive: true)`. If the deleted theme is the current one, the UI calls `setTheme(AppTheme.builtins.first.themeName)` (= `'Default'`) |
| Bloc states | `uninitialized`, `ready(plugins)`, `processing`, `compilationFailure(errorMessage)`, `deletionFailure(path)`, `deletionSuccess`, `compilationSuccess` |

---

### A.3 Built-in color schemes (hex)

Built-in schemes: **Default, Dandelion, Lemonade, Lavender**. Each has a light and a dark variant: `DefaultColorScheme` (`default_colorscheme.dart`), `DandelionColorScheme` (`dandelion.dart`), `LemonadeColorScheme` (`lemonade.dart`), `LavenderColorScheme` (`lavender.dart`).

Constants resolved: `Colors.white = #FFFFFF`, `Colors.black = #000000`. `Color.fromRGBO(0,0,0,0.15)` stores alpha 0.15, which is ARGB32 `0x26000000` = CSS `#00000026` (round(38.25) = 38 = 0x26); in CSS use `rgba(0,0,0,0.15)`.

Translucent values used below:

| CSS hex | rgba |
|---|---|
| `#1F23290F` | rgba(31,35,41,0.059) |
| `#1717173F` | rgba(23,23,23,0.247) |
| `#1717177F` | rgba(23,23,23,0.498) |
| `#FFFFFF40` | rgba(255,255,255,0.251) |
| `#FFFFFF80` | rgba(255,255,255,0.502) |
| `#FFFFFF1A` | rgba(255,255,255,0.102) |
| `#FFFFFFE5` | rgba(255,255,255,0.898) |
| `#……4D` | alpha 0.302 |
| `#……66` | alpha 0.4 |
| `#……80` | alpha 0.502 |
| `#……33` | alpha 0.2 |
| `#……59` | alpha 0.349 |

#### A.3.1 Default (`DefaultColorScheme`)

`ColorSchemeConstants` values:

| Constant | Value |
|---|---|
| white | #FFFFFF |
| lightHover | #E0F8FF |
| lightSelector | #F2FCFF |
| lightBg1 | #F7F8FC |
| lightBg2 | #1F23290F |
| lightShader1 | #333333 |
| lightShader3 | #828282 |
| lightShader5 | #E0E0E0 |
| lightShader6 | #F2F2F2 |
| lightMain1 | #00BCF0 |
| lightTint9 | #E1FBFF |
| darkShader1 | #131720 |
| darkShader2 | #1A202C |
| darkShader3 | #363D49 |
| darkShader5 | #BBC3CD |
| darkShader6 | #F2F2F2 |
| darkMain1 | #00BCF0 |
| darkMain2 | #00BCF0 |
| darkInput | #282E3A |
| lightBorderColor | #EDEDEE |
| darkBorderColor | #3A3F49 |

| Field | Light | Dark |
|---|---|---|
| surface | #FFFFFF | #1A202C |
| hover | #E0F8FF | #00BCF0 |
| selector | #F2FCFF | #1A202C |
| red | #FB006D | #FB006D |
| yellow | #FFD667 | #F7CF46 |
| green | #66CF80 | #66CF80 |
| shader1 | #333333 | #131720 |
| shader2 | #4F4F4F | #1A202C |
| shader3 | #828282 | #363D49 |
| shader4 | #BDBDBD | #505469 |
| shader5 | #E0E0E0 | #BBC3CD |
| shader6 | #F2F2F2 | #F2F2F2 |
| shader7 | #333333 | #FFFFFF |
| bg1 | #F7F8FC | #1A202C |
| bg2 | #1F23290F (rgba(31,35,41,0.059)) | #EDEEF2 |
| bg3 | #E2E4EB | #00BCF0 |
| bg4 | #2C144B | #2C144B |
| tint1 | #E8E0FF | #502FD64D (rgba(80,47,214,0.302)) |
| tint2 | #FFE7FD | #BF1CC04D (rgba(191,28,192,0.302)) |
| tint3 | #FFE7EE | #C42A534D (rgba(196,42,83,0.302)) |
| tint4 | #FFEFE3 | #D779224D (rgba(215,121,34,0.302)) |
| tint5 | #FFF2CD | #C59A1A4D (rgba(197,154,26,0.302)) |
| tint6 | #F5FFDC | #A4C8244D (rgba(164,200,36,0.302)) |
| tint7 | #DDFFD6 | #23CA2E4D (rgba(35,202,46,0.302)) |
| tint8 | #DEFFF1 | #19CCAC4D (rgba(25,204,172,0.302)) |
| tint9 | #E1FBFF | #04A9D74D (rgba(4,169,215,0.302)) |
| main1 | #00BCF0 | #00BCF0 |
| main2 | #00B7EA | #00B7EA |
| shadow | #00000026 (rgba(0,0,0,0.15)) | #0F131C |
| sidebarBg | #F7F8FC | #232B38 |
| divider | #F2F2F2 | #363D49 |
| topbarBg | #FFFFFF | #131720 |
| icon | #333333 | #BBC3CD |
| text | #333333 | #BBC3CD |
| secondaryText | #4F4F4F | #BBC3CD |
| strongText | #000000 | #FFFFFF |
| input | #FFFFFF | #282E3A |
| hint | #828282 | #59647A |
| primary | #00BCF0 | #00BCF0 |
| onPrimary | #FFFFFF | #131720 |
| hoverBG1 | #1F23290F (rgba(31,35,41,0.059)) | #FFFFFF1A (rgba(255,255,255,0.102)) |
| hoverBG2 | #E0F8FF | #00BCF0 |
| hoverBG3 | #F2F2F2 | #363D49 |
| hoverFG | #333333 | #FFFFFFE5 (rgba(255,255,255,0.898)) |
| questionBubbleBG | #F2FCFF | #363D49 |
| progressBarBGColor | #E1FBFF | #363D49 |
| toolbarColor | #333333 | #282E3A |
| toggleButtonBGColor | #E0E0E0 | #828282 |
| calendarWeekendBGColor | #FBFBFC | #131720 |
| gridRowCountColor | #333333 | #BBC3CD |
| borderColor | #EDEDEE | #3A3F49 |
| scrollbarColor | #1717173F (rgba(23,23,23,0.247)) | #FFFFFF40 (rgba(255,255,255,0.251)) |
| scrollbarHoverColor | #1717177F (rgba(23,23,23,0.498)) | #FFFFFF80 (rgba(255,255,255,0.502)) |
| lightIconColor | #8F959E | #8F959E |
| toolbarHoverColor | #F2F4F7 | #F2F2F2 |

#### A.3.2 Dandelion (`DandelionColorScheme`)

File constants:

| Constant | Value |
|---|---|
| _black | #000000 |
| _white | #FFFFFF |
| _lightBg1 | #FFD13E |
| _lightShader1 | #333333 |
| _lightShader3 | #828282 |
| _lightShader5 | #E0E0E0 |
| _lightShader6 | #F2F2F2 |
| _lightDandelionYellow | #FFCB00 |
| _lightDandelionLightYellow | #FFDF66 |
| _lightDandelionGreen | #9BC53D |
| _lightTint9 | #E1FBFF |
| _darkShader1 | #131720 |
| _darkShader2 | #1A202C |
| _darkShader3 | #363D49 |
| _darkShader5 | #BBC3CD |
| _darkShader6 | #F2F2F2 |
| _darkMain1 | #FFCB00 |
| _darkInput | #282E3A |

| Field | Light | Dark |
|---|---|---|
| surface | #FFFFFF | #292929 |
| hover | #E0F8FF | #1F1F1F |
| selector | #FFDF66 | #1A202C |
| red | #FB006D | #FB006D |
| yellow | #FFD667 | #FFD667 |
| green | #66CF80 | #66CF80 |
| shader1 | #333333 | #FFFFFF |
| shader2 | #4F4F4F | #1A202C |
| shader3 | #828282 | #828282 |
| shader4 | #BDBDBD | #BDBDBD |
| shader5 | #E0E0E0 | #BBC3CD |
| shader6 | #F2F2F2 | #F2F2F2 |
| shader7 | #000000 | #FFFFFF |
| bg1 | #FFD13E | #D5A200 |
| bg2 | #EDEEF2 | #000000 |
| bg3 | #FFCB00 | #FFCB00 |
| bg4 | #2C144B | #2C144B |
| tint1 | #E8E0FF | #9327FF4D (rgba(147,39,255,0.302)) |
| tint2 | #FFE7FD | #FC008866 (rgba(252,0,136,0.4)) |
| tint3 | #FFE7EE | #FC00E24D (rgba(252,0,226,0.302)) |
| tint4 | #FFEFE3 | #BE5B0080 (rgba(190,91,0,0.502)) |
| tint5 | #FFF2CD | #F8EE0033 (rgba(248,238,0,0.2)) |
| tint6 | #F5FFDC | #6DC3004D (rgba(109,195,0,0.302)) |
| tint7 | #DDFFD6 | #00BD2A59 (rgba(0,189,42,0.349)) |
| tint8 | #DEFFF1 | #00889080 (rgba(0,136,144,0.502)) |
| tint9 | #E1FBFF | #0029FF4D (rgba(0,41,255,0.302)) |
| main1 | #FFCB00 | #FFCB00 |
| main2 | #FFCB00 | #FFCB00 |
| shadow | #00000026 (rgba(0,0,0,0.15)) | #0F131C |
| sidebarBg | #9BC53D | #25300E |
| divider | #F2F2F2 | #363D49 |
| topbarBg | #FFFFFF | #131720 |
| icon | #333333 | #BBC3CD |
| text | #333333 | #BBC3CD |
| secondaryText | #333333 | #BBC3CD |
| strongText | #000000 | #FFFFFF |
| input | #FFFFFF | #282E3A |
| hint | #828282 | #BBC3CD |
| primary | #FFCB00 | #FFCB00 |
| onPrimary | #333333 | #131720 |
| hoverBG1 | #FFCB00 | #FFCB00 |
| hoverBG2 | #FFDF66 | #FFCB00 |
| hoverBG3 | #F2F2F2 | #363D49 |
| hoverFG | #333333 | #131720 |
| questionBubbleBG | #FFDF66 | #363D49 |
| progressBarBGColor | #E1FBFF | #363D49 |
| toolbarColor | #333333 | #282E3A |
| toggleButtonBGColor | #FFCB00 | #131720 |
| calendarWeekendBGColor | #FBFBFC | #121212 |
| gridRowCountColor | #000000 | #FFCB00 |
| borderColor | #EDEDEE | #3A3F49 |
| scrollbarColor | #1717173F | #FFFFFF40 |
| scrollbarHoverColor | #1717177F | #FFFFFF80 |
| lightIconColor | #8F959E | #8F959E |
| toolbarHoverColor | #F2F4F7 | #F2F2F2 |

#### A.3.3 Lemonade (`LemonadeColorScheme`)

The source comment says it is "Derived from Dandelion" and uses a light yellow sidebar. Its file constants are the same as Dandelion's, without `_lightDandelionGreen`. It differs from Dandelion in only three fields:
- light `sidebarBg` = #FAF0C8
- dark `shadow` = #000000
- dark `sidebarBg` = #232B38

| Field | Light | Dark |
|---|---|---|
| surface | #FFFFFF | #292929 |
| hover | #E0F8FF | #1F1F1F |
| selector | #FFDF66 | #1A202C |
| red | #FB006D | #FB006D |
| yellow | #FFD667 | #FFD667 |
| green | #66CF80 | #66CF80 |
| shader1 | #333333 | #FFFFFF |
| shader2 | #4F4F4F | #1A202C |
| shader3 | #828282 | #828282 |
| shader4 | #BDBDBD | #BDBDBD |
| shader5 | #E0E0E0 | #BBC3CD |
| shader6 | #F2F2F2 | #F2F2F2 |
| shader7 | #000000 | #FFFFFF |
| bg1 | #FFD13E | #D5A200 |
| bg2 | #EDEEF2 | #000000 |
| bg3 | #FFCB00 | #FFCB00 |
| bg4 | #2C144B | #2C144B |
| tint1 | #E8E0FF | #9327FF4D (rgba(147,39,255,0.302)) |
| tint2 | #FFE7FD | #FC008866 (rgba(252,0,136,0.4)) |
| tint3 | #FFE7EE | #FC00E24D (rgba(252,0,226,0.302)) |
| tint4 | #FFEFE3 | #BE5B0080 (rgba(190,91,0,0.502)) |
| tint5 | #FFF2CD | #F8EE0033 (rgba(248,238,0,0.2)) |
| tint6 | #F5FFDC | #6DC3004D (rgba(109,195,0,0.302)) |
| tint7 | #DDFFD6 | #00BD2A59 (rgba(0,189,42,0.349)) |
| tint8 | #DEFFF1 | #00889080 (rgba(0,136,144,0.502)) |
| tint9 | #E1FBFF | #0029FF4D (rgba(0,41,255,0.302)) |
| main1 | #FFCB00 | #FFCB00 |
| main2 | #FFCB00 | #FFCB00 |
| shadow | #00000026 (rgba(0,0,0,0.15)) | #000000 |
| sidebarBg | #FAF0C8 | #232B38 |
| divider | #F2F2F2 | #363D49 |
| topbarBg | #FFFFFF | #131720 |
| icon | #333333 | #BBC3CD |
| text | #333333 | #BBC3CD |
| secondaryText | #333333 | #BBC3CD |
| strongText | #000000 | #FFFFFF |
| input | #FFFFFF | #282E3A |
| hint | #828282 | #BBC3CD |
| primary | #FFCB00 | #FFCB00 |
| onPrimary | #333333 | #131720 |
| hoverBG1 | #FFCB00 | #FFCB00 |
| hoverBG2 | #FFDF66 | #FFCB00 |
| hoverBG3 | #F2F2F2 | #363D49 |
| hoverFG | #333333 | #131720 |
| questionBubbleBG | #FFDF66 | #363D49 |
| progressBarBGColor | #E1FBFF | #363D49 |
| toolbarColor | #333333 | #282E3A |
| toggleButtonBGColor | #FFCB00 | #131720 |
| calendarWeekendBGColor | #FBFBFC | #121212 |
| gridRowCountColor | #000000 | #FFCB00 |
| borderColor | #EDEDEE | #3A3F49 |
| scrollbarColor | #1717173F | #FFFFFF40 |
| scrollbarHoverColor | #1717177F | #FFFFFF80 |
| lightIconColor | #8F959E | #8F959E |
| toolbarHoverColor | #F2F4F7 | #F2F2F2 |

#### A.3.4 Lavender (`LavenderColorScheme`)

File constants:

| Constant | Value |
|---|---|
| _black | #000000 |
| _white | #FFFFFF |
| _lightHover | #D8D6FC |
| _lightSelector | #E5E3F9 |
| _lightBg1 | #F2F0F6 |
| _lightBg2 | #D8D6FC |
| _lightShader1 | #333333 |
| _lightShader3 | #828282 |
| _lightShader5 | #E0E0E0 |
| **_lightShader6** | **#D8D6FC** (differs from the other files) |
| _lightMain1 | #ABA9E7 |
| _lightTint9 | #E1FBFF |
| _darkShader1 | #131720 |
| _darkShader2 | #1A202C |
| _darkShader3 | #363D49 |
| _darkShader5 | #BBC3CD |
| _darkShader6 | #F2F2F2 |
| _darkMain1 | #AB00FF |
| _darkInput | #282E3A |

| Field | Light | Dark |
|---|---|---|
| surface | #FFFFFF | #1B1A1D |
| hover | #D8D6FC | #AB00FF |
| selector | #E5E3F9 | #1A202C |
| red | #FB006D | #FB006D |
| yellow | #FFD667 | #FFD667 |
| green | #66CF80 | #66CF80 |
| shader1 | #333333 | #FFFFFF |
| shader2 | #4F4F4F | #1A202C |
| shader3 | #828282 | #828282 |
| shader4 | #BDBDBD | #BDBDBD |
| shader5 | #E0E0E0 | #FFFFFF |
| shader6 | #F2F2F2 | #F2F2F2 |
| shader7 | #000000 | #FFFFFF |
| bg1 | #AC59FF | #8C23F6 |
| bg2 | #EDEEF2 | #000000 |
| bg3 | #D8D6FC | #AB00FF |
| bg4 | #2C144B | #2C144B |
| tint1 | #E8E0FF | #9327FF4D (rgba(147,39,255,0.302)) |
| tint2 | #FFE7FD | #FC008866 (rgba(252,0,136,0.4)) |
| tint3 | #FFE7EE | #FC00E24D (rgba(252,0,226,0.302)) |
| tint4 | #FFEFE3 | #BE5B0080 (rgba(190,91,0,0.502)) |
| tint5 | #FFF2CD | #F8EE0033 (rgba(248,238,0,0.2)) |
| tint6 | #F5FFDC | #6DC3004D (rgba(109,195,0,0.302)) |
| tint7 | #DDFFD6 | #00BD2A59 (rgba(0,189,42,0.349)) |
| tint8 | #DEFFF1 | #00889080 (rgba(0,136,144,0.502)) |
| tint9 | #ABA9E7 | #0029FF4D (rgba(0,41,255,0.302)) |
| main1 | #ABA9E7 | #AB00FF |
| main2 | #ABA9E7 | #AB00FF |
| shadow | #00000026 (rgba(0,0,0,0.15)) | #0F131C |
| sidebarBg | #F2F0F6 | #2D223B |
| divider | #D8D6FC | #363D49 |
| topbarBg | #FFFFFF | #131720 |
| icon | #333333 | #BBC3CD |
| text | #333333 | #BBC3CD |
| secondaryText | #333333 | #BBC3CD |
| strongText | #000000 | #FFFFFF |
| input | #FFFFFF | #282E3A |
| hint | #828282 | #BBC3CD |
| primary | #ABA9E7 | #AB00FF |
| onPrimary | #333333 | #131720 |
| hoverBG1 | #D8D6FC | #AB00FF |
| hoverBG2 | #D8D6FC | #AB00FF |
| hoverBG3 | #D8D6FC | #363D49 |
| hoverFG | #333333 | #131720 |
| questionBubbleBG | #E5E3F9 | #363D49 |
| progressBarBGColor | #E1FBFF | #363D49 |
| toolbarColor | #333333 | #282E3A |
| toggleButtonBGColor | #E5E3F9 | #131720 |
| calendarWeekendBGColor | #FBFBFC | #121212 |
| gridRowCountColor | #000000 | #AB00FF |
| borderColor | #EDEDEE | #3A3F49 |
| scrollbarColor | #1717173F | #FFFFFF40 |
| scrollbarHoverColor | #1717177F | #FFFFFF80 |
| lightIconColor | #8F959E | #8F959E |
| toolbarHoverColor | #F2F4F7 | **#D8D6FC** (Lavender `_lightShader6`; the other dark schemes use #F2F2F2) |

AMBIGUOUS: Lavender dark `toolbarHoverColor` = #D8D6FC and Lavender light `divider`/`hoverBG3` = #D8D6FC come from Lavender's own `_lightShader6`, while Lavender light `shader6` is #F2F2F2. This is how the source reads (probably not intended), but parity requires copying it.

---

### A.4 AFThemeExtension

`class AFThemeExtension extends ThemeExtension<AFThemeExtension>` (`AF/packages/flowy_infra/lib/theme_extension.dart`). Accessors: `AFThemeExtension.of(context)` (non-null `!`) and `maybeOf(context)`. It is the only `ThemeExtension` registered on desktop. `ToolbarColorExtension` in `mobile_toolbar_v3/aa_menu/_toolbar_theme.dart` is mobile-only.

The values below are built in `DesktopAppearance.getThemeData` (`extensions: [AFThemeExtension(...)]`).

| Field | Type | Source (FlowyColorScheme) | Default light | Default dark | Suggested CSS var |
|---|---|---|---|---|---|
| warning | Color? | yellow | #FFD667 | #F7CF46 | `--afx-warning` |
| success | Color? | green | #66CF80 | #66CF80 | `--afx-success` |
| tint1 | Color | tint1 | #E8E0FF | #502FD64D | `--afx-tint-1` |
| tint2 | Color | tint2 | #FFE7FD | #BF1CC04D | `--afx-tint-2` |
| tint3 | Color | tint3 | #FFE7EE | #C42A534D | `--afx-tint-3` |
| tint4 | Color | tint4 | #FFEFE3 | #D779224D | `--afx-tint-4` |
| tint5 | Color | tint5 | #FFF2CD | #C59A1A4D | `--afx-tint-5` |
| tint6 | Color | tint6 | #F5FFDC | #A4C8244D | `--afx-tint-6` |
| tint7 | Color | tint7 | #DDFFD6 | #23CA2E4D | `--afx-tint-7` |
| tint8 | Color | tint8 | #DEFFF1 | #19CCAC4D | `--afx-tint-8` |
| tint9 | Color | tint9 | #E1FBFF | #04A9D74D | `--afx-tint-9` |
| textColor | Color | text | #333333 | #BBC3CD | `--afx-text` |
| secondaryTextColor | Color | secondaryText | #4F4F4F | #BBC3CD | `--afx-secondary-text` |
| strongText | Color | strongText | #000000 | #FFFFFF | `--afx-strong-text` |
| greyHover | Color | hoverBG1 | #1F23290F | #FFFFFF1A | `--afx-grey-hover` |
| greySelect | Color | bg3 | #E2E4EB | #00BCF0 | `--afx-grey-select` |
| lightGreyHover | Color | hoverBG3 | #F2F2F2 | #363D49 | `--afx-light-grey-hover` |
| toggleOffFill | Color | shader5 | #E0E0E0 | #BBC3CD | `--afx-toggle-off-fill` |
| progressBarBGColor | Color | progressBarBGColor | #E1FBFF | #363D49 | `--afx-progress-bar-bg` |
| toggleButtonBGColor | Color | toggleButtonBGColor | #E0E0E0 | #828282 | `--afx-toggle-button-bg` |
| calloutBGColor | Color | hoverBG3 | #F2F2F2 | #363D49 | `--afx-callout-bg` |
| tableCellBGColor | Color | surface | #FFFFFF | #1A202C | `--afx-table-cell-bg` |
| calendarWeekendBGColor | Color | calendarWeekendBGColor | #FBFBFC | #131720 | `--afx-calendar-weekend-bg` |
| gridRowCountColor | Color | gridRowCountColor | #333333 | #BBC3CD | `--afx-grid-row-count` |
| background | Color | surface | #FFFFFF | #1A202C | `--afx-background` |
| onBackground | Color | text | #333333 | #BBC3CD | `--afx-on-background` |
| borderColor | Color | borderColor | #EDEDEE | #3A3F49 | `--afx-border` |
| scrollbarColor | Color | scrollbarColor | #1717173F | #FFFFFF40 | `--afx-scrollbar` |
| scrollbarHoverColor | Color | scrollbarHoverColor | #1717177F | #FFFFFF80 | `--afx-scrollbar-hover` |
| toolbarHoverColor | Color | toolbarHoverColor | #F2F4F7 | #F2F2F2 | `--afx-toolbar-hover` |
| lightIconColor | Color | lightIconColor | #8F959E | #8F959E | `--afx-light-icon` |
| code | TextStyle | `getFontStyle(fontFamily: 'RobotoMono', fontColor: shader3)` | family `RobotoMono` (bundled asset), 14px, w400, letterSpacing 0.07px, height null, color #828282 | same, color #363D49 | `--afx-code-*` |
| callout | TextStyle | `getFontStyle(fontFamily: <workspace font>, fontSize: 11, fontColor: shader3)` | workspace font, 11px, w400, letterSpacing 0.055px, height null, color #828282 | same, color #363D49 | `--afx-callout-*` |
| caption | TextStyle | `getFontStyle(fontFamily: <workspace font>, fontSize: 11, fontWeight: w400, fontColor: hint)` | workspace font, 11px, w400, letterSpacing 0.055px, height null, color #828282 | same, color #59647A | `--afx-caption-*` |

Notes:
- Workspace font = `AppearanceSettingsState.font`. When it is `''`, the TextStyle has `fontFamily: null`, which resolves to the platform system font (see A.5 textTheme).
- `copyWith` and `lerp` exist. `lerp` uses `Color.lerp` for colors and takes `other.code/callout/caption` without interpolating.
- `code`/`callout`/`caption` have 0 direct `AFThemeExtension.of(context).<field>` call sites in lib/packages (grep). The hex for dark `code`/`callout` (#363D49) is very low-contrast on dark surfaces, but that is what the source produces.

`enum FlowyTint` (same file) is the persisted tint selector for document/database colors:

| Enum | Persisted id (stored in DB; "DON'T change") | Resolves to |
|---|---|---|
| tint1 | `appflowy_them_color_tint1` | AFX.tint1 |
| tint2 | `appflowy_them_color_tint2` | AFX.tint2 |
| tint3 | `appflowy_them_color_tint3` | AFX.tint3 |
| tint4 | `appflowy_them_color_tint4` | AFX.tint4 |
| tint5 | `appflowy_them_color_tint5` | AFX.tint5 |
| tint6 | `appflowy_them_color_tint6` | AFX.tint6 |
| tint7 | `appflowy_them_color_tint7` | AFX.tint7 |
| tint8 | `appflowy_them_color_tint8` | AFX.tint8 |
| tint9 | `appflowy_them_color_tint9` | AFX.tint9 |

Serialization rules:
- `toJson()` returns the enum `name` (e.g. `tint1`).
- `fromJson(name)` falls back to `tint1` on an unknown name.
- `fromId(id)` returns null on an unknown id.
- The id contains the typo "them" (not "theme") and must be kept as is.

---

### A.5 Material ThemeData (desktop)

Builder: `DesktopAppearance.getThemeData(AppTheme appTheme, Brightness brightness, String fontFamily, String codeFontFamily)`.
- Called by `AppearanceSettingsState.lightTheme` / `darkTheme` → `getIt<BaseAppearance>().getThemeData(appTheme, brightness, state.font, builtInCodeFontFamily)`.
- It asserts `codeFontFamily.isNotEmpty`, and an empty `fontFamily` becomes `defaultFontFamily` (`''`).
- `theme = isLight ? appTheme.lightTheme : appTheme.darkTheme`.

Constants (`base_appearance.dart`, `appearance_defaults.dart`):

| Constant | Value |
|---|---|
| `defaultFontFamily` | `''`, meaning "use platform default". Display label = `settings.appearance.fontFamily.defaultFont` = "System" |
| `builtInCodeFontFamily` | `'RobotoMono'` (bundled `assets/google_fonts/Roboto_Mono/RobotoMono-Regular.ttf`, `-Italic.ttf`) |
| `BaseAppearance.white` | #FFFFFF |
| `BaseAppearance.scrollbarInteractiveStates` | `{WidgetState.pressed, hovered, dragged}` |
| `DefaultAppearanceSettings.kDefaultFontFamily` | `''` |
| `DefaultAppearanceSettings.kDefaultThemeMode` | `ThemeMode.system` |
| `DefaultAppearanceSettings.kDefaultThemeName` / `kDefaultTheme` | `"Default"` / `BuiltInTheme.defaultTheme` |
| `DefaultAppearanceSettings.getDefaultCursorColor(ctx)` | `Theme.of(ctx).colorScheme.primary` (Default: #00BCF0) |
| `DefaultAppearanceSettings.getDefaultSelectionColor(ctx)` | `colorScheme.primary.withValues(alpha: 0.2)` (Default: rgba(0,188,240,0.2) ≈ #00BCF033) |
| Bundled font families (pubspec) | `Poppins` (100–900), `RobotoMono` (400 + italic). No fontFamilyFallback is defined anywhere in ThemeData |

`getFontStyle({fontFamily, fontSize, fontWeight, fontColor, letterSpacing, lineHeight})`:
- Defaults: `fontSize = FontSizes.s14 (14)`, `fontWeight = w400`.
- **letterSpacing = fontSize × (letterSpacing ?? 0.005)**, i.e. 0.5 % of the font size in px.
- `height = lineHeight` (Flutter height is a **multiplier**).
- Font resolution:
  - `fontFamily == ''`: plain `TextStyle(fontFamily: null)`.
  - Otherwise `getGoogleFontSafely(family)` (`AF/lib/shared/google_fonts_extension.dart`): `''`/`'RobotoMono'` → plain TextStyle with that family; anything else → `GoogleFonts.getFont(family, …)`, which fetches at runtime from fonts.gstatic.com unless the font is bundled.
  - On exception, a TextStyle without family (system font).
- `FontSizes` (`AF/packages/flowy_infra/lib/size.dart`, scale 1): s11 11, s12 12, s14 14, s16 16, s18 18, s20 20, s24 24, s32 32, s44 44.

#### A.5.1 ColorScheme mapping

`ColorScheme(...)`, M2 (`useMaterial3: false`).

| ColorScheme slot | FlowyColorScheme source | Default light | Default dark | Approx. refs (grep `colorScheme.<slot>`) |
|---|---|---|---|---|
| brightness | param | light | dark | — |
| primary | primary | #00BCF0 | #00BCF0 | 167 |
| onPrimary | onPrimary | #FFFFFF | #131720 | 37 |
| primaryContainer | main2 | #00B7EA | #00B7EA | 3 |
| onPrimaryContainer | `white` const | #FFFFFF | #FFFFFF | 0 |
| secondary | hoverBG1 ("page title hover color") | #1F23290F | #FFFFFF1A | 31 |
| onSecondary | shader1 | #333333 | #131720 | 2 |
| secondaryContainer | selector ("setting value hover color") | #F2FCFF | #1A202C | 15 |
| onSecondaryContainer | topbarBg | #FFFFFF | #131720 | 0 |
| tertiary | shader7 | #333333 | #FFFFFF | 22 |
| onTertiary | toolbarColor ("Editor: toolbarColor") | #333333 | #282E3A | 2 |
| tertiaryContainer | questionBubbleBG | #F2FCFF | #363D49 | 5 |
| surface | surface | #FFFFFF | #1A202C | 89 |
| onSurface | hoverFG ("text&icon color when it is hovered") | #333333 | #FFFFFFE5 | 61 |
| inverseSurface | hoverBG3 ("grey hover color") | #F2F2F2 | #363D49 | 2 |
| error | red | #FB006D | #FB006D | 82 |
| onError | onPrimary | #FFFFFF | #131720 | 0 |
| outline | shader4 | #BDBDBD | #505469 | 44 |
| surfaceContainerHighest | sidebarBg | #F7F8FC | #232B38 | 22 |
| shadow | shadow | rgba(0,0,0,0.15) | #0F131C | 3 |

Slots left unset fall back to Flutter 3.27 `ColorScheme` getters:

| Unset slot(s) | Fallback |
|---|---|
| onTertiaryContainer | onTertiary |
| errorContainer | error |
| onErrorContainer | onError |
| surfaceVariant, surfaceDim, surfaceBright, surfaceContainerLowest/Low/(plain)/High | surface |
| onSurfaceVariant | onSurface |
| background | surface |
| onBackground | onSurface |
| outlineVariant | onBackground (= onSurface = hoverFG) |
| scrim | #000000 |
| onInverseSurface | surface |
| inversePrimary | onPrimary |
| surfaceTint | primary |
| *Fixed variants | their base color |

#### A.5.2 ThemeData properties

| Property | Value / source | Default light | Default dark |
|---|---|---|---|
| useMaterial3 | `false` | | |
| brightness | param | light | dark |
| visualDensity | `VisualDensity.standard` (0,0). The Flutter desktop default would be `compact` (-2,-2), so this overrides it | | |
| materialTapTargetSize | `MaterialTapTargetSize.shrinkWrap` | | |
| scaffoldBackgroundColor | surface | #FFFFFF | #1A202C |
| canvasColor ("dropdown menu color") | surface | #FFFFFF | #1A202C |
| dialogBackgroundColor | surface | #FFFFFF | #1A202C |
| cardColor | input. Also the default **popover background** (`getPopoverDecoration`) | #FFFFFF | #282E3A |
| dividerColor | divider | #F2F2F2 | #363D49 |
| hintColor | hint | #828282 | #59647A |
| hoverColor ("action item hover color") | hoverBG2 | #E0F8FF | #00BCF0 |
| disabledColor | shader4 | #BDBDBD | #505469 |
| highlightColor | main1 | #00BCF0 | #00BCF0 |
| indicatorColor | main1 | #00BCF0 | #00BCF0 |
| splashColor | not set; Flutter M2 default | #C8C8C866 | #CCCCCC40 |
| splashFactory | not set; M2 → `InkSplash.splashFactory` | | |
| focusColor | not set; M2 default black/white @0.12 | #0000001F | #FFFFFF1F |
| primaryColor | not set. M2 without seed: `isDark ? Colors.grey[900] : Colors.blue` | #2196F3 | #212121 |
| shadowColor | not set | #000000 | #000000 |
| unselectedWidgetColor | not set (black54 / white70) | #0000008A | #FFFFFFB3 |
| secondaryHeaderColor | not set (blue[50] / grey[700]) | #E3F2FD | #616161 |
| iconTheme | `IconThemeData(color: icon)`; size falls back to 24, opacity 1 | #333333 | #BBC3CD |
| textSelectionTheme.cursorColor | main2 | #00B7EA | #00B7EA |
| textSelectionTheme.selectionHandleColor | main2 | #00B7EA | #00B7EA |
| textSelectionTheme.selectionColor | not set; TextField default `colorScheme.primary.withOpacity(0.40)` | rgba(0,188,240,0.4) = #00BCF066 | same |
| textButtonTheme | `TextButtonThemeData(style: ButtonStyle(minimumSize: WidgetStatePropertyAll(Size.zero)))` | | |
| snackBarTheme.backgroundColor | colorScheme.primary | #00BCF0 | #00BCF0 |
| snackBarTheme.contentTextStyle | `TextStyle(color: colorScheme.onSurface)` | #333333 | #FFFFFFE5 |
| tooltipTheme.textStyle | `getFontStyle(workspace font, 11px, w400, color: surface)`, letterSpacing 0.055 | #FFFFFF | #1A202C |
| tooltipTheme (other) | not set → Flutter desktop defaults: height 24, padding h8 v4, margin 0, verticalOffset 24, preferBelow true, waitDuration 0, showDuration 1500 ms, hoverExit 100 ms; decoration radius 4 | bg grey[700]@0.9 = #616161E6 | bg white@0.9 = #FFFFFFE6 |
| scrollbarTheme.thumbColor | `resolveWith(states ∩ {pressed,hovered,dragged} ≠ ∅ ? scrollbarHoverColor : scrollbarColor)` | rest #1717173F / active #1717177F | rest #FFFFFF40 / active #FFFFFF80 |
| scrollbarTheme.thickness | 4.0 for every state | | |
| scrollbarTheme.radius | `Corners.s10Radius` = 10 | | |
| scrollbarTheme.crossAxisMargin | 0.0 | | |
| scrollbarTheme.mainAxisMargin | 6.0 | | |
| scrollbar (unset) | thumbVisibility false (fades: timeToFade 600 ms, fadeDuration 300 ms), trackVisibility false, Material min thumb length 48 | | |
| colorScheme | A.5.1 | | |
| extensions | `[AFThemeExtension(...)]` (A.4) | | |
| textTheme | A.5.3 | | |
| typography | not set; M2 → `Typography.material2014(platform)` | | |

Widget-level overrides that matter for parity, documented in full by other agents:
- **FlowyTooltip** (`AF/packages/flowy_infra_ui/lib/widget/flowy_tooltip.dart`):
  - Decoration: bg light #1D2129 / dark #E5E5E5E5, radius 10, padding h12 v8, verticalOffset 16, waitDuration 300 ms.
  - textStyle = `bodyMedium.copyWith(color: light→white / dark→black, fontSize 14, w400, height 20/14, leadingDistribution even)`. It is applied only when `message != null`. For `richMessage`, the base style falls back to `tooltipTheme.textStyle` (11px, color surface).
- **Popover** (`getPopoverDecoration` in `appflowy_popover.dart`):
  - Fill `cardColor`.
  - Border 1px `strokeAlignOutside`, using the constant #EDEDEE (light) / #3A3F49 (dark), whatever the selected scheme.
  - Radius 10.
  - Shadows `ShadowConstants`: lightSmall `[0,4] blur 20 #1F23291A`, darkSmall `[0,2] blur 16 #0000007A`, lightMedium `[0,4] blur 32 #1F222512`, darkMedium `[0,4] blur 32 #0000007A`.
- **ListOverlay**: `FlowyDecoration.decoration(colorScheme.surface, colorScheme.shadow@0.15, blurRadius 20, radius 6)`.
- **FlowyScrollbar** (`style_widget/scrollbar.dart`): Material `Scrollbar` with radius 12, `thumbVisibility = hovered && thumbVisibility(default true)`, and nested `ScrollConfiguration(scrollbars: false)`.

#### A.5.3 textTheme (`BaseAppearance.getTextTheme(fontFamily: <workspace font>, fontColor: theme.text)`)

All defined styles have color = `text` (Default light #333333, dark #BBC3CD).

| Style | Code comment | fontSize | weight | height (multiplier) | letterSpacing (px) | Approx. refs |
|---|---|---|---|---|---|---|
| displayLarge | h2 | 32 | w600 | **42.0** | 0.16 | 0 |
| displayMedium | h3 | 24 | w600 | **34.0** | 0.12 | 0 |
| displaySmall | h4 | 20 | w600 | **28.0** | 0.10 | 1 (mobile only) |
| titleLarge | title | 18 | w600 | null | 0.09 | 1 |
| titleMedium | heading | 16 | w600 | null | 0.08 | 5 |
| titleSmall | subheading | 14 | w600 | null | 0.07 | 6 |
| bodyMedium | body-regular | 14 | w400 | null | 0.07 | 101 (also the base for every `FlowyText`) |
| bodySmall | body-thin | 14 (not 12) | w400 | null | 0.07 | 9 |

AMBIGUOUS: display* `lineHeight` values 42/34/28 are passed to `TextStyle.height`, which Flutter treats as a multiplier, giving 1344/816/560 px line boxes. They were clearly meant as px. These styles are unused on desktop. For CSS use `line-height: 42px/34px/28px`, or the literal multiplier if pixel-exact parity with the buggy state is wanted.

Unset styles come from `Typography.material2014` (`englishLike2014` geometry, black/white text theme). Desktop usage counts: bodyLarge 2, labelLarge 6, labelMedium 2.

| Style | Size | Weight | Extra | Light color | Dark color |
|---|---|---|---|---|---|
| bodyLarge | 14 | w500 | — | black87 #000000DD | white #FFFFFF |
| labelLarge | 14 | w500 | — | #000000DD | #FFFFFF |
| labelMedium | 12 | w400 | — | black #000000 | #FFFFFF |
| labelSmall | 10 | w400 | ls 1.5 | #000000 | #FFFFFF |
| headlineLarge | 40 | w400 | — | black54 #0000008A | white70 #FFFFFFB3 |
| headlineMedium | 34 | w400 | — | #0000008A | #FFFFFFB3 |
| headlineSmall | 24 | w400 | — | #000000DD | #FFFFFF |

All styles have `textBaseline: alphabetic`.

Default font family resolution: AppFlowy's TextStyles carry `fontFamily: null` when the workspace font is `''`, so `TextTheme.merge` keeps the M2 platform family:

| Platform | Family | Fallbacks |
|---|---|---|
| Windows (blackRedmond/whiteRedmond) | `Segoe UI` | none |
| macOS (Redwood City) | `.AppleSystemUIFont` | none |
| Linux (Helsinki) | `Roboto` | `Ubuntu, Cantarell, DejaVu Sans, Liberation Sans, Arial` |

CSS equivalent: `font-family: "Segoe UI"` on Windows; `system-ui, -apple-system` on macOS; `Roboto, Ubuntu, Cantarell, "DejaVu Sans", "Liberation Sans", Arial` on Linux.

When a Google font is chosen, `getGoogleFontSafely` yields the google_fonts-generated family name (comment example in `AF/lib/util/font_family_extension.dart`: display "Noto Sans HK" ↔ family `NotoSansHK_Regular`). Electron should load the same Google font family by its display name.

Text scale: `MediaQuery.textScaler = TextScaler.linear(state.textScaleFactor)` (A.6), applied under the MaterialApp builder, so it covers all text. Separately, whole-app zoom uses `ScaledWidgetsFlutterBinding.scaleFactor`, also in A.6.

---

### A.6 Appearance state & persistence

#### A.6.1 `AppearanceSettingsCubit` / `AppearanceSettingsState`

File: `AF/lib/workspace/application/settings/appearance/appearance_cubit.dart` (freezed).

Construction: `AppearanceSettingsCubit(AppearanceSettingsPB, DateTimeSettingsPB, AppTheme)`. The cubit keeps both PB objects as mutable `_appearanceSettings` / `_dateTimeSettings`. It calls `readTextScaleFactor()` immediately and is created in `app_widget.dart` with `..readLocaleWhenAppLaunch(context)`.

| State field | Type | Initialized from | Fresh-install default | Mutators | Persistence |
|---|---|---|---|---|---|
| appTheme | `AppTheme` | `appTheme(PB.theme)` (startup) | Default (`AppTheme.fallback`) | `setTheme(name)`, `resetTheme()` → `'Default'` | PB.theme |
| themeMode | `ThemeMode {system, light, dark}` | `_themeModeFromPB(PB.theme_mode)`: Light→light, Dark→dark, System/other→system | system | `setThemeMode`, `resetThemeMode()` → system, `toggleThemeMode()` (light→dark, else→light). Hotkey: Ctrl/Cmd+Shift+L (`AF/lib/workspace/presentation/home/hotkeys.dart`) | PB.theme_mode |
| font | `String` | PB.font | `''` (system) | `setFontFamily(name)`, `resetFontFamily()` → `''` | PB.font |
| layoutDirection | `LayoutDirection {ltrLayout, rtlLayout}` | PB.layout_direction (RTLLayout→rtl, else ltr) | ltrLayout | `setLayoutDirection` | PB.layout_direction. Only consumed by the document editor (`Directionality` in `editor_page.dart`, `block_action_option_button.dart`); the app shell is not mirrored |
| textDirection | `AppFlowyTextDirection {ltr, rtl, auto}` | PB.text_direction: LTR→ltr, RTL→rtl, AUTO→auto, **FALLBACK/other→ltr** | ltr | `setTextDirection` (the UI also calls `DocumentAppearanceCubit.syncDefaultTextDirection(value.name)`) | PB + KV `kDocumentAppearanceDefaultTextDirection` |
| enableRtlToolbarItems | `bool` | PB | false | `setEnableRTLToolbarItems` | PB |
| locale | `Locale` | `Locale(PB.locale.language_code, PB.locale.country_code)` | `Locale('en','')`, replaced by the device locale on first launch | `setLocale(context, locale)` | PB.locale |
| isMenuCollapsed | `bool` | PB | false | `saveIsMenuCollapsed(bool)` (**persists without emitting**). Called by `HomeSettingBloc` when the menu status changes to anything except `floating` | PB.is_menu_collapsed |
| menuOffset | `double` | PB | 0.0 | `saveMenuOffset(double)` (**persists without emitting**). Called on sidebar drag end | PB.menu_offset. Sidebar width = `max(268 + offset, 268)` (`HomeSizes.minimumSidebarWidth = 268`); drag offset clamped 0..200, so width is 268..468 |
| dateFormat | `UserDateFormatPB` | DateTimeSettingsPB.date_format | Friendly | `setDateFormat` | DateTimeSettingsPB |
| timeFormat | `UserTimeFormatPB` | DateTimeSettingsPB.time_format | TwentyFourHour | `setTimeFormat` | DateTimeSettingsPB |
| timezoneId | `String` | DateTimeSettingsPB.timezone_id | `''` | (none) | — |
| documentCursorColor | `Color?` | `PB.document_setting.cursor_color`: `''` → null, else `Color(int.parse("0xaarrggbb"))` | null → `colorScheme.primary` | `setDocumentCursorColor(c)` (stores `c.toHexString()`), `resetDocumentCursorColor()` (stores `''`, emits null) | PB. The UI also calls `DocumentAppearanceCubit.syncCursorColor`, which writes KV `kDocumentAppearanceCursorColor`; the **editor reads the KV copy** |
| documentSelectionColor | `Color?` | same, `selection_color` | null → `primary @ alpha 0.2` | `setDocumentSelectionColor`, `resetDocumentSelectionColor` | PB + KV `kDocumentAppearanceSelectionColor` (editor reads KV) |
| textScaleFactor | `double` | KV `textScaleFactor` via `readTextScaleFactor()` | 1.0 | `setTextScaleFactor(v)`: writes KV `v.toString()` **unclamped**, emits `v.clamp(0.7, 1.0)`. **No desktop caller** | SharedPreferences only ("not synced across devices") |
| (derived) lightTheme / darkTheme | `ThemeData` | `getIt<BaseAppearance>().getThemeData(appTheme, brightness, font, 'RobotoMono')` | | | |

Hex string format for colors: `ColorExtension.toHexString()` (`AF/lib/util/color_to_hex_string.dart`) produces a lowercase `'0x' + aa + rr + gg + bb`, with each channel computed as `(c*255).toInt()` (truncation). It is parsed back with `int.parse` (Dart accepts the `0x` prefix).

Other cubit API:
- `setKeyValue(key, value?)` / `getValue(key)` read and write `PB.setting_key_value`. No callers exist in lib.
- Every mutator persists by sending the **entire** `AppearanceSettingsPB` through `UserSettingsBackendService().setAppearanceSetting(pb)` (fire-and-forget; errors are logged). Date/time mutators send the whole `DateTimeSettingsPB` through `setDateTimeSettings`.

Locale logic:
- `setLocale(ctx, l)`:
  1. If `l` is not in `context.supportedLocales`, use `Locale('en','US')`.
  2. `context.setLocale(l)` (easy_localization) and `AppFlowyEditorLocalizations.load(l)`.
  3. If `state.locale != l`: set `PB.locale.language_code = l.languageCode`, `country_code = l.countryCode ?? ''`, save, emit.
- `readLocaleWhenAppLaunch(ctx)`: if `PB.reset_to_default` (default true) → set it false, save, `setLocale(ctx, ctx.deviceLocale)`. Otherwise `setLocale(ctx, state.locale)`.
- There is **no `useSystemLocale` field**; "follow device" happens only on the first launch, through `reset_to_default`.
- AMBIGUOUS: the PB default `Locale('en','')` is not equal to `en_US`, so it maps to en-US through the unsupported-locale fallback.

Supported locales (`app_widget.dart`, `EasyLocalization`, `path: 'assets/translations'`, `fallbackLocale: en-US`, `useFallbackTranslations: true`), in this order: `am-ET, ar-SA, ca-ES, cs-CZ, ckb-KU, de-DE, en-US, en-GB, es-VE, eu-ES, el-GR, fr-FR, fr-CA, he, hu-HU, id-ID, it-IT, ja-JP, ko-KR, pl-PL, pt-BR, ru-RU, sv-SE, th-TH, tr-TR, uk-UA, ur, vi-VN, zh-CN, zh-TW, fa, hin, mr-IN` (33).

Dropdown labels come from `languageFromLocale` (`AF/packages/flowy_infra/lib/language.dart`):

| Locale | Label |
|---|---|
| en-GB | English (GB) |
| en-* | English (US) |
| zh-CN | 简体中文 |
| zh-TW | 繁體中文 |
| am | አማርኛ |
| ar | العربية |
| ca | Català |
| cs | Čeština |
| ckb-KU | کوردی سۆرانی |
| de | Deutsch |
| es | Español |
| eu | Euskera |
| el | Ελληνικά |
| fr-CA | Français (CA) |
| fr-FR | Français (FR) |
| mr | मराठी |
| he | עברית |
| hu | Magyar |
| id | Bahasa Indonesia |
| it | Italiano |
| ja | 日本語 |
| ko | 한국어 |
| pl | Polski |
| pt | Português |
| ru | русский |
| sv | Svenska |
| th | ไทย |
| tr | Türkçe |
| fa | فارسی |
| uk | українська |
| ur | اردو |
| hin | हिन्दी |
| anything else (e.g. **vi**) | raw language code (`vi`) |

#### A.6.2 Backend events and protobuf

Rust sources: `rust-lib/flowy-user/src/entities/user_setting.rs` and `date_time.rs`. Handlers live in `event_handler.rs`. Dart events are in `AF/packages/appflowy_backend/lib/dispatch/dart_event/flowy-user/dart_event.dart`, wrapped by `AF/lib/user/application/user_settings_service.dart` (`UserSettingsBackendService`).

| Event (UserEvent) | id | Input | Output | Dart wrapper |
|---|---|---|---|---|
| SetAppearanceSetting | 7 | AppearanceSettingsPB | — | `UserEventSetAppearanceSetting(pb).send()` |
| GetAppearanceSetting | 8 | — | AppearanceSettingsPB | `UserEventGetAppearanceSetting().send()`; error → `FlowySDKException(ExceptionType.AppearanceSettingsIsEmpty)` |
| GetUserSetting | 9 | — | UserSettingPB | not used for theming |
| SetDateTimeSettings | 33 | DateTimeSettingsPB | — | `UserEventSetDateTimeSettings(pb).send()` |
| GetDateTimeSettings | 34 | — | DateTimeSettingsPB | `UserEventGetDateTimeSettings().send()`; error → same exception |

Backend storage: `KVStorePreferences` (`rust-lib/flowy-sqlite/src/kv/kv.rs`, SQLite `cache.db` in the app storage path, `kv_table`). Values are serde JSON with snake_case field names and enum variant names as strings.
- `appearance_settings` key:
  - Set: if `theme` is empty, Rust stores `"Default"`.
  - Get: a missing key returns `AppearanceSettingsPB::default()`; a JSON parse failure logs and returns the default.
  - `theme`, `font`, `monospace_font` have **no `#[serde(default)]`**, so stored JSON missing any of them makes the whole object reset to default.
- `date_time_settings` key: same pattern. No serde defaults, so any missing field means default.

`AppearanceSettingsPB`:

| idx | Field (Rust / Dart) | Type | Rust default |
|---|---|---|---|
| 1 | theme / theme | string | `"Default"` (`APPEARANCE_DEFAULT_THEME`) |
| 2 | theme_mode / themeMode | ThemeModePB | `System` |
| 3 | font / font | string | `""` (`APPEARANCE_DEFAULT_FONT`, "system default font") |
| 4 | monospace_font / monospaceFont | string | `"SF Mono"`. **Never read or written by Flutter**; the code font is hard-wired to `RobotoMono` |
| 5 | locale / locale | LocaleSettingsPB | `{language_code: "en", country_code: ""}` |
| 6 | reset_to_default / resetToDefault | bool | `true` (serde default fn also true) |
| 7 | setting_key_value / settingKeyValue | map<string,string> | `{}` |
| 8 | is_menu_collapsed / isMenuCollapsed | bool | false |
| 9 | menu_offset / menuOffset | double (f64) | 0.0 |
| 10 | layout_direction / layoutDirection | LayoutDirectionPB | `LTRLayout` |
| 11 | text_direction / textDirection | TextDirectionPB | `FALLBACK`. The Rust comment says it should fall back to layout direction; Flutter maps it to `ltr` |
| 12 | document_setting / documentSetting | DocumentSettingsPB | `{}` (both none) |
| 13 | enable_rtl_toolbar_items / enableRtlToolbarItems | bool | false |

Nested types and enums:

| Type | Definition |
|---|---|
| `LocaleSettingsPB` | 1 `language_code: string`, 2 `country_code: string` |
| `DocumentSettingsPB` | 1 `cursor_color: oneof string`, 2 `selection_color: oneof string` (values `"0xaarrggbb"`; Dart reads unset as `''`) |
| `ThemeModePB` | Light=0, Dark=1, System=2 (default) |
| `LayoutDirectionPB` | LTRLayout=0 (default), RTLLayout=1 |
| `TextDirectionPB` | LTR=0, RTL=1, AUTO=2, FALLBACK=3 (default) |
| `DateTimeSettingsPB` | 1 `date_format: UserDateFormatPB` (default Friendly), 2 `time_format: UserTimeFormatPB` (default TwentyFourHour), 3 `timezone_id: string` (default "") |

Date and time formats (Dart patterns in `AF/lib/workspace/application/settings/date_time/date_format_ext.dart` and `time_format_ext.dart`; Rust `format_str()` in `date_time.rs`):

| UserDateFormatPB | Value | Dart intl pattern (UI) | Rust strftime | en-US label key → text |
|---|---|---|---|---|
| Locally | 0 | `MM/dd/y` | `%m/%d/%Y` | `dateFormat.local` → "Local" |
| US | 1 | `y/MM/dd` | `%Y/%m/%d` | `dateFormat.us` → "US" |
| ISO | 2 | `y-MM-dd` | `%Y-%m-%d` | `dateFormat.iso` → "ISO" |
| Friendly | 3 (default) | `MMM dd, y` | `%b %d, %Y` | `dateFormat.friendly` → "Friendly" |
| DayMonthYear | 4 | `dd/MM/y` | `%d/%m/%Y` | `dateFormat.dmy` → "D/M/Y" |

| UserTimeFormatPB | Value | Dart | Rust |
|---|---|---|---|
| TwelveHour | 0 | `DateFormat.jm()` | `%I:%M %p` |
| TwentyFourHour | 1 (default) | `DateFormat.Hm()` | `%R` |

Date/time formatting notes:
- `formatDate(date, includeTime, [timeFormat])` appends `add_Hm()` (24h) or `add_jm()` (12h).
- `DateFormat(pattern)` uses the current Intl locale. If construction throws, it is retried with `'en-US'`.
- Settings example label: `settings.workspacePage.dateTime.example` = `"{} at {} ({})"` → `[dateFormat.formatDate(now,false), timeFormat.formatTime(now), now.timeZoneName]`.
- Database date fields map these enums to `DateFormatPB`/`TimeFormatPB` (`AF/lib/workspace/presentation/widgets/date_picker/utils/*.dart`): Locally→Local, US→US, ISO→ISO, Friendly→Friendly, DayMonthYear→DayMonthYear; 12h/24h one-to-one.

#### A.6.3 Local key-value storage (Flutter side)

`KeyValueStorage` → `DartKeyValue` (`AF/lib/core/config/kv.dart`) uses SharedPreferences and stores everything with `setString`. On Windows the file is `<ApplicationSupport>\shared_preferences.json`, and keys get the default prefix `flutter.` (shared_preferences 2.3.5 / shared_preferences_windows 2.4.1). `DocumentAppearanceCubit` calls `SharedPreferences` directly, including `setDouble`.

Keys (`AF/lib/core/config/kv_keys.dart`, class `KVKeys`) relevant to appearance:

| Key string | Value | Writer / reader | Notes |
|---|---|---|---|
| `textScaleFactor` | double as string | AppearanceSettingsCubit (state clamp 0.7–1.0); DocumentAppearanceCubit.fetch multiplies document font size by the raw value | The KVKeys comment says "0.8 to 1.0", but the code clamps to 0.7–1.0 |
| `scaleFactor` | double as string, clamp 0.5–2.0 | `WindowSizeManager` (`AF/lib/startup/tasks/app_window_size_manager.dart`) | Whole-app zoom via `ScaledWidgetsFlutterBinding.instance.scaleFactor`, applied at startup (`windows.dart`). Hotkeys Ctrl/Cmd + `=`/`+`/numpad+ → +0.1, `-`/numpad− → −0.1, `0`/numpad0 → 1.0; rounded to 2 decimals. Electron equivalent: `webContents.setZoomFactor` |
| `kDocumentAppearanceFontSize` | double (`setDouble`) | DocumentAppearanceCubit | default 16.0 |
| `kDocumentAppearanceFontFamily` | string | DocumentAppearanceCubit | default `''`. Editor uses this value, or the workspace `font` if it is empty |
| `kDocumentAppearanceDefaultTextDirection` | `'ltr'|'rtl'|'auto'` or removed | DocumentAppearanceCubit | |
| `kDocumentAppearanceCursorColor` | `"0xaarrggbb"` or removed | DocumentAppearanceCubit | the editor's effective cursor color |
| `kDocumentAppearanceSelectionColor` | `"0xaarrggbb"` or removed | DocumentAppearanceCubit | the editor's effective selection color |
| `kDocumentAppearanceWidth` | double (`setDouble`) | DocumentAppearanceCubit | clamp `EditorStyleCustomizer.minDocumentWidth` 480 to `maxDocumentWidth` 1920; desktop default 1920 |

#### A.6.4 How the app root applies the theme

The flow runs in `AF/lib/startup/tasks/app_widget.dart`:

1. `InitAppWidgetTask.initialize`:
   1. `UserSettingsBackendService().getAppearanceSetting()` and `getDateTimeSettings()`.
   2. `appTheme(appearanceSetting.theme)`.
   3. `runApp(EasyLocalization(... child: ApplicationWidget(appearanceSetting, dateTimeSettings, appTheme)))`.
2. `ApplicationWidget` provides through `MultiBlocProvider`:
   - `AppearanceSettingsCubit(..)..readLocaleWhenAppLaunch(context)`
   - `DocumentAppearanceCubit()..fetch()`
   - `NotificationSettingsCubit`
   - `CommandPaletteBloc` (if `FeatureFlag.search`)
   - `RenameViewBloc`, `ActionNavigationBloc`
3. `BlocBuilder<AppearanceSettingsCubit>` wraps `Provider<ClipboardState>`, then `ToastificationWrapper`, then a `Listener` that calls `Tooltip.dismissAllToolTips()` on any `PointerScrollEvent`, then:
   - `MaterialApp.router(debugShowCheckedModeBanner: false, theme: state.lightTheme, darkTheme: state.darkTheme, themeMode: state.themeMode, locale: state.locale, localizationsDelegates/supportedLocales from easy_localization, routerConfig)`.
   - `builder:` → `AnimatedAppFlowyTheme(data: brightness == light ? AppFlowyDefaultTheme().light(fontFamily: f) : .dark(fontFamily: f))`, where `f = state.font.orDefault('').fontFamilyName` (google_fonts-resolved family, or `''`).
   - Inside it: `MediaQuery(textScaler: TextScaler.linear(state.textScaleFactor))` → `overlayManagerBuilder(...)` (flowy_infra_ui) → `CommandPalette` (desktop + search flag) → route child.
4. Font-name helpers (`AF/lib/util/font_family_extension.dart`):
   - `fontFamilyDisplayName`: `''` → "System"; otherwise strip `_regular` and split camelCase.
   - `fontFamilyName`: `''` → `''`; otherwise `getGoogleFontSafely(this).fontFamily`.

#### A.6.5 Appearance settings UI

Page: `AF/lib/workspace/presentation/settings/pages/settings_workspace_view.dart`, class `SettingsWorkspaceView`. This list covers the theme-related controls only, in display order:

1. Workspace name and Workspace icon (hidden for local `WorkspaceTypePB.LocalW`). Not theme-related.
2. Category **"Appearance"** (`AppearanceSelector`):
   - Three tiles in `ThemeMode.values` order: system "Auto", light "Light", dark "Dark".
   - Each tile is 88×72 with image `assets/images/appearance/{system|light|dark}.png` (cover fit), a 1px border (`colorScheme.onSecondary` when selected, else `outline`), radius 4, right padding 16, then VSpace 6 and the label (`FlowyText.regular`, centered).
   - Selected tile: 16×16 circular `Material`, elevation 2, at offset (4,4), showing `FlowySvgs.settings_selected_theme_m` (blendMode dstIn).
   - Hover: `FlowyHover(HoverStyle.transparent(foregroundColorOnHover: AFX.textColor))`.
3. VSpace 16, then category **"Theme"** (description: "Select a preset theme, or upload your own custom theme."):
   - `_ThemeDropdown`: `SettingsDropdown<String>`, key `ThemeSelectorDropdown`.
     - Options: built-ins (Default, Dandelion, Lemonade, Lavender) followed by custom plugin themes. Each option has a leading 16×16 swatch (radius 4, 1px `outline` border) filled with that theme's `sidebarBg` for the current brightness.
     - Custom themes get a trailing delete `FlowyIconButton` (`FlowySvgs.delete_s`).
     - Upload action: `FlowySvgs.folder_m` 20px, tooltip "Upload a custom theme". Opens `Dialogs.show(FlowyDialog(constraints: maxHeight 300, child: ThemeUploadWidget()))`; on a non-null result shows the snackbar "Your theme was uploaded successfully".
     - Reset action: `FlowySvgs.restore_s` 20px, label "Reset" → `setTheme('Default')`.
   - `_DocumentCursorColorSetting`: "Document cursor color".
   - `_DocumentSelectionColorSetting`: "Document selection color".
   - `DocumentPaddingSetting`: "Document width" slider, 480–1920, 10 divisions, thumb radius 8, no overlay.
   - The two color settings have reset confirm dialogs: "Reset document cursor color" / "Are you sure you want to reset the cursor color?" and "Reset document selection color" / "Are you sure you want to reset the selection color?".
4. Category **"Workspace font"**:
   - `_FontSelectorDropdown`: a `FlowyTextField` with a drop-down arrow.
     - Content padding v12 h18; borders radius 8: enabled `outline`, focused `primary`, error `error`.
     - Popover: maxHeight 150, width = parent width − 90, radius 4.
     - Options: `['' , ...GoogleFonts.asMap().keys]`. Each item is a 29px `ListTile`: hover `onSurface@0.12`, selected `primary@0.12`, padding h6 v4, rendered in its own font, check icon when selected. Initial scroll offset = `index × 32`.
     - Empty search result text: "No font found, try another term."
     - Reset button (26px high, restore icon + "Reset") → `''`.
   - `SettingsDashedDivider(outline)`.
   - Sub-category "Text direction": `TextDirectionSelect` radios (Left to right / Right to left / Auto) and `EnableRTLItemsSwitcher` toggle "Enable RTL toolbar items".
5. VSpace 16, then category **"Layout direction"**: radios "Left to right" / "Right to left".
6. Category **"Date & time"**:
   - Example label (16px, `AFX.secondaryTextColor`, maxLines 2).
   - "24-hour time" toggle.
   - Dashed divider.
   - "Date format" dropdown (key `DateFormatDropdown`).
7. Category **"Language"**: `LanguageDropdown` (key `LanguageDropdown`).

Theme upload dialog (`AF/lib/workspace/presentation/settings/widgets/theme_upload/*`):
- `ThemeUploadWidget` constants: borderRadius 8, buttonFontSize 14, buttonSize 100×32, padding 12, iconSize 48, elementSpacer 12, fadeOpacity 0.5, fadeDuration 750 ms, switch curve `easeInOutCubicEmphasized`.
- Bloc state → content:

| DynamicPluginBloc state | Content |
|---|---|
| `ready` / `deletionSuccess` | `UploadNewThemeWidget` |
| `processing` | loading widget ("Please wait while we validate and upload your theme...") |
| `compilationFailure` | failure widget showing the exception message |
| `compilationSuccess` | the dialog pops |

- `UploadNewThemeWidget` layout: background `surface@0.5`; folder icon 48px (`AFX.onBackground`); text "Upload your own AppFlowy theme using the button below."; "Learn more" `SecondaryButton` (blocked in this checkout, see the header); `Divider`; Upload button.

---

### A.7 appflowy_ui AppFlowyTheme (design tokens)

Source files (relative to `frontend/`). The repo's local changes do not touch any file below (checked with `git status` / `git diff`).

| file | role |
|---|---|
| appflowy_flutter/packages/appflowy_ui/lib/src/theme/appflowy_theme.dart | `AppFlowyTheme` (StatelessWidget), `AppFlowyInheritedTheme` (InheritedTheme), `AppFlowyThemeDataTween`, `AnimatedAppFlowyTheme` |
| .../theme/theme.dart | barrel export (appflowy_theme, built_in_themes, border_radius, color_scheme, theme_data, spacing, shadow, text_style) |
| .../theme/definition/theme_data.dart | `AppFlowyThemeData` (14 fields) + `lerp`; abstract `AppFlowyThemeBuilder { light({String? fontFamily}); dark({String? fontFamily}); }` |
| .../theme/definition/color_scheme/*.dart | 10 color-scheme classes (`AppFlowy{Text,Icon,Border,Fill,Surface,SurfaceContainer,Background,Badge,Brand,OtherColors}ColorScheme`), each made only of `final Color` fields plus `lerp()`. Every lerp maps each field to itself (checked) |
| .../theme/definition/spacing/spacing.dart, border_radius/border_radius.dart | `AppFlowySpacing` / `AppFlowyBorderRadius` {xs,s,m,l,xl,xxl} (double) |
| .../theme/definition/shadow/shadow.dart | `AppFlowyShadow { List<BoxShadow> small, medium }` |
| .../theme/definition/text_style/text_style.dart, base/default_text_style.dart | `AppFlowyBaseTextStyle` (8 groups) and `TextThemeType` (4 variants) |
| .../theme/data/shared.dart | `AppFlowySpacingConstant`, `AppFlowyBorderRadiusConstant`, `AppFlowySharedTokens.build{BorderRadius,Spacing,Shadow}` |
| .../theme/data/appflowy_default/primitive.dart | `AppFlowyPrimitiveTokens`: 213 static Color getters. AUTO-GENERATED on 2025-05-15 |
| .../theme/data/appflowy_default/semantic.dart | `AppFlowyDefaultTheme implements AppFlowyThemeBuilder`: maps primitives to semantic tokens for light and dark. AUTO-GENERATED |
| .../theme/data/built_in_themes.dart | one line: `export 'appflowy_default/semantic.dart';` |
| .../theme/data/custom/custom_theme.dart | `CustomTheme` stub. Both methods throw `UnimplementedError`. Not exported |
| appflowy_flutter/packages/appflowy_ui/script/generate_theme.dart + `Primitive.Mode 1.tokens.json`, `Semantic.Light Mode.tokens.json`, `Semantic.Dark Mode.tokens.json` | Generator. Reads W3C design-token JSON (a Figma export) and writes primitive.dart and semantic.dart. Checked: all 230 semantic values in light and in dark match the JSON exactly |
| appflowy_flutter/lib/startup/tasks/app_widget.dart | Injection point. See A.7.6 |

`AppFlowyThemeData` fields: `textColorScheme`, `textStyle`, `iconColorScheme`, `borderColorScheme`, `backgroundColorScheme`, `fillColorScheme`, `surfaceColorScheme`, `borderRadius`, `spacing`, `shadow`, `brandColorScheme`, `surfaceContainerColorScheme`, `badgeColorScheme`, `otherColorsColorScheme`.

#### A.7.1 Primitives

There are 213 color primitives. The JSON also holds 16 dimension primitives (Spacing 0/100..600/1000 and Border-Radius 0/100..600/1000; see A.7.3). Flutter writes colors as `0xAARRGGBB`; CSS hex below is `#RRGGBB` or `#RRGGBBAA`. Naming in Dart is `AppFlowyPrimitiveTokens.<token>`, and in the JSON it is `{Neutral.1000}`, `{Blue.600}`, `{Subtle_Color.Rose.100}` and so on.

**Neutral (20)**

| token | Flutter Color | CSS hex | rgba |
|---|---|---|---|
| neutral100 | 0xFFF8FAFF | #F8FAFF | |
| neutral200 | 0xFFE4E8F5 | #E4E8F5 | |
| neutral300 | 0xFFCED3E6 | #CED3E6 | |
| neutral400 | 0xFFB5BBD3 | #B5BBD3 | |
| neutral500 | 0xFF989EB7 | #989EB7 | |
| neutral600 | 0xFF6F748C | #6F748C | |
| neutral700 | 0xFF54596E | #54596E | |
| neutral800 | 0xFF3D404F | #3D404F | |
| neutral830 | 0xFF363845 | #363845 | |
| neutral850 | 0xFF32343F | #32343F | |
| neutral900 | 0xFF272930 | #272930 | |
| neutral1000 | 0xFF21232A | #21232A | |
| neutralBlack | 0xFF000000 | #000000 | |
| neutralAlphaBlack60 | 0x99000000 | #00000099 | rgba(0,0,0,0.6) |
| neutralWhite | 0xFFFFFFFF | #FFFFFF | |
| neutralAlphaWhite0 | 0x00FFFFFF | #FFFFFF00 | rgba(255,255,255,0) |
| neutralAlphaGrey10005 | 0x0DF9FAFD | #F9FAFD0D | rgba(249,250,253,0.051) |
| neutralAlphaGrey10010 | 0x1AF9FAFD | #F9FAFD1A | rgba(249,250,253,0.102) |
| neutralAlphaGrey100005 | 0x0D1F2329 | #1F23290D | rgba(31,35,41,0.051) |
| neutralAlphaGrey100010 | 0x1A1F2329 | #1F23291A | rgba(31,35,41,0.102) |

**Hue scales, 70 tokens (`<hue><step>`, all opaque, CSS hex)**

| hue | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 |
|---|---|---|---|---|---|---|---|---|---|---|
| blue | #E3F6FF | #A9E2FF | #80D2FF | #4EC1FF | #00B5FF | #0092D6 | #0078C0 | #0065A9 | #00508F | #003C77 |
| green | #ECF9F5 | #C3E5D8 | #9AD1BC | #71BD9F | #48A982 | #248569 | #29725D | #2E6050 | #305548 | #305244 |
| purple | #F1E0FF | #E1B3FF | #D185FF | #BC58FF | #9327FF | #7A1DCC | #6617B3 | #55138F | #470C72 | #380758 |
| magenta | #FFE5EF | #FFB8D1 | #FF8AB2 | #FF5C93 | #FB006D | #D2005F | #D2005F | #850040 | #610031 | #400022 |
| red | #FFD2DD | #FFA5B4 | #FF7D87 | #FF5050 | #F33641 | #E71D32 | #AD1625 | #8C101C | #6E0A1E | #4C0A17 |
| orange | #FFF3D5 | #FFE4AB | #FFD181 | #FFBE62 | #FFA02E | #DB7E21 | #B75F17 | #93450E | #7A3108 | #602706 |
| yellow | #FFF9B2 | #FFEC66 | #FFDF1A | #FFCC00 | #FFCE00 | #E6B800 | #CC9F00 | #B38A00 | #9A7500 | #7F6200 |

**Alpha hue tokens (3)**

| token | Flutter Color | CSS hex | rgba |
|---|---|---|---|
| blueAlphaBlue50015 | 0x2600B5FF | #00B5FF26 | rgba(0,181,255,0.149) |
| blueAlphaBlue50020 | 0x3300B5FF | #00B5FF33 | rgba(0,181,255,0.2) |
| redAlphaRed50010 | 0x1AF33641 | #F336411A | rgba(243,54,65,0.102) |

**Subtle colors, 120 tokens (`subtleColor<Family><step>`, all opaque, CSS hex). These are the source for every badge token.**

| # | family | 100 | 200 | 300 | 400 | 500 | 600 |
|---|---|---|---|---|---|---|---|
| 1 | Rose | #FCF2F2 | #FAE3E3 | #FAD9D9 | #EDADAD | #CC4E4E | #702828 |
| 2 | Papaya | #FCF4F0 | #FAE8DE | #FADFD2 | #F0BDA3 | #D67240 | #6B3215 |
| 3 | Tangerine | #FFF7ED | #FCEDD9 | #FAE5CA | #F2CB99 | #DB8F2C | #613B0A |
| 4 | Mango | #FFF9EC | #FCF1D7 | #FAE9C3 | #F5D68E | #E0A416 | #5C4102 |
| 5 | Lemon | #FFFBE8 | #FCF5CF | #FAEFB9 | #F5E282 | #E0BB00 | #574800 |
| 6 | Olive | #F9FAE6 | #F6F7D0 | #F0F2B3 | #DBDE83 | #ADB204 | #4A4C03 |
| 7 | Lime | #F6F9E6 | #EEF5CE | #E7F0BB | #CFDB91 | #92A822 | #414D05 |
| 8 | Grass | #F4FAEB | #E9F5D7 | #DEF0C5 | #BFD998 | #75A828 | #334D0C |
| 9 | Forest | #F1FAF0 | #E2F5DF | #D7F0D3 | #A8D6A1 | #49A33B | #1E4F16 |
| 10 | Jade | #F0FAF6 | #DFF5EB | #CEF0E1 | #90D1B5 | #1C9963 | #075231 |
| 11 | Aqua | #F0F9FA | #DFF3F5 | #CCECF0 | #83CCD4 | #008E9E | #004E57 |
| 12 | Azure | #F0F6FA | #E1EEF7 | #D3E6F5 | #88C0EB | #0877CC | #154469 |
| 13 | Denim | #F0F3FA | #E3EBFA | #D7E2F7 | #9AB6ED | #3267D1 | #223C70 |
| 14 | Mauve | #F2F2FC | #E6E6FA | #DCDCF7 | #AEAEF5 | #5555E0 | #36366B |
| 15 | Lavender | #F6F3FC | #EBE3FA | #E4DAF7 | #C1AAF0 | #8153DB | #462F75 |
| 16 | Lilac | #F7F0FA | #F0E1F7 | #EDD7F7 | #D3A9E8 | #9E4CC7 | #562D6B |
| 17 | Mallow | #FAF0FA | #F5E1F4 | #F5D7F4 | #DEA4DC | #B240AF | #632861 |
| 18 | Camellia | #F9EFF3 | #F7E1EB | #F7D7E5 | #E5A3C0 | #C24279 | #6E2343 |
| 19 | Smoke | #F5F5F5 | #E8E8E8 | #DEDEDE | #B8B8B8 | #6E6E6E | #404040 |
| 20 | Iron | #F2F4F7 | #E6E9F0 | #DADEE5 | #B0B5BF | #666F80 | #394152 |

Notes:
- Totals: 20 neutral + 70 hue + 3 alpha hue + 120 subtle = 213.
- Primitives not used by any semantic token (44): neutralBlack, blue300/800/900/1000, green300/400/800/900/1000, purple300/700/800/900/1000, all 10 magenta, red300/800/900/1000, orange300/400/800/900/1000, all 10 yellow. No app or component code references `AppFlowyPrimitiveTokens` directly (grep returns nothing), so CSS only needs the semantic variables.
- AMBIGUOUS: `magenta600 == magenta700 == #D2005F`, and the JSON source has the same values, so this is probably a design-file typo. `yellow400 #FFCC00` is lighter than `yellow500 #FFCE00` by a tiny amount, so that scale is not monotonic. green900 (#305548) and green1000 (#305244) are almost the same. Copy the values exactly as listed.

#### A.7.2 Semantic colors

There are 230 semantic color tokens: text 17, icon 15, border 18, fill 33, surface 13, surfaceContainer 3, background 1, badge 120, brand 9, other 1. Badge, brand and other are identical in light and dark. All the rest change by theme. CSS variable names follow the kebab-case names in the JSON source (for example `on-fill`, `layer-01`, `text-highlight`) with an `--af-<group>-` prefix. Dart access path: `AppFlowyTheme.of(context).<scheme>.<field>`.

**textColorScheme** (`AppFlowyTextColorScheme`, 17)

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| primary | neutral1000 | #21232A | neutral200 | #E4E8F5 | --af-text-primary |
| secondary | neutral600 | #6F748C | neutral500 | #989EB7 | --af-text-secondary |
| tertiary | neutral500 | #989EB7 | neutral600 | #6F748C | --af-text-tertiary |
| quaternary | neutral200 | #E4E8F5 | neutral1000 | #21232A | --af-text-quaternary |
| onFill | neutralWhite | #FFFFFF | neutralWhite | #FFFFFF | --af-text-on-fill |
| action | blue600 | #0092D6 | blue500 | #00B5FF | --af-text-action |
| actionHover | blue700 | #0078C0 | blue400 | #4EC1FF | --af-text-action-hover |
| info | blue600 | #0092D6 | blue500 | #00B5FF | --af-text-info |
| infoHover | blue700 | #0078C0 | blue400 | #4EC1FF | --af-text-info-hover |
| success | green600 | #248569 | green600 | #248569 | --af-text-success |
| successHover | green700 | #29725D | green500 | #48A982 | --af-text-success-hover |
| warning | orange600 | #DB7E21 | orange600 | #DB7E21 | --af-text-warning |
| warningHover | orange700 | #B75F17 | orange500 | #FFA02E | --af-text-warning-hover |
| error | red600 | #E71D32 | red500 | #F33641 | --af-text-error |
| errorHover | red700 | #AD1625 | red400 | #FF5050 | --af-text-error-hover |
| featured | purple500 | #9327FF | purple500 | #9327FF | --af-text-featured |
| featuredHover | purple600 | #7A1DCC | purple400 | #BC58FF | --af-text-featured-hover |

**iconColorScheme** (`AppFlowyIconColorScheme`, 15)

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| primary | neutral1000 | #21232A | neutral200 | #E4E8F5 | --af-icon-primary |
| secondary | neutral600 | #6F748C | neutral400 | #B5BBD3 | --af-icon-secondary |
| tertiary | neutral400 | #B5BBD3 | neutral600 | #6F748C | --af-icon-tertiary |
| quaternary | neutral200 | #E4E8F5 | neutral1000 | #21232A | --af-icon-quaternary |
| infoThick | blue600 | #0092D6 | blue500 | #00B5FF | --af-icon-info-thick |
| infoThickHover | blue700 | #0078C0 | blue400 | #4EC1FF | --af-icon-info-thick-hover |
| successThick | green600 | #248569 | green600 | #248569 | --af-icon-success-thick |
| successThickHover | green700 | #29725D | green500 | #48A982 | --af-icon-success-thick-hover |
| warningThick | orange600 | #DB7E21 | orange600 | #DB7E21 | --af-icon-warning-thick |
| warningThickHover | orange700 | #B75F17 | orange500 | #FFA02E | --af-icon-warning-thick-hover |
| errorThick | red600 | #E71D32 | red500 | #F33641 | --af-icon-error-thick |
| errorThickHover | red700 | #AD1625 | red400 | #FF5050 | --af-icon-error-thick-hover |
| featuredThick | purple500 | #9327FF | purple500 | #9327FF | --af-icon-featured-thick |
| featuredThickHover | purple600 | #7A1DCC | purple400 | #BC58FF | --af-icon-featured-thick-hover |
| onFill | neutralWhite | #FFFFFF | neutralWhite | #FFFFFF | --af-icon-on-fill |

**borderColorScheme** (`AppFlowyBorderColorScheme`, 18)

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| primary | neutral200 | #E4E8F5 | neutral800 | #3D404F | --af-border-primary |
| primaryHover | neutral300 | #CED3E6 | neutral700 | #54596E | --af-border-primary-hover |
| secondary | neutral800 | #3D404F | neutral300 | #CED3E6 | --af-border-secondary |
| secondaryHover | neutral700 | #54596E | neutral200 | #E4E8F5 | --af-border-secondary-hover |
| tertiary | neutral1000 | #21232A | neutral100 | #F8FAFF | --af-border-tertiary |
| tertiaryHover | neutral900 | #272930 | neutralWhite | #FFFFFF | --af-border-tertiary-hover |
| themeThick | blue500 | #00B5FF | blue500 | #00B5FF | --af-border-theme-thick |
| themeThickHover | blue600 | #0092D6 | blue600 | #0092D6 | --af-border-theme-thick-hover |
| infoThick | blue500 | #00B5FF | blue500 | #00B5FF | --af-border-info-thick |
| infoThickHover | blue600 | #0092D6 | blue400 | #4EC1FF | --af-border-info-thick-hover |
| successThick | green600 | #248569 | green600 | #248569 | --af-border-success-thick |
| successThickHover | green700 | #29725D | green500 | #48A982 | --af-border-success-thick-hover |
| warningThick | orange600 | #DB7E21 | orange600 | #DB7E21 | --af-border-warning-thick |
| warningThickHover | orange700 | #B75F17 | orange500 | #FFA02E | --af-border-warning-thick-hover |
| errorThick | red600 | #E71D32 | red500 | #F33641 | --af-border-error-thick |
| errorThickHover | red700 | #AD1625 | red400 | #FF5050 | --af-border-error-thick-hover |
| featuredThick | purple500 | #9327FF | purple500 | #9327FF | --af-border-featured-thick |
| featuredThickHover | purple600 | #7A1DCC | purple400 | #BC58FF | --af-border-featured-thick-hover |

**fillColorScheme** (`AppFlowyFillColorScheme`, 33)

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| primary | neutral100 | #F8FAFF | neutral900 | #272930 | --af-fill-primary |
| primaryHover | neutral200 | #E4E8F5 | neutral800 | #3D404F | --af-fill-primary-hover |
| secondary | neutral300 | #CED3E6 | neutral600 | #6F748C | --af-fill-secondary |
| secondaryHover | neutral400 | #B5BBD3 | neutral500 | #989EB7 | --af-fill-secondary-hover |
| tertiary | neutral600 | #6F748C | neutral300 | #CED3E6 | --af-fill-tertiary |
| tertiaryHover | neutral500 | #989EB7 | neutral200 | #E4E8F5 | --af-fill-tertiary-hover |
| quaternary | neutral1000 | #21232A | neutral100 | #F8FAFF | --af-fill-quaternary |
| quaternaryHover | neutral900 | #272930 | neutralWhite | #FFFFFF | --af-fill-quaternary-hover |
| content | neutralAlphaWhite0 | #FFFFFF00 | neutralAlphaWhite0 | #FFFFFF00 | --af-fill-content |
| contentHover | neutralAlphaGrey100005 | #1F23290D | neutralAlphaGrey10005 | #F9FAFD0D | --af-fill-content-hover |
| contentVisible | neutralAlphaGrey100005 | #1F23290D | neutralAlphaGrey10005 | #F9FAFD0D | --af-fill-content-visible |
| contentVisibleHover | neutralAlphaGrey100010 | #1F23291A | neutralAlphaGrey10010 | #F9FAFD1A | --af-fill-content-visible-hover |
| themeThick | blue500 | #00B5FF | blue500 | #00B5FF | --af-fill-theme-thick |
| themeThickHover | blue600 | #0092D6 | blue600 | #0092D6 | --af-fill-theme-thick-hover |
| themeSelect | blueAlphaBlue50015 | #00B5FF26 | blueAlphaBlue50015 | #00B5FF26 | --af-fill-theme-select |
| textSelect | blueAlphaBlue50020 | #00B5FF33 | blueAlphaBlue50020 | #00B5FF33 | --af-fill-text-select |
| infoLight | blue100 | #E3F6FF | blue200 | #A9E2FF | --af-fill-info-light |
| infoLightHover | blue200 | #A9E2FF | blue100 | #E3F6FF | --af-fill-info-light-hover |
| infoThick | blue500 | #00B5FF | blue500 | #00B5FF | --af-fill-info-thick |
| infoThickHover | blue600 | #0092D6 | blue400 | #4EC1FF | --af-fill-info-thick-hover |
| successLight | green100 | #ECF9F5 | green200 | #C3E5D8 | --af-fill-success-light |
| successLightHover | green200 | #C3E5D8 | green100 | #ECF9F5 | --af-fill-success-light-hover |
| warningLight | orange100 | #FFF3D5 | orange200 | #FFE4AB | --af-fill-warning-light |
| warningLightHover | orange200 | #FFE4AB | orange100 | #FFF3D5 | --af-fill-warning-light-hover |
| errorLight | red100 | #FFD2DD | red200 | #FFA5B4 | --af-fill-error-light |
| errorLightHover | red200 | #FFA5B4 | red100 | #FFD2DD | --af-fill-error-light-hover |
| errorThick | red600 | #E71D32 | red500 | #F33641 | --af-fill-error-thick |
| errorThickHover | red700 | #AD1625 | red400 | #FF5050 | --af-fill-error-thick-hover |
| errorSelect | redAlphaRed50010 | #F336411A | redAlphaRed50010 | #F336411A | --af-fill-error-select |
| featuredLight | purple100 | #F1E0FF | purple200 | #E1B3FF | --af-fill-featured-light |
| featuredLightHover | purple200 | #E1B3FF | purple100 | #F1E0FF | --af-fill-featured-light-hover |
| featuredThick | purple500 | #9327FF | purple500 | #9327FF | --af-fill-featured-thick |
| featuredThickHover | purple600 | #7A1DCC | purple400 | #BC58FF | --af-fill-featured-thick-hover |

**surfaceColorScheme** (`AppFlowySurfaceColorScheme`, 13)

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| primary | neutralWhite | #FFFFFF | neutral900 | #272930 | --af-surface-primary |
| primaryHover | neutral100 | #F8FAFF | neutral800 | #3D404F | --af-surface-primary-hover |
| layer01 | neutralWhite | #FFFFFF | neutral900 | #272930 | --af-surface-layer-01 |
| layer01Hover | neutral100 | #F8FAFF | neutral800 | #3D404F | --af-surface-layer-01-hover |
| layer02 | neutralWhite | #FFFFFF | neutral850 | #32343F | --af-surface-layer-02 |
| layer02Hover | neutral100 | #F8FAFF | neutral800 | #3D404F | --af-surface-layer-02-hover |
| layer03 | neutralWhite | #FFFFFF | neutral850 | #32343F | --af-surface-layer-03 |
| layer03Hover | neutral100 | #F8FAFF | neutral800 | #3D404F | --af-surface-layer-03-hover |
| layer04 | neutralWhite | #FFFFFF | neutral830 | #363845 | --af-surface-layer-04 |
| layer04Hover | neutral100 | #F8FAFF | neutral800 | #3D404F | --af-surface-layer-04-hover |
| inverse | neutral1000 | #21232A | neutral800 | #3D404F | --af-surface-inverse |
| secondary | neutral1000 | #21232A | neutral800 | #3D404F | --af-surface-secondary |
| overlay | neutralAlphaBlack60 | #00000099 | neutralAlphaBlack60 | #00000099 | --af-surface-overlay |

**surfaceContainerColorScheme** (`AppFlowySurfaceContainerColorScheme`, 3)

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| layer01 | neutral100 | #F8FAFF | neutral900 | #272930 | --af-surface-container-layer-01 |
| layer02 | neutral200 | #E4E8F5 | neutral800 | #3D404F | --af-surface-container-layer-02 |
| layer03 | neutral300 | #CED3E6 | neutral700 | #54596E | --af-surface-container-layer-03 |

**backgroundColorScheme** (`AppFlowyBackgroundColorScheme`, 1)

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| primary | neutralWhite | #FFFFFF | neutral1000 | #21232A | --af-background-primary |

**brandColorScheme** (`AppFlowyBrandColorScheme`, 9). These are hard-coded `Color(0x..)` literals, not primitive references. Light and dark are identical.

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| skyline | literal (= blue500) | #00B5FF | literal | #00B5FF | --af-brand-skyline |
| aqua | literal | #00C8FF | literal | #00C8FF | --af-brand-aqua |
| violet | literal (= purple500) | #9327FF | literal | #9327FF | --af-brand-violet |
| amethyst | literal | #8427E0 | literal | #8427E0 | --af-brand-amethyst |
| berry | literal | #E3006D | literal | #E3006D | --af-brand-berry |
| coral | literal (= magenta500) | #FB006D | literal | #FB006D | --af-brand-coral |
| golden | literal | #F7931E | literal | #F7931E | --af-brand-golden |
| amber | literal | #FFBD00 | literal | #FFBD00 | --af-brand-amber |
| lemon | literal (= yellow500) | #FFCE00 | literal | #FFCE00 | --af-brand-lemon |

**otherColorsColorScheme** (`AppFlowyOtherColorsColorScheme`, 1)

| field | light primitive | light hex | dark primitive | dark hex | CSS var |
|---|---|---|---|---|---|
| textHighlight | blue200 | #A9E2FF | blue200 | #A9E2FF | --af-other-text-highlight |

**badgeColorScheme** (`AppFlowyBadgeColorScheme`, 120 = 20 colors x 6 shades). Fields are `color{N}{Light1|Light2|Light3|Thick1|Thick2|Thick3}`, N = 1..20. The mapping is strict and was checked for all 120 in both themes: `color{N}Light1/2/3` = `subtleColor<Family_N>100/200/300` and `color{N}Thick1/2/3` = `subtleColor<Family_N>400/500/600`. Dark uses the same primitives as light (semantic.dart lines 435-556 vs 148-269), so the hex is the same in both themes. CSS var: `--af-badge-color-{N}-{light|thick}-{1|2|3}`, for example `color13Thick2` -> `--af-badge-color-13-thick-2`.

| N | family | Light1 | Light2 | Light3 | Thick1 | Thick2 | Thick3 |
|---|---|---|---|---|---|---|---|
| 1 | Rose | #FCF2F2 | #FAE3E3 | #FAD9D9 | #EDADAD | #CC4E4E | #702828 |
| 2 | Papaya | #FCF4F0 | #FAE8DE | #FADFD2 | #F0BDA3 | #D67240 | #6B3215 |
| 3 | Tangerine | #FFF7ED | #FCEDD9 | #FAE5CA | #F2CB99 | #DB8F2C | #613B0A |
| 4 | Mango | #FFF9EC | #FCF1D7 | #FAE9C3 | #F5D68E | #E0A416 | #5C4102 |
| 5 | Lemon | #FFFBE8 | #FCF5CF | #FAEFB9 | #F5E282 | #E0BB00 | #574800 |
| 6 | Olive | #F9FAE6 | #F6F7D0 | #F0F2B3 | #DBDE83 | #ADB204 | #4A4C03 |
| 7 | Lime | #F6F9E6 | #EEF5CE | #E7F0BB | #CFDB91 | #92A822 | #414D05 |
| 8 | Grass | #F4FAEB | #E9F5D7 | #DEF0C5 | #BFD998 | #75A828 | #334D0C |
| 9 | Forest | #F1FAF0 | #E2F5DF | #D7F0D3 | #A8D6A1 | #49A33B | #1E4F16 |
| 10 | Jade | #F0FAF6 | #DFF5EB | #CEF0E1 | #90D1B5 | #1C9963 | #075231 |
| 11 | Aqua | #F0F9FA | #DFF3F5 | #CCECF0 | #83CCD4 | #008E9E | #004E57 |
| 12 | Azure | #F0F6FA | #E1EEF7 | #D3E6F5 | #88C0EB | #0877CC | #154469 |
| 13 | Denim | #F0F3FA | #E3EBFA | #D7E2F7 | #9AB6ED | #3267D1 | #223C70 |
| 14 | Mauve | #F2F2FC | #E6E6FA | #DCDCF7 | #AEAEF5 | #5555E0 | #36366B |
| 15 | Lavender | #F6F3FC | #EBE3FA | #E4DAF7 | #C1AAF0 | #8153DB | #462F75 |
| 16 | Lilac | #F7F0FA | #F0E1F7 | #EDD7F7 | #D3A9E8 | #9E4CC7 | #562D6B |
| 17 | Mallow | #FAF0FA | #F5E1F4 | #F5D7F4 | #DEA4DC | #B240AF | #632861 |
| 18 | Camellia | #F9EFF3 | #F7E1EB | #F7D7E5 | #E5A3C0 | #C24279 | #6E2343 |
| 19 | Smoke | #F5F5F5 | #E8E8E8 | #DEDEDE | #B8B8B8 | #6E6E6E | #404040 |
| 20 | Iron | #F2F4F7 | #E6E9F0 | #DADEE5 | #B0B5BF | #666F80 | #394152 |

Asymmetries to keep as-is (they are in the source, not mistakes in this spec):
- Dark `border.themeThickHover` and `fill.themeThickHover` use blue600, which is darker. Every other dark `*ThickHover` uses the lighter 400 step.
- Dark `*LightHover` fills are lighter than their base (for example infoLight blue200 -> hover blue100).
- `fill.content` is fully transparent white. `contentHover` and `contentVisible` are the same in each theme.
- Dark `text.quaternary` / `icon.quaternary` are #21232A, the same as dark `background.primary`.

#### A.7.3 Spacing / radius / shadow

Spacing and radius come from data/shared.dart and are the same in light and dark. The JSON also defines `spacing-0`/`border-radius-0` = 0px and `spacing-full`/`border-radius-full` = 1000px, but the Dart classes do not expose them; they are included in CSS as optional extras.

| token | Dart | constant | px | CSS var | approx. app usages (grep) |
|---|---|---|---|---|---|
| spacing xs | `theme.spacing.xs` | spacing100 | 4 | --af-spacing-xs | 54 |
| spacing s | `theme.spacing.s` | spacing200 | 6 | --af-spacing-s | 50 |
| spacing m | `theme.spacing.m` | spacing300 | 8 | --af-spacing-m | 96 |
| spacing l | `theme.spacing.l` | spacing400 | 12 | --af-spacing-l | 74 |
| spacing xl | `theme.spacing.xl` | spacing500 | 16 | --af-spacing-xl | 31 |
| spacing xxl | `theme.spacing.xxl` | spacing600 | 20 | --af-spacing-xxl | 24 |
| radius xs | `theme.borderRadius.xs` | radius100 | 4 | --af-radius-xs | 1 |
| radius s | `theme.borderRadius.s` | radius200 | 6 | --af-radius-s | 5 |
| radius m | `theme.borderRadius.m` | radius300 | 8 | --af-radius-m | 23 |
| radius l | `theme.borderRadius.l` | radius400 | 12 | --af-radius-l | 7 |
| radius xl | `theme.borderRadius.xl` | radius500 | 16 | --af-radius-xl | 7 |
| radius xxl | `theme.borderRadius.xxl` | radius600 | 20 | --af-radius-xxl | 0 |

Usage: `BorderRadius.circular(theme.borderRadius.m)`, `EdgeInsets.all(theme.spacing.l)`.

Shadows (`AppFlowySharedTokens.buildShadow(Brightness)`). Each is a single BoxShadow with spreadRadius 0 and BlurStyle.normal.

| token | theme | color (Flutter) | color CSS | offset (x,y) | blurRadius | spread | CSS box-shadow (design literal) |
|---|---|---|---|---|---|---|---|
| shadow.small | light | 0x1F000000 | #0000001F (rgba(0,0,0,0.122)) | 0, 2 | 16 | 0 | `0 2px 16px 0 #0000001F` |
| shadow.medium | light | 0x1F000000 | #0000001F | 0, 4 | 32 | 0 | `0 4px 32px 0 #0000001F` |
| shadow.small | dark | 0x7A000000 | #0000007A (rgba(0,0,0,0.478)) | 0, 2 | 16 | 0 | `0 2px 16px 0 #0000007A` |
| shadow.medium | dark | 0x7A000000 | #0000007A | 0, 4 | 32 | 0 | `0 4px 32px 0 #0000007A` |

AMBIGUOUS: Flutter turns blurRadius into a Gaussian sigma with `r*0.57735+0.5`, while CSS uses sigma = blur/2. A pixel-identical CSS blur is therefore about 19.5px for 16 and 38px for 32. The CSS in A.7.7 uses the pixel-parity values and keeps the design literals in comments. Usage: `BoxDecoration(boxShadow: theme.shadow.medium)` (popovers and menus) and `ShapeDecoration(shadows: theme.shadow.small)`. Approx. usages: small 8, medium 6.

#### A.7.4 Typography

Structure: `theme.textStyle.<group>.<variant>({String? family, Color? color, FontWeight? weight})` returns a Flutter `TextStyle`. There are 8 groups x 4 variants. Every variant uses the same size and line-height within its group; only the weight and decoration change. Arguments override family, color and weight.

| group | Dart class | font-size px | Flutter `height` | CSS line-height | standard | enhanced | prominent | underline | approx. usages (std/enh/prom/ul) |
|---|---|---|---|---|---|---|---|---|---|
| heading1 | TextThemeHeading1 | 36 | 40/36 = 1.1111 | 40px | 400 | 600 | 700 | **700** + underline | 0/0/0/0 |
| heading2 | TextThemeHeading2 | 24 | 32/24 = 1.3333 | 32px | 400 | 600 | 700 | 400 + underline | 1/1/1/0 |
| heading3 | TextThemeHeading3 | 20 | 28/20 = 1.4 | 28px | 400 | 600 | 700 | 400 + underline | 2/3/1/0 |
| heading4 | TextThemeHeading4 | 16 | 22/16 = 1.375 | 22px | 400 | 600 | 700 | 400 + underline | 16/9/9/0 |
| headline | TextThemeHeadline | 24 | 36/24 = 1.5 | 36px | 400 | 500 | 700 | 400 + underline | 1/0/0/0 |
| title | TextThemeTitle | 20 | 28/20 = 1.4 | 28px | 400 | 500 | 700 | 400 + underline | 0/1/0/0 |
| body | TextThemeBody | 14 | 20/14 = 1.4286 | 20px | 400 | 500 | 700 | 400 + underline | 71/32/0/1 |
| caption | TextThemeCaption | 12 | 18/12 = 1.5 | 18px | 400 | 500 | 700 | 400 + underline | 34/11/0/3 |

Properties shared by every style (default_text_style.dart `_defaultTextStyle`):

| property | value | CSS equivalent |
|---|---|---|
| inherit | `false` (ignores DefaultTextStyle) | set all font properties explicitly |
| fontStyle | normal | `font-style: normal` |
| letterSpacing | not set, so 0 | `letter-spacing: normal` (0). This differs from the legacy Material theme `BaseAppearance.getFontStyle`, which uses 0.005 x fontSize |
| leadingDistribution | `TextLeadingDistribution.even` | CSS half-leading behaves the same, so `line-height: <px>` matches |
| textBaseline | alphabetic | default |
| decoration | none (underline variant: `TextDecoration.underline`) | `text-decoration: underline` |
| fontFamilyFallback | not set | n/a |
| color | `null` unless the caller passes `color:` | see AMBIGUOUS below |
| weights | `FontWeight.normal` = 400, `w500` = 500, `w600` = 600, `bold` / `w700` = 700 | numeric font-weight |

Font family:
- `AppFlowyBaseTextStyle.customFontFamily(fontFamily)` passes the same family to all 8 groups. The const default constructor uses `''`. The builder calls `customFontFamily(fontFamily ?? '')`.
- The app passes `state.font.orDefault(defaultFontFamily).fontFamilyName` (app_widget.dart:250-252):
  - `defaultFontFamily = ''` (lib/workspace/application/settings/appearance/base_appearance.dart:11).
  - The Rust default is `APPEARANCE_DEFAULT_FONT = ""`, meaning system default (rust-lib/flowy-user/src/entities/user_setting.rs:131).
  - `fontFamilyName` (lib/util/font_family_extension.dart:20) returns `''` for the default font. Otherwise it returns `getGoogleFontSafely(font).fontFamily` (lib/shared/google_fonts_extension.dart), which uses `GoogleFonts.getFont(name)`, or null -> `''` if the font is unknown.
  - The user picks the font in Settings > Appearance > Font family, which calls `AppearanceSettingsCubit.setFontFamily`.
- AMBIGUOUS: a `''` family falls back to the Flutter engine's platform default (on Windows normally "Segoe UI"; macOS uses the system UI font; Linux uses the fontconfig default). Suggested CSS: `system-ui, "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`.
- AMBIGUOUS: for a Google font, the family is the google_fonts runtime id, for example `Poppins_regular`, which is the regular face only. Non-400 weights in AppFlowyTheme styles may then be synthesized. In Electron, load the real family with all weights. This is a slight visual difference and is acceptable.
- AMBIGUOUS: styles carry `color: null` with `inherit: false`, so Flutter falls back to the engine default paint color. In practice the app almost always passes `color: theme.textColorScheme.*`. In CSS, default to `color: var(--af-text-primary)` and let callers override.

Text scale: `MediaQuery.textScaler = TextScaler.linear(state.textScaleFactor)` (app_widget.dart:263). The value is persisted under KV key `textScaleFactor` and clamped to 0.7-1.0 (appearance_cubit.dart:77-95). It scales the font size, and the line height scales with it because `height` is a multiplier. In CSS, this is the `--af-text-scale` multiplier in A.7.7.

#### A.7.5 Theme variants & construction

| item | detail |
|---|---|
| Abstract builder | `AppFlowyThemeBuilder { AppFlowyThemeData light({String? fontFamily}); AppFlowyThemeData dark({String? fontFamily}); }` (definition/theme_data.dart) |
| Built-in themes | Only **`AppFlowyDefaultTheme`** exists (data/appflowy_default/semantic.dart, re-exported by data/built_in_themes.dart), giving exactly 2 variants: `light()` and `dark()` |
| Construction (per variant) | `textStyle = AppFlowyBaseTextStyle.customFontFamily(fontFamily ?? '')`; `borderRadius = AppFlowySharedTokens.buildBorderRadius()`; `spacing = AppFlowySharedTokens.buildSpacing()`; `shadow = AppFlowySharedTokens.buildShadow(Brightness.light / .dark)`; then 10 color schemes built from `AppFlowyPrimitiveTokens.*` (brand uses literals); `return AppFlowyThemeData(...)` |
| Differences between light and dark | text, icon, border, fill, surface, surfaceContainer, background colors, and shadow alpha (0x1F vs 0x7A). Identical: badge, brand, other, spacing, radius, typography |
| `CustomTheme` | data/custom/custom_theme.dart: `const CustomTheme({required Map<String,dynamic> lightThemeJson, required Map<String,dynamic> darkThemeJson})`. **Both `light()` and `dark()` throw `UnimplementedError`.** It is not exported by theme.dart or appflowy_ui.dart and is never referenced in app code. It is a dead stub |
| Relation to flowy_infra `FlowyColorScheme` / `AppTheme` | **None.** AppFlowyTheme does not derive from FlowyColorScheme. The built-in color-scheme names in flowy_infra (`BuiltInTheme.defaultTheme`='Default', 'Dandelion', 'Lemonade', 'Lavender', in packages/flowy_infra/lib/theme.dart) and user-uploaded custom themes only change the Material `ThemeData` / `AFThemeExtension` (legacy layer). The AppFlowyTheme tokens depend only on **brightness** and **font family** |
| Generator | `dart run script/generate_theme.dart` in packages/appflowy_ui. It reads `script/Primitive.Mode 1.tokens.json` (13 groups: Neutral 20, Blue 12, Green 10, Purple 10, Magenta 10, Red 11, Orange 10, Yellow 10, Subtle_Color 120, Spacing 8, Border-Radius 8) and `script/Semantic.{Light,Dark} Mode.tokens.json` (groups Text, Icon, Border, Fill, Surface, Surface_Container, Background, Badge, Brand, Other_Colors, Spacing, Border_Radius). Hand-edited parts: shared.dart (spacing, radius, shadow) and text styles. For Electron, the JSON files can be compiled straight to CSS |
| Interpolation | `AppFlowyThemeData.lerp(begin, end, t)` runs `Color.lerp` on every field of the 10 color schemes. textStyle, borderRadius, spacing and shadow snap to `end` |
| Animation | `AnimatedAppFlowyTheme` (ImplicitlyAnimatedWidget) uses duration `kThemeAnimationDuration` = 200 ms and a linear curve. A light/dark switch cross-fades every color over 200 ms. CSS equivalent: `transition: color 200ms linear, background-color 200ms linear, border-color 200ms linear, fill 200ms linear` on themed elements (optional) |
| Equality | `AppFlowyThemeData` has no `==`. The builder creates a new instance on every MaterialApp builder run, so `updateShouldNotify` is always true. This does not matter for Electron |

#### A.7.6 Injection & usage

Injection, in lib/startup/tasks/app_widget.dart (`_ApplicationWidgetState`):

| line | code / behavior |
|---|---|
| 150 | `final themeBuilder = AppFlowyDefaultTheme();` (the only builder used anywhere in the app) |
| 239-243 | `MaterialApp.router(theme: state.lightTheme, darkTheme: state.darkTheme, themeMode: state.themeMode, ...)`. State comes from `AppearanceSettingsCubit` |
| 248-252 | inside `builder:` `final brightness = Theme.of(context).brightness; final fontFamily = state.font.orDefault(defaultFontFamily).fontFamilyName;` |
| 254-256 | `AnimatedAppFlowyTheme(data: brightness == Brightness.light ? themeBuilder.light(fontFamily: fontFamily) : themeBuilder.dark(fontFamily: fontFamily), child: MediaQuery(textScaler: TextScaler.linear(state.textScaleFactor), child: overlayManagerBuilder(context, CommandPalette(child) or child)))` |

The root wraps everything below MaterialApp, including the router, overlays and the command palette. No other `AppFlowyTheme(` or `AnimatedAppFlowyTheme(` exists in the app (the only other one is packages/appflowy_ui/example). `AppFlowyInheritedTheme` extends `InheritedTheme`, so `InheritedTheme.capture` carries it into overlays and popovers.

How the active variant is chosen:
1. `AppearanceSettingsPB.themeMode` (Light / Dark / System) is turned into Flutter `ThemeMode` by `_themeModeFromPB` (appearance_cubit.dart:308). The default is `ThemeMode.system` (lib/workspace/application/appearance_defaults.dart:8, `kDefaultThemeMode`). Setters: `setThemeMode`, `toggleThemeMode`, `resetThemeMode`.
2. MaterialApp resolves the brightness. For System, it follows the OS `platformBrightness`.
3. Brightness selects `light()` or `dark()`. The color-scheme name (`state.appTheme`, default "Default") is **not** consulted.

Electron equivalent: `resolved = mode === 'system' ? (nativeTheme.shouldUseDarkColors / matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;` then `document.documentElement.dataset.theme = resolved`. Listen for `nativeTheme.on('updated')` or the media-query `change` event when mode is system. Also set `--af-font-family` from the font setting and `--af-text-scale` from textScaleFactor.

Access API:

| API | behavior |
|---|---|
| `AppFlowyTheme.of(context, {listen = true})` | returns `AppFlowyThemeData`. Throws `FlutterError` if no ancestor. With listen=true, rebuilds on theme change |
| `AppFlowyTheme.maybeOf(context, {listen = true})` | nullable version (for example link_edit_menu.dart:56) |
| Common pattern | `final theme = AppFlowyTheme.of(context);` then `theme.<group>.<field>` |

Usage examples (real code):

```dart
// 1. Text: lib/workspace/presentation/home/menu/sidebar/space/shared_widget.dart:195
textStyle: theme.textStyle.body.standard(color: theme.textColorScheme.primary),
// CSS: .af-body-standard { color: var(--af-text-primary) }

// 2. Popover container: lib/ai/widgets/ai_prompt_modal/ai_prompt_database_modal.dart:249-256
decoration: BoxDecoration(
  color: theme.surfaceColorScheme.primary,
  borderRadius: BorderRadius.circular(theme.borderRadius.l),
  border: Border.all(color: theme.borderColorScheme.primary),
  boxShadow: theme.shadow.medium,
),
anchor: AFAnchor(offset: Offset(0, theme.spacing.xs)),
// CSS: background: var(--af-surface-primary); border-radius: var(--af-radius-l);
//      border: 1px solid var(--af-border-primary); box-shadow: var(--af-shadow-medium); margin-top: var(--af-spacing-xs)

// 3. Card / preview: lib/ai/widgets/ai_prompt_modal/ai_prompt_preview.dart:106-116
padding: EdgeInsets.all(theme.spacing.l),
decoration: BoxDecoration(
  color: theme.surfaceContainerColorScheme.layer01,
  borderRadius: BorderRadius.circular(theme.borderRadius.m),
),
style: theme.textStyle.body.standard(color: theme.textColorScheme.primary),

// 4. Hover row: lib/ai/widgets/ai_prompt_modal/ai_prompt_category_list.dart:132
return theme.fillColorScheme.contentHover;   // background on hover; idle = fillColorScheme.content (transparent)
// CSS: .row { background: var(--af-fill-content) } .row:hover { background: var(--af-fill-content-hover) }

// 5. Avatar badge (packages/appflowy_ui/lib/src/component/avatar/avatar.dart:172-240)
// index = (abs(hash) % 20) + 1 where hash = codeUnit + ((hash << 5) - hash) over the name (Dart 64-bit int;
// use BigInt.asIntN(64, ...) in JS for an identical index); null/empty name -> 1
// bg = badgeColorScheme.color{index}Light2, initial text = color{index}Thick3
// avatar text style by size: xs caption.standard, s body.standard, m heading4.standard, l heading3.standard, xl heading2.standard
```

Most-used fields (grep hits in lib/ + packages/appflowy_ui/lib, so build these first):

| field | hits | field | hits |
|---|---|---|---|
| textColorScheme.primary | 139 | textColorScheme.onFill | 19 |
| textColorScheme.secondary | 91 | textColorScheme.error | 16 |
| borderColorScheme.primary | 33 | surfaceColorScheme.primary | 16 |
| textColorScheme.tertiary | 32 | fillColorScheme.themeSelect | 14 |
| fillColorScheme.contentHover | 30 | fillColorScheme.errorThick | 13 |
| fillColorScheme.content | 23 | textColorScheme.action / iconColorScheme.tertiary / fillColorScheme.themeThick / borderColorScheme.primaryHover | 10 each |
| iconColorScheme.secondary | 22 | borderColorScheme.themeThick | 9 |
| iconColorScheme.primary | 20 | fillColorScheme.errorThickHover | 7 |

Text styles by usage: body.standard 71, caption.standard 34, body.enhanced 32, heading4.standard 16, caption.enhanced 11, heading4.prominent 9, heading4.enhanced 9; everything else 3 or fewer.

#### A.7.7 CSS variables (copy-paste)

Contents: all 230 semantic colors, spacing, radius, shadows and typography. Theme-independent tokens (badge, brand, other, spacing, radius, type) live in `:root` only. Set `<html data-theme="light|dark">` from JS (see A.7.6).

```css
/* ==== AppFlowyTheme tokens: appflowy_ui AppFlowyDefaultTheme ==== */
:root,
[data-theme="light"] {
  color-scheme: light;

  /* textColorScheme */
  --af-text-primary: #21232A;
  --af-text-secondary: #6F748C;
  --af-text-tertiary: #989EB7;
  --af-text-quaternary: #E4E8F5;
  --af-text-on-fill: #FFFFFF;
  --af-text-action: #0092D6;
  --af-text-action-hover: #0078C0;
  --af-text-info: #0092D6;
  --af-text-info-hover: #0078C0;
  --af-text-success: #248569;
  --af-text-success-hover: #29725D;
  --af-text-warning: #DB7E21;
  --af-text-warning-hover: #B75F17;
  --af-text-error: #E71D32;
  --af-text-error-hover: #AD1625;
  --af-text-featured: #9327FF;
  --af-text-featured-hover: #7A1DCC;

  /* iconColorScheme */
  --af-icon-primary: #21232A;
  --af-icon-secondary: #6F748C;
  --af-icon-tertiary: #B5BBD3;
  --af-icon-quaternary: #E4E8F5;
  --af-icon-info-thick: #0092D6;
  --af-icon-info-thick-hover: #0078C0;
  --af-icon-success-thick: #248569;
  --af-icon-success-thick-hover: #29725D;
  --af-icon-warning-thick: #DB7E21;
  --af-icon-warning-thick-hover: #B75F17;
  --af-icon-error-thick: #E71D32;
  --af-icon-error-thick-hover: #AD1625;
  --af-icon-featured-thick: #9327FF;
  --af-icon-featured-thick-hover: #7A1DCC;
  --af-icon-on-fill: #FFFFFF;

  /* borderColorScheme */
  --af-border-primary: #E4E8F5;
  --af-border-primary-hover: #CED3E6;
  --af-border-secondary: #3D404F;
  --af-border-secondary-hover: #54596E;
  --af-border-tertiary: #21232A;
  --af-border-tertiary-hover: #272930;
  --af-border-theme-thick: #00B5FF;
  --af-border-theme-thick-hover: #0092D6;
  --af-border-info-thick: #00B5FF;
  --af-border-info-thick-hover: #0092D6;
  --af-border-success-thick: #248569;
  --af-border-success-thick-hover: #29725D;
  --af-border-warning-thick: #DB7E21;
  --af-border-warning-thick-hover: #B75F17;
  --af-border-error-thick: #E71D32;
  --af-border-error-thick-hover: #AD1625;
  --af-border-featured-thick: #9327FF;
  --af-border-featured-thick-hover: #7A1DCC;

  /* fillColorScheme */
  --af-fill-primary: #F8FAFF;
  --af-fill-primary-hover: #E4E8F5;
  --af-fill-secondary: #CED3E6;
  --af-fill-secondary-hover: #B5BBD3;
  --af-fill-tertiary: #6F748C;
  --af-fill-tertiary-hover: #989EB7;
  --af-fill-quaternary: #21232A;
  --af-fill-quaternary-hover: #272930;
  --af-fill-content: #FFFFFF00;
  --af-fill-content-hover: #1F23290D;
  --af-fill-content-visible: #1F23290D;
  --af-fill-content-visible-hover: #1F23291A;
  --af-fill-theme-thick: #00B5FF;
  --af-fill-theme-thick-hover: #0092D6;
  --af-fill-theme-select: #00B5FF26;
  --af-fill-text-select: #00B5FF33;
  --af-fill-info-light: #E3F6FF;
  --af-fill-info-light-hover: #A9E2FF;
  --af-fill-info-thick: #00B5FF;
  --af-fill-info-thick-hover: #0092D6;
  --af-fill-success-light: #ECF9F5;
  --af-fill-success-light-hover: #C3E5D8;
  --af-fill-warning-light: #FFF3D5;
  --af-fill-warning-light-hover: #FFE4AB;
  --af-fill-error-light: #FFD2DD;
  --af-fill-error-light-hover: #FFA5B4;
  --af-fill-error-thick: #E71D32;
  --af-fill-error-thick-hover: #AD1625;
  --af-fill-error-select: #F336411A;
  --af-fill-featured-light: #F1E0FF;
  --af-fill-featured-light-hover: #E1B3FF;
  --af-fill-featured-thick: #9327FF;
  --af-fill-featured-thick-hover: #7A1DCC;

  /* surfaceColorScheme */
  --af-surface-primary: #FFFFFF;
  --af-surface-primary-hover: #F8FAFF;
  --af-surface-layer-01: #FFFFFF;
  --af-surface-layer-01-hover: #F8FAFF;
  --af-surface-layer-02: #FFFFFF;
  --af-surface-layer-02-hover: #F8FAFF;
  --af-surface-layer-03: #FFFFFF;
  --af-surface-layer-03-hover: #F8FAFF;
  --af-surface-layer-04: #FFFFFF;
  --af-surface-layer-04-hover: #F8FAFF;
  --af-surface-inverse: #21232A;
  --af-surface-secondary: #21232A;
  --af-surface-overlay: #00000099;

  /* surfaceContainerColorScheme */
  --af-surface-container-layer-01: #F8FAFF;
  --af-surface-container-layer-02: #E4E8F5;
  --af-surface-container-layer-03: #CED3E6;

  /* backgroundColorScheme */
  --af-background-primary: #FFFFFF;

  /* shadow (light): Flutter BoxShadow(offset, blurRadius 16/32, color 0x1F000000).
     Pixel-parity blur (Flutter sigma = r*0.57735+0.5 -> CSS blur = 2*sigma). Design literal: 16px / 32px */
  --af-shadow-small: 0 2px 19.5px 0 #0000001F;   /* literal: 0 2px 16px 0 #0000001F */
  --af-shadow-medium: 0 4px 38px 0 #0000001F;    /* literal: 0 4px 32px 0 #0000001F */
}

:root {
  /* ---- theme-independent tokens ---- */

  /* brandColorScheme */
  --af-brand-skyline: #00B5FF;
  --af-brand-aqua: #00C8FF;
  --af-brand-violet: #9327FF;
  --af-brand-amethyst: #8427E0;
  --af-brand-berry: #E3006D;
  --af-brand-coral: #FB006D;
  --af-brand-golden: #F7931E;
  --af-brand-amber: #FFBD00;
  --af-brand-lemon: #FFCE00;

  /* otherColorsColorScheme */
  --af-other-text-highlight: #A9E2FF;

  /* badgeColorScheme: color{N}{Light1..3,Thick1..3} */
  --af-badge-color-1-light-1: #FCF2F2;
  --af-badge-color-1-light-2: #FAE3E3;
  --af-badge-color-1-light-3: #FAD9D9;
  --af-badge-color-1-thick-1: #EDADAD;
  --af-badge-color-1-thick-2: #CC4E4E;
  --af-badge-color-1-thick-3: #702828;
  --af-badge-color-2-light-1: #FCF4F0;
  --af-badge-color-2-light-2: #FAE8DE;
  --af-badge-color-2-light-3: #FADFD2;
  --af-badge-color-2-thick-1: #F0BDA3;
  --af-badge-color-2-thick-2: #D67240;
  --af-badge-color-2-thick-3: #6B3215;
  --af-badge-color-3-light-1: #FFF7ED;
  --af-badge-color-3-light-2: #FCEDD9;
  --af-badge-color-3-light-3: #FAE5CA;
  --af-badge-color-3-thick-1: #F2CB99;
  --af-badge-color-3-thick-2: #DB8F2C;
  --af-badge-color-3-thick-3: #613B0A;
  --af-badge-color-4-light-1: #FFF9EC;
  --af-badge-color-4-light-2: #FCF1D7;
  --af-badge-color-4-light-3: #FAE9C3;
  --af-badge-color-4-thick-1: #F5D68E;
  --af-badge-color-4-thick-2: #E0A416;
  --af-badge-color-4-thick-3: #5C4102;
  --af-badge-color-5-light-1: #FFFBE8;
  --af-badge-color-5-light-2: #FCF5CF;
  --af-badge-color-5-light-3: #FAEFB9;
  --af-badge-color-5-thick-1: #F5E282;
  --af-badge-color-5-thick-2: #E0BB00;
  --af-badge-color-5-thick-3: #574800;
  --af-badge-color-6-light-1: #F9FAE6;
  --af-badge-color-6-light-2: #F6F7D0;
  --af-badge-color-6-light-3: #F0F2B3;
  --af-badge-color-6-thick-1: #DBDE83;
  --af-badge-color-6-thick-2: #ADB204;
  --af-badge-color-6-thick-3: #4A4C03;
  --af-badge-color-7-light-1: #F6F9E6;
  --af-badge-color-7-light-2: #EEF5CE;
  --af-badge-color-7-light-3: #E7F0BB;
  --af-badge-color-7-thick-1: #CFDB91;
  --af-badge-color-7-thick-2: #92A822;
  --af-badge-color-7-thick-3: #414D05;
  --af-badge-color-8-light-1: #F4FAEB;
  --af-badge-color-8-light-2: #E9F5D7;
  --af-badge-color-8-light-3: #DEF0C5;
  --af-badge-color-8-thick-1: #BFD998;
  --af-badge-color-8-thick-2: #75A828;
  --af-badge-color-8-thick-3: #334D0C;
  --af-badge-color-9-light-1: #F1FAF0;
  --af-badge-color-9-light-2: #E2F5DF;
  --af-badge-color-9-light-3: #D7F0D3;
  --af-badge-color-9-thick-1: #A8D6A1;
  --af-badge-color-9-thick-2: #49A33B;
  --af-badge-color-9-thick-3: #1E4F16;
  --af-badge-color-10-light-1: #F0FAF6;
  --af-badge-color-10-light-2: #DFF5EB;
  --af-badge-color-10-light-3: #CEF0E1;
  --af-badge-color-10-thick-1: #90D1B5;
  --af-badge-color-10-thick-2: #1C9963;
  --af-badge-color-10-thick-3: #075231;
  --af-badge-color-11-light-1: #F0F9FA;
  --af-badge-color-11-light-2: #DFF3F5;
  --af-badge-color-11-light-3: #CCECF0;
  --af-badge-color-11-thick-1: #83CCD4;
  --af-badge-color-11-thick-2: #008E9E;
  --af-badge-color-11-thick-3: #004E57;
  --af-badge-color-12-light-1: #F0F6FA;
  --af-badge-color-12-light-2: #E1EEF7;
  --af-badge-color-12-light-3: #D3E6F5;
  --af-badge-color-12-thick-1: #88C0EB;
  --af-badge-color-12-thick-2: #0877CC;
  --af-badge-color-12-thick-3: #154469;
  --af-badge-color-13-light-1: #F0F3FA;
  --af-badge-color-13-light-2: #E3EBFA;
  --af-badge-color-13-light-3: #D7E2F7;
  --af-badge-color-13-thick-1: #9AB6ED;
  --af-badge-color-13-thick-2: #3267D1;
  --af-badge-color-13-thick-3: #223C70;
  --af-badge-color-14-light-1: #F2F2FC;
  --af-badge-color-14-light-2: #E6E6FA;
  --af-badge-color-14-light-3: #DCDCF7;
  --af-badge-color-14-thick-1: #AEAEF5;
  --af-badge-color-14-thick-2: #5555E0;
  --af-badge-color-14-thick-3: #36366B;
  --af-badge-color-15-light-1: #F6F3FC;
  --af-badge-color-15-light-2: #EBE3FA;
  --af-badge-color-15-light-3: #E4DAF7;
  --af-badge-color-15-thick-1: #C1AAF0;
  --af-badge-color-15-thick-2: #8153DB;
  --af-badge-color-15-thick-3: #462F75;
  --af-badge-color-16-light-1: #F7F0FA;
  --af-badge-color-16-light-2: #F0E1F7;
  --af-badge-color-16-light-3: #EDD7F7;
  --af-badge-color-16-thick-1: #D3A9E8;
  --af-badge-color-16-thick-2: #9E4CC7;
  --af-badge-color-16-thick-3: #562D6B;
  --af-badge-color-17-light-1: #FAF0FA;
  --af-badge-color-17-light-2: #F5E1F4;
  --af-badge-color-17-light-3: #F5D7F4;
  --af-badge-color-17-thick-1: #DEA4DC;
  --af-badge-color-17-thick-2: #B240AF;
  --af-badge-color-17-thick-3: #632861;
  --af-badge-color-18-light-1: #F9EFF3;
  --af-badge-color-18-light-2: #F7E1EB;
  --af-badge-color-18-light-3: #F7D7E5;
  --af-badge-color-18-thick-1: #E5A3C0;
  --af-badge-color-18-thick-2: #C24279;
  --af-badge-color-18-thick-3: #6E2343;
  --af-badge-color-19-light-1: #F5F5F5;
  --af-badge-color-19-light-2: #E8E8E8;
  --af-badge-color-19-light-3: #DEDEDE;
  --af-badge-color-19-thick-1: #B8B8B8;
  --af-badge-color-19-thick-2: #6E6E6E;
  --af-badge-color-19-thick-3: #404040;
  --af-badge-color-20-light-1: #F2F4F7;
  --af-badge-color-20-light-2: #E6E9F0;
  --af-badge-color-20-light-3: #DADEE5;
  --af-badge-color-20-thick-1: #B0B5BF;
  --af-badge-color-20-thick-2: #666F80;
  --af-badge-color-20-thick-3: #394152;

  /* spacing (AppFlowySpacing) */
  --af-spacing-0: 0px;       /* JSON only, not in Dart */
  --af-spacing-xs: 4px;
  --af-spacing-s: 6px;
  --af-spacing-m: 8px;
  --af-spacing-l: 12px;
  --af-spacing-xl: 16px;
  --af-spacing-xxl: 20px;
  --af-spacing-full: 1000px; /* JSON only, not in Dart */

  /* border radius (AppFlowyBorderRadius) */
  --af-radius-0: 0px;        /* JSON only */
  --af-radius-xs: 4px;
  --af-radius-s: 6px;
  --af-radius-m: 8px;
  --af-radius-l: 12px;
  --af-radius-xl: 16px;
  --af-radius-xxl: 20px;
  --af-radius-full: 1000px;  /* JSON only */

  /* typography (AppFlowyBaseTextStyle) */
  --af-text-scale: 1;        /* = AppearanceSettingsState.textScaleFactor, clamp 0.7..1.0 */
  --af-font-family: system-ui, "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
                             /* override with the user-selected font (AppearanceSettingsPB.font) when non-empty */
  --af-fs-heading1: calc(36px * var(--af-text-scale)); --af-lh-heading1: calc(40px * var(--af-text-scale));
  --af-fs-heading2: calc(24px * var(--af-text-scale)); --af-lh-heading2: calc(32px * var(--af-text-scale));
  --af-fs-heading3: calc(20px * var(--af-text-scale)); --af-lh-heading3: calc(28px * var(--af-text-scale));
  --af-fs-heading4: calc(16px * var(--af-text-scale)); --af-lh-heading4: calc(22px * var(--af-text-scale));
  --af-fs-headline: calc(24px * var(--af-text-scale)); --af-lh-headline: calc(36px * var(--af-text-scale));
  --af-fs-title:    calc(20px * var(--af-text-scale)); --af-lh-title:    calc(28px * var(--af-text-scale));
  --af-fs-body:     calc(14px * var(--af-text-scale)); --af-lh-body:     calc(20px * var(--af-text-scale));
  --af-fs-caption:  calc(12px * var(--af-text-scale)); --af-lh-caption:  calc(18px * var(--af-text-scale));

  /* theme switch animation (AnimatedAppFlowyTheme: 200ms linear) */
  --af-theme-transition: 200ms linear;
}

[data-theme="dark"] {
  color-scheme: dark;

  /* textColorScheme */
  --af-text-primary: #E4E8F5;
  --af-text-secondary: #989EB7;
  --af-text-tertiary: #6F748C;
  --af-text-quaternary: #21232A;
  --af-text-on-fill: #FFFFFF;
  --af-text-action: #00B5FF;
  --af-text-action-hover: #4EC1FF;
  --af-text-info: #00B5FF;
  --af-text-info-hover: #4EC1FF;
  --af-text-success: #248569;
  --af-text-success-hover: #48A982;
  --af-text-warning: #DB7E21;
  --af-text-warning-hover: #FFA02E;
  --af-text-error: #F33641;
  --af-text-error-hover: #FF5050;
  --af-text-featured: #9327FF;
  --af-text-featured-hover: #BC58FF;

  /* iconColorScheme */
  --af-icon-primary: #E4E8F5;
  --af-icon-secondary: #B5BBD3;
  --af-icon-tertiary: #6F748C;
  --af-icon-quaternary: #21232A;
  --af-icon-info-thick: #00B5FF;
  --af-icon-info-thick-hover: #4EC1FF;
  --af-icon-success-thick: #248569;
  --af-icon-success-thick-hover: #48A982;
  --af-icon-warning-thick: #DB7E21;
  --af-icon-warning-thick-hover: #FFA02E;
  --af-icon-error-thick: #F33641;
  --af-icon-error-thick-hover: #FF5050;
  --af-icon-featured-thick: #9327FF;
  --af-icon-featured-thick-hover: #BC58FF;
  --af-icon-on-fill: #FFFFFF;

  /* borderColorScheme */
  --af-border-primary: #3D404F;
  --af-border-primary-hover: #54596E;
  --af-border-secondary: #CED3E6;
  --af-border-secondary-hover: #E4E8F5;
  --af-border-tertiary: #F8FAFF;
  --af-border-tertiary-hover: #FFFFFF;
  --af-border-theme-thick: #00B5FF;
  --af-border-theme-thick-hover: #0092D6;
  --af-border-info-thick: #00B5FF;
  --af-border-info-thick-hover: #4EC1FF;
  --af-border-success-thick: #248569;
  --af-border-success-thick-hover: #48A982;
  --af-border-warning-thick: #DB7E21;
  --af-border-warning-thick-hover: #FFA02E;
  --af-border-error-thick: #F33641;
  --af-border-error-thick-hover: #FF5050;
  --af-border-featured-thick: #9327FF;
  --af-border-featured-thick-hover: #BC58FF;

  /* fillColorScheme */
  --af-fill-primary: #272930;
  --af-fill-primary-hover: #3D404F;
  --af-fill-secondary: #6F748C;
  --af-fill-secondary-hover: #989EB7;
  --af-fill-tertiary: #CED3E6;
  --af-fill-tertiary-hover: #E4E8F5;
  --af-fill-quaternary: #F8FAFF;
  --af-fill-quaternary-hover: #FFFFFF;
  --af-fill-content: #FFFFFF00;
  --af-fill-content-hover: #F9FAFD0D;
  --af-fill-content-visible: #F9FAFD0D;
  --af-fill-content-visible-hover: #F9FAFD1A;
  --af-fill-theme-thick: #00B5FF;
  --af-fill-theme-thick-hover: #0092D6;
  --af-fill-theme-select: #00B5FF26;
  --af-fill-text-select: #00B5FF33;
  --af-fill-info-light: #A9E2FF;
  --af-fill-info-light-hover: #E3F6FF;
  --af-fill-info-thick: #00B5FF;
  --af-fill-info-thick-hover: #4EC1FF;
  --af-fill-success-light: #C3E5D8;
  --af-fill-success-light-hover: #ECF9F5;
  --af-fill-warning-light: #FFE4AB;
  --af-fill-warning-light-hover: #FFF3D5;
  --af-fill-error-light: #FFA5B4;
  --af-fill-error-light-hover: #FFD2DD;
  --af-fill-error-thick: #F33641;
  --af-fill-error-thick-hover: #FF5050;
  --af-fill-error-select: #F336411A;
  --af-fill-featured-light: #E1B3FF;
  --af-fill-featured-light-hover: #F1E0FF;
  --af-fill-featured-thick: #9327FF;
  --af-fill-featured-thick-hover: #BC58FF;

  /* surfaceColorScheme */
  --af-surface-primary: #272930;
  --af-surface-primary-hover: #3D404F;
  --af-surface-layer-01: #272930;
  --af-surface-layer-01-hover: #3D404F;
  --af-surface-layer-02: #32343F;
  --af-surface-layer-02-hover: #3D404F;
  --af-surface-layer-03: #32343F;
  --af-surface-layer-03-hover: #3D404F;
  --af-surface-layer-04: #363845;
  --af-surface-layer-04-hover: #3D404F;
  --af-surface-inverse: #3D404F;
  --af-surface-secondary: #3D404F;
  --af-surface-overlay: #00000099;

  /* surfaceContainerColorScheme */
  --af-surface-container-layer-01: #272930;
  --af-surface-container-layer-02: #3D404F;
  --af-surface-container-layer-03: #54596E;

  /* backgroundColorScheme */
  --af-background-primary: #21232A;

  /* shadow (dark): color 0x7A000000 */
  --af-shadow-small: 0 2px 19.5px 0 #0000007A;   /* literal: 0 2px 16px 0 #0000007A */
  --af-shadow-medium: 0 4px 38px 0 #0000007A;    /* literal: 0 4px 32px 0 #0000007A */
}

/* ---- typography utility classes: textStyle.<group>.<variant>() ----
   every style: font-style normal, letter-spacing 0, no color (callers pass one; default to text-primary) */
.af-heading1-standard  { font: 400 var(--af-fs-heading1)/var(--af-lh-heading1) var(--af-font-family); letter-spacing: 0; }
.af-heading1-enhanced  { font: 600 var(--af-fs-heading1)/var(--af-lh-heading1) var(--af-font-family); letter-spacing: 0; }
.af-heading1-prominent { font: 700 var(--af-fs-heading1)/var(--af-lh-heading1) var(--af-font-family); letter-spacing: 0; }
.af-heading1-underline { font: 700 var(--af-fs-heading1)/var(--af-lh-heading1) var(--af-font-family); letter-spacing: 0; text-decoration: underline; }
.af-heading2-standard  { font: 400 var(--af-fs-heading2)/var(--af-lh-heading2) var(--af-font-family); letter-spacing: 0; }
.af-heading2-enhanced  { font: 600 var(--af-fs-heading2)/var(--af-lh-heading2) var(--af-font-family); letter-spacing: 0; }
.af-heading2-prominent { font: 700 var(--af-fs-heading2)/var(--af-lh-heading2) var(--af-font-family); letter-spacing: 0; }
.af-heading2-underline { font: 400 var(--af-fs-heading2)/var(--af-lh-heading2) var(--af-font-family); letter-spacing: 0; text-decoration: underline; }
.af-heading3-standard  { font: 400 var(--af-fs-heading3)/var(--af-lh-heading3) var(--af-font-family); letter-spacing: 0; }
.af-heading3-enhanced  { font: 600 var(--af-fs-heading3)/var(--af-lh-heading3) var(--af-font-family); letter-spacing: 0; }
.af-heading3-prominent { font: 700 var(--af-fs-heading3)/var(--af-lh-heading3) var(--af-font-family); letter-spacing: 0; }
.af-heading3-underline { font: 400 var(--af-fs-heading3)/var(--af-lh-heading3) var(--af-font-family); letter-spacing: 0; text-decoration: underline; }
.af-heading4-standard  { font: 400 var(--af-fs-heading4)/var(--af-lh-heading4) var(--af-font-family); letter-spacing: 0; }
.af-heading4-enhanced  { font: 600 var(--af-fs-heading4)/var(--af-lh-heading4) var(--af-font-family); letter-spacing: 0; }
.af-heading4-prominent { font: 700 var(--af-fs-heading4)/var(--af-lh-heading4) var(--af-font-family); letter-spacing: 0; }
.af-heading4-underline { font: 400 var(--af-fs-heading4)/var(--af-lh-heading4) var(--af-font-family); letter-spacing: 0; text-decoration: underline; }
.af-headline-standard  { font: 400 var(--af-fs-headline)/var(--af-lh-headline) var(--af-font-family); letter-spacing: 0; }
.af-headline-enhanced  { font: 500 var(--af-fs-headline)/var(--af-lh-headline) var(--af-font-family); letter-spacing: 0; }
.af-headline-prominent { font: 700 var(--af-fs-headline)/var(--af-lh-headline) var(--af-font-family); letter-spacing: 0; }
.af-headline-underline { font: 400 var(--af-fs-headline)/var(--af-lh-headline) var(--af-font-family); letter-spacing: 0; text-decoration: underline; }
.af-title-standard     { font: 400 var(--af-fs-title)/var(--af-lh-title) var(--af-font-family); letter-spacing: 0; }
.af-title-enhanced     { font: 500 var(--af-fs-title)/var(--af-lh-title) var(--af-font-family); letter-spacing: 0; }
.af-title-prominent    { font: 700 var(--af-fs-title)/var(--af-lh-title) var(--af-font-family); letter-spacing: 0; }
.af-title-underline    { font: 400 var(--af-fs-title)/var(--af-lh-title) var(--af-font-family); letter-spacing: 0; text-decoration: underline; }
.af-body-standard      { font: 400 var(--af-fs-body)/var(--af-lh-body) var(--af-font-family); letter-spacing: 0; }
.af-body-enhanced      { font: 500 var(--af-fs-body)/var(--af-lh-body) var(--af-font-family); letter-spacing: 0; }
.af-body-prominent     { font: 700 var(--af-fs-body)/var(--af-lh-body) var(--af-font-family); letter-spacing: 0; }
.af-body-underline     { font: 400 var(--af-fs-body)/var(--af-lh-body) var(--af-font-family); letter-spacing: 0; text-decoration: underline; }
.af-caption-standard   { font: 400 var(--af-fs-caption)/var(--af-lh-caption) var(--af-font-family); letter-spacing: 0; }
.af-caption-enhanced   { font: 500 var(--af-fs-caption)/var(--af-lh-caption) var(--af-font-family); letter-spacing: 0; }
.af-caption-prominent  { font: 700 var(--af-fs-caption)/var(--af-lh-caption) var(--af-font-family); letter-spacing: 0; }
.af-caption-underline  { font: 400 var(--af-fs-caption)/var(--af-lh-caption) var(--af-font-family); letter-spacing: 0; text-decoration: underline; }

/* optional: mimic AnimatedAppFlowyTheme 200ms linear color lerp on theme switch */
.af-themed {
  transition: color var(--af-theme-transition), background-color var(--af-theme-transition),
              border-color var(--af-theme-transition), fill var(--af-theme-transition), stroke var(--af-theme-transition);
}
```

CSS notes:
- `--af-fs-*` / `--af-lh-*` hold `calc()` against `--af-text-scale`. They are resolved on `:root`, so change `--af-text-scale` on `:root` only.
- Text selection inside AppFlowyTheme-styled widgets: `::selection { background: var(--af-fill-text-select); }`. Editor selection colors belong to the legacy theme/editor layer and are not covered here.
- Modal barrier: `background: var(--af-surface-overlay)` (rgba(0,0,0,0.6)) in both themes.

---

## B. Assets

All paths are relative to `D:\Projects\appflowy\frontend`. `appflowy_flutter/` is abbreviated `AF/`.
Versions are from `AF/pubspec.lock`: Flutter SDK 3.27.4 (local), easy_localization 3.0.7, google_fonts 6.2.1, flutter_svg 2.0.17, flutter_emoji_mart git `355aa56` (LucasXu0/emoji_mart), appflowy_editor git `470c4e7`.
Where a row describes how a library behaves rather than repo code, it says "(lib)". That behavior was checked against the package source in the local pub cache.

---

### B.1 Fonts

#### B.1.1 `fonts:` declarations

Only `AF/pubspec.yaml` declares fonts. None of the package pubspecs do: `packages/flowy_infra_ui` depends on `google_fonts: ^6.1.0` but declares no fonts, `packages/appflowy_backend` has only the commented template, and `appflowy_ui`, `flowy_infra`, `flowy_svg`, `appflowy_popover` and `appflowy_result` have no `fonts:` section.

| Family (pubspec) | Asset file (relative to `frontend/`) | weight | style |
|---|---|---|---|
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-ExtraLight.ttf` | 100 | normal |
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-Thin.ttf` | 200 | normal |
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-Light.ttf` | 300 | normal |
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-Regular.ttf` | 400 | normal |
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-Medium.ttf` | 500 | normal |
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-SemiBold.ttf` | 600 | normal |
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-Bold.ttf` | 700 | normal |
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-Black.ttf` | 800 | normal |
| `Poppins` | `AF/assets/google_fonts/Poppins/Poppins-ExtraBold.ttf` | 900 | normal |
| `RobotoMono` | `AF/assets/google_fonts/Roboto_Mono/RobotoMono-Regular.ttf` (87 KB, static) | 400 (default) | normal |
| `RobotoMono` | `AF/assets/google_fonts/Roboto_Mono/RobotoMono-Italic.ttf` (94 KB, static) | 400 (default) | italic |
| *(white-label slot)* | `# BEGIN: WHITE_LABEL_FONT` / `# END: WHITE_LABEL_FONT` markers. **Empty** in this checkout. | – | – |

Notes:
- The pubspec Poppins weights are swapped against the standard names: Thin should be 100 and ExtraLight 200, ExtraBold should be 800 and Black 900. In practice this does not matter, because no Dart code uses the family string `'Poppins'`. Poppins is used only through `GoogleFonts.poppins(...)`, which picks files by **filename** (see B.1.4). In CSS, use the standard weights.
- `AF/assets/google_fonts/Poppins/` also contains 9 italic files that are **not declared**: `Poppins-Italic`, `-ThinItalic`, `-ExtraLightItalic`, `-LightItalic`, `-MediumItalic`, `-SemiBoldItalic`, `-BoldItalic`, `-ExtraBoldItalic`, `-BlackItalic`. It also contains `OFL.txt`. `Roboto_Mono/` contains `LICENSE.txt`.
- `AF/assets/fonts/` holds only `.gitkeep`. It is the target folder of `scripts/white_label/font_white_label.sh`, which copies `*.ttf`/`*.otf` there and writes a family block between the markers. The weight is inferred from the filename: Thin=100, ExtraLight=200, Light=300, Regular=400, Medium=500, SemiBold=600, Bold=700, ExtraBold=800, Black=900. `Italic` in the name sets the italic style.
- **`git diff -- appflowy_flutter/pubspec.yaml` contains no font changes.** The asset changes are 3 new asset directories at the top of `assets:`: `assets/local_templates/`, `assets/local_templates/payloads/` and `assets/local_templates/media/`. The diff also adds the deps `ffi: 2.1.3`, `win32: 5.10.0` and `uuid: 4.5.1`, which are not asset-related.

#### B.1.2 Font constants and defaults (source)

| Constant | Value | File |
|---|---|---|
| `defaultFontFamily` | `''` (empty string means "use the platform default") | `AF/lib/workspace/application/settings/appearance/base_appearance.dart:11` |
| `builtInCodeFontFamily` | `'RobotoMono'` (the pubspec family) | same file, `:13` |
| `DefaultAppearanceSettings.kDefaultFontFamily` | `= defaultFontFamily` (`''`) | `AF/lib/workspace/application/appearance_defaults.dart` |
| Rust `APPEARANCE_DEFAULT_FONT` | `""` ("Use system default font") | `rust-lib/flowy-user/src/entities/user_setting.rs:131` |
| Rust `APPEARANCE_DEFAULT_MONOSPACE_FONT` | `"SF Mono"`. **Never read by Flutter**: `monospace_font` is not referenced in `AF/lib`. | `user_setting.rs:132` |
| Document code font | `DocumentAppearanceState.codeFontFamily` is always `builtInCodeFontFamily`. It is not user-configurable. | `AF/lib/plugins/document/application/document_appearance_cubit.dart:69` |
| Document body font | SharedPreferences key `KVKeys.kDocumentAppearanceFontFamily`, default `defaultFontFamily` | same file `:80` |
| `FontSizes` | s11=11, s12=12, s14=14, s16=16, s18=18, s20=20, s24=24, s32=32, s44=44 (`scale` = 1) | `AF/packages/flowy_infra/lib/size.dart` |
| `BaseAppearance.getFontStyle` defaults | fontSize `s14`, weight `w400`, `letterSpacing = fontSize * 0.005` | `base_appearance.dart` |
| `appflowy_ui` text styles | `AppFlowyBaseTextStyle.customFontFamily(fontFamily ?? '')`. Defaults are `fontFamily: ''` with `inherit: false`. | `AF/packages/appflowy_ui/lib/src/theme/definition/text_style/text_style.dart` |

No other hardcoded family names exist. A grep for the quoted names `'Poppins'`, `'Inter'`, `'Noto…'` and `'Roboto'` in `AF/lib` and `AF/packages` finds only `'RobotoMono'` above. **There is no `fontFamilyFallback` list in app code.** The only `fontFamilyFallback:` use is `FlowyText` (`AF/packages/flowy_infra_ui/lib/style_widget/text.dart:200`), which passes a caller-supplied list. In practice that list is only the Noto Color Emoji family on Linux.

#### B.1.3 Effective default UI font (the font is `''`, i.e. the default)

`getFontStyle` builds `TextStyle(fontFamily: null)` when the family is `''`. `ThemeData` then merges it over the platform Typography (lib: Flutter 3.27.4 `material/typography.dart`):

| Platform | Typography | Family | Fallback |
|---|---|---|---|
| Windows | `blackRedmond`/`whiteRedmond` | `Segoe UI` | Skia system fallback (lib) |
| macOS | `blackRedwoodCity` | `.AppleSystemUIFont` | system |
| Linux | `blackHelsinki` | `Roboto` | `['Ubuntu','Cantarell','DejaVu Sans','Liberation Sans','Arial']` |

AMBIGUOUS: `appflowy_ui` styles set `inherit:false, fontFamily:''`. The engine resolves an empty family to the platform default typeface, which is expected to be the same as above but was not verified at runtime.

Text scale: `MaterialApp.builder` wraps the app in `MediaQuery(textScaler: TextScaler.linear(state.textScaleFactor))`, where `textScaleFactor` is the user appearance setting (`AF/lib/startup/tasks/app_widget.dart`).

#### B.1.4 Font resolution pipeline (user-selected fonts use google_fonts)

| Step | Behavior | File |
|---|---|---|
| Option list | `[defaultFontFamily, ...GoogleFonts.asMap().keys]`. google_fonts 6.2.1 has **1598 families** (lib), keyed by **display name**, e.g. `"Noto Sans HK"`, `"Roboto Mono"`. | `AF/lib/workspace/presentation/settings/pages/settings_workspace_view.dart:854`; editor toolbar `.../editor_plugins/font/customize_font_toolbar_item.dart:85`; mobile `.../setting/font/font_picker_screen.dart:17` |
| Stored value | Display name string, or `''`. App-wide: `AppearanceSettingsCubit.setFontFamily(name)` writes Rust `AppearanceSettingsPB.font`. Document: `DocumentAppearanceCubit.syncFontFamily` writes SharedPreferences `kDocumentAppearanceFontFamily`. The toolbar sets both. | `appearance_cubit.dart:161`, `document_appearance_cubit.dart:127` |
| Display label | `''` shows `LocaleKeys.settings_appearance_fontFamily_defaultFont` (en: `"System"`). Otherwise `parseFontFamilyName()`, which removes `'_regular'` and inserts spaces at camel-case boundaries. | `AF/lib/util/font_family_extension.dart` |
| Family → Flutter family | `fontFamilyName`: `''` stays `''`. Otherwise `getGoogleFontSafely(name).fontFamily`, which gives e.g. `NotoSansHK_regular` (`<ApiFamily>_<variant>`, where variant is `regular`/`italic`/`500`/`700italic`; lib). | same |
| `getGoogleFontSafely(family, …)` | If `family` is in `['', 'RobotoMono']`, returns `TextStyle(fontFamily: family or null)` directly. Otherwise returns `GoogleFonts.getFont(family, …)`. Any exception falls back to `TextStyle` with no family. | `AF/lib/shared/google_fonts_extension.dart` |
| google_fonts load order (lib, 6.2.1 `google_fonts_base.dart`) | 1. Bundled asset whose path without extension **ends with** `<ApiFamily>-<Weight><Italic>`, e.g. `Poppins-Medium`, `RobotoMono-Regular`, searched across all AssetManifest entries (`.ttf`/`.otf`). 2. Disk cache `<getApplicationSupportDirectory()>/<ApiFamily>_<variant>_<sha256>.ttf`. 3. If `allowRuntimeFetching` (**not overridden anywhere, so default true**), HTTP GET `https://fonts.gstatic.com/s/a/<sha256>.ttf`, verified by length and sha256, then cached. The variant is the closest match to the weight and style. The returned style also gets `fontFamilyFallback: [<ApiFamily>]`. | – |
| Bundled matches | `GoogleFonts.poppins(w500)` matches `Poppins-Medium.ttf`; `GoogleFonts.poppins(w300)` matches `Poppins-Light.ttf`; `GoogleFonts.robotoMono()` matches `RobotoMono-Regular.ttf`. Font files declared under `fonts:` appear in AssetManifest (lib), so these load offline. | – |

Direct font usages:

| Where | Font |
|---|---|
| Whole UI (Material `textTheme`, `AFThemeExtension` styles, `AnimatedAppFlowyTheme(themeBuilder.light/dark(fontFamily: …))`) | User font, or `''` (system) |
| `AFThemeExtension.code` (desktop) | `getFontStyle(fontFamily: 'RobotoMono', color: shader3)` (`desktop_appearance.dart:131`) |
| Document inline `code` mark | `GoogleFonts.robotoMono(textStyle: base.copyWith(color: Colors.red, backgroundColor: inverseSurface @0.8))` (`AF/lib/plugins/document/presentation/editor_style.dart:124,174`). AI chat does the same (`chat_editor_style.dart:73`). |
| Code block | `baseTextStyle('RobotoMono')`, `height 1.5` (`editor_style.dart:224`) |
| Legacy folder picker (`AF/lib/user/presentation/widgets/folder_widget.dart:263,303`) | `GoogleFonts.poppins(w500)` title at 14px; `GoogleFonts.poppins(w300)` subtitle at 12px |
| Emoji text (`EmojiText`, `FlowyText.emoji`, `isEmoji:true`) | **Linux**: `GoogleFonts.notoColorEmoji()`, runtime-fetched. **Windows/macOS**: the system emoji font via the engine fallback (Segoe UI Emoji / Apple Color Emoji). On **Linux and Windows**, emoji `fontSize *= 0.9` and `lineHeight /= 0.9` (`text.dart:183`). |

#### B.1.5 Recommended Electron font setup

```css
/* Bundle these files from AF/assets/google_fonts (OFL / Apache-2.0). */
@font-face { font-family: "RobotoMono"; src: url(fonts/RobotoMono-Regular.ttf) format("truetype"); font-weight: 400; font-style: normal; font-display: block; }
@font-face { font-family: "RobotoMono"; src: url(fonts/RobotoMono-Italic.ttf)  format("truetype"); font-weight: 400; font-style: italic; font-display: block; }
/* Poppins: only 300 and 500 are used (folder_widget). Declare the full upright set with STANDARD weights. */
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-Thin.ttf);       font-weight: 100; }
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-ExtraLight.ttf); font-weight: 200; }
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-Light.ttf);      font-weight: 300; }
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-Regular.ttf);    font-weight: 400; }
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-Medium.ttf);     font-weight: 500; }
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-SemiBold.ttf);   font-weight: 600; }
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-Bold.ttf);       font-weight: 700; }
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-ExtraBold.ttf);  font-weight: 800; }
@font-face { font-family: "Poppins"; src: url(fonts/Poppins-Black.ttf);      font-weight: 900; }

:root {
  /* font '' means the platform default (B.1.3) */
  --af-font-system: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, Ubuntu, Cantarell, "DejaVu Sans", "Liberation Sans", Arial, sans-serif;
  --af-font-emoji: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji";
  --af-font-ui: var(--af-font-system), var(--af-font-emoji);
  --af-font-code: "RobotoMono", ui-monospace, monospace;   /* code block, inline code, AFThemeExtension.code */
}
/* User font X (a google_fonts display name): font-family: "X", var(--af-font-ui) */
```

| Topic | Recommendation |
|---|---|
| User-selectable Google Fonts | Build-time: extract the google_fonts 6.2.1 catalog (display name → ApiFamily → variants → `{sha256, length}`) from `google_fonts.dart` and `src/google_fonts_parts/part_*.dart` into JSON. Run time: `new FontFace(displayName, url)` with the URL `https://fonts.gstatic.com/s/a/<sha256>.ttf`. Verify the sha256, then cache in `app.getPath('userData')`. Keep storing the **display name** string, so existing Rust `AppearanceSettingsPB.font` values and the `kDocumentAppearanceFontFamily` KV stay valid. Emulate closest-variant matching: for weight distance, the lowest `|Δweight index| + 2` wins if the style differs. |
| Offline or self-hosted builds | The Flutter app fetches from `fonts.gstatic.com` with no restriction. AMBIGUOUS: whether self-hosted mode should block this. Nothing in `AF/lib/env/self_hosted_policy.dart` touches fonts. |
| Emoji | Windows: rely on Segoe UI Emoji and keep the 0.9 size factor for emoji glyphs. Linux: bundle or fetch Noto Color Emoji. |
| Bold code text | Only Regular and Italic RobotoMono exist. Flutter synthesizes bold; keep CSS `font-synthesis: weight style` (the default). |

---

### B.2 Other bundled assets

`assets:` section of `AF/pubspec.yaml`, in order:

| Asset entry | Contents (this checkout) | Used by |
|---|---|---|
| `assets/local_templates/` (**new**) | `manifest.json` (103 KB; keys `schemaVersion, source, inventory, categories, media, templates`; 52 templates) | `AF/lib/features/local_templates/data/local_template_repository.dart` (`defaultRoot = 'assets/local_templates'`). Generated by `AF/scripts/local_templates/fetch_templates.mjs` (untracked). |
| `assets/local_templates/payloads/` (**new**) | 50 `*.json` template payloads | same |
| `assets/local_templates/media/` (**new**) | 20 files named by sha256: 15 jpg, 3 png, 1 webp, 1 pdf | same |
| `assets/images/` | `appflowy_launch_splash.jpg` (1.1 MB, used by the desktop splash `AF/lib/user/presentation/screens/splash_screen.dart:121` with `BoxFit.cover` and a `CircularProgressIndicator.adaptive`); `app_flowy_abstract_cover_1.jpg`, `_2.jpg`; `flowy_logo.svg`, `flowy_logo_dark_mode.svg`, `flowy_logo_with_text.svg` (no Dart reference found) | |
| `assets/images/appearance/` | `light.png`, `dark.png`, `system.png` | Theme-mode picker: `'assets/images/appearance/${t.name.toLowerCase()}.png'` (`settings_workspace_view.dart:782`) |
| `assets/images/built_in_cover_images/` | `m_cover_image_1..6.png` | Mobile page style `document_page_style_bloc.dart:411`. `cover_editor.dart:8` lists `.jpg` names, which is dead code: `builtInAssetImages` is never used. |
| `assets/flowy_icons/` plus `16x/ 20x/ 24x/ 32x/ 40x/` | Copy of `resources/flowy_icons` (gitignored; byte-identical now). See B.3. | `FlowySvgs.*` |
| `assets/images/emoji/` | 11 svg named by codepoint (`1F42F`, `1F431`, `1F435`, `1F43A`, `1F600`, `1F984`, `1F9CC`, `1F9DB`, `1F9DD-200D-2642-FE0F`, `1F9DE-200D-2642-FE0F`, `1F9DF`) | Legacy avatars: `FlowySvgData('emoji/$iconUrl')` (`chat_avatar.dart:119`, `mobile_home_page_header.dart:223`) |
| `assets/images/login/` | `discord-mark.svg`, `github-light.svg`, `github-mark.svg`, `google-mark.svg`, `language.svg` | Only `FlowySvgData('login/github-mark')` is referenced (`AF/lib/shared/error_page/error_page.dart:265`) |
| `assets/translations/` | Copy of `resources/translations` (gitignored; identical now). See B.4. | easy_localization |
| `assets/icons/icons.json` | 1.5 MB; **16 groups, 977 icons**; shape `{ "<group>": [ {name, keywords[], content:"<svg…>"} ] }`. Groups: artificial_intelligence, computer_devices, culture, entertainment, food_drink, health, images_photography, interface_essential, mail, map_travel, money_shopping, nature_ecology, phone, programing, shipping, work_education. | `loadIconGroups()` (`AF/lib/shared/icon_emoji_picker/icon_picker.dart:57`), preloaded in `InitAppWidgetTask` |
| `assets/fonts/` | `.gitkeep` only (white-label slot) | – |
| `assets/built_in_prompts.json` | 124 KB; `{prompts:[{id,name,category,content,example}]}`, 232 prompts | `AF/lib/ai/service/appflowy_ai_service.dart:131` (`getBuiltInPrompts`) |
| `assets/test/workspaces/`, `assets/test/images/`, `assets/template/`, `assets/test/workspaces/markdowns/`, `assets/test/workspaces/database/` | Inside `# BEGIN: EXCLUDE_IN_RELEASE`. `template/readme.afdoc` and `readme.json`; test zips, md and afdb files; images in gif/jpeg/png/svg | Tests and dev only |

Not in the `assets:` list:
- There are **no Lottie, Rive or sound assets**. The pubspec has no lottie, rive or audio deps.
- Emoji data comes from the `flutter_emoji_mart` package asset `assets/emoji_data.json`, loaded with `EmojiData.builtIn()` in `AF/lib/plugins/base/emoji/emoji_picker.dart:56` and `AF/lib/plugins/emoji/emoji_handler.dart:80`. For Electron, use the same emoji-mart dataset (copy that JSON).
- The Windows app icon is `AF/windows/runner/resources/app_icon.ico`.
- White-label resources are in `scripts/white_label/resources/` (`my_company_logo.{ico,png,svg}`).

---

### B.3 SVG icons (FlowySvgs)

#### B.3.1 Pipeline

| Item | Value |
|---|---|
| Source of truth | `resources/flowy_icons/{16x,20x,24x,32x,40x}/*.svg` |
| Copy step | `scripts/code_generation/flowy_icons/generate_flowy_icons.sh` runs `rm -rf assets/flowy_icons/ && rsync -r ../resources/flowy_icons/ assets/flowy_icons/` from `AF/`. The `.cmd` variant uses `xcopy /E /Y /I`. |
| Generator | `AF/packages/flowy_svg/bin/flowy_svg.dart`, run as `dart run flowy_svg` with cwd `AF/`. Options: `-S/--source-dir` (default `/assets/flowy_icons`), `-O/--output-dir` (default `/lib/generated`), `-N/--name` (default `flowy_svgs.g.dart`). Paths are **concatenated** to cwd, which is why they have leading slashes. |
| Output | `AF/lib/generated/flowy_svgs.g.dart` (`lib/generated/` is gitignored). 742 entries plus a prelude that imports and re-exports `package:flowy_svg/flowy_svg.dart`. Each line is `  static const <name> = FlowySvgData('<path>');` inside `class FlowySvgs {…}`. |
| File selection | `Directory.list(recursive: true)`, keeping paths that **contain** `.svg`. Order is filesystem order; there is no sort. |
| `<path>` | `path.relative(file, from: cwd)` turned into a POSIX path, e.g. `assets/flowy_icons/16x/add.svg` |

#### B.3.2 Identifier algorithm (`varNameFor` / `clean`)

1. Split the path relative to the source dir into segments: `16x/add.svg` gives `["16x","add.svg"]`. Nested subfolders are supported.
2. `clean(segment)`: replace `-` with `_`, replace whitespace runs (`\s+`) with `_`, strip the last extension (`\.[^.]*$`), then **lower-case everything**. Next:
   - If the result is in the keyword list (Dart keywords plus `variable`, `show`, `hide`, `import`, `set`, `get`, …), append `_`.
   - Else if it starts with a digit, prefix `$` (so `16x` becomes `$16x`).
3. **Reverse** the segments and join them with `_`, so the file name comes first and the folder last: `add_$16x`.
4. Collapse `_+` to `_`. This removes the extra `_` added for keywords, so `import.svg` gives `import_s`.
5. Apply `sizeMap` with `replaceAll`, which replaces anywhere in the string:

| Folder | Token | Suffix | Files |
|---|---|---|---|
| `16x` | `$16x` | `_s` | 495 |
| `20x` | `$20x` | `_m` | 83 |
| `24x` | `$24x` | `_m` | 128 |
| `32x` | `$32x` | `_lg` | 15 |
| `40x` | `$40x` | `_xl` | 21 |
| **Total** | | | **742**, 742 identifiers |

Examples taken from the generated file:

| File | Identifier |
|---|---|
| `16x/add.svg` | `add_s` |
| `16x/three-dots-vertical.svg` | `three_dots_vertical_s` |
| `16x/slash_menu_icon_code block.svg` | `slash_menu_icon_code_block_s` |
| `16x/notification_markAsRead.svg` | `notification_markasread_s` |
| `16x/import.svg` | `import_s` |
| `24x/three_dots.svg` | `three_dots_m` |
| `20x/access_level_edit.svg` | `access_level_edit_m` |
| `32x/close.svg` | `close_lg` |
| `40x/app_logo.svg` | `app_logo_xl` |

Collision handling: **none**. A duplicate name produces two `static const` with the same name, which is a Dart compile error. Two risks exist: `20x` and `24x` both map to `_m`, and the name is lower-cased. Currently no file name appears in both `20x` and `24x`, and all 742 identifiers are unique.

The folder does not guarantee the size. Intrinsic `width`×`height` varies within a folder:

| Folder | Most common size | Other sizes seen |
|---|---|---|
| 16x | 16×16 ×272 | 20×20 ×43, 18×18 ×24, 28×28 ×15 |
| 20x | 20×20 ×70 | – |
| 24x | 24×24 ×114 | – |
| 32x | 32×32 ×6 | – |
| 40x | 40×40 ×7 | 4 files have no width/height (viewBox only) |

Colors inside the files: 1 file uses `currentColor`. Multi-color files: 32 in 16x, 2 in 20x, 20 in 24x, 6 in 40x. They are monochromed when tinted (B.3.4).

#### B.3.3 `FlowySvgData` / `FlowySvg` (`AF/packages/flowy_svg/lib/src/flowy_svg.dart`)

```dart
class FlowySvgData { const FlowySvgData(this.path); final String path; }
const FlowySvg(FlowySvgData svg, {Key? key, Size? size, Color? color,
               BlendMode? blendMode = BlendMode.srcIn, double? opacity, String? svgString});
factory FlowySvg.string(String svgString, {Key? key, Size? size, Color? color,
               BlendMode? blendMode = BlendMode.srcIn, double? opacity}) // uses FlowySvgData('')
```

| Behavior | Detail |
|---|---|
| Color | `iconColor = color ?? Theme.of(context).iconTheme.color`. The desktop theme sets `iconTheme: IconThemeData(color: theme.icon)` (`desktop_appearance.dart:69`). For the Default scheme that is light `0xFF333333` (lightShader1) and dark `0xFFBBC3CD` (darkShader5), from `AF/packages/flowy_infra/lib/colorscheme/default_colorscheme.dart`. |
| Opacity | If `opacity != null`, `iconColor = iconColor.withValues(alpha: opacity)`. This **replaces** the alpha; it does not multiply it. |
| Tint | `colorFilter: ColorFilter.mode(iconColor, blendMode)` only when `iconColor != null && blendMode != null`. Default `srcIn`: every painted pixel becomes `iconColor` and keeps the SVG's alpha (a silhouette). `blendMode: null` keeps the original colors; 57 call sites do this, e.g. logos. Other modes seen: `BlendMode.dst` keeps the original (×3) and `BlendMode.dstIn` gives the original × color alpha (×2). |
| Size | `SvgPicture.asset/string(width: size?.width, height: size?.height)` with the default `fit: BoxFit.contain`, centered, inside `SizedBox(size)`. If `size` is null, the intrinsic SVG size is used. |
| Text scale | The whole widget is wrapped in `Transform.scale(scale: MediaQuery.textScalerOf(context).scale(1))`. That is the user `textScaleFactor`. It paints scaled **around the center without changing the layout box**. |
| Path normalization (`_normalized`) | If the path does not start with `assets/` (case-insensitive), prefix `assets/images/`. If it does not end with `.svg`, append `.svg`. So `FlowySvgData('login/github-mark')` becomes `assets/images/login/github-mark.svg`. AMBIGUOUS/dead: `FlowySvgData('editor/move_up' | 'editor/move_down' | 'editor/color' | 'editor/divider')` in `.../actions/option/option_actions.dart:89-95` resolves to `assets/images/editor/*.svg`, which does not exist. |
| Dynamic paths | `FlowySvgData('assets/flowy_icons/16x/$icon.svg')` (`view_ext.dart:189`, `space_icon.dart:135`, for space icons) and `FlowySvgData('emoji/$x')` |
| `FlowySvg.string` users | Icons from `icons.json` (`IconWidget` in `AF/lib/plugins/base/icon/icon_widget.dart`, the picker grid at 20×20 with `opacity: 0.7`, space icons, `view_ext.dart:212`, the grid field header) |
| Usage count | About 770 `FlowySvg(` call sites in `AF/lib` |

#### B.3.4 Other icon mechanisms

| Mechanism | Detail |
|---|---|
| `icons.json` icon set (B.2) | Stored in view or space icon data as `FlowyIconType.icon` with value `jsonEncode({groupName, iconName, color?})`. `color` is an int string parsed with `int.tryParse`, e.g. `"0xFFA34AFD"`. It is rendered with `FlowySvg.string(content, color: Color(color))`, i.e. srcIn tint. A missing SVG renders the emoji `❓`. |
| Emoji icons | `FlowyIconType.emoji` holds a Unicode string rendered as text (`EmojiText`/`FlowyText.emoji`). The picker data comes from flutter_emoji_mart. |
| Custom icons | `FlowyIconType.custom` holds a URL or file path (image) |
| Material `Icons.*` | 65 usages in `AF/lib`. These include the custom features: `features/company_certificates`, `features/jira`, `features/local_templates`, the sidebar Jira button `Icons.task_alt`, and the settings menu `Icons.verified_user_outlined`. **Electron needs the Material Icons font or the equivalent SVGs** (e.g. `@mui/icons-material` or `material-symbols`) for these. |
| `FlowyIconData` (`AF/packages/flowy_infra/lib/icon_data.dart`) | Icon font `FlowyIconData`, codepoints `0xe800` and `0xe801`. **Unused** and its font is **not declared**. Ignore it. |

#### B.3.5 React equivalent (reproduces srcIn)

| Need | Implementation |
|---|---|
| Registry | Generate `flowySvgs.ts` with the same algorithm (B.3.2) and a parity test that diffs it against `flowy_svgs.g.dart`. Use `export const FlowySvgs = { add_s: 'flowy_icons/16x/add.svg', … } as const`. Keep the identifiers 1:1. |
| Tint (srcIn) | Use a CSS mask, which is exact for srcIn including multi-color, white-detail and anti-aliased edges: `<span style={{width,height, backgroundColor: color, WebkitMaskImage:`url(${src})`, maskImage:`url(${src})`, maskSize:'contain', maskRepeat:'no-repeat', maskPosition:'center'}}/>`. Do **not** rewrite fills to `currentColor`: white sub-shapes would differ only if they were left untinted, and gradients would break. |
| `blendMode: null` / `dst` | Plain `<img src>` (or inline SVG) without a mask |
| `dstIn` | `<img>` with `opacity: colorAlpha` |
| Default color | The CSS variable for theme `icon` (e.g. `--af-icon-color`). `color` prop overrides it. `opacity` sets the alpha (replace, not multiply): `color-mix(in srgb, C calc(opacity*100%), transparent)` or an rgba string. |
| `size` omitted | Read the intrinsic `width`/`height` attributes, falling back to the viewBox, at build time and emit them in the registry |
| Text scale | `transform: scale(var(--af-text-scale)); transform-origin: center`, applied to the icon box **without** changing its layout size |
| `FlowySvg.string` | Same mask approach with `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`, memoized per string |

---

### B.4 i18n (easy_localization)

#### B.4.1 Setup

| Param | Value | File |
|---|---|---|
| Init | `InitLocalizationTask`: `await EasyLocalization.ensureInitialized(); EasyLocalization.logger.enableBuildModes = [];` | `AF/lib/startup/tasks/localization.dart` |
| Widget | `EasyLocalization(...)` wraps the app in `runApp` | `AF/lib/startup/tasks/app_widget.dart:74` |
| `supportedLocales` | Hardcoded `const` list (B.4.2); **not derived** from files or language.dart | same `:75-110` |
| `path` | `'assets/translations'` | |
| `fallbackLocale` | `Locale('en','US')` | |
| `useFallbackTranslations` | `true` | |
| `startLocale` | not set (null) | |
| `assetLoader` | not set, so `RootBundleAssetLoader` (lib) loads `'$path/${locale.toStringWithSeparator(separator: "-")}.json'`. `CodegenLoader` in `AF/lib/generated/codegen_loader.g.dart` is generated but **unused**. | |
| `useOnlyLangCode` | default `false` | |
| `saveLocale` | default `true`. easy_localization writes SharedPreferences key `'locale'` (e.g. `"en_US"`) on each `setLocale` (lib). | |
| `ignorePluralRules` | default `true` (lib); see B.4.5 | |
| `useFallbackTranslationsForEmptyResources` | default `false`, so `""` values are shown as empty | |
| MaterialApp | `localizationsDelegates: context.localizationDelegates`, `supportedLocales: context.supportedLocales`, `locale: state.locale` (AppearanceSettingsCubit) | `app_widget.dart:244` |
| Token access | `EasyLocalizationService` (getIt) exposes `getTranslation(token)` and `getFallbackTranslation(token)` from the controller | `AF/lib/shared/easy_localiation_service.dart` |
| Editor strings | `AppFlowyEditorL10n.current = EditorI18n()` (`editor_page.dart:559`) maps editor getters to `LocaleKeys.editor_*`. `AppFlowyEditorLocalizations.load(locale)` is called in `setLocale`. Getters that are not overridden fall back to appflowy_editor's own ARB files (`lib/l10n/intl_*.arb` in the git package). | `AF/lib/plugins/document/presentation/editor_plugins/i18n/editor_i18n.dart` |

#### B.4.2 Translation files (`resources/translations/`; 36 files, copied to `AF/assets/translations/`)

Copy and codegen: `scripts/code_generation/language_files/generate_language_files.sh` runs `cp -f ../resources/translations/*.json assets/translations/`, then:
- `dart run easy_localization:generate -S assets/translations/`, which writes `codegen_loader.g.dart`
- `dart run easy_localization:generate -f keys -o locale_keys.g.dart -S assets/translations/ -s en-US.json`, which writes `AF/lib/generated/locale_keys.g.dart`

The Makefile task is `code_generation` / `dry_code_generation` in `scripts/makefile/flutter.toml:301-328`.

Supported order (dropdown order) = list order: am-ET, ar-SA, ca-ES, cs-CZ, ckb-KU, de-DE, **en-US**, en-GB, es-VE, eu-ES, el-GR, fr-FR, fr-CA, he, hu-HU, id-ID, it-IT, ja-JP, ko-KR, pl-PL, pt-BR, ru-RU, sv-SE, th-TH, tr-TR, uk-UA, ur, vi-VN, zh-CN, zh-TW, fa, hin, mr-IN. That is **33**.

| File | Supported | Display name (`languageFromLocale`) | Leaf keys (% of en-US keys present) |
|---|---|---|---|
| am-ET.json | ✓ | አማርኛ | 623 (22%) |
| ar-SA.json | ✓ | العربية | 2749 (98%) |
| ca-ES.json | ✓ | Català | 600 (21%) |
| ckb-KU.json | ✓ | کوردی سۆرانی | 728 (25%) |
| cs-CZ.json | ✓ | Čeština | 1189 (42%) |
| de-DE.json | ✓ | Deutsch | 2259 (79%) |
| el-GR.json | ✓ | Ελληνικά | 1099 (39%) |
| en-GB.json | ✓ | English (GB) | 2550 (92%) |
| en-US.json | ✓ (fallback, key source) | English (US) | 2776 (100%) |
| es-VE.json | ✓ | Español | 1256 (44%) |
| eu-ES.json | ✓ | Euskera | 431 (15%) |
| fa.json | ✓ `Locale('fa')` | فارسی | 525 (18%) |
| fr-CA.json | ✓ | Français (CA) | 1034 (36%) |
| fr-FR.json | ✓ | Français (FR) | 2726 (97%) |
| ga-IE.json | ✗ not in list | (would be `ga`) | 103 (4%) |
| he.json | ✓ `Locale('he')` | עברית | 1635 (58%) |
| hin.json | ✓ `Locale('hin')` | हिन्दी | 547 (19%) |
| hu-HU.json | ✓ | Magyar | 431 (15%) |
| id-ID.json | ✓ | Bahasa Indonesia | 799 (28%) |
| it-IT.json | ✓ | Italiano | 1707 (61%) |
| ja-JP.json | ✓ | 日本語 | 2410 (87%) |
| ko-KR.json | ✓ | 한국어 | 2527 (91%) |
| mr-IN.json | ✓ | मराठी | 2520 (66%) |
| pl-PL.json | ✓ | Polski | 874 (31%) |
| pt-BR.json | ✓ | Português | 1189 (42%) |
| pt-PT.json | ✗ not in list | (Português) | 625 (22%) |
| ru-RU.json | ✓ | русский | 2702 (96%) |
| sv-SE.json | ✓ | Svenska | 495 (18%) |
| th-TH.json | ✓ | ไทย | 2299 (82%) |
| tr-TR.json | ✓ | Türkçe | 2437 (88%) |
| uk-UA.json | ✓ | українська | 2025 (71%) |
| ur.json | ✓ `Locale('ur')` | اردو | 541 (19%) |
| vi.json | ✗ (base-language overlay only, see B.4.6) | – | 3 |
| vi-VN.json | ✓ | **`vi`**: no `case "vi"` exists, so the language code is shown | 2023 (72%) |
| zh-CN.json | ✓ | 简体中文 | 1607 (56%) |
| zh-TW.json | ✓ | 繁體中文 | 2776 (100%) |

Display-name source: `AF/packages/flowy_infra/lib/language.dart` `languageFromLocale(Locale)`. It switches on `languageCode`, and also on `countryCode` for en, zh, ckb and fr. An unknown code returns `languageCode`; zh or ckb with an unknown country also return the `languageCode`. The same function feeds the settings dropdown (`settings_workspace_view.dart:339`), the welcome-page selector (`skip_log_in_screen.dart:172 LanguageSelectorOnWelcomePage`) and the mobile pickers.

**Translations in this checkout are unchanged.** `git diff --stat -- resources/translations` is empty, there are no untracked files, and `AF/assets/translations` is identical to `resources/translations`. **No custom keys were added.**

#### B.4.3 Key format (LocaleKeys)

| Aspect | Rule (lib: easy_localization 3.0.7 `bin/generate.dart`) |
|---|---|
| Mapping | Nested JSON path joined with `.` is the runtime key. The Dart constant name replaces `.` with `_` and **keeps case**. Example: `{"settings":{"appearance":{"fontFamily":{"defaultFont":"System"}}}}` gives `LocaleKeys.settings_appearance_fontFamily_defaultFont = 'settings.appearance.fontFamily.defaultFont'`. |
| Parent keys | Every object node also gets a constant (`LocaleKeys.blockActions = 'blockActions'`). The generator emits children before the parent. |
| Plural and gender children | Child keys named `zero/one/two/few/many/other/male/female` are **never** emitted, anywhere in the tree. Only the parent is emitted (`LocaleKeys.chat_referenceSource`). |
| Counts | `locale_keys.g.dart` has 3050 constants. en-US has 94 top-level keys, a maximum depth of 6 and 2776 leaves (2705 excluding plural children). |
| Identifier-unsafe JSON keys | `settings.workspacePage.dateTime.24HourTime` and `newSettings.myAccount.2FA`. They are valid only because of the prefix. |
| Call sites | `LocaleKeys.x.tr()` about 2740 times; `.tr(args: [...])` about 51; `.tr(namedArgs: {...})` 20; `.plural(n, …)` 9; `gender:` 0 |

#### B.4.4 String syntax

| Feature | JSON | Dart call | Runtime (lib `localization.dart`) |
|---|---|---|---|
| Positional | `"failedToOpenUrl": "Failed to open url: {}"`. 64 occurrences; 7 strings have several `{}`, e.g. `"{} of {}"`. | `.tr(args: ['a','b'])` | Each arg replaces the **first remaining** `{}`, in order. Leftover `{}` stay literal. |
| Named | `{count}` (44), `{newVersion}`, `{time}`, `{plan}`, `{pageType}`, `{name}`, `{email}`, `{currentVersion}`, `{category}`, `{X}`, `{workspace}`, `{version}`, `{min}`, `{max}`, `{level}`, `{intention}`, `{field}`, `{discount}`, … | `.tr(namedArgs: {'count': '3'})` | `replaceAll(RegExp('{$key}'), value)`. Named args are applied **before** positional ones. No string mixes `{}` and `{name}`. |
| Linked | `"welcomeText": "Welcome to @:appName"`. 45 uses: `@:appName` ×37, `@:appName.` ×2, `@:chat.changeFormat.*`, `@:newSettings.myAccount.deleteAccount.confirmHint`. No `@.upper:` / `@.lower:` / `@.capitalize:` modifiers are used. | – | Regex `@(?:\.[a-z]+)?:([\w\-_|.]+|\(…\))`. **Quirk**: in `"…into @:appName."` the trailing `.` is captured into the key `appName.`. Nested lookup then returns `"AppFlowy"`, because the walk stops at the first non-map, so **the period is swallowed**: the output is `"…into AppFlowy"`. Links resolve before args. |
| Plural | Object with `zero/one/two/few/many/other`. 24 objects in en-US, e.g. `"referenceSource": {"zero":"0 sources found","one":"{count} source found","other":"{count} sources found"}` | `LocaleKeys.chat_referenceSource.plural(n, namedArgs: {'count': '$n'})` | Because `ignorePluralRules = true`, **the case depends only on the number, for every language**: 0 is `zero`, 1 is `one`, 2 is `two`, anything else is `other`. `few` and `many` are never selected. A missing subkey is looked up first in the **fallback** translations, so English may appear; if still missing it uses `<key>.other`. After that, `namedArgs` are applied, then positional `args ?? [n.toString()]`, so `{}` receives the number. |
| Gender | None used | – | – |
| Missing key | – | – | Current locale, then fallback translations, then the **key string itself** (e.g. `settings.title`) |

#### B.4.5 Locale choice and persistence

| Step | Behavior | File |
|---|---|---|
| 1 | `ensureInitialized` reads SharedPreferences `'locale'` (saved locale) and `findSystemLocale()` (device locale) (lib) | `localization.dart` |
| 2 | easy_localization's initial locale is the saved one (if any), matched with `supports()`. Otherwise it is the device locale matched with `supports()`, where `supports()` means same language and (supported country empty or equal). Otherwise `en-US`. (lib) | – |
| 3 | `AppearanceSettingsCubit(...)..readLocaleWhenAppLaunch(context)`. If Rust `AppearanceSettingsPB.reset_to_default` is true (the default on first run): set it to false, save, and `setLocale(context.deviceLocale)`. Otherwise `setLocale(Locale(pb.locale.language_code, pb.locale.country_code))`. | `appearance_cubit.dart:266` |
| 4 | `setLocale(ctx, l)`: if `!context.supportedLocales.contains(l)` (**exact equality**; `''` country equals null, but `de-AT` does not match `de-DE`), use `en-US`. Then `context.setLocale(l)` (also persists SharedPreferences `'locale'`), `AppFlowyEditorLocalizations.load(l)`, and if changed, write `languageCode` / `countryCode ?? ""` to Rust appearance settings and emit. | `appearance_cubit.dart:201` |
| Source of truth | Rust user setting `AppearanceSettingsPB.locale {language_code, country_code}`. The Rust default is `{"en",""}` (`rust-lib/flowy-user/src/entities/user_setting.rs:112`). SharedPreferences `'locale'` is secondary. | |
| UI | Settings → Workspace → Language dropdown (`SettingsDropdown<Locale>`, key `LanguageDropdown`) and the welcome-page selector, both calling `setLocale` | |
| RTL locales present | ar-SA, he, fa, ur, ckb-KU. Directionality follows Flutter's localizations plus the separate layout and text direction appearance settings. Not covered in this section. | |

#### B.4.6 Fallback-translation construction (lib, `easy_localization_controller.dart`)

The fallback map is `en-US.json`. When the current locale has a non-empty country code, `"<lang>.json"` is also loaded and merged in with a **shallow top-level `addAll`**.

The only base-language file that exists is `vi.json` (`{"board":{"mobile":{3 keys}}}`). So for **vi-VN**, the entire top-level `board` object in the fallback is replaced by vi.json's `board`. As a result, `board.*` keys missing from vi-VN.json, other than those 3, show the raw key. For every other locale, `"<lang>.json"` is missing; the controller logs a warning and the fallback is plain en-US.

#### B.4.7 Custom features: hardcoded English (no `.tr()`)

None of the new or customized UI uses LocaleKeys. Every string is an English literal:

| File | `.tr()` | Examples of literal strings |
|---|---|---|
| `AF/lib/features/company_certificates/company_certificates_settings_view.dart` | 0 | `'Company certificates'`, `'Choose certificate file'`, `'Review before importing'`, `'Trust certificate'`/`'Trust certificates'`, `'Imported certificates'`, `'No company certificates imported yet.'`, `'Remove'`, `'Cancel'`, `'SHA-256 fingerprint'`, `'Certificate imported. Restart AppFlowy to refresh all connections.'`, `'Certificate import is available in the Windows desktop app.'` |
| `AF/lib/features/self_hosting/self_hosted_settings_view.dart` | 0 | `'Workspace storage'`, `'Local workspace on this PC'`, `'My collaboration server'`, `'Server URL'`, `'Web and shared-page URL'`, `'Same as server if left blank'`, `'Applying…'`, `'Apply and restart'`, plus the long description text |
| `AF/lib/workspace/presentation/settings/pages/setting_ai_view/openai_endpoint_settings_view.dart` | 0 | `'Enable AI endpoint'`, `'API base URL'`, `'Include the API prefix, usually /v1.'`, `'Chat model ID'`, `'Embeddings model ID (optional)'`, `'Image generation model ID (optional)'`, `'API key (optional)'`, `'Endpoint responded successfully.'`, `'AI settings saved. Reopen existing chats to refresh their model.'` |
| `AF/lib/ai/service/openai_endpoint_settings.dart` | 0 | No UI strings (model and service only) |
| `AF/lib/features/jira/presentation/**` (dashboard, settings, issue, transition dialogs, widgets) | 0 | Literals throughout, about 43 UI strings |
| `AF/lib/features/local_templates/presentation/*` | 0 | About 7 UI strings |
| `AF/lib/workspace/presentation/settings/widgets/settings_menu.dart` | – | `label: 'Storage & server'` **replaces** `LocaleKeys.settings_menu_cloudSettings`. Adds `'Certificates'`. |
| `AF/lib/workspace/presentation/settings/widgets/setting_cloud.dart` | – | `titleFromCloudType` returns `'Local workspace'` / `'My collaboration server'`. This replaces `settings_menu_cloudLocal`, `_cloudAppFlowy` and `_cloudAppFlowySelfHost`; `settings_menu_cloudSettings` and `_cloudServerType` are also removed. |
| `AF/lib/workspace/presentation/settings/settings_dialog.dart` | – | Removed uses of `settings_menu_cloudURL`, `_webURL`, `_cloudURLHint`, `_webURLHint`, `_pleaseInputValidURL`, `_changeUrl`, `button_save` |
| `AF/lib/workspace/presentation/home/menu/sidebar/sidebar.dart` | – | `'Jira'` button and plugin title |
| `AF/lib/workspace/presentation/home/menu/sidebar/footer/sidebar_footer.dart` | – | `title: 'Templates'` |
| `AF/lib/user/presentation/screens/sign_in_screen/desktop_sign_in_screen.dart` | – | `'Sign in to your collaboration server'`. Removed `LocaleKeys.signIn_or`. |
| `AF/lib/ai/service/ai_model_state_notifier.dart` | – | `'Ask your AI endpoint...'`. Replaces `chat_inputLocalAIMessageHint` and `settings_aiPage_keys_localAI*` hints. |
| `AF/lib/ai/widgets/prompt_input/select_model_menu.dart` | – | `title: 'AI endpoint'`. Replaces `chat_switchModel_localModel`. |
| `AF/lib/ai/service/appflowy_ai_service.dart`, `AF/lib/plugins/ai_chat/application/chat_stream_manager.dart` | – | `'Could not prepare local AI sources.'`, `'Could not save the generated image to local storage.'`, `'This page is empty.'`, `'Could not prepare the selected local sources.'` |
| `AF/lib/workspace/presentation/settings/pages/setting_ai_view/local_settings_ai_view.dart` | – | Removed `LocaleKeys.settings_aiPage_title` |

Parity implication: these strings show in English for **every** locale. To replicate 1:1, hardcode them too. Alternatively, add them under a new namespace (e.g. `custom.*`) in en-US only, so other locales fall back to English and the visible result is identical.

#### B.4.8 React/Electron recommendation

| Topic | Recommendation |
|---|---|
| Library | **Preferred**: a tiny in-house `tr()`/`plural()` (about 80 lines) that ports easy_localization 3.0.7 `Localization` + `Translations.get` exactly. That covers the nested lookup quirk, `@:` link regex, named args before positional `{}`, the 0/1/2/other plural rule with fallback lookup, and the key string returned when missing. This gives byte-identical output, including the quirks above. |
| If i18next | `keySeparator: '.'`, `nsSeparator: false`, `interpolation: { prefix: '{', suffix: '}', escapeValue: false }` (named `{count}` works). Positional `{}` is unsupported natively; add a `postProcess` step that sequentially replaces `{}` from `options.args`. Plurals: i18next expects `key_one`/`key_other` suffixes and CLDR rules. Use a custom `pluralResolver`, or a pre-convert script plus `compatibilityJSON`, and **force the 0→zero, 1→one, 2→two, else→other rule**. Linked keys: convert `@:x.y` to `$t(x.y)`, but replicate the `@:appName.` period-swallow or fix it knowingly. Fallback: `fallbackLng: 'en-US'`, with special handling for vi-VN plus `vi.json` shallow-merge if exact parity is required. |
| Files | Ship `resources/translations/*.json` unchanged. Load `${lang}-${COUNTRY}.json`, or `${lang}.json` for `he`, `ur`, `fa`, `hin`. Hardcode the same 33-entry `supportedLocales` in the same order. |
| Typed keys | Generate `LocaleKeys.ts` with the same rule as B.4.3 (`a_b_c = 'a.b.c'`, parents included, plural and gender children skipped) so call sites map 1:1 from the Dart code. |
| Persistence | Read and write the locale through the Rust appearance-setting events (`AppearanceSettingsPB.locale`, `reset_to_default`) exactly as in B.4.5. Use `app.getLocale()` / `Intl` in Electron as the device locale, and keep the exact-match-else-en-US rule. |
| Display names | Port `languageFromLocale` verbatim, including `vi-VN` showing `vi` and both `pt-*` showing `Português`. |

---

## C. Settings dialog

Conventions used in this section
- Paths are relative to `D:\Projects\appflowy\frontend`. `lib/` = `appflowy_flutter/lib/`.
- i18n keys are dotted JSON keys from `resources/translations/en-US.json` (there is no `en.json`; the app loads `appflowy_flutter/assets/translations`, a build-time copy). Dart `LocaleKeys.a_b_c` maps to `a.b.c`. `@:appName` resolves to "AppFlowy".
- **[CUSTOM]** = differs from upstream HEAD (confirmed with `git diff`). **[UPSTREAM]** = unchanged.
- Theme tokens: `AFT.*` = `AppFlowyTheme.of(context)` (`appflowy_flutter/packages/appflowy_ui`). `MT.*` = legacy Material `Theme.of(context)` built from `FlowyColorScheme` (`desktop_appearance.dart`, `useMaterial3: false`). `AFExt.*` = `AFThemeExtension`.
- AFT spacing: xs=4, s=6, m=8, l=12, xl=16, xxl=20. AFT radius: xs=4, s=6, m=8, l=12, xl=16, xxl=20.
- AFT text styles (size/line-height): heading1 36/40, heading2 24/32, heading3 20/28, heading4 16/22, headline 24/36, title 20/28, body 14/20, caption 12/18. Weights: `.standard` w400, `.enhanced` w600, `.prominent` w700.
- `FlowyText` default size = `MT.textTheme.bodyMedium` = 14. `FlowyText.regular` w400, `.medium` w500, `.semibold` w600.

AFT color tokens used in this section (`packages/appflowy_ui/lib/src/theme/data/appflowy_default/{semantic,primitive}.dart`):

| Token | Light | Dark |
|---|---|---|
| `surfaceContainerColorScheme.layer01` (menu bg) | `#F8FAFF` | `#272930` |
| `backgroundColorScheme.primary` (body bg) | `#FFFFFF` | `#21232A` |
| `borderColorScheme.primary` (dividers) | `#E4E8F5` | `#3D404F` |
| `fillColorScheme.contentHover` (menu hover) | `#1F2329` at 5% (`0x0D1F2329`) | `#F9FAFD` at 5% (`0x0DF9FAFD`) |
| `fillColorScheme.themeSelect` (menu selected) | `#00B5FF` at 15% (`0x2600B5FF`) | same |
| `textColorScheme.primary` | `#21232A` | `#E4E8F5` |
| `textColorScheme.secondary` | `#6F748C` | `#989EB7` |

---

### C.1 Dialog shell & entry points

#### Entry points

| # | Trigger | Code | Behavior |
|---|---|---|---|
| 1 | Gear button in the sidebar header (`UserSettingButton`) | `lib/workspace/presentation/home/menu/sidebar/shared/sidebar_setting.dart` | 28×28 square `FlowyButton` (margin 0). Icon `FlowySvgs.settings_s` (`resources/flowy_icons/16x/settings.svg`) at opacity 0.7. The icon tint is `MT.colorScheme.onSurface` while the parent row is hovered. Tooltip `settings.menu.open` "Open Settings". It sits in `SidebarWorkspace` (when the collab-workspace flag is on and workspaces exist) or in the fallback `SidebarUser`. In both, it comes after the workspace or user name and is followed by an 8px gap and the notification button. The widget creates its own `PasswordBloc(userProfile)` in `initState` and sends `init` and `checkHasPassword`. That HTTP check therefore runs when the sidebar mounts, and the bloc is passed into the dialog. |
| 2 | Hotkey **Ctrl+,** (Windows/Linux) / **Cmd+,** (macOS), `HotKeyScope.inapp` | `openSettingsHotKey` in `sidebar_setting.dart`, registered in `lib/workspace/presentation/home/hotkeys.dart` | **Toggle.** If the dialog is not open (`_settingsDialogKey.currentContext == null`), it calls `showSettingsDialog(context, userWorkspaceBloc: …)`. On this path a new `PasswordBloc` is created inside the dialog. If the dialog is open, it calls `Navigator.of(context, rootNavigator: true).popUntil((r) => r.isFirst)`, which closes the dialog and any dialogs stacked on top of it. |
| 3 | Sidebar "upgrade" toast | `lib/workspace/presentation/home/menu/sidebar/footer/sidebar_toast.dart` | Calls `showSettingsDialog(..., initPage: SettingsPage.plan)` only when `role.isOwner`. Other roles get an "ask owner" dialog. See ambiguity A3. |
| 4 | "Settings" button on the desktop sign-in screen (before login) | `lib/user/presentation/screens/sign_in_screen/desktop_sign_in_screen.dart` → `showSimpleSettingsDialog` in `lib/shared/settings/show_settings.dart` | Opens **`SimpleSettingsDialog`** (see below), not the full dialog. |
| – | Unused variant | `lib/shared/settings/show_settings.dart` `showSettingsDialog(context, userProfile, [bloc, initPage])` | This variant has no callers for the full dialog. It does **not** provide `PasswordBloc`, so the Account page would fail with it. Do not port it. |

`showSettingsDialog` (sidebar variant) wiring:
1. Calls `AFFocusManager.maybeOf(context)?.notifyLoseFocus()`.
2. Calls `showDialog` with Flutter defaults: `barrierDismissible: true`, barrier color `Colors.black54` (`#000000` at 54%), `useRootNavigator: true`.
3. The route child is a `MultiBlocProvider(key: _settingsDialogKey)` that provides `PasswordBloc`, `DocumentAppearanceCubit` (the app instance) and `UserWorkspaceBloc`.
4. The child widget is `SettingsDialog(userProfile, initPage, didLogout, dismissDialog, restartApp)`. `userProfile` is `UserWorkspaceBloc.state.userProfile` at the moment the dialog opens.
5. `didLogout` and `restartApp` both pop the dialog and then call `runAppFlowy()`, which is a full app re-bootstrap (the Electron equivalent is a renderer reload or app re-init). `dismissDialog` pops if possible.

#### Shell layout (`lib/workspace/presentation/settings/settings_dialog.dart`, class `SettingsDialog`)

| Property | Value |
|---|---|
| Container | `FlowyDialog` (`packages/flowy_infra_ui/lib/src/flowy_overlay/flowy_dialog.dart`), which wraps a Material `SimpleDialog` |
| Width | `max(564, 0.6 × windowWidth)`: `width: MediaQuery.size.width*0.6` with `constraints: BoxConstraints(minWidth: 564)`, no max. Note: Flutter's `SimpleDialog` wraps content in `IntrinsicWidth(stepWidth: 56)`, so the rendered width snaps **up** to a multiple of 56 and is capped by the window width minus the inset. |
| Height | `0.7 × windowHeight`. `FlowyDialog.expandHeight` defaults to true, so this height is fixed. |
| Inset padding | 40 horizontal, 24 vertical (Flutter default) |
| Shape | `RoundedRectangleBorder(radius 16)`, `clipBehavior: antiAliasWithSaveLayer` |
| Dialog background | `MT.cardColor` (`FlowyColorScheme.input`). The `Scaffold` covers it entirely with `AFT.backgroundColorScheme.primary`. |
| Elevation | Material 2 dialog default: 24 |
| Content padding | 0. The `FlowyDialog.padding` parameter is declared but never applied. |
| Inner structure | `ScaffoldMessenger > Scaffold(bg AFT.backgroundColorScheme.primary) > Row(crossAxisAlignment: start)`. Snackbars render inside the dialog. |
| Row child 1 | `SizedBox(width: 204)` → `SettingsMenu` (C.2) |
| Row child 2 | `AFDivider(axis: vertical, color: AFT.borderColorScheme.primary)`, 1px wide, full height |
| Row child 3 | `Expanded` → `BlocBuilder<UserWorkspaceBloc>` → `getSettingsView(state.currentWorkspace!, page, state.userProfile, state.currentWorkspace?.role)`. The page content uses the **live** profile and role from `UserWorkspaceBloc`. The menu uses the profile snapshot taken at open time. |
| Header / title bar | **None.** There is no title and no close (X) button. Each page draws its own `SettingsHeader` through `SettingsBody` (C.4). |
| Right body padding and scroll | Provided by each page via `SettingsBody`: `SingleChildScrollView(ClampingScrollPhysics, padding: all 24)`. |
| Widget key | `ValueKey(user.id)` |

Close behavior:
- Clicking the barrier closes the dialog.
- Esc closes it through Flutter's `DismissIntent`, which is enabled because `barrierDismissible` is true.
- Pressing Ctrl/Cmd+, again closes it (toggle).
- Programmatic closes: logout, restart, workspace delete or leave (`Navigator.pop` from the Workspace page), and account deletion (`context.popToHome()` followed by `runAppFlowy()`).

Page router (`getSettingsView`), mapping `SettingsPage` to a widget:
- `account` → `SettingsAccountView(userProfile, didLogout, didLogin: dismissDialog)`
- `workspace` → `SettingsWorkspaceView(userProfile, currentWorkspaceMemberRole)`
- `manageData` → `SettingsManageDataView`
- `notifications` → `SettingsNotificationsView`
- `cloud` → `SettingCloud(restartAppFlowy)`. **[CUSTOM]** It now always returns `SelfHostedSettingsView(restartApp)` (`lib/features/self_hosting/self_hosted_settings_view.dart`). That view's `SettingsBody` title is "Storage & server".
- `companyCertificates` → `CompanyCertificatesSettingsView` **[CUSTOM, new]**, from `lib/features/company_certificates/`, with title "Company certificates".
- `shortcuts` → `SettingsShortcutsView`
- `ai` → `LocalSettingsAIView(key: ValueKey(workspaceId))` **[CUSTOM]**. It is always used; upstream used `SettingsAIView` for `WorkspaceTypePB.ServerW`. Its body is now `OpenAIEndpointSettingsView`.
- `member` → `WorkspaceMembersPage`
- `plan` → `SettingsPlanView`
- `billing` → `SettingsBillingView`
- `sites` → `SettingsSitesPage`
- `featureFlags` → `FeatureFlagsPage`

#### Pre-login `SimpleSettingsDialog` (same file)

| Property | Value |
|---|---|
| Width | `0.7 × windowWidth`, clamped to `[564, 784]` |
| Height | `0.7 × windowHeight` |
| Shape | Same `FlowyDialog` as the main dialog (radius 16) |
| Body | `SingleChildScrollView > Padding(all 24) > Column(crossAxisAlignment: start)` |
| 1 | Header `signIn.settings` "Settings": `FlowyText` 36, w600 |
| gap | 18 |
| 2 | `SettingsCategory(title: settings.workspacePage.language.title` "Language"`)` → `LanguageDropdown` (identical to C.6) |
| gap | 22 |
| 3 | **[CUSTOM]** `SelfHostedSettingsView(restartApp: runAppFlowy)`. It replaces upstream's private `_SelfHostSettings`, which had a cloud/self-host dropdown, cloud URL and web URL fields, and Save. |
| gap | 22 |
| 4 | `SettingsCategory(settings.mobile.support` "Support"`)` with two rows. Row 1: `workspace.errorActions.exportLogFiles` "Export log files", Spacer, `OutlinedRoundedButton(settings.files.export` "Export", minWidth 78`)` → `shareLogFiles(context)`. Row 2: `settings.files.clearCache` "Clear cache", Spacer, `OutlinedRoundedButton(button.clear` "Clear"`)` → `FlowyCacheManager.clearAllCache()` → toast `settings.manageDataPage.cache.dialog.successHint` "Cache cleared!". |

- **[CUSTOM]** `SettingsServerDropdownMenu.supportedServers` is now only `[appflowyCloudSelfHost]`. The menu has no callers.
- `SimpleSettingsMenu` in `settings_menu.dart` is also unused.

Auth context **[CUSTOM]** (`lib/env/cloud_env.dart`, `lib/env/self_hosted_policy.dart`), which drives the visibility rules in C.2 and C.5:
- `getAuthenticatorType()` returns `appflowyCloudSelfHost` only when KV `kCloudType == '3'` **and** KV `kAppFlowyCloudBaseURL` passes `SelfHostedPolicy.validateServerUrl`. That check requires http(s), a host, no userinfo, query, fragment or path (except `/`), and the host must not be appflowy.com, appflowy.io, appflowy.cloud or any subdomain.
- In every other case it calls `useLocalServer()`, which sets `kCloudType='0'`, clears both URLs, and returns `local`.
- The Rust core receives `authenticator_type` 0 for local and 2 otherwise (`rust_sdk.dart`).
- `isAuthEnabled` is true only when the type is cloud-enabled (in practice, self-host) **and** the config is valid (`base_url`, `ws_base_url` and `gotrue_url` all non-empty).
- `afLaunchUri` refuses vendor hosts. `HttpOverrides` blocks connections to vendor hosts.

---

### C.2 Left menu (order, icons, keys, visibility)

File: `lib/workspace/presentation/settings/widgets/settings_menu.dart` (`SettingsMenu`). Item widget: `.../widgets/settings_menu_element.dart`.

Menu container:
- `Container` with `color: AFT.surfaceContainerColorScheme.layer01` and `BorderRadiusDirectional.horizontal(start: Radius.circular(AFT.spacing.m = 8))`. That gives 8px radius on the top-start and bottom-start corners only.
- `height: double.infinity`, width 204 (from the parent).
- `SingleChildScrollView(ClampingScrollPhysics, padding: vertical 24, horizontal 12)`.
- `Column(spacing: AFT.spacing.xs = 4)`. Items stretch to the full content width of 180.
- **No section headers and no separators.** The list is flat.

Item visual (`SettingsMenuElement`, built on `AFBaseButton`):

| Prop | Value |
|---|---|
| Padding | all 8 (`AFT.spacing.m`) |
| Border | 1px, `Colors.transparent` |
| Radius | 8 (`AFT.borderRadius.m`) |
| Background | Hover → `AFT.fillColorScheme.contentHover`. **Hover takes precedence over selected.** Else selected (`page == selectedPage`) → `AFT.fillColorScheme.themeSelect`. Else transparent. |
| Focus ring | 2px outside, shown when keyboard-focused (`AFBaseButton` default `showFocusRing`) |
| Cursor | click |
| Content | `Row[icon, HSpace(8), Text(label)]` |
| Icon | `FlowySvg` at its intrinsic size (20×20 for the `20x/` assets), tinted with `MT.iconTheme.color` (srcIn). Material icons use size 20. |
| Label | `AFT.textStyle.body.standard` (14/20, w400), color `AFT.textColorScheme.primary`. No ellipsis is set. |
| Resulting height | 20 + 2×8 + 2×1 = **38px** |
| Click | `changeSelectedPage(page)` → `SettingsDialogEvent.setSelectedPage(page)` |

Items in render order. "Role" is `UserWorkspaceBloc.state.currentWorkspace?.role`, read once when the dialog builds. Note that `UserWorkspacePB.role` is a proto `one_of`, so an unset role reads as `AFRolePB.Owner`. "workspaceType" is `userProfile.workspaceType` from the profile snapshot at open time.

| # | `SettingsPage` | Label key → English | Icon (FlowySvgs → file under `resources/flowy_icons/`) | Visibility (exact) | Custom? |
|---|---|---|---|---|---|
| 1 | `account` | `settings.accountPage.menuLabel` → "Account & App" | `settings_page_user_m` → `20x/settings_page_user.svg` | always | UPSTREAM |
| 2 | `workspace` | `settings.workspacePage.menuLabel` → "Workspace" | `settings_page_workspace_m` → `20x/settings_page_workspace.svg` | always | UPSTREAM |
| 3 | `member` | `settings.appearance.members.label` → "Members" | `settings_page_users_m` → `20x/settings_page_users.svg` | `FeatureFlag.membersSettings.isOn` (always true: hard-coded in the released-flags list) **&&** `workspaceType == WorkspaceTypePB.ServerW` **&&** `role != null` **&&** `role != AFRolePB.Guest` | UPSTREAM |
| 4 | `manageData` | `settings.manageDataPage.menuLabel` → "Manage data" | `settings_page_database_m` → `20x/settings_page_database.svg` | always | UPSTREAM |
| 5 | `notifications` | `settings.menu.notifications` → "Notifications" | `settings_page_bell_m` → `20x/settings_page_bell.svg` | always | UPSTREAM |
| 6 | `cloud` | **hard-coded `'Storage & server'`** (not translated). Upstream used `settings.menu.cloudSettings` → "Cloud Settings". | `settings_page_cloud_m` → `20x/settings_page_cloud.svg` | always | **CUSTOM** (label; the page is now `SelfHostedSettingsView`) |
| 7 | `companyCertificates` | **hard-coded `'Certificates'`** | Material `Icons.verified_user_outlined`, size 20 | always, on every platform. The page shows a non-Windows notice when `!Platform.isWindows`. | **CUSTOM (new)** |
| 8 | `shortcuts` | `settings.shortcutsPage.menuLabel` → "Shortcuts" | `settings_page_keyboard_m` → `20x/settings_page_keyboard.svg` | always | UPSTREAM |
| 9 | `ai` | `settings.aiPage.menuLabel` → "AI Settings" | `settings_page_ai_m` → `20x/settings_page_ai.svg` | always | page **CUSTOM** (always the local or OpenAI-endpoint view) |
| 10 | `sites` | `settings.sites.title` → "Sites" | `settings_page_earth_m` → `20x/settings_page_earth.svg` | `workspaceType == ServerW` **&&** `role != null` **&&** `role != Guest` | UPSTREAM |
| 11 | `plan` | `settings.planPage.menuLabel` → "Plan" | `settings_page_plan_m` → `20x/settings_page_plan.svg` | `FeatureFlag.planBilling.isOn && state.isBillingEnabled`. **[CUSTOM]** `planBilling.isOn` now returns `false` unconditionally, so this item **never shows**. | **CUSTOM** (forced hidden) |
| 12 | `billing` | `settings.billingPage.menuLabel` → "Billing" | `settings_page_credit_card_m` → `20x/settings_page_credit_card.svg` | same as Plan, so it **never shows** | **CUSTOM** (forced hidden) |
| 13 | `featureFlags` | literal `'Feature Flags'` | Material `Icons.flag`, size 20 | `kDebugMode` only (debug builds) | UPSTREAM |

Effective menu by mode in this build:
- **Local mode** (no valid self-host server, `LocalW` workspace): Account & App, Workspace, Manage data, Notifications, Storage & server, Certificates, Shortcuts, AI Settings, plus Feature Flags in debug builds.
- **Self-hosted server workspace (`ServerW`), role Owner or Member:** the same list plus Members (after Workspace) and Sites (after AI Settings).
- **Guest:** Members and Sites are hidden.

`SettingsPage` enum declaration order, for persistence and indexing (`lib/workspace/application/settings/settings_dialog_bloc.dart`): `account, workspace, manageData, shortcuts, ai, plan, billing, sites, notifications, cloud, companyCertificates`**[CUSTOM inserted]**`, member, featureFlags`.

---

### C.3 SettingsDialogBloc

File: `lib/workspace/application/settings/settings_dialog_bloc.dart` (freezed). **[CUSTOM]** The only change is the added `SettingsPage.companyCertificates` enum value.

| Item | Detail |
|---|---|
| Constructor | `SettingsDialogBloc(UserProfilePB userProfile, AFRolePB? currentWorkspaceMemberRole, {SettingsPage? initPage})`. It creates `UserListener(userProfile)`. |
| State | `SettingsDialogState { UserProfilePB userProfile; SettingsPage page; bool isBillingEnabled }` |
| Initial state | `page = initPage ?? SettingsPage.account`, `isBillingEnabled = false` |
| Events | `initial()`, `didReceiveUserProfile(UserProfilePB)`, `setSelectedPage(SettingsPage)` |
| `initial` | 1. `UserListener.start(onProfileUpdated: …)`. This subscribes to the Rust notification stream (`RustStreamReceiver`), parsing `UserNotification.DidUpdateUserProfile` and `DidOpenWorkspace` (payload `UserProfilePB`) for observable id `userProfile.id`. 2. Computes `_isBillingEnabled`. If true, emits `isBillingEnabled: true`. |
| `_isBillingEnabled` | Returns false if `workspaceType == LocalW`. Returns false if role is null or not `Owner`. Returns true if `kDebugMode`. Otherwise sends `UserEventGetCloudConfig()` → `CloudSettingPB` and checks `serverUrl ∈ {"https://beta.appflowy.cloud", "https://test.appflowy.cloud"}`. In this build this is dead logic, because `planBilling` is forced off. |
| `didReceiveUserProfile` | `emit(copyWith(userProfile))`. The menu does not read `state.userProfile`; it uses the constructor snapshot. |
| `setSelectedPage` | `emit(copyWith(page))`. There is no persistence; every open starts at `account` unless `initPage` is given. |
| `close()` | `UserListener.stop()` |
| Backend events used | `UserEventGetCloudConfig` (owner on a server workspace, release builds only). Nothing else. |

---

### C.4 Shared settings layout widgets (`lib/workspace/presentation/settings/shared/`)

All UPSTREAM (no diffs).

| Widget | Layout and visual spec |
|---|---|
| `SettingsBody({title, description?, descriptionBuilder?, autoSeparate=true, children})` | `SingleChildScrollView(ClampingScrollPhysics, padding: all 24)` → `Column(min, start)` containing `[SettingsHeader, SettingsCategorySpacer(), Flexible(SeparatedColumn(children, separator: autoSeparate ? SettingsCategorySpacer() : nothing))]` |
| `SettingsHeader({title, description?, descriptionBuilder?})` | Title: `AFT.textStyle.heading2.enhanced` (24/32, w600), `textColorScheme.primary`. Then, when a description is present: `VSpace(4)` followed by `descriptionBuilder(context)` or `Text(description, maxLines: 4, caption.standard 12/18, textColorScheme.secondary)`. |
| `SettingsCategorySpacer({topSpacing?, bottomSpacing?})` | `Padding(top: topSpacing ?? 12, bottom: bottomSpacing ?? 12)` → Material 2 `Divider(color: AFT.borderColorScheme.primary)`. The divider's box height is 16 and the line is a hairline (thickness 0, so one device pixel) centered in it. Total default block: 12 + 16 + 12 = **40px** with the line at the middle. |
| `SettingsCategory({title, description?, descriptionColor?, tooltip?, actions?, children})` | 1. A `Row` with: the title (`AFT.heading4.enhanced` 16/22 w600, `textColorScheme.primary`, maxLines 2, ellipsis); if `tooltip` is set, `HSpace(4)` and `FlowyTooltip` with `FlowySvgs.information_s` (`16x/information.svg`); `Spacer`; then `...actions`. 2. `VSpace(16)`. 3. If the description is non-empty: `FlowyText.regular(description, 12, maxLines 4, ellipsis, color: descriptionColor ?? default)` and `VSpace(8)`. 4. `SeparatedColumn(min, start, separator VSpace(16) only when children.length > 1)`. |
| `SettingsSubcategory({title, children})` | `FlowyText.medium(title, 14, AFExt.secondaryTextColor, maxLines 2)`, then `VSpace(8)`, then `SeparatedColumn` (separator VSpace 16 when more than 1 child) |
| `SettingListTile({label, hint?, trailing?, subtitle?, onResetRequested?, resetTooltipText?, resetButtonKey?})` | `Row[Expanded(Column[FlowyText.medium(label,14, ellipsis), if hint: Padding(bottom 4, FlowyText.regular(hint, 10, MT.hintColor)), ...subtitle]), ...trailing, if onResetRequested: SettingsResetButton]` |
| `SettingsResetButton` | `FlowyIconButton(width 24, hoverColor MT.colorScheme.secondaryContainer, icon FlowySvgs.restore_s (16x/restore.svg) at 20×20 tinted MT.iconTheme.color, iconColorOnHover MT.colorScheme.onPrimary)`. Tooltip `resetTooltipText ?? settings.appearance.resetSetting` "Reset". |
| `SettingsDropdown<T>({selectedOption, options, onChanged, actions?, expandWidth=true, selectOptionCompare?, textStyle?})` | `Row[Expanded(AFDropdownMenu)]`, plus `HSpace(16)` and `SeparatedRow(gap 8, actions)` when actions are given. Field: text style `textStyle ?? MT.textTheme.bodyLarge` with the app font family, w400 (Material 2 bodyLarge = 16). Content padding 12 vertical, 18 horizontal. Outline border radius 8: enabled `MT.colorScheme.outline`, focused `MT.colorScheme.primary`, error `MT.colorScheme.error`. `expandedInsets: EdgeInsets.zero` when `expandWidth` (full width), otherwise intrinsic width. Menu: max height 250, elevation 10, shadow black at 40%, background `MT.cardColor`, padding 6 horizontal and 8 vertical, aligned bottom-left. The controller's initial text is the selected option's label (or the value itself if `T` is `String`). |
| `buildDropdownMenuEntry<T>(context, {value, label, subLabel='', selectedValue?, leadingWidget?, trailingWidget?, fontFamily?, maximumHeight=29})` (`af_dropdown_menu_entry.dart`) | Entry style: foreground `MT.colorScheme.primary`, padding 6 horizontal and 4 vertical, min height 29, max height `maximumHeight`. Label: `FlowyText.regular(label, 14)` in the given Google font, or the default font. With a `subLabel`, the label becomes `Column[14 regular, VSpace 4, 10 regular]`. Trailing: `[trailingWidget, HSpace 8]` plus `FlowySvgs.check_s` (`16x/check.svg`) **only when `value == selectedValue`**. |
| `SettingsRadioSelect<T>({items: [SettingsRadioItem{value,label,isSelected,icon?}], onChanged, selectedItem?})` | `Wrap(spacing 24, runSpacing 8)`. Each item is a `GestureDetector → Row(min)` containing: (1) a 14×14 circle with a 1px border in `AFExt.textColor` and padding 2, whose inner dot is filled `AFExt.textColor` when selected; (2) `HSpace(8)`; (3) the optional icon followed by `HSpace(4)`; (4) `FlowyText.regular(label, 14)`. |
| `SettingsInputField({label?, textController?, focusNode?, obscureText=false, value?, placeholder?, tooltip?, onSave?, onCancel?, hideActions=false, onChanged?})` | 1. Optional label row: `FlowyText.medium(label, AFExt.secondaryTextColor)` plus an optional info tooltip, then `VSpace(8)`. 2. `AFTextField` (default size `l`: content padding 10 vertical and 8 horizontal, radius 10). `onSubmitted` calls `onSave`. With `obscureText`, a `PasswordSuffixIcon` eye toggle is added. 3. When the text differs from `value` (or `value` is null and the text is non-empty) and `!hideActions`: `VSpace(8)` and a `Row[Spacer, FlowyTextButton("Save" button.save, height 21, normal weight, transparent fill and hover, AFExt.textColor), HSpace(24), FlowyTextButton("Cancel" button.cancel)]`. Cancel resets the text to `value` and calls `onCancel`. |
| `SettingsActionableInput({controller, focusNode?, placeholder?, onSave?, actions})` | `Row[Flexible(SizedBox(height 48, FlowyTextField(isDense: false, suffix constraints 41×24, text 14 w500, onSubmitted: onSave)))]`, plus `HSpace(8)` and `SeparatedRow(gap 16, actions)` when actions are given. |
| `SingleSettingAction({label, description?, labelMaxLines?, buttonLabel, onPressed?, buttonType=primary, fontSize=14, fontWeight=normal, minWidth?})` | `Row[Expanded(Column[FlowyText(label, fontSize, fontWeight, AFExt.secondaryTextColor, ellipsis), if description: VSpace 4 + FlowyText.regular(desc, 11, maxLines 2)]), HSpace(24), button]`. Button: `ConstrainedBox(min and max height 32, minWidth)` → `FlowyTextButton(padding 16 horizontal / 7 vertical, radius 8, font 12, lineHeight 1.0, fontHoverColor white)`. **primary**: fill `MT.primary`, hover primary at 90%, font `MT.onPrimary`. **danger**: transparent fill, hover `MT.error` at 10%, font `MT.error`, `isDangerous`. **highlight**: transparent fill, border, font and hover all `#5C3699`. A null `onPressed` renders disabled. |
| `SettingAction({onPressed, icon, label?, tooltip?})` | `GestureDetector(opaque) → SizedBox(height 26) → FlowyHover → Padding(4 horizontal, 2 vertical) → Row[icon, if label: HSpace 4 + FlowyText.regular(label)]`. Optional `FlowyTooltip`. |
| `SettingsAlertDialog({icon?, title, subtitle?, children?, cancel?, confirm?, confirmLabel?, hideCancelButton=false, isDangerous=false, implyLeading=false, enableConfirmNotifier?})` | `StyledDialog(maxWidth 600, maxHeight 600, padding all 24)`. Contents in order: (1) top row with an optional back button (`arrow_back_m` 24 + `HSpace(8)` + "Back" `button.back` semibold 16) and a close X (`FlowySvgs.m_close_m` 20, `MT.outline`) aligned right; (2) the optional icon + `VSpace(16)`; (3) the title (`FlowyText.medium` 22, `MT.tertiary`, centered, wrapping); (4) the optional subtitle (`VSpace 16`, regular 16, centered); (5) the optional children (`VSpace 16`); (6) `VSpace(20)` when any button shows; (7) the centered actions row. Cancel button: `PrimaryRoundedButton` height 48, margin 24×12, w600, radius 12, which pops. Confirm button: `FlowyTextButton(confirmLabel ?? button.confirm "Confirm")`, height 48, padding 24×12, radius 12. Its fill is `MT.dividerColor` when disabled, `MT.error` when dangerous, else `MT.primary`. Hover is `#005483` (or error when dangerous). Gap between the buttons is 8. Shown with the `.show(context)` extension. |
| `SettingsDashedDivider({color?, height?, strokeWidth=1, gap=3, direction=horizontal})` | Dashes of length 3 (equal to `gap`) and gap 3, 1px stroke, corner radius 1, color `color ?? MT.dividerColor`. Dash count = `floor(maxWidth / (gap×2))`. Optional symmetric padding `(height − stroke)/2`. |
| `FlowyGradientButton({label, onPressed?, fontWeight=w600, textColor=white, backgroundColor?})` | Radius 16, padding 20 horizontal and 8 vertical. Text is `FlowyText` 16, maxLines 2, centered. Shadow: blur 4, offset (0, 2), black at 25%. Gradient topLeft→bottomRight `#44326B→#7547C0`, or `#39285C→#6035A4` on hover, with a 200ms animation. **Fires on pointer down**, not on tap. |
| `DocumentColorSettingButton({currentColor, previewWidgetBuilder, dialogTitle, onApply})` | `FlowyButton(margin all 8, hover MT.secondaryContainer, expandText false)` showing the preview. Tap opens a `SettingsAlertDialog(title: dialogTitle, confirm: onApply(newColor) + pop)` containing: (1) a 100×40 preview; (2) `VSpace(8)`; (3) a Form with a **Hex** `TextFormField` (label `editor.hexValue` "Hex value", hint `6fc9e7`, suffix palette button `m_aa_color_s` 20 that opens the color-picker dialog); (4) `VSpace(8)`; (5) an **Opacity** field (`editor.opacity` "Opacity", hint `50`). Both fields auto-validate on user interaction. Hex errors: empty → `settings.appearance.documentSettings.hexEmptyError` "Hex color cannot be empty"; length ≠ 6 → `hexLengthError` "Hex value must be 6 digits long"; parse fail → `hexInvalidError` "Invalid hex value". Opacity errors: empty → `opacityEmptyError` "Opacity cannot be empty"; not an int in 1..100 → `opacityRangeError` "Opacity must be between 1 and 100". Color value = `int.parse('0x' + hex(round(opacity×2.55)) + hex6)` (see ambiguity A6). Color-picker dialog: `showDialog(barrierColor Color(0x80000000) = rgba(0,0,0,0.5))` → `FlowyDialog(expandHeight false)`. Its title row is `m_aa_color_s`, `HSpace(12)` and "Select a color" (`settings.appearance.documentSettings.pickColor`) at 20. It uses flex_color_picker's `ColorPicker` (primary, accent and wheel pickers enabled; "both" disabled; opacity enabled; 32×32 swatches with radius 20; opacity thumb radius 23; column spacing 12; subheadings "Color shade" and "Opacity"). Actions: Cancel (transparent, height 24, padding 24×12, radius 12), which resets to the original color and pops; Done (`button.done`, primary fill, hover `#005483`, height 48), which applies and pops. |
| `SettingValueDropDown` (`setting_value_dropdown.dart`) | `AppFlowyPopover(bottomWithCenterAligned, margin 6, constraints min width 80, max width 160, max height 400)`. The default child is a `FlowyTextButton(currentValue)`. |

---

### C.5 Account page ("Account & App")

Files:
- `lib/workspace/presentation/settings/pages/settings_account_view.dart`
- `pages/account/{account_user_profile, email/email_section, account_sign_in_out, password/change_password, password/setup_password, password/error_extensions, password/password_suffix_icon, account_deletion}.dart`
- `pages/about/app_version.dart`

Bloc: `SettingsUserViewBloc` (`lib/workspace/application/user/settings_user_bloc.dart`), obtained with `getIt<SettingsUserViewBloc>(param1: userProfile)` and sent `initial`.
- On `initial`, it calls `UserEventGetUserProfile()` → `UserProfilePB` → `didReceiveUserProfile`, and starts a `UserListener` that also handles `didReceiveUserProfile`.
- Every update goes through `UserBackendService.updateUserProfile` → **`UserEventUpdateUserProfile(UpdateUserProfilePayloadPB)`**. Payload fields: `id: i64` (required, `userProfile.id`), and the `one_of` fields `name` (2), `email` (3), `password` (4), `icon_url` (5). Only the changed field is set.
- Errors are only logged; there is no UI feedback.

Page = `SettingsBody(title: newSettings.myAccount.title "Account & App", autoSeparate: true)`. Children in order:

| # | Section (`SettingsCategory` title) | Visible when (`isAuthEnabled` as in C.1, `authType = state.userProfile.userAuthType`) | Contents |
|---|---|---|---|
| 1 | `newSettings.myAccount.myProfile` → "My Profile" | always | `AccountUserProfile` (below) |
| 2 | `newSettings.myAccount.myAccount` → "My Account" | `isAuthEnabled && authType != AuthTypePB.Local` (a signed-in server user) | `SettingsEmailSection`, `ChangePasswordSection`, `AccountSignInOutSection(signIn: false)` (Log out), separated by VSpace 16 |
| 3 | `settings.accountPage.login.title` → "Account login" | `isAuthEnabled && authType == AuthTypePB.Local` (server configured, user still local or anonymous) | `AccountSignInOutSection(signIn: true)` (Log in) |
| 4 | `newSettings.myAccount.aboutAppFlowy` → "About AppFlowy" | always | `SettingsAppVersion` |
| 5 | (no category) `AccountDeletionButton` | `widget.userProfile.userAuthType == AuthTypePB.Server` (constructor snapshot; **no** `isAuthEnabled` check) | below |

Resulting variants in this build:
- Pure local (no server): sections 1 and 4.
- Self-host configured with a local user: 1, 3, 4.
- Self-host server user: 1, 2, 4, 5.

#### Controls

| Control | Type and visual | Label keys | Behavior, validation, backend |
|---|---|---|---|
| Avatar | `AFAvatar(url: iconUrl, name, size l = 48px; initials use heading3 20/28)` inside `FlowyHover(transparent, radius 100)` with tooltip `settings.accountPage.general.changeProfilePicture` "Change profile picture" (verticalOffset 28). Followed by `HSpace(16)` before the name. | — | Tap opens a Material `SimpleDialog` containing a 360×380 `FlowyIconEmojiPicker(tabs: [emoji])` (**emoji only, no image upload**). Selecting an emoji sends `SettingsUserEvent.updateUserIcon(iconUrl: emoji)` → `UserEventUpdateUserProfile{id, icon_url: "<emoji char>"}` and closes the picker. `removeUserIcon` exists (`icon_url: ""`) but has no UI. |
| Name (display mode) | `Padding(top 12) → Row[Text(name, AFT.body.standard 14/20, primary, ellipsis), HSpace 4, AFGhostButton.normal(size s, padding 4) with FlowySvgs.toolbar_link_edit_m (20x/toolbar_link_edit.svg) at 20]` | — | Clicking the pencil enters edit mode. |
| Name (edit mode) | `SettingsInputField(value: name)` with Save/Cancel text buttons that appear once the text changes; the field is auto-focused | `button.save` "Save", `button.cancel` "Cancel" | Save triggers: Enter, the Save button, **or focus loss**. It calls `onSave(text)`: the parent first does an optimistic `setState(userName = newName)`, then `updateUserName` → `UserEventUpdateUserProfile{id, name}`. **No validation; an empty name is sent as-is.** Esc (KeyDown) exits edit mode without saving. Cancel button: see ambiguity A4. |
| Email | `Column[Text(settings.accountPage.email.title "Email", AFT.body.enhanced 14/20 w600, primary), VSpace 6, Text(userProfile.email, caption.standard 12/18, secondary)]` | `settings.accountPage.email.title` | Read-only. `updateUserEmail` exists in the bloc but has no UI. |
| Password | `Row[Text("Password" body.enhanced), Spacer, AFFilledTextButton.primary(size m: padding 16×6, radius 8, body.enhanced)]` | `newSettings.myAccount.password.title` "Password". Button label: `...password.changePassword` "Change password" when `PasswordState.hasPassword`, else `...password.setupPassword` "Setup password" | **Not protobuf: direct HTTP to the self-host GoTrue** (`lib/user/application/password/password_http_service.dart`). Base URL is KV `kAppFlowyCloudBaseURL`. Headers: `Content-Type: application/json` and `Authorization: Bearer <jsonDecode(userProfile.token)['access_token']>`. `checkHasPassword`: `GET {base}/gotrue/user/auth-info` → `has_password`. A 403 or any failure is treated as no password. The `PasswordBloc` skips init when `userAuthType == Local`. |
| Change password dialog | `showDialog(barrierDismissible: false)` → `Dialog(radius 16)` → `ChangePasswordDialogContent`: padding 20 horizontal and 16 vertical, max width 400. Title row: "Change password" (`AFT.heading4.prominent` 16/22 w700) and a close `AFGhostButton` (`password_close_m` 20). Then 16 gaps between three fields, each a label (`caption.enhanced`, secondary) + `VSpace(4)` + `AFTextField` (obscured, eye toggle `show_s`/`hide_s` 20 with right padding 8). Footer row (end-aligned): `AFOutlinedTextButton.normal("Cancel")`, `HSpace(12)`, `AFFilledTextButton.primary("Save")`. | Labels `newSettings.myAccount.password.currentPassword` "Current password", `.newPassword` "New password", `.confirmNewPassword` "Confirm new password". Hints `.hint.enterYourCurrentPassword` "Enter your current password", `.hint.enterYourNewPassword` "Enter your new password", `.hint.confirmYourNewPassword` "Confirm your new password". | Client-side checks, in order; the first failure sets an inline field error and stops: (1) current empty → `.error.currentPasswordIsRequired` "Current password is required"; (2) new empty → `.error.newPasswordIsRequired` "New password is required"; (3) confirm empty → `.error.confirmPasswordIsRequired` "Confirm password is required"; (4) new ≠ confirm → `.error.passwordsDoNotMatch` "Passwords do not match" (shown on the confirm field); (5) new == current → `.error.newPasswordIsSameAsCurrent` "New password is same as current password". Request: `POST {base}/gotrue/user/change-password` with body `{"current_password": "...", "password": "..."}`. HTTP 422 → `ErrorCode.NewPasswordTooWeak`. Server error mapping: body `msg` matching "Incorrect current password" → `.error.currentPasswordIsIncorrect` "Current password is incorrect" on the current field. "Password should be at least (\d+) characters" → `.error.passwordShouldBeAtLeast6Characters` "Password should be at least {min} characters" on the new field. "Password cannot be longer than (\d+) characters" → `...72Characters` "Password cannot be longer than {max} characters". Weak → `signIn.passwordMustContain` "Password must contain at least one letter, one number, and one symbol." Anything else → the raw `msg`. On success: toast `.toast.passwordUpdatedSuccessfully` "Password updated successfully" and the dialog closes. |
| Setup password dialog | Same shell. Title "Setup password". Fields: `.password.title` "Password" (hint `.hint.confirmYourPassword` "Confirm your password") and `.password.confirmPassword` "Confirm password". | as listed | Checks: password empty → `newPasswordIsRequired`; confirm empty → `confirmPasswordIsRequired`; mismatch → `passwordsDoNotMatch`. Request: `POST {base}/gotrue/user/change-password` with body `{"password": "..."}`. On success: `hasPassword = true`, toast `.toast.passwordSetupSuccessfully` "Password setup successfully", and the dialog closes. |
| Log out | `Row[Text("Account login" body.enhanced), Spacer, AFFilledTextButton.primary("Log out")]` | `settings.accountPage.login.title`, `settings.accountPage.login.logoutLabel` "Log out" | Opens `showCancelAndConfirmDialog`: a `Dialog(radius 12)` → 440-wide `ConfirmPopup`, with title "Log out", description `settings.menu.logoutPrompt` "Are you sure you want to log out?", confirm `button.yes` "Yes" in the primary color, Cancel button, Enter confirms, Esc closes. On confirm: `AuthService.signOut()` → **`UserEventSignOut()`**, then `didLogout` (pop the settings dialog and `runAppFlowy()`). |
| Log in | Same row, button `settings.accountPage.login.loginLabel` "Log in" | — | Opens `FlowyDialog(constraints max width 375, max height 485)` → `Scaffold > Padding(24) > scroll Column`. Header row: Back (`arrow_back_m` 24 + "Back" semibold 16) and close (`m_close_m` 20). Title "Log in" (medium 22, `MT.tertiary`, centered). `VSpace(16)`. `ContinueWithEmailAndPassword` (sign-in widget, specified elsewhere). Then, when `isAuthEnabled`: `VSpace(20)`, an "or" divider (`signIn.or`), `VSpace(10)`, and `SettingThirdPartyLogin` (`ThirdPartySignInButtons`, a sync progress bar with `signIn.syncPromptMessage`; success → `didLogin` and `runAppFlowy()`). See ambiguity A5. |
| App version | `Column[Text(settings.accountPage.isUpToDate "AppFlowy is up to date!", body.enhanced), VSpace 6, Text(settings.accountPage.officialVersion "Version {version} (Official build)", caption.standard secondary)]` with `{version} = ApplicationInfo.applicationVersion` | as listed | The "update available" variant (red dot, `autoUpdate.settingsUpdateTitle`, Update button → `versionChecker.checkForUpdate()`, "What's new" link) shows only when `ApplicationInfo.isUpdateAvailable`. **[CUSTOM]** `AutoUpdateTask` was removed from startup, so `latestVersion` stays empty and this variant never renders. The "What's new" link would also be blocked by the vendor-host policy. |
| Delete account | `Row[Expanded(Column[Text(button.deleteAccount "Delete account", heading4.enhanced 16/22 w600), VSpace 4, Text(newSettings.myAccount.deleteAccount.description "Permanently delete your account and remove access from all workspaces.", caption.standard secondary, maxLines 2)]), AFOutlinedTextButton.destructive("Delete account", body.standard in AFT.textColorScheme.error)]` | as listed | Opens `showCancelAndDeleteDialog` (440 wide, `closeOnAction: false`) with title `newSettings.myAccount.deleteAccount.title` "Delete Account" and an empty description. Body, in order: (1) `confirmHint1` "Please type "DELETE MY ACCOUNT" to confirm." (14, line height 18); (2) `VSpace(12)`; (3) a `FlowyTextField` with hint `confirmHint3` "DELETE MY ACCOUNT"; (4) `VSpace(16)`; (5) a checkbox row (`check_filled_s`/`uncheck_s` 16, `HSpace(6)`, `confirmHint2` "I understand that this action is irreversible and will permanently delete my account and all associated data."). Confirm button: "Delete" (`space.delete`), red. Validation: unchecked → warning toast `checkToConfirmError` "You must check the box to confirm deletion". The trimmed text must be exactly one of `delete my account`, `deletemyaccount`, `DELETE MY ACCOUNT`, `DELETEMYACCOUNT`, or the localized `confirmHint3`; otherwise warning toast `confirmTextValidationFailed` 'Your confirmation text does not match "DELETE MY ACCOUNT"'. Then a loading overlay and **`UserEventDeleteAccount()`** (no payload). Success: toast `deleteAccountSuccess` "Account deleted successfully"; after 1 second, `context.popToHome()` and `runAppFlowy()`. Failure: error toast with `f.msg`. |

There is no third-party account linking UI on this page. The only third-party login surface is inside the "Log in" dialog.

---

### C.6 Workspace page (appearance, language, date/time)

Files:
- `lib/workspace/presentation/settings/pages/settings_workspace_view.dart` (UPSTREAM, no diff)
- `lib/workspace/application/settings/workspace/workspace_settings_bloc.dart`
- `lib/workspace/application/settings/appearance/appearance_cubit.dart`
- `lib/plugins/document/application/document_appearance_cubit.dart`

#### WorkspaceSettingsBloc

| Event | Backend |
|---|---|
| `initial(userProfile)` | `FolderEventReadCurrentWorkspace()` → `WorkspacePB`. Then `UserEventGetAllWorkspace()` → `RepeatedUserWorkspacePB.items`; if empty, a stub is synthesized from the current workspace. Picks the entry with a matching id, or the first. Emits `workspace`, then `UserEventGetWorkspaceMembers(QueryWorkspacePB{workspace_id})` → `members`. The member list is loaded but not shown on this page. |
| `updateWorkspaceName(name)` | `UserEventRenameWorkspace(RenameWorkspacePB{workspace_id, new_name})`. On success, updates `state.workspace.name`. |
| `updateWorkspaceIcon(icon)` | `UserEventChangeWorkspaceIcon(ChangeWorkspaceIconPB{workspace_id, new_icon})`. On success, updates `state.workspace.icon`. |
| `deleteWorkspace()` / `leaveWorkspace()` | Sets a flag only. The view listener then sends `UserWorkspaceEvent.deleteWorkspace` / `leaveWorkspace(workspaceId)` to `UserWorkspaceBloc` and calls `Navigator.pop()` (closes the settings dialog). In `UserWorkspaceBloc`: **delete** fails with `workspace.cannotDeleteTheOnlyWorkspace` when local or remote workspace count is ≤ 1; otherwise `UserEventDeleteWorkspace(UserWorkspaceIdPB{workspace_id})`, then it opens the first remaining workspace. **Leave** sends `UserEventLeaveWorkspace(UserWorkspaceIdPB{workspace_id})`, then opens the first remaining workspace if the current one was left. |

#### AppearanceSettingsCubit persistence

The cubit is created at app start from `UserEventGetAppearanceSetting` and `UserEventGetDateTimeSettings`.
- Every appearance setter mutates an in-memory `AppearanceSettingsPB` and sends the **whole message** through `UserEventSetAppearanceSetting(AppearanceSettingsPB)`. Rust stores it in `KVStorePreferences` under key `"appearance_settings"` (device-local, not synced).
- Date and time setters send the whole `DateTimeSettingsPB` through `UserEventSetDateTimeSettings`, stored under key `"date_time_settings"`.
- Errors are only logged.

`AppearanceSettingsPB` fields and defaults (Rust defaults in `rust-lib/flowy-user/src/entities/user_setting.rs`):

| # | Field | Default |
|---|---|---|
| 1 | `theme` | `"Default"` |
| 2 | `theme_mode` (`ThemeModePB`: Light=0, Dark=1, System=2) | System |
| 3 | `font` | `""` (system font) |
| 4 | `monospace_font` | `"SF Mono"` (unused here) |
| 5 | `locale: LocaleSettingsPB{language_code, country_code}` | `{"en", ""}` |
| 6 | `reset_to_default` | true. On the first launch the app adopts the device locale and clears this flag. |
| 7 | `setting_key_value` | map |
| 8 | `is_menu_collapsed` | — |
| 9 | `menu_offset` | — |
| 10 | `layout_direction` (`LTRLayout=0`, `RTLLayout=1`) | LTR |
| 11 | `text_direction` (`LTR=0`, `RTL=1`, `AUTO=2`, `FALLBACK=3`) | FALLBACK, which the UI reads as LTR |
| 12 | `document_setting: DocumentSettingsPB{cursor_color?, selection_color?}` | Strings like `"0xaarrggbb"`; empty means default |
| 13 | `enable_rtl_toolbar_items` | false |

`DateTimeSettingsPB`:

| # | Field | Default |
|---|---|---|
| 1 | `date_format` (`UserDateFormatPB`) | Friendly |
| 2 | `time_format` (`UserTimeFormatPB`: TwelveHour=0, TwentyFourHour=1) | TwentyFourHour |
| 3 | `timezone_id` | `""` |

`DocumentAppearanceCubit` writes a second, parallel copy to **SharedPreferences** (the same store as `KeyValueStorage`). Keys from `lib/core/config/kv_keys.dart`: `kDocumentAppearanceCursorColor`, `kDocumentAppearanceSelectionColor`, `kDocumentAppearanceDefaultTextDirection`, `kDocumentAppearanceWidth`, plus `kDocumentAppearanceFontSize` and `kDocumentAppearanceFontFamily` (not on this page).

#### Page layout

`SettingsBody(title: settings.workspacePage.title "Workspace", description: settings.workspacePage.description "Customize your workspace appearance, theme, font, text layout, date-/time-format, and language.", autoSeparate: false)`. Children in exact order. "Spacer" means `SettingsCategorySpacer` (a 40px block with a divider line).

| # | Element | Visible when |
|---|---|---|
| 1 | `SettingsCategory("Workspace name")` → `_WorkspaceNameSetting` | `userProfile.workspaceType != LocalW` |
| 2 | Spacer | same |
| 3 | `SettingsCategory("Workspace icon", description)` → `_WorkspaceIconSetting` | same |
| 4 | Spacer | same |
| 5 | `SettingsCategory("Appearance")` → `AppearanceSelector` | always |
| 6 | `VSpace(16)` (no divider) | always |
| 7 | `SettingsCategory("Theme", description)` → `[_ThemeDropdown, _DocumentCursorColorSetting, _DocumentSelectionColorSetting, DocumentPaddingSetting]` | always |
| 8 | Spacer | always |
| 9 | `SettingsCategory("Workspace font")` → `[_FontSelectorDropdown, SettingsDashedDivider(color MT.outline), SettingsCategory("Text direction") → [TextDirectionSelect, EnableRTLItemsSwitcher]]` | always |
| 10 | `VSpace(16)` (no divider) | always |
| 11 | `SettingsCategory("Layout direction")` → `_LayoutDirectionSelect` | always |
| 12 | Spacer | always |
| 13 | `SettingsCategory("Date & time")` → `[_DateTimeFormatLabel, _TimeFormatSwitcher, SettingsDashedDivider(MT.outline), _DateFormatDropdown]` | always |
| 14 | Spacer | always |
| 15 | `SettingsCategory("Language")` → `LanguageDropdown` | always |
| 16 | Spacer | always |
| 17 | `SingleSettingAction` "Manage workspace" (Delete or Leave) | `workspaceType != LocalW` |

#### Control specs (in order)

| Control | Label key → English | Type, visual and options | Default | Persistence and side effects |
|---|---|---|---|---|
| Workspace name | `settings.workspacePage.workspaceName.title` → "Workspace name" | **Owner**: `SettingsInputField(hideActions: true)` with no Save/Cancel buttons. **Non-owner or null role**: `FlowyText.regular(name, 14)` with 2.5 vertical padding (read-only). The text is filled from bloc state, so it starts empty until `initial` resolves. | Current workspace name | `onChanged` is debounced **300ms**, and Enter (`onSubmitted`) saves immediately. Each save calls `updateWorkspaceName` → `UserEventRenameWorkspace{workspace_id, new_name}`, skipped when the name is empty. |
| Workspace icon | `settings.workspacePage.workspaceIcon.title` → "Workspace icon"; description `...workspaceIcon.description` → "Upload an image or use an emoji for your workspace. Icon will show in your sidebar and notifications." | `WorkspaceIcon` (`lib/workspace/presentation/home/menu/sidebar/workspace/_sidebar_workspace_icon.dart`): 64×64, radius 18, emoji size 24, and a letter fallback at font 24 / line height 26 with `ColorGenerator(name)` colors. While the workspace is loading, a 64×64 `CircularProgressIndicator` shows instead. Click opens `AppFlowyPopover(bottomWithLeftAligned, loose 364×356)` → `FlowyIconEmojiPicker(tabs: [emoji])`. **Emoji only, despite the "upload an image" copy.** The icon is wrapped in `IgnorePointer` unless the role is Owner. | "" | `UserEventChangeWorkspaceIcon{workspace_id, new_icon: emoji}` |
| Appearance mode | `settings.workspacePage.appearance.title` → "Appearance". Card labels `...appearance.options.system` "Auto", `.light` "Light", `.dark` "Dark". | A row of 3 cards in `ThemeMode.values` order **system, light, dark**, each followed by 16px right padding. Card: 88×72 with a 1px border, `MT.colorScheme.onSecondary` when selected and `MT.colorScheme.outline` otherwise, radius 4. Background image `assets/images/appearance/{system,light,dark}.png` (cover). The selected card shows a 16px circular badge at (4, 4) with elevation 2 and `FlowySvgs.settings_selected_theme_m` (`24x/settings_selected_theme.svg`, 16px, `BlendMode.dstIn`). Below the card: `VSpace(6)` and `FlowyText.regular(label)` centered. Hover is transparent, with the foreground in `AFExt.textColor`. | System | `AppearanceSettingsPB.theme_mode` (Light=0, Dark=1, System=2). Side effect: `MaterialApp.themeMode` switches and the whole app re-themes. |
| Theme (color scheme) | `settings.workspacePage.theme.title` → "Theme"; description `...theme.description` → "Select a preset theme, or upload your own custom theme." | `SettingsDropdown<String>` (full width) with actions `[upload, reset]`. Options, in order: built-in **Default, Dandelion, Lemonade, Lavender** (`packages/flowy_infra/lib/colorscheme/colorscheme.dart` `themeMap`), then custom plugin themes. Each entry has a leading 16×16 swatch with radius 4, a 1px `MT.outline` border, and fill = that theme's `sidebarBg` for the current brightness. Label is `themeName`; the selected entry shows a check. Custom entries also get a trailing `FlowyIconButton(delete_s)`, which sends `DynamicPluginEvent.removePlugin(name)` (deletes the plugin folder) and resets to the first built-in theme if the deleted one was active. **Upload action**: `SettingAction(folder_m (24x/folder.svg) at 20, tooltip settings.workspacePage.theme.uploadCustomThemeTooltip "Upload a custom theme")` → `FlowyDialog(maxHeight 300)` → `ThemeUploadWidget` (`settings.appearance.themeUpload.*`, button "Upload"). It opens a **directory** picker for a folder named `<name>.flowy_plugin` containing `*.light.json` and `*.dark.json` `FlowyColorScheme` files. The folder is copied into the app documents directory. On success, a snackbar `settings.appearance.themeUpload.uploadSuccess` "Your theme was uploaded successfully". **Reset action**: `SettingAction(restore_s 20 + settings.common.reset "Reset")` → `setTheme("Default")`. | "Default" | `AppearanceSettingsPB.theme` (name string). Side effect: `AppTheme.fromName` rebuilds `ThemeData` app-wide. On failure, macOS only shows a toast `settings.workspacePage.theme.failedToLoadThemes`. |
| Document cursor color | `settings.appearance.documentSettings.cursorColor` → "Document cursor color" | `SettingListTile` with a `DocumentColorSettingButton`. Preview: a 2×16 color bar followed by "AppFlowy" (`appName`) in `AFExt.onBackground`. The reset button shows a confirm. Reset dialog (`showConfirmDialog`, cancel-and-ok style, 440 wide): title `settings.workspacePage.resetCursorColor.title` "Reset document cursor color", description `...resetCursorColor.description` "Are you sure you want to reset the cursor color?", confirm `settings.common.reset` "Reset" in the error color. | `MT.colorScheme.primary` | Apply: `AppearanceSettingsPB.document_setting.cursor_color = color.toHexString()` (`"0xaarrggbb"`) **and** SharedPreferences `kDocumentAppearanceCursorColor` set to the same string. Reset: `cursor_color = ""` and the SharedPreferences key is removed. The editor caret uses it. |
| Document selection color | `settings.appearance.documentSettings.selectionColor` → "Document selection color" | Same as the cursor color control. Preview: "App" (`...documentSettings.app`) on the color background followed by "Flowy" (`...documentSettings.flowy`). Reset title `...resetSelectionColor.title` "Reset document selection color", description "Are you sure you want to reset the selection color?". | `MT.colorScheme.primary` at 20% alpha | `document_setting.selection_color` and SharedPreferences `kDocumentAppearanceSelectionColor` (same pattern) |
| Document width | `settings.appearance.documentSettings.width` → "Document width" | `Column[Row[FlowyText.medium(label), Spacer, SettingsResetButton (no confirm)], VSpace 6, Container(height 32, padding right 4, Slider)]`. Slider: min **480**, max **1920** (`EditorStyleCustomizer.min/maxDocumentWidth`), `divisions: 10` (step 144), thumb radius 8, no overlay, no value indicator. | 1920 (desktop) | SharedPreferences `kDocumentAppearanceWidth` (double, clamped), written on every `onChanged`. Reset writes 1920. Not stored in protobuf. |
| Workspace font | `settings.workspacePage.workspaceFont.title` → "Workspace font" | `Row[Expanded(FlowyTextField), HSpace 16, Reset]`. Text field: shows the display name of the current font, a `Icons.arrow_drop_down` suffix, content padding 12 vertical and 18 horizontal, radius 8 borders (`MT.outline`, focused `MT.primary`). Pointer-down on the field focuses it and opens the popover; typing filters the list. Popover: `bottomWithLeftAligned`, margin 0, radius 4, max height 150, max width = available width − 90. List: `ListView.separated` with padding 6 horizontal and 8 vertical, separator 6, initial scroll offset = index × 32. Rows are `ListTile`s 29px tall (dense, padding 6 horizontal and 4 vertical, hover `MT.onSurface` at 12%, selected `MT.primary` at 12%). Each row's title is the display name rendered **in that font** (`getGoogleFontSafely`), with a trailing `check_s` when selected. Options: `""` (displayed as `settings.appearance.fontFamily.defaultFont` "System") followed by **all keys of `GoogleFonts.asMap()`** (the google_fonts package catalog; fonts are fetched at runtime). Filter: case-insensitive substring match on the raw name or the display name; typing a substring of "system" keeps `""` at the top. If nothing matches: `settings.workspacePage.workspaceFont.noFontHint` "No font found, try another term." Selecting an option sets the font, puts its display name in the field and closes the popover. Reset: a 26px-tall hover button (`restore_s` 20 + "Reset"). | `""` (System) | `AppearanceSettingsPB.font` (family name). Reset writes `""`. Side effect: app `ThemeData` is rebuilt with the new font family across the **whole UI**. |
| Text direction (nested category) | `settings.workspacePage.textDirection.title` → "Text direction". Items `...leftToRight` "Left to right", `...rightToLeft` "Right to left", `...auto` "Auto". | `SettingsRadioSelect` with icons `textdirection_ltr_m`, `textdirection_rtl_m`, `textdirection_auto_m` (`24x/textdirection_{ltr,rtl,auto}.svg`) | LTR (proto FALLBACK) | `AppearanceSettingsPB.text_direction` (LTR=0, RTL=1, AUTO=2) **and** `DocumentAppearanceCubit.syncDefaultTextDirection(name)` → SharedPreferences `kDocumentAppearanceDefaultTextDirection` = `"ltr"`, `"rtl"` or `"auto"`. Sets the default text direction of editor blocks. |
| Enable RTL toolbar items | `settings.workspacePage.textDirection.enableRTLItems` → "Enable RTL toolbar items" | `Row[Expanded(FlowyText.regular(label, 16)), HSpace 16, Toggle]`. `Toggle` (big style): track 27×16 with radius 8, thumb 14 in white, padding 8, 150ms animation. Track color is `MT.primary` when on and `AFExt.toggleButtonBGColor` when off. | false | `AppearanceSettingsPB.enable_rtl_toolbar_items`. The editor toolbar adds or removes the text-direction items (`editor_page.dart` `_setRTLToolbarItems`). |
| Layout direction | `settings.workspacePage.layoutDirection.title` → "Layout direction". Items `...layoutDirection.leftToRight` "Left to right", `...rightToLeft` "Right to left". | `SettingsRadioSelect` (icons `textdirection_ltr_m`, `textdirection_rtl_m`) | LTR | `AppearanceSettingsPB.layout_direction` (LTRLayout=0, RTLLayout=1). Consumers: the document editor `TextDirection` (`editor_page.dart`) and the block-action popover side (`block_action_option_button.dart`). See ambiguity A8. |
| Date/time example | `settings.workspacePage.dateTime.title` → "Date & time"; example `settings.workspacePage.dateTime.example` → "{} at {} ({})" | `FlowyText.regular(..., 16, AFExt.secondaryTextColor, maxLines 2)`. Arguments: `dateFormat.formatDate(now, false)`, `timeFormat.formatTime(now)`, `now.timeZoneName`. Computed at build time. | — | — |
| 24-hour time | `settings.workspacePage.dateTime.24HourTime` → "24-hour time" | `Row[Expanded(FlowyText.regular(label, 16)), HSpace 16, Toggle]`. On = `TwentyFourHour`. | On (24h) | `DateTimeSettingsPB.time_format` via `UserEventSetDateTimeSettings`. Formats: 24h = `DateFormat.Hm()`, 12h = `DateFormat.jm()`. |
| Date format | `settings.workspacePage.dateTime.dateFormat.label` → "Date format" | `Padding(top 8) → Column[FlowyText.regular(label, 16), VSpace 8, SettingsDropdown<UserDateFormatPB>(expandWidth false)]`. Options in enum order: Locally → `...dateFormat.local` "Local" (`MM/dd/y`); US → `.us` "US" (`y/MM/dd`); ISO → `.iso` "ISO" (`y-MM-dd`); Friendly → `.friendly` "Friendly" (`MMM dd, y`); DayMonthYear → `.dmy` "D/M/Y" (`dd/MM/y`). The entries are built **without `selectedValue`**, so no check mark appears. | Friendly | `DateTimeSettingsPB.date_format` (Locally=0, US=1, ISO=2, Friendly=3, DayMonthYear=4). Used by database date fields and similar. |
| Language | `settings.workspacePage.language.title` → "Language" | `SettingsDropdown<Locale>(key 'LanguageDropdown', expandWidth false)` with a check on the selected entry. Options are the `EasyLocalization` `supportedLocales`, in this order: am-ET, ar-SA, ca-ES, cs-CZ, ckb-KU, de-DE, en-US, en-GB, es-VE, eu-ES, el-GR, fr-FR, fr-CA, he, hu-HU, id-ID, it-IT, ja-JP, ko-KR, pl-PL, pt-BR, ru-RU, sv-SE, th-TH, tr-TR, uk-UA, ur, vi-VN, zh-CN, zh-TW, fa, hin, mr-IN (`lib/startup/tasks/app_widget.dart`). Labels come from `languageFromLocale` (`packages/flowy_infra/lib/language.dart`): native names, e.g. "English (US)", "English (GB)", "简体中文", "繁體中文", "Deutsch", "Français (FR)", "Français (CA)", "Español", "עברית", "हिन्दी". Unmapped codes such as `vi` fall back to the raw language code. | Device locale on first run, else the saved locale | `AppearanceSettingsPB.locale{language_code, country_code}`. An unsupported locale falls back to en-US. Side effects: `context.setLocale` re-translates the whole UI live, and `AppFlowyEditorLocalizations.load(locale)` updates the editor. |
| Manage workspace | `settings.workspacePage.manageWorkspace.title` → "Manage workspace" | `SingleSettingAction(fontSize 16, w600, buttonType danger)`. Button label: Owner → `...manageWorkspace.deleteWorkspace` "Delete workspace"; others → `...manageWorkspace.leaveWorkspace` "Leave workspace". | — | Opens `showConfirmDialog(style: cancelAndOk)`. Owner: title `settings.workspacePage.deleteWorkspacePrompt.title` "Delete workspace", content `...deleteWorkspacePrompt.content` "Are you sure you want to delete this workspace? This action cannot be undone, and any pages you have published will be unpublished." Others: `...leaveWorkspacePrompt.title` "Leave workspace", `...leaveWorkspacePrompt.content` "Are you sure you want to leave this workspace? You will lose access to all pages and data within it." The confirm button uses the ConfirmPopup default `space.delete` "**Delete**" in red in **both** cases. Then the delete or leave flow from the bloc table above, and the settings dialog closes. |

Sections that are **not** on this page: text scale or font size (document font size lives in the editor), sidebar toggles, and notification toggles (separate page).

#### Role and workspace-type matrix (Workspace page)

The role comes from `UserWorkspaceBloc.state.currentWorkspace?.role`. Proto default: unset reads as Owner.

| Capability | Owner | Member | Guest | `LocalW` (local or offline workspace) |
|---|---|---|---|---|
| Name section visible | yes, editable with auto-save | yes, read-only text | yes, read-only | hidden |
| Icon section visible | yes, clickable | yes, non-interactive | yes, non-interactive | hidden |
| Appearance, theme, font, direction, date and time, language | yes | yes | yes | yes (device-local settings, identical for every role) |
| Manage workspace | "Delete workspace" (blocked if it is the only workspace) | "Leave workspace" | "Leave workspace" | hidden |
| Menu: Members / Sites (C.2) | shown (`ServerW`) | shown (`ServerW`) | hidden | hidden |

---

### C.1–C.6 ambiguities and quirks

- **A1** — `UserWorkspacePB.role` is a proto `one_of` with Dart default `AFRolePB.Owner`, so `role == null` happens only when `currentWorkspace` is null. In a `LocalW` workspace, Owner checks therefore pass. This matters little because the name, icon and manage sections are hidden for `LocalW`.
- **A2** — The menu uses the `UserProfilePB` and role snapshot taken when the dialog opened. Page content uses the live `UserWorkspaceBloc` state. A role or workspace switch while the dialog is open does not refresh the menu.
- **A3** — `sidebar_toast.dart` can still open the dialog with `initPage: SettingsPage.plan`. The Plan item is hidden (planBilling is forced off), but the Plan page would render. Whether that toast can appear in a self-host build is unverified.
- **A4** — Name edit: focus loss triggers save. Clicking the inline "Cancel" button probably blurs the field first, which saves the typed text before Cancel resets it. This is unverified at runtime; for strict parity, treat blur as save.
- **A5** — **[CUSTOM]** The desktop sign-in screen removed `ThirdPartySignInButtons`, but the Account page's "Log in" dialog still renders `SettingThirdPartyLogin` when `isAuthEnabled`. This inconsistency may be unintended.
- **A6** — `combineHexWithOpacity` does not zero-pad the alpha byte: opacity below 7% produces a single hex digit, and the parsed color is wrong. `toHexString` lowercases its output.
- **A7** — `AppearanceSelector` reads `themeMode` with `context.read` and does not subscribe. The selected badge refreshes only when the dialog rebuilds, for example after a brightness change.
- **A8** — Layout direction RTL only affects the editor and the popover side. The app shell or `Directionality` was not found to flip.
- **A9** — The "Storage & server" and "Certificates" menu labels and the certificates page strings are hard-coded English, so they are not localized.
- **A10** — Text in `SettingsMenuElement` has no `overflow` or `maxLines`, so long translations wrap inside the 180px item.

---

### C.7–C.9 preamble: Storage & server, AI endpoint, Company certificates

Paths are relative to `D:\Projects\appflowy\frontend`. `lib/` = `appflowy_flutter/lib/`. **[CUSTOM]** = added or changed in this checkout (from `git status`/`git diff`). **[UPSTREAM]** = unchanged AppFlowy code. Strings in `'single quotes'` are hardcoded literals, not localized. Localized strings are written as `i18n.key` = "English".

#### Menu entries for C.7–C.9 (`lib/workspace/presentation/settings/widgets/settings_menu.dart`, `settings_dialog.dart`, `workspace/application/settings/settings_dialog_bloc.dart`)

`SettingsPage` enum order **[CUSTOM]**: `account, workspace, manageData, shortcuts, ai, plan, billing, sites, notifications, cloud, companyCertificates (new), member, featureFlags`.

Full desktop menu order (`SettingsMenu`, width 204): Account, Workspace, [Members], Manage data, Notifications, **Storage & server**, **Certificates**, Shortcuts, **AI Settings**, [Sites], [Plan, Billing], [Feature Flags].

| Menu item | SettingsPage | Label | Icon | Visibility | Page widget (`SettingsDialog.getSettingsView`) |
|---|---|---|---|---|---|
| Storage & server | `cloud` | `'Storage & server'` [CUSTOM; upstream `settings.menu.cloudSettings` = "Cloud Settings"] | `FlowySvgs.settings_page_cloud_m` | always | `SettingCloud(restartAppFlowy: () => restartApp())` → `SelfHostedSettingsView(restartApp)` |
| Certificates | `companyCertificates` [CUSTOM] | `'Certificates'` | Material `Icons.verified_user_outlined`, size 20 | always (on every OS; the page shows a notice off Windows) | `const CompanyCertificatesSettingsView()` |
| AI Settings | `ai` | `settings.aiPage.menuLabel` = "AI Settings" | `FlowySvgs.settings_page_ai_m` | always | always `LocalSettingsAIView(key: ValueKey(workspaceId), userProfile, workspaceId)` → `const OpenAIEndpointSettingsView()` [CUSTOM; upstream chose `SettingsAIView` when `workspaceType == ServerW`] |
| (related) Plan/Billing | `plan`,`billing` | – | – | never: `FeatureFlag.planBilling.isOn` is forced `false` [CUSTOM `lib/shared/feature_flags.dart`] | – |

Dialog openers: `showSettingsDialog` exists in `lib/shared/settings/show_settings.dart` and in `lib/workspace/presentation/home/menu/sidebar/shared/sidebar_setting.dart`. Each passes `restartApp: () async { Navigator.of(dialogContext).pop(); await runAppFlowy(); }`. No code path opens the dialog with `initPage` set to `ai`, `cloud` or `companyCertificates`. The only `initPage` caller is `sidebar_toast.dart`, which passes `plan`.

Sign-in screen **Settings** button (`DesktopSignInSettingsButton` → `showSimpleSettingsDialog`) opens `SimpleSettingsDialog` [CUSTOM body]. It contains: header `signIn.settings` = "Settings" (36 px, w600), `_LanguageSettings` (`settings.workspacePage.language.title` = "Language"), **`SelfHostedSettingsView(restartApp: () => runAppFlowy())`** (the dialog is not popped explicitly), and `_SupportSettings` (`settings.mobile.support` = "Support": export logs / clear cache). The sign-in screen appears only when the app is not anonymous. `lib/startup/entry_point.dart` [CUSTOM] uses `SplashScreen(isAnon: config.isAnon || isLocalAuthEnabled)`, so in practice the screen is reachable only in self-host mode.

---

### C.7 Cloud / Storage & server (+ self-hosting)

#### C.7.1 Page `SelfHostedSettingsView` [CUSTOM] (`lib/features/self_hosting/self_hosted_settings_view.dart`)

Shell: while `_loading` the page shows only a centered `CircularProgressIndicator.adaptive()` (no header). After loading it shows `SettingsBody(title: 'Storage & server')` with no description and padding 24. `autoSeparate=true` (the default), so a `SettingsCategorySpacer` sits between every child: `Divider` with `theme.spacing.l` top and bottom padding.

`_load()` runs in `initState` and calls, in order: `getAuthenticatorType()` (**side effect**: may reset the KV store to local, see C.7.4), `getAppFlowyCloudUrl()`, `getAppFlowyShareDomain()`. Then `_shared = !type.isLocal`, `_server.text = url`, `_web.text = web`. No error handling: an exception leaves the spinner showing.

| # | Control | Label / text | Hint | Options / default | Enabled | Visible |
|---|---|---|---|---|---|---|
| 1 | `Text` (bodyMedium) | `'Your data stays on this PC or your own collaboration server. AppFlowy hosted services and automatic vendor updates are disabled.'` | – | – | – | always |
| 2 | `DropdownButtonFormField<bool>` (Material) | `labelText: 'Workspace storage'` | – | `false` → `'Local workspace on this PC'`; `true` → `'My collaboration server'`. Initial value: `!getAuthenticatorType().isLocal` | `onChanged: null` while `_saving` | always |
| 3 | `TextField` `_server` | `labelText: 'Server URL'` | `hintText: 'https://appflowy.internal'` | KV `kAppflowyCloudBaseURL` (`''` if absent) | `!_saving` | `_shared` |
| 4 | `TextField` `_web` | `labelText: 'Web and shared-page URL'` | `hintText: 'Same as server if left blank'` | KV `kAppFlowyBaseShareDomain` | `!_saving` | `_shared` |
| 5 | `Text` | `'Sign in to your own server to collaborate. Local workspaces remain separate; export/import them to move existing content.'` | – | – | – | `_shared` |
| 6 | `Text` in `colorScheme.error` | `_error` | – | – | – | `_error != null` |
| 7 | `FilledButton`, left aligned | `'Apply and restart'`; `'Applying…'` (U+2026) while saving | – | – | `null` while `_saving` | always |

- Changing the dropdown only calls `setState`. Nothing is saved, and the field contents stay in their controllers when switching to local.
- The page has no connectivity test and no confirmation dialog. Upstream showed `NavigatorAlertDialog(settings.menu.changeServerTip)` = "After changing the server, you must click the restart button for the changes to take effect". On success there is no toast, and `_saving` is never reset because the app restarts.

#### C.7.2 `_save()` flow

1. `setState(_saving = true, _error = null)`.
2. If `_shared`:
   1. `SelfHostedPolicy.validateServerUrl(_server.text.trim())`.
   2. `web = _web.text.trim().isEmpty ? _server.text.trim() : _web.text.trim()`, then `validateServerUrl(web)`.
   3. `useBaseWebDomain(web)` sets KV `kAppFlowyBaseShareDomain = web`, stored as typed. A trailing `/` is **not** stripped.
   4. `useAppFlowyBetaCloudWithURL(server, appflowyCloudSelfHost)` validates again, sets KV `kAppflowyCloudBaseURL = server.replaceFirst(RegExp(r'/$'), '')`, then KV `kCloudType = '3'`. The `ty` argument is ignored; the type is always self-host.
3. Otherwise `useLocalServer()` sets KV `kCloudType='0'`, `kAppflowyCloudBaseURL=''`, `kAppFlowyBaseShareDomain=''`.
4. `widget.restartApp()` (see C.7.6).
5. `catch (error)`: `_error = error.toString()` and `_saving = false`. **Parity:** `FormatException.toString()` gives `"FormatException: <message>"`, and that prefix is shown on screen.

Validation `SelfHostedPolicy.validateServerUrl(String)` [CUSTOM] (`lib/env/self_hosted_policy.dart`):

| Rule (checked in order) | Error message (`FormatException.message`) |
|---|---|
| `Uri.tryParse` returns null, **or** the scheme is not `http`/`https`, **or** the host is empty, **or** userinfo is present, **or** there is a query, **or** a fragment, **or** the path is non-empty and not `/` | `'Enter your server origin, such as https://appflowy.internal, without a path or credentials.'` |
| `isVendorHost(host)`: lowercased host with one trailing `.` removed, equal to or ending in `.appflowy.com`, `.appflowy.io` or `.appflowy.cloud` | `'AppFlowy hosted services are disabled. Enter your own server address.'` |

Ports are allowed (`http://collaboration.example.com:8080` is valid). An empty string fails rule 1. `appflowy.com.internal` is allowed.

#### C.7.3 Persistence: KV keys (`lib/core/config/kv_keys.dart`, `lib/env/cloud_env.dart`)

`KeyValueStorage` is `DartKeyValue` → `SharedPreferences` (`getString`/`setString`, values are always strings). On Windows the file is `%APPDATA%\io.appflowy\AppFlowy\shared_preferences.json`; CompanyName and ProductName come from `appflowy_flutter/windows/runner/Runner.rc`, and the shared_preferences plugin adds the `flutter.` key prefix. Nothing here uses secure storage.

| `KVKeys` constant | Stored key | Values | Written by | Read by |
|---|---|---|---|---|
| `kCloudType` | `'kCloudType'` | `'0'` local, `'2'` AppFlowy Cloud (legacy, now treated as local), `'3'` self-host, `'4'` develop (legacy) | `_setAuthenticatorType` | `getAuthenticatorType` |
| `kAppflowyCloudBaseURL` | `'kAppFlowyCloudBaseURL'` (note the capital **F**) | origin without trailing `/`, or `''` | `useAppFlowyBetaCloudWithURL`, `useLocalServer` | `getAppFlowyCloudUrl()` (`?? ''`; upstream fell back to `https://beta.appflowy.cloud`) |
| `kAppFlowyBaseShareDomain` | `'kAppFlowyBaseShareDomain'` | web origin as typed, or `''` | `useBaseWebDomain`, `useLocalServer` | `getAppFlowyShareDomain()` (`?? ''`; upstream fell back to `https://appflowy.com`) |
| `kAppFlowyEnableSyncTrace` | `'kAppFlowyEnableSyncTrace'` | `'true'`/`'false'` | no UI in this checkout (upstream toggle hidden) | `getSyncLogEnabled()` → `enable_sync_trace` |

#### C.7.4 `AuthenticatorType` and resolution [CUSTOM `getAuthenticatorType()`]

| Enum | `.value` | `isLocal` | `isAppFlowyCloudEnabled` | Reachable in this checkout |
|---|---|---|---|---|
| `local` | 0 | ✓ | – | yes (default) |
| `appflowyCloud` | 2 | – | ✓ | no |
| `appflowyCloudSelfHost` | 3 | – | ✓ | yes |
| `appflowyCloudDevelop` | 4 | – | ✓ | no |

Resolution:
- If `kCloudType == '3'`, `kAppflowyCloudBaseURL != null` and `validateServerUrl(url)` passes, the type is `appflowyCloudSelfHost`.
- **Otherwise the function calls `useLocalServer()`** (resets all three keys) and returns `local`. So a fresh install is local, and a saved vendor or legacy `'2'`/`'4'` setting is wiped.
- Upstream for comparison: `null` defaulted to AppFlowy Cloud `https://beta.appflowy.cloud`.

The function is called by `AppFlowyCloudSharedEnv.fromEnv()` on every (re)start (`startup/deps_resolver.dart` registers the factory) and by `SelfHostedSettingsView._load`.

Helpers: `isAuthEnabled = env.authenticatorType.isAppFlowyCloudEnabled && env.appflowyCloudConfig.isValid` (all of base/ws/gotrue non-empty). `isLocalAuthEnabled = currentCloudType().isLocal`. `isAppFlowyCloudEnabled = currentCloudType().isAppFlowyCloudEnabled`.

#### C.7.5 URL derivation (`AppFlowyCloudSharedEnv.fromEnv` → `getAppFlowyCloudConfig` → `configurationFromUri`)

| `AppFlowyCloudConfiguration` field (`lib/env/backend_env.dart`) | local (`defaultConfig()`) | self-host |
|---|---|---|
| Dart `authenticatorType` | `local` | `appflowyCloudSelfHost`. [CUSTOM] Upstream rewrote self-host to `appflowyCloud` at this point. |
| `base_url` | `''` | KV `kAppFlowyCloudBaseURL` |
| `ws_base_url` | `''` | `Uri(scheme: https?'wss':'ws', host, port: uri.hasPort ? port : null, path:'/ws/v1')`. [CUSTOM] Port only if explicit; upstream always set `port: uri.port`. |
| `gotrue_url` | `''` | `"$base_url/gotrue"` |
| `enable_sync_trace` | `false` | KV `kAppFlowyEnableSyncTrace == 'true'` |
| `base_web_domain` | `'https://appflowy.com'` (`ShareConstants.defaultBaseWebDomain`) | KV `kAppFlowyBaseShareDomain` |

- If `Uri.parse` throws, the result is `defaultConfig()`.
- The `appflowyCloudDevelop` branch (`:8000`, `:9999`) is unreachable.
- `base_web_domain` feeds `ShareConstants.buildPublishUrl/buildNamespaceUrl/buildShareUrl` (`lib/plugins/shared/share/constants.dart`).
- How the config reaches Rust is covered in C.9a.

#### C.7.6 Restart flow

1. Main settings dialog: `SelfHostedSettingsView` → `SettingCloud.restartAppFlowy` → `SettingsDialog.restartApp` → `Navigator.of(dialogContext).pop()` → `await runAppFlowy()`.
2. `runAppFlowy()` → `FlowyRunner.run(AppFlowyApplication(), mode)`:
   1. `AppLauncher.dispose()`, then `getIt.reset()`.
   2. `initGetIt` re-reads the KV store through `AppFlowyCloudSharedEnv.fromEnv()`.
   3. The launch tasks run again (C.9a), including `InitRustSDKTask`. That calls `FlowySDK.init(json)` → Rust `init_sdk`, which closes the old core DB (`core.close_db()`) and builds a new `AppFlowyCore` **in the same process**. It is not an OS process restart.
   4. `InitAppWidgetTask` rebuilds the UI.
3. `SimpleSettingsDialog` passes `restartApp: () => runAppFlowy()` without popping first.
4. Electron note: `rust-lib/electron-core` [CUSTOM] supports the same re-init. Send another `KIND_INIT` frame (`protocol.rs`); `init()` closes the previous core DB and replaces the runtime. The init JSON is identical (C.9a).

#### C.7.7 Upstream controls hidden or removed [git diff]

| Upstream element | Upstream behavior | This checkout |
|---|---|---|
| `SettingCloud` body: `FutureBuilder(getAuthenticatorType)` + `CloudSettingBloc` + `SettingsBody(settings.menu.cloudSettings)` | – | replaced by `SelfHostedSettingsView` |
| `_CloudServerSwitcher` + `CloudTypeSwitcher` (row `settings.menu.cloudServerType` = "Cloud server"), gated by `Env.enableCustomCloud` | Dropdown of all types (develop only in develop mode). Selecting showed a `NavigatorAlertDialog(settings.menu.changeServerTip)`. | Removed from the page. `CloudTypeSwitcher`/`CloudTypeItem` remain as dead code; options now filtered to `local` + `appflowyCloudSelfHost`. |
| `titleFromCloudType` | `settings.menu.cloudLocal` = "Local", `settings.menu.cloudAppFlowy` = "AppFlowy Cloud", `settings.menu.cloudAppFlowySelfHost` = "AppFlowy Cloud Self-hosted", `"AppFlowyCloud Develop"` | Now `type.isLocal ? 'Local workspace' : 'My collaboration server'`. Used only by mobile `cloud_setting_group.dart`. |
| `SettingLocalCloud` (`setting_local_cloud.dart`) + `_restart_app_button.dart` | Restart button for local mode | not rendered |
| `AppFlowyCloudViewSetting` (`setting_appflowy_cloud.dart`, `appflowy_cloud_setting_bloc.dart`) | Toggle `settings.menu.enableSync` = "Enable sync" → `UserEventSetCloudConfig`. Toggle `settings.menu.enableSyncLog` = "Enable sync logging", with confirm `settings.menu.enableSyncLogWarning`, → KV `kAppFlowyEnableSyncTrace`. Restart tip `settings.menu.restartAppTip`. | not rendered. The file is still imported by `sidebar_footer.dart` and `rust_workspace_repository_impl.dart` for helpers. |
| `CustomAppFlowyCloudView`/`AppFlowyCloudURLs` (`appflowy_cloud_urls_bloc.dart`) | `settings.menu.cloudURL` = "Base URL" (hint `settings.menu.cloudURLHint` = "Input the base URL of your server"). `settings.menu.webURL` = "Web URL" (hint "Input the base URL of your web server"). `validateUrl`, then restart. `AppFlowySelfHostTip` docs link. | not rendered |
| `SimpleSettingsDialog._SelfHostSettings` | `SettingsServerDropdownMenu` (AppFlowy Cloud / Self-hosted), URL fields, `button.save` = "Save". Toasts `settings.menu.pleaseInputValidURL` = "Please input a valid URL" and `settings.menu.changeUrl` = "Change self-hosted url to {}". | Replaced by `SelfHostedSettingsView`. `SettingsServerDropdownMenu.supportedServers = [appflowyCloudSelfHost]` and is unused. |
| Sign-in screen `_OrDivider`, `ThirdPartySignInButtons`, `SignInAgreement` | – | Removed. If `isAuthEnabled`, the screen shows `Text('Sign in to your collaboration server')`. |
| `AutoUpdateTask` | Vendor updater | Removed from the launch tasks |
| `Env.enableCustomCloud` / `.env` config (`Env.afCloudUrl`, `Env.baseWebDomain`, `Env.authenticatorType`) | – | Removed: config is always KV-driven |

#### C.7.8 Self-hosted network policy [CUSTOM]

| Layer | Mechanism | Effect |
|---|---|---|
| Dart networking (`lib/main.dart` → `SelfHostedPolicy.installNetworkPolicy()`, the first statement of `main()`) | `HttpOverrides.global = _SelfHostedHttpOverrides`: `client.connectionFactory` is set on every `dart:io HttpClient`, which includes `package:http` `IOClient` | A vendor host gets `HttpException('AppFlowy hosted services are disabled in this self-hosted app.')` before DNS. This also applies to each redirect hop. Direct HTTPS uses `SecureSocket.startConnect(host, port, context: context)` (certificate validation kept). Through a proxy: plain socket to the proxy, and the SDK does CONNECT and TLS. |
| Dart URL launch (`lib/core/helpers/url_launcher.dart` `afLaunchUri`) | `isVendorHost(uri.host)` | calls `onFailure?.call(uri)` and returns `false` without launching |
| Rust config (`rust-lib/flowy-core/src/config.rs`) | `AFCloudConfiguration::from_env().ok().filter(all of base/ws/gotrue pass is_self_hosted_url)` | `is_self_hosted_url`: scheme `http`/`https`/`ws`/`wss`, no username or password, host present and not vendor (lowercase, trailing `.` trimmed). On failure `cloud_config = None` and `storage_path = custom_app_path`. |
| Rust auth (`rust-lib/flowy-core/src/server_layer.rs`) | `ServerProvider` | If `cloud_config` is None: initial auth is `AuthType::Local`, `set_auth_type` forces Local, `get_auth_type` returns Local |

---

### C.8 AI settings (OpenAI-compatible endpoint, local AI)

#### C.8.1 Page shell [CUSTOM]

`LocalSettingsAIView.build` returns `const OpenAIEndpointSettingsView()` and ignores `userProfile` and `workspaceId`. There is no bloc and no `SettingsAIBloc`. The widget lives in `lib/workspace/presentation/settings/pages/setting_ai_view/openai_endpoint_settings_view.dart`. It renders `SettingsBody` with:
- `title: 'AI'`
- `description: 'Use your own OpenAI-compatible API. Workspace storage stays local. AI prompts, selected sources, and enabled semantic-search inputs are sent only to this endpoint.'`
- `autoSeparate = true`, so a divider (spacing.l above and below) appears between **every** child, including the `SizedBox` spacers. AMBIGUOUS: this looks unintended, but it is what renders.

While loading, the page has a single `LinearProgressIndicator` child under the header.

#### C.8.2 Form controls (in order)

| # | Control | Label | Helper / hint | Initial value | Enabled | Visible |
|---|---|---|---|---|---|---|
| 1 | `SwitchListTile.adaptive` (contentPadding 0) | `'Enable AI endpoint'` | – | `settings?.enabled ?? false` | `!_busy` | always |
| – | `SizedBox(height: 12)` | | | | | |
| 2 | `TextField _url` (`keyboardType: url`) | `'API base URL'` | hint `'http://localhost:8000/v1'`; helper `'Include the API prefix, usually /v1.'` | `settings?.baseUrl ?? ''` | `!_busy` | always |
| – | `SizedBox(20)` | | | | | |
| 3 | `TextField _model` | `'Chat model ID'` | helper `'Use the exact model ID provided by your endpoint.'` | `settings?.model ?? ''` | `!_busy` | always |
| – | `SizedBox(20)` | | | | | |
| 4 | `TextField _embedding` | `'Embeddings model ID (optional)'` | helper `'Leave empty for local text search. Semantic search sends workspace document text to this endpoint.'` (`helperMaxLines: 3`) | `settings?.embeddingModel ?? ''` | `!_busy` | always |
| – | `SizedBox(20)` | | | | | |
| 5 | `TextField _imageModel` | `'Image generation model ID (optional)'` | helper `'Requires POST /images/generations. Generated images are saved locally. Image attachments use your chat model and require vision support.'` (`helperMaxLines: 3`) | `settings?.imageModel ?? ''` | `!_busy` | always |
| – | `SizedBox(20)` | | | | | |
| 6 | `TextField _key` (`obscureText`, `enableSuggestions: false`, `autocorrect: false`) | `'API key (optional)'` | helper when no key is saved: `'Leave empty if your endpoint does not require a key.'`; when one is saved: `'A key is saved using Windows account encryption. Leave empty to keep it.'` | always empty (the saved key is never shown) | `!_busy && !_removeKey` | always |
| 7 | `CheckboxListTile` (contentPadding 0) | `'Remove saved API key'` | – | `false` | `!_busy` | only if `_protectedKey.isNotEmpty` |
| – | `SizedBox(20)` | | | | | |
| 8 | `Text` | `'Chat, editor actions, summaries, translations, and selected-source answers use this model. Retrieval uses local text search, or your optional embeddings model for semantic workspace search. Image output uses the optional image model. Unsupported image or vision requests show a capability error.'` | | | | always |
| – | `SizedBox(20)` | | | | | |
| 9 | `Wrap(spacing 12, runSpacing 12)`: `FilledButton('Save AI settings')`, `OutlinedButton('Test endpoint')` | | | | both `null` while `_busy` | always |
| 10 | `SizedBox(12)` + `LinearProgressIndicator` | | | | | `_busy` |
| 11 | `SizedBox(12)` + `Semantics(liveRegion: true, Text(_message))` | colored `colorScheme.error` if `_failed`, otherwise default | | | | `_message != null` |

#### C.8.3 Data model and persistence [CUSTOM `lib/ai/service/openai_endpoint_settings.dart`]

Settings file: `<getApplicationSupportDirectory()>/local_ai/openai-endpoint.json`. On Windows that is `%APPDATA%\io.appflowy\AppFlowy\local_ai\openai-endpoint.json`. The content is plain JSON from `jsonEncode(toJson())`. Key order:

| JSON key | Dart field | Rust `EndpointConfig` field (`rust-lib/flowy-ai/src/openai_endpoint.rs`) | Form source | Default |
|---|---|---|---|---|
| `base_url` | `baseUrl` | `base_url: String` (required) | `_url.text.trim()` | required |
| `model` | `model` | `model: String` (required) | `_model.text.trim()` | required |
| `embedding_model` | `embeddingModel` | `embedding_model` (`#[serde(default)]`) | `_embedding.text.trim()` | `''` |
| `image_model` | `imageModel` | `image_model` (serde default) | `_imageModel.text.trim()` | `''` |
| `protected_key` | `protectedKey` | `protected_key` (serde default) | see below | `''` |
| `enabled` | `enabled` | `enabled: bool` (serde default `false`) | switch | `false` |

Key field logic: `_removeKey ? '' : (_key.text.isEmpty ? <previously saved protectedKey> : encryptKey(_key.text))`. The key text is **not** trimmed. The JSON never contains an `api_key` field.

`encryptKey(v)`:
- Empty input returns `''`.
- Otherwise returns `base64(CryptProtectData(utf8(v), szDataDescr=null, pOptionalEntropy=null, reserved=null, prompt=null, dwFlags=1 /*CRYPTPROTECT_UI_FORBIDDEN*/))`. This is user-scope DPAPI through the `win32`/`ffi` packages.
- Off Windows: `UnsupportedError('Saved API credentials in this build require Windows.')`.
- DPAPI failure: `StateError('Windows could not protect the AI credential. Re-enter the key.')`. When decrypting, the message is `'…could not read the AI credential…'`.

`decryptKey` is the inverse. Rust decrypts the same blob with `CryptUnprotectData(..., flags=1)`. Electron note: write raw DPAPI blobs, for example with a native addon. Electron `safeStorage` output (OSCrypt v10 AES-GCM) is not readable by the Rust core.

Backend pointer: there is no new event and no env var. The existing local-AI setting carries the file path:

| Item | Value |
|---|---|
| Prefix constant | Dart `openAIConfigPrefix` = Rust `CONFIG_PREFIX` = `'openai+file:'` |
| Save event | `AIEvent::UpdateLocalAISetting` (= 30), input `LocalAISettingPB`. Dart: `AIEventUpdateLocalAISetting(pb).send()` |
| Load event | `AIEvent::GetLocalAISetting` (= 29), output `LocalAISettingPB`. Dart: `AIEventGetLocalAISetting().send()` |
| `LocalAISettingPB` (`rust-lib/flowy-ai/src/entities.rs`) | `server_url: String` (pb 1, `required_not_empty_str`) = `'openai+file:' + <absolute file path>`; `global_chat_model: String` (pb 2, `required_not_empty_str`) = `model`; `embedding_model_name: String` (pb 3; the `required_not_empty_str` validator was **removed** [CUSTOM]) = `embeddingModel` |
| Rust storage | `LocalAISetting {ollama_server_url, chat_model_name, embedding_model_name}` stored as a JSON object in `KVStorePreferences` key `"appflowy_local_ai_setting:v1"` (sqlite `<storage_path>/cache.db`). The Rust default when unset is `{"http://localhost:11434", "llama3.1:latest", "nomic-embed-text:latest"}`. |

#### C.8.4 Validation `OpenAIEndpointSettings.validate()` (runs before both Save and Test)

| Rule | Message (`FormatException`, shown as `.message`) |
|---|---|
| `Uri.tryParse` null, **or** scheme not `http`/`https`, **or** empty host, **or** userinfo, **or** query, **or** fragment. A path is allowed (`/v1`, `/api/v1/`). | `'Enter an absolute HTTP or HTTPS API base URL without credentials, query parameters, or fragments.'` |
| Vendor host: lowercased, all trailing `.` removed, equal to or ending in `.appflowy.com`, `.appflowy.io` or `.appflowy.cloud` | `'AppFlowy hosted services are disabled. Use your own AI endpoint.'` |
| `model.trim().isEmpty` | `"Enter the endpoint's chat model ID."` |

The embedding and image model fields are not validated. Rust re-validates on save (`set_llm_setting`) and on every use (`EndpointConfig::validate`):

| Rust check | Message |
|---|---|
| `Url::parse` fails | `'Enter an absolute HTTP or HTTPS API base URL.'` |
| Scheme, host, credentials, query or fragment | `'Enter an HTTP or HTTPS API URL without credentials, queries, or fragments.'` |
| Vendor host | same text as Dart |
| Empty model | same text as Dart |

API URL building: `'${baseUrl.replaceAll(RegExp(r'/+$'), '')}/<resource>'`. Rust uses `trim_end_matches('/')`.

#### C.8.5 Save button (`_act(test: false)`)

1. `_busy = true`, `_message = null`.
2. `settings = _settings()`; this may throw an encryption error.
3. `settings.save()`:
   1. `validate()`.
   2. `Directory(<appSupport>/local_ai).create(recursive: true)`.
   3. Write `openai-endpoint.json` with `flush: true`. **This happens before the backend call**, so the file is overwritten even if the backend rejects the save.
   4. `AIEventUpdateLocalAISetting(LocalAISettingPB(serverUrl: 'openai+file:<path>', globalChatModel: model, embeddingModelName: embeddingModel))`.
   5. On a FlowyError, throw `StateError('Could not apply AI endpoint settings: ${error.msg}')`.
4. On success: `_protectedKey = settings.protectedKey`, `_key.clear()`, `_removeKey = false`, `_failed = false`, `_message = 'AI settings saved. Reopen existing chats to refresh their model.'`.
5. Error display rules (shared with Test): `FormatException` → `.message`; `StateError` → `.message`; anything else → `'Could not apply settings. Check the endpoint and try again.'` (with `_failed = true`).
6. `finally` sets `_busy = false`.

Rust side of `UpdateLocalAISetting` [CUSTOM changes in `ai_manager.rs`, `local_ai/resource.rs`, `local_ai/controller.rs`]:
1. Protobuf validation.
2. `AIManager::update_local_ai_setting` → `LocalAIResourceController::set_llm_setting`. Because the URL has the prefix, it reads the file. A JSON parse failure gives `'Invalid endpoint settings.'`. Then it runs `validate()`, which does **not** require `enabled`, so the endpoint can be disabled. It then calls `store_setting`, with no Ollama resource check.
3. `prepare_local_ai(ws, true)`: the Ollama client is set to None and `LocalAiSource` is added.
4. If `!local_ai.is_enabled()` (the file fails to load, or `enabled == false`), return Ok.
5. Otherwise `update_selected_model("global_active_model", AIModel{name: model, is_local: true, desc: "OpenAI-compatible endpoint"})`. There is no Ollama reload or plugin restart for endpoint mode.

> AMBIGUOUS (static reading, not run): in endpoint mode `LocalAiSource.list_chat_models` returns `[]` because the Ollama client was cleared. `ServerAiSource` (through `ChatServiceMiddleware.get_available_models`) returns `{name: model, is_local: false, desc: "User-configured OpenAI-compatible endpoint"}`, and that result is cached for 300 s. `set_active_model` therefore probably fails with `"Model '…' not found in available list"`, and Save would show `'Could not apply AI endpoint settings: …'` even though the file and the Rust KV were already written. `LocalAIController::get_all_chat_local_models` (which returns the endpoint as a local model) is defined but never called.

#### C.8.6 Test endpoint button (`_act(test: true)` → `testConnection()`)

The test uses the **current form values**, saved or not, and runs whether or not the Enable switch is on. It runs from Dart (`package:http` `http.Client`, which goes through the `HttpOverrides` vendor block in C.7.8), not through Rust.

| Aspect | Value |
|---|---|
| Request | `POST <base>/chat/completions` with `followRedirects = false` |
| Headers | `Content-Type: application/json`. `Authorization: Bearer <decryptKey(protectedKey)>` only when non-empty. The key is a newly typed one (encrypted then decrypted), or the saved one if the field is empty, or none if "Remove saved API key" is ticked. |
| Body | `{"model": <model>, "stream": false, "messages": [{"role": "user", "content": "Reply with OK."}]}` |
| Timeouts | 30 s for `client.send`, plus 30 s for reading the body |
| Success | 2xx **and** the body is a JSON object with a non-empty `choices` array. Message: `'Endpoint responded successfully.'` (`_failed = false`) |

| Failure | Message shown |
|---|---|
| Validation | C.8.4 text |
| Status not 2xx, including a 3xx redirect (redirects are not followed) | `'Endpoint returned HTTP <code>. Check the base URL, credential, and model ID.'` |
| `http.ClientException` (connection or socket failure, vendor block) | `'Cannot reach the endpoint. Check the network and TLS certificate.'` |
| `choices` missing or empty | `'Endpoint returned no chat completion.'` |
| Body is not JSON | raw `jsonDecode` `FormatException.message` |
| DPAPI decrypt fails | `'Windows could not read the AI credential. Re-enter the key.'` |
| Timeout, body is not a JSON object (TypeError), `UnsupportedError` (key off Windows), other | `'Could not apply settings. Check the endpoint and try again.'` AMBIGUOUS: a TLS `HandshakeException` may land here instead of in "Cannot reach…", depending on how `package:http` wraps it. |

#### C.8.7 Load (`initState` → `_load()`)

1. `AIEventGetLocalAISetting()`. The pointer is `pb.serverUrl`, or `''` on error.
2. If the pointer does not start with `'openai+file:'` (for example the Rust default `http://localhost:11434`), the result is null: the form is empty and the switch is off.
3. Otherwise `File(pointer.substring(12))`. If the file does not exist, the result is null.
4. Otherwise `jsonDecode` → `fromJson`. `base_url` and `model` are cast to non-null `String`; the other keys default.
5. Any exception gives `_message = 'Could not load AI settings. Enter the endpoint settings again.'` with `_failed = true` and an empty form.
6. `finally` sets `_loading = false`.

#### C.8.8 How the configuration is used by Rust (no restart needed)

`EndpointConfig::load(pointer)` runs on **every** use: chat stream, completion, embeddings, image generation, `is_enabled`, `is_ready`, row summary and translation. It reads the file, validates it, and then requires `enabled`. Error texts:

| Condition | Message |
|---|---|
| Missing prefix or unreadable file | `'Configure your OpenAI-compatible endpoint in Settings > AI before using AI.'` |
| Bad JSON | `'AI settings are invalid. Save the endpoint settings again.'` |
| `enabled == false` | `'AI endpoint is disabled. Enable it in AI settings.'` |

| Rust use | Request |
|---|---|
| Chat and writer | `POST chat/completions` with `{"model", "messages", "stream": true}`. Accepts SSE, or a JSON fallback read from `/choices/0/message/content`. |
| Embeddings (only if `embedding_model` set) | `POST embeddings` with `{"model": embedding_model, "input": [...]}` |
| Images (only if `image_model` set) | `POST images/generations` with `{"model": image_model, "prompt", "n": 1}`. Accepts `b64_json` or `url`; max 32 MB; png/jpg/gif/webp. |
| Every client | `reqwest`: connect timeout 15 s, total 180 s, `redirect::Policy::none()`, `bearer_auth` when a key is present. The key is decrypted with DPAPI per request; off Windows with a saved key: `'Saved AI credentials in this build require Windows. An endpoint without a key can still be used.'` |
| HTTP error mapping | 401/403 → `'AI endpoint rejected the credential. Check the key and permissions.'`; 404 → `'AI API or model not found. Check the base URL (usually ending in /v1) and model ID.'`; 400 → `'The endpoint rejected this request. Check that the selected model supports the requested image, vision, or text format.'`; 429 → `'AI endpoint is rate limited. Retry later or check its quota.'`; other → `'AI endpoint returned an error. Check the provider's service status.'` |

`LocalAIController` in endpoint mode (`is_openai_endpoint()` means `server_url` starts with the prefix):
- `is_enabled_on_workspace` and `is_ready` both mean "config loads".
- The per-workspace `local_ai_enabled` toggle key is ignored.
- Ollama is never contacted, `restart_plugin` is skipped, and `calculate_pending_resources` returns None (`LocalAIPB.lack_of_resource = None`).

#### C.8.9 Model list and selection (chat input; `lib/ai/service/ai_model_state_notifier.dart`, `lib/ai/widgets/prompt_input/select_model_menu.dart`, `lib/ai/service/select_model_bloc.dart`)

| Step | Call |
|---|---|
| Initial load | `AIEventGetSourceModelSelection(ModelSourcePB{source: objectId})` → `ModelSelectionPB{models: [AIModelPB], selected_model: AIModelPB}`. On desktop also `AIEventGetLocalAIState()` → `LocalAIPB{enabled, lack_of_resource?, is_ready}`. |
| Live updates | `LocalAIStateListener` (`ChatNotification.UpdateLocalAIState`, `LocalAIResourceUpdated`); `AIModelSwitchListener(objectId)` (`DidUpdateSelectedModel`). |
| Selecting a model | `AIEventUpdateSelectedModel(UpdateSelectedModelPB{source: objectId, selected_model})`, with an optimistic `emit(selectedModel)`. |

State computation [CUSTOM text]:
- Mobile, or either response missing, or `selected == null`, or `!selected.isLocal`: the default is type `cloud`, hint `chat.inputMessageHint` = "Ask AppFlowy AI", no tooltip, editable.
- Otherwise type `local` with:
  - hint `is_ready ? 'Ask your AI endpoint...' : 'Configure an AI endpoint in Settings > AI'`
  - tooltip `is_ready ? null : 'Save and enable your OpenAI-compatible endpoint in Settings > AI.'`
  - `isEditable = is_ready` and `localAIEnabled = enabled`
- Upstream used the keys `chat.inputLocalAIMessageHint`, `settings.aiPage.keys.localAIInitializing`, `localAIDisabled` and `…TextFieldPrompt`.

Popover (max width 250, max height 600, top-left):
- Opens only if `selectedModel != null`. An empty model list renders nothing.
- Local section header: `'AI endpoint'` [CUSTOM; upstream `chat.switchModel.localModel` = "Local Model"].
- Cloud section header: `chat.switchModel.cloudModel` = "Cloud Model", shown only when both sections exist.
- Item label: `model.name`; `'Auto'` is shown as `chat.switchModel.autoModel` = "Auto".

Rust in endpoint mode: `get_available_models(source)` → `get_local_available_models(Some(source))`. `models` comes from the local source, which is `[]`. The selected model comes from `get_active_model`, which tries in turn:
1. Per-source key `ai_models_<source>`.
2. Global key `ai_models_global_active_model`. Each match must have a name in the available list (server source = endpoint model).
3. Server storage: `get_workspace_default_model` = endpoint model, returned as `is_local = false`.
4. `Model::default()`.

AMBIGUOUS: this makes the popover usually empty, and the chat input usually takes the "cloud" default state. Since the Rust core is reused, Electron should mirror the Dart logic exactly.

#### C.8.10 Upstream AI controls hidden or replaced [git diff]

| Upstream (still in tree, not rendered) | Controls |
|---|---|
| `SettingsAIView` (`settings_ai_view.dart`, for `ServerW` workspaces) | Title `settings.aiPage.title` = "AI Settings". Description `settings.aiPage.keys.aiSettingsDescription`. `AIModelSelection` (`model_selection.dart`): row `settings.aiPage.keys.llmModelType` = "Language Model Type" dropdown → `SettingsAIEvent.selectModel` → `AIEventUpdateSelectedModel`; models from `AIEventGetSettingModelSelection`. `_AISearchToggle` `settings.aiPage.keys.enableAISearchTitle` = "AI Search" → `UserEventUpdateWorkspaceSetting`. Plus `LocalAISetting`. |
| Old `LocalSettingsAIView` | `SettingsAIBloc` + `SettingsBody(settings.aiPage.title)` + `LocalAISetting` |
| `LocalAISetting` (`local_ai_setting.dart`, `local_ai_bloc.dart`) | Toggle `settings.aiPage.keys.localAIToggleTitle` = "AppFlowy Local AI (LAI)", subtitle `…localAIToggleSubTitle`, plus a learn-more link. Disabling confirms with `…disableLocalAITitle` = "Disable local AI" / `…disableLocalAIDescription`. Backed by `AIEventToggleLocalAI`. |
| `LocalAISettingPanel` → `PluginStatusIndicator` (`plugin_status_indicator.dart`) + `OllamaSettingPage` (`ollama_setting.dart`, `ollama_setting_bloc.dart`) | Server URL field (hint `'http://localhost:11434'`). Embedding model, read-only (`settings.aiPage.keys.readOnlyField`, hint `kDefaultEmbeddingModel` = `'nomic-embed-text:latest'`). `LocalAIModelSelection` `settings.aiPage.keys.globalLLMModel` = "Global Language Model" (from `AIEventGetLocalModelSelection`). Save → `AIEventUpdateLocalAISetting`. |
| Replacement [CUSTOM] | `OpenAIEndpointSettingsView` only, for every workspace type |

Related chat-side changes [CUSTOM]:
- `desktop_prompt_input.dart`: `ChangeFormatBar` no longer passes `showImageFormats: type == cloud`, so the image format options always show. Attachment picker extensions are now `pdf, txt, md, png, jpg, jpeg, gif, webp`. Rust `chat_file_handler` accepts the same list, case-insensitive, with error `'Supported attachments: PDF, Markdown, text, PNG, JPEG, GIF, WebP'`.
- `lib/ai/service/local_ai_sources.dart` `prepareLocalAISources(objectId, ids)` is called by `AppFlowyAIService.streamCompletion` (when `objectId != null`) and by `chat_stream_manager.dart`. For each unique id:
  1. `ViewBackendService.getView(id)`.
  2. Database views: `DatabaseEventExportCSV(DatabaseViewIdPB{value: id})` → `.data`. Other views: `DocumentEventGetDocumentText(OpenDocumentPayloadPB{document_id: id})` → `DocumentTextPB.text`.
  3. If the text is null, throw `StateError('A selected source cannot be read. Select a document or database page, or attach a text export.')`.
  4. `AIEventCreateChatContext(CreateChatContextPB{chat_id: objectId, content_type: 'text', text: text.isEmpty ? 'This page is empty.' : text, metadata: {'id': id, 'name': view?.name ?? 'Page <id>'}})`. On error, `StateError(error.msg)`.
  5. The writer surfaces failures as `AIError(StateError.message | 'Could not prepare local AI sources.')`.

  On the Rust side, `create_chat_context_handler` was previously a no-op. It now stores the source into `<appSupport>/local_ai/ai-sources-<chatId>.json` as `[{id, name, text}]`, replacing any entry with the same id. This requires the endpoint to be configured and enabled, and `chat_id` must be a UUID. Retrieval returns the top 8 chunks of 3000 characters ranked by query-word hits.
- The `GetChatInfo` event now routes to `get_chat_info_handler`; upstream mapped it to `create_chat_context_handler`.

#### C.8.11 AI protobuf reference (`rust-lib/flowy-ai/src/entities.rs`, `event_map.rs`; Dart `appflowy_backend/lib/dispatch/dart_event/flowy-ai/dart_event.dart`)

| Event (enum value) | Input | Output | Used by |
|---|---|---|---|
| `GetLocalAISetting` (29) | – | `LocalAISettingPB` | endpoint form load |
| `UpdateLocalAISetting` (30) | `LocalAISettingPB` | – | endpoint form save |
| `GetLocalAIState` (19) | – | `LocalAIPB` | chat input state |
| `ToggleLocalAI` (18) | – | `LocalAIPB` | upstream only (hidden) |
| `GetSourceModelSelection` (34) | `ModelSourcePB` | `ModelSelectionPB` | chat model menu |
| `GetSettingModelSelection` (31) | `ModelSourcePB` | `ModelSelectionPB` | upstream settings only |
| `UpdateSelectedModel` (32) | `UpdateSelectedModelPB` | – | chat model menu |
| `GetLocalModelSelection` (33) | – | `ModelSelectionPB` | upstream Ollama page only |
| `CreateChatContext` (23) | `CreateChatContextPB` | – | `prepareLocalAISources` |

| Message | Fields (pb index: name type) |
|---|---|
| `LocalAISettingPB` | 1 `server_url` string (required); 2 `global_chat_model` string (required); 3 `embedding_model_name` string |
| `LocalAIPB` | 1 `enabled` bool; 2 `lack_of_resource` oneof `LackOfAIResourcePB{1 resource_type: LackOfAIResourceTypePB, 2 missing_model_names: repeated string}`; 3 `is_ready` bool |
| `ModelSourcePB` | 1 `source` string (required) |
| `ModelSelectionPB` | 1 `models` repeated `AIModelPB`; 2 `selected_model` `AIModelPB` |
| `AIModelPB` | 1 `name` string; 2 `is_local` bool; 3 `desc` string |
| `UpdateSelectedModelPB` | 1 `source` string (required); 2 `selected_model` `AIModelPB` |
| `CreateChatContextPB` | 1 `content_type` string (required); 2 `text` string (required); 3 `metadata` map<string,string>; 4 `chat_id` string (required) |

---

### C.9 Company certificates

#### C.9.1 Page `CompanyCertificatesSettingsView` [CUSTOM] (`lib/features/company_certificates/company_certificates_settings_view.dart`)

The page is `SettingsBody(title: 'Company certificates')` with no description and `autoSeparate = true` (a divider between every child). Initial state: `_busy = true` until `_store.list()` completes.

| # | Control | Text | Enabled / visible |
|---|---|---|---|
| 1 | `Text` | `'Import the root or intermediate CA certificate provided by your IT team for Jira, your collaboration server, and AI endpoints.'` | always |
| 2 | `Text` | `'Certificates are trusted for your Windows account and other apps using that account. No administrator permission is needed.'` | always |
| 3a | `Text` | `'Certificate import is available in the Windows desktop app.'` | `!Platform.isWindows` (replaces 3b) |
| 3b | `OutlinedButton.icon` (key `choose-company-certificate`, icon `Icons.folder_open`), left aligned | `'Choose certificate file'` | Windows; disabled while `_busy` |
| 4 | `LinearProgressIndicator` | – | `_busy` |
| 5 | `Text` (key `certificate-error`, `colorScheme.error`) | `_error` | `_error != null` |
| 6 | `Text` (key `certificate-result`) | `_message` | `_message != null` |
| 7 | Review section: `Text('Review before importing', titleMedium)`, then one `_CertificateDetails` per selected certificate, then `FilledButton.icon` (key `trust-company-certificate`, icon `Icons.verified_user_outlined`) labeled `'Trust certificate'` (1 selected) or `'Trust certificates'` (more than 1) | | visible if `_selected.isNotEmpty`; button disabled while `_busy` |
| 8 | `Text('Imported certificates', titleMedium)` | | always |
| 9 | `Text('No company certificates imported yet.')` | | `!_busy && _certificates.isEmpty` |
| 10 | Per imported certificate: `Column[_CertificateDetails, TextButton('Remove'), Divider]` | | Remove disabled while `_busy` |

`_CertificateDetails`:
- `Text(subject, titleSmall)`, then 6 px gap
- `'Issued by: <issuer>'`
- `'Expires: <YYYY-MM-DD>'`, or `'Expired: <YYYY-MM-DD>'` in the error color when `notAfter < now`. The date is `notAfter.toLocal().toIso8601String().split('T').first`.
- 6 px gap, then `'SHA-256 fingerprint'`
- `SelectableText(sha256, bodySmall)`: uppercase hex with no separators.

#### C.9.2 Flows

**Choose** (`_choose`):
1. Set `_busy = true` and clear `_error`, `_message` and `_selected`.
2. Open `FilePicker.platform.pickFiles(dialogTitle: 'Choose a public company CA certificate', type: FileType.custom, allowedExtensions: ['cer','crt','pem'])`.
3. Cancelled: `_selected = []` with no message.
4. Otherwise `store.inspectFile(file)`:
   1. If the size exceeds 1 MiB: `'Choose a certificate file smaller than 1 MB.'`.
   2. `decodeCompanyCertificates` runs:

      | Input | Result |
      |---|---|
      | Empty file | `'The certificate file is empty.'` |
      | Text (utf8, malformed allowed) contains `PRIVATE KEY` | `'Choose a public CA certificate, without a private key.'` |
      | No `-----BEGIN` | Whole file treated as one DER certificate |
      | PEM | Every `-----BEGIN CERTIFICATE-----…-----END CERTIFICATE-----` block, whitespace stripped, base64-decoded |
      | PEM with no blocks | `'No public certificate was found in this PEM file.'` |

   3. Each DER is passed to `platform.inspect` (PowerShell, action `inspect`). If any one fails, the whole selection fails.
5. The review section shows. Inspecting does not change trust.

**Trust** (`_import`), sequential for each selected certificate (`store.importCertificate`):
1. The metadata file is `<appSupport>/company_certificates/<THUMBPRINT_UPPER>.json`. The thumbprint must match `^[A-Fa-f0-9]{40}$`, otherwise `'Invalid certificate fingerprint.'`. **If the file already exists, the certificate is skipped** and its ownership is unchanged.
2. `platform.install(der)` runs PowerShell action `install` and returns `owned = installedByApp`. `owned` is true only if the certificate was not already in `CurrentUser\Root`.
3. Write `<file>.json.tmp`, then rename it to `<file>.json`. On failure, if `owned`, `platform.remove(der)` rolls back, and the error is rethrown.
4. `SecurityContext.defaultContext.setTrustedCertificatesBytes(pemBytes)`, so Dart trusts it immediately.

Then `list()` runs, `_selected` is cleared, and the message is `'Certificate imported. Restart AppFlowy to refresh all connections.'`. On error, `_failed`: earlier certificates stay imported and the list is not refreshed.

**Remove** (`_remove`):
1. `AlertDialog` titled `'Remove company certificate?'`. Content:
   - If `installedByApp`: `'This removes <subject> from your Windows account’s trusted certificates. Restart AppFlowy afterward.'`
   - Otherwise: `'This removes <subject> from AppFlowy’s imported list. The certificate was already trusted in Windows and will remain there.'`

   Both use U+2019 apostrophes. Buttons: `TextButton('Cancel')` → false, `TextButton('Remove')` → true.
2. On confirm, `store.removeCertificate`: re-read the saved JSON. If `installedByApp`, run PowerShell action `remove`, which removes **all** `CurrentUser\Root` entries with that thumbprint. Then delete the JSON.
3. Message: `'Certificate removed. Restart AppFlowy to refresh all connections.'`. Dart's in-memory trust is not revoked until restart.

Error display (`_failed`): `FormatException` → `.message`; anything else → `'Could not update certificates. ${error.toString()}'`.

#### C.9.3 Windows trust-store operation (`WindowsCompanyCertificatePlatform._run`)

- Executable: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (falls back to `C:\Windows`).
- Arguments: `-NoProfile -NonInteractive -Command <embedded script>`.
- Environment: the parent environment plus `APPFLOWY_CERT_ACTION` = `inspect` | `install` | `remove` and `APPFLOWY_CERT_FILE` = `<systemTemp>/appflowy-cert-XXXX/certificate.cer` (DER).
- Timeout: 30 s.
- stdout is single-line JSON. A non-zero exit throws `FormatException(stderr.trim())`. The temp dir is always deleted; if it resolves outside the system temp dir, `StateError('Unexpected certificate temporary directory.')`.

Script checks for `inspect` and `install` (any failure exits 1 with the message on stderr):

| Check | Message |
|---|---|
| `HasPrivateKey` | `'Choose a public CA certificate without a private key.'` |
| No BasicConstraints extension (OID 2.5.29.19) | `'This is a server certificate. Choose the company root or intermediate CA certificate.'` |
| Not a CA | `'This is a server certificate. Choose a CA certificate.'` |
| `NotAfter <= now` | `'This certificate has expired. Ask your IT team for the current CA certificate.'` |
| `NotBefore > now` | `'This certificate is not valid yet. Check your PC clock or ask your IT team.'` |
| DER parse failure | raw .NET exception message |

Store behavior: `install` opens `X509Store('Root','CurrentUser')` ReadWrite and adds the certificate only if `FindByThumbprint` finds nothing, setting `$owned = true`. `remove` removes every thumbprint match.

AMBIGUOUS (OS behavior, not in code): Windows shows its own confirmation dialog when adding to `CurrentUser\Root`. A slow user could hit the 30 s timeout, which gives a `TimeoutException` and the "Could not update certificates." message.

Script output JSON, which is also the stored file format:

`{subject, issuer, thumbprint (SHA-1 hex, 40 chars), sha256 (uppercase hex without dashes of RawData), notBefore, notAfter (UTC ISO-8601 'o'), der (base64 RawData), installedByApp (bool)}`

`CompanyCertificate.toJson` writes the same keys, with dates from `toUtc().toIso8601String()`. `list()` reads every `*.json` in the folder and sorts by `subject`. A malformed file makes `list()` throw.

Storage: `<getApplicationSupportDirectory()>/company_certificates/`, which on Windows is `%APPDATA%\io.appflowy\AppFlowy\company_certificates\`. It holds public certificates and metadata only, no secrets.

#### C.9.4 How trust is applied

| Consumer | Mechanism |
|---|---|
| Dart (`dart:io`, `package:http`, the Jira client, the endpoint Test button) | **Startup**: `main()` calls `await CompanyCertificateStore().restoreTrust()`, which for every non-expired stored certificate calls `SecurityContext.defaultContext.setTrustedCertificatesBytes(pem)`. Errors are swallowed. **On import**: the same call, immediately. |
| Rust (reqwest/tungstenite inside the core) | No env var and no config; nothing is passed to Rust. The core relies on the Windows `CurrentUser\Root` store through the native TLS backend: `reqwest` default-tls / `native-tls-vendored`, which is schannel on Windows; `tokio-tungstenite` → `native-tls`. AMBIGUOUS: `Cargo.lock` also contains `rustls`, `rustls-native-certs` (reads the Windows ROOT store too) and `webpki-roots` (does not). Whether `client-api`'s HTTP client uses rustls with webpki roots was not determined. |
| Not used | `SSL_CERT_FILE`, `HttpOverrides` certificate callbacks, `badCertificateCallback`. Certificate validation is never bypassed. |

---

### C.9a Startup wiring (env vars / Rust config) for C.7-C.9

#### C.9a.1 Order (`lib/main.dart` [CUSTOM], `lib/startup/startup.dart`)

| # | Step | Notes |
|---|---|---|
| 1 | `SelfHostedPolicy.installNetworkPolicy()` | Before the binding. Installs the Dart vendor-host block (C.7.8). |
| 2 | `ScaledWidgetsFlutterBinding.ensureInitialized(scaleFactor: 1.0)` | upstream |
| 3 | `try { await CompanyCertificateStore().restoreTrust(); } catch (_) {}` | Restores the Dart trusted roots (C.9.4) before any HTTPS client exists |
| 4 | `runAppFlowy()` → `FlowyRunner.run` | Also the restart entry point |
| 4a | `initGetIt` → `AppFlowyCloudSharedEnv.fromEnv()` | Reads the KV store; may reset to local (C.7.4) |
| 4b | Launch tasks: `PlatformErrorCatcherTask`, `MemoryLeakDetectorTask`, `DebugTask`, `FeatureFlagTask`, `InitLocalizationTask`, `InitAppWindowTask`, **`InitRustSDKTask`**, `PluginLoadTask`, `FileStorageTask`, `ApplicationInfoTask`, `HotKeyTask`, then `InitAppFlowyCloudTask` **only if `isAppFlowyCloudEnabled`** (self-host; registers the `appflowy-flutter` deep-link scheme for `login-callback`), `InitAppWidgetTask`, `InitPlatformServiceTask`, `RecentServiceTask` | `AutoUpdateTask` removed [CUSTOM] |
| 4c | Entry point `SplashScreen(isAnon: config.isAnon \|\| isLocalAuthEnabled)` [CUSTOM] | Local mode skips sign-in (anonymous) |

The AI endpoint and certificates need no startup wiring. The AI pointer is held in Rust KV, and the file is re-read on each use.

#### C.9a.2 Init JSON (`lib/startup/tasks/rust_sdk.dart` `_makeAppFlowyConfiguration`) → `FlowySDK.init(jsonEncode(...))` → Rust `init_sdk` (dart-ffi), or Electron `KIND_INIT` (`rust-lib/electron-core/src/main.rs`, same struct in `config.rs`)

| JSON key | Value |
|---|---|
| `root` | `getApplicationSupportDirectory().path`, i.e. `%APPDATA%\io.appflowy\AppFlowy` |
| `app_version` | package version |
| `custom_app_path` | `ApplicationDataStorage` path; default `appFlowyApplicationDataDirectory()` = `<root>/data` (release) or `<root>/data_dev` (develop) |
| `origin_app_path` | `appFlowyApplicationDataDirectory().path` |
| `device_id` | `getDeviceId()` |
| `platform` | `Platform.operatingSystem` |
| `authenticator_type` | **[CUSTOM]** `isLocal ? 0 : 2` (self-host is sent as 2; upstream sent `.value`) |
| `appflowy_cloud_config` | `{base_url, ws_base_url, gotrue_url, enable_sync_trace, base_web_domain}` from C.7.5. Rust `AFCloudConfiguration` deserializes only the first three; the other keys are ignored. |
| `envs` | `context.config.rustEnvs`: `{}` in release; only an integration-test builder fills it |

#### C.9a.3 Rust handling (`dart-ffi/src/env_serde.rs`, `appflowy_yaml.rs`, `flowy-server-pub`, `flowy-core/src/config.rs`)

`write_env()` sets the process env vars below; there are no others.

| Env var | Value |
|---|---|
| `APPFLOWY_CLOUD_ENV_CLOUD_TYPE` | `0` or `2` |
| `APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_BASE_URL` | `base_url` |
| `APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_WS_BASE_URL` | `ws_base_url` |
| `APPFLOWY_CLOUD_ENV_APPFLOWY_CLOUD_GOTRUE_URL` | `gotrue_url` |
| each entry of `envs` | as given |

Further steps:
1. If `authenticator_type == 2`, `save_appflowy_cloud_config` appends `{base_url, ws_base_url, gotrue_url}` to `<root>/appflowy.yaml` (`cloud_config:` list) unless that `base_url` is already present.
2. `AppFlowyCoreConfig::new`: `cloud_config = AFCloudConfiguration::from_env()`. This is Err if any URL is empty, which is always the case in local mode. It is then filtered by `is_self_hosted_url` [CUSTOM].
3. `storage_path = custom_app_path` when there is no cloud config. Otherwise it is upstream `make_user_data_folder`: `<custom_app_path>_<urlsafe-base64(base_url)>` if that exists, else `<custom_app_path>_<host>`, else `_anonymous`. The root data is copied there on first use.
4. Per-user Rust KV (`cache.db`) lives under `storage_path`. That includes `appflowy_local_ai_setting:v1` and the `ai_models_*` keys, so **the AI pointer is per storage path**. Local and self-host data folders hold separate AI settings, but both point to the same shared file `<root>/local_ai/openai-endpoint.json` once saved.
5. `ServerProvider` auth type is forced to `Local` whenever `cloud_config` is None [CUSTOM `server_layer.rs`].

Electron parity checklist for C.7–C.9:
- Read and write the same KV values.
- Build the identical init JSON, including `authenticator_type` 0/2 and the ws/gotrue derivation.
- Restart by re-sending INIT (or relaunching).
- Write `openai-endpoint.json` with the same keys plus a raw DPAPI blob, then call `UpdateLocalAISetting` with the `openai+file:` pointer.
- Run the Test request with redirects off and 30 s timeouts.
- Store certificates under `company_certificates/` and import them into `CurrentUser\Root`. Chromium trusts the Windows store natively; Node's TLS stack does not by default, so feed it the stored PEMs.
- Block `appflowy.com`, `appflowy.io` and `appflowy.cloud` (and subdomains) for all app-originated requests and URL launches.

---

### C.10–C.18 preamble: Members, Shortcuts, Notifications, Manage data, Plan/Billing, Sites, Feature flags, misc widgets, KV keys

Paths relative to `D:\Projects\appflowy\frontend`. `lib/` = `appflowy_flutter/lib/`. i18n keys are dotted JSON paths in `resources/translations/en-US.json` (`@:appName` = "AppFlowy"). Events are the generated Dart classes in `appflowy_flutter/packages/appflowy_backend/lib/dispatch/dart_event/<crate>/dart_event.dart`; protobuf messages are from `rust-lib/flowy-*/resources/proto/*.proto`. "KV" = `KeyValueStorage` (`lib/core/config/kv.dart`, impl `DartKeyValue` = `SharedPreferences.getString/setString`; all values are strings).

#### Reachability of C.10–C.17 pages in this checkout

Source: `lib/workspace/presentation/settings/widgets/settings_menu.dart` (modified), `lib/workspace/presentation/settings/settings_dialog.dart` (modified), `lib/workspace/application/settings/settings_dialog_bloc.dart` (modified: added `SettingsPage.companyCertificates`).

Menu order in this checkout: Account, Workspace, [Members], Manage data, Notifications, "Storage & server" (cloud, hard-coded English), "Certificates" (hard-coded English), Shortcuts, AI, [Sites], [Plan, Billing], [Feature Flags].

| Page | `SettingsPage` | Menu label (key → en) | Reachable | Condition (exact) |
|---|---|---|---|---|
| Members | `member` | `settings.appearance.members.label` → "Members" | conditional | `FeatureFlag.membersSettings.isOn` (always true, see C.16) `&& userProfile.workspaceType == WorkspaceTypePB.ServerW && currentUserRole != null && currentUserRole != AFRolePB.Guest`. In this checkout `ServerW` only exists when signed in to a self-hosted server (KV `kCloudType`="3" + non-vendor URL, see `lib/env/cloud_env.dart` diff). Default install is local → hidden. |
| Manage data | `manageData` | `settings.manageDataPage.menuLabel` → "Manage data" | yes | always |
| Notifications | `notifications` | `settings.menu.notifications` → "Notifications" | yes | always |
| Shortcuts | `shortcuts` | `settings.shortcutsPage.menuLabel` → "Shortcuts" | yes | always |
| Sites | `sites` | `settings.sites.title` → "Sites" | conditional | `userProfile.workspaceType == ServerW && currentUserRole != null && currentUserRole != Guest` (no feature flag) |
| Plan | `plan` | `settings.planPage.menuLabel` → "Plan" | **no** | `FeatureFlag.planBilling.isOn && state.isBillingEnabled`; `planBilling.isOn` is hard-coded `false` in this checkout (`lib/shared/feature_flags.dart` diff). Also `isBillingEnabled` needs Owner + server URL ∈ {`https://beta.appflowy.cloud`,`https://test.appflowy.cloud`} in release (vendor URLs are rejected by `SelfHostedPolicy`). The only other entry (`sidebar_toast.dart` → `initPage: SettingsPage.plan`) is inside `if (FeatureFlag.planBilling.isOn)` in `sidebar_footer.dart` → also dead. |
| Billing | `billing` | `settings.billingPage.menuLabel` → "Billing" | **no** | same as Plan |
| Feature flags | `featureFlags` | literal "Feature Flags" (icon `Icons.flag`, 20) | debug only | `kDebugMode`; not present in release builds |

Initial page when dialog opens: `initPage ?? SettingsPage.account`. Page switch = `SettingsDialogEvent.setSelectedPage(page)` (in-memory only, not persisted).

---

### C.10 Members

Files: `lib/workspace/presentation/settings/widgets/members/workspace_member_page.dart`, `.../members/workspace_member_bloc.dart`, `.../members/invitation/invite_member_by_email.dart`, `.../invite_member_by_link.dart`, `.../member_http_service.dart` (`m_*` files = mobile variants, out of scope), `lib/shared/af_role_pb_extension.dart`, `lib/user/application/user_service.dart`.

Reachable: conditional (see table). Bloc: `WorkspaceMemberBloc(userProfile: user)` + `initial` + `getInviteCode`. NOTE: the page receives `workspaceId` but does NOT pass it to the bloc → bloc resolves workspace via `FolderEventReadCurrentWorkspace()` → `WorkspacePB.id`.

#### Roles / permissions (`AFRolePB`: Owner=0, Member=1, Guest=2)
| Role | Label key → en | canInvite | canDelete | canUpdate | canLeave |
|---|---|---|---|---|---|
| Owner | `settings.appearance.members.owner` → "Owner" | yes | yes | yes | no |
| Member | `settings.appearance.members.member` → "Member" | no | no | no | yes |
| Guest | `settings.appearance.members.guest` → "Guest" | no | no | no | yes |

`myRole` = role of the member whose `email == userProfile.email`; not found → `Guest` (and error log).

#### Layout (SettingsBody, title `settings.appearance.members.title` → "Members", `autoSeparate:false`, no description)
| # | Section | Visible when |
|---|---|---|
| 1 | Invite by link row | `myRole == Owner` |
| 2 | spacer + Invite by email row + spacer(bottom 0) | `myRole == Owner` |
| 3 | Member list (header + rows, Divider between) | `members.isNotEmpty` |
No loading spinner, no error/empty UI (keys `workspaceMembersError*` unused). Member-load failure → empty list (nothing rendered).

#### 1. Invite by link
| Control | Type | Label key → en | Behavior |
|---|---|---|---|
| Title | text (body.enhanced, 1 line) | `settings.appearance.members.inviteLinkToAddMember` → "Invite link to add member" | — |
| Description | rich text (caption) | `settings.appearance.members.clickToCopyLink` → "Click to copy link" + ` ${settings.appearance.members.or} ` → " or " + link-styled `settings.appearance.members.generateANewLink` → "generate a new link" (clickable) | see Generate |
| Copy link | `AFOutlinedTextButton.normal` | `settings.appearance.members.copyLink` → "Copy link" | see Copy |

Copy link: (a) if `subscriptionInfo.plan == FreePlan && members.length >= 2` → `showConfirmDialog` (style onlyOk) title `settings.appearance.members.inviteFailedDialogTitle` "Upgrade to Pro Plan", description `settings.appearance.members.inviteFailedMemberLimit` "This workspace has reached the free limit. Please upgrade to Pro to unlock more members.", confirm `upgradePlanModal.actionButton` "Upgrade" → `upgradePlan`; stop. (b) else if `inviteLink != null` → clipboard plain text; dismiss previous toast; toast `shareAction.copyLinkSuccess` "Copied link to clipboard". (c) else error toast `settings.appearance.members.noInviteLink` "You haven't generated an invite link yet.".

Generate new link: (a) if `inviteLink == null && plan == FreePlan && members.length >= 2` → same upgrade dialog. (b) if `inviteLink != null` → `showConfirmDialog(style: cancelAndOk)` title `settings.appearance.members.resetInviteLink` "Reset the invite link?", description `settings.appearance.members.resetInviteLinkDescription` "Resetting will deactivate the current link for all space members and generate a new one. The old link will no longer valid.", confirm = destructive button `settings.appearance.members.reset` "Reset" → `generateInviteLink` + pop. (c) else → `generateInviteLink`.

Result handling (listener `_showResultDialog`):
| Action | Success | Failure |
|---|---|---|
| generateInviteLink (no previous link) | toast `settings.appearance.members.generatedLinkSuccessfully` "Generated link successfully"; copy link to clipboard; after 200 ms toast "Copied link to clipboard" | error toast `settings.appearance.members.generatedLinkFailed` "Failed to generate link" |
| resetInviteLink (previous link existed) | toast `settings.appearance.members.resetLinkSuccessfully` "Reset link successfully"; copy + 200 ms toast | error toast `settings.appearance.members.resetLinkFailed` "Failed to reset link" |

Invite link string: `"${KV kAppFlowyBaseShareDomain ?? ''}/app/invited/$code"` (returns `''` if no auth token). In this checkout `getAppFlowyShareDomain()` defaults to `''` (vendor default removed).

HTTP (not protobuf) — `MemberHttpService`:
| Op | Method | URL | Body | Response | When |
|---|---|---|---|---|---|
| get code | GET | `<scheme>://<host>:<port>/api/workspace/{workspaceId}/invite-code` | — | `{"data":{"code":"<non-empty string>"}}` | page open (`getInviteCode`) and whenever workspaceId changes |
| generate | POST | same | `{"validity_period_hours": null}` | `{"data":{"code":...}}` | generate/reset |
| delete | DELETE | same | — | any | defined, never called |
Base URL = KV `kAppFlowyCloudBaseURL` (`getAppFlowyCloudUrl()`, default `''` in this checkout); only scheme/host/port of base are used (base path dropped). Headers: `Content-Type: application/json`, `Authorization: Bearer <access_token>` where access_token = `jsonDecode(UserProfilePB.token)['access_token']` (`lib/shared/af_user_profile_extension.dart`). Status ≠200 → `FlowyError(msg: body.msg ?? default)`; GET failure is silent.

#### 2. Invite by email
| Control | Type | Label key → en | Validation / action |
|---|---|---|---|
| Label | text (body.enhanced) | `settings.appearance.members.inviteMemberByEmail` → "Invite member by email" | — |
| Email | `AFTextField` size m | hint `settings.appearance.members.inviteHint` → "Invite by email" | Enter submits |
| Invite | `AFFilledTextButton.primary` | `settings.appearance.members.sendInvite` → "Invite" | `isEmail()` (package `string_validator`); invalid → error toast `settings.appearance.members.emailInvalidError` "Invalid email, please check and try again"; valid → dispatch + clear field immediately |
Event: `UserEventInviteWorkspaceMember(WorkspaceMemberInvitationPB{workspace_id, invitee_email, role: Member})` → void.
Success → toast `settings.appearance.members.inviteMemberSuccess` "The invitation has been sent successfully" (member list NOT refreshed). Failure → `showConfirmDialog` (onlyOk) title "Upgrade to Pro Plan" (`inviteFailedDialogTitle`), description = `error.code == ErrorCode.WorkspaceMemberLimitExceeded` ? `inviteFailedMemberLimit` : `settings.appearance.members.failedToInviteMember` "Failed to invite member", confirm `settings.appearance.members.memberLimitExceededUpgrade` "upgrade" → `upgradePlan`.

#### 3. Member list
Header row (secondary text): flex 4 `settings.appearance.members.user` "User" | flex 2 `settings.appearance.members.role` "Role" | flex 3 `settings.accountPage.email.title` "Email" | 28 px spacer.
Row: flex 4 = `UserAvatar(iconUrl: avatar_url, name, size s)` + name (1 line, ellipsis) + caption `"Joined on ${DateFormat('MMM d, y')(joined_at*1000 ms)}"` (hard-coded English); flex 2 = role label (read-only text in all cases — `_MemberRoleActionList` renders text only; no role-change UI on desktop); flex 3 = email (1 line, tooltip = email); trailing = "…" button (`three_dots_s`) if `myRole == Owner && member.email != userProfile.email`, else 28 px spacer.
"…" popover (bottomWithCenterAligned, barrier) single action `settings.appearance.members.removeFromWorkspace` "Remove from Workspace" → `showCancelAndConfirmDialog` title `settings.appearance.members.removeMember` "Remove Member", description `settings.appearance.members.areYouSureToRemoveMember` "Are you sure you want to remove this member?", confirm `button.yes` "Yes" → `UserEventRemoveWorkspaceMember(RemoveWorkspaceMemberPB{workspace_id, email})`; success → row removed locally; no toast either way.

#### Backend events used by the bloc
| Purpose | Event | Payload → Response |
|---|---|---|
| list members | `UserEventGetWorkspaceMembers` | `QueryWorkspacePB{workspace_id}` → `RepeatedWorkspaceMemberPB{items: WorkspaceMemberPB{email,name,role,avatar_url?,joined_at? (sec)}}` |
| subscription (owner only, after load) | `UserEventGetWorkspaceSubscriptionInfo` | `UserWorkspaceIdPB{workspace_id}` → `WorkspaceSubscriptionInfoPB{plan, plan_subscription, add_ons}` |
| invite | `UserEventInviteWorkspaceMember` | `WorkspaceMemberInvitationPB{workspace_id, invitee_email, role=Member}` |
| remove | `UserEventRemoveWorkspaceMember` | `RemoveWorkspaceMemberPB{workspace_id, email}` |
| add w/o invite (bloc only, no UI) | `UserEventAddWorkspaceMember` | `AddWorkspaceMemberPB{workspace_id, email}`; result handler: toast `addMemberSuccess` "Member added successfully" / dialog `memberLimitExceeded` or `failedToAddMember` |
| role change (bloc only, no UI) | `UserEventUpdateWorkspaceMember` | `UpdateWorkspaceMemberPB{workspace_id, email, role}` |
| upgrade (`upgradePlan`, only if plan==FreePlan) | `UserEventSubscribeWorkspace` | `SubscribeWorkspacePB{workspace_id, recurring_interval=Year, workspace_subscription_plan=Pro, success_url="https://appflowy.com/after-payment?plan=pro"` (debug: `https://beta.appflowy.com/...`)`}` → `PaymentLinkPB.payment_link` opened via `afLaunchUrlString` |
Leave workspace is NOT on this page (Workspace page; `UserEventLeaveWorkspace(UserWorkspaceIdPB)`), documented elsewhere.
Limits: client-side only for invite-link buttons (Free plan && ≥2 members → upgrade dialog); server limit surfaced via `ErrorCode.WorkspaceMemberLimitExceeded`.

---

### C.11 Shortcuts

Files: `lib/workspace/presentation/settings/pages/settings_shortcuts_view.dart`, `lib/workspace/application/settings/shortcuts/{settings_shortcuts_cubit,settings_shortcuts_service,shortcuts_model}.dart`, `lib/plugins/document/presentation/editor_plugins/shortcuts/command_shortcuts.dart`; command definitions from `appflowy_editor` (git 470c4e7), `appflowy_editor_plugins` (git 4efcff7, code-block commands) and app files. Reachable: yes (always). Scope: document-editor `CommandShortcutEvent`s only (no app/global shortcuts).

#### Layout (SettingsBody title `settings.shortcutsPage.title` → "Shortcuts", `autoSeparate:false`)
| Control | Type | Key → en | Behavior |
|---|---|---|---|
| Search | `AFTextField` | hint `settings.shortcutsPage.searchHint` → "Search" | live filter: `afLabel.toLowerCase().contains(query.toLowerCase())` |
| Reset default | hover button (`restore_s` 20px + text) | `settings.shortcutsPage.actions.resetDefault` → "Reset default" | `showConfirmDialog(style: cancelAndOk)` title `settings.shortcutsPage.resetDialog.title` "Reset shortcuts", description `...resetDialog.description` "This will reset all of your keybindings to the default, you cannot undo this later, are you sure you want to proceed?", confirm `...resetDialog.buttonLabel` "Reset" → `resetToDefault()` |
| List | non-scrolling ListView of `ShortcutSettingTile` | — | loading (`initial`/`updating`) → `CircularProgressIndicator`; failure → `FlowyErrorPage.message(settings.shortcutsPage.errorPage.message` "Failed to load shortcuts: {}" (arg = state.error), howToFix `...errorPage.howToFix` "Please try again, if the issue persists please reach out on GitHub.")` |
Errors in state: `settings.shortcutsPage.couldNotLoadErrorMsg` "Could not load shortcuts, Try again", `...couldNotSaveErrorMsg` "Could not save shortcuts, Try again".

#### Tile (`ShortcutSettingTile`)
- Left (Expanded): label = `afLabel` (14px, max 2 lines). Right (Expanded): key badges for **first** keybinding only, order `ctrl`,`meta`,`shift`,`alt`,`<keyLabel>`; badge text lowercase; icon badges for `meta`, `arrow left/right/up/down`, `shift`, `tab`, `enter`/`return`, `opt`/`option`. Empty binding → 24px blank.
- On hover: edit icon (`edit_s` 16) tooltip `settings.shortcutsPage.editTooltip` "Press to start editing the keybinding". Only one tile can edit at a time.
- Edit mode: `FlowyTextField` hint `settings.shortcutsPage.editBindingHint` "Input new binding", clear (x) suffix when non-empty. Key capture: every KeyDown/KeyRepeat replaces the text with `ctrl+`/`meta+`/`shift+`/`alt+` (in that order, from currently pressed modifiers) + key name (reverse lookup in editor `keyToCodeMapping`; pure modifier press → just the prefix). `Enter` (without Shift) = commit; `Escape` = cancel; tap outside = cancel (except while conflict dialog open). Shift+Enter is captured as a binding.
- Commit: if text == current command → close. Else conflict check; no conflict → `command.updateCommand(command: text)` + `updateAllShortcuts()` (save) + close.
- Conflict detection (`ShortcutsCubit.getConflict`): iterate all shortcuts (sorted list order); conflict = first shortcut whose `command.split(',')` contains the exact new string AND whose "is code-block command" flag equals the edited one's (code-block commands only conflict with code-block commands, others only with others). Can match the edited shortcut itself if it has multiple bindings. Note `', '`-separated defaults (e.g. `backspace, shift+backspace`) yield entries with a leading space that never match.
- Conflict dialog (`SettingsAlertDialog`): title `settings.shortcutsPage.conflictDialog.title` "{} is currently in use" (arg new binding); body = `...descriptionPrefix` "This keybinding is currently being used by " + **bold conflicting afLabel** + `...descriptionSuffix` ". If you replace this keybinding, it will be removed from {}." (arg new binding); confirm `...confirmLabel` "Continue" → `conflict.clearCommand()` (command='' and no keybindings) + update + save; cancel → stays editing.

#### Labels (`afLabel`)
Matched by `CommandShortcutEvent.key` against a fixed table of `settings.shortcutsPage.keybindings.*` keys; otherwise `description?.capitalize()` (first char upper) or `''`. `delete` on macOS uses `keybindings.deleteMacOS`.

#### Persistence
- File: `<ApplicationDataStorage.getPath()>/shortcuts/shortcuts.json` (data folder = KV `io.appflowy.appflowy_flutter.path_location` or default `getApplicationSupportDirectory()/data` → Windows `%APPDATA%\io.appflowy\AppFlowy\data\shortcuts\shortcuts.json`). Created empty if missing.
- Format: `{"commandShortcuts":[{"key":"<CommandShortcutEvent.key>","command":"<binding string>"}, ...]}` — **all** shortcuts written on every save (not just changed ones), `command` = platform-resolved string.
- Load (settings page `fetchShortcuts` and every editor open `editor_page.dart::_initializeShortcuts`): for each saved entry, first live shortcut with same `key` and different `command` → `updateCommand(command)`. Empty file → no changes. Then list sorted by `key.toLowerCase()` (ordinal).
- Reset: write `defaultCommandShortcutEvents` (copies captured on first access; editor touches it before applying customizations) then reload.
- Binding string grammar (editor): combos separated by `,`; modifiers `ctrl`,`shift`,`alt`,`meta` (`cmd`/`win` = meta); keys per editor `keyToCodeMapping` (`arrow left`, `page up`, `home`, `end`, `backspace`, `delete`, `tab`, `enter`, `escape`, letters…). Default platform pick: Windows→`windowsCommand`(none set)→`command`; macOS→`macOSCommand` if set; Linux→`command`.

#### Full default list as displayed (79 rows, ordinal sort by lower-cased key). Win/Linux = `command`; "=" = same on macOS. [CB] = code-block command. Label: `kb.` = `settings.shortcutsPage.keybindings.`; "(desc)" = capitalized description fallback.
| # | Symbol | key (persisted id) | Win/Linux | macOS | Label key = en |
|---|---|---|---|---|---|
| 1 | customTextCenterAlignCommand | `Align text to the center` | `ctrl+shift+c` | = | kb.alignCenter = Align text center |
| 2 | customTextLeftAlignCommand | `Align text to the left` | `ctrl+shift+l` | = | kb.alignLeft = Align text left |
| 3 | customTextRightAlignCommand | `Align text to the right` | `ctrl+shift+r` | = | kb.alignRight = Align text right |
| 4 | arrowLeftToTitle | `arrow left to title` | `arrow left` | = | (desc) Arrow left to title |
| 5 | arrowUpToTitle | `arrow up to title` | `arrow up` | = | (desc) Arrow up to title |
| 6 | backspaceCommand | `backspace` | `backspace, shift+backspace` | = | kb.backspace = Delete |
| 7 | backspaceToTitle | `backspace to title` | `backspace` | = | (desc) Backspace to title |
| 8 | convertToParagraphCommand | `convert to paragraph` | `backspace` | = | kb.convertToParagraph = Convert block to paragraph |
| 9 | customCopyCommand | `copy the selected content` | `ctrl+c` | `cmd+c` | kb.copy = Copy selection |
| 10 | selectAllInCodeBlockCommand [CB] | `ctrl + a to select all content inside a code block` | `ctrl+a` | `meta+a` | kb.selectAllCodeblock = Select all |
| 11 | emojiShortcutEvent | `Ctrl + Alt + E to show emoji picker` | `ctrl+alt+e` | `cmd+alt+e` | kb.showEmojiPicker = Show emoji picker |
| 12 | customCutCommand | `cut the selected content` | `ctrl+x` | `cmd+x` | kb.cut = Cut selection |
| 13 | customDeleteCommand | `Delete Key` | `delete, shift+delete` | = | kb.delete = Delete right character (macOS kb.deleteMacOS = Delete left character) |
| 14 | deleteLeftSentenceCommand | `delete the left line` | `ctrl+alt+backspace` | `cmd+backspace` | kb.deleteLeftSentence = Delete left sentence |
| 15 | deleteLeftWordCommand | `delete the left word` | `ctrl+backspace` | `alt+backspace` | kb.deleteLeftWord = Delete left word |
| 16 | deleteRightWordCommand | `delete the right word` | `ctrl+delete` | `alt+delete` | kb.deleteRightWord = Delete right word |
| 17 | customExitEditingCommand | `exit the editing mode` | `escape` | = | kb.exit = Exit editing |
| 18 | indentCommand | `indent` | `tab` | = | kb.indent = Indent |
| 19 | insertNewParagraphNextToCodeBlockCommand [CB] | `insert a new paragraph next to the code block` | `shift+enter` | = | kb.insertNewParagraphInCodeblock = Insert new paragraph |
| 20 | insertInlineMathEquationCommand | `Insert inline math equation` | `ctrl+shift+e` | `cmd+shift+e` | kb.insertInlineMathEquation = Insert inline math eqaution (sic) |
| 21 | showLinkMenuCommand | `link menu` | `ctrl+k` | `cmd+k` | kb.showLinkMenu = Show link menu |
| 22 | moveCursorDownSelectCommand | `move cursor down and select one line` | `shift+arrow down` | = | kb.moveCursorDownSelect = Select and move cursor down |
| 23 | moveCursorBottomCommand | `move cursor to end of file` | `ctrl+arrow down` | `cmd+arrow down` | kb.moveCursorBottom = Move cursor to the bottom |
| 24 | moveCursorBottomSelectCommand | `move cursor to end of file and select all` | `ctrl+shift+arrow down` | `cmd+shift+arrow down` | kb.moveCursorBottomSelect = Select and move cursor to the bottom |
| 25 | moveCursorEndSelectCommand | `move cursor to select till end of line` | `shift+end` | `cmd+shift+arrow right` | kb.moveCursorEndSelect = Select and move cursor to the end |
| 26 | moveCursorBeginSelectCommand | `move cursor to select till start of line` | `shift+home` | `cmd+shift+arrow left` | kb.moveCursorBeginSelect = Select and move cursor to the beginning |
| 27 | moveCursorTopCommand | `move cursor to start of file` | `ctrl+arrow up` | `cmd+arrow up` | kb.moveCursorTop = Move cursor to the top |
| 28 | moveCursorTopSelectCommand | `move cursor to start of file and select all` | `ctrl+shift+arrow up` | `cmd+shift+arrow up` | kb.moveCursorTopSelect = Select and move cursor to the top |
| 29 | moveCursorUpSelectCommand | `move cursor up and select one line` | `shift+arrow up` | = | kb.moveCursorUpSelect = Select and move cursor up |
| 30 | moveCursorToBeginCommand | `move the cursor at the start of line` | `home` | `cmd+arrow left` | kb.moveCursorBeginning = Move cursor to the beginning |
| 31 | moveCursorLeftCommand | `move the cursor backward one character` | `arrow left` | = | kb.moveCursorLeft = Move cursor left |
| 32 | moveCursorDownCommand | `move the cursor downward` | `arrow down` | = | kb.moveCursorDown = Move cursor down |
| 33 | moveCursorRightCommand | `move the cursor forward one character` | `arrow right` | = | kb.moveCursorRight = Move cursor right |
| 34 | moveCursorLeftSelectCommand | `move the cursor left select` | `shift+arrow left` | = | kb.moveCursorLeftSelect = Select and move cursor left |
| 35 | moveCursorRightSelectCommand | `move the cursor right select` | `shift+arrow right` | = | kb.moveCursorRightSelect = Select and move cursor right one |
| 36 | moveCursorLeftWordSelectCommand | `move the cursor to select the left word` | `ctrl+shift+arrow left` | `alt+shift+arrow left` | kb.moveCursorLeftWordSelect = Select and move cursor left one word |
| 37 | moveCursorRightWordSelectCommand | `move the cursor to select the right word` | `ctrl+shift+arrow right` | `alt+shift+arrow right` | kb.moveCursorRightWordSelect = Select and move cursor to the right one word |
| 38 | moveCursorToEndCommand | `move the cursor to the end of line` | `end` | `cmd+arrow right` | kb.moveCursorEnd = Move cursor to the end |
| 39 | moveCursorToLeftWordCommand | `move the cursor to the left word` | `ctrl+arrow left` | `alt+arrow left` | kb.moveCursorLeftWord = Move cursor left one word |
| 40 | moveCursorToRightWordCommand | `move the cursor to the right word` | `ctrl+arrow right` | `alt+arrow right` | kb.moveCursorRightWord = Move cursor right one word |
| 41 | moveCursorUpCommand | `move the cursor upward` | `arrow up` | = | kb.moveCursorUp = Move cursor up |
| 42 | openInlineLinkCommand | `open inline link` | `alt+enter` | = | kb.openInlineLink = Open in-line link |
| 43 | openLinksCommand | `open links` | `alt+shift+enter` | = | kb.openLinks = Open all selected links |
| 44 | outdentCommand | `outdent` | `shift+tab` | = | kb.outdent = Outdent |
| 45 | pasteInCodeblock [CB] | `paste in codeblock` | `ctrl+v` | `cmd+v` | kb.pasteInCodeblock = Paste in codeblock |
| 46 | customPasteCommand | `paste the content` | `ctrl+v` | `cmd+v` | kb.paste = Paste in content |
| 47 | customPastePlainTextCommand | `paste the plain content` | `ctrl+shift+v` | `cmd+shift+v` | (desc) Paste content |
| 48 | arrowDownInTableCell (simple table) | `Press arrow down in table cell` | `arrow down` | = | (desc) Move to down cell at same offset |
| 49 | arrowLeftInTableCell (simple table) | `Press arrow left in table cell` | `arrow left` | = | (desc) Move to right cell if its at the end of current cell (sic) |
| 50 | arrowRightInTableCell (simple table) | `Press arrow right in table cell` | `arrow right` | = | (desc) Move to right cell if its at the end of current cell |
| 51 | arrowUpInTableCell (simple table) | `Press arrow up in table cell` | `arrow up` | = | (desc) Move to up cell at same offset |
| 52 | backspaceInTableCell (simple table) | `Press backspace in table cell` | `backspace` | = | (desc) Ignore the backspace key in table cell |
| 53 | enterInTableCell (simple table) | `Press enter in table cell` | `enter` | = | (desc) Press the enter key in table cell |
| 54 | shiftTabInTableCell (simple table) | `Press shift + tab in table cell` | `shift+tab` | = | (desc) Move the selection to the previous cell |
| 55 | tabInTableCell (simple table) | `Press tab in table cell` | `tab` | = | (desc) Move the selection to the next cell |
| 56 | customRedoCommand | `redo` | `ctrl+y,ctrl+shift+z` | `cmd+shift+z` | kb.redo = Redo |
| 57 | removeToggleHeadingStyle | `remove toggle heading style` | `backspace` | = | (desc) Remove toggle heading style |
| 58 | pageDownCommand | `scroll one page down` | `page down` | = | kb.pageDown = Scroll one page down |
| 59 | pageUpCommand | `scroll one page up` | `page up` | = | kb.pageUp = Scroll one page up |
| 60 | endCommand | `scroll to the bottom of the document` | `ctrl+end` | `end` | kb.end = Scroll to the bottom |
| 61 | homeCommand | `scroll to the top of the document` | `ctrl+home` | `home` | kb.home = Scroll to the top |
| 62 | selectAllInTableCellCommand | `Select all contents in table cell` | `ctrl+a` | `cmd+a` | (desc) Select all contents in table cell |
| 63 | selectAllCommand | `select all the selectable content` | `ctrl+a` | `cmd+a` | kb.selectAll = Select all |
| 64 | tabToDeleteSpacesInCodeBlockCommand [CB] | `shift + tab to delete two spaces at the line start in code block` | `shift+tab` | = | kb.outdentLineCodeblock = Delete two spaces at line start |
| 65 | tabSpacesAtCurosrInCodeBlockCommand [CB] | `tab to insert two spaces at the cursor in code block` | `tab` | = | kb.twoSpacesCursorCodeblock = Insert two spaces at cursor |
| 66 | tabToInsertSpacesInCodeBlockCommand [CB] | `tab to insert two spaces at the line start in code block` | `tab` | = | kb.indentLineCodeblock = Insert two spaces at line start |
| 67 | tableNavigationArrowDownCommand | `table navigation` | `arrow down` | = | (desc) Table navigation |
| 68 | toggleBody | `toggle Body` | `ctrl+shift+b` | `cmd+shift+b` | (desc) Toggle body |
| 69 | toggleBoldCommand | `toggle bold` | `ctrl+b` | `cmd+b` | kb.toggleBold = Toggle bold |
| 70 | toggleCodeCommand | `toggle code` | `ctrl+e` | `cmd+e` | kb.toggleCode = Toggle in-line code |
| 71 | toggleHighlightCommand | `toggle highlight` | `ctrl+shift+h` | `cmd+shift+h` | kb.toggleHighlight = Toggle highlight |
| 72 | toggleH1 | `toggle into Heading 1` | `ctrl+shift+t` | `cmd+shift+t` | (desc) Toggle H1 |
| 73 | toggleH2 | `toggle into Heading 2` | `ctrl+shift+g` | `cmd+shift+g` | (desc) Toggle H2 |
| 74 | toggleH3 | `toggle into Heading 3` | `ctrl+shift+j` | `cmd+shift+j` | (desc) Toggle H3 |
| 75 | toggleItalicCommand | `toggle italic` | `ctrl+i` | `cmd+i` | kb.toggleItalic = Toggle italic |
| 76 | toggleStrikethroughCommand | `toggle strikethrough` | `ctrl+shift+s` | `cmd+shift+s` | kb.toggleStrikethrough = Toggle strikethrough |
| 77 | toggleToggleListCommand | `toggle the toggle list` | `ctrl+enter` | `cmd+enter` | kb.toggleToDoList = Toggle to do list |
| 78 | toggleUnderlineCommand | `toggle underline` | `ctrl+u` | `cmd+u` | kb.toggleUnderline = Toggle underline |
| 79 | customUndoCommand | `undo` | `ctrl+z` | `cmd+z` | kb.undo = Undo |

Removed from the editor's standard list (never shown): `copyCommand`, `cutCommand`, `pasteCommand`, `pasteTextWithoutFormattingCommand`, `toggleTodoListCommand`, `undoCommand`, `redoCommand`, `exitEditingCommand`, editor `tableCommands` (8), `deleteCommand`. Unused label keys therefore: `kb.pasteWithoutFormatting`, `kb.enterInTableCell`, `kb.leftInTableCell`, `kb.rightInTableCell`, `kb.upInTableCell`, `kb.downInTableCell`, `kb.tabInTableCell`, `kb.shiftTabInTableCell`, `kb.backSpaceInTableCell` (the app's simple-table commands use different keys). Code-block command descriptions come from `settings.shortcutsPage.commands.codeBlock*` (e.g. "Insert a new paragraph next to the code block") but are overridden by `kb.*` labels above.

---

### C.12 Notifications

Files: `lib/workspace/presentation/settings/widgets/settings_notifications_view.dart`, `lib/workspace/application/settings/notifications/notification_settings_cubit.dart`, `lib/user/application/user_settings_service.dart`. Reachable: yes (always). Cubit is app-global (`lib/startup/tasks/app_widget.dart`).

SettingsBody title `settings.menu.notifications` → "Notifications". Two `SettingListTile`s with trailing `Toggle`:
| # | Label key → en | Hint key → en | Default | Source of truth / persistence |
|---|---|---|---|---|
| 1 | `settings.notifications.enableNotifications.label` → "Enable notifications" | `settings.notifications.enableNotifications.hint` → "Turn off to stop local notifications from appearing." | `true` (pre-load and Rust default) | Backend: load `UserEventGetNotificationSettings()` → `NotificationSettingsPB{notifications_enabled}`; on toggle: flip, emit, then save = KV `showNotificationIcon` ← current icon toggle value (`"true"/"false"`) AND `UserEventSetNotificationSettings(NotificationSettingsPB{notifications_enabled})` (error → log only) |
| 2 | `settings.notifications.showNotificationsIcon.label` → "Show notifications icon" | `settings.notifications.showNotificationsIcon.hint` → "Toggle off to hide the notification icon in the sidebar." | `true` (KV missing) | KV `showNotificationIcon` (bool string). Toggle only changes in-memory state — **not persisted** unless toggle #1 is changed afterwards (bug, reproduce or fix). Consumer: `lib/workspace/presentation/notifications/widgets/notification_button.dart` hides the sidebar bell. |
No toasts/dialogs. AMBIGUOUS: no Dart or Rust consumer of `notifications_enabled` found (stored only); its effect on reminders is unclear.

---

### C.13 Manage data / storage

Files: `lib/workspace/presentation/settings/pages/settings_manage_data_view.dart`, `lib/features/settings/**` (`DataLocationBloc`, `RustSettingsRepositoryImpl`, `UserDataLocation`), `lib/workspace/application/settings/application_data_storage.dart`, `lib/workspace/application/settings/setting_file_importer_bloc.dart`, `lib/workspace/presentation/settings/pages/fix_data_widget.dart`, `lib/workspace/presentation/settings/widgets/files/{settings_export_file_widget,settings_file_exporter_widget}.dart`, `lib/workspace/application/settings/settings_file_exporter_cubit.dart`, `lib/shared/appflowy_cache_manager.dart`, `lib/util/share_log_files.dart`, `lib/startup/tasks/rust_sdk.dart`. Reachable: yes (always). Props: `userProfile`, `workspace: UserWorkspacePB` (current). `isCloudWorkspace = workspace.workspaceType == ServerW`.

SettingsBody title `settings.manageDataPage.title` → "Manage data", description `settings.manageDataPage.description` → "Manage data local storage or Import your existing data into AppFlowy."

| # | Category (title key → en) | Visible | Controls |
|---|---|---|---|
| 1 | `settings.manageDataPage.dataStorage.title` → "File storage location"; tooltip `...dataStorage.tooltip` → "The location where your files are stored" | always | header action **Reset** (only if `isCloudWorkspace`); path row; **Change path** button (only if `isCloudWorkspace`); spinner while path null |
| 2 | `settings.manageDataPage.importData.title` → "Import data"; tooltip `...importData.tooltip` → "Import data from AppFlowy backups/data folders" | always | Import row |
| 3 | `settings.files.exportData` → "Export your data" | `kDebugMode` only | Export row + Fix data sub-category |
| 4 | `workspace.errorActions.exportLogFiles` → "Export log files" | always | Export logs row |
| 5 | `settings.manageDataPage.cache.title` → "Clear cache" | always | Clear cache row |

#### 1. Data folder
- Load: `UserEventGetUserSetting()` → `UserSettingPB{user_folder}` → displayed path. (`isCustom = user_folder.contains(defaultDir)` — inverted logic, unused by UI.)
- Path text (action color, max 2 lines, underline on hover), tooltip `settings.manageDataPage.dataStorage.actions.openTooltip` → "Open current data folder location"; click → `afLaunchUri(Uri.file(path))` (OS file manager).
- Copy icon button (`copy_s` 20, ghost) tooltip `...actions.copy` → "Copy path": copies path to clipboard; swaps to pill `...actions.copiedHint` → "Path copied!" for 300 ms.
- Reset (`SettingAction`, icon `restore_s` 20, label `settings.common.reset` → "Reset", tooltip `...actions.resetTooltip` → "Reset to default location"): `showSimpleAFDialog` title `...dataStorage.resetDialog.title` → "Are you sure?", content `...resetDialog.description` → "Resetting the path to the default data location will not delete your data. If you want to re-import your current data, you should copy the path of your current location first.", primary `button.confirm` "Confirm" → `DataLocationResetToDefault`, secondary `button.cancel` "Cancel". Effect: KV `pathLocation` ← default dir (`appFlowyApplicationDataDirectory()`); `didResetToDefault=true` → listener pops settings dialog and `runAppFlowy(isAnon: true)` (full in-process restart). No data copied/deleted.
- Change path (`AFFilledTextButton.primary` `...actions.change` → "Change path"): directory picker → **dead code**: guard `if (!context.mounted || path == null || path == path) return;` (shadowed variable, always returns). Intended effect (`setCustomPath`): normalize (`/`→`\` on Windows; strip `/Volumes/*` on macOS); append `AppFlowyDataDoNotRename` if basename differs; create dir; KV `pathLocation` ← path; no restart. `...actions.open` "Open folder" key unused.
- Default data dir: release `getApplicationSupportDirectory()/data` (Windows `%APPDATA%\io.appflowy\AppFlowy\data`), develop `.../data_dev`, tests `<cwd>/.sandbox`. Startup: `ApplicationDataStorage.getPath()` → passed as `custom_app_path` to Rust init (`AppFlowyConfiguration`, `origin_app_path` = default). `getPath()`: if KV path missing → default; if stored dir does not exist → **clears the whole KV store** (`SharedPreferences.clear()`) and uses default.
- No `UserEventSetDataLocation`-style event exists; location is purely client KV + Rust init config.

#### 2. Import data
`SingleSettingAction` label `settings.manageDataPage.importData.description` → "Copy data from an external AppFlowy data folder" (max 2 lines), button `...importData.action` → "Browse file" → directory picker → `UserEventImportAppFlowyDataFolder(ImportAppFlowyDataPB{path, import_container_name: "import_" + DateFormat('yyyy-MM-dd HH:mm:ss')(now), parent_view_id: KV lastOpenedSpaceId if set})`. Result → FToast (center gravity, `FlowyMessageToast`): success `settings.menu.importSuccess` → "Successfully imported the AppFlowy data folder", failure `settings.menu.importFailed` → "Importing the AppFlowy data folder failed". No progress UI (loadingState tracked but not rendered).

#### 3. Export data (debug only)
Row: text `settings.files.exportData` "Export your data" + icon button (`open_folder_lg`, tooltip `settings.files.export` "Export") → dialog `FileExporterWidget`:
- Loads `FolderEventReadCurrentWorkspace()` → `WorkspacePB.views` (top-level) each with `child_views`; all expanded + all selected initially.
- Header `settings.files.selectFiles` "Select the files that need to be export" + toggle button `settings.files.selectAll` "Select all" / `settings.files.deselectAll` "Deselect all".
- List: top-level name row (tap → expand/collapse) + `CheckboxListTile` per child view.
- Buttons `button.cancel` "Cancel", `button.ok` "Ok" → directory picker → for each selected child view: Document → `DocumentEventOpenDocument(OpenDocumentPayloadPB{document_id})` → JSON (`jsonEncode(Document)`) → file `<name>.afdocument`; any other layout → `DatabaseEventExportCSV(DatabaseViewIdPB{value: viewId})` → `DatabaseExportDataPB.data` → `<name>.csv`; duplicate names → `<name>(n).ext`. SnackBar `settings.files.exportFileSuccess` "Export file successfully!" or `settings.files.exportFileFail` "Export file failed!" + failed names (newline-joined); picker cancelled → fail message. Then `popToHome`.
Fix data (sub-category `settings.manageDataPage.data.fixYourData` → "Fix your data"): label `...data.fixYourDataDescription` → "If you're experiencing issues with your data, you can try to fix it here.", button `...data.fixButton` → "Fix" → `WorkspaceDataManager.checkWorkspaceHealth(dryRun: true)` → only logs (uses `FolderEventReadCurrentWorkspace`, `FolderEventGetAllViews`, `FolderEventGetView`); no UI feedback.

#### 4. Export log files
`SingleSettingAction` label = button text source `workspace.errorActions.exportLogFiles` "Export log files", button `settings.files.export` "Export" → zip every file whose basename starts with `log.` under `getApplicationSupportDirectory()` (recursive) → write `<AppSupport>/appflowy_logs.zip` → desktop: `afLaunchUri(zip)` (opens with OS). None found → error toast `noLogFiles` "There're no log files"; exception → error toast with message.

#### 5. Clear cache
`SingleSettingAction` label `settings.manageDataPage.cache.description` → "Help resolve issues like image not loading, missing pages in a space, and fonts not loading. This will not affect your data.", button `settings.manageDataPage.cache.title` → "Clear cache" → `showCancelAndConfirmDialog` title `...cache.dialog.title` "Clear cache", description `...cache.dialog.description` (same text), confirm `button.ok` "Ok" → (1) `FlowyCacheManager.clearAllCache()` = `TemporaryDirectoryCache` (deletes OS temp dir recursively), `CustomImageCacheManager` (image cache), `FeatureFlagCache` (KV `featureFlag` removed, in-memory flags reset); (2) `WorkspaceDataManager.checkViewHealth(dryRun:false)` — for each view whose parent's children (`FolderEventGetView`) don't list it → `FolderEventMoveNestedView(MoveNestedViewPayloadPB{view_id, new_parent_id: parent_view_id, prev_view_id: null})`; (3) toast `...cache.dialog.successHint` "Cache cleared!".

Unused keys present in en-US: `settings.manageDataPage.encryption.*` (encryption UI commented out), `settings.files.*` legacy location strings.

---

### C.14 Plan & Billing (compact)

Reachable: **no** in this checkout (see top table). Files: `lib/workspace/presentation/settings/pages/settings_plan_view.dart`, `settings_plan_comparison_dialog.dart`, `settings_billing_view.dart`, `lib/workspace/application/settings/plan/*`, `lib/workspace/application/settings/billing/settings_billing_bloc.dart`, `lib/workspace/presentation/settings/widgets/cancel_plan_survey_dialog.dart`.

Plan page (`SettingsPlanBloc`; title `settings.planPage.title` "Pricing plan"):
| Section | Content |
|---|---|
| Plan usage summary (`settings.planPage.planUsage.title` "Plan usage summary") | Storage (`...storageLabel` "Storage") and AI Responses (`...aiResponseLabel`) progress boxes from `WorkspaceUsagePB`; toggles/badges for member Pro / AI Max |
| Current plan box (`...currentPlan.bannerLabel` "Current plan") | Free/Pro/Team title+info, "Change plan" → comparison dialog; canceled info with date |
| Add-ons (`...addons.title` "Add-ons") | AI Max box: Add / Active → `addSubscription(AiMax)` |
Events: load = `UserEventGetWorkspaceUsage(UserWorkspaceIdPB)` → `WorkspaceUsagePB{member_count, member_count_limit, storage_bytes, storage_bytes_limit, storage_bytes_unlimited, ai_responses_count, ai_responses_count_limit, ai_responses_unlimited, local_ai}` + `UserEventGetWorkspaceSubscriptionInfo`; subscribe = `UserEventSubscribeWorkspace(SubscribeWorkspacePB)` → open `payment_link`; cancel = `UserEventCancelWorkspaceSubscription(CancelWorkspaceSubscriptionPB{workspace_id, plan: Pro, reason})`; payment-success listener (`SubscriptionSuccessListenable`) reloads.
Comparison dialog (`settings.comparePlanDialog.title` "Compare & select plan"): Free column → if paid & not canceled: `showCancelSurveyDialog` → confirm (cancelAndOk) `...downgradeDialog.title` "Are you sure you want to downgrade your plan?" / `...downgradeLabel` "Downgrade plan" → cancel subscription with survey JSON as reason; Pro column → `addSubscription(Pro)`; success confirm dialog `...paymentSuccess.title`.
Billing page (`SettingsBillingBloc`; title `settings.billingPage.title` "Billing"): Plan (`...plan.title` "Plan": "Change plan" → comparison dialog; "Billing period" + "Edit period" → `UserEventUpdateWorkspaceSubscriptionPaymentPeriod(UpdateWorkspaceSubscriptionPaymentPeriodPB{workspace_id, plan, recurring_interval})`, only if billing portal enabled); Payment details (`...paymentDetails.title`, "Edit method" → `UserEventGetBillingPortal()` → `BillingPortalPB.url` opened); Add-ons (AI Max add/remove/renew; remove → confirm → `CancelWorkspaceSubscription(plan)`).

---

### C.15 Sites (compact)

Reachable: conditional — `ServerW` workspace and role non-null and ≠ Guest. Files: `lib/workspace/presentation/settings/pages/sites/**`. Bloc `SettingsSitesBloc(workspaceId, user)`.
| Section | Content / actions |
|---|---|
| Header | SettingsBody title `settings.sites.title` "Sites" |
| Namespace (`settings.sites.namespaceHeader` "Namespace", description `settings.sites.namespaceDescription` "Manage your namespace and homepage") | columns Namespace / Homepage (`settings.sites.homepageHeader`); homepage picker (`settings.sites.selectHomePage` "Select a page") from published pages; more-actions: `settings.sites.updateNamespace` "Update namespace" (dialog, Free plan → upgrade-to-Pro flow), `settings.sites.removeHomepage` "Remove homepage" |
| Published pages (`settings.sites.publishedPage.title` "All published pages", description "Manage your published pages") | columns `...publishedPage.page` "Page" / `...pathName` "Path name" / `...date` "Published date"; row more-actions: `shareAction.visitSite`, `shareAction.copyLink`, `settings.popupMenuItem.settings` (dialog: edit path name, unpublish), `shareAction.unPublish`; `settings.sites.customUrl`; empty → `...emptyHinText` "You have no published pages in this workspace" |
Events (load order: subscription + namespace in parallel, then published views + home page in parallel): `UserEventGetWorkspaceSubscriptionInfo`; `FolderEventGetPublishNamespace()` → `PublishNamespacePB{namespace}`; `FolderEventListPublishedViews()` → `RepeatedPublishInfoViewPB{items: PublishInfoViewPB{view: FolderViewMinimalPB, info: PublishInfoResponsePB{view_id, publish_name, namespace?, publisher_email, publish_timestamp_sec, unpublished_at_timestamp_sec?}}}`; `FolderEventGetDefaultPublishInfo()` → `PublishInfoResponsePB`; unpublish `FolderEventUnpublishViews(UnpublishViewsPayloadPB{view_ids:[id]})`; namespace `FolderEventSetPublishNamespace(SetPublishNamespacePayloadPB{new_namespace})`; path `FolderEventSetPublishName(SetPublishNamePB{view_id, new_name})`; homepage `FolderEventSetDefaultPublishView(ViewIdPB{value})` / `FolderEventRemoveDefaultPublishView()`; upgrade `UserEventSubscribeWorkspace(Pro)`. Toasts: `settings.sites.success.{namespaceUpdated,updatePathNameSuccess,setHomepageSuccess,removeHomePageSuccess}`, `settings.sites.error.{failedToUpdateNamespace,updatePathNameFailed,setHomepageFailed,removeHomePageFailed,failedToGeneratePaymentLink}`.

---

### C.16 Feature flags

Files: `lib/shared/feature_flags.dart` (modified), `lib/workspace/presentation/settings/widgets/feature_flags/feature_flag_page.dart` (`mobile_feature_flag_screen.dart` = mobile). Reachable: debug builds only (`kDebugMode`).

Page: SettingsBody title literal "Feature flags"; one `ListTile` per `FeatureFlag.data` entry except `unknown`: title = enum `name` (16px), subtitle = `description` (small, 3 lines), trailing `Switch.adaptive(value: isOn)` → `flag.update(value)` (persists) + rebuild. Footer red text button "Restart the app to apply changes" → `runAppFlowy()`.

Persistence: single KV key `featureFlag` (`KVKeys.featureFlag`) = JSON object `{"<enumName>": bool, ...}` (all flags rewritten on each update). `initialize()` at startup: unknown names map to `unknown`; `_values` = all flags `false` overlaid with stored. `clear()` (Clear cache) → `_values = {}` + KV remove. `key` getter `appflowy_feature_flag_<toString()>` is unused.

`isOn` evaluation (this checkout): (1) `planBilling` → **false** (new line in diff); (2) if flag ∈ {planBilling, spaceDesign, search, collaborativeWorkspace, membersSettings, syncDatabase, syncDocument, inlineSubPageMention} → **true** (stored value ignored); (3) else stored value; (4) fallback switch (only reached after `clear()`): sharedSection/unknown → false.
| Enum (persisted name) | Description (literal) | Effective value | Toggle has effect? | Used by (`isOn` refs) |
|---|---|---|---|---|
| collaborativeWorkspace | "if it's on, you can see the workspace list and the workspace settings in the top-left corner of the app" | true (forced) | no | 1 |
| membersSettings | "if it's on, you can see the members settings in the settings page" | true (forced) | no | settings menu |
| syncDocument | "if it's on, the document will be synced in real-time" | true (forced) | no | 6 |
| syncDatabase | "if it's on, the collaborators will show in the database" | true (forced) | no | 0 |
| search | "if it's on, the command palette and search button will be available" | true (forced) | no | 5 |
| planBilling | "if it's on, plan and billing pages will be available in Settings" | **false (forced, customization)** | no | settings menu, sidebar footer |
| spaceDesign | "if it's on, the space design feature will be available" | true (forced) | no | 0 |
| inlineSubPageMention | "if it's on, the inline sub-page mention feature will be available" | true (forced) | no | 3 |
| sharedSection | "if it's on, the shared section will be available" | KV value, default **false** | yes (after restart) | 6 |
| unknown | "" | false; hidden from page | — | — |

---

### C.17 Other settings widgets

| Widget / file | Where used / reachable | Behavior, keys, persistence |
|---|---|---|
| `SettingsAppVersion` — `lib/workspace/presentation/settings/pages/about/app_version.dart` | Account page, category `newSettings.myAccount.aboutAppFlowy` "About AppFlowy" (always) | If `ApplicationInfo.isUpdateAvailable` (latestVersion non-empty and > current): row with red dot + `autoUpdate.settingsUpdateTitle` "New Version ({newVersion}) Available!", `autoUpdate.settingsUpdateDescription` "Current version: {currentVersion} (Official build) → {newVersion}", link `autoUpdate.settingsUpdateWhatsNew` "What's new" → `https://www.appflowy.io/what-is-new`, button `autoUpdate.settingsUpdateButton` "Update" → `versionChecker.checkForUpdate()`. Else: `settings.accountPage.isUpToDate` "AppFlowy is up to date!" + caption `settings.accountPage.officialVersion` "Version {version} (Official build)" (`ApplicationInfo.applicationVersion`). In this checkout `AutoUpdateTask` is removed from `startup.dart` → latestVersion always '' → **always "up to date"** branch. Vendor URLs are blocked by `afLaunchUri` (`SelfHostedPolicy.isVendorHost`). |
| Theme upload — `lib/workspace/presentation/settings/widgets/theme_upload/*`, `appflowy_flutter/packages/flowy_infra/lib/plugins/**` | Workspace page → theme dropdown action (folder icon, tooltip `settings.workspacePage.theme.uploadCustomThemeTooltip` "Upload a custom theme") → `FlowyDialog(maxHeight 300)` | States (AnimatedSwitcher 750 ms): Idle `UploadNewThemeWidget` (folder icon 48, `settings.appearance.themeUpload.description` "Upload your own AppFlowy theme using the button below.", "Learn more" (`document.plugins.autoGeneratorLearnMore`) → `https://docs.appflowy.io/docs/appflowy/product/themes`; on launch failure (always here: vendor host) dialog `FlowyErrorPage` `settings.appearance.themeUpload.urlUploadFailure` "Failed to open url: {}" + `errorDialog.howToFixFallback`; divider; button `settings.appearance.themeUpload.button` "Upload" → `DynamicPluginEvent.addPlugin`). Processing `ThemeUploadLoadingWidget` `...themeUpload.loading` "Please wait while we validate and upload your theme...". Failure `ThemeUploadFailureWidget` (error-tinted, close icon, error message, Learn more, Upload button). Success → dialog pops → snackbar `...themeUpload.uploadSuccess` "Your theme was uploaded successfully". Flow: pick **directory** → must be named `<name>.flowy_plugin` (else error "The plugin directory must have the extension `.flowy_plugin`."); contains a file whose name contains `light.json` and one containing `dark.json` (`FlowyColorScheme.fromJsonSoft`; invalid → "The light theme json file is not valid." / "The dark theme json file is not valid."); theme name = basename up to first `.`. Stored by copying a re-serialized copy to `<getApplicationDocumentsDirectory()>/<name>.flowy_plugin/{<name>.light.json,<name>.dark.json}` (Windows: `%USERPROFILE%\Documents`). Listing = all dirs in Documents whose extension contains `flowy_plugin`. Delete = trash icon on custom theme entry in dropdown → `removePlugin(name)` → recursive dir delete; if active → theme reset to first built-in. `ThemeConfirmDeleteDialog` exists but is unused. AMBIGUOUS: missing light/dark file throws `StateError` (not caught → UI stays in "processing"). |
| `RestartButton` — `widgets/_restart_app_button.dart` | Only referenced by `setting_appflowy_cloud.dart` / `setting_local_cloud.dart` widgets which are **not instantiated anywhere** in this checkout (only `isBillingEnabled()`/`BillingGateGuard` from that file are used) → dead | Desktop: `PrimaryRoundedButton` `settings.menu.restartApp` "Restart" (h 42, radius 12); optional hint `settings.menu.restartAppTip` "Restart the application for the changes to take effect. Please note that this might log out your current account." |
| `SettingThirdPartyLogin` — `widgets/setting_third_party_login.dart` | Account → sign-in dialog (`account_sign_in_out.dart`) only `if (isAuthEnabled)` (AppFlowy-cloud auth type with valid config → self-hosted only here) | `SignInBloc` from getIt; while submitting: `signIn.syncPromptMessage` "Syncing the data might take a while. Please don't close this page" + 1px `LinearProgressIndicator`; `ThirdPartySignInButtons` (if `isAuthEnabled`). Success → `didLogin()` + `runAppFlowy()`; failure → snackbar `error.msg`. |
| `WebUrlHintWidget` — `widgets/web_url_hint_widget.dart` | Removed from `settings_dialog.dart` in this checkout; remaining reference is in dead `setting_appflowy_cloud.dart` → dead | 24px info icon, tooltip `workspace.learnMore` "Learn more" → `https://appflowy.com/docs/self-host-appflowy-run-appflowy-web` (vendor-blocked). |
| `showCancelSurveyDialog` — `widgets/cancel_plan_survey_dialog.dart` | Plan comparison dialog downgrade (unreachable) | Paged dialog: title `settings.cancelSurveyDialog.title` "Sorry to see you go", description `...description`; 4 questions (`...questionOne..Four.question`) with 4–5 answers each (+ `...commonOther` free-text with hint `...otherHint` for Q1/Q3); buttons `button.previous`/`button.next`/`button.submit`; returns `jsonEncode({question: answer})` used as cancel reason. |
| `CreateFileSettingsCubit` — `application/settings/create_file_settings_cubit.dart` | Exported by `prelude.dart`, never instantiated → dead | Bool state from KV `showRenameDialogWhenCreatingNewFile` (default false); `toggle()` writes `"true"/"false"`. Key marked deprecated 0.7.6. |
| `BackendExportService` — `application/settings/share/export_service.dart` | Manage data export (debug), share menu | `exportDatabaseAsCSV`: `DatabaseEventExportCSV(DatabaseViewIdPB{value})` → `DatabaseExportDataPB{export_type, data}`; `exportDatabaseAsRawData`: `DatabaseEventExportRawDatabaseData(DatabaseViewIdPB)` |
| `ImportBackendService` — `application/settings/share/import_service.dart` | Sidebar import panel / Notion import (not settings) | `importPages(parentViewId, items)` → `FolderEventImportData(ImportPayloadPB{parent_view_id, items: ImportItemPayloadPB[]})` → `RepeatedViewPB`; `importZipFiles` → `FolderEventImportZipFile(ImportZipPB)` sequentially, stop at first failure |
| `StoreageNotificationListener` — `application/settings/file_storage/file_storage_listener.dart` | `sidebar_plan_bloc.dart` (not settings UI) | Rust stream source `"storage"`: `StorageNotification.FileStorageLimitExceeded` / `SingleFileLimitExceeded` → `onError(FlowyError.fromBuffer)` |
| Emoji picker module — `widgets/emoji_picker/**` | Only `emojiShortcutEvent` is used (editor shortcut list, C.11 #11); the legacy `EmojiPicker` widget is not instantiated anywhere (app uses `flutter_emoji_mart` pickers) | Shortcut `ctrl+alt+e` / mac `cmd+alt+e`: if selection on a node with delta and not a code block → shows `EmojiMenu` (`lib/plugins/emoji/emoji_menu.dart`) at cursor. Legacy picker config defaults (unused): 7 per row, size 32, recentsLimit 28, hints "Search emoji"/"No recent emoji"/"No emoji found"; persisted SharedPreferences keys `recent` (JSON list) and per-category cache keys. No emoji settings page exists. |

---

### C.18 Settings-related KV keys

Storage: `SharedPreferences` (Windows file `%APPDATA%\io.appflowy\AppFlowy\shared_preferences.json`, plugin adds `flutter.` prefix to each key). Constants in `lib/core/config/kv_keys.dart`. All values stored as strings unless noted.

| Constant | String key | Type (encoded) | Meaning / writer | Default |
|---|---|---|---|---|
| `KVKeys.pathLocation` | `io.appflowy.appflowy_flutter.path_location` | path string | Data folder used for Rust init + shortcuts file (C.13). Written by Reset / (dead) Change path. If dir missing at read → entire KV cleared | `<AppSupport>/data` |
| `KVKeys.featureFlag` | `featureFlag` | JSON `{"flagName": bool}` | Feature flag overrides (C.16); removed by Clear cache | absent |
| `KVKeys.showNotificationIcon` | `showNotificationIcon` | `"true"/"false"` | Sidebar notification bell visibility (C.12) | true |
| `KVKeys.showRenameDialogWhenCreatingNewFile` | `showRenameDialogWhenCreatingNewFile` | `"true"/"false"` | Deprecated; only dead `CreateFileSettingsCubit` | false |
| `KVKeys.lastOpenedSpaceId` | `lastOpenedSpaceId` | view id | Read by Import data as `parent_view_id` (written by sidebar space bloc) | absent |
| `KVKeys.kCloudType` | `kCloudType` | `"0"` local / `"3"` self-host (others ignored in this checkout) | Server type (Cloud page — other agent) | → local |
| `KVKeys.kAppflowyCloudBaseURL` | `kAppFlowyCloudBaseURL` | URL | Self-hosted server origin; also base for Members invite-code HTTP (C.10) | `''` |
| `KVKeys.kAppFlowyBaseShareDomain` | `kAppFlowyBaseShareDomain` | URL | Web/share domain; prefix of member invite links (C.10) | `''` |
| `KVKeys.kAppFlowyEnableSyncTrace` | `kAppFlowyEnableSyncTrace` | `"true"/"false"` | Sync trace logging (Cloud page) | false |
| `KVKeys.textScaleFactor` | `textScaleFactor` | double string (0.8–1.0) | App text scale (Workspace/appearance page) | 1.0 |
| `KVKeys.kDocumentAppearanceFontSize` | `kDocumentAppearanceFontSize` | **double** (`setDouble`) | Document font size (Workspace page) | 16.0 |
| `KVKeys.kDocumentAppearanceFontFamily` | `kDocumentAppearanceFontFamily` | string | Document font family | `defaultFontFamily` |
| `KVKeys.kDocumentAppearanceDefaultTextDirection` | `kDocumentAppearanceDefaultTextDirection` | string | Default text direction (removed when null) | absent |
| `KVKeys.kDocumentAppearanceCursorColor` | `kDocumentAppearanceCursorColor` | string (`Color.toHexString()`) | Cursor color (removed when null) | absent |
| `KVKeys.kDocumentAppearanceSelectionColor` | `kDocumentAppearanceSelectionColor` | string (`Color.toHexString()`) | Selection color (removed when null) | absent |
| `KVKeys.kDocumentAppearanceWidth` | `kDocumentAppearanceWidth` | **double** | Document width | absent |
| `KVKeys.recentIcons` | `kRecentIcons` | JSON `RecentIcons` | Recent emoji/icons (icon picker) | absent |
| `KVKeys.scaleFactor` | `scaleFactor` | double string | Window zoom (not a settings page) | 1.0 |
| `KVKeys.windowSize` / `windowPosition` / `windowMaximized` | `windowSize` / `windowPosition` / `windowMaximized` | JSON / JSON / bool string | Window state (not settings UI) | — |
Non-KV settings persistence: shortcuts → `<dataFolder>/shortcuts/shortcuts.json` (C.11); custom themes → `<Documents>/<name>.flowy_plugin/` (C.17); notifications-enabled → Rust (`UserEventSetNotificationSettings`); data-folder display → Rust `UserEventGetUserSetting`.

AMBIGUOUS / parity notes:
- Members page ignores its `workspaceId` prop (uses current folder workspace). Role-change and add-member exist only in the bloc.
- Manage data "Change path" is unreachable due to `path == path`; Reset/Change are shown only for `ServerW` workspaces (local workspaces only see the path).
- "Show notifications icon" toggle not persisted on its own.
- `notifications_enabled` has no consumer found.
- Shortcut conflict matching splits on `,` without trimming.
- Theme upload with missing light/dark file throws uncaught `StateError`.

---

## D. Shared UI primitives

Scope: the reusable widgets every screen is built from. Paths are relative to `D:\Projects\appflowy\frontend`. `git status` and `git diff` show no local changes under `appflowy_flutter/packages/**`. The app-level files used here (`lib/workspace/presentation/widgets/{dialogs,dialog_v2,pop_up_action}.dart`, `lib/workspace/presentation/home/toast.dart`, `lib/workspace/presentation/widgets/toggle/toggle.dart`, `.../sidebar/space/shared_widget.dart`) are also unmodified.

**Notation used in this section**

| prefix | meaning (Flutter expression) |
|---|---|
| `MS.x` | `Theme.of(context).colorScheme.x` (Material, desktop mapping in D.1.5) |
| `TD.x` | `Theme.of(context).x` (ThemeData field, e.g. `cardColor`, `hintColor`) |
| `TT.x` | `Theme.of(context).textTheme.x` |
| `AFX.x` | `AFThemeExtension.of(context).x` |
| `AF.text.x` / `AF.fill.x` / `AF.border.x` / `AF.surface.x` / `AF.icon.x` / `AF.surfaceContainer.x` | `AppFlowyTheme.of(context).{textColorScheme,fillColorScheme,borderColorScheme,surfaceColorScheme,iconColorScheme,surfaceContainerColorScheme}.x` |
| `AF.spacing.x`, `AF.radius.x`, `AF.shadow.x`, `AF.ts.<group>.<variant>` | `AppFlowyTheme.of(context).spacing.x`, `.borderRadius.x`, `.shadow.x`, `.textStyle.<group>.<variant>()` |
| hex | Flutter `0xAARRGGBB` is shown as CSS `#RRGGBB` or `#RRGGBBAA`. "L / D" = light / dark value in the **Default** theme. Other flowy_infra themes (Dandelion, Lavender, Lemonade, custom) change `MS.*`/`TD.*`/`AFX.*` values. `AF.*` values are always `AppFlowyDefaultTheme` (app_widget.dart:150) |

---

### D.1 Size constants & spacing helpers

#### D.1.1 `appflowy_flutter/packages/flowy_infra/lib/size.dart`

| class | members (px) |
|---|---|
| `PageBreaks` | largePhone 550, tabletPortrait 768, tabletLandscape 1024, desktop 1440 |
| `Insets` (×`scale`, scale=1) | xs 2, sm 6, m 12, l 24, xl 36, xxl 64, xxxl 80 |
| `FontSizes` (×1) | s11 11, s12 12, s14 14, s16 16, s18 18, s20 20, s24 24, s32 32, s44 44 |
| `Sizes` | hit 40 (×hitScale=1), iconMed 20 |
| `Corners` (BorderRadius.all / Radius.circular) | s3 3, s4 4, s5 5, s6 6, s8 8, s10 10, s12 12, s16 16 (each has `sNBorder` and `sNRadius`) |

#### D.1.2 Durations: `packages/flowy_infra/lib/time/duration.dart`

| `FlowyDurations` | fastest 150 ms, fast 250 ms, medium 350 ms, slow 700 ms |
|---|---|
| `RouteDurations` | slow 700 ms, medium 350 ms |

#### D.1.3 Spacing helpers: `packages/flowy_infra_ui/lib/widget/spacing.dart`, `widget/separated_flex.dart`

| widget | ctor | renders |
|---|---|---|
| `Space(width, height)` | positional | `SizedBox(width, height)` |
| `VSpace(size, {Color? color})` | | no color → `SizedBox(height: size)`. With color → full-width bar `height=size`, filled with color |
| `HSpace(size, {Color? color})` | | no color → `SizedBox(width: size)`. With color → full-height bar `width=size` |
| `SeparatedColumn({separatorBuilder = () => Divider(), children, …Column props})` | | puts a separator between children (none if <2 children). Material `Divider()` default: 16 px tall box, hairline line, `TD.dividerColor` (L #F2F2F2 / D #363D49) |
| `SeparatedRow({separatorBuilder = () => VerticalDivider(), …})` | | same idea, horizontal. `VerticalDivider()` is 16 px wide |

#### D.1.4 appflowy_ui shared tokens (`packages/appflowy_ui/lib/src/theme/data/shared.dart`, `definition/text_style/base/default_text_style.dart`). Full detail is in section A.7.

| token | xs | s | m | l | xl | xxl |
|---|---|---|---|---|---|---|
| `AF.spacing` | 4 | 6 | 8 | 12 | 16 | 20 |
| `AF.radius` | 4 | 6 | 8 | 12 | 16 | 20 |

| `AF.shadow` | light | dark |
|---|---|---|
| small | `0 2px 16px #0000001F` | `0 2px 16px #0000007A` |
| medium | `0 4px 32px #0000001F` | `0 4px 32px #0000007A` |

| text group `AF.ts.*` | size / line-height | standard | enhanced | prominent | underline |
|---|---|---|---|---|---|
| heading1 | 36 / 40 | 400 | 600 | 700 | 700 + underline |
| heading2 | 24 / 32 | 400 | 600 | 700 | 400 + underline |
| heading3 | 20 / 28 | 400 | 600 | 700 | 400 + underline |
| heading4 | 16 / 22 | 400 | 600 | 700 | 400 + underline |
| headline | 24 / 36 | 400 | 500 | 700 | 400 + underline |
| title | 20 / 28 | 400 | 500 | 700 | 400 + underline |
| body | 14 / 20 | 400 | 500 | 700 | 400 + underline |
| caption | 12 / 18 | 400 | 500 | 700 | 400 + underline |

All AF text styles use `inherit:false`, `leadingDistribution: even` (CSS: centered half-leading, which matches the CSS default), letterSpacing 0, and fontFamily = the user's font (`''` means the platform default).

#### D.1.5 Material ThemeData (desktop) mapping. Source: `lib/workspace/application/settings/appearance/desktop_appearance.dart`, `base_appearance.dart`, `packages/flowy_infra/lib/colorscheme/default_colorscheme.dart`

| token | FlowyColorScheme field | Default L | Default D |
|---|---|---|---|
| `MS.primary` | primary | #00BCF0 | #00BCF0 |
| `MS.onPrimary` / `MS.onError` | onPrimary | #FFFFFF | #131720 |
| `MS.primaryContainer` | main2 | #00B7EA | #00B7EA |
| `MS.secondary` (**the default hover fill**) | hoverBG1 | #1F23290F | #FFFFFF1A |
| `MS.onSecondary` | shader1 | #333333 | #131720 |
| `MS.secondaryContainer` | selector | #F2FCFF | #1A202C |
| `MS.tertiary` | shader7 | #333333 | #FFFFFF |
| `MS.onTertiary` | toolbarColor | #333333 | #282E3A |
| `MS.surface` / `TD.dialogBackgroundColor` / `TD.scaffoldBackgroundColor` / `TD.canvasColor` | surface | #FFFFFF | #1A202C |
| `MS.onSurface` (**text/icon colour while hovered**) | hoverFG | #333333 | #FFFFFFE5 |
| `MS.inverseSurface` | hoverBG3 | #F2F2F2 | #363D49 |
| `MS.error` | red | #FB006D | #FB006D |
| `MS.outline` / `TD.disabledColor` | shader4 | #BDBDBD | #505469 |
| `MS.surfaceContainerHighest` | sidebarBg | #F7F8FC | #232B38 |
| `MS.shadow` | shadow | rgba(0,0,0,.15) | #0F131C |
| `TD.cardColor` (popover background) | input | #FFFFFF | #282E3A |
| `TD.hintColor` | hint | #828282 | #59647A |
| `TD.dividerColor` | divider | #F2F2F2 | #363D49 |
| `TD.hoverColor` | hoverBG2 | #E0F8FF | #00BCF0 |
| `TD.iconTheme.color` (default FlowySvg tint) | icon | #333333 | #BBC3CD |
| `TT.*.color` (default FlowyText colour) | text | #333333 | #BBC3CD |
| `AFX.borderColor` | borderColor | #EDEDEE | #3A3F49 |
| `AFX.greyHover` | hoverBG1 | #1F23290F | #FFFFFF1A |
| `AFX.lightGreyHover` | hoverBG3 | #F2F2F2 | #363D49 |
| `AFX.toggleButtonBGColor` | toggleButtonBGColor | #E0E0E0 | #828282 |
| `AFX.secondaryTextColor` | secondaryText | #4F4F4F | #BBC3CD |
| scrollbar thumb (normal / hovered, pressed, dragged) | scrollbarColor / scrollbarHoverColor | #1717173F / #1717177F | #FFFFFF40 / #FFFFFF80 |

Material text theme (`getTextTheme`). Every style has `letterSpacing = fontSize × 0.005` (14 px gives 0.07 px), fontFamily = the user's font, and colour `text`.

| TT | size | weight | height |
|---|---|---|---|
| displayLarge | 32 | 600 | `42.0`. AMBIGUOUS: this is passed as the Flutter `height` multiplier (42×), not 42 px. Likely an upstream bug, so check visually |
| displayMedium | 24 | 600 | `34.0` (same issue) |
| displaySmall | 20 | 600 | `28.0` (same issue) |
| titleLarge / titleMedium / titleSmall | 18 / 16 / 14 | 600 | font default |
| **bodyMedium** (FlowyText base) | **14** | **400** | font default |
| bodySmall (FlowyTextField base) | 14 | 400 | font default |

Other theme parts: `tooltipTheme.textStyle` = 11 px w400, colour `surface`. `scrollbarTheme`: thickness 4, crossAxisMargin 0, mainAxisMargin 6, radius 10, thumb colours as above. `snackBarTheme`: bg `MS.primary`, content colour `MS.onSurface` (FlowyText ignores this). `textButtonTheme.minimumSize = Size.zero`. `useMaterial3: false`. `materialTapTargetSize: shrinkWrap`. `visualDensity: standard`.

#### D.1.6 AF semantic colours used by the components below (Default theme)

| token | L | D |
|---|---|---|
| `AF.text.primary` | #21232A | #E4E8F5 |
| `AF.text.secondary` | #6F748C | #989EB7 |
| `AF.text.tertiary` | #989EB7 | #6F748C |
| `AF.text.onFill` | #FFFFFF | #FFFFFF |
| `AF.text.error` | #E71D32 | #F33641 |
| `AF.icon.tertiary` | #B5BBD3 | #6F748C |
| `AF.border.primary` | #E4E8F5 | #3D404F |
| `AF.border.primaryHover` | #CED3E6 | #54596E |
| `AF.border.themeThick` | #00B5FF | #00B5FF |
| `AF.border.errorThick` | #E71D32 | #F33641 |
| `AF.fill.content` | #FFFFFF00 | #FFFFFF00 |
| `AF.fill.contentHover` | #1F23290D | #F9FAFD0D |
| `AF.fill.tertiary` | #6F748C | #CED3E6 |
| `AF.fill.themeThick` / `themeThickHover` | #00B5FF / #0092D6 | #00B5FF / #0092D6 |
| `AF.fill.themeSelect` | #00B5FF26 | #00B5FF26 |
| `AF.fill.errorThick` / `errorThickHover` | #E71D32 / #AD1625 | #F33641 / #FF5050 |
| `AF.fill.errorSelect` | #F336411A | #F336411A |
| `AF.surface.primary` / `layer01` | #FFFFFF | #272930 |
| `AF.surface.inverse` | #21232A | #3D404F |
| `AF.surface.overlay` (modal barrier) | #00000099 | #00000099 |
| `AF.surfaceContainer.layer02` | #E4E8F5 | #3D404F |

---

### D.2 flowy_infra_ui primitives

#### D.2.1 `FlowyText`: `packages/flowy_infra_ui/lib/style_widget/text.dart`

| ctor | fontWeight | fontSize default | other defaults |
|---|---|---|---|
| `FlowyText(text, …)` | null → TT.bodyMedium w400 | null → TT.bodyMedium 14 | `overflow: TextOverflow.clip`, `maxLines: 1` |
| `FlowyText.small` | w400 | **12** on desktop (14 on iOS/Android). Cannot be overridden | overflow null → clip, maxLines 1 |
| `FlowyText.regular` | w400 | 14 | maxLines 1 |
| `FlowyText.medium` | w500 | 14 | maxLines 1 |
| `FlowyText.semibold` | w600 | 14 | maxLines 1 |
| `FlowyText.emoji` | w400 | 14 | `textAlign: center`, `isEmoji: true`, `strutStyle: StrutStyle(forceStrutHeight: true)`, fallbackFontFamily forced null |
| (no `.bold` constructor) | | | |

Params (all constructors): `text, overflow, fontSize, fontWeight, textAlign, color, maxLines, decoration, decorationColor, decorationThickness, fontFamily, fallbackFontFamily, lineHeight, figmaLineHeight, withTooltip=false, isEmoji=false, strutStyle, optimizeEmojiAlign=false`.

| behaviour | rule |
|---|---|
| base style | `TT.bodyMedium.copyWith(...)`. Default colour = TT.bodyMedium colour (`text` L #333333 / D #BBC3CD). Inside a hovered `FlowyHover` it becomes `MS.onSurface` or the hover's `foregroundColorOnHover` (D.2.2), unless `color` is set explicitly |
| line height | `figmaLineHeight` wins: `height = figmaLineHeight / fontSize` (CSS `line-height: <figmaLineHeight>px`). Otherwise `lineHeight` (multiplier). Otherwise null, meaning the font's natural metrics (CSS `normal`) |
| strut | non-emoji text: `StrutStyle.fromTextStyle(forceStrutHeight: true, leadingDistribution: even, height: lineHeight)`. Every line is exactly `lineHeight × fontSize` tall and glyphs are centred vertically |
| emoji on Windows (and Linux, which uses the NotoColorEmoji font) | `fontSize × 0.9`; `lineHeight ÷ 0.9` |
| overflow | `overflow ?? clip`. `maxLines: null` allows unlimited lines |
| `withTooltip: true` | wraps in `FlowyTooltip(message: text)` |
| letterSpacing | inherited 0.005 × base 14 = 0.07 px. AMBIGUOUS: copyWith does not rescale letterSpacing when fontSize changes, so it stays 0.07 px |

#### D.2.2 `FlowyHover` + `HoverStyle`: `style_widget/hover.dart`

| `FlowyHover` param | default |
|---|---|
| `style` | null → `HoverStyle(hoverColor: MS.secondary)` |
| `builder(context, onHover)` / `child` | one of them is required |
| `isSelected: bool Function()?` | when true, the hover style is applied permanently |
| `onHover(bool)` | callback |
| `cursor` | null → `SystemMouseCursors.click` (pointer), even for non-clickable content |
| `resetHoverOnRebuild` | `true`: the hover state resets to false whenever the parent rebuilds. It re-arms on the next mouse move |
| `buildWhenOnHover: bool Function()?` | when it returns false, hover changes are ignored |

| `HoverStyle` field | default | `HoverStyle.transparent` |
|---|---|---|
| border (BoxBorder) | null | null |
| hoverColor | null → `MS.secondary` at paint time | `Colors.transparent` |
| foregroundColorOnHover | null → `MS.onSurface` | same |
| borderRadius | `BorderRadius.circular(6)` | 6 |
| contentMargin | `EdgeInsets.zero` (outer margin) | zero |
| backgroundColor (not hovered) | `Colors.transparent` | transparent |

Render (`FlowyHoverContainer`): `Container(margin: contentMargin, decoration: {border, color: applied ? hoverColor : backgroundColor, borderRadius})`. While applied (hovered or selected), the descendant `TT.bodyMedium.color` and `iconTheme.color` are overridden to `foregroundColorOnHover ?? MS.onSurface`. React: set CSS variables `--fg`/`--icon` on `:hover` / `[data-selected]`. The colour change is instant (no transition).

#### D.2.3 `FlowyButton`: `style_widget/button.dart`

| param | default | notes |
|---|---|---|
| `text` (Widget, required) | | usually `FlowyText` |
| `onTap`, `onSecondaryTap` (right-click), `onHover(bool)` | null | tap fires on pointer-up (GestureDetector, `HitTestBehavior.opaque`) |
| `margin` (inner padding) | `EdgeInsets.symmetric(horizontal: 6, vertical: 4)` | |
| `leftIcon` | null | placed in a `SizedBox.fromSize(leftIconSize)` box |
| `leftIconSize` | `Size.square(16)` | |
| `rightIcon` | null | intrinsic size |
| `iconPadding` | 6 | gap between icon and text on each side |
| `hoverColor` | null → `MS.secondary` | |
| `backgroundColor` | null → transparent | non-hover fill |
| `borderColor` | null | gives a 1 px border all round (HoverStyle.border) |
| `radius` | `Corners.s6Border` (6) | |
| `isSelected` | false | permanent hover fill |
| `decoration` | null | outer `Container` decoration (desktop: only used if supplied) |
| `useIntrinsicWidth` | false | true wraps in IntrinsicWidth (shrinks to content) |
| `expandText` | true | text is `Expanded` |
| `mainAxisAlignment` | center | |
| `expand` | false | Row `mainAxisSize` max/min |
| `disable` | false | removes taps/hover callback; cursor becomes `forbidden` |
| `disableOpacity` | 0.5 | AMBIGUOUS: never applied (`color.withAlpha(alpha)` result is discarded). A disabled FlowyButton is not dimmed and still shows the hover fill |
| `showDefaultBoxDecorationOnMobile` | false | mobile only |
| `resetHoverOnRebuild` | true | passed to FlowyHover |

Layout: `[leftIcon(16×16)] HSpace(6) [text (Expanded)] HSpace(6) [rightIcon]`, vertically centred, inside the 6/4 padding. **There is no intrinsic height.** Height = content + 8. Callers usually wrap it in `SizedBox(height: 28|30|32)`. Hover: fill `MS.secondary` with radius 6, text/icons switch to `MS.onSurface`. Instant (no animation). Focus/keyboard: not focusable, so there is no Enter/Space activation.

#### D.2.4 `FlowyIconTextButton` (same file)

Same params and defaults as FlowyButton, except: `textBuilder(bool onHover)` is required; `leftIconBuilder(bool)` / `rightIconBuilder(bool)`; there is no `backgroundColor`; HoverStyle has no backgroundColor. Mobile border colour is `MS.surfaceContainerHighest`. Padding is 6/4, radius 6, hover `MS.secondary`, leftIconSize 16, iconPadding 6.

#### D.2.5 `FlowyTextButton` (same file). Material `TextButton`

| param | default |
|---|---|
| `text` (String, positional) | |
| `onPressed` | null → disabled (ExcludeFocus, FocusNode `skipTraversal`) |
| `fontSize` | null → 14 (TT.bodyMedium) |
| `fontWeight` | null → **w500** |
| `lineHeight` | null → **1.1** |
| `fontColor` | null → foreground `MS.onSurface` |
| `fontHoverColor` | null → `fontColor ?? MS.onSurface` |
| `fillColor` | null → `isDangerous ? transparent : MS.secondaryContainer` |
| `hoverColor` | null → `isDangerous ? MS.error : MS.secondary` |
| `borderColor` | null → `isDangerous ? MS.error : transparent` (1 px side) |
| `padding` | `EdgeInsets.symmetric(horizontal: 8, vertical: 6)` |
| `radius` | `Corners.s6Border` |
| `constraints` | `BoxConstraints(minWidth: 0, minHeight: 0)` |
| `mainAxisAlignment` | start |
| `heading` (Widget) | null; then HSpace(8) before the text |
| `overflow` | ellipsis; `textAlign: center` |
| `tooltip` | null → no FlowyTooltip |
| `isDangerous` | false |
| `decoration`, `fontFamily` | null |

No splash, no overlay, no elevation. The only states are hovered and normal. Disabled uses the same colours; the Material cursor becomes `basic`. Focusable when enabled. Enter/Space activates (Material default).

| factory | constraints | fill | hover | font | font hover | border |
|---|---|---|---|---|---|---|
| `.primary(context,text,onPressed)` | minHeight 32 | `MS.primary` | **#005483** (fixed) | `MS.onPrimary` | #FFFFFF | none |
| `.secondary(...)` | minHeight 32 | transparent | `MS.primary` | `MS.primary` | #FFFFFF | 1 px `MS.primary` |

`FlowyRichTextButton` (same file): `RawMaterialButton`, `constraints` min 58×30, `padding` 8/6, `fillColor` `MS.secondaryContainer`, `hoverColor` `MS.secondary`, radius 6, `heading` gap **6**. Tap is handled via `IgnoreParentGestureWidget`.

#### D.2.6 `FlowyIconButton`: `style_widget/icon_button.dart`

| param | default |
|---|---|
| `icon` (Widget, required) | centred |
| `width` | **30** |
| `height` | null → `width` (square) |
| `onPressed` | null → not clickable |
| `fillColor` | `Colors.transparent` (base fill under hover) |
| `hoverColor` | null → `MS.secondary` |
| `iconColorOnHover` | null → `TD.iconTheme.color` (so the icon keeps its colour on hover) |
| `iconPadding` | `EdgeInsets.zero` |
| `radius` | `Corners.s6Border` |
| `tooltipText` / `richTooltipText` | at most one may be set; both null → no tooltip |
| `preferBelow` | true |
| `decoration` | null (outer box) |
| `isSelected` | null; when true, hover fill stays on |

Structure: `Container(tight width×height) > FlowyTooltip > RawMaterialButton(shape radius, transparent hover/focus/splash/highlight, clip antiAlias) > FlowyHover(resetHoverOnRebuild:false) > Padding(iconPadding) > Center(icon)`. Keyboard: RawMaterialButton is focusable but the focus colour is transparent (invisible focus). Enter/Space press it. `FlowyDropdownButton`: `FlowyIconButton(width: 16, icon: FlowySvg('home/drop_down_show'))`.

`FlowyToolbarButton` (`style_widget/toolbar_button.dart`): RawMaterialButton with `constraints` min 36×32, padding 0, radius 6, no hover colour; tooltip with `padding: EdgeInsets.zero`. Default ctor `padding` param (8/6) is unused.

#### D.2.7 `FlowyTooltip` / `ManualTooltip`: `packages/flowy_infra_ui/lib/widget/flowy_tooltip.dart`

| property | value |
|---|---|
| params | `message`, `richMessage` (InlineSpan), `preferBelow`, `margin`, `verticalOffset`, `padding`, `child`. If both messages are null → returns child unchanged. An empty string `''` shows nothing (Flutter skips empty messages) |
| wait (show delay) | **300 ms** (`waitDuration`) |
| exit delay after mouse leave | 100 ms (Flutter default) |
| fade | in 150 ms, out 75 ms (Flutter default) |
| background | light theme **#1D2129**; dark theme **#E5E5E5E5** (`context.tooltipBackgroundColor()`) |
| radius | 10 |
| padding | `EdgeInsets.symmetric(horizontal: 12, vertical: 8)` |
| min height | 24 (Flutter desktop default) |
| margin | null → `EdgeInsets.zero` (Flutter default). Width is limited only by the window |
| verticalOffset | 16 (gap between anchor centre and tooltip) |
| preferBelow | null → true (Flutter default). Flips above if there is no room |
| text (`message`) | `tooltipTextStyle()`: TT.bodyMedium, **14 px, w400, line-height 20 px** (`height = 20/14`), leading even. Colour light **#FFFFFF**, dark **#000000** |
| hint text helper | `tooltipHintTextStyle()` = same, with colour at alpha 0.7 |
| `richMessage` | no textStyle is applied. Spans fall back to `tooltipTheme.textStyle` (11 px w400, colour `surface`). Callers pass `context.tooltipTextStyle()` in spans |
| global behaviour | any mouse-wheel scroll dismisses all tooltips (`Tooltip.dismissAllToolTips()` in `lib/startup/tasks/app_widget.dart`) |
| `ManualTooltip` | same styling. `showAutomaticlly: true` → `triggerMode: manual` and shows on the first frame (`ensureTooltipVisible`) |

#### D.2.8 Text inputs

**`FlowyTextField`** (`style_widget/text_field.dart`). Material TextField, stateful.

| param | default |
|---|---|
| `hintText` | `""` |
| `text` (initial) | null |
| `autoFocus` | **true**. Focuses after the first frame and puts the caret at the end |
| `maxLines` | 1 (`minLines` 1) |
| `maxLength` | null. When set, `suffixText " n/max"` is shown if `showCounter` (default true). The Material counter is hidden (`counterText: ""`). Enforcement: truncateAfterCompositionEnds |
| `debounceDuration` | null. When set, onChanged is debounced |
| `submitOnLeave` | false. On blur: non-empty text and submitOnLeave → `onSubmitted(text)`, otherwise `onCanceled()` |
| `autoClearWhenDone` | false (clears after submit) |
| `keyboardType` | multiline |
| `isDense` | true → horizontal content padding 12 (false → 18) |
| `textStyle` | null → `TT.bodySmall` (14 w400) |
| `hintStyle` | null → `TT.bodySmall` coloured `TD.hintColor` |
| `enableBorderColor` | null → `MS.outline` (L #BDBDBD / D #505469) |
| `borderRadius` | null → `Corners.s8Border` (8) |
| `errorText` / `error` | errorStyle `TT.bodySmall` coloured `MS.error`. Error border and focused-error border = 1 px `MS.error` |
| `decoration` | if provided, replaces everything below |
| other | `obscureText`, `readOnly`, `prefixIcon/suffixIcon` (+constraints), `textAlignVertical` (default center), `inputFormatters`, `cursorHeight`, `onTap`, `onTapOutside`, `onEditingComplete` |

Decoration: `constraints maxHeight` = **32**, or 58 when errorText is non-empty (`hintTextConstraints` overrides). Content padding vertical 0 for single-line, 12 for multi-line. Enabled border 1 px `enableBorderColor`. Focused border 1 px `MS.primary` (readOnly → enabled colour). `isDense: false` on InputDecoration. Enter (single-line) → onSubmitted.

**`RoundedInputField`** (`widget/rounded_input_field.dart`). Material TextFormField.

| param | default |
|---|---|
| `height` | **48** (Container) |
| `contentPadding` | `EdgeInsets.symmetric(horizontal: 10)` |
| `margin`, `padding` | zero |
| `normalBorderColor` | `MS.outline` |
| `focusBorderColor` | `MS.primary` |
| `cursorColor` | `MS.primary` |
| `errorText` | `""`. When non-empty, both borders become `MS.error` and the error text is shown below (padding vertical 4) using `style` (not error-coloured) |
| radius | `Corners.s10Border` (10). Border 1 px |
| `style` | `TT.bodyMedium`; hint `TT.bodySmall` coloured `TD.hintColor` |
| `obscureText` | false. When true, a 16 px toggle icon (`obscureIcon` / `obscureHideIcon`) appears as suffix once text is non-empty |
| `autoFocus` | false |
| animation | the column (field + error) is wrapped in `AnimatedSize(400 ms, easeInOut)` |

**`FlowyFormTextInput`** → `StyledSearchTextInput` (`style_widget/text_input.dart`): outer padding vertical `Insets.sm` (6). Default `textAlign: center`. `contentPadding` default `EdgeInsets.only(bottom: 2)` (the StyledSearchTextInput default is `EdgeInsets.all(12)`). Style `TT.bodyMedium`. Hint `TT.bodyMedium` coloured `TD.hintColor` at alpha 0.7. `isDense: true`. Cursor `MS.primary`. Border: `ThinUnderlineBorder(BorderSide(width 5, red))` is passed as `border`. AMBIGUOUS: Material replaces its side with the default M2 underline (1 px onSurface@38% when enabled, 2 px `MS.primary` when focused), so the red 5 px line is never visible. **Escape → `onEditingCancel`**. Focus changes → `onFocusChanged(bool)`.

#### D.2.9 Scrollbars

| widget | file | behaviour |
|---|---|---|
| `FlowyScrollbar({controller, thumbVisibility = true, child})` | `style_widget/scrollbar.dart` | Material `Scrollbar`. The thumb is always visible **only while the pointer is over the area** (`isHovered && thumbVisibility`); otherwise it appears while scrolling. Radius fixed at **12**. Thickness 4 and mainAxisMargin 6 come from scrollbarTheme. Colours: `scrollbarColor`, and `scrollbarHoverColor` on hover/drag. Fades out 600 ms after scrolling stops, 300 ms fade (Flutter defaults). The inner platform scrollbar is suppressed |
| `StyledScrollbar` | `style_widget/scrolling/styled_scroll_bar.dart` | custom overlay handle. `size` = bar thickness. Handle length = `max(60, view²/content)`. Handle radius `Corners.s3` (3). Handle colour = `scrollbarTheme.thumbColor`, using the dragged colour while hovered (the `handleColor` param is **ignored**). Track (`showTrack` false by default) colour `AFX.greyHover` (light) / `AFX.lightGreyHover` (dark). Hidden when content ≤ viewport. `autoHideScrollbar` true: hides **2 s** after scrolling stops and reappears on scroll. Opacity is animated (styled_widget `.opacity(animate:true)` driven by `ScrollbarListStack.animate(250 ms, easeOut)`). Dragging the handle scrolls proportionally |
| `ScrollbarListStack({barSize, axis, controller, contentSize, scrollbarPadding, handleColor, trackColor, showTrack=false, autoHideScrollbar=true, includeInsets=true})` | same | When `includeInsets`, the content gets right (vertical) or bottom (horizontal) padding = `barSize + Insets.m(12)` |
| `StyledListView`, `StyledSingleChildScrollView`, `StyledCustomScrollView` | `styled_list.dart`, `styled_scrollview.dart` | defaults `barSize = 8`, physics `StyledScrollPhysics` (= AlwaysScrollableScrollPhysics) |

#### D.2.10 Dividers, decorations, containers

| widget | file | spec |
|---|---|---|
| `FlowyDivider({padding})` | `style_widget/divider.dart` | `Divider(height: 1, thickness: 1, color: AFX.borderColor)` (L #EDEDEE / D #3A3F49), padding default zero |
| `FlowyDecoration.decoration(boxColor, shadowColor, {spreadRadius=0, blurRadius=20, offset=Offset.zero, borderRadius=6, border})` | `style_widget/decoration.dart` | BoxDecoration with one shadow |
| `FlowyContainer(color, {borderRadius, shadows, width, height, align, margin, duration, border, child})` | `style_widget/container.dart` | `AnimatedContainer`. Duration default `FlowyDurations.medium` (350 ms) |
| `TopBorder({width=1, color=Colors.grey, child})` | `style_widget/extension.dart` | top border only |

#### D.2.11 Dialog shells (flowy_infra_ui)

**`FlowyDialog`** (`src/flowy_overlay/flowy_dialog.dart`). A Material `SimpleDialog`.

| param | default |
|---|---|
| `child` | required |
| `title` | null |
| `shape` | `RoundedRectangleBorder(radius 16)` |
| `backgroundColor` | `TD.cardColor` (L #FFFFFF / D #282E3A) |
| `insetPadding` | `EdgeInsets.symmetric(horizontal: 40, vertical: 24)` |
| `expandHeight` | true → content height = **70 % of window height** |
| `width` | null → **70 % of window width** |
| `constraints` | null (applied to the inner container) |
| `alignment` | null (center) |
| `padding` | `EdgeInsets.symmetric(vertical: 12)`. AMBIGUOUS: declared but never used |
| other | `contentPadding: zero`, `clipBehavior: antiAliasWithSaveLayer`. M2 elevation 24 (shadow in D.5.1). Exported constants `overlayContainerMaxWidth = 760`, `overlayContainerMinWidth = 320` (unused here) |

**`StyledDialog`** (`widget/dialog/styled_dialogs.dart`)

| param | default |
|---|---|
| `padding` | `EdgeInsets.symmetric(horizontal: Insets.xxl 64, vertical: Insets.xl 36)` |
| `margin` | `EdgeInsets.all(Insets.sm*2 = 12)` |
| `bgColor` | `MS.surface` |
| `borderRadius` | `BorderRadius.circular(6)` (clips) |
| `maxWidth` / `maxHeight` | ∞ |
| min width | `DialogSize.minDialogWidth` = **400** |
| `shrinkWrap` | true → IntrinsicWidth + IntrinsicHeight |
| other | scrollable (SingleChildScrollView), `FocusTraversalGroup`, no shadow |

`Dialogs.show(context, child:)` pushes a `StyledDialogRoute`: barrier `Colors.black @0.4` (#00000066), dismissible, label `''`; transition `FadeTransition` 300 ms `easeInOut`; child wrapped in SafeArea. The `widget.show(context)` extension (`IntoDialog`) adds a KeyboardListener: **Escape → pop**.

#### D.2.12 `Toggle`: `lib/workspace/presentation/widgets/toggle/toggle.dart` (app-level)

| `ToggleStyle` | track h × w | thumb ⌀ |
|---|---|---|
| `.big()` (default) | 16 × 27 | 14 |
| `.small()` | 10 × 16 | 8 |
| `.mobile()` | 24 × 42 | 18 |

| param | default |
|---|---|
| `value`, `onChanged(bool)` | required |
| `thumbColor` | `Colors.white` |
| `activeBackgroundColor` | `MS.primary` (#00BCF0) |
| `inactiveBackgroundColor` | `AFX.toggleButtonBGColor` (L #E0E0E0 / D #828282) |
| `duration` | **150 ms** (AnimatedPositioned, linear curve) |
| `padding` | `EdgeInsets.all(8)` (part of the hit area) |

Geometry: track radius h/2. Thumb top = (h−⌀)/2. Thumb left = 1 when off, `w−⌀−1` when on (big: 1 → 12). Track colour switches instantly. No hover state, no pointer cursor, not focusable.

#### D.2.13 Rounded / primary buttons

| widget | file | spec |
|---|---|---|
| `PrimaryRoundedButton({text, fontSize=14, fontWeight=w500, textColor=MS.onPrimary, radius=10, margin=EdgeInsets.symmetric(horizontal:14), backgroundColor=MS.primary, hoverColor=MS.primary@0.9, useIntrinsicWidth=true, lineHeight=1.0, figmaLineHeight, leftIcon, onTap})` | `style_widget/primary_rounded_button.dart` | a FlowyButton. Text is FlowyText, centred, ellipsis. Height is set by the caller (no vertical margin) |
| `OutlinedRoundedButton({text, onTap, margin=h16 v9, radius=8})` | same | DecoratedBox border 1 px: light **#14171B1E**, dark `Colors.white10` (#FFFFFF1A). Inner FlowyButton (hover `MS.secondary`, `useIntrinsicWidth`) with `FlowyText.regular(lineHeight 1.0, center)`. Height = 14 + 18 = 32 |
| `TextButtonMode` | `widget/buttons/secondary_button.dart` | normal 80×32 radius 8. big 100×40 radius 12. small 100×30 radius 6 (min size and radius) |
| `BaseStyledButton` | `widget/buttons/base_styled_button.dart` | RawMaterialButton. bg `bgColor ?? MS.surface`. radius `Corners.s10`. contentPadding `Insets.m` (12). hover/highlight colour default transparent. focusColor `Colors.grey @0.35`. Disabled (onPressed null): child opacity 0.7. Outline `outlineColor` 1.5 px. **Focused:** shadows `[MS.shadow blur 8, bgColor blur 8 spread −4]` plus a 1.8 px `MS.outline` ring. Text `TT.bodyMedium`. Cursor click |
| `PrimaryButton({child, onPressed, mode=big, backgroundColor})` / `PrimaryTextButton(label)` | `widget/buttons/primary_button.dart` | BaseStyledButton: contentPadding horizontal 6, bg `MS.primary`, hover `MS.primaryContainer`. Label `FlowyText.regular` in `MS.onPrimary` |
| `SecondaryButton({child, onPressed, outlineColor, mode=normal})` / `SecondaryTextButton(label, textColor)` | `secondary_button.dart` | bg transparent, padding 0, outline 1.5 px `MS.primary`. Label `FlowyText.regular` in `MS.primary` |
| `RoundedTextButton({title, width, height, borderRadius=Corners.s6, fillColor=MS.primary, hoverColor=MS.primaryContainer, textColor=MS.onPrimary, fontSize, fontWeight, padding=h8 v6})` | `widget/rounded_button.dart` | constraints min 10×10, max `width`×(`height` ?? 60). `SizedBox.expand` > FlowyTextButton |
| `RoundedImageButton({size, press, borderRadius=zero, child})` | same | Material TextButton, square `size` |

#### D.2.14 `FlowyColorPicker`: `style_widget/color_picker.dart`

`FlowyColorPicker({colors: List<FlowyColorOption{color,i18n,id}>, selected, onTap(option,index), separatorSize=4, iconSize=16, itemHeight=32, border})`. A ListView with a 4 px gap between rows. Each row is `SizedBox(height 32) > FlowyButton(text: FlowyText(i18n), leftIcon: ColorOptionIcon, rightIcon: checkmark svg 'grid/checkmark' if selected==color, iconPadding: 10)`. `ColorOptionIcon({color, iconSize=16})` is a circle. When the colour is `transparent` it gets a 1 px **#CFD3D9** border. `border` param is unused.

#### D.2.15 Misc

| item | spec |
|---|---|
| `FlowySvg(svg, {size, color, blendMode = srcIn, opacity})` (`packages/flowy_svg`) | tint = `color ?? TD.iconTheme.color` with srcIn (monochrome mask). `blendMode: null` keeps the SVG's own colours. Scaled by the text scaler |
| `FlowyCloseButton` | Material TextButton with `Icons.close` |
| `FlowyBarTitle(title)` | Text 24 px |
| `FlowyProgressIndicator` | 60 px wide pacman `LoadingIndicator`, rainbow colours, stroke 4 |
| `showSnapBar(context, title, {onClosed})` | see D.5.6 |

---

### D.3 Popover system (appflowy_popover + AppFlowyPopover)

#### D.3.1 Core API: `packages/appflowy_popover/lib/src/{popover,mutex,mask,layout}.dart`

| type | members |
|---|---|
| `PopoverController` | `show()`, `showAt(Offset globalPos)` (opens at cursor-style position), `close()` |
| `PopoverTriggerFlags` (bit flags) | `none 0x00`, `click 0x01`, `hover 0x02`, `secondaryClick 0x04` |
| `PopoverClickHandler` | `listener` (fires on **pointer-down**, checks `event.buttons` primary/secondary), `gestureDetector` (fires on tap-up / secondaryTap-up; use it when an ancestor GestureDetector would otherwise conflict) |
| `PopoverMutex` | at most one open popover per mutex. Setting a new state closes the previous one. `close()`, `addPopoverListener`, `removePopoverListener`, `state`, `removeState()`, `dispose()` |
| `PopoverDirection` | `topLeft, topRight, bottomLeft, bottomRight, center, topWithLeftAligned, topWithCenterAligned, topWithRightAligned, rightWithTopAligned, rightWithCenterAligned, rightWithBottomAligned, bottomWithLeftAligned, bottomWithCenterAligned, bottomWithRightAligned, leftWithTopAligned, leftWithCenterAligned, leftWithBottomAligned, custom` (`custom` throws UnimplementedError) |
| `PopoverContainer.of(ctx)` / `.maybeOf(ctx)` | used from inside popup content: `.close()` closes this popover, `.closeAll()` = same as a tap on the mask |

**`Popover` widget params (raw defaults)**: `child`, `popupBuilder` (required); `controller`; `offset` null → `Offset.zero`; `triggerActions` **0**; `direction` `rightWithTopAligned`; `mutex`; `windowPadding` null → zero; `onOpen`, `onClose`, `canClose: Future<bool> Function()?`; `asBarrier` false; `clickHandler` listener; `skipTraversal` false; `animationDuration` **200 ms**; `beginOpacity` 0 → `endOpacity` 1; `beginScaleFactor` 1 → `endScaleFactor` 1; `slideDistance` 5; `debugId`; `maskDecoration` transparent (`ARGB(0,244,67,54)`); `showAtCursor` false.

**Behaviour**

| aspect | rule |
|---|---|
| open | Trigger (click or secondary click per flags, hover = `MouseRegion.onEnter`) → `onOpen()` → `showOverlay(cursorPos?)`. When already open, a trigger click closes it (toggle). Hover-triggered popovers do **not** close on mouse exit |
| `showOverlay` | first closes itself (animated) → sets the mutex state (which closes any sibling in the mutex) → inserts an OverlayEntry into the **root overlay stack** (a global LinkedHashMap) → runs the forward animation |
| mask | Only the **first** popover in the global stack gets a full-window transparent mask (`GestureDetector`). Popovers opened later (nested) do not add another |
| outside click (mask tap) | `await canClose?.call() ?? true` → `popEntry()` chain: removes the top entry; **if it was `asBarrier` stop, otherwise keep popping**. So a click outside closes all stacked non-barrier popovers down to and including the first barrier one. Each popped entry runs its reverse animation, then `onClose` |
| Escape | `CallbackShortcuts` on the overlay content → same `popEntry` chain. **`canClose` is not consulted** |
| focus | Popup content is wrapped in `FocusScope` > `Focus(autofocus: true, skipTraversal: skipTraversal)`, so the popover takes focus when shown |
| close() | removes only this entry; `onClose` fires unless `notify:false`. `deactivate`/dispose closes without notifying |
| `asBarrier` | marks the entry as a stop point for the popEntry chain. Use it for sub-menus that must survive a click outside them while the parent stays open |

**Layout** (`PopoverLayoutDelegate`). Overlay size = window minus `windowPadding`. Child max constraints = the same. `anchor` = trigger's global rect shifted by `offset`.

| direction | popup top-left (x, y) |
|---|---|
| topLeft | (a.left − w, a.top − h) |
| topRight | (a.right, a.top − h) |
| bottomLeft | (a.left − w, a.bottom) |
| bottomRight | (a.right, a.bottom) |
| center | (a.center.x, a.center.y) (top-left at the anchor centre) |
| topWithLeftAligned / Center / Right | x = a.left / a.cx − w/2 / a.right − w; y = a.top − h |
| bottomWithLeftAligned / Center / Right | x = a.left / a.cx − w/2 / a.right − w; y = a.bottom |
| rightWithTopAligned / Center / Bottom | x = a.right; y = a.top / a.cy − h/2 / a.bottom − h |
| leftWithTopAligned / Center / Bottom | x = a.left − w; y = a.top / a.cy − h/2 / a.bottom − h |
| `showAtCursor` / `showAt(pos)` | (cursorLocal + triggerGlobal + offset). Direction is ignored; windowPadding is forced to zero |

Then it **clamps** x into `[pad.left, pad.left + W − w]` and y likewise. There is **no flipping** to the opposite side.

**Animation** (only when `animationDuration != 0`): opacity begin→end (easeInOut), scale begin→end (easeInOut), translate slide (linear). Slide start offset by direction: bottomWithLeft (−d,−d); bottomWithCenter (0,−d); bottomWithRight (+d,−d); topWithLeft (−d,+d); topWithCenter (0,+d); topWithRight (+d,+d); left* (+d,0); right* (−d,0); everything else none. Ends at (0,0). Reverse on close.

#### D.3.2 `AppFlowyPopover` wrapper: `packages/flowy_infra_ui/lib/src/flowy_overlay/appflowy_popover.dart`

| param | default (wrapper) |
|---|---|
| `child`, `popupBuilder` | required |
| `direction` | `rightWithTopAligned` |
| `constraints` | **`BoxConstraints(maxWidth: 240, maxHeight: 600)`** (applies to the decorated container, padding included) |
| `triggerActions` | **`PopoverTriggerFlags.click`** |
| `offset` | null → (0,0) |
| `margin` (inner padding of the container) | **`EdgeInsets.all(6)`** |
| `windowPadding` | **`EdgeInsets.all(8)`** |
| `clickHandler` | `listener` (opens on mouse-down) |
| `asBarrier` | false |
| `skipTraversal` | false |
| `animationDuration` | **`Duration()` = 0, so no animation by default** |
| `slideDistance` / `beginScaleFactor` / `endScaleFactor` / `beginOpacity` / `endOpacity` | 5 / 0.9 / 1.0 / 0.0 / 1.0 (only used if a duration is given) |
| `decorationColor` | null → `TD.cardColor` (L #FFFFFF / D #282E3A) |
| `borderRadius` | null → **10** |
| `popoverDecoration` | null → `context.getPopoverDecoration(...)` |
| `showAtCursor` | false |
| `controller`, `mutex`, `onOpen`, `onClose`, `canClose` | passthrough |

`getPopoverDecoration({color, borderRadius})` → `ShapeDecoration`:

| part | light | dark |
|---|---|---|
| fill | `color ?? TD.cardColor` (#FFFFFF) | #282E3A |
| border | 1 px, **strokeAlignOutside** (drawn outside the box), `ColorSchemeConstants.lightBorderColor` **#EDEDEE**. If `color == Colors.transparent` the border is transparent | #3A3F49 |
| radius | 10 | 10 |
| shadow | `ShadowConstants.lightSmall`: `0 4px 20px #1F23291A` | `darkSmall`: `0 2px 16px #0000007A` |

Other `ShadowConstants` (exported, used elsewhere): `lightMedium` `0 4px 32px #1F222512`; `darkMedium` `0 4px 32px #0000007A`.

Content is wrapped in `Material(type: transparency)` so text and ink work.

#### D.3.3 `PopoverActionList` / `HoverButton`: `lib/workspace/presentation/widgets/pop_up_action.dart` (app-level standard action menu)

| param | default |
|---|---|
| `actions: List<PopoverAction>` (`ActionCell` / `PopoverActionCell` / `CustomActionCell`) | required |
| `buildChild(PopoverController)`, `onSelected(action, controller)` | required |
| `direction` | `rightWithTopAligned` |
| `constraints` | `BoxConstraints(minWidth: 120, maxWidth: 460, maxHeight: 300)` |
| `triggerActions` | **none**. The caller opens it via the controller |
| `offset` | zero |
| `asBarrier` | false |
| `animationDuration` | 0; `slideDistance` 20, scale 0.9→1, opacity 0→1 |
| `mutex`, `popoverMutex`, `onClosed`, `onPopupBuilder`, `showAtCursor` | passthrough |

Popup body: `IntrinsicHeight > IntrinsicWidth > Column(children)`.

`ActionListSizes`: itemHPadding 10, itemHeight 20, vPadding 6, hPadding 10.

`HoverButton` row: `FlowyHover` (default style: hover `MS.secondary`, radius 6, pointer cursor) > padding h10 v6 > `SizedBox(height 20)` > `[leftIcon] HSpace10 [FlowyText.regular(name, lineHeight 1.15, overflow visible, color: textColor)] HSpace10 [rightIcon]`. Row height = 32. Icons are built with colour `MS.onSurface`.

`PopoverActionCell`: the row opens a nested `AppFlowyPopover(asBarrier: true, mutex: popoverMutex)` on tap.

---

### D.4 appflowy_ui components (`packages/appflowy_ui/lib/src/component/**`)

#### D.4.1 `AFButtonSize`: `button/base_button/base.dart`

| size | padding (h × v) | radius | text style | resulting height* |
|---|---|---|---|---|
| `s` | 12 × 4 (`spacing.l` × `spacing.xs`) | 8 (`radius.m`) | `AF.ts.body.enhanced` 14/20 w500 | 28 |
| `m` (default everywhere) | 16 × 6 (`spacing.xl` × `spacing.s`) | 8 (`radius.m`) | body.enhanced 14/20 w500 | 32 |
| `l` | 16 × **10** (hard-coded) | **10** (hard-coded) | body.enhanced 14/20 w500 | 40 |
| `xl` | 16 × **14** (hard-coded) | 16 (`radius.xl`) | `AF.ts.title.enhanced` 20/28 w500 | 56 |

\*Height = 2 × vertical padding + line height. The 1 px border is painted inside the padding (it does not add to the size).

#### D.4.2 `AFBaseButton`: `button/base_button/base_button.dart`

| param | default |
|---|---|
| `onTap` (VoidCallback?) | required (may be null) |
| `builder(context, isHovering, disabled)` | required |
| `padding`, `borderRadius` (double) | required |
| `borderColor(ctx, hover, disabled, focused)` | null → `AF.border.primary` (**1 px visible border**) |
| `backgroundColor(ctx, hover, disabled)` | null → `AF.fill.content` (transparent) |
| `ringColor(ctx, hover, disabled, focused)` | null → focused: `AF.border.themeThick` at alpha 128 (**#00B5FF80**); else transparent |
| `disabled` | false |
| `autofocus` | false |
| `showFocusRing` | true |

| state | handling |
|---|---|
| hover | `MouseRegion` enter/exit → `isHovering`. Passed to colour builders and the builder. Instant, no transition. Hover is tracked **even when disabled** |
| pressed | **no pressed state** |
| focus | always focusable (Tab). When focused and `showFocusRing`, a **2 px ring** is drawn **outside** (`strokeAlignOutside`) with the same radius |
| keyboard | Enter/Space (`ActivateIntent`) → `onTap` unless disabled |
| cursor | `click` when `onTap != null && !disabled`, else `basic` |
| disabled | tap suppressed. Still focusable. Colours come from the builders |
| render | ring box > `DecoratedBox(color: bg, border: Border.all(borderColor, 1), radius)` > `Padding(padding)` > builder |

#### D.4.3 Button variant colour matrix (normal / hover / disabled)

`AFBaseTextButton` subclasses (`AFFilledTextButton`, `AFOutlinedTextButton`, `AFGhostTextButton`) wrap the button in **`ConstrainedBox(minWidth: 76)`**. Their content is `Text(text, style: textStyle ?? size.textStyle.copyWith(color), textAlign: center)`, optionally `Align(alignment)`. Common params: `text, onTap (required), size = m, padding?, borderRadius?, disabled = false, alignment?, textStyle?`. Builder variants (`AFFilledButton`, `AFOutlinedButton`, `AFGhostButton`) have no min width and take a `builder(ctx, hover, disabled)`. Icon-text variants: `Row(center) [iconBuilder(ctx,hover,disabled)] gap [Text(size.textStyle)]`, with gap **6** (`spacing.s`) for Filled/Outlined and **8** (`spacing.m`) for Ghost. They have no min width.

| variant | border | background | text |
|---|---|---|---|
| `AFFilledTextButton.primary` / `AFFilledButton.primary` | transparent | `fill.themeThick` / hover `fill.themeThickHover` / disabled `fill.contentHover` | `text.onFill` / disabled `text.tertiary` |
| `AFFilledTextButton.destructive` / `AFFilledButton.destructive` | transparent | `fill.errorThick` / hover `fill.errorThickHover` / disabled `fill.contentHover` | `text.onFill` / disabled `text.tertiary` |
| `AFFilledTextButton.disabled` / `AFFilledButton.disabled({backgroundColor})` | transparent | `fill.contentHover` (or the given bg) | `text.tertiary`; `disabled: true`, onTap no-op |
| `AFFilledTextButton(...)` (custom) | transparent | required `backgroundColor` builder | required `textColor` builder (falls back to `text.onFill`) |
| `AFFilledIconTextButton.primary` | **not set → `border.primary` 1 px**. AMBIGUOUS: probably unintended | `fill.themeThick` / hover `themeThickHover` / disabled `fill.tertiary` | `text.onFill` always |
| `AFFilledIconTextButton.destructive` | same AMBIGUOUS default border | `fill.errorThick` / hover `errorThickHover` / disabled `fill.tertiary` | `text.onFill` |
| `AFFilledIconTextButton.disabled` | same | `fill.tertiary` | `text.onFill`. Note: `disabled` is not passed to the base, so hover/focus still behave as enabled |
| `AFFilledIconTextButton.ghost` | same | transparent / hover `fill.themeThickHover` | `text.primary` / disabled `text.tertiary` |
| `AFOutlinedTextButton.normal({backgroundColor?})` / `AFOutlinedButton.normal` / `AFOutlinedIconTextButton.normal` | `border.primary` / hover `border.primaryHover` / disabled `border.primary` | `fill.content` / hover `fill.contentHover` / disabled `fill.content` | `text.primary` / disabled `text.tertiary` |
| `AFOutlinedTextButton.destructive` / `AFOutlinedButton.destructive` | `fill.errorThick` / hover `fill.errorThickHover` | `fill.content` / hover `fill.errorSelect` / **disabled `fill.errorThick`** | `text.error` (also when disabled). AMBIGUOUS: the disabled state gives red text on solid red |
| `AFOutlinedIconTextButton.destructive` | `fill.errorThick` / hover `errorThickHover` | **`fill.errorThick` / hover `errorThickHover` / disabled `errorThick`** | `text.error`. AMBIGUOUS: red text on solid red, probably a bug, so decide whether to copy it |
| `*.disabled` (Outlined) | `border.primary` | `fill.content` | `text.tertiary`; `disabled: true` |
| `AFGhostTextButton.primary` | transparent | `fill.content` / hover `fill.contentHover` (**also while disabled**) | `text.primary` / disabled `text.tertiary` |
| `AFGhostTextButton.disabled` | transparent | `fill.content` | `text.tertiary` |
| `AFGhostButton.normal` | transparent | `fill.content` / hover `fill.contentHover` / disabled `fill.content` | caller's builder |
| `AFGhostButton.disabled` | transparent | `fill.content` | caller's builder |
| `AFGhostIconTextButton.primary({mainAxisAlignment = center})` | transparent | transparent / hover `fill.contentHover` / disabled transparent | `text.primary` / disabled `text.tertiary` |
| `AFGhostIconTextButton.disabled` | transparent | transparent | `text.tertiary` |

Extra params: `AFOutlinedIconTextButton` has `alignment: MainAxisAlignment = center`; `AFGhostIconTextButton` has `mainAxisAlignment`.

#### D.4.4 `AFTextField`: `textfield/textfield.dart`

| param | default |
|---|---|
| `size` | **`AFTextFieldSize.l`** |
| `hintText`, `initialText`, `keyboardType`, `controller`, `focusNode`, `onChanged`, `onSubmitted`, `maxLength`, `autofillHints` | null |
| `autoFocus` | null → false |
| `obscureText` | false (initial obscured state) |
| `readOnly` | false |
| `validator(controller) → (bool hasError, String errorText)` | runs on **every controller change** |
| `suffixIconBuilder(ctx, isObscured)`, `suffixIconConstraints` | null. There is **no built-in clear or eye button**; the caller builds them and toggles via `state.syncObscured(bool)` |
| `groupId` | `EditableText` (TapRegion group) |

| size | content padding (v × h) | radius | approx height |
|---|---|---|---|
| `m` | 6 × 8 | 8 (`radius.m`) | ≈32 |
| `l` | 10 × 8 | 10 (hard-coded) | ≈40 |

| state | border (1 px OutlineInputBorder) |
|---|---|
| enabled | `border.primary` |
| focused | `border.themeThick`; readOnly → `border.primary` |
| error (hasError) | `border.errorThick` (enabled and focused) |

Text style: `AF.ts.body.standard` (14/20 w400) in `text.primary`. Hint: body.standard in `text.tertiary`. `isDense: true`, `constraints: BoxConstraints()`. `hoverColor: border.primaryHover` has no effect, because Material only applies hoverColor to `filled` fields; AMBIGUOUS whether a hover border was intended. Error row: shown when `hasError && errorText != ''`. Gap 4 (`spacing.xs`), then `Text(errorText, AF.ts.caption.standard 12/18, text.error)`, left-aligned. State API (`GlobalKey<AFTextFieldState>`): `syncError(errorText:)`, `clearError()`, `syncObscured(bool)`. `maxLength` without `counterText` → the Material counter `n/max` is shown under the field (M2 style). AMBIGUOUS styling. Enforcement: truncateAfterCompositionEnds. Enter → `onSubmitted`.

#### D.4.5 Menu: `menu/{menu,section,menu_item,text_menu_item}.dart`

| widget | params (defaults) | spec |
|---|---|---|
| `AFMenu` | `children` (required), `width` null (intrinsic), `backgroundColor` null → `surface.primary` | Container: radius **12** (`radius.l`), border 1 px `border.primary`, shadow `AF.shadow.medium`, padding **8** (`spacing.m`) all round, `Column(min)` |
| `AFMenuSection` | `title` null, `children`, `padding` null → **h8 v6**, `constraints` null | title: `Padding(padding) > Text(AF.ts.caption.enhanced 12/18 w500, text.tertiary)`. Children sit in a `SingleChildScrollView` inside a Container with `constraints` (e.g. maxHeight) |
| `AFMenuItem` | `title` (Widget), `onTap` null, `leading`, `subtitle` (Widget), `trailing`, `selected` false, `showSelectedBackground` true, `padding` null → **h8 v6** | AFBaseButton: radius 8, border transparent. bg: disabled `fill.content`; `selected && showSelectedBackground` → `fill.themeSelect`; hover (only if onTap≠null) → `fill.contentHover`; else `fill.content`. Layout: `[leading] gap 8 [Expanded Column(start){title, subtitle}] [trailing]`. Focus ring: 2 px #00B5FF80 outside. Enter/Space activate |
| `AFTextMenuItem` | `title` (String), `onTap` (required), `leading`, `subtitle` (String), `trailing`, `selected` false, `titleColor` null → `text.primary`, `subtitleColor` null → `text.secondary`, `showSelectedBackground` true | title `AF.ts.body.standard` 14/20. subtitle `AF.ts.caption.standard` 12/18. Height = 32 (one line) or 50 (with subtitle) |

#### D.4.6 Modal: `modal/{modal,dimension}.dart`

| item | spec |
|---|---|
| `AFModalDimension` | `S = 400`, `M = 560`, `L = 720` (widths, used as `maxWidth`), `dialogHeight = 200` |
| `AFModal({constraints = BoxConstraints(), backgroundColor, child})` | `Center > Padding(all 16 = spacing.xl) > ConstrainedBox(constraints) > DecoratedBox(color: backgroundColor ?? surface.primary, radius 16 (radius.xl), shadow AF.shadow.medium) > Material(transparent)`. **No clip** |
| `AFModalHeader({leading (required), trailing = []})` | padding top 16, left/right 20, bottom 0. `DefaultTextStyle(AF.ts.heading4.prominent 16/22 w700, text.primary)`. `Row(spacing 6)[Expanded(leading), ...trailing]` |
| `AFModalBody({child})` | padding vertical 12, horizontal 20 |
| `AFModalFooter({leading = [], trailing = []})` | padding bottom 16, left/right 20, top 0. `Row(spacing 12)[...leading, Spacer, ...trailing]` |
| barrier | AFModal sets none. Callers pass `barrierColor: AF.surface.overlay` (#00000099) to `showDialog` (see D.5.4) |

#### D.4.7 `AFPopover` (shadcn port): `popover/popover.dart`, `popover/anchor.dart`, `popover/shadcn/_portal.dart`, `_mouse_area.dart`

| param | default |
|---|---|
| `child`, `popover: WidgetBuilder` | required |
| `controller` (`AFPopoverController`: `isOpen`, `show`, `hide`, `toggle`, `setOpen`) **xor** `visible: bool` | exactly one is required |
| `closeOnTapOutside` | true |
| `anchor` | `ShadAnchorAuto()` |
| `effects` (flutter_animate) | null → **`[]` = no animation**. AMBIGUOUS: the doc comment says fade+scale(.95)+move(0,2), but the code uses none |
| `shadows` | param accepted but **unused** |
| `padding` | null → **horizontal 8 (`spacing.m`), vertical 12 (`spacing.l`)**. The doc comment says h12 v6; the code wins |
| `decoration` | null → `BoxDecoration(color: surface.layer01, radius 8 (radius.m), boxShadow: AF.shadow.medium)`. No border |
| `filter` | null (when set, a BackdropFilter wraps the popover) |
| `groupId` / `areaGroupId` / `useSameGroupIdForChild` | own UniqueKey / null / true (a tap on the child counts as inside) |
| `focusNode` | unused |

Behaviour: the popover content gets `DefaultTextStyle(color: text.primary)`. Outside tap (`TapRegion`) → `controller.hide()`, but **only for the top-most open AFPopover** (a static stack), with a same-frame guard so one tap closes one popover. **Escape** (`CallbackShortcuts` around the child/portal) → hide. It renders through `OverlayPortal` (stays inside the widget tree, so it inherits theme and focus scope).

| anchor | params (defaults) | placement |
|---|---|---|
| `ShadAnchorAuto` / `AFAnchorAuto` | `offset (0,0)`, `followTargetOnResize true`, `followerAnchor bottomCenter`, `targetAnchor bottomCenter` | target point = target box at `targetAnchor`. Follower adjust by alignment (e.g. bottomCenter → 0; topCenter → −h; centerLeft → (−w/2, −h/2)) + offset. Then `positionDependentBox(preferBelow: true, verticalOffset: 0, margin: 0)`: horizontally centred on the point and clamped to the screen; below the point, **flipped above when there is not enough room**. The first frame renders invisible (Visibility.maintain) to measure, which avoids a flicker |
| `ShadAnchor` / `AFAnchor` | `childAlignment topLeft`, `overlayAlignment bottomLeft`, `offset (0,0)` | `CompositedTransformFollower`: popover point `childAlignment` is pinned to the trigger point `overlayAlignment` + offset. No clamping, no flipping |
| `ShadGlobalAnchor` / `AFGlobalAnchor(offset)` | global point | `positionDependentBox` around that point |

#### D.4.8 `AFDropDownMenu<T extends AFDropDownMenuMixin{String get label}>`: `dropdown_menu/dropdown_menu.dart`

| param | default |
|---|---|
| `items`, `selectedItems` | required |
| `onSelected(T?)` | null |
| `closeOnSelect` | null → closes after a pick (single-select) |
| `controller` | own `AFPopoverController` |
| `isClearEnabled` | true; the clear icon shows only when `isOpen && clearIcon != null` |
| `isDisabled` | false |
| `isRequired`, `errorText` | accepted, **unused** |
| `emptyLabel` | null → `"(optional)"` |
| `clearIcon`, `dropdownIcon`, `selectedIcon` | null. Dropdown default: 20×20 box with `Icons.arrow_drop_down` size 16. selectedIcon default `Icons.check` 20 in `fill.themeThick` |
| `isMultiselect` | hard-coded **false** (the multiselect chip UI exists but cannot be reached) |

Trigger: height **32** (tight), padding h8 v4, radius 8, `Row(spacing 4)`. Border 1 px: disabled `border.primary` → open `border.themeThick` → hover `border.primaryHover` → else `border.primary`. Disabled bg `fill.contentHover`. Label: `AF.ts.body.standard` in `text.primary` (empty or disabled → `text.tertiary`), one line, ellipsis. Click toggles (ignored when disabled).

Popup: `AFPopover(padding 0, anchor AFAnchor(child topCenter → trigger bottomCenter, offset (0, 4)), decoration {surface.layer01, radius 8, AF.shadow.small})`. Constraints maxWidth = the trigger's incoming max width, **maxHeight 300**. `ListView` padding 8, clamping physics, autofocus FocusScope. Items: AFBaseButton padding v6 h8, radius 8, transparent border, **no focus ring**. bg: selected (single) `fill.themeSelect` → hover `fill.contentHover` → transparent. Text body.standard `text.primary`, ellipsis. Row spacing 8.

#### D.4.9 `AFAvatar`: `avatar/avatar.dart`

| `AFAvatarSize` | px | initials style |
|---|---|---|
| xs | 16 | `AF.ts.caption.standard` (12/18 w400) |
| s | 24 | `body.standard` (14/20) |
| m (default) | 32 | `heading4.standard` (16/22 w400) |
| l | 48 | `heading3.standard` (20/28 w400) |
| xl | 64 | `heading2.standard` (24/32 w400) |

Params: `name`, `url`, `size = m`, `textColor`, `backgroundColor`, `child`, `colorHash`. Precedence: `child` (ClipOval) > non-empty `url` (ClipOval, `CachedNetworkImage`, BoxFit.cover, falls back to initials on error) > initials circle. Initial = first char of `name.trim()`, upper-cased; empty name → `''`.

Colour hash (on `colorHash ?? name`): `hash = 0; for each UTF-16 code unit c: hash = c + ((hash << 5) - hash)`. **Dart 64-bit int wraparound.** In JS use `BigInt.asIntN(64, …)`, because 32-bit `<<` and float precision will not match for names longer than ~10 chars. Then `index = (|hash| % 20) + 1`. Null or empty → 1. bg = `badgeColorScheme.color{index}Light2`, text = `color{index}Thick3`. These are the same in light and dark:

| idx | family | bg (Light2 = x200) | text (Thick3 = x600) |
|---|---|---|---|
| 1 | Rose | #FAE3E3 | #702828 |
| 2 | Papaya | #FAE8DE | #6B3215 |
| 3 | Tangerine | #FCEDD9 | #613B0A |
| 4 | Mango | #FCF1D7 | #5C4102 |
| 5 | Lemon | #FCF5CF | #574800 |
| 6 | Olive | #F6F7D0 | #4A4C03 |
| 7 | Lime | #EEF5CE | #414D05 |
| 8 | Grass | #E9F5D7 | #334D0C |
| 9 | Forest | #E2F5DF | #1E4F16 |
| 10 | Jade | #DFF5EB | #075231 |
| 11 | Aqua | #DFF3F5 | #004E57 |
| 12 | Azure | #E1EEF7 | #154469 |
| 13 | Denim | #E3EBFA | #223C70 |
| 14 | Mauve | #E6E6FA | #36366B |
| 15 | Lavender | #EBE3FA | #462F75 |
| 16 | Lilac | #F0E1F7 | #562D6B |
| 17 | Mallow | #F5E1F4 | #632861 |
| 18 | Camellia | #F7E1EB | #6E2343 |
| 19 | Smoke | #E8E8E8 | #404040 |
| 20 | Iron | #E6E9F0 | #394152 |

#### D.4.10 `AFDivider`: `separator/divider.dart`

`AFDivider({axis = horizontal, color = AF.border.primary, thickness = 1, spacing = 0, startIndent = 0, endIndent = 0})`. Horizontal: a line `thickness` tall, margin start/end = indents, top/bottom = spacing. Vertical: a line `thickness` wide, margin left/right = spacing, top = startIndent, bottom = endIndent.

---

### D.5 Dialogs & toasts

#### D.5.1 Material `showDialog` + `Dialog` base (used by every `show*Dialog` helper below). Flutter 3.27, M2 defaults

| property | value |
|---|---|
| barrier | `Colors.black54` (**#0000008A**) unless `barrierColor` is passed. `barrierDismissible` true |
| transition | fade, **150 ms**, `Curves.easeOut` (in and out) |
| Escape | pops when `barrierDismissible` (ModalRoute `DismissIntent`) |
| `Dialog` | `insetPadding` h40 v24. bg `TD.dialogBackgroundColor` = `MS.surface` (L #FFFFFF / D #1A202C). Elevation 24 = shadows `0 11px 15px -7px #00000033, 0 24px 38px 3px #00000024, 0 9px 46px 8px #0000001F`. Clip none. Centred. Wrapped in SafeArea |

#### D.5.2 `ConfirmPopup`: `lib/workspace/presentation/home/menu/sidebar/space/shared_widget.dart`

| param | default |
|---|---|
| `title`, `description`, `onConfirm(BuildContext)` | required |
| `style` | `ConfirmPopupStyle.cancelAndOk` (other value: `onlyOk`) |
| `onCancel` | null |
| `confirmLabel` | null → cancelAndOk: `LocaleKeys.space_delete` ("Delete"); onlyOk: `LocaleKeys.button_ok` |
| `confirmButtonColor` | null → cancelAndOk: `MS.error` (#FB006D); onlyOk: `MS.primary` (AMBIGUOUS: `SpaceOkButton` ignores this colour and always uses `MS.primary`) |
| `titleStyle` / `descriptionStyle` | null → see below |
| `confirmButtonBuilder` | null (replaces the confirm button) |
| `child` | null (extra content under the description) |
| `closeOnAction` | true |
| `showCloseButton` | true |
| `enableKeyboardListener` | true |

Layout: `Container(radius 16 (radius.xl), color AF.surface.primary, padding 20 all round)` > `Column(min, start)`:

1. Title row: `Expanded(Text(title, AF.ts.heading4.prominent 16/22 w700, AF.text.primary, ellipsis))`, HSpace 6, close = `AFGhostButton.normal(size s, padding 4, icon password_close_m 20×20)`, which pops. The close button is 28×28.
2. If the description is non-empty: VSpace 12, then `Text(description, AF.ts.body.standard 14/20, AF.text.primary, maxLines 5)`.
3. If a child is given: VSpace 12, then the child.
4. VSpace 20.
5. Buttons row, aligned to the end:
   - `cancelAndOk`: `AFOutlinedTextButton.normal(size m on desktop, text Cancel, textStyle body.standard (w400) text.primary)` (32 tall, min width 76, radius 8). HSpace 12. Confirm = `DecoratedBox(ShapeDecoration(color confirmButtonColor, radius 8)) > FlowyButton(useIntrinsicWidth, margin h16 v9, radius 8, hover MS.secondary overlay, FlowyText.regular(label, lineHeight 1.0, MS.onPrimary))` (32 tall).
   - `onlyOk`: `PrimaryRoundedButton(margin h16 v9, radius 8)`: bg `MS.primary`, hover primary@0.9, 14 w500 `MS.onPrimary`, 32 tall.

Keyboard (KeyboardListener, autofocus): **Escape key-down → pop**. **Enter key-up → `onConfirm`**, then pop if `closeOnAction`. Cancel → `onCancel` + pop. Confirm → `onConfirm` + pop if `closeOnAction`.

Note: the popup (radius 16) sits inside a Material `Dialog` with radius 12 and `MS.surface` bg, so the visible outer corner is 12. In dark mode the Dialog bg (#1A202C) differs from `AF.surface.primary` (#272930). AMBIGUOUS whether the corner mismatch is visible.

#### D.5.3 Confirm helpers: `lib/workspace/presentation/widgets/dialogs.dart`

All of them are `showDialog(builder: Dialog(shape radius 12, child: SizedBox(width 440, child: ConfirmPopup(...))))` with the D.5.1 base.

| helper | params | ConfirmPopup config |
|---|---|---|
| `showConfirmDialog` | `context, title, description, titleStyle?, descriptionStyle?, onConfirm(ctx)?, onCancel?, confirmLabel?, style = onlyOk, confirmButtonBuilder?, confirmButtonColor?` | as given (default **onlyOk**). ~30 call sites |
| `showConfirmDeletionDialog` | `context, name, description, onConfirm` | title = `LocaleKeys.space_deleteConfirmation.tr() + name`; style cancelAndOk; confirm "Delete" in `MS.error` |
| `showCancelAndConfirmDialog` | `context, title, description, onConfirm(ctx)?, onCancel?, confirmLabel?` | cancelAndOk; confirm colour `MS.primary` |
| `showCustomConfirmDialog` | `context, title, description, builder(ctx) (required), onConfirm?, onCancel?, confirmLabel?, style = onlyOk, closeOnConfirm = true, showCloseButton = true, enableKeyboardListener = true, barrierDismissible = true` | confirm colour `MS.primary`; child = builder |
| `showCancelAndDeleteDialog` | `context, title, description, builder?, onDelete?, confirmLabel?, closeOnAction = false` | cancelAndOk; confirm colour `MS.error`; **does not auto-close** by default |

#### D.5.4 AF-modal helpers: `lib/workspace/presentation/widgets/dialog_v2.dart`

| helper | spec |
|---|---|
| `showSimpleAFDialog({context, title, content, isDestructive = false, primaryAction: (label, fn(ctx)?), secondaryAction?, barrierDismissible = true})` | `showDialog(barrierColor: AF.surface.overlay #00000099)`. `AFModal(maxWidth 400 = S)` > `Column(min)`: <br>• `AFModalHeader(leading: Text(title), trailing: [AFGhostButton.normal(padding 4, icon toast_close_s 20) → pop])`. <br>• `Flexible(ConstrainedBox(minHeight 108) > AFModalBody(Text(content, body.standard, text.primary)))`. <br>• `AFModalFooter(trailing: [secondary? AFOutlinedTextButton.normal, primary: isDestructive ? AFFilledTextButton.destructive : .primary])`. Each action calls its fn, then pops |
| `showAFTextFieldDialog({context, title, initialValue, onConfirm(String)?, barrierDismissible = true, selectAll = true, maxLength?, hintText?}) → Future<String?>` | same barrier. `AFTextFieldDialog`: AFModal S (400). Header as above. Body `AFTextField(autoFocus, size m, hintText, maxLength)` with the initial text, all selected (or caret at end). Footer `[AFOutlinedTextButton.normal(Cancel) → pop, AFFilledTextButton.primary(Confirm, disabled when trimmed text is empty)]`. Enter (onSubmitted) or Confirm → trims; if non-empty, `onConfirm(text)` and pop(text) |

#### D.5.5 Legacy Navigator dialogs: `dialogs.dart`. Shown via `widget.show(context)` → `Dialogs.show` (StyledDialogRoute: barrier #00000066, fade 300 ms easeInOut, Escape pops; see D.2.11)

| widget | params (defaults) | layout |
|---|---|---|
| `NavigatorAlertDialog` | `title` (required), `cancel?`, `confirm?`, `hideCancelButton = false`, `constraints?` | `StyledDialog` defaults (padding h64 v36, radius 6, min width 400, bg `MS.surface`). `ConstrainedBox(constraints ?? max 400×260) > FlowyText.medium(title, 16, center, MS.tertiary, maxLines null)`. If `confirm` is given: VSpace 20 + `OkCancelButton`. Each button calls its fn and pops |
| `NavigatorOkCancelDialog` | `onOkPressed?, onCancelPressed?, okTitle?, cancelTitle?, title?, message?, maxWidth = 500, titleUpperCase = true, autoDismiss = true` | `StyledDialog(maxWidth 500, padding h36 v24)`. If a title is given: `FlowyText.medium(UPPERCASE title, 16, maxLines 3)`, VSpace 9, a 1 px line in `MS.surfaceContainerHighest`, VSpace 18. Then `FlowyText.medium(message, 14, maxLines 3)`, SizedBox 24, `OkCancelButton(okTitle/cancelTitle UPPERCASED)`. The cancel button is hidden when `onCancelPressed` is null. `autoDismiss` → pop after either button |
| `NavigatorCustomDialog` | `child`, `cancel?`, `confirm?`, `hideCancelButton = false` | like NavigatorAlertDialog, with the child constrained to max 400×260 |
| `OkCancelButton` | `onOkPressed?, onCancelPressed?, okTitle (button_ok), cancelTitle (button_cancel), minHeight (unused), alignment = MainAxisAlignment.spaceAround, mode = TextButtonMode.big` | `SizedBox(height 48) > Row[SecondaryTextButton(cancel) (100×40, radius 12, 1.5 px MS.primary outline, text MS.primary), HSpace 12, PrimaryTextButton(ok) (100×40, radius 12, bg MS.primary, hover MS.primaryContainer, text MS.onPrimary)]`. Each button appears only if its callback is non-null. Text `FlowyText.regular` 14 |

#### D.5.6 Toasts & snackbars

| API | file | spec |
|---|---|---|
| `showToastNotification({context?, message XOR richMessage (TextSpan), description?, type = ToastificationType.success, callbacks?, showCloseButton = false, bottomPadding = 100})` → `ToastificationItem` (≈174 call sites) | `lib/workspace/presentation/widgets/dialogs.dart` (package `toastification 2.3.0`, `ToastificationWrapper` in `lib/startup/tasks/app_widget.dart`) | `toastification.showCustom(alignment: bottomCenter, autoCloseDuration: 3000 ms)`. Package defaults: enter/exit animation **600 ms**, fade plus slide up from Offset(0, 1) (one toast height), overlay margin bottom 12, item width 400. Toasts stack. **DesktopToast** (`Center` + margin bottom 32): container max width **360**, padding h16 v12, radius **12** (`radius.l`), bg `AF.surface.inverse` (L #21232A / D #3D404F), shadow `AF.shadow.small`. Row(min, center): icon 20×20 in original colours (`toast_checked_filled_s` for success, `toast_warning_filled_s` for warning, `toast_error_filled_s` for error; `info` throws UnimplementedError). Gap 8. `Flexible(Text(message, AF.ts.body.standard 14/20, AF.text.onFill #FFFFFF, maxLines 2, ellipsis))` or RichText (maxLines 2). If `showCloseButton`: gap 16, then a 24×24 hit box with the `toast_close_s` 20 px icon in **#BDBDBD**, pointer cursor, tap dismisses. `description` and `bottomPadding` are used only by the mobile toast |
| `showSnackBarMessage(context, message, {showCancel = false, duration = 4 s})` (22 sites) | `lib/workspace/presentation/home/toast.dart` | Material SnackBar (M2, fixed, full width at the bottom of the Scaffold). bg `MS.surfaceContainerHighest` (L #F7F8FC / D #232B38). Content `FlowyText(message, maxLines 2, fontSize 14)` in the default text colour. Optional action "Cancel" in **#FFFFFF** (AMBIGUOUS: low contrast on the light bg), which hides it. Flutter defaults: elevation 6, enter/exit 250 ms (height `fastOutSlowIn`, fade-in Interval 0.4–1.0), vertical padding 14 |
| `showSnapBar(context, title, {onClosed})` | `packages/flowy_infra_ui/lib/style_widget/snap_bar.dart` | clears existing snackbars, then shows a SnackBar with the same bg, duration **8 s**, `FlowyText(title, maxLines 2, 14 px desktop)`. `onClosed` fires on close |
| `showMessageToast(message, {context?, gravity = ToastGravity.BOTTOM})` (7 sites) | `toast.dart` (package `fluttertoast 8.2.10`, `FToast`) | `FlowyMessageToast`: radius 4, bg `MS.surface`, padding h12 v6, `FlowyText.medium(message, 16, maxLines 3)`. No shadow. Position: `Positioned(bottom 50, left 24, right 24)` (centre gravity if the keyboard is open). Duration 3 s, fade 350 ms. Toasts are queued |

---

### D.6 React component checklist

| Flutter primitive | React component | key props (defaults as above) |
|---|---|---|
| `Insets` / `FontSizes` / `Corners` / `Sizes` / `FlowyDurations` / AF spacing, radius, shadow | `tokens.ts` + CSS vars (`--inset-*`, `--fs-*`, `--radius-*`, `--af-spacing-*`, `--af-radius-*`, `--af-shadow-sm/md`) | light/dark sets per D.1.5 and D.1.6 |
| `VSpace` / `HSpace` / `Space` | `<VSpace size color?/>`, `<HSpace size color?/>` | size px; color → filled bar |
| `SeparatedColumn` / `SeparatedRow` | `<Separated direction separator?>` | default separator = 16 px Divider |
| `FlowyText` (+ .small/.regular/.medium/.semibold/.emoji) | `<FlowyText variant="regular|medium|semibold|small|emoji">` | `fontSize=14`, `color` (default `var(--text)`, hover-aware), `maxLines=1`, `overflow='clip'`, `lineHeight` (multiplier), `figmaLineHeight` (px), `textAlign`, `decoration`, `fontFamily`, `withTooltip`; single line → `white-space:nowrap; overflow:hidden; text-overflow:clip`; multi-line → `-webkit-line-clamp` |
| `FlowyHover` + `HoverStyle` | `<Hover>` (wrapper div) | `hoverColor=var(--ms-secondary)`, `backgroundColor=transparent`, `radius=6`, `border`, `contentMargin`, `fgOnHover=var(--ms-on-surface)`, `selected`, `cursor='pointer'`, `onHoverChange` |
| `FlowyButton` | `<FlowyButton>` | `text`, `leftIcon` (16×16 box), `rightIcon`, `iconPadding=6`, `margin='4px 6px'`, `radius=6`, `hoverColor`, `backgroundColor`, `borderColor`, `selected`, `disabled` (cursor not-allowed, no opacity change), `expand`, `expandText=true`, `intrinsicWidth`, `justify='center'`, `onClick`, `onContextMenu` |
| `FlowyIconTextButton` | `<FlowyIconTextButton>` | render-props `text(hover)`, `leftIcon(hover)`, `rightIcon(hover)`, otherwise as FlowyButton |
| `FlowyTextButton` (+ .primary/.secondary) | `<FlowyTextButton variant="default|primary|secondary">` | `padding='6px 8px'`, `fontWeight=500`, `lineHeight=1.1`, `fillColor`, `hoverColor`, `fontColor`, `fontHoverColor`, `borderColor`, `isDangerous`, `heading` (gap 8), `tooltip`, `minHeight` (32 for primary/secondary), `radius=6` |
| `FlowyRichTextButton` | `<FlowyRichTextButton>` | min 58×30, padding 6/8, heading gap 6 |
| `FlowyIconButton` / `FlowyDropdownButton` / `FlowyToolbarButton` | `<IconButton>` | `size=30` (`width`, `height`), `iconPadding=0`, `radius=6`, `fillColor=transparent`, `hoverColor=var(--ms-secondary)`, `iconColorOnHover`, `tooltip`, `tooltipPlacement='bottom'`, `selected`; toolbar: min 36×32 |
| `FlowyTooltip` / `ManualTooltip` | `<Tooltip>` (Radix/Floating UI) | `content` / `richContent`, `delay=300`, `closeDelay=100`, fade 150/75 ms, bg light #1D2129 / dark #E5E5E5E5, text 14/20 w400 white/black, `padding='8px 12px'`, `radius=10`, `offset=16` from the anchor centre, `side='bottom'` with flip, `minHeight=24`; close all on wheel; `open` prop for manual |
| `FlowyTextField` | `<FlowyTextField>` | `autoFocus=true`, `maxHeight=32` (58 with error), `padding='0 12px'` (multi-line 12 px vertical), `radius=8`, border `--ms-outline` → focus `--ms-primary` → error `--ms-error`, `maxLength` + `" n/max"` suffix, `debounceMs`, `submitOnBlur`, `onSubmit`, `onCancel`, `autoClear`, `prefix`/`suffix` |
| `RoundedInputField` | `<RoundedInput>` | `height=48`, `padding='0 10px'`, `radius=10`, `errorText`, obscure toggle (16 px), 400 ms height animation |
| `FlowyFormTextInput` / `StyledSearchTextInput` | `<UnderlineInput>` | center-aligned, underline 1 px (2 px primary on focus), Escape → `onCancel`, `onFocusChange` |
| `FlowyScrollbar` | `<HoverScrollArea>` | thumb 4 px, radius 12, margin 6, visible on hover, auto-fade 600/300 ms |
| `StyledScrollbar` / `StyledListView` / `StyledSingleChildScrollView` | `<StyledScrollArea>` | `barSize=8`, min handle 60, radius 3, auto-hide 2 s, opacity transition 250 ms ease-out, content inset `barSize+12`, optional track |
| `FlowyDivider` | `<FlowyDivider>` | 1 px `var(--afx-border)`, `padding` |
| `FlowyContainer` / `FlowyDecoration` | `<AnimatedBox>` / `shadowBox()` util | 350 ms transition; default blur 20, radius 6 |
| `FlowyDialog` | `<FlowyDialog>` | 70 % × 70 % of the viewport, radius 16, bg `--td-card`, inset 40/24, elevation-24 shadow |
| `StyledDialog` + `Dialogs.show` / `IntoDialog.show` | `<StyledDialog>` + `openStyledDialog()` | `padding='36px 64px'`, min width 400, radius 6, bg `--ms-surface`; barrier #00000066, fade 300 ms, Escape and barrier click close |
| `Toggle` / `ToggleStyle` | `<Toggle size="big|small|mobile">` | 27×16/14, 16×10/8, 42×24/18; active `--ms-primary`, inactive `--afx-toggle-bg`, thumb #fff, 150 ms thumb slide, padding 8 (hit area) |
| `FlowyColorPicker` / `ColorOptionIcon` | `<ColorPicker>` / `<ColorDot>` | `options`, `selected`, `onSelect`, row height 32, gap 4, dot 16, icon gap 10, transparent dot border #CFD3D9 |
| `PrimaryRoundedButton` | `<PrimaryRoundedButton>` | `radius=10`, `padding='0 14px'`, 14 px w500, bg `--ms-primary`, hover primary@90 % |
| `OutlinedRoundedButton` | `<OutlinedRoundedButton>` | `radius=8`, `padding='9px 16px'`, border #14171B1E / #FFFFFF1A |
| `PrimaryButton` / `SecondaryButton` / `PrimaryTextButton` / `SecondaryTextButton` / `BaseStyledButton` | `<LegacyButton kind="primary|secondary" mode="normal|big|small">` | min sizes 80×32 r8 / 100×40 r12 / 100×30 r6; secondary outline 1.5 px; disabled opacity .7; focus ring 1.8 px + glow |
| `RoundedTextButton` / `RoundedImageButton` | `<RoundedTextButton>` / `<ImageButton>` | max height 60, padding 6/8, radius 6 |
| `FlowySvg` | `<FlowySvg name size color? keepColors?>` | mask-tint with `currentColor` (srcIn) by default; `keepColors` = `blendMode:null` |
| `Popover` / `PopoverController` / `PopoverMutex` / `PopoverDirection` / `PopoverTriggerFlags` | `<Popover>` + `usePopoverController()` + `PopoverMutex` class + `PopoverStack` (global context) | `direction='rightWithTopAligned'`, `trigger={click|hover|contextmenu|none}`, `openOn='pointerdown'|'click'`, `offset`, `windowPadding`, `asBarrier`, `canClose()`, `onOpen`, `onClose`, `mutex`, `showAtCursor`, `animation={duration,slide,scale,opacity}`; behaviour: single global mask, barrier pop chain, Escape pops the chain, clamp (no flip), autofocus |
| `AppFlowyPopover` | `<AppFlowyPopover>` | above + `maxWidth=240`, `maxHeight=600`, `padding=6`, `windowPadding=8`, `radius=10`, bg `--td-card`, outside border 1 px #EDEDEE / #3A3F49, shadow `0 4 20 #1F23291A` / `0 2 16 #0000007A`, `animationDuration=0`, `trigger=click` |
| `PopoverContainer.of(ctx).close/closeAll` | `usePopoverContainer()` | `{close, closeAll}` |
| `PopoverActionList` / `HoverButton` / `ActionCell` / `PopoverActionCell` | `<ActionMenu>` / `<ActionMenuItem>` | `actions`, `onSelect`, controller-only trigger, min 120 / max 460 × max 300, item row 32 (padding 6/10, height 20, icon gap 10, lineHeight 1.15), nested cell = barrier sub-popover |
| `AFBaseButton` / `AFButtonSize` | `<AFBaseButton>` + `AF_BUTTON_SIZES` | `size s|m|l|xl` → padding 4/12, 6/16, 10/16, 14/16; radius 8/8/10/16; text 14/20 w500 (xl 20/28 w500); `bg(state)`, `border(state)`, `ring(state)` (2 px outside #00B5FF80 on `:focus-visible`), `disabled`, `showFocusRing`, Enter/Space activation |
| `AFFilledTextButton` / `AFFilledButton` / `AFFilledIconTextButton` | `<AFButton variant="filled" tone="primary|destructive|ghost">` | `text` or `children`, `icon` (gap 6), `size='m'`, `disabled`, `minWidth=76` (text variants only), `align` |
| `AFOutlinedTextButton` / `AFOutlinedButton` / `AFOutlinedIconTextButton` | `<AFButton variant="outlined" tone="normal|destructive">` | as above; `iconAlign` |
| `AFGhostTextButton` / `AFGhostButton` / `AFGhostIconTextButton` | `<AFButton variant="ghost">` | icon gap 8; `justify` |
| `AFTextField` (+`AFTextFieldSize`, `AFTextFieldState`) | `<AFTextField>` + imperative ref `{setError, clearError, setObscured}` | `size='l'` (m: 6/8 r8, l: 10/8 r10), `hint`, `initialText`, `validator(value)→[hasError,msg]`, `obscure`, `suffix(isObscured)`, `readOnly`, `maxLength`, `autoComplete`, `autoFocus`, `onChange`, `onSubmit`; error caption 12/18 with 4 px gap |
| `AFMenu` / `AFMenuSection` / `AFMenuItem` / `AFTextMenuItem` | `<AFMenu width bg>` / `<AFMenuSection title padding maxHeight>` / `<AFMenuItem leading title subtitle trailing selected showSelectedBg onClick padding>` / `<AFTextMenuItem>` | menu radius 12, border 1, shadow md, padding 8; item padding 6/8, radius 8, selected `--af-fill-theme-select`, hover `--af-fill-content-hover`; title 14/20, subtitle 12/18 secondary; section title 12/18 w500 tertiary |
| `AFModal` / `AFModalHeader` / `AFModalBody` / `AFModalFooter` / `AFModalDimension` | `<AFModal maxWidth={400|560|720}>` + `<AFModalHeader leading trailing>` / `<AFModalBody>` / `<AFModalFooter leading trailing>` | outer padding 16, radius 16, bg `--af-surface-primary`, shadow md; header pt16 px20, 16/22 w700, gap 6; body 12/20; footer pb16 px20, gap 12, spacer; barrier #00000099, fade 150 ms ease-out |
| `AFPopover` / `AFPopoverController` / `AFAnchorAuto` / `AFAnchor` / `AFGlobalAnchor` | `<AFPopover open|controller anchor closeOnOutside padding decoration filter>` | default padding 12/8, bg layer01, radius 8, shadow md, no animation, auto anchor = below centre with flip; manual anchor = pinned point pair + offset; Escape closes; outside click closes only the top-most |
| `AFDropDownMenu` / `AFDropDownMenuMixin` | `<AFDropdown<T extends {label}>>` | `items`, `selected`, `onSelect`, `closeOnSelect`, `disabled`, `emptyLabel='(optional)'`, `clearIcon`, `dropdownIcon`, `selectedIcon`; trigger h32, padding 4/8, r8, border states; list max-height 300, padding 8, item 6/8 r8 |
| `AFAvatar` / `AFAvatarSize` | `<AFAvatar name url size="xs|s|m|l|xl" colorHash textColor bg>` | 16/24/32/48/64; initials text styles per D.4.9; 64-bit BigInt hash → 20 badge colour pairs; image fallback to initials |
| `AFDivider` | `<AFDivider axis thickness=1 spacing startIndent endIndent color>` | default `--af-border-primary` |
| `showDialog` + `Dialog` base | `openDialog(render, {barrierColor='#0000008A', dismissible=true})` | fade 150 ms ease-out, Escape closes when dismissible, M2 elevation-24 shadow, inset 40/24 |
| `ConfirmPopup` / `ConfirmPopupStyle` / `SpaceCancelOrConfirmButton` / `SpaceOkButton` | `<ConfirmPopup style="onlyOk|cancelAndOk">` | `title`, `description`, `onConfirm`, `onCancel`, `confirmLabel`, `confirmColor`, `confirmButton` render-prop, `children`, `closeOnAction=true`, `showClose=true`, `keyboard=true` (Escape keydown closes, Enter keyup confirms); width 440, padding 20, radius 16 inside a radius-12 dialog |
| `showConfirmDialog` / `showConfirmDeletionDialog` / `showCancelAndConfirmDialog` / `showCustomConfirmDialog` / `showCancelAndDeleteDialog` | `confirm.show()`, `confirm.deletion()`, `confirm.cancelAndConfirm()`, `confirm.custom()`, `confirm.cancelAndDelete()` (Promise-based) | defaults per D.5.3 |
| `showSimpleAFDialog` | `showSimpleAFDialog({title, content, destructive, primary:[label,fn], secondary?, dismissible})` | AFModal S, min body height 108 |
| `showAFTextFieldDialog` / `AFTextFieldDialog` | `promptText({title, initialValue, selectAll=true, maxLength, hint}) → Promise<string|null>` | Confirm disabled when the trimmed value is empty; Enter submits |
| `NavigatorAlertDialog` / `NavigatorOkCancelDialog` / `NavigatorCustomDialog` / `OkCancelButton` | `<LegacyAlertDialog>` / `<LegacyOkCancelDialog titleUpperCase=true maxWidth=500 autoDismiss>` / `<LegacyCustomDialog>` / `<OkCancelRow mode="big">` | StyledDialog shell; button row height 48, buttons 100×40 r12, gap 12, `space-around` |
| `showToastNotification` / `DesktopToast` | `toast.show({message|rich, type:'success'|'warning'|'error', showClose, onDismiss})` | bottom centre, 3 s auto-close, 600 ms fade + slide-up, max width 360, padding 12/16, r12, bg `--af-surface-inverse`, text white 14/20 max 2 lines, icon 20, close #BDBDBD |
| `showSnackBarMessage` / `showSnapBar` | `snackbar.show(message, {duration=4000|8000, cancelAction})` | full-width bottom bar, bg `--ms-surface-container-highest`, 14 px text max 2 lines, 250 ms slide/fade |
| `showMessageToast` / `FlowyMessageToast` | `messageToast(message)` | bottom 50 / left 24 / right 24, r4, bg `--ms-surface`, padding 6/12, 16 px w500 max 3 lines, 3 s, fade 350 ms, queued |

---

