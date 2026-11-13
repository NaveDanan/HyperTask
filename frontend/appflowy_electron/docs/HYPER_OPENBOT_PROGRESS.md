# Hyper OpenBot integration progress

Tracking epic: [#2](https://github.com/NaveDanan/HyperTask/issues/2).
Updated: 2026-11-13.

## Delivery rules

- Complete issues #3, #4, #5, #6, #7 and #8 in order. Merge the current issue's PR before implementing the next issue.
- Request `@codex review` on each PR. Address actionable findings, validate the resulting head and confirm review completion before merging.
- Keep CopilotKit Intelligence intact throughout phase 1. Defer Intelligence replacement and Knowledge Graph implementation until phase 1 is stable.
- Preserve HyperTask's design system, existing workflows, data paths, credentials and AppFlowy protocol compatibility.
- Record source pins, validation, review findings, PR links and merge commits here as each step finishes. Do not record secrets.

## Completed: issue #3

Status: [PR #9](https://github.com/NaveDanan/HyperTask/pull/9) merged as `1b7c23f7c8ff18b08b60f3371b8f90120708f744`. Issue #3 is closed and its epic checkbox is complete. The merged audit changes no runtime behavior.

- HyperTask main inspected at `2a5bbd3c5027f3b121d3ef010d806fca0f03bcb9`.
- PR #1 inspected at `5b58eb5f164f932d631c0eb013bfce15a516a134`. It contains one commit changing 731 files, with 92,476 insertions and 2,424 deletions.
- PR #1 remains optional reference material. Its AI runtime is not evidence of OpenBot integration.
- PR #1 has four unresolved Codex review threads at the inspected head: a P1 chat-history refresh loop and P2 findings concerning grid visibility/order, list outdenting across structural containers and public attachment downloads. A clean merge status does not clear these findings.
- [HYPER_OPENBOT_AUDIT.md](HYPER_OPENBOT_AUDIT.md) records the source inventory, dependency and host mapping, auth/origin/storage boundaries, review findings and next vertical slice.
- Decision: do not merge PR #1 whole or use its Rust chat backend as the OpenBot baseline. Start from main and selectively adapt useful UI and lifecycle patterns. Leave PR #1 intact for separate review/splitting.
- OpenBot source pin: `f8af37ab73e96784f174a11104505a965e722cab`. This is a research pin, not a tested release. Keep original Intelligence in phase 1.
- Read-only environment checks found Bun 1.3.11, below upstream's documented 1.4+ requirement, and no Docker executable. Local Intelligence platform support, entitlement, images and model credentials remain unverified. Resolve them during #4; no live streaming or persistence acceptance is claimed.
- Follow-up primary-documentation check clarified that the Intelligence CLI accepts Linux with rootful Docker, although runtime evaluation there is outside the supported preview. A licensed local Kubernetes/k3d path is also documented. Neither has been provisioned or validated; the audit distinguishes these paths from the supported macOS preview.
- Final reviewed head: `da27fac526701addab852d8e303ce9694eb77933`. Codex code and security reviews completed without findings. CodeRabbit independently confirmed the dependency-authorization wording correction and resolved its thread. The correctness check passed; the remaining check completed neutral. The audit adds no packages or blanket exception, and #5 must document exact required imports/dependencies against the redesign constraints.
- Read-only capacity check: the current host has 8 logical CPUs, 7.4 GiB total RAM and about 5.1 GiB free disk. Original Intelligence local evaluation documents at least 12 GiB RAM and 40 GiB free disk, so Docker installation alone is insufficient. Candidate linked hosts are being checked read-only; no baseline services have been provisioned.
- Completed separate upstream research and standards/spec inspections with GPT-6.1 Terra, high effort, priority tier. Findings were checked against source before consolidation. No runtime tests were performed for this audit.
- Validation: all 67 local documentation and immutable source links resolve against the corresponding pinned checkouts; staged `git diff --check` passed. Changes are limited to this record, the architecture note and a status-document link.

## Current step: issue #4

Status: original-service baseline preparation in progress in [draft PR #10](https://github.com/NaveDanan/HyperTask/pull/10), after the #3 merge. No live send/stream/persistence/restart acceptance yet. HyperTask runtime and user data remain unchanged.

- Working branch `hyper/openbot-local-baseline` starts from the verified #9 merge.
- The current Linux host cannot meet the original Intelligence local-evaluation RAM/disk requirements. Read-only linked-host preflights found a Windows/WSL candidate with 31.9 GiB RAM and more than 140 GiB free on each checked drive. Ubuntu is registered under WSL2; Docker Desktop, CLI and Compose are installed. Guest allocation and engine readiness require verification before provisioning.
- The linked MMEMS host has Docker/Compose and 15 GiB RAM but only 28 GiB free on root and 23 GiB on Docker's filesystem. Its existing Kubernetes cluster is not a provisioned baseline; capacity and entitlement remain unverified. No workloads were created there.
- A separate OpenBot baseline project was cloned and registered on the Windows host at `D:\pythonprojects\HyperTask-OpenBot-baseline`. This is isolated from existing HyperTask workspaces. Preserve the audited upstream pin and source files; keep configuration/secrets outside tracked files.
- Next: establish the original-service deployment path and tool/runtime pins, verify resources and health, configure one real model, then exercise the original client through send/stream/save/restart/reopen. Record exact results and limitations. Do not close #4 or start #5 on a mock, managed-Intelligence substitution or unverified setup.
- [HYPER_OPENBOT_BASELINE.md](HYPER_OPENBOT_BASELINE.md) drafts the original-client procedure and evidence requirements. Source inspection confirmed upstream e2e defaults to aimock replay, while the smoke suite does not prove live chat or restart. Neither may substitute for this issue's live proof. The guide's acceptance rows remain explicitly pending.
- Upstream lifecycle inspection found host API exposure and cleanup operations outside Compose project scoping. The provisioning task must verify loopback listeners and owned processes/containers, and preserve both OpenBot and Intelligence data during restart.
- Procedure validation: all 23 local and immutable source links in the baseline guide/progress record resolve; `git diff --check` passed. These documentation checks do not satisfy live baseline acceptance. PR #10 remains draft until runtime evidence and current-head Codex review are complete.

## Queue

| Issue | Deliverable | State |
| --- | --- | --- |
| [#3](https://github.com/NaveDanan/HyperTask/issues/3) | Baseline audit and reuse decision | Merged in PR #9 |
| [#4](https://github.com/NaveDanan/HyperTask/issues/4) | Original OpenBot + Intelligence local baseline | Draft PR #10; live evidence pending |
| [#5](https://github.com/NaveDanan/HyperTask/issues/5) | Native chat UI integration | Waiting for #4 |
| [#6](https://github.com/NaveDanan/HyperTask/issues/6) | Conversations, agents, actions, approvals and streaming | Waiting for #5 |
| [#7](https://github.com/NaveDanan/HyperTask/issues/7) | Background-service lifecycle | Waiting for #6 |
| [#8](https://github.com/NaveDanan/HyperTask/issues/8) | End-to-end and regression acceptance | Waiting for #7 |

## Working-copy note

The session began on PR #1's branch with no reported changes. The audit branch starts from main. Switching to main exposed ignored/untracked files under `frontend/appflowy_electron/tests/`; these are local artifacts and must not be deleted or included in the audit PR.
