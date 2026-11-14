# Native conversation and action acceptance

Tracking [issue #6](https://github.com/NaveDanan/HyperTask/issues/6), [PR #12](https://github.com/NaveDanan/HyperTask/pull/12). Observed 2026-11-14. Native UI issue #5 merged in [PR #11](https://github.com/NaveDanan/HyperTask/pull/11), squash `d026839b5aceeb7c6d34cedcd5731d0c47100945`. This follow-up remains subject to its own review and merge.

The actual HyperTask Electron window exercised approved and denied actions, Stop/continue, restored action history, connection loss and runtime failure against the existing original OpenBot/CopilotKit Intelligence stack. The backend stayed on the authorized VM. These observations use the native composer, transcript and approval cards, rather than mocked component fixtures or a separate OpenBot shell.

[The sanitized runtime record](HYPER_OPENBOT_ACTIONS.runtime.json) contains source identities, request/tool IDs, audit row IDs and private capture/driver hashes. Raw browser captures, logs, account state and screenshots remain private. The original backend source remains pinned to `f8af37ab73e96784f174a11104505a965e722cab`. The initial native runtime check used `38ef1498aaebda42b1cc076424d93ed9f76ac5b7`; approval decisions first ran on the merged base and their durable presentation was checked again on that final runtime.

## Observed results

| Scenario | Native behavior and independent evidence |
| --- | --- |
| Agent and conversation | Chose Personal Assistant through Bots → Chat; native creation established a new channel and original thread |
| Approval required | A temporary personal `ask` rule applied only to `computer_write_file`, effect `write`, in a unique disposable folder. The real native card appeared before execution |
| Approved action | Clicked Allow once. The original server completed the request; a separate read inside the owned computer container verified the exact 37-byte marker |
| Denied action | Clicked Deny. The original server continued with its declined result; the denied file was absent in the container. Audit contains a person decision and `computer.action_refused`, with no allowed event for that file |
| Durable action history | Actual Electron/core restarts retained the same native view/channel/thread and both tool call/result IDs. Approved work shows complete; denied work shows blocked and “You declined it.” |
| Stop and continue | Clicked Stop during live text. The final-runtime check received 28 text deliveries before settling; no disconnect error appeared. A subsequent turn streamed and finished in the same thread |
| Connection loss | Terminated only the verified private SSH child of the owned scratch app. The native error appeared within 89 ms, the draft remained, and Send was blocked pending reconnect |
| Reconnect | Clicked Reconnect without sending again. The original SDK recovered the response; final native text matched authoritative saved text. History contained one copy of the user prompt and the error cleared |
| Backend tool failure | Requested one read of a unique nonexistent workspace file. Its result showed failed; no file was created and no retry was requested. The following plain turn succeeded |
| Runtime failure | Briefly stopped only the owned agent harness. A real `RUN_ERROR` surfaced and kept the draft. Restarted the same container, waited for its health route and retried through Send; the reply succeeded with one saved user turn |

The rule was revoked after both requests reached `completed`. Personal preferences remained `enabled: false`, `autoReview: false`, `hostCommands: ask`. The marker stays in its unique test folder as evidence. The original stack is running; shared AppFlowy services, the separate reference/T3 forwards, volumes, provider/account configuration and shared MMEMS K3s were untouched. No API key was introduced.

## Corrections found by native testing

An unexpected private socket close previously left the SDK's run waiting indefinitely. The native transport now associates the socket with its Phoenix thread/run join. Observable failure is limited to that run, follows canonical `RUN_STARTED` identity and releases its stream. Intentional Stop/cleanup does not report a connection failure. The SDK failure type reaches the page so it can keep the draft and require reconnect before another send.

A cursor-based reconnect can begin with text or tool progress and omit `RUN_STARTED`. That progress now protects the connection from the existing five-second idle join deadline. A successful history read clears the reconnect barrier and composer error while preserving the draft and attachments. Reconnect itself does not submit or repeat an action. Final-write settling is checked before comparing durable and visible text; a partial store read immediately after `RUN_FINISHED` is not accepted as final proof.

OpenBot's durable approval continuation returns an exact plain-text sentence when a person declines. The native JSON-only outcome mapper previously marked that result complete. The original `shared/approval-outcomes.ts` is adapted with its MIT notice. Exact declined, handled-by-person and not-run outcomes now retain their meaning, and the transcript displays the original person-facing translation. Persisted messages and model context are unchanged. JSON-string-wrapped results and original `Refused.`/`Error:` markers are covered too.

## Boundaries and validation

Eleven original computer tools remain scoped to the calling Bot and server capabilities. The actual run snapshot carries the thread/run/tool identity and captured context to the original policy/audit gateway. Approval execution and continuation remain server-owned. No unrestricted Rust dispatcher, native database tool or Jira credential access was added. [The runtime integration note](../src/renderer/features/hyper-openbot/runtime/INTEGRATION.md) identifies future typed, scoped HyperTask tool seams without implementing them.

Typecheck, production frontend build and all 536 tests passed with the existing identity-aware core selected through `APPFLOWY_CORE_BINARY`. One opt-in simulated-IPC live test was skipped; the separate actual native checks above supplied live acceptance. New regressions cover matching/canonical run loss, unrelated and late socket closes, intentional Stop, failure-type preservation, cursor-based text/tool progress and durable approval outcomes.

The desktop reuses the matching installed dependency graph, Electron 44.10.2 and the existing core binary. There was no dependency install, Electron download, Rust rebuild or image build. The scratch owner binding and profile were preserved. The development process still uses the previously documented `--no-sandbox` launch flag; production packaging and other operating systems are not claimed.

## Repeating the checks

1. Use the existing backend and [scoped VM runbook](HYPER_OPENBOT_VM.md). Launch the native app with an isolated profile and the identity-aware core, preserving its owner binding. Never reset a personal binding to make a test pass.
2. Create a conversation through Bots → Chat. Prepare an original personal `ask` rule for only `computer_write_file`/`write` in a new disposable folder through the existing authenticated approval API. Do not replace the server policy or inject tool calls, results or approval decisions.
3. Ask the real model to save one unique marker with `computer_write_file`. Observe the pending native card, choose Allow once and compare its saved result with a separate scoped container file read. Repeat with another path, choose Deny and require its absence plus the original refusal audit event. Do not grant standing permissions.
4. Restart only the owned scratch Electron/core and reopen the same native view. Compare channel/thread/tool IDs and outcomes with authoritative history, without sending again.
5. Stop a live plain response and continue in the same conversation. Interrupt only the app's verified private SSH child during another response, require a visible error and preserved draft, then use Reconnect. Require exact final saved/UI content and one user turn. Never interrupt the reference or T3 forwards.
6. Exercise one nonexistent-file read. For a real run failure, briefly stop only the owned harness with a guaranteed `finally` restoration, require the native error/draft, restore that same container and wait for health before retrying. Do not change provider credentials to manufacture a failure.
7. Wait for both approval requests to finish and revoke only the temporary rule. Confirm preferences and owned services are restored. Keep raw evidence private; commit sanitized identities and hashes.

Service lifecycle/configuration, trusted reconnect and authenticated remote-account provenance remain issue #7. Broader phase-1 acceptance remains issue #8. Neither Knowledge Graph work nor an Intelligence replacement is included.

## Review follow-up

CodeRabbit identified three further gaps. Persistent core error observation now surfaces `agent_connect_failed` for only the current agent/thread, including failures reported after the initial connect promise settles. The real SDK regression confirms that `connectAgent` resolves an empty result while emitting that error; the observer is released with the view effect.

Gateway joins now distinguish confirmed, deadline and cancelled outcomes. Original AG-UI progress confirms an active cursor-based connection. During a reconnect, a deadline with readable history keeps Send blocked and restores the visible Reconnect control. A late promise settlement cannot clear that barrier; an explicit successful retry can. Slow first opens retain their prior history/composer behavior. `ALREADY_WAITING`, both plain and JSON-string encoded, is classified as not-yet.

Five compiled production-page Chromium scenarios passed with a mocked SDK/backend and an accelerated deadline: resolved connect failure, persistent agent-scoped observation, deadline/late completion, successful retry preserving the draft without resending, and slow first open. These are component-state checks, not live gateway proof. Separately, the actual native window on `9632dcd17636cddf467cc52e3177f7be7e16796c` repeated private SSH interruption and confirmed reconnect: error within 104 ms, retained draft, blocked resend, one saved user turn, exact final saved/UI response and no renderer errors. The full suite now has 540 passing tests and one opt-in skip; typecheck/build pass. Capture identities and hashes are in the runtime record's `reviewFollowUp` section. The updated PR head requires fresh Codex code/security review before merge.
