# HyperGrid implementation decisions

- This is an Operate surface extending the existing HyperTask UI. The binding grid brief supplies the visual direction: the free ReUI frame and grid, semantic tokens, 40px rows, compact headers, expansion properties and checklist tiles. No paid source is used.
- Date editing uses native date/datetime-local inputs with Include time and End date switches. Inputs use the user's local wall time; timestamps passed to the core remain seconds. Display uses the brief's date-fns format.
- HideWhenEmpty fields remain columns, matching a database's stable column schema; AlwaysHidden fields appear in expanded Properties.
- Single-cell focus uses ReUI's single selection mode. Range selection and fill are disabled. Read-only field types remain readable and sortable.
- Sorting, field widths, visibility, wrapping and order persist through the existing Rust controller. Search and the single-select filter are temporary view state.
- The pinned expander and selection columns precede the pinned primary column. This preserves expansion and selection controls during horizontal scrolling.
- Tests cover data filtering, date/null conversion, write validation, sorting, and rendered cell/expanded states. Live harness interaction checks supply browser and real-core coverage.

- The core MoveField API updates view order, while GetDatabase returns global field order. The grid writes MoveField and also persists its ordered field IDs in `hyper_grid_column_order` via `updateViewExtra`, preserving other extra keys. This also orders the field settings list.
- A one-line shared-page exception lets empty Grid databases render this view instead of the generic database empty screen. Other empty layouts retain their existing behavior. Initial page loading and errors remain handled by the shared page.
- The vendored DnD table does not render the onRowCreate/appendRow body slots. Its supported footerContent slot contains the bottom New row affordance. The scroll-area wrapper height is constrained from the local container.
- Saved wrapCellContent is honored. Screenshots exercise unwrapped 40px content rows (41px including the shared border), hidden Assignee properties, descending sort, a resized Priority field, and the persisted custom order.
