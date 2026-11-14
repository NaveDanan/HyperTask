# Native OpenBot acceptance

[Issue #8](https://github.com/NaveDanan/HyperTask/issues/8) validates the original OpenBot and CopilotKit Intelligence inside HyperTask. The automated/native checks below passed. Owner acceptance and the final PR review are pending. This report does not declare phase 1 complete.

HyperTask is the only application UI used in these checks. Electron and the existing Rust core run on the desktop; the existing authorized personal MMEMS VM runs OpenBot, the model agent, computer, PostgreSQL and original Intelligence. There is no iframe or separate OpenBot shell. ChatGPT OAuth supplies model access; no API key was added. The account holder personally completed the required agreement.

The source pin remains `f8af37ab73e96784f174a11104505a965e722cab`. The desktop runtime capture is `3eb5d6a4e50ac096b9e6b0f7472522b471b0754c`; action/tool/Stop captures are `6d9ea32530bacb5f5e199aca8e17b1c624004cb4`. The changes between those captures retain navigation drafts and add core regression tests. [The machine-readable record](HYPER_OPENBOT_ACCEPTANCE.runtime.json) identifies each private evidence file, capture commit and SHA-256. Full synthetic conversations and screenshots stay in the private evidence directory, outside Git.

## Results

| Requirement | Observation and limits |
| --- | --- |
| New conversation and agent | Native Bots > Personal Assistant > Chat created a new native conversation. The original channel's agent and thread were checked through the restricted main-owned transport. |
| Model and effort | Switched to an alternate model and back to the default; compared the visible label with authoritative saved settings. The original server represents its current default as `model: null`. The native picker now resolves that value after both load and save. |
| Streaming and multi-turn | Two real turns received 105 and 50 live AG-UI text deliveries. New run/message IDs and a single matching IPC socket were required. Exact accumulated text matched authoritative saved text and rendered content. Plain text is compared after whitespace folding; complete numbered lists also require matching HTML list structure and item text. Join replay and buffered history do not count as live streaming. |
| Restart durability | Restarted the actual owned Electron and core processes. The same native view/channel/thread, two user/assistant message pairs, text, effective model and effort reopened without a replacement prompt. |
| Approve and deny | Native Allow once and Deny acted on requests from the original server policy gateway. A temporary rule asked only for writes to a unique synthetic test folder. The authoritative request/result trail and an independent read in the owned computer confirmed the approved 37-byte marker and absent denied file. The rule was revoked; personal preferences were unchanged. |
| Activity and tool failure | Durable approval results show complete/refused correctly. A deliberate read of a unique nonexistent file showed failed; a following plain turn succeeded. |
| Stop and continue | Clicked native Stop after 27 live text deliveries, then completed another turn in the same thread. No false connection error appeared. |
| Runtime failure and retry | Stopped only the existing owned agent harness, received a real `RUN_ERROR`, and retained the draft while navigating to Jira and back. Restored the same container, checked native readiness, and sent the retained draft. History contained one copy of the prompt. The automatic-start preference was restored. |
| Connection interruption | Terminated only the scratch app's verified private SSH child. The native connection error appeared in 68 ms, retained the draft and blocked another send. Reconnect recovered the original run without resending; final saved and rendered text matched, with one user prompt. The reference and T3 forwards were untouched. |
| Navigation and themes | Native Chat sidebar, Ctrl+P search, Escape, Ctrl+N and a named visible Tab target were exercised. Dark/Light/Lavender changed the existing theme tokens; screenshots were inspected. Original Auto/Default preferences were restored. Unsent text and an uploaded disposable file now survive page and Jira navigation. The staged file was removed afterward. |
| Documents and datasets | Native Document/Grid navigation and typed view metadata passed. Real-core tests created Unicode document text and a database row/cell, restarted the core and read the same identities/content. Editing bodies remain pre-existing placeholders, as explained below. |
| Jira | Native dashboard navigation and return to the same saved chat passed. Repository client/mapping/store regressions pass. No Jira credentials or real external issue mutation were used. |
| Lifecycle and prerequisites | [Issue #7's lifecycle evidence](HYPER_OPENBOT_LIFECYCLE.md) covers actual Stop/Start/Restart, auto-start, disabled startup persistence, unchanged stores/owner and untouched shared AppFlowy. Ten controlled helper/controller scenarios cover missing Docker/deployment, unsafe deployment, unhealthy services, Intelligence, entitlement and provider setup. These simulated prerequisites are distinct from real lifecycle and runtime interruption tests. |
| Identity and credentials | Existing main-only identity/owner/cookie/tunnel guards remain. Draft tests clear memory leases on trusted sign-out/profile rejection and reject stale asynchronous writes. No renderer API accepts credentials, arbitrary commands or an unrestricted Rust/Jira tool. |

Repository validation passed **569 tests**, with one optional simulated-IPC live test skipped. Four tests use the unchanged real core binary. The native runner/launcher have **10 additional Node safeguard tests**. Typecheck and production frontend build passed. No Rust rebuild, Electron download or new backend deployment was needed.

The seven earlier component-browser scenarios used mocked backend responses. They remain useful state regressions but are not counted as live approval/tool proof. Model/approval/runtime/transport results in this report came from the actual native window and original runtime.

## Corrections found during acceptance

Saving the default model previously left its label blank because the native UI assumed a non-null response. A native probe reproduced the blank label. The new mapping follows the original nullable default contract; live model switching and restart checks passed afterward.

Unsent text previously disappeared when native page navigation unmounted Chat. A memory-only per-conversation cache now retains text, ready server attachment references, upload group and retry message identity. Functional updates preserve newer edits/files when an older send finishes. Authentication changes invalidate leases and reject delayed upload writes. The cache retains no File objects, file bytes, previews or credentials, and it is discarded when the renderer exits. Native navigation with an actual staged text file, a real failed-run retry after navigation and transition tests passed.

Codex review then identified a completed retry identity retained by a reopened page's local ref. A real native test reproduced one saved user turn after two explicit identical submissions. Retry-ID selection now reads the shared cache when submitting, including clears from an older page. The native race recheck on `b3dec85da03bdfdda33a657e3546813ef9f0b7d5` reopened Chat before the original run completed and saved two distinct user IDs after the explicit repeat. A transition regression and trusted-auth rejection checks pass. An initial recheck was inconclusive because a prior run's terminal event reached the observer; the final check follows the new run ID.

Failed first attempts are retained privately and are not presented as passes. The initial smoke exposed the nullable-model bug. An initial UI probe correctly failed under CSP when it tried to inject a script element; the controlled developer test now uses CDP evaluation without changing the application's CSP. That attempt also exposed draft loss. A first container read used the wrong workspace root; the final filesystem proof uses the original seat-scoped path and checks confinement.

CodeRabbit's test-tool findings are also corrected. Completion now waits for the requested new thread/run/socket, with an interleaved-socket regression. Restart waits for the tracked owned core processes to exit and refuses a replacement after a bounded timeout; delayed-exit and unrelated-process tests pass. The after phase now compares the visible restored model label against its catalogue entry.

A fresh before/after smoke on tooling commit `7ab4f7d16da4caa2237c5ee91e2575c3a1c2f429` received 106 and 43 live text deliveries, then restored the same identities/content and visible model label after an actual app/core restart. The production source remains the already-built `b3dec85` retry fix. No renderer exception or replacement prompt occurred. A prior tool refresh failed when the model returned a numbered Markdown list: CSS list markers are absent from `innerText`. The corrected visible-content check accepts either exact plain text or a complete ordered list with matching numbering, start, item count and every item. It still requires exact raw streamed/saved text. Those failed attempts are not acceptance evidence.

## Repeating the smoke test

Use an already provisioned, authenticated private backend and a disposable HyperTask profile owned by the same native identity. Do not use a real work profile. These commands intentionally create synthetic conversations and consume real provider access. They never accept agreements, obtain credentials, provision services, install dependencies or remove stores. A fresh native profile must first complete the normal native sign-in and trusted owner setup; do not reset or copy another profile's binding.

From `frontend/appflowy_electron`, set paths to existing installations:

```sh
export APPFLOWY_CORE_BINARY=/absolute/path/to/appflowy_core
export HYPER_ELECTRON=/absolute/path/to/electron
export HYPER_PLAYWRIGHT=/absolute/path/to/node_modules/playwright-core
export HYPER_SMOKE_ROOT=/absolute/path/to/private-smoke-directory
mkdir -p "$HYPER_SMOKE_ROOT/evidence"
chmod 700 "$HYPER_SMOKE_ROOT" "$HYPER_SMOKE_ROOT/evidence"

npm run typecheck
npm test
npm run build
node --test scripts/HyperNativeOpenBotSmoke.test.mjs scripts/HyperNativeSmokeLaunch.test.mjs

python3 -B scripts/HyperNativeSmokeLaunch.py \
  --profile "$HYPER_SMOKE_ROOT/profile" \
  --status "$HYPER_SMOKE_ROOT/evidence/status.json" \
  --core "$APPFLOWY_CORE_BINARY" --electron "$HYPER_ELECTRON" \
  --allow-test-profile
```

The current local development Electron installation requires an explicit `--development-no-sandbox` process flag. Use it only for the disposable development app when required by that installation. It changes no system or source sandbox configuration and establishes no production packaging acceptance.

Once the native profile and AI readiness are available:

```sh
node scripts/HyperNativeOpenBotSmoke.mjs --phase before \
  --status "$HYPER_SMOKE_ROOT/evidence/status.json" \
  --playwright-module "$HYPER_PLAYWRIGHT" --agent 'Personal Assistant' \
  --output "$HYPER_SMOKE_ROOT/evidence/before.json" --allow-test-data

python3 -B scripts/HyperNativeSmokeLaunch.py --restart \
  --profile "$HYPER_SMOKE_ROOT/profile" \
  --status "$HYPER_SMOKE_ROOT/evidence/status.json" \
  --core "$APPFLOWY_CORE_BINARY" --electron "$HYPER_ELECTRON" \
  --allow-test-profile

node scripts/HyperNativeOpenBotSmoke.mjs --phase after \
  --status "$HYPER_SMOKE_ROOT/evidence/status.json" \
  --playwright-module "$HYPER_PLAYWRIGHT" \
  --before "$HYPER_SMOKE_ROOT/evidence/before.json" \
  --output "$HYPER_SMOKE_ROOT/evidence/after.json" --allow-test-data
```

Carry the same development sandbox flag on both launch commands if needed. Supply another existing native bot name with `--agent` if appropriate. Use `--help` for optional model/effort selection. Outputs are exclusively created with mode 0600; use new names for another attempt. A failed artifact is diagnostic evidence, never acceptance. CDP attaches only to the recorded owned Linux app/profile/debug port and its core. The scripts detach without closing the browser. The launcher signals only a matching owned process; it refuses another checkout/profile/port and keeps the same stores.

For action and fault reproduction, follow [the action procedure](HYPER_OPENBOT_ACTIONS.md) and [the lifecycle procedure](HYPER_OPENBOT_LIFECYCLE.md). Use a unique disposable marker folder, the original gateway's ask rule and native approval cards. Verify both the authoritative result/audit and confined filesystem, then revoke the rule. Do not replace those proofs with mock events. Interrupt only the verified scratch app SSH child, or stop only the inspected, project-labelled existing harness; always restore it and verify readiness/preferences. Never use upstream broad cleanup on this host.

## Known limits and owner checkpoint

- Document, Grid, Board and Calendar bodies are placeholders in this Electron port. The epic adds only the Chat renderer registration; comparison with the pre-epic registry confirms the other renderers were already placeholders. Core data and navigation checks pass, but a complete document/dataset editing workflow cannot be claimed.
- Escape closes the pre-existing command palette but leaves BODY focused instead of returning to the composer, including after two animation frames. Search input focus and named composer Tab navigation work. Full screen-reader, WCAG and production packaging audits remain outside these checks.
- This is a Linux development connection to one provisioned personal VM and the original local native owner. Remote native-account provenance, ownership transfer and portable Windows/macOS lifecycle are unsupported and fail closed. The owner binding must not be reset to bypass that restriction.
- Drafts survive navigation only during the renderer session. They intentionally do not persist across process exit. Ready attachment references are retained; in-progress uploads are not advertised as durable drafts.
- Readiness detects a missing provider store, not whether an existing OAuth token will remain valid. Live turns prove provider access at capture time. Real license/credential corruption was not performed; the missing-prerequisite cases are simulated tests.
- No real Jira mutation or external connection authorization is claimed. No model received unrestricted local Rust-core or Jira access.

[Issue #8](https://github.com/NaveDanan/HyperTask/issues/8) requires: "Owner review confirms whether the stable integration baseline is ready for subsequent HyperTask-specific features and, later, Intelligence replacement." The owner must decide whether this demonstrated baseline and its recorded limits are acceptable. Until that decision and exact-head PR reviews pass, issue #8 and the epic remain open.

## Offline boundary, dependencies and notices

Phase 1 still needs the VM, Tailscale/SSH reachability, Docker networks/stores, original Intelligence runtime and its license/account requirements, and real provider access. Saved local HyperTask data does not make model operation permanently offline. Closing the desktop leaves the backend running. Service controls manage only the owned stack.

Later air-gapped work must account for:

| Dependency | What a later replacement/distribution must address |
| --- | --- |
| CopilotKit Intelligence and AG-UI transport | Original gateway/event/session/history behavior, durable threads, licensing/control-plane requirements and server policy/audit continuity. Replacing Intelligence is not implemented here. |
| ChatGPT OAuth and hosted model | Internet authentication, refresh and inference. Select and validate a local provider later, without putting credentials in the renderer. |
| OpenBot server, worker, computer and PostgreSQL | Preserve channel/person/bot/policy/vault/queue data, seat confinement, approval/audit semantics and both OpenBot/Intelligence stores. |
| Docker, k3d/Kubernetes and images | Supply trusted architecture-compatible images, resolved digests, storage/loopback isolation, upgrades and backups. Existing source/build records include mutable dependency inputs and do not prove reproducible image builds. |
| Bun/Node/Python/Rust, browser and package dependencies | Provide verified offline artifacts and license notices. Current smoke reuses existing installations; it is not an offline installer. |
| Tailscale/SSH and optional connectors/MCP/OAuth | Replace or provision network discovery/trust and any selected external service. Optional integrations are not established as air-gap compatible. |

[The audit](HYPER_OPENBOT_AUDIT.md), [VM pins](HYPER_OPENBOT_VM.runtime.json), [reuse mapping](../src/renderer/features/hyper-openbot/REUSE.md), copied MIT [license](../src/renderer/features/hyper-openbot/LICENSE), component-specific notices and repository license remain authoritative records. This change preserves those notices, dependency names, protocol identifiers and data paths. PR #1 remains isolated optional reference and is not wholesale merged. HyperTask was developed by NaveDanan.
