# HyperBoard implementation decisions

The binding design is `/home/agent/workspace/HyperTask/.cache/hyper-views/design-kanban.md`.
This is an Operate surface extending HyperTask's existing Base UI/ReUI token system.

- Use the vendored free Kanban primitives and existing controller exclusively. No dependencies,
  Rust, shared shell, routing, controller, types, or vendor modifications. Foundation
  ec54c299 now lets every view own its empty state; the old board shell exception was dropped.
- Fresh boards persist the specified card-field defaults once. The existing view-extra API
  records `hyper_board_card_fields_initialized`; subsequent choices use field visibility.
  Primary titles always stay visible. New fields follow their core visibility setting.
- “New” in the toolbar creates an untitled card in the first shown group and opens its detail.
  Column actions open the inline input, which stays open after successful creation.
- The foundation exports no grid editors. Detail properties use its permitted read-only
  display fallback; the title saves through the typed text mutation.
- No status and checkbox labels are determined by core semantics, so their Rename action is
  disabled. No status's drag handle is disabled; its droppable column remains enabled so cards
  can be moved back into No status. Dropping another column before it restores the original order.
- Rust group moves place a row at an existing order slot. Same-group moves target the original row slot; cross-group moves target the next card. A board-local
  adapter checks the refreshed global order and uses `moveRow` if necessary to place before the next
  visible card. Search-hidden cards retain their relative core order.
- Search and group filters remain client-side; only the Hide menu persists group visibility.
- URLs open only HTTP(S) URLs in a separate window with `noopener,noreferrer`.
- Delete on a card's keyboard focus does nothing. The explicit detail Delete action is used.
- No unsupported assignee avatars, WIP limits, covers, comment counts, or risk signals are added.
- Git had no configured author identity. The delivery commit uses the explicit agent identity
  `Codex <codex@openai.com>` for this command only; no repository/global Git configuration changes.

## Design review round 1

- Columns use the same full-height box and stretch alignment, so the vendored rectangle
  sorting strategy translates horizontally without scaling or vertical displacement.
  A column-only horizontal-axis modifier also keeps the active column on that axis.
  Card and inline-card wrappers do not shrink; column bodies fill the available space and scroll.
- Column overlays and their cards are opaque. Only the dragged source column is dimmed.
- The active row ID sets source-card styles directly. Its dashed outline stays opaque while
  only the inner content fades to 40%; the wrapper overrides the kit's source opacity.
  This avoids relying on a descendant selector that competes with stacked fading.
- Read-only detail select values use the same option-color badges as board cards.
- Grid remains a foundation placeholder in this checkout and is owned by another executor.
  Capture the linked Grid after a drop and record its Rust cell value; do not implement Grid here.
- Header controls use the column's `:hover` selector directly and visible keyboard focus inside the control cluster.
  The headless Chrome harness reports no hover capability even while `:hover` matches, so
  the default media-gated hover variant cannot provide its required evidence.
- A small top inset in column bodies keeps the first card's full focus ring visible.

## Resumed round 1 verification

- Review findings 1–4 and 6 are fixed. Settled column drags retain 288px width,
  scaleX/scaleY 1, and translateY 0. The overlay opacity is 1. The source card wrapper
  stays at opacity 1 with a dashed border; only its content uses opacity 0.4. Remaining
  source cards end at y=642, above the scrolling body/footer boundary at y=839.
- Finding 5: all missing evidence is present in light and dark: header hover, focused card,
  inline rename, hidden groups, search counts, linked Grid after a drop, and column drag.
  All 26 PNGs in the shared scratch screenshot directory were overwritten at 1440×900.
  Exactly 10 images were viewed in this resumed session; the others were checked by
  dimensions/timestamps and live DOM state.
- The Grid screenshots show the foundation's Grid placeholder. A visible Grid status cell
  cannot be supplied within this Board-only scope. The real Grid controller reads the same
  database and returns “In progress” after the Board drop; that result is recorded in
  `kanban-review-drop.json`. Card status and column order survive a page reload, recorded
  in `kanban-review-reload.json`.
- The existing harness on port 5202 serves this worktree and uses only
  `/home/agent/workspace/HyperTask/.cache/hyper-views/support-kanban`. The shared browser's
  2× captures were normalized with the existing scratch PNG utility. No renderer styles
  or data were injected for screenshots.
- Required checks passed with the documented prebuilt core: typecheck, all 1,642 tests
  (1 skipped), and production build. No additional implementation tests were added for
  these visual refinements; the existing Board/controller tests and live drag checks cover
  the relevant behavior. The backup ref `refs/hyper-backup/kanban-wip-1` is preserved.
