# Hyper OpenBot integration progress

Tracking epic: [#2](https://github.com/NaveDanan/HyperTask/issues/2).
Updated: 2026-11-13.

## Delivery rules

- Complete issues #3, #4, #5, #6, #7 and #8 in order. Merge the current issue's PR before implementing the next issue.
- Request `@codex review` on each PR. Address actionable findings, validate the resulting head and confirm review completion before merging.
- Keep CopilotKit Intelligence intact throughout phase 1. Defer Intelligence replacement and Knowledge Graph implementation until phase 1 is stable.
- Preserve HyperTask's design system, existing workflows, data paths, credentials and AppFlowy protocol compatibility.
- Record source pins, validation, review findings, PR links and merge commits here as each step finishes. Do not record secrets.

## Current step: issue #3

Status: audit delivered in [PR #9](https://github.com/NaveDanan/HyperTask/pull/9); awaiting Codex review and merge. No runtime changes and no merge yet.

- HyperTask main inspected at `2a5bbd3c5027f3b121d3ef010d806fca0f03bcb9`.
- PR #1 inspected at `5b58eb5f164f932d631c0eb013bfce15a516a134`. It contains one commit changing 731 files, with 92,476 insertions and 2,424 deletions.
- PR #1 remains optional reference material. Its AI runtime is not evidence of OpenBot integration.
- PR #1 has four unresolved Codex review threads at the inspected head: a P1 chat-history refresh loop and P2 findings concerning grid visibility/order, list outdenting across structural containers and public attachment downloads. A clean merge status does not clear these findings.
- [HYPER_OPENBOT_AUDIT.md](HYPER_OPENBOT_AUDIT.md) records the source inventory, dependency and host mapping, auth/origin/storage boundaries, review findings and next vertical slice.
- Decision: do not merge PR #1 whole or use its Rust chat backend as the OpenBot baseline. Start from main and selectively adapt useful UI and lifecycle patterns. Leave PR #1 intact for separate review/splitting.
- OpenBot source pin: `f8af37ab73e96784f174a11104505a965e722cab`. This is a research pin, not a tested release. Keep original Intelligence in phase 1.
- Read-only environment checks found Bun 1.3.11, below upstream's documented 1.4+ requirement, and no Docker executable. Local Intelligence platform support, entitlement, images and model credentials remain unverified. Resolve them during #4; no live streaming or persistence acceptance is claimed.
- Follow-up primary-documentation check clarified that the Intelligence CLI accepts Linux with rootful Docker, although runtime evaluation there is outside the supported preview. A licensed local Kubernetes/k3d path is also documented. Neither has been provisioned or validated; the audit distinguishes these paths from the supported macOS preview.
- Completed separate upstream research and standards/spec inspections with GPT-6.1 Terra, high effort, priority tier. Findings were checked against source before consolidation. No runtime tests were performed for this audit.
- Validation: all 67 local documentation and immutable source links resolve against the corresponding pinned checkouts; staged `git diff --check` passed. Changes are limited to this record, the architecture note and a status-document link.

## Queue

| Issue | Deliverable | State |
| --- | --- | --- |
| [#3](https://github.com/NaveDanan/HyperTask/issues/3) | Baseline audit and reuse decision | PR #9 awaiting review/merge |
| [#4](https://github.com/NaveDanan/HyperTask/issues/4) | Original OpenBot + Intelligence local baseline | Waiting for #3 merge |
| [#5](https://github.com/NaveDanan/HyperTask/issues/5) | Native chat UI integration | Waiting for #4 |
| [#6](https://github.com/NaveDanan/HyperTask/issues/6) | Conversations, agents, actions, approvals and streaming | Waiting for #5 |
| [#7](https://github.com/NaveDanan/HyperTask/issues/7) | Background-service lifecycle | Waiting for #6 |
| [#8](https://github.com/NaveDanan/HyperTask/issues/8) | End-to-end and regression acceptance | Waiting for #7 |

## Working-copy note

The session began on PR #1's branch with no reported changes. The audit branch starts from main. Switching to main exposed ignored/untracked files under `frontend/appflowy_electron/tests/`; these are local artifacts and must not be deleted or included in the audit PR.
