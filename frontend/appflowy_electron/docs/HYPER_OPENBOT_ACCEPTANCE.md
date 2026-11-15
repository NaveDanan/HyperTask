# Native OpenBot acceptance

[Issue #8](https://github.com/NaveDanan/HyperTask/issues/8) validates the original OpenBot and CopilotKit Intelligence inside HyperTask. The automated/native checks below passed. On 2026-11-14 the owner reviewed the running native demo, its known limits and the upstream differences below, and requested native parity with the upstream OpenBot app before acceptance. Parity work is in progress on this branch; this report does not declare phase 1 complete.

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

Repository validation passed **569 tests**, with one optional simulated-IPC live test skipped. Four tests use the unchanged real core binary. The native runner/launcher have **13 additional Node safeguard tests**. Typecheck and production frontend build passed. No Rust rebuild, Electron download or new backend deployment was needed.

The seven earlier component-browser scenarios used mocked backend responses. They remain useful state regressions but are not counted as live approval/tool proof. Model/approval/runtime/transport results in this report came from the actual native window and original runtime.

## Corrections found during acceptance

Saving the default model previously left its label blank because the native UI assumed a non-null response. A native probe reproduced the blank label. The new mapping follows the original nullable default contract; live model switching and restart checks passed afterward.

Unsent text previously disappeared when native page navigation unmounted Chat. A memory-only per-conversation cache now retains text, ready server attachment references, upload group and retry message identity. Functional updates preserve newer edits/files when an older send finishes. Authentication changes invalidate leases and reject delayed upload writes. The cache retains no File objects, file bytes, previews or credentials, and it is discarded when the renderer exits. Native navigation with an actual staged text file, a real failed-run retry after navigation and transition tests passed.

Codex review then identified a completed retry identity retained by a reopened page's local ref. A real native test reproduced one saved user turn after two explicit identical submissions. Retry-ID selection now reads the shared cache when submitting, including clears from an older page. The native race recheck on `b3dec85da03bdfdda33a657e3546813ef9f0b7d5` reopened Chat before the original run completed and saved two distinct user IDs after the explicit repeat. A transition regression and trusted-auth rejection checks pass. An initial recheck was inconclusive because a prior run's terminal event reached the observer; the final check follows the new run ID.

Failed first attempts are retained privately and are not presented as passes. The initial smoke exposed the nullable-model bug. An initial UI probe correctly failed under CSP when it tried to inject a script element; the controlled developer test now uses CDP evaluation without changing the application's CSP. That attempt also exposed draft loss. A first container read used the wrong workspace root; the final filesystem proof uses the original seat-scoped path and checks confinement.

CodeRabbit's test-tool findings are also corrected. Completion now waits for the requested new thread/run/socket, with an interleaved-socket regression. Restart waits for the tracked owned core processes to exit and refuses a replacement after a bounded timeout; delayed-exit and unrelated-process tests pass. The after phase now compares the visible restored model label against its catalogue entry.

A fresh before/after smoke on tooling commit `7ab4f7d16da4caa2237c5ee91e2575c3a1c2f429` received 106 and 43 live text deliveries, then restored the same identities/content and visible model label after an actual app/core restart. The production source remains the already-built `b3dec85` retry fix. No renderer exception or replacement prompt occurred. A prior tool refresh failed when the model returned a numbered Markdown list: CSS list markers are absent from `innerText`. The corrected visible-content check accepts either exact plain text or a complete ordered list with matching numbering, start, item count and every item. It still requires exact raw streamed/saved text. Those failed attempts are not acceptance evidence.

Codex security review identified that the earlier loopback TCP debugger could be reached by another local Linux account. That owned debugger app was stopped. The launcher now passes only `--remote-debugging-pipe`; it has no TCP debugger option or fallback. A broker relays the inherited pipe through a single-use Unix socket in an owned mode-0700 directory, with a mode-0600 socket. Launcher/runner checks require the original app/profile, random pipe session, matching UID and protected paths. The broker removes the endpoint when the first client connects, closes the relay on disconnect and expires an unused lease after twenty minutes. Tests reject bad directory permissions and UID mismatch, exercise the real Unix socket exchange/removal/expiry and verify that the broker closes its own parent log descriptor after spawning the child.

The secured before/after smoke on `7f18cccce7d526e585186087bffcae0c91d21b75` passed with 89/56 live text deliveries, same saved identities/content and visible model label after app/core restart. Process/socket inspection found no TCP listeners owned by Electron or the broker; the Unix endpoint was absent after use, while HyperTask remained open. No cross-account OS process was created for a negative connection attempt; the UID/mode guards and actual filesystem/socket lifecycle were tested. Earlier loopback captures remain historical functional evidence, not proof of debugger isolation, and their private TCP launchers/drivers must not be reused. Initial pipe attempts exposed a parent log-handle cleanup error under Node 25; explicit closure and a child-output/parent-descriptor regression fixed it before the passing capture.

[Electron's pipe implementation](https://github.com/electron/electron/blob/main/shell/browser/electron_browser_main_parts.cc) quits the browser when its debugging pipe closes. The broker therefore retains only its inherited private pipe handles so the native app can stay open after testing. The filesystem endpoint and relay client are closed; no externally reachable debugger remains.

The launcher also clears inherited `ELECTRON_RENDERER_URL` alongside `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS`. A deliberate harmless data-URL override was set for the native launch on `a2c7be163e4586fecfed88c42ca06f6c6a211b86`; the built renderer, same saved messages and visible model label restored successfully with no replacement prompt. Both launcher safeguard tests passed again.

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
node --test scripts/HyperNativeOpenBotSmoke.test.mjs scripts/HyperNativeSmokeLaunch.test.mjs scripts/HyperNativeSmokeBroker.test.mjs

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

Carry the same development sandbox flag on both launch commands if needed. Supply another existing native bot name with `--agent` if appropriate. Use `--help` for optional model/effort selection. Outputs are exclusively created with mode 0600; use new names for another attempt. A failed artifact is diagnostic evidence, never acceptance. CDP attaches only through the recorded private Unix socket and inherited pipe for the owned Linux app/profile/session and its core. Each launch permits one debugger client. Do not attach a preliminary inspector before the smoke phase; relaunch the owned app for another test connection. The scripts detach without closing the native app and remove the debugger endpoint. The launcher signals only a matching owned process, refuses another checkout/profile/session or TCP-debugger process, and keeps the same stores.

For action and fault reproduction, follow [the action procedure](HYPER_OPENBOT_ACTIONS.md) and [the lifecycle procedure](HYPER_OPENBOT_LIFECYCLE.md). Use a unique disposable marker folder, the original gateway's ask rule and native approval cards. Verify both the authoritative result/audit and confined filesystem, then revoke the rule. Do not replace those proofs with mock events. Interrupt only the verified scratch app SSH child, or stop only the inspected, project-labelled existing harness; always restore it and verify readiness/preferences. Never use upstream broad cleanup on this host.

## Known limits and owner checkpoint

- Document, Grid, Board and Calendar bodies are placeholders in this Electron port. The epic adds only the Chat renderer registration; comparison with the pre-epic registry confirms the other renderers were already placeholders. Core data and navigation checks pass, but a complete document/dataset editing workflow cannot be claimed.
- Escape closes the pre-existing command palette but leaves BODY focused instead of returning to the composer, including after two animation frames. Search input focus and named composer Tab navigation work. Full screen-reader, WCAG and production packaging audits remain outside these checks.
- This is a Linux development connection to one provisioned personal VM and the original local native owner. Remote native-account provenance, ownership transfer and portable Windows/macOS lifecycle are unsupported and fail closed. The owner binding must not be reset to bypass that restriction.
- Drafts survive navigation only during the renderer session. They intentionally do not persist across process exit. Ready attachment references are retained; in-progress uploads are not advertised as durable drafts.
- Readiness detects a missing provider store, not whether an existing OAuth token will remain valid. Live turns prove provider access at capture time. Real license/credential corruption was not performed; the missing-prerequisite cases are simulated tests.
- No real Jira mutation or external connection authorization is claimed. No model received unrestricted local Rust-core or Jira access.

[Issue #8](https://github.com/NaveDanan/HyperTask/issues/8) requires: "Owner review confirms whether the stable integration baseline is ready for subsequent HyperTask-specific features and, later, Intelligence replacement." The owner inspected the running native demo, these limits and the upstream differences below on 2026-11-14 and requested native parity for the unavailable features before acceptance. Issue #8 and the epic remain open until parity is delivered, the owner accepts it and the exact final head passes review.

## Differences from upstream OpenBot

### Parity implementation checkpoint

The owner has asked to finish parity, resolve review findings and merge before the next stage. This instruction authorizes that work; it is not evidence that unfinished features passed acceptance.

All thirteen specialist source branches are integrated into the PR branch. Vault adds saved-login management, key creation/replacement/revocation and private sign-in requests, including verification codes, saved-login confirmation and takeover, with a shared Bot-computer destination. The caption buttons cover Linux and Windows, while macOS keeps its native controls. The sidebar collapses to a keyboard-accessible icon rail with the existing Chat entry. These additions have automated coverage; integrated native verification remains pending.

The upload review fixes retain channel-scoped uploading placeholders and count each file once toward the eight-file limit, including rapid picks before React renders again. The regression exercises the real composer file-input handler and the draft cache. The native smoke list check also accepts consecutive numbered items, and the broker safeguard starts waiting for child exit before descriptor inspection.

Settings, Onboarding and Approvals add personal Activity, profile/preferences, repository settings, native Home/Setup/tour, approval history, standing-rule recovery and notification settings. Home draft transfer is awaited through creation, upload and optional send, with failure/cancellation recovery. Groups, delivery controls, dictation, both voice transports, queue/marks/subagent behavior and authenticated durable voice recovery are integrated.

Computer/browser includes live controls, terminal/files/folders, narration, recorder pairing/history, private handoffs and the shared Bot computer destination. Governance adds People, inherited permissions, boundaries/replay, SSO/SCIM controls, audit/what-if, team rules/shared-use decisions and reviewer guidance. Memory/Learning adds facts/sources, review/sharing, container participation, delivery details, capability changes and recording provenance. Bot detail/attention tabs, routines/responsibilities, all fifteen gallery tools, sandboxed screens and provider/plugin/skill administration are integrated. Protected main-owned callback-key/browser-return handling and full nested detail-page/access-component wiring still remain.

The voice broker preserves the configured x.ai model query in main, permits only the original provider destination/model parameter and returns only expected WebRTC SDP fields. Canonical-path checks keep headers and masking active when a request includes a query string. Tests cover these boundaries. Tauri-only local update/container/native-speech controls have no equivalent in this remote architecture and remain explicit environment limits.

Protected native key creation/rotation/revocation and browser returns are now integrated. Key bytes stay in main-owned dialogs; Copy key writes the OS clipboard only after an explicit native choice and another owner check. Generic renderer key-creation HTTP remains blocked. The pinned browser return is credential-free `openbot://open`; native navigation refreshes authoritative connection state and does not claim success based on return alone. No OS protocol association was changed. Most nested selections/access components and versioned Home ownership are integrated; standalone Memory-source and deeper admin destinations remain pending.

Standalone Memory-source and remaining admin destination consumers are now integrated. Current validation on source head `618c3c0`, Node 24.18.1: typecheck, production build, 1198 tests and 13 smoke-script safeguards pass. One opt-in simulated-IPC live test is skipped; the four real-core tests ran. The upstream terminal packages `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 are locked; existing package versions were unchanged. Review regressions cover receiver remount/upload deduplication and recording outage/recovery page boundaries. The following matrix describes integrated code, not a claim that every new screen passed native acceptance.

The current native attempt launched the real app from `8789875` using the retained test profile and private pipes, but failed the AI-readiness deadline with no renderer exceptions. The fixed backend check then reported Tailscale SSH's additional human authentication requirement. That attempt is not a pass. No network-policy bypass, identity reset or alternate credential route was used. The owned app was subsequently relaunched on `cd8dc33`, then `7a3b91b`, with its stores retained. A fresh secure sign-in request timed out, and an independent SSH recheck still requires the account-holder check. Native acceptance remains blocked until that check succeeds. Sign-in URLs and private diagnostic artifacts are not committed.

Independent Standards review found three design violations and a duplicated Playground implementation. `86caf78` fixes them. Separately, Spec found renderer trigger-key delivery, arbitrary shared-membership authoring and a missing Access-to-Apps route. `cd8dc33` fixes those source defects. Trigger create/reveal/rotate routes now require native confirmation and strip returned secrets before response bytes cross IPC. Main-owned dialogs can copy a generated key or its Authorization header only after an explicit native choice and a renewed owner check. Renderer pages hold no generated/revealed key, and failed response bodies are sanitized. Shared memberships remain server-proposed; legacy Access opens Apps. Regression tests cover these paths. Corrected-source reviews, native verification and owner acceptance remain required.

Seven later Codex findings are fixed in `7a3b91b`. Admin exports warn about truncated CSVs, stale permission/source results cannot restore revoked components, Settings Activity stays selected through workspace updates, and file replacement rechecks its confirmed path and contents. Connection credential forms retain their response across nested native navigation. SMS challenges restore only for their owner/channel/Bot, and late responses cannot populate another context. Group chat matches pinned upstream by withholding submission during a turn rather than parking a message with lost recipient information. Seven regressions failed before the fixes; ten focused cases pass afterward. These source results do not replace native verification or fresh review receipts.

The independent recheck at `5dda63a` retained one Standards violation in two chart marker radii. `309d26a` fixes it with rendered regressions for line/area and pie legends. Spec confirmed the earlier source corrections but disclosed incomplete coverage of the 401-file diff because large tool output was truncated. It confirmed no additional defect in the inspected paths, not full Spec clearance. Bounded full-diff coverage remains required alongside exact-head code/security review, native verification and owner acceptance. GitHub's checks on the older `ece4710` were both skipped despite a non-failing notification: CodeRabbit hit its file limit and Macroscope hit its unchanged review-cost cap. No review bypass, billing change or ignore change was made.

`2062e53` fixes six later Codex findings and two findings from the completed small Spec pilots. Home routing is canceled when its navigation scope is abandoned, before conversation creation. Shared-access confirmation is bound to the displayed target, Memory editing is locked during saves, and incoming Skills routes no longer emit navigation feedback. Leaving a single-Bot conversation restores unsent queued text, command IDs and staged references to its owner-bound draft instead of deleting them. This requires explicit sending after return, not background delivery. Home drafts survive same-owner service restarts; a renderer-lifetime observer still clears them at trusted identity rejection even outside Chat. Invalid forms retain the original decision-recovery response. Admins can explicitly confirm the shared broker account after vendor consent; the server resolves its holder.

Nine regressions failed before these corrections and pass afterward, alongside additional guard cases. The owned disposable app was relaunched on this source with its stores retained; a fresh SSH check still requires the account-holder Tailscale step. No new native smoke, real key or vendor-consent pass is claimed. All nineteen notified historical CodeRabbit threads were already resolved. Security receipt `6887269682` is clean for `b8452ef`, but does not approve newer source. Full-diff coverage, exact-head reviews, native verification and owner acceptance remain outstanding.

The bounded rechecks of `5e5cc7f` completed all eight assigned files and found two unmount gaps. `993d9a1` restores late failed sends through the owner draft instead of a discarded local queue, retaining the complete queued/live snapshot and matching retry identity. It also expires shared-grant scope on unmount and checks all single/bulk/batch writes before HTTP, without undoing already accepted operations. Three failing-before/passing-after regressions and additional joined-send/identity cases cover these changes. The retained disposable app runs this source, but that relaunch is not native acceptance. Source rechecks and account-holder authentication remain required.

The next eight-file rechecks at `7e590c3` confirmed the grant-lifetime correction and found mounted draft recovery and Skills deletion navigation gaps. `ffdb5fd` restores failed text ahead of newer text, merges both sets of skill selections and returns successful personal/admin deletion to the list route. Three regressions fail before and pass after these fixes. Source tests now pass 1106 with one optional skip; the disposable app was relaunched on this code with stores retained. This remains source evidence, not native/owner acceptance or complete Spec clearance.

The next rechecks at `0cb1cc4` confirmed those two corrections and found Connections ownership/reconciliation gaps. `877a354` binds mode preview and destructive action to the displayed app/navigation epoch and resets stale incoming-route confirmations. Configured broker accounts are confirmed through the original provider-status endpoint on arrival/remount and once on focus after browser consent, with shared admin authority and no client-supplied holder. Readback reloads recorded state; provider failures keep that state with generic retry guidance. Key rechecks are not automatic. Six red/green regressions and a capability-carrier case pass. The owned app runs this source, but fresh SSH still requires the account-holder Tailscale step, so native consent/acceptance remains unverified.

`816e874` fixes five further Codex findings after six reproducing regressions. Check-in focus and interval remain one local draft until Save changes. Network policy parsing recognizes actual IP/CIDR syntax without misclassifying hexadecimal DNS names. Main closes a slow voice socket before queued outbound speech exceeds one MiB, without changing ordinary gateway limits. Credential-free launch returns wait for readiness and still use native identity checks/confirmation. Channel-scoped active file IDs survive remounts, so follow-ups cannot reuse or discard an original send's files. Late-queue and group-recovery reports describe superseded code; current production-handler regressions pass. Source checks total 1127 passing/one optional skip with four real-core cases, typecheck/build and thirteen safeguards. The disposable app runs this code with stores retained, not a new native acceptance pass.

`8408d03` fixes the two app/shared access-request lists after six regressions reproduced rows and approvals crossing app selections, reordered readbacks, and cached callbacks after unmount. `HyperAccessRequestList.ts` binds rows, read generations and decisions to one mounted app selection. Old rows hide immediately; late reads and deferred actions check that scope before HTTP. Only matching app/server rows render, and obsolete decision settlement cannot restart an old read. Sixteen additional cases cover valid approve/dismiss/decline, failed-read recovery, same-app reordering and delayed execution. All 1149 tests pass with one optional skip, four real-core tests, typecheck/build and thirteen safeguards. The owned disposable app runs this source with stores retained, without a new native acceptance claim.

The three lifecycle rechecks at `26d4969` fully inspected their seven assigned files and found no confirmed defects. At `8408d03`, their byte-identical files carried forward with the earlier inspected files: 84 of 408 changed files were covered, 324 remained. This was not exhaustive Spec clearance or exact-final-head code/security approval. Account-holder Tailscale authentication, full native verification and owner acceptance still block merge.

The four-file request-scope recheck at `08a7e1a` confirmed the inbox corrections and found one remaining race in the Bot app-access card. `bb9e451` binds that card's access snapshot, reads, busy/error feedback and callbacks to a mounted Bot/app/admin selection. Old state hides before effects; reordered reads cannot replace the current card; withdrawal, request, give/take-back, admin grant, setup and refresh callbacks check the current snapshot and lifetime. Obsolete mutation settlement cannot reload the old Bot/app. Seven regressions failed before the correction and pass after it; fourteen guard cases preserve current actions, error recovery and StrictMode cleanup. All 1170 tests pass with one optional skip, four real-core tests, typecheck/build and thirteen safeguards. The disposable app runs this source with stores retained, without a new native acceptance claim. The modified card still needs fresh review; the other two bounded batches continue on byte-identical files. Native verification and owner acceptance remain outstanding.

The card-correction checkpoint carried 86 byte-identical inspected files in the 408-file diff, leaving 322. The changed card and its updated reuse documentation require recheck. A reproduced source fix is not independent review clearance.

`073c694` fixes four further Codex findings after reproducing tests. `HyperVoiceControls` now separates start readiness from continuation: history restoring blocks a new call without ending a connected one, while service loss, inactive channels, reconnect requirements, unmount and explicit End still stop the session. Each shared-audience editor has a stable instance-specific radio group. The native Bots panel forwards the existing conversation callback to its attention board and selected editor. Twenty-two intended form action buttons across seventeen screens now explicitly submit through the existing validation and handlers. The real Base UI button's non-submit default and a JSX-wide guard reproduce this porting defect; no global Button behavior or dependency version changed.

Four red regressions and six additional guards pass, including native voice-policy wiring, hard continuation denial and a real Memory save handler. All 1180 source tests pass with one optional skip, four real-core tests, typecheck/build and thirteen safeguards. The owned disposable app runs `073c694` with stores retained, not a native acceptance pass. Current coverage carries 83 byte-identical inspected files in a 409-file diff, leaving 326; modified previously inspected files lose carried coverage. Exact-head reviews, remaining bounded inspection, account-holder Tailscale authentication, full native workflows and owner acceptance still precede merge.

The last two bounded reviews at `08a7e1a` inspected all five assigned files and found three Spec issues. `618c3c0` corrects them. Native Chat reads the selected Bot's authoritative `runsOnOpenBotModel` capability before loading or exposing model/effort choices. False, missing, nonboolean, mismatched or failed capability reads cannot enable the picker. Managed harnesses with `builtIn: false` remain supported when the server flag is true. Channel/Bot lifetime and read-generation guards reject cached pickers and late capability, catalogue or save callbacks; old settlement cannot unlock a newer save. An open routine run with null status now displays Running, distinct from no run or succeeded/failed/skipped. The reuse notes no longer claim immediate interval writes and describe the joint local Focus/How often draft.

Five reproducing regressions and thirteen guard cases pass. Full validation is 1198 passing tests, one optional skip, four real-core tests, typecheck/build and thirteen safeguards. The disposable app runs `618c3c0` with stores retained, without new native acceptance. The completed ledgers carry only their two byte-identical network files into current coverage: 85 of 409 files are inspected and unchanged, 324 remain. Changed Chat/routine files still need fresh review. Original Intelligence, server authority, owner binding and all native/owner acceptance gates remain unchanged.

The complete original OpenBot backend and Intelligence run on the VM. HyperTask exposes a selected part of the original app's roughly ninety routes at the pinned source. The main-process route allowlist in [hyper-openbot-policy.ts](../src/shared/hyper-openbot-policy.ts) admits only the API families those native screens use, so unlisted features are unreachable from HyperTask even though the backend provides them. Phase 1 scoped chat, agents, tools, approvals, streaming and service lifecycle; the epic directs later work toward HyperTask components rather than duplicate OpenBot screens.

| Upstream feature | HyperTask native support |
| --- | --- |
| Single-Bot conversations: create, reopen, pin, delete | Available |
| Composer: model, effort, attachments, Send, Stop | Available |
| Streaming transcript and authoritative saved history | Available |
| In-conversation approvals: Allow once, Allow for this conversation, Always allow here, Deny, I did it myself | Available |
| Bot questions | Available |
| Bots: roster, create, profile editing, Pause/Resume, notifications, hidden Bots | Available |
| Skills: create, edit, delete, grant to Bots | Available |
| Connections: directory, Add app, MCP server by URL, start external sign-in | Accounts, grants, setup, native return and typed nested selections integrated; live consent verification pending |
| Bot computer | Integrated status, screenshots, live input/takeover, terminal, files/folders, narration and recording; native verification pending |
| Original computer tools (navigate, read, snapshot, type, click, key, list/read/write files, run command, scroll) | Available through the original approval gate |
| Group conversations with several Bots | Integrated; native verification pending |
| Routines: schedules, goals, check-ins | Integrated, including Bot routine/responsibility tabs and protected native trigger-key delivery; native verification pending |
| Memory and Automatic Learning | Integrated facts, sources, review, sharing, participation and capability controls; native verification pending |
| Per-Bot access, sharing, reach, responsibilities, apps and activity tabs | Integrated with protected native callback-key actions; native verification pending |
| Cross-conversation approvals inbox | Integrated with decisions/questions, standing rules, history and routing; native verification pending |
| Vault and passwords | Integrated with key/login management and private sign-in forms; native verification pending |
| Bot browser page | Integrated with recorder pairing/history and live controls; native verification pending |
| Generated interactive screens opened as pages | Fifteen tools, SDK registration, decision lifecycle, grant checks and sandboxed screens integrated; native verification pending |
| Personal settings: notifications, learning, browsers, this computer, connected accounts | Integrated with nested destinations for the remote backend; native verification pending; Tauri-only local controls remain unavailable |
| Administration: people, permissions, boundaries, audit, providers, credentials, plugins (Arcade/Composio), computers, playground, what-if | Integrated with protected callback return and nested destinations; native verification pending |
| Onboarding wizard and starter tour | Integrated with Home drafts and native destinations; native verification pending |

This table supersedes the earlier owner's-demo difference list. It separates source integration from actual native acceptance. The owner requested completing these workflows before merge; that gate remains open.

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
