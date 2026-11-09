# HyperTask UI — design specification

Owner: the design lead (this document is the source of truth). Implementers execute it; they do
not invent visuals. If something is not covered, pick the closest existing pattern in this
document and list the decision in your report.

App: Electron + React 19 renderer in `frontend/appflowy_electron/src/renderer`. The Rust core,
stores, events and behaviour stay exactly as they are; this redesign changes markup and styling.

---

## 1. Stack and file rules

| Layer | Location | Rule |
| --- | --- | --- |
| Tailwind v4 + tokens | `src/renderer/styles/app.css` | Design-lead only. |
| shadcn/ui (base-nova, Base UI primitives) | `src/renderer/components/ui/*` | Vendor code. **Never edit.** Customise with `className`. |
| ReUI | `src/renderer/components/reui/*` (`badge`, `alert`, `frame`, `color-picker`) | Vendor code. **Never edit.** |
| App building blocks | `src/renderer/components/app/*` | Design-lead only. Use them; do not edit them. If you need a variant, build it locally in your feature folder and say so in your report. |
| Icons | `lucide-react` | All chrome icons. See §5. |
| Class merge | `import { cn } from '@/lib/utils'` | |

Do **not** add npm dependencies and do not run the shadcn CLI.

Available shadcn components (import from `@/components/ui/<name>`): alert-dialog, avatar,
breadcrumb, button, button-group, card, checkbox, collapsible, combobox, command, context-menu,
dialog, dropdown-menu, empty, field, hover-card, input, input-group, item, kbd, label, popover,
progress, radio-group, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner,
spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip.
ReUI (`@/components/reui/<name>`): `Badge` (variants: default, secondary, outline, info, success,
warning, destructive, invert, `*-light`, `*-outline`; sizes xs/sm/default/lg), `Alert`, `Frame`,
`ColorPicker`.

These are Base UI components: composition uses the `render` prop, not `asChild`.
`<PopoverTrigger render={<Button variant="ghost" size="icon-sm" />}>…</PopoverTrigger>`.
Read the component file before using it.

App building blocks (`@/components/app/*`):

- `window-controls.tsx`: `TitleBar` (40px draggable strip with Windows caption buttons),
  `WindowControls`, `isWindowsChrome`.
- `nav.tsx`: `NavItem`, `NavIconButton`, `NavCount`, `NavSectionHeader`, `TreeDisclosure`,
  `TreeRowActions`, `treeRowClass`, `treeIndent(depth)`, `navItemClass`.
- `menu-row.tsx`: `floatingSurfaceClass`, `MenuRow`, `menuRowClass`, `MenuSeparator`,
  `MenuLabel`, `MenuFootnote`.
- `settings-layout.tsx`: `SettingsPageHeader`, `SettingsSection`, `SettingsGroup`, `SettingsRow`.
- `shortcut.tsx`: `ShortcutKeys` (`keys="Ctrl+P"`).

## 2. Hard rules for every change

1. **Behaviour is frozen.** Keep every store call, event, handler, keyboard shortcut,
   drag-and-drop path, focus/blur call, `data-*` attribute and `aria-*` attribute that code or
   tests read. Keep exported component names and their props (other files import them). Keep
   i18n keys (`tr(...)`) and hard-coded English strings exactly.
2. **No visual inline styles.** `style={{…}}` is allowed only for values computed at runtime:
   positions, measured/resizable widths and heights, tree indentation, transforms driven by
   state, and user-data colours (workspace/space icon colours, cover colours, avatar colours).
   Everything else is Tailwind classes.
3. **Tokens only.** Use `bg-background`, `text-foreground`, `text-muted-foreground`,
   `bg-muted`, `bg-accent`, `bg-popover`, `bg-card`, `border-border`, `ring-ring`,
   `bg-primary`/`text-primary-foreground`, `text-destructive`, `bg-destructive/10`,
   `text-success`, `text-warning`, `text-info`, and the `sidebar-*` family. **No hex/rgb
   colours and no legacy variables** (`--cs-*`, `--th-*`, `--af-*`, `--afx-*`, `--flowy-*`,
   `--popover-*`, `--tooltip-*`) in new markup. Exceptions: user-data colours (rule 2) and the
   favourite star (`fill-amber-400 text-amber-400`).
4. **Type scale only:** `text-2xs` 11px, `text-xs` 12, `text-sm` 14, `text-base` 16, `text-lg`
   18, `text-xl` 20, `text-2xl` 24. Never `text-[13px]`-style arbitrary sizes (they ignore the
   user's text-scale setting). Weights: normal for body, `font-medium` for labels/active items/
   buttons, `font-semibold` for titles. No `font-bold` except numerals in count pills.
5. **Spacing** on the 4px grid (`gap-1`, `gap-1.5`, `gap-2`, `gap-3`, `p-1`, `p-2`, `p-4`, …).
6. **Radius:** `rounded-md` rows/menu items/small controls, `rounded-lg` buttons/inputs/menus/
   cards/popovers, `rounded-xl` dialogs and the main content panel, `rounded-full` user avatars
   and count pills.
7. **Elevation:** floating surfaces use `floatingSurfaceClass`
   (`rounded-lg bg-popover shadow-md ring-1 ring-foreground/10`); dialogs `rounded-xl bg-popover
   shadow-xl ring-1 ring-foreground/10`; no other shadows except where this document says so.
8. **Motion:** hover = `transition-colors`; overlays animate with
   `animate-in fade-in-0 zoom-in-95 duration-100` (already inside shadcn components).
9. **Interactive elements** are `<button type="button">` (or shadcn `Button`), never clickable
   `<div>`s, unless the element must stay a `div` for drag-and-drop or layout reasons. Keep
   keyboard handlers that exist today.
10. **Delete dead code** you replace (local helper components, unused imports). Do not delete
    files outside your ownership list. If a legacy CSS file in your area becomes unused, delete
    the file and its import.
11. Remove `FlowyText`, `VSpace`, `HSpace`, `FlowyHover`, `FlowyButton`, `FlowyIconButton`,
    `FlowySvg` (for chrome icons), `MaterialIcon` from the files you own: replace them with
    plain elements + Tailwind, shadcn components, app blocks and lucide icons. `FlowySvg` stays
    only for user-content icons (§5.2).

### Verification (each task)

- `npm run typecheck` (in `frontend/appflowy_electron`) must pass for your files. Other agents
  edit other files at the same time: ignore errors in files you do not own.
- `npx vitest run <your folders>` for tests next to your files. If a test asserts on removed
  inline styles, change the assertion to the behaviour it was protecting; never delete coverage.
- Do not run `npm run build`, `npm run dev`, the web harness or screenshots; the design lead
  reviews visually.
- Do not commit. Report: files changed, components used, any spec item you could not follow and
  why, any behaviour you were unsure about.

---

## 3. Tokens (defined in `styles/app.css`)

- Neutrals: zinc. Light window background `bg-sidebar` (#f6f6f7-ish), content `bg-background`
  (white). Dark: window `bg-sidebar` (zinc-950), content `bg-background` (slightly lighter).
- `primary` is monochrome (near-black / near-white) for the Default colour scheme; other
  schemes recolour `primary`, `ring`, `sidebar-primary`. Never hard-code an accent colour.
- Status: `destructive`, `success`, `warning`, `info` (solid fills use `text-white`; tinted
  surfaces use `bg-<status>/10 text-<status>-foreground`, which is how ReUI badges/alerts work).
- Fonts: `font-sans` (Geist, or the user's workspace font), `font-mono` (Geist Mono).
- Text scale: the `text-*` sizes follow the Appearance text-scale setting automatically.

## 4. Component recipes

| Need | Use |
| --- | --- |
| Primary action | `<Button>` (default, h-8). Large CTA on auth screens: `size="lg" className="h-10 w-full"`. |
| Secondary action | `<Button variant="outline">` |
| Quiet action / toolbar | `<Button variant="ghost">`, icon-only `size="icon-sm"` (28px) or `icon-xs` (24px) |
| Destructive | `<Button variant="destructive">` (tinted). Final confirm in a dialog: `<Button className="bg-destructive text-white hover:bg-destructive/90">` |
| Text input | `<Input>` (h-8). With icon/addon: `InputGroup` + `InputGroupAddon` + `InputGroupInput`. Label + help + error: `Field`, `FieldLabel`, `FieldDescription`, `FieldError`. |
| Toggle setting | `<Switch>` |
| Pick one of few | `RadioGroup` or `ToggleGroup` (segmented) |
| Pick one of many | `Select` (`SelectTrigger size="sm"` inside settings rows, min-w-40) |
| Searchable pick | `Combobox` |
| Simple trigger → actions menu | `DropdownMenu` (`DropdownMenuContent className="w-56"`) |
| Menu rendered by the app's own anchored popover | `MenuRow` / `MenuSeparator` / `MenuLabel` inside `floatingSurfaceClass` + `p-1` |
| Right-click menu | `ContextMenu` |
| Popover panel | `Popover` (`PopoverContent className="w-80 p-0"` when it has its own layout) |
| Tooltip | `Tooltip` + `TooltipTrigger render={…}` + `TooltipContent`; with shortcut: `<TooltipContent>Search <ShortcutKeys keys="Ctrl+P" /></TooltipContent>` |
| Modal | `Dialog` / `AlertDialog` (or the app's `showDialog` host, restyled in task P) |
| Toast | `toast()` from `sonner` via the app's `showToast` (restyled in task P) |
| Status pill | ReUI `Badge` (`variant="secondary"` neutral, `success-light`, `warning-light`, `destructive-light`, `info-light`, `outline`) `size="sm"` |
| Inline notice | ReUI `Alert` |
| Empty / error state | `Empty`, `EmptyHeader`, `EmptyMedia variant="icon"`, `EmptyTitle`, `EmptyDescription`, `EmptyContent` |
| Data table | `Table` family; header cells `text-xs font-medium text-muted-foreground` |
| List row with media | `Item` family (`variant="outline"` for cards, default for plain rows) |
| Keyboard keys | `ShortcutKeys` or `Kbd` |
| Loading | `Spinner` (`size-4`), `Skeleton` for placeholder rows |
| Avatar | `Avatar` + `AvatarFallback` (initials, `text-xs font-medium`); user = `rounded-full`, workspace = `rounded-md` |

## 5. Icons

### 5.1 Chrome icons → lucide

`size-4` in rows, buttons and menus; `size-3.5` in tree-row hover actions; `size-5` in empty
states. Default stroke. Colour `text-muted-foreground` for leading icons in menus/rows unless
active. Mapping (Flowy name → lucide component):

| Flowy | lucide | Flowy | lucide |
| --- | --- | --- | --- |
| search_s, magnifier_s, search_icon_m, m_home_search_icon_m | `Search` | settings_s, settings_page_* (generic) | `Settings` |
| new_app_m (New page) | `SquarePen` | add_s, view_item_add_s, space_add_s, add_workspace_s | `Plus` |
| three_dots_s/m, workspace_three_dots_s | `MoreHorizontal` | close_s/m, m_close_m, toast_close_s, upgrade_close_s, m_app_bar_close_s, search_clear_m | `X` |
| hide_menu_s / show_menu_s, double_back_arrow_m | `PanelLeftClose` / `PanelLeftOpen` | view_item_expand_s / unexpand_s, keyboard_arrow_right_s | `ChevronRight` (rotate when open) |
| workspace_drop_down_menu_show_s / hide_s, drop_menu_hide_m, keyboard_arrow_down_s | `ChevronDown` / `ChevronsUpDown` (switchers) | arrow_back_m, keyboard_arrow_left_s | `ArrowLeft` / `ChevronLeft` |
| delete_s, trash_s, icon_delete_s | `Trash2` | restore_s | `RotateCcw` |
| duplicate_s, copy_s, share_tab_copy_s | `Copy` | rename_s, view_item_rename_s, edit_s, toolbar_link_edit_m | `PencilLine` |
| move_to_s | `FolderInput` | view_item_open_in_new_tab_s, search_open_tab_m | `SquareArrowOutUpRight` |
| favorite_s / unfavorite_s / favorited_s / star_s | `Star` (filled amber when favourited) | favorite_pin_s / favorite_section_pin_s / unpin | `Pin` / `PinOff` |
| notification_s, settings_page_bell_m | `Bell` | notification_markasread_s, m_notification_mark_as_read_s | `CheckCheck` |
| notification_archive_s, archive_m, m_notification_archived_s | `Archive` | notification_unarchive_s | `ArchiveRestore` |
| m_notification_reminder_s | `AlarmClock` | notification_icon_at_s | `AtSign` |
| lock_page_s / lock_page_fill_s, space_lock_s, notification_lock_s | `Lock` | unlock_page_s | `LockOpen` |
| information_s | `Info` | something_wrong_warning_m, toast_warning_filled_s | `TriangleAlert` |
| check_s, check_filled_s, published_checkmark_s, toast_checked_filled_s, workspace_selected_s | `Check` / `CircleCheck` | toast_error_filled_s | `CircleX` |
| uncheck_s | `Circle` | help_center_s, help_and_documentation_s | `CircleHelp` |
| share_publish_s | `Globe` | share_tab_icon_s, m_toolbar_link_m | `Link` |
| export_html_s | `FileCode` | export_markdown_s | `FileText` (label says Markdown) |
| icon_import_s | `Import` | icon_template_s | `LayoutTemplate` |
| folder_m | `Folder` | ethernet_m, settings_page_cloud_m | `Server` / `Cloud` |
| logout_s, workspace_logout_s | `LogOut` | leave_workspace_s | `DoorOpen` |
| anonymous_mode_m | `VenetianMask` | shared_with_me_m, shared_section_icon_m | `Users` |
| private_section_icon_m | `Lock` | public_section_icon_m | `Globe` |
| m_aa_color_s / text_s (font size) | `Type` | full_view_s | `Maximize2` |
| collapse_all_page_s | `ChevronsDownUp` | hide_s / show_s | `EyeOff` / `Eye` |
| database_layout_s, icon_grid_s | `Table2` | icon_board_s, board_s | `SquareKanban` |
| icon_calendar_s | `CalendarDays` | icon_document_s | `FileText` |
| chat_ai_page_s | `MessageSquareText` | icon_shuffle_s | `Shuffle` |
| space_manage_s | `SlidersHorizontal` | space_permission_public_s / private_s | `Globe` / `Lock` |
| password_close_m (eye toggle) | `Eye` / `EyeOff` | keyboard_s, settings_page_keyboard_m | `Keyboard` |
| share_feedback_s, message_support_s | `MessageCircle` | debug_s | `Bug` |
| title_bar_divider_s | (drop; use `BreadcrumbSeparator`) | change_icon_s | `SmilePlus` |

Settings pages: account `UserRound`, workspace `LayoutDashboard`, members `Users`, manage data
`Database`, notifications `Bell`, storage & server `Server`, certificates `ShieldCheck`,
shortcuts `Keyboard`, AI `Sparkles`, sites `Globe`, plan `Gem`, billing `CreditCard`, feature
flags `Flag`.

Jira entry: `SquareCheckBig`. Templates: `LayoutTemplate`. Trash: `Trash2`. Inbox/notifications:
`Bell`.

### 5.2 Content icons stay

Icons that are user data (page emoji, icon-picker icons, uploaded images, space icons) keep
their current renderers (`ViewIcon`, `RawEmojiIcon`, `SpaceIcon`, `FlowySvg` for icon-set SVGs).
Default layout icons for pages without a custom icon use lucide: Document `FileText`, Grid
`Table2`, Board `SquareKanban`, Calendar `CalendarDays`, Chat `MessageSquareText`, all
`size-4 text-sidebar-foreground/70` in the sidebar and `text-muted-foreground` elsewhere.

---

## 6. Screens

### 6.1 Shell (home screen) — task SHELL

```
┌ window bg-sidebar ─────────────────────────────────────────────────────────────┐
│ sidebar (resizable, transparent) │ TitleBar h-10: [open-sidebar?][tabs…]  – □ ✕ │
│                                  │ ┌ content panel ──────────────────────────┐ │
│                                  │ │ header h-12: breadcrumb … Share ☆ ⋯     │ │
│                                  │ │                                         │ │
│                                  │ │ page body                               │ │
│                                  │ └─────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Root (`DesktopHomeScreen` → `HomeBody`): `relative h-full overflow-hidden bg-sidebar
  text-foreground`. Keep the existing absolute positioning/transition math for the sidebar and
  the main column (left offset, menu width, translate); only the visuals change.
- Loading state: centred `Spinner className="size-5 text-muted-foreground"`.
- Main column (`HomeStack`): `flex h-full flex-col`.
  - Row 1: `TitleBar` from `@/components/app/window-controls` replaces `WindowTitleBar`.
    Children, left to right: the open-sidebar button (only while the sidebar is hidden:
    `Button variant="ghost" size="icon-sm"` with `PanelLeftOpen`, tooltip "Open sidebar" +
    `ShortcutKeys` Ctrl+\ (⌘+. on mac); keep the mousedown handler), then the tab strip.
    Padding `pl-2` when the sidebar is visible, `pl-1.5` otherwise.
  - Row 2: the content panel `relative mr-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden
    rounded-xl border border-border/80 bg-background shadow-xs`; add `ml-2` while the sidebar is
    hidden (today's `menuSpacing` decides). The tab pages render inside it.
- Tabs (`TabsManager`, `FlowyTab`): rendered inside the title bar, only when there is more than
  one tab (keep today's rule). Strip `flex h-10 min-w-0 items-center gap-1`. Tab: `group/tab
  flex h-7 min-w-24 max-w-52 flex-1 items-center gap-1.5 rounded-md px-2 text-xs
  text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground`;
  current tab: `bg-background text-foreground shadow-xs ring-1 ring-border`; pinned tab: icon
  only, `w-9 flex-none justify-center`. Contents: view icon (`size-4`), title `truncate`,
  close `X` button (`size-4 rounded-sm opacity-0 group-hover/tab:opacity-100 hover:bg-accent`,
  hidden for pinned). Selection stays on mouse-down. The tab menu (`TabMenu`) uses
  `MenuRow`/`MenuSeparator` in a `w-48` floating surface; disabled rows keep their tooltips.
- Page header (`HomeTopBar`, `FlowyNavigation`, `ViewTitleBar`, `ViewTitleBarWithRow`,
  `TrashBreadcrumb`, `SectionChip`, `LockPageStatus`, plugin bar items in
  `plugins/registry.tsx`): `flex h-12 shrink-0 items-center gap-2 px-3`.
  - Left: breadcrumb with shadcn `Breadcrumb`, `BreadcrumbList className="flex-nowrap gap-0.5
    text-sm"`. Each ancestor is a `Button variant="ghost" size="sm"` (`h-7 max-w-48 gap-1.5 px-1.5
    font-normal text-muted-foreground hover:text-foreground`) holding icon (`size-4`) + name
    (`truncate`). Current page: same button with `text-foreground font-medium`. Separators:
    `BreadcrumbSeparator` (ChevronRight `size-3.5 text-muted-foreground/60`). Overflowed middle
    items: `BreadcrumbEllipsis` in a `DropdownMenu` if the code already collapses; otherwise keep
    all. Section chip (Private/Public/Shared): ReUI `Badge variant="secondary" size="sm"` with
    lucide icon. Lock status: `Badge variant="outline" size="sm"` with `Lock` + text; clicking keeps
    its current handler.
  - Right: `ml-auto flex items-center gap-1`: Share (`Button size="sm"`, text only), favourite
    (`Button variant="ghost" size="icon-sm"`, `Star`, `fill-amber-400 text-amber-400` when
    favourited, tooltip), more (`Button variant="ghost" size="icon-sm"`, `MoreHorizontal`).
    Plugin right-bar items (document/database/chat) follow the same button recipes.
- More menu (`MoreViewActions`): `w-60 p-1` floating surface with `MenuRow`s. Font size row:
  `MenuRow` with `Type` icon and a trailing stepper (`ButtonGroup` of two `Button
  variant="outline" size="icon-xs"` with `Minus`/`Plus` around the value `text-xs tabular-nums
  w-8 text-center`). Lock page row: `MenuRow` with `Lock` and a trailing `Switch size="sm"`.
  Duplicate `Copy`, Move to `FolderInput`, Delete `Trash2` destructive. Footer `MenuSeparator` +
  `MenuFootnote` ("Created: …").
- Secondary view (`SecondaryView`, side panel): left border `border-l`, header `h-12 px-3` with
  ghost icon buttons (`Maximize2` open in full, `X` close); resizer = 6px hit area with a 1px
  line `bg-border` that turns `bg-ring` on hover/drag, `cursor-col-resize`.
- Sidebar resizer (`SidebarResizer`): 8px wide hit area straddling the sidebar's right edge,
  `cursor-col-resize`; on hover/drag a 2px rounded line `bg-ring/60` appears centred. No line at
  rest.
- Question bubble (`QuestionBubble`): `Button variant="outline" size="icon-sm"
  className="rounded-full bg-background shadow-sm"` with `CircleHelp`, positioned bottom-right
  of the content panel (`bottom-4 right-4` relative to the panel; keep it absolutely positioned
  as today if moving it is not trivial). Its menu: `w-56` surface of `MenuRow`s with lucide icons.
- Placeholder pages (`PlaceholderPage`): `Empty` centred in the body: `EmptyMedia
  variant="icon"` with the page icon (emoji at `text-2xl`, or the lucide layout icon),
  `EmptyTitle` = page name, `EmptyDescription` = the placeholder line (text unchanged).
  `BlankPage`: empty body. `LocalToolPlaceholder`: same `Empty` recipe.
- Document banner (`DocumentBanner`, deleted page): full-width bar `flex items-center
  justify-center gap-3 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive-foreground`
  with `Button size="sm" variant="outline"` (restore) and `Button size="sm"
  className="bg-destructive text-white hover:bg-destructive/90"` (delete permanently).
- Trash page (`TrashPage`): body `mx-auto flex h-full w-full max-w-5xl flex-col px-8 py-6`.
  Top bar: `h-10 flex items-center` title `text-lg font-semibold tracking-tight` + right
  `Button variant="outline" size="sm"` (RotateCcw, "Restore all") and `Button variant="destructive"
  size="sm"` (Trash2, "Delete all"). Then `Table`: columns name (icon + `truncate`), last edited,
  created (`text-muted-foreground tabular-nums`), actions (`Button variant="ghost"
  size="icon-sm"` RotateCcw / Trash2 with tooltips, visible on row hover:
  `opacity-0 group-hover/row:opacity-100`). Empty: `Empty` with `Trash2`.

### 6.2 Sidebar — tasks SIDEBAR-A and SIDEBAR-B

Container (`SidebarBody`): `group/sidebar flex h-full flex-col px-2 text-sidebar-foreground`,
transparent background (the window is `bg-sidebar`), no right border.

Top → bottom:

1. **Brand row** (`SidebarTopMenu`): `drag-region flex h-10 shrink-0 items-center px-1.5`.
   `HyperLogo size={18} wordmark` left. Right: collapse `NavIconButton` (`PanelLeftClose`) with
   `opacity-0 group-hover/sidebar:opacity-100` and tooltip "Close sidebar" + shortcut; the
   button is `no-drag`.
2. **Account row** (`SidebarUser` / `SidebarWorkspace` + `UserSettingButton` +
   `NotificationButton`): `flex h-10 shrink-0 items-center gap-1`.
   - Switcher button: `flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5
     transition-colors hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent`. Avatar
     `size-6` (`rounded-md` workspace icon/emoji/initials on its colour; local user: user
     avatar `rounded-full`), name `truncate text-sm font-semibold text-sidebar-accent-foreground`,
     then (collab only) `ChevronsUpDown size-3.5 text-sidebar-foreground/50`.
   - Settings: `NavIconButton` `Settings` + tooltip "Settings" `Ctrl+,`.
   - Notifications: `NavIconButton` `Bell` with a red dot: `NavCount` absolutely positioned at
     `-top-0.5 -right-0.5` (`h-4 min-w-4 text-2xs`) when unread > 0. Respect the "show
     notifications icon" setting exactly as today.
3. **Primary nav** `flex flex-col gap-px py-1`: `NavItem` Search (`Search`, trailing
   `ShortcutKeys` Ctrl+P / ⌘+P), New page (`SquarePen`, trailing `ShortcutKeys` Ctrl+N; hidden
   for guests as today), Jira (`SquareCheckBig`), Templates (`LayoutTemplate`; moved here from
   the footer). Active state (`active`) when that plugin is the current tab, if the code can tell
   cheaply; otherwise none.
4. **Sections scroller**: `-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2`; a hairline
   `border-t border-sidebar-border` appears at its top only while scrolled (today's `scrolled`
   flag). Sections stack with `mt-3` between them (first one `mt-1`).
   - Section header (Favorites, Shared, Private, Public/Personal, Space header in folder mode):
     `NavSectionHeader` with label, collapse state, and actions (`NavIconButton`s: `Plus` add,
     `MoreHorizontal` more). Section list `mt-0.5 flex flex-col gap-px`.
   - Space header (collab spaces, `SidebarSpaceHeader`, `CurrentSpace`): `flex h-8 items-center
     gap-2 rounded-md px-1.5 hover:bg-sidebar-accent`; `SpaceIcon` 20px (`rounded-md`), name
     `text-sm font-medium truncate`, `ChevronDown size-3.5 text-sidebar-foreground/50`; hover
     actions as section header.
   - Page tree rows (`ViewItem` → `SingleInnerViewItem`): one `div` with `treeRowClass`,
     `data-selected`, `style={{ paddingLeft: treeIndent(level) }}` (replaces today's indent
     math, keep the level value), children: `TreeDisclosure` (expanded/hasChildren/toggle),
     icon slot `flex size-5 shrink-0 items-center justify-center text-base` (emoji/custom icon,
     or lucide layout icon per §5.2), name `min-w-0 flex-1 truncate`, then `TreeRowActions` with
     `NavIconButton`s `MoreHorizontal` (more menu) and `Plus` (add child). Rename-in-place uses
     an `Input className="h-6 px-1.5 text-sm"`. Drag-and-drop: keep all logic; drop-into
     highlight via `data-drop="into"` on the row; insertion line: absolutely positioned
     `h-0.5 rounded-full bg-sidebar-primary` at the row's top/bottom (left = the row's indent).
     Locked page: `Lock size-3 text-sidebar-foreground/50` after the name.
   - Empty section hint: `px-2 py-1 text-xs text-sidebar-foreground/50`.
   - Favorites pinned/recent sub-structure: same rows; the favourites "more" menu is a
     `w-64` surface with `MenuLabel`s for groups.
5. **Footer** (`SidebarFooter`): `shrink-0 border-t border-sidebar-border py-2`: `NavItem` Trash
   (`Trash2`). (Templates moved up.)

Menus opened from the sidebar (all `floatingSurfaceClass p-1`, rows `MenuRow`):
- Page more menu (`ViewMoreActionPopover`): `w-56`. Groups: Rename `PencilLine`, Change icon
  `SmilePlus`, Open in new tab `SquareArrowOutUpRight`, Add to/Remove from favourites `Star`,
  Duplicate `Copy`, Move to `FolderInput` (submenu chevron), Lock `Lock` …; `MenuSeparator`
  between groups as today; Delete `Trash2` destructive last.
- Add menu (`ViewAddButton`): `w-52`: Document, Grid, Board, Calendar, AI Chat, separator,
  Import — icons per §5.2/§5.1.
- Move-to menu (`view/MovePageMenu`): `w-72 p-0`: search `InputGroup` at top (`border-b`,
  borderless input `h-9`), then the tree list `max-h-80 overflow-y-auto p-1` with tree rows.
- Rename popover (`view/RenameViewPopover`): `w-72 p-1.5` with `InputGroup`: emoji/icon button
  addon + input.
- Icon/emoji picker (`icon-picker/IconEmojiPicker`): `w-[22rem] p-0`; header `Tabs` with
  `<TabsList variant="line" className="h-9 w-full justify-start rounded-none border-b px-2">`
  for Emoji / Icons; search row `InputGroup` with `Search` + `Button variant="ghost"
  size="icon-sm"` shuffle (`Shuffle`) + remove; grid cells `size-8 rounded-md text-xl
  hover:bg-accent` (`grid grid-cols-9 gap-0.5 p-2`), category labels `MenuLabel` sticky with
  `bg-popover`. Keep progressive rendering.
- Import panel (`import/ImportPanel`): dialog body with an `Item variant="outline"` per source
  (`ItemMedia variant="icon"` + title + description), `grid gap-2`.
- Workspace menu (collab, `WorkspacesMenu`): `w-72 p-1`. `MenuLabel` "Workspaces" (existing
  text). Workspace rows: `Item size="sm"` look — avatar `size-8 rounded-md`, name `text-sm
  font-medium truncate`, member count `text-xs text-muted-foreground`, trailing `Check` when
  current, `MoreHorizontal` NavIconButton on hover; `GuestTag` = ReUI `Badge
  variant="secondary" size="xs"`. Separator, then `MenuRow`s Create workspace (`Plus`), Import
  (`Import`), separator, Log out (`LogOut`). Per-workspace more menu: `w-48` MenuRows (Rename,
  Change icon, Leave `DoorOpen` destructive, Delete `Trash2` destructive).
- Notification panel (`NotificationPanel`) — owned by SIDEBAR-A: a full-height panel docked to
  the sidebar's right edge (keep today's positioning props): `flex h-full w-[22rem] flex-col
  border-r bg-background shadow-lg`. Header `flex h-12 items-center gap-2 px-4`: title
  `text-sm font-semibold`, right `Button variant="ghost" size="icon-sm"` actions (`CheckCheck`
  mark all read, `Archive` archive all, `X` close) with tooltips. Tabs: shadcn `Tabs` with
  `<TabsList variant="line" className="w-full justify-start rounded-none border-b px-2">` under the header. Items: `flex gap-3 border-b px-4 py-3
  hover:bg-muted/50` with icon tile (`size-8 rounded-md bg-muted` + lucide `AlarmClock`/
  `AtSign`), content (title `text-sm font-medium`, body `text-xs text-muted-foreground
  line-clamp-2`, time `text-2xs text-muted-foreground`), unread dot `size-2 rounded-full
  bg-info` at the right; hover actions (mark read / archive) ghost `icon-xs`. Empty: `Empty`
  with `Bell` icon and today's strings.

Ownership:
- SIDEBAR-A: `features/sidebar/Sidebar.tsx`, `SidebarButtons.tsx`, `components.tsx`,
  `header/*`, `workspace/*`, `notifications/*`, `sidebar.css` (delete once unused — coordinate:
  SIDEBAR-B removes its class usages; if classes remain in use by B's files at the end, keep
  only those rules).
- SIDEBAR-B: `features/sidebar/folder/*`, `favorites/*`, `space/*`, `shared-section/*`,
  `view/*`, `icon-picker/*`, `import/*`, `stores/*` (read-only unless a test needs it).
- `features/sidebar/components.tsx` exports (`SbIconButton`, `MenuItem`, `MenuDivider`,
  `ActionListPopover`, `FlowyTextField`, `hintTooltip`, `usePopoverController`, `showLoading`)
  keep their names and props: SIDEBAR-A restyles them to the recipes above (`SbIconButton` →
  `NavIconButton` look, `MenuItem` → `MenuRow`, `MenuDivider` → `MenuSeparator`,
  `ActionListPopover` surface → `floatingSurfaceClass p-1`). SIDEBAR-B may keep using them.

### 6.3 Command palette — task SEARCH

Files: `features/search/*` (`CommandPalette.tsx`, `command-palette.css` → delete when unused).
Keep the store, key handling, preview logic and AI entry points.

- Overlay: `fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] animate-in fade-in-0`.
- Panel: `fixed top-[12vh] left-1/2 z-50 flex max-h-[min(36rem,76vh)]
  w-[min(40rem,calc(100vw-3rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl
  bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 animate-in fade-in-0
  zoom-in-95 duration-100`. When the preview pane shows, widen to `w-[min(56rem,calc(100vw-3rem))]`.
- Search row: `flex h-12 shrink-0 items-center gap-2.5 border-b px-4`: `Search size-4
  text-muted-foreground`, input `h-full flex-1 bg-transparent text-sm outline-none
  placeholder:text-muted-foreground`, clear `Button variant="ghost" size="icon-xs"` (`X`) when
  non-empty, then `Kbd` "Esc".
- Body: `flex min-h-0 flex-1`. List column `min-w-0 flex-1 overflow-y-auto p-2`.
  - Section title: `px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground`.
  - Result row: `group/result flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left
    text-sm` with `bg-accent text-accent-foreground` when selected (keyboard) or hovered. Icon
    `size-4` (view icon). Title `truncate`, highlight matches with `<mark className="rounded-sm
    bg-transparent font-semibold text-foreground underline decoration-primary/40
    underline-offset-2">`. Path (`OnelinePath`) `ml-auto max-w-[45%] truncate text-xs
    text-muted-foreground`. Open-in-new-tab affordance: `Button variant="ghost" size="icon-xs"`
    (`SquareArrowOutUpRight`) visible on hover/selection.
  - Preview pane (`PagePreview`): `hidden w-72 shrink-0 flex-col gap-3 border-l bg-muted/30 p-4
    md:flex`: icon `text-3xl`, title `text-base font-semibold`, path breadcrumb `text-xs
    text-muted-foreground`, times (`PreviewTime`) as `dl` rows `text-xs`.
  - Empty / no results (`NoSearchResultsHint`, `SomethingWentWrong`): `Empty` compact
    (`py-10`): `SearchX` / `TriangleAlert` icon, existing strings.
- Footer: `flex h-9 shrink-0 items-center gap-4 border-t bg-muted/30 px-3 text-xs
  text-muted-foreground`: `ShortcutKeys keys="↑"` `ShortcutKeys keys="↓"` "Navigate",
  `Kbd` ↵ "Open", `Kbd` Esc "Close". (Plain English labels are fine here; they are new UI.)

### 6.4 Page header popovers — task HEADER

Files: `features/view-header/*` except `ViewTitleBar.tsx`, `ViewTitleBarWithRow.tsx`,
`HomeTopBar.tsx`, `MoreViewActions.tsx`, `FavoriteButton.tsx` (those belong to SHELL).
So HEADER owns: `share/*`, `MovePageMenu.tsx`, `RenameViewPopover.tsx`, `IconPicker.tsx`,
`ViewIcon.tsx`, `FlowyTextField.tsx`, `view-scope.tsx` (logic only), `page-access-level-store.ts`
(logic only).

- Share popover (`ShareButton` → `ShareMenu`): `w-[25rem] p-0`. Tabs header with shadcn
  `Tabs`: `<TabsList variant="line" className="h-10 w-full justify-start gap-4 rounded-none border-b px-4">`; tab order and labels as today. Content `p-4`.
  - Export tab: `grid gap-2`; each option `Button variant="outline" className="h-auto w-full
    justify-start gap-3 px-3 py-2.5"` with an icon tile `flex size-8 items-center justify-center
    rounded-md bg-muted` (`FileCode` HTML, `FileText` Markdown, `Copy` clipboard) and label
    `text-sm font-medium`.
  - Share tab: description `text-sm text-muted-foreground`, link row `InputGroup` (readonly
    `InputGroupInput` with the URL, `font-mono text-xs`) + `InputGroupAddon align="inline-end"`
    with `InputGroupButton` "Copy" (`Copy` icon).
  - Publish tab: not published → description + `Button className="w-full"` (`Globe`)
    "Publish"; published → status row (ReUI `Badge variant="success-light" size="sm"` with
    `Check`), URL `InputGroup` (prefix addon = namespace, input = path, inline-end addon with
    copy button), actions `flex gap-2`: `Button variant="outline"` Unpublish, `Button` Visit
    site (`SquareArrowOutUpRight`). Database selector (`PublishDatabaseSelector`): list of
    `Checkbox` + label rows in a `rounded-lg border p-2`.
  - The primary "Share" trigger button itself is rendered by SHELL's header; HEADER keeps
    `ShareButton`'s export and only restyles the trigger to `Button size="sm"`.
- Move page menu (`view-header/MovePageMenu`): same recipe as the sidebar move menu (§6.2).
- Rename popover / icon picker / ViewIcon: same recipes as §6.2. `ViewIcon` helpers
  (`SvgString`, `EmojiText`, `RawEmojiIcon`…) keep their props; only sizing classes change.

### 6.5 Settings — tasks SETTINGS-A and SETTINGS-B

Dialog (`SettingsDialog`, SETTINGS-A):

```
┌──────────────┬─────────────────────────────────────────────── ✕ ┐
│ Settings     │  Page title                                       │
│ ▸ Account    │  Description                                      │
│   Workspace  │                                                   │
│   …          │  SECTION TITLE                                    │
│              │  ┌ group ───────────────────────────────────────┐ │
│              │  │ Label                               [control]│ │
│              │  │ Description                                  │ │
│              │  ├──────────────────────────────────────────────┤ │
│              │  │ …                                            │ │
└──────────────┴─────────────────────────────────────────────────┘
```

- Panel: `flex h-[min(45rem,calc(100vh-5rem))] w-[min(65rem,calc(100vw-5rem))]
  overflow-hidden rounded-xl bg-background shadow-2xl ring-1 ring-foreground/10` (keep the
  host's existing size logic if it computes sizes; replace only the visuals).
- Nav: `flex w-56 shrink-0 flex-col gap-px overflow-y-auto border-r bg-sidebar p-2`. Heading
  `px-2 pt-2 pb-2 text-xs font-medium text-muted-foreground` = existing settings title string
  (`tr('settings.title')` if it exists; otherwise "Settings"). Items: `NavItem` with lucide
  icons (§5.1 list) and `active`.
- Content: `relative min-w-0 flex-1`, `ScrollArea className="h-full"`, inner `mx-auto w-full
  max-w-3xl px-10 py-8`. Close: `Button variant="ghost" size="icon-sm"` `X`, `absolute top-3
  right-3`.
- Every page: `SettingsPageHeader` + `SettingsSection`s + `SettingsGroup`s + `SettingsRow`s.
  Controls on the right of rows: `Switch`, `Select` (trigger `size="sm" className="min-w-40"`),
  `Button variant="outline" size="sm"`. Wide controls go in the row's children slot.
- Danger zone (delete account / workspace / leave): last section titled as today, group
  `border-destructive/30`, rows with `destructive` label and a `Button variant="destructive"
  size="sm"`.
- Shared widgets (`settings/shared.tsx`, `shared-widgets.tsx`, `material.tsx`) — SETTINGS-A
  restyles them with the same names/props so any page still using them matches:
  `SettingsHeader` → `SettingsPageHeader` look; `SettingsBody` → scroll body; `SettingsCategory`
  → `SettingsSection`; `SettingListTile` → `SettingsRow`; `SettingsDropdown` → `Select`;
  `SettingsRadioSelect` → `RadioGroup`; `SettingsInputField` → `Field` + `Input`;
  `SettingsAlertDialog` → `AlertDialog` visuals; `SettingsDashedDivider` → `Separator`;
  `OutlinedRoundedButton` → `Button variant="outline" size="sm"`; `MdTextField` → `Input`;
  `MdSwitch` → `Switch`; `MdCheckbox` → `Checkbox`; `MdButton` → `Button`;
  `LinearProgress` → `Progress`; `MaterialIcon.*` → lucide.

Pages:
- Account (SETTINGS-A): Profile section: group row with `Avatar size-12` + name (inline rename
  with `Input`, `PencilLine` ghost icon button) ; email row; password rows (outline buttons);
  sign in/out row. "About HyperTask" section: group row with `HyperLogo size={32}` + "HyperTask"
  `text-sm font-semibold` + version `text-xs text-muted-foreground font-mono` + up-to-date ReUI
  `Badge variant="success-light" size="sm"`; "Developed by NaveDanan" `text-xs
  text-muted-foreground`. Danger zone: delete account. Password dialogs (`PasswordDialogs`):
  shadcn `Dialog` look: title, `Field`s with `InputGroup` + eye toggle (`Eye`/`EyeOff`), footer
  with Cancel (outline) + Save.
- Workspace (SETTINGS-A, `WorkspacePage` + `appearance-controls.tsx` + `LanguageDropdown`):
  - Workspace name/icon rows (`Input`, icon button opening the picker).
  - Appearance: theme-mode cards (`AppearanceSelector`): three `button`s `flex w-36 flex-col
    gap-2 text-xs`; preview `aspect-[4/3] w-full overflow-hidden rounded-lg border-2
    border-border p-1 data-[selected=true]:border-primary` containing a mini mock (left strip +
    content blocks) drawn with divs: Light = `bg-zinc-100` strip + `bg-white` body with
    `bg-zinc-200` bars; Dark = `bg-zinc-950` strip + `bg-zinc-900` body with `bg-zinc-700` bars;
    Auto = light and dark halves side by side. (Literal zinc classes are allowed here: they
    depict modes.) Selected check: `CircleCheck` `size-4 text-primary` top-right.
  - Theme (`ThemeDropdown`): `Select` + `Button variant="outline" size="icon-sm"` (upload,
    `Upload`) + `Button variant="ghost" size="sm"` Reset (`RotateCcw`). Upload dialog: shadcn
    Dialog look with a dashed drop area `rounded-lg border-2 border-dashed p-8 text-center`.
  - Cursor / selection colour (`DocumentColorSetting`): row with a swatch button
    `size-6 rounded-md ring-1 ring-foreground/15` (style = the colour) opening a `Popover` with
    ReUI `ColorPicker`; reset ghost icon button `RotateCcw`.
  - Document width: row + full-width `Slider` in the children slot, value `text-xs
    tabular-nums text-muted-foreground`, reset ghost icon button.
  - Fonts: `Combobox` (searchable) for workspace font; previews `text-sm` in the item's font.
  - Text direction, date/time format, language: `Select`/`ToggleGroup` rows.
- Manage data (SETTINGS-B): data folder row: `Folder` icon tile + path in `rounded-md bg-muted
  px-2 py-1 font-mono text-xs` (truncate, full path in tooltip) + `Button variant="outline"
  size="sm"` change / open / reset; other actions as rows.
- Notifications (SETTINGS-B): rows with `Switch`.
- Storage & server (`SelfHostedSettingsView`, SETTINGS-B): `Field`s with `Input` (URLs in
  `font-mono text-xs`), `Button` save/test, ReUI `Alert` (`variant="info"`) for the explanatory
  note.
- Certificates (SETTINGS-B): list in a group: row = `ShieldCheck` icon tile + subject
  `text-sm font-medium` + issuer/expiry `text-xs text-muted-foreground` + `Button
  variant="ghost" size="sm"` details (`Collapsible` showing `dl` grid `text-xs font-mono`) +
  remove `Button variant="ghost" size="icon-sm"` `Trash2` (destructive hover). Add button
  `Button variant="outline" size="sm"` (`Plus`) in the section actions. Errors: ReUI `Alert
  variant="destructive"`.
- Shortcuts (SETTINGS-B): search `InputGroup` (`Search`) + Reset all `Button variant="outline"
  size="sm"`; list in a group, row = command label `text-sm` + `ShortcutKeys` on the right
  (`KeyBadge` → `Kbd`); editing state: the keys area becomes `rounded-md px-2 py-1 ring-2
  ring-ring text-xs text-muted-foreground` "Press keys…"; conflict text `text-xs
  text-destructive`; per-row reset ghost `icon-xs` `RotateCcw`.
- AI (SETTINGS-B): endpoint `Field`s, model `Select`, API key `InputGroup` with eye toggle,
  test `Button variant="outline"`, result ReUI `Alert` success/destructive.
- Members (SETTINGS-B): invite by email `InputGroup` + `Button`; invite link row with copy;
  member list `Table`: avatar `size-7` + name/email, role ReUI `Badge` (`secondary`, owner
  `info-light`), actions `DropdownMenu` trigger `Button variant="ghost" size="icon-sm"`.
- Sites (SETTINGS-B): namespace section (domain row with `Globe` tile, `font-mono` URL,
  `DropdownMenu` actions); homepage row; published pages `Table` (page with icon, published
  date `tabular-nums`, `DropdownMenu` actions: visit, copy link, settings, unpublish).
  Upgrade/upsell buttons: `Button size="sm"`.
- Feature flags (SETTINGS-B): rows with `Switch` + description.
- Self-contained settings dialogs (`showSettingsAlertDialog`, confirmations): shadcn
  `AlertDialog` visuals (title `text-base font-medium`, description `text-sm
  text-muted-foreground`, footer right-aligned: Cancel outline + confirm default/destructive).

### 6.6 Startup and sign-in — task AUTH

Files: `features/auth/*`.

- Every screen: `flex h-full flex-col bg-background`, `TitleBar` at the top (no logo in it).
  Background accent: a soft top glow
  `bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_oklch,var(--muted)_100%,transparent),transparent)]`
  on the screen root.
- Centre column: `mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6`.
  - Brand block: `HyperLogo size={40}` centred, title `text-2xl font-semibold tracking-tight
    text-center` (existing welcome text), subtitle `text-sm text-muted-foreground text-center`
    (existing helper line, e.g. "Sign in to your collaboration server").
  - Forms: `flex flex-col gap-3`; `Field` + `Input className="h-10"` (errors via `FieldError`,
    keep `AFTextField`-style handle behaviour: `syncError`/`clearError` must still work — keep
    using `AFTextField` if it carries that logic, task P restyles it); primary `Button
    size="lg" className="h-10 w-full"`; secondary `Button variant="outline" size="lg"
    className="h-10 w-full"`; links (`LinkButton`) `Button variant="link"
    className="h-auto p-0 text-sm text-muted-foreground hover:text-foreground"`.
  - Back navigation on sub-pages: `Button variant="ghost" size="sm"` with `ArrowLeft` at the
    top-left of the column.
  - Magic-link / passcode page: envelope icon tile (`Mail` in `size-12 rounded-xl bg-muted`),
    title, description with the email in `font-medium text-foreground`, passcode input
    `Input className="h-10 text-center font-mono tracking-[0.5em]"`.
- Bottom bar: `flex h-14 shrink-0 items-center justify-center gap-2`: `Button variant="ghost"
  size="sm" className="text-muted-foreground"` with `Settings` ("Settings") and
  `VenetianMask` (anonymous mode).
- Splash / launching: centred `HyperLogo size={48} wordmark` (wordmark `text-lg`), `Spinner
  className="size-4 text-muted-foreground"` 24px below (launching only).
- Skip-login (`SkipLogInScreen`): brand block; primary `Button size="lg" className="h-10
  w-full"`; data-location card `Item variant="outline"` (`ItemMedia variant="icon"` with
  `FolderOpen`, `ItemTitle`, `ItemDescription` = path in `font-mono text-xs truncate`,
  `ItemActions` with `Button variant="outline" size="sm"` "Set"). Footer `flex items-center
  justify-between px-4 py-3 text-xs text-muted-foreground`: centre text with links `font-medium
  text-foreground underline-offset-4 hover:underline`; right: language/help popover trigger
  `Button variant="ghost" size="sm"`.
- Error screens (`WorkspaceErrorScreen`, `WorkspaceFailedScreen`, `FatalScreen`): `Empty`:
  `EmptyMedia variant="icon"` with `TriangleAlert` (`bg-destructive/10 text-destructive`),
  title, description (error text in `font-mono text-xs` block `rounded-md bg-muted p-3
  text-left` when it is technical), `EmptyContent` with the existing buttons.
- `SimpleSettingsDialog`: `w-[28rem]` dialog using `SettingsGroup`/`SettingsRow` for language
  (Select), storage & server, export logs, clear cache (outline buttons).

### 6.7 Primitives — task P

Files: `src/renderer/ui/*` (`Buttons.tsx`, `Dialog.tsx`, `FlowyText.tsx`, `Inputs.tsx`,
`Popover.tsx`, `Tooltip.tsx`, `toast.tsx`, `WindowTitleBar.tsx`, `primitives.css`, `index.ts`).
Keep every export and its props/behaviour (positioning math, controllers, focus handling,
imperative handles). Restyle only:

- `Popover`/`AppFlowyPopover`/`layoutPopover`: popup surface `floatingSurfaceClass` + enter
  animation `animate-in fade-in-0 zoom-in-95 duration-100`; keep padding behaviour but default
  to `p-1` for menus when the caller passed the old default padding. Remove legacy border/shadow
  variables.
- `Dialog.tsx`: host overlay `fixed inset-0 bg-black/30 backdrop-blur-[2px] animate-in
  fade-in-0`; dialog containers (`FlowyDialog`, `MaterialDialog`, `AFModal`) use the dialog
  surface (§2 rule 7) with `animate-in fade-in-0 zoom-in-95 duration-100`;
  `showConfirmDialog`, `showConfirmDeletionDialog`, `showSimpleAFDialog`,
  `showAFTextFieldDialog`, `TextFieldDialog`: shadcn AlertDialog layout — `w-[min(26rem,calc(100vw-2rem))]
  p-4 gap-4`, title `text-base font-medium`, description `text-sm text-muted-foreground`,
  footer `-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4` with
  Cancel `Button variant="outline"` and confirm `Button` (deletion: `bg-destructive text-white
  hover:bg-destructive/90`); text field uses `Input`.
- `Tooltip.tsx`: keep the existing hover timing, wheel-dismiss, `display: contents` wrapper and
  first-child anchoring (Base UI cannot anchor to a `contents` wrapper). Restyle `TooltipBubble`
  to the shadcn tooltip look: `z-50 max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs
  text-background animate-in fade-in-0 zoom-in-95 duration-100`, no arrow, 6px gap from the
  anchor. Rich content with keys: `shortcutTooltip(label, keys)` returns `<span className="flex
  items-center gap-2">{label}<ShortcutKeys keys={keys} className="[&_kbd]:bg-background/20
  [&_kbd]:text-background" /></span>`. New code may also use shadcn `Tooltip` directly when the
  trigger is a real element (`TooltipTrigger render={<Button … />}`).
- `toast.tsx`: `showToast(...)` maps to `sonner`'s `toast` / `toast.success` / `toast.error` /
  `toast.warning` by type; `ToastHost` renders nothing (the `<Toaster>` is mounted in `App.tsx`).
- `Buttons.tsx`: `FlowyHover` → `rounded-md transition-colors hover:bg-accent` (selected →
  `bg-accent`); `FlowyButton` → `menuRowClass` look (respect `leftIcon`, `rightIcon`, `text`,
  `isSelected` → `data-highlighted`, `disable`, `onTap`; numeric margin/radius/height props
  may still set inline sizes); `FlowyIconButton` → ghost icon button (`rounded-md
  text-muted-foreground hover:bg-accent hover:text-foreground`, size from props);
  `FlowyTextButton` → ghost button; `AFButton` → render shadcn `Button` with variant mapping
  filledPrimary→default, filledDestructive / *Destructive→destructive solid
  (`bg-destructive text-white hover:bg-destructive/90`), outlined*→outline, ghost*→ghost,
  size l→`lg h-10`, m→default, s→`sm`; `ActionRow` → `MenuRow`.
- `Inputs.tsx`: `AFTextField` → shadcn `Input` visuals (`h-9` default, keep size props),
  error message `text-xs text-destructive` below, `aria-invalid` when errored; keep the
  imperative handle. `Toggle` → shadcn `Switch` (keep props). `AFAvatar` → shadcn `Avatar` +
  `AvatarFallback` with the existing colour logic as inline style.
- `FlowyText.tsx`: `FlowyText` defaults to `text-foreground` (secondary variants →
  `text-muted-foreground`), keeps explicit `fontSize` props as inline values;
  `FlowyDivider`/`AFDivider` → `Separator`; `Spinner` → shadcn `Spinner`.
- `WindowTitleBar.tsx`: thin wrapper around `TitleBar` (`leftChildren` → children, `style`
  kept for callers that pass height/background).
- `primitives.css`: delete rules that are no longer used; delete the file when empty (and its
  import in `main.tsx`).
### 6.8 Jira dashboard — tasks JIRA-DATA and JIRA-UI

Port of the Flutter feature `frontend/appflowy_flutter/lib/features/jira/**` and
`lib/features/local_tools/jira_windows_credentials.dart`, deleted in commit 8e3f9dce7. Read
them with `git show 5a5db3717:<path>`; behaviour reference: `doc/jira-integration.md`. Opened from
the sidebar "Jira" item (`localToolPlugin('jira')`), rendered inside the content panel.

Data rules (JIRA-DATA): same Jira REST v2 calls, JQL, paging, field mapping, sync/cache semantics,
conflict detection and database mirror as the Dart code. HTTP goes through
`window.appflowy.net.request` (main process, no CORS). Credentials stay compatible with the
Flutter build: `<support>/jira_credentials/<uuidv5(URL namespace, accountId)>.json` with
`{ username, protected_secret }` (DPAPI base64), written atomically via a `.tmp` file. Cached
issues and config use the same storage locations/keys as the Dart code.

Layout (JIRA-UI), page container `mx-auto flex h-full w-full max-w-6xl flex-col gap-6
overflow-y-auto px-8 py-6`:

- Header `flex items-center gap-3`: icon tile `flex size-9 items-center justify-center rounded-lg
  bg-muted` with `SquareCheckBig`; title `text-lg font-semibold tracking-tight` ("Jira · KEY" /
  "Jira"); subtitle `text-xs text-muted-foreground` (server host, last sync time when known).
  Right `ml-auto flex items-center gap-2`: `Button size="sm"` "New issue" (`Plus`); `Button
  variant="outline" size="sm"` Sync (`RefreshCw`, `animate-spin` while syncing, label "Syncing
  12/40…"); `DropdownMenu` on `Button variant="ghost" size="icon-sm"` (`MoreHorizontal`) with Full
  refresh (`RotateCw`), Update database (`Database`; "Updating database…" while running), Open
  project in Jira (`SquareArrowOutUpRight`); `Button variant="ghost" size="icon-sm"` settings
  (`Settings`). Every icon-only button has a tooltip with the Dart tooltip text.
- Banners: ReUI `Alert` — `variant="destructive"` for "Last sync failed …" with `Button
  variant="outline" size="sm"` "Open settings"; `variant="info"` for "Connect to sync" with
  `Button size="sm"` "Enter token"; a dismiss button where Dart had one.
- No configuration: `Empty` (`EmptyMedia variant="icon"` `SquareCheckBig`), "Connect a Jira
  project", the Dart description, `Button` "Connect to Jira".
- Stats: `grid grid-cols-2 gap-3 md:grid-cols-4`; tile `rounded-lg border bg-card p-4`: value
  `text-2xl font-semibold tabular-nums`, label `flex items-center gap-1.5 text-xs
  text-muted-foreground` with a `size-2 rounded-full` dot (to do `bg-muted-foreground/50`, in
  progress `bg-info`, done `bg-success`). Below: progress `flex h-2 overflow-hidden rounded-full
  bg-muted` with the three segments, and its label `text-xs text-muted-foreground`.
- Body `grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]`.
  - Issue list: toolbar `flex items-center gap-2`: `InputGroup` (`Search`) with the Dart hint,
    active filter chips (ReUI `Badge variant="secondary"` with an `X` button), `Button
    variant="link" size="sm"` "Clear filters". List `divide-y rounded-lg border`; row `group/issue
    flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50`: key `w-20 shrink-0 font-mono text-xs
    text-muted-foreground`, summary `min-w-0 flex-1 truncate text-sm`, assignee (`Avatar size-6`
    + `text-xs text-muted-foreground` name, hidden below `md`), status badge, hover actions
    `opacity-0 group-hover/issue:opacity-100` ghost `icon-xs` buttons: change status
    (`ArrowRightLeft`), edit (`PencilLine`), open in Jira (`SquareArrowOutUpRight`). Loading:
    five `Skeleton className="h-10"` rows. Empty: centred `text-sm text-muted-foreground` with
    the Dart message.
  - Side panel `flex flex-col gap-4 rounded-lg border bg-card p-4`: section titles `text-xs
    font-medium text-muted-foreground`; assignee rows (avatar `size-6`, name `truncate text-sm`,
    count `ml-auto text-xs tabular-nums text-muted-foreground`), clickable to filter as in Dart;
    status rows with status badge + count.
- Status badge (`JiraStatusBadge`): ReUI `Badge size="sm"`: done `success-light`, in progress
  `info-light`, to do `secondary`.
- Dialogs (shadcn `Dialog` visuals, `sm:max-w-lg`): title `text-base font-medium`, form `flex
  flex-col gap-4` of `Field`s, footer Cancel (outline) + primary.
  - Settings "Jira connection": Jira URL (`Input` `font-mono text-xs`), Project key,
    Authentication `ToggleGroup` (Personal access token / Basic), Username (Basic only),
    Token/Password `InputGroup` with eye toggle and "••••••••" placeholder when stored, Custom JQL
    (`Textarea` `font-mono text-xs`), Database view id (`Input` `font-mono text-xs`); help via
    `FieldDescription`, errors via `FieldError`.
  - Issue create/edit: issue type `ToggleGroup` (JiraChoiceTile), summary `Input`, description
    `Textarea rows={6}`, other Dart fields as `Select`/`Input`; required marks `text-destructive`
    "*"; conflict: ReUI `Alert variant="warning"` "Changed in Jira since you opened it" with
    `Button variant="outline" size="sm"` "Use Jira version" and `Button size="sm"` "Overwrite
    with mine".
  - Transition "KEY: change status": `RadioGroup` of transitions in `divide-y rounded-lg border`
    rows (`px-3 py-2.5`, target status badge on the right); errors in ReUI `Alert
    variant="destructive"` with Retry / Open in Jira.

### 6.9 Template store — task TEMPLATES

Port of `frontend/appflowy_flutter/lib/features/local_templates/**` and the assets
`frontend/appflowy_flutter/assets/local_templates/**` (manifest.json, payloads/, media/), deleted in
8e3f9dce7 (`git show 5a5db3717:<path>`; reference `doc/local-templates.md`). Same converter,
import service (DocumentEventCreateDocument / FolderEventImportData / DatabaseEventUpdateRowMeta),
media writing and naming as Dart. Opened from the sidebar "Templates" item.

Layout, container `mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto px-8 py-6`:

- Header `flex flex-wrap items-center gap-3`: icon tile (`LayoutTemplate`), title "Templates"
  `text-lg font-semibold tracking-tight`, subtitle `text-xs text-muted-foreground` ("{n}
  templates · available offline"); right `InputGroup className="ml-auto w-72"` (`Search`, hint
  "Search templates").
- Category bar `flex gap-1.5 overflow-x-auto pb-1`: "All" + categories as `Button size="sm"
  className="rounded-full"`, `variant="default"` when active else `variant="outline"`.
- Grid `grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4`.
- Card `group flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow
  hover:shadow-md`: preview `relative aspect-[16/10] overflow-hidden border-b bg-muted` (cover
  image `size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]`; no
  image → the Dart content preview drawn with muted bars / a mini table of
  `bg-muted-foreground/15` cells); body `flex flex-1 flex-col gap-2 p-4`: title `text-sm
  font-semibold`, description `line-clamp-2 text-xs text-muted-foreground`, chips row (ReUI
  `Badge variant="secondary" size="sm"`: kind with `FileText`/`Table2`, primary category; "New" as
  `Badge variant="info-light" size="sm"` when `isNew`), footer `mt-auto pt-2`: `Button size="sm"
  className="w-full"` "Use template" (`Plus`), `Spinner` + "Importing…" while running.
  Unavailable templates: card `opacity-60`, `Badge variant="outline" size="sm"` "Unavailable",
  button disabled.
- Loading: 6 card skeletons; error: `Empty` with `TriangleAlert`; no results: `Empty` with
  `SearchX` "No templates match".
- Success: `showToast` with the Dart message (`Imported "<name>".`) and open the created page as
  Dart does.

Assets: restore the directory to `frontend/appflowy_electron/resources/assets/local_templates/`
and load it through Vite (`@assets` alias): the manifest as a JSON import, payloads and media
via `import.meta.glob(..., { query: '?url', import: 'default' })` and `fetch` on demand, so the
22 MB are copied as files and never inlined into the bundle.
