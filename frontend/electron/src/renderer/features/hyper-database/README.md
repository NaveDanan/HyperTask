# Hyper database foundation

The four view executors own **only** `views/HyperGridView.tsx`, `views/HyperBoardView.tsx`,
`views/HyperCalendarView.tsx`, `views/HyperGanttView.tsx` and new files in their respective
`views/grid/`, `views/board/`, `views/calendar/`, `views/gantt/` folders. The shared shell,
controller, codec and vendor files are the foundation's responsibility. No executor needs
new dependencies or a different transport.

## View contract

```tsx
import type { HyperDatabaseViewProps } from '../HyperDatabaseTypes';
export function HyperGridView({ controller, state, view }: HyperDatabaseViewProps) {
  // state.rowIds is the core's filtered, sorted order, not Object.keys(state.rows).
  // Call controller.loadRows(visibleRowIds, visibleFieldIds) as the viewport changes.
  // A missing state.cells[rowId]?.[fieldId] means it has not loaded yet.
  // Keep the view's toolbar here: the shared underline tabs sit immediately above it.
  return /* your view */ null;
}
```

Each view owns its empty states. `HyperDatabasePage` renders the view whenever the database
opens, even with zero rows, so the view shows its own frame (toolbar, headers, columns or
timeline) with an in-place empty state and "New record" affordance.

`useHyperDatabase(viewId, backend?)` returns `{ controller, state }`, opens the view, and
unsubscribes on unmount. `HyperDatabaseController` can also be used without React:
construct it, `await open()`, read `state` / subscribe to `store`, then `dispose()`.
`useHyperDatabaseSelector(controller, selector)` lets row/cell children subscribe only
to a stable slice; do not return a new array/object on every selector call.

`HyperDatabaseState` contains `status` (`idle/loading/ready/error`), `error`, `databaseId`,
`viewId`, `view`, `views`, `fields`, `rowIds`, `rows`, `cells`, `groups`, `settings`, and
`revision`. `settings.filters`, `settings.sorts`, `settings.groupSettings`,
`settings.fieldSettings`, and `settings.layoutSetting` retain the generated protobuf types.
Row metadata is normalized to `icon`, `cover`, `documentId`, `isDocumentEmpty`; the original
`meta` remains available for core integrations. Fields expose `type`, `isPrimary`,
`settings.visibility/width/wrapCellContent`, `options` and the original `proto` (including
`typeOptionData`). Groups expose their core rows, `isDefault`, `isVisible`, `name`, and
optional select `option` with its core colour enum.

## Cells and mutations

`HyperCell` is discriminated by `kind`. Every cell has `display` and an optional decode /
request `error`; failures do not collapse the whole view. Text, number, summary and translate
payloads are UTF-8; the other types use their generated cell protobuf schemas.

| kind | Typed value |
| --- | --- |
| text, summary, translate | `text` |
| number | `value: number \| null`, formatted core `display` |
| url | `url` |
| checkbox | `checked` |
| date | `timestamp/endTimestamp: bigint \| null`, `isRange`, `includeTime`, `reminderId` |
| singleSelect, multiSelect | `selected`, all field `options` (IDs, names, colours) |
| checklist | `items` with `completed`, `progress` (core fraction 0–1) |
| createdTime, lastEditedTime | `timestamp`, formatted core `display` (read only) |
| relation | `rowIds`, related `databaseId`; resolve labels with `getRelatedRows` |
| time | `seconds: bigint \| null`, `HH:mm` display |
| media | `files` with IDs, names, URLs, upload and media types |

All dates/times at the API boundary are **seconds**, not JavaScript milliseconds. Unset
dates stay `null`; epoch zero is valid. Date displays use the field's format/timezone.
Number values parse the formatted core string; locale-specific formatting can be lossy,
so preserve `display` for rendering and write the user's numeric value explicitly.
The core does not distinguish an empty Time protobuf from zero seconds.

Actions reject with the core's `HyperError` (its message is `msg`) or a validation `Error`.
Await actions and show errors in the view. Do not report success before the promise resolves.

- Rows: `createRow({ data?, rowPosition?, oneOfGroupId? }) → RowMetaPB`,
  `duplicateRow(rowId)`, `deleteRows(rowIds)`, `moveRow(fromRowId, toRowId)`.
  Position/group arguments retain generated protobuf init shapes; initial `data` maps field
  IDs to core changeset strings. Core notifications supply duplicate IDs.
- Cells: `updateCell(rowId, fieldId, mutation: HyperCellMutation)`. It validates the field type
  and refreshes the cell after a successful write. Use `{ kind: 'text', text }`,
  `{ kind: 'number', value }`, `{ kind: 'checkbox', checked }`, `{ kind: 'url', url }`,
  `{ kind: 'date', timestamp?, endTimestamp?, includeTime?, isRange?, clear?, reminderId? }`,
  `{ kind: 'singleSelect'|'multiSelect', insertOptionIds?, deleteOptionIds? }`,
  `{ kind: 'checklist', insert?: [{ name, index? }], deleteIds?, update?, completedIds?, reorder? }`,
  `{ kind: 'relation', insertRowIds?, deleteRowIds? }`, `{ kind: 'time', seconds }`,
  or `{ kind: 'media', insertFiles?, deleteIds? }`. Checklist `completedIds` toggles the supplied IDs, matching the core protocol.
  Prefer `setChecklistItemCompleted(rowId, fieldId, itemId, completed)` to set a desired state.
  `reorder` is the core string `"fromItemId toItemId"`.
- Options: `createSelectOption(fieldId, name, rowId?, color?) → SelectOptionPB`;
  supplying a row ID also selects it. `updateSelectOptions(fieldId, options)` and
  `deleteSelectOptions(fieldId, options)` manage field options. Existing option selections
  use the cell mutation above.
- Fields: `createField(name, FieldType, options?) → FieldPB`, `renameField`, `deleteField`,
  `duplicateField`, `moveField(fromFieldId, toFieldId)`, `changeFieldType(fieldId, FieldType)`,
  `updateFieldTypeOptions(fieldId, protobufBytes)`,
  `updateFieldSettings(fieldId, { visibility?, width?, wrapCellContent? })`.
- Groups: `setGroupByField(fieldId, settingContent?)`, `getGroups()`,
  `moveGroup(fromGroupId, toGroupId)`,
  `moveRowBetweenGroups(rowId, fromGroupId, toGroupId, toRowId?)`, `createGroup(name)`,
  `renameGroup(groupId, name)`, `hideGroup(groupId, hidden = true)`, `deleteGroup(groupId)`.
  A default group's label is “No status”; select group labels resolve from field options.
- Calendar: `updateCalendarSettings({ fieldId?, firstDayOfWeek?, showWeekends?, ... })`,
  `getCalendarEvents(startSeconds, endSeconds) → HyperCalendarEvent[]` (half-open range,
  overlapping events included), `moveCalendarEvent(rowId, dateFieldId, timestamp)`.
  Moves preserve range duration. The core move event ignores ranges, so range moves submit
  both endpoints through `UpdateDateCell`. Partial range edits also fill the unchanged
  endpoint because the core requires both endpoints. Events expose their end date/include-time flag.
- Metadata: `updateRowMeta(rowId, { icon?, cover?, isDocumentEmpty? })`; `cover: null` removes
  a cover and `icon: ''` clears an icon.
- Filters/sorts/layout: `updateSettings(protobufChangesetWithoutViewId)` and
  `updateLayoutSettings(protobufChangesetWithoutViewId)` wrap the existing core settings
  events; the current state exposes typed filter/sort trees.
- Linked views: `addView(layout, name) → ViewPB`, `renameView(viewId, name)`,
  `duplicateView(view) → ViewPB`, `deleteView(viewId)`.
  Duplication keeps this database linked and copies extra keys, field settings, layout,
  group-by configuration, filter trees and sorts; the core assigns new filter/sort IDs.
  `updateViewExtra(patch)` merges per-view custom settings through the existing extra helper.
  The core `UpdateView` event returns an empty acknowledgement for every layout; its generated
  wrapper returns `void`. The view service follows successful updates with `GetView`, preserving
  its `ViewPB` result contract and the persisted id/extra. Creation with `extra` and linked
  `database_id` metadata both return a full `ViewPB` from `CreateView`.
  `hyperLayout(view)` resolves Grid/Board/Calendar/Gantt; `hyperCoreLayout(layout)` maps
  product layouts to **folder** `ViewLayoutPB` (database `DatabaseLayoutPB` has different
  numeric values). Gantt creation writes and re-reads its extra marker before announcing the
  current view.
  Switching uses the existing `tabsActions.openView(view)`.

## Notifications and performance

The adapter uses the existing `listenAll` receiver and generated event wrappers. It accepts
Database and Workspace subjects and detaches its listener in `dispose()`. Cell notifications
carry **no payload**; their object ID is `rowId:fieldId`. Row-meta/fetch notifications target
row IDs, field updates target field IDs, group-row notifications target group IDs; structural,
visibility, sorting, grouping and setting notifications target view/database IDs.

Inserts, deletes, moves, visibility, row metadata and row reorders patch local state immediately.
Field/schema/settings/filter/sort/group/layout notifications coalesce into a 24ms metadata
refresh. The core provides authoritative filtered/sorted rows, fields, groups and settings;
no client-side recreation of filter semantics is needed. Folder changes refresh the linked
view list; views are matched by database ID with cached, bounded-concurrency lookups.
Invalidated loaded cells refetch individually. A field schema change discards incompatible
cached values. Epoch/version guards ignore late requests after disposal or cell invalidation.
Notification decode failures are exposed as errors and trigger a fresh snapshot.

`GetDatabase` supplies ordered row metadata without fetching every cell. Initial prefetch is
50 rows; `loadRows(rowIds, fieldIds?)` batches rows, deduplicates cell requests and uses eight
concurrent requests. Default cache capacity is 20,000 cells; old entries evict and reload on
viewport demand. Pass `{ batchSize, concurrency, maxCachedCells }` as constructor argument 3
for tests/tuning (all must be positive). The calendar core has no range endpoint; the controller
reads its event list, lazily loads date cells and filters overlap locally. Virtualize the grid
with the installed ReUI virtual table, and limit Board/Gantt viewport requests as appropriate.

## Vendor components

Free MIT ReUI source lives under `components/reui/data-grid/` (the whole family: selection,
filter/header/visibility, pagination, scroll area, DnD columns/rows, virtual table, i18n),
`components/reui/kanban.tsx`, `components/reui/event-calendar/` (13 files, including recurrence,
resources, time grid and DnD), `components/reui/gantt/` (9 files), and `icon-stack.tsx`.
The supporting Base UI calendar is `components/ui/calendar.tsx`. Import actual entry files,
for example `@/components/reui/event-calendar/event-calendar` and
`@/components/reui/gantt/gantt`. These are current ReUI / TanStack Table **v9** APIs; use the
installed source/types rather than v8 tutorials. Components remain vendor code.

Sources: `https://reui.io/r/base-nova/<item>.json`, with event-calendar also available at the
requested `https://reui.io/r/styles/base-nova/event-calendar.json`; calendar primitive from
`https://ui.shadcn.com/r/styles/base-nova/calendar.json`. The CLI hit an existing-file prompt,
so files were written from those registry JSONs with their original target paths. Existing
badge/primitive files were preserved. [Vendor provenance](../../components/reui/HYPER_VENDOR.md)
records licensing, dependency versions and the complete local changes.

### IconPlaceholder replacements (file → lucide icons)

- `reui/data-grid/data-grid-column-filter.tsx` → `CheckIcon`, `CirclePlusIcon`
- `reui/data-grid/data-grid-column-header.tsx` → `ArrowDownIcon`, `ArrowLeftIcon`, `ArrowLeftToLineIcon`, `ArrowRightIcon`, `ArrowRightToLineIcon`, `ArrowUpIcon`, `CheckIcon`, `ChevronsUpDownIcon`, `PinOffIcon`, `Settings2Icon`
- `reui/data-grid/data-grid-pagination.tsx` → `ChevronLeftIcon`, `ChevronRightIcon`
- `reui/data-grid/data-grid-table-dnd-rows.tsx` → `GripHorizontalIcon`
- `reui/data-grid/data-grid-table-dnd.tsx` → `GripVerticalIcon`
- `reui/data-grid/data-grid-table.tsx` → `PlusIcon`
- `reui/event-calendar/event-calendar-agenda-view.tsx` → `CalendarIcon`
- `reui/event-calendar/event-calendar-event.tsx` → `RepeatIcon`
- `reui/event-calendar/event-calendar-month-view.tsx` → `PlusIcon`
- `reui/event-calendar/event-calendar-nav.tsx` → `CalendarIcon`, `ChevronDownIcon`, `ChevronLeftIcon`, `ChevronRightIcon`
- `reui/gantt/gantt-bar.tsx` → `CheckIcon`, `RepeatIcon`
- `reui/gantt/gantt-nav.tsx` → `CalendarIcon`, `ChevronDownIcon`, `ChevronLeftIcon`, `ChevronRightIcon`
- `reui/gantt/gantt-view.tsx` → `ChevronLeftIcon`, `ChevronRightIcon`, `GripVerticalIcon`, `MinusIcon`, `PlusIcon`
- `ui/calendar.tsx` → `ChevronDownIcon`, `ChevronLeftIcon`, `ChevronRightIcon`

### Compile-only changes approved by the orchestrator

- `data-grid-table.tsx`: stop destructuring unused `rowId` / skeleton `table`; remove unused
  generic parameters from `DataGridTableHeader` and `DataGridTable`.
- `data-grid-table-dnd.tsx`: remove unused `DataGridTableDnd` generic parameter.
- `event-calendar-lib.tsx`, `gantt-lib.tsx`: remove unused `PackedPosition` interfaces.
- `event-calendar-month-view.tsx`: remove the unused day-cell `instance` local.
- `event-calendar-resource-view.tsx`: remove unused `useState` import.
- `event-calendar-time-grid.tsx`: remove unused `EventCalendarSlotDraft` import.
- Supporting `ui/calendar.tsx`: resolve the registry-internal button import to the existing
  `@/components/ui/button` (same vendor primitive).

No runtime vendor behavior, style or React APIs were changed.

## Fixtures and verification

`HyperDatabaseController.test.ts` builds a mocked `HyperDatabaseBackend` by replacing the
adapter's event functions and `subscribe`. Construct protobuf fixtures with `create(schema,
init)`; cell notification bytes use `toBinary`. Call `controller.onNotification(subject)` to
replay a notification. See the tests for all 15 field types, insertion/deletion/reorder,
coalesced schema/settings updates, stale requests, cache/concurrency limits and typed writes.

`seedHyperDatabaseSamples(parentViewId, backend?, rowCount = 12)` explicitly creates Grid,
Board, Calendar and Gantt databases with task/status/priority/assignee/date-range/checklist/
estimate data. The Grid sample has three linked views so the shared tab bar can be exercised.
Use scratch support directories; seeding appends data and never deletes existing databases.
It removes only the new database's default sample rows/fields. For unit tests, pass your mock
adapter; no real core or filesystem is required by the seed module.

Run `npm run harness:smoke` for an opt-in live core test (outside the ordinary mocked suite).
It uses a new scratch support directory on every run (or an empty `HYPER_SMOKE_SUPPORT`),
checks core responses for all layouts with/without linked metadata and Gantt extra, and exercises
both sidebar add-page actions and the tab-bar linked-view action for Grid/Board/Calendar/Gantt.
It seeds 48 rows, checks persisted Gantt ids/layout and shared linked rows, edits a title, moves
a board card, and moves a calendar event while preserving its range. It writes
`.cache/hyper-views/sample-views.json`, `live-smoke.json`, `live-core.log` and
`live-view-replies.json` at the repo root. The web harness exposes `window.hyperViews.ready/seed/open/theme` only when
its injected shim marks the page; native Electron startup never loads this development API.

Exact Linux build, seed and PNG commands and the verification record are in the repo-root
`.cache/hyper-views/HARNESS.md`. The four view UIs are intentionally deferred to their executors.
