# HyperCalendar

Live Calendar-layout database view built on the vendored MIT ReUI event calendar.
ReUI owns the grid, date segmentation, event packing, pointer drag/resize,
keyboard view switching, overflow anchor and scrolling. Local components own the
live controller adapter, toolbar, settings, full-day overflow body and row dialogs.

## Decisions

- Use the viewer's system time zone for the calendar and native date/time inputs.
  Zoned all-day boundaries account for daylight-saving changes. API values remain
  bigint seconds; the core's inclusive all-day end becomes an exclusive display end.
- Colour defaults to the first SingleSelect field. The per-view localStorage choice
  supports `None`; unavailable storage does not stop calendar use.
- ReUI's `onEventUpdate` contract is synchronous and does not await promises.
  Return `false` from the vendor callback, await the core write in the adapter,
  then refetch authoritative events. A rejected write shows an error toast and
  refetches. No optimistic timing is reported as a saved row.
- ReUI suppresses drops whose timestamps are unchanged, including a same-day
  all-day-to-time-grid conversion. A capture listener reads its public drag state
  and forwards only that skipped flag-only move to the same write funnel. It owns
  no gesture recognition, pointer positioning, date math or vendor mutation.
- A timed point date has a display-only one-hour end. Moves call the controller's
  duration-preserving calendar action. Resize writes both date endpoints and turns
  the cell into a range. Crossing the all-day lane explicitly changes `includeTime`.
- The vendor stores `enableShortcuts` but implements no key handler. A local
  wrapper supplies M/W/D/A while focus is in the calendar and ignores forms,
  overlays and modifier keys. T-today and keyboard move/resize remain omitted.
- The vendor exposes no external-drop registration API. Undated rows use
  click-to-schedule and a CalendarOff icon instead of a nonfunctional drag grip.
- The default overflow body shows hidden events only. HyperCalendarMoreContent
  uses ReUI's indexed day segments and original event chips to show the full day.
  A small reserved area below the measured event content keeps the overflow trigger
  visible when all-day bars occupy every available lane.
- Keep the brief's minimum 8rem month rows. The existing app shell leaves less
  than 768px at 1440×900, so the sixth row is reached by scrolling inside the grid.
  The toolbar remains fixed; the page does not scroll.
- Foundation ec54c299 lets every Hyper view own empty states. Calendar renders
  its normal grid for zero rows, the agenda empty block for an empty period, and
  a separate missing-Date-property state. No shared shell change is needed.
- If choosing the default Date field fails, show the error state and let Retry
  attempt configuration again. Keep earlier events visible during normal refetches.
- A failed create rolls back its new row. If rollback also fails, the dialog keeps
  that row ID so retrying cannot create a second row. Existing-row writes use the
  controller's separate title/date/select actions; they are not a core transaction.

No dependencies, Rust changes, vendor edits, shared controller changes or routing
changes are required. The paid block's rail, recurrence, attendee and resource UI
remain outside the brief's scope.

## Verification

- `npm run typecheck`, `npm test`, and `npm run build` passed on the resumed
  foundation: 1,642 tests passed, one skipped; 12 calendar tests passed.
- Adapter tests cover inclusive all-day ends, time zones/DST, point-date visual
  duration, move/resize writes, rejected writes, flag-only conversion, default
  date-field retry, and stale range-response protection.
- Rust-backed harness evidence covers create/edit/delete, undated-row scheduling,
  move and resize persistence after reload, settings, four layouts, empty states,
  and keyboard view switching. The resumed pass also tested default-field failure
  and Retry recovery. The toolbar measured 48px; the month had 42 cells and no page
  scroll. Chip title contrast was at least 10.54:1 in dark mode.
- Screenshots remain in ignored shared scratch storage. Only the error captures
  needed updating in the resumed pass; unchanged interaction evidence was kept.
