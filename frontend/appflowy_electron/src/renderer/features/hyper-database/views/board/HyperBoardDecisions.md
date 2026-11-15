# HyperBoard implementation decisions

The binding design is `/home/agent/workspace/HyperTask/.cache/hyper-views/design-kanban.md`.
This is an Operate surface extending HyperTask's existing Base UI/ReUI token system.

- Use the vendored free Kanban primitives and existing controller exclusively. No dependencies,
  Rust, routing, controller, types, or vendor modifications. One shared-shell guard change
  allows zero-row Board views to mount rather than replacing them with a generic empty state.
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
