# Native OpenBot chat in HyperTask

Tracking [issue #5](https://github.com/NaveDanan/HyperTask/issues/5), [PR #11](https://github.com/NaveDanan/HyperTask/pull/11). Updated 2026-11-14. The original backend baseline merged in [PR #10](https://github.com/NaveDanan/HyperTask/pull/10), commit `a7e05b3df815a7ae82f078ee3c3a55e390912eca`.

The real HyperTask Electron window now hosts OpenBot conversations, transcript and composer. A live native-window check passed sending, incremental response, authoritative saved history and reopening the same conversation after an app/core restart. This completes the narrow chat proof, with review still required before merge. It does not complete the epic or the later tool, approval and lifecycle acceptance.

## Implementation and reuse

The feature lives under `src/renderer/features/hyper-openbot`. Its [reuse map](../src/renderer/features/hyper-openbot/REUSE.md), subdirectory maps and [license](../src/renderer/features/hyper-openbot/LICENSE) identify the original OpenBot files at `f8af37ab73e96784f174a11104505a965e722cab` and retain CopilotKit's MIT notice. HyperTask remains developed by NaveDanan.

- Chat uses the existing native sidebar, folder view, plugin and tab system. No foreign sidebar, application shell, iframe, global CSS or theme was imported.
- The original CopilotKit provider/AG-UI contracts, thread validation, stored-message merge, streaming Markdown/code and composer behavior are adapted to HyperTask's existing primitives and tokens.
- Conversation paging, saved selection, model/effort choice, attachment staging and compound message presentation use original server contracts. Internal system instructions remain in agent context and are excluded from the visible transcript.
- Bot profile/lifecycle/creation, skill editing/grants, connection directory/authorization initiation, tool activity, approval/question cards and read-only computer status/screenshot components are included. Availability and permissions remain server-controlled. These components need the separate issue #6 action-flow acceptance.
- Existing native settings, Jira credentials, Rust event names, data paths and window controls are preserved. The extra direct packages are pinned and justified by their actual original-runtime, Markdown, schema or secure transport imports in the reuse map.

## Connection and identity

The main process owns an SSH connection to the authorized development VM, authenticated using the existing OS SSH key/known-host configuration. It creates a randomly named private `0700` directory and Unix socket. HTTP and Phoenix WebSocket traffic use that socket exclusively; the original public reference forward on port 3010 is untouched. Fixed routes, original Origin checks, request-size limits and finite deadlines apply. Binary bodies remain bytes across IPC.

The trusted main process reads the current identity directly from the native core's `GetUserProfile` response. It binds this personal backend to its first native owner in a `0600` file under a `0700` directory. Cookies use a separate Electron partition for that identity. A different native identity is denied before backend access, including when the original personal backend requires no cookie.

Native sign-out and authentication transitions invalidate leases and cancel HTTP, WebSocket and SSH work. Queued cookie writes settle before credentials are cleared, so a late response cannot restore the previous session. The owner binding remains intact after sign-out. A trusted reconnect/configuration flow is deferred to issue #7; this build fails closed rather than silently sharing the backend.

The current transport is a Linux development configuration for `agent@100.104.170.51`. It is not a portable production connection manager. Original OpenBot, Intelligence and model credentials stay on the VM. No API key or Intelligence credential is placed in the renderer.

## Actual native observations

[HYPER_OPENBOT_NATIVE.runtime.json](HYPER_OPENBOT_NATIVE.runtime.json) records exact code/capture identities and hashes. The final code observation was `a23ee224051e81035bef0ad3f537ae1af6228794` after rebasing the UI commits onto the verified baseline merge.

| Check | Observed result |
| --- | --- |
| App | Actual Electron 44.10.2 process and native Rust core; isolated scratch profile |
| Navigation | Visible Chat entry creates/reopens an existing native Chat view |
| Sending | Normal Send pointer click through the native composer |
| Streaming | 106 distinct live AG-UI text deliveries over the real private Phoenix connection |
| Saved content | Exact 509-character answer and prompt match authoritative HTTP 200 history and native UI |
| App restart | Same native view, channel, thread, Bot, user/assistant message IDs and text reopened without a replacement prompt |
| Renderer | No page errors observed during send/reopen |
| Appearance | Actual light, dark and Lavender token/screenshot checks passed; default Auto scheme restored |
| Navigation regression | Jira opened without credential changes; returning to Chat showed the same saved message |
| Automated checks | Typecheck, production frontend build and 498 tests passed; one opt-in simulated-IPC live test skipped |

The optional bridge-only test uses a simulated Electron IPC host with the real backend. Its earlier pass is recorded separately and is not substituted for the native-window observations above. The full suite included the existing real-core integration tests using the already-built binary.

The pointer test initially found HyperTask's support bubble covering Send. Chat now reserves room above that control. Native testing also exposed the existing Windows-only device ID implementation returning an empty string on Linux, which prevented collaboration/folder restoration after restart. Linux now reads its stable OS machine ID from standard locations and reports a clear error if unavailable. Windows identity behavior and existing data paths are unchanged. Three regressions reproduced the old failure and pass with the correction; the actual native folder now reopens after restart.

## Repeating the check

Use the [VM runbook](HYPER_OPENBOT_VM.md) for the original backend. Keep both original services and their stores intact. Run the normal Electron frontend build, selecting the existing native core through `APPFLOWY_CORE_BINARY` when the build resides in another worktree. Do not rebuild Rust or duplicate Electron downloads merely to change renderer code.

Launch a development window with `APPFLOWY_SUPPORT_DIR`, Electron user-data and XDG paths pointing to a scratch profile. Clear an inherited `ELECTRON_RUN_AS_NODE` in the child environment. The observed development launch required a process-only `--no-sandbox` flag because the npm Electron helper lacks its required root ownership/mode. No system or source sandbox setting was changed; this is not production packaging validation.

Open Chat through native navigation, start a conversation with `picked-harness`, send uniquely marked disposable plain text and observe live AG-UI events. Compare the assembled response with native transcript rows and authoritative saved message IDs/text. Allow the original history store its bounded final-write delay. Quit/relaunch the app with the same scratch profile, then require the same view/conversation/message IDs and displayed text without sending again. Keep session files, logs and raw captures private; the committed record contains sanitized results and hashes.

Approved and denied tools, interrupted runs, connection failures, portable startup/shutdown/configuration and full phase-1 end-to-end acceptance remain tracked by issues #6, #7 and #8. No Knowledge Graph, Intelligence replacement or permanent offline claim is included.
