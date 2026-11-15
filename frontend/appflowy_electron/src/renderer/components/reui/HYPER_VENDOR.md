# Hyper database vendor provenance

The free components were obtained from the ReUI base-nova JSON registry on 2026-11-15.
ReUI is MIT licensed: https://reui.io/docs/license and https://github.com/keenthemes/reui.
The shadcn calendar primitive is MIT licensed: https://github.com/shadcn-ui/ui/blob/main/LICENSE.md.
Preserve all upstream source notices. These product-independent components keep upstream names.

Installed families: data-grid (12 files), kanban, event-calendar (13 files), gantt (9 files),
icon-stack and the supporting shadcn calendar. Existing shared primitives were not overwritten.

Exact new runtime dependencies:

- `@date-fns/tz@1.5.0`
- `@dnd-kit/core@6.3.1`
- `@dnd-kit/modifiers@9.0.0`
- `@dnd-kit/sortable@10.0.0`
- `@dnd-kit/utilities@3.2.2`
- `@tanstack/react-table@9.3.1`
- `@tanstack/react-virtual@3.14.26`
- `date-fns@4.4.0`
- `react-day-picker@10.0.2`

Registry dependencies without versions were resolved to current stable versions; calendar
requests react-day-picker@latest. ReUI now targets TanStack Table v9 and date-fns v4.
The full source-import icon swap list and approved strict-TypeScript unused-declaration
cleanup are recorded in [the controller README](../../features/hyper-database/README.md).
All remaining vendor contents match the downloaded registry files.
