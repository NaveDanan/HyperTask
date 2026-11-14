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

The trusted main process pairs `GetUserProfile` with the additive native-core `HyperGetNativeIdentity` query. This query returns the current session UUID and an explicit local domain only in local core mode. The personal development connection permits local profiles only: the current core does not persist the authenticated server's origin, so remote accounts fail closed until issue #7 adds trusted server provenance. Numeric IDs, renderer identity arguments and current environment URLs cannot establish ownership.

The UUID and local namespace bind this personal backend to its first native owner in a `0600` file under a `0700` directory. Cookies use a separate Electron partition for that identity. Version 2 owner files reject the older numeric-ID binding without silently promoting or replacing it. A different native identity is denied before backend access, including when the original personal backend requires no cookie. Tests use a disposable scratch binding; no existing personal binding is reset automatically.

Native sign-out and authentication transitions invalidate leases and cancel HTTP, WebSocket and SSH work. Queued cookie writes settle before credentials are cleared, so a late response cannot restore the previous session. The owner binding remains intact after sign-out. A trusted reconnect/configuration flow is deferred to issue #7; this build fails closed rather than silently sharing the backend.

Generic renderer filesystem IPC cannot read, write, inspect or create directories under Electron's private user-data directory. The guard checks normalized paths and canonical existing ancestors to reject directory and file symlink aliases, including targets not yet created. This protects owner files and cookie partitions from renderer file operations. Ordinary imports, media and exports outside that private directory keep their existing API.

The current transport is a Linux development configuration for `agent@100.104.170.51`. It is not a portable production connection manager. Original OpenBot, Intelligence and model credentials stay on the VM. No API key or Intelligence credential is placed in the renderer.

## Actual native observations

[HYPER_OPENBOT_NATIVE.runtime.json](HYPER_OPENBOT_NATIVE.runtime.json) records exact code/capture identities and hashes. The full plain-chat/restart observation was `5cae909b0778b91cbfd7cf92ec6b37f3981a699a`, including the rebuilt core identity query. The later image-policy check ran on `efd309f691a5628d876cfcfca7364e0bcaa35d51`; each regression records its own source commit.

| Check | Observed result |
| --- | --- |
| App | Actual Electron 44.10.2 process and native Rust core; isolated scratch profile |
| Navigation | Visible Chat entry creates/reopens an existing native Chat view |
| Sending | Normal Send pointer click through the native composer |
| Streaming | 102 distinct live AG-UI text deliveries over the real private Phoenix connection |
| Saved content | Exact 497-character answer and prompt match authoritative HTTP 200 history and native UI |
| App restart | Same native view, channel, thread, Bot, user/assistant message IDs and text reopened without a replacement prompt |
| Renderer | No page errors observed during send/reopen |
| Appearance | Actual light, dark and Lavender token/screenshot checks passed; default Auto scheme restored |
| Navigation regression | Jira opened without credential changes; returning to Chat showed the same saved message |
| Async selection | Actual pending model save locks both pickers, retains the draft and saves the requested model; a late channel creation preserves newer navigation and remembered selection |
| Automated checks | Typecheck, production frontend build and 516 tests passed; one opt-in simulated-IPC live test skipped |

The optional bridge-only test uses a simulated Electron IPC host with the real backend. Its earlier pass is recorded separately and is not substituted for the native-window observations above. The full suite included real-core integration checks using the rebuilt identity-query binary. The concurrency checks paused and resumed only the scratch app's private SSH child; the reference and T3 forwards were untouched.

Review follow-ups also cover history groups sharing one local anchor, read-back of an assistant with missing local content, drained null-body HTTP responses and valid UTF-8 socket close reasons. Native `OpenAnonUser` invalidates connections before dispatch. A cleanup error keeps OpenBot blocked while allowing native sign-out, account deletion or authentication to proceed. Related run/join code and tests were consolidated without dropping coverage.

Further review reproduced a renderer write to the scratch owner file and a stale refresh dropping a newly created conversation. In the corrected real window, all 17 private-state operations were denied through direct, traversal and symlink paths, the owner file stayed unchanged and ordinary scratch file write/read passed. The delayed list response retained all 18 rows after creation instead of reverting to 17. Creation now invalidates older list requests and clears their loading state. The UI recovery entry point enables durable read-back only when the agent is idle; a functional regression covers missing content, longer completed text and active-run protection.

Generated Markdown images now render inert alt text and cannot preload or fetch their sources, including in tool results. In the real Electron window, a model-generated image URL produced zero requests to an owned loopback probe, no passive media element and a visible placeholder; the explicit citation and exact saved reply were retained. The probe was closed afterward. Renderer regressions cover remote, loopback, relative and data URLs plus raw HTML. Tool-call recovery also merges by ID, preserving the longer arguments independently for every call and retaining stored-only and live-only calls.

The pointer test initially found HyperTask's support bubble covering Send. Chat now reserves room above that control. Native testing also exposed the existing Windows-only device ID implementation returning an empty string on Linux, which prevented collaboration/folder restoration after restart. Linux now reads its stable OS machine ID from standard locations and reports a clear error if unavailable. Windows identity behavior and existing data paths are unchanged. Three regressions reproduced the old failure and pass with the correction; the actual native folder now reopens after restart.

## Repeating the check

Use the [VM runbook](HYPER_OPENBOT_VM.md) for the original backend. Keep both original services and their stores intact. This identity check requires a native core containing `HyperGetNativeIdentity`; older binaries fail closed. Run the normal Electron frontend build, selecting that core through `APPFLOWY_CORE_BINARY` when the build resides in another worktree. Reuse it for later renderer-only changes without duplicating Electron downloads.

Launch a development window with `APPFLOWY_SUPPORT_DIR`, Electron user-data and XDG paths pointing to a scratch profile. Clear an inherited `ELECTRON_RUN_AS_NODE` in the child environment. The observed development launch required a process-only `--no-sandbox` flag because the npm Electron helper lacks its required root ownership/mode. No system or source sandbox setting was changed; this is not production packaging validation.

Open Chat through native navigation, start a conversation with `picked-harness`, send uniquely marked disposable plain text and observe live AG-UI events. Compare the assembled response with native transcript rows and authoritative saved message IDs/text. Allow the original history store its bounded final-write delay. Quit/relaunch the app with the same scratch profile, then require the same view/conversation/message IDs and displayed text without sending again. Keep session files, logs and raw captures private; the committed record contains sanitized results and hashes.

Approved and denied tools, interrupted runs, connection failures, portable startup/shutdown/configuration and full phase-1 end-to-end acceptance remain tracked by issues #6, #7 and #8. No Knowledge Graph, Intelligence replacement or permanent offline claim is included.
