# Hyper OpenBot integration progress

Tracking epic: [#2](https://github.com/NaveDanan/HyperTask/issues/2).
Updated: 2026-11-14.

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

Status: original Intelligence release `0.15.1` reached installer step `ready` on this PC, and the original app connection completed. The user then authorized moving heavy backend work to `agent@mmems-mems01` while keeping HyperTask desktop on this PC. The VM link is requested; its capacity and deployment are not verified yet. The local test stack is stopped with its data preserved, and the unfinished local server-image build was cancelled. Both sign-ins and personal agreement acceptance are verified on this PC. No OpenBot conversation or integrated HyperTask chat acceptance exists. Keep #4 open and do not begin #5 implementation before #4 is completed and merged.

The user explicitly requires the final result inside the running HyperTask app. Backend health and original-client proof alone do not satisfy that result. HyperTask's existing Electron frontend build passed. Its Rust core is rebuilding locally with two jobs and reduced debug/incremental artifacts after the authorized cache removal. The first native build exposed missing Clang resource headers; a matching Ubuntu package was hash-verified and extracted privately, and a direct parse of the real RocksDB C header now passes with that include path. No system package or runtime source changed. The desktop has not been launched or tested with OpenBot yet.

[HYPER_OPENBOT_LOCAL.runtime.json](HYPER_OPENBOT_LOCAL.runtime.json) records the dated local preparation. [HYPER_OPENBOT_BASELINE.md](HYPER_OPENBOT_BASELINE.md) gives the original-client procedure and pending acceptance requirements. Earlier Windows/WSL preparation remains historical and authorizes no further execution there. The current VM authorization supersedes the earlier PC-only instruction for heavy backend work only.

### Local preparation

- The user authorized deletion of identified generated Bun/npm caches and the HyperTask Rust target. That released 18.56 GiB, increasing free space to 23.21 GiB. The user then separately approved and personally removed only `/home/Ubuntu26-recovery/var/lib/containerd`, the old recovery container store. Free space was independently measured at 52.73 GiB afterward and 47.45 GiB after local preparation. The rest of the recovery copy and personal files remain outside cleanup scope. Private inventories and cleanup logs are not committed.
- The 40 GiB value is a local installer free-space check. It is not a measured image download or a fixed HyperTask desktop package size. Production backend services and persistent data need their own measured storage budget. A local backend puts those resources on each PC; a server deployment puts them on the server. This explanation does not change phase 1's original-service requirement.
- This PC has 8 CPUs and 7.4 GiB total RAM. CLI 4.34.0 checks for 4 CPUs, 4 GiB available RAM and 40 GiB free storage, while the public guide states 12 GiB RAM. The installer initially measured 3.2 GiB available against the 4 GiB minimum and stopped. Closing unused apps was insufficient. The user then authorized quitting Chrome; it exited, T3 Code stayed open, and available memory reached 4.45 GiB. The original resource check then passed and installation completed without bypassing checks. Linux/rootful Docker remains outside the documented macOS preview; no checks have been bypassed.
- Registered local source `/home/naved/HyperTask-OpenBot-baseline` is detached at `f8af37ab73e96784f174a11104505a965e722cab`. Runtime source is unpatched; the original connection command subsequently changed `.gitignore` and wrote untracked `.copilotkit` configuration. Private Node 22.23.5, Bun 1.4.3 and CopilotKit CLI 4.34.0 are installed. The local frozen Bun install passed with 1,366 packages. The Bun Linux archive was verified against its official release asset digest; its hash differs from the historical Windows record and is recorded separately.
- Official Docker packages matched the pinned SHA-256 values and current official package metadata. They were extracted privately without installing a system service or switching the global context. Private Docker Engine 29.9.3 is healthy, with Compose 5.7.1, containerd 2.4.2 and runc 1.5.3. A disposable `hello-world` container passed and was removed. Use explicit private socket/config selection for every operation. Default port bindings are loopback; actual service listeners still need verification.
- One original-source LangGraph agent image built locally as `hypertask-openbot-baseline-langgraph-agui:f8af37ab`, ID `sha256:46e763b6f84b216b2f657bafbe33f2b08b5b0788e9cada73baaf7c89563be832`. Docker reports about 439 MiB for that image only. The record includes source input hashes and the resolved 70-package Python-list hash. Mutable base and dependency inputs prevent a bit-for-bit rebuild claim. The server-image build was cancelled for the VM move before reporting success. No OpenBot application stack is running. The separate Intelligence installation reached ready and is now stopped with data preserved.
- CopilotKit's local device authorization completed. The account holder then completed the agreement in their own terminal, and the official check confirms `accepted: true`. The installed official CLI prompt says "Never accept the agreement yourself." The [human-only helper](../scripts/HyperOpenBotAccountSetup.sh) exists on this PC, selects private Node and presents the exact pinned agreement command. It needs no Docker daemon or source checkout. Syntax/help pass and the wizard library is unchanged; the agent has not run the agreement flow.
- ChatGPT OAuth completed on this PC using the exact pinned desktop login program in the matching-source agent image. Actual callback bindings were verified as `127.0.0.1:1455` and `[::1]:1455`. The full credential store is private, mode `0600`, and owned by the local user. The original model-catalog function successfully read eight available models from the real account. No API key was used. This proves authentication and catalog access only; no live model answer or OpenBot/Intelligence application acceptance exists. The disposable sign-in container exited successfully and was removed.
- All five runner unit tests and one browser regression passed without skips on this PC using private Node 22.23.5, the original client's Playwright core 1.62.1 and Chrome Headless Shell 151.0.7922.34, revision 1234. The browser regression verifies a DOM fixture, not a live backend. Runner syntax/help and helper syntax/help passed.
- Evidence validation matched 11 recorded input hashes to local files, confirmed the installed helper matches the repository copy and unchanged wizard library, resolved 34 local/immutable documentation links and passed `git diff --check`. Every live acceptance field remains `not_run`.
- Next: verify and provision the authorized VM, connect HyperTask through a private connection, complete original OpenBot real-model send/stream/save/restart-both/reopen proof, then deliver and test native integration in the issue order. Preserve the successful local setup as evidence and recovery data. No mock or managed-Intelligence substitution satisfies #4. HyperTask runtime and user data remain unchanged.

### Earlier preparation and review

- The working branch `hyper/openbot-local-baseline` starts from the verified #9 merge. The original-client [runner](../scripts/HyperOpenBotBaseline.mjs) has separate before/after observations, understands the pinned SDK's Phoenix AG-UI envelope, excludes authentication/routing fields from artifacts and keeps provider/restart assertions independent. Upstream e2e defaults to aimock replay; its smoke suite does not prove live chat or restart durability.
- Upstream lifecycle inspection found host API exposure and cleanup beyond Compose project scoping. Application provisioning must verify loopback listeners and owned resources, preserve both stores and avoid the broad original stop script on a shared host.
- Historical Windows/WSL preparation built server/computer/supervisor and matching-source LangGraph images, completed frozen installs and staged the corrected runner. [HYPER_OPENBOT_PREPARATION.runtime.json](HYPER_OPENBOT_PREPARATION.runtime.json) retains those pins and limits. It establishes no current-PC readiness. No live provider or restart acceptance was completed there. Earlier instructions requiring its Windows browser are superseded by the local-only constraint.
- Codex code/security reviews cleared preparatory head `0467480`. Macroscope then found that unavailable composer controls could wait indefinitely. Browser actions/navigation now have finite 30-second defaults, with separate bounded stream/completion waits. Codex code/security reviews cleared `c2dff15`, and the timeout thread was resolved.
- A browser regression reproduced the whole-reply locator failure for multi-paragraph text. The corrected runner locates each original transcript row by saved message ID and compares whitespace-folded rendered text. Exact stream/history equality is unchanged. Runner `a2860f3` has SHA-256 `fa64b3fb2b5b45a66c6c987acfd3446341b4c1b6016ff62a0adf1263f1380f6d` and has not changed during local preparation.
- Codex code and security reviews subsequently cleared preparation heads `47035f6`, `f352648`, OAuth-evidence head `b765f9c` and agreement/resource-evidence head `4590b4b` without findings. Each subsequent evidence/runtime head requires its own review before merge. PR #10 remains draft until real runtime evidence, tested application lifecycle commands and all review gates are complete.

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
