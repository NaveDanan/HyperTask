# Hyper OpenBot integration

Source pinned at f8af37ab73e96784f174a11104505a965e722cab in `/home/naved/HyperTask-OpenBot-baseline`. Copyright (c) 2026 CopilotKit. MIT license is reproduced in LICENSE. HyperTask was developed by NaveDanan. Component-specific mappings are in each subdirectory's REUSE.md.

| Local file | Original source | Adaptation |
| --- | --- | --- |
| provider.tsx | app/src/lib/copilot/provider.tsx | Original CopilotKit v2 provider, credentials include, inspector disabled, openbotTimeZone forwarded property. Restricted Electron streaming transport. |
| HyperOpenBotPage.tsx | app/src/components/channels/channel-chat.tsx | Per-channel runtime agent/thread, SDK history connect, addMessage/runAgent/stopAgent, user/tool transcript. |
| HyperOpenBotPage.tsx | app/src/lib/channels/queries.ts and mutations.ts | Original channel envelopes, create/pin/delete endpoints. |
| HyperOpenBotPage.tsx | app/src/components/channels/composer/attachments.ts | Original multipart uploadGroup upload, server attachment references, remove attachment endpoint. |
| HyperOpenBotPage.tsx | app/src/lib/models/queries.ts and mutations.ts | Original model catalogue and conversation model selection. |
| HyperOpenBotPage.tsx | app/src/lib/bot-lifecycle/queries.ts and mutations.ts | Original lifecycle, pause/resume and notification contracts. |
| transport.ts and src/main/hyper-openbot.ts | New HyperTask code | Streaming IPC restricted to a fixed local tunnel and API route families. Cookies remain in main session; no credentials returned to renderer. |

Exact direct dependencies: @copilotkit/react-core 1.85.0 matches original runtime/provider protocol; @ag-ui/core 1.0.2 matches SDK message protocol; streamdown 2.5.0 and @streamdown/code 2.0.0 restore original streaming Markdown and code highlighting. Lockfile records transitive dependencies. Existing shell and theme CSS were not copied.

## Acceptance boundaries

This branch is draft UI integration. Backend deployment and Electron live acceptance belong to parent. The initial assembly ran no live model tests during the authorized VM restart. Immediate post-run persistence reads never overwrite live text.

The enhancement section below supersedes the initial assembly limitations. Existing Extra vigilant server policy is unchanged. Native plain-chat acceptance now passes as recorded in docs/HYPER_OPENBOT_NATIVE.runtime.json. Tool/approval acceptance remains separate.

HyperConversationActions.tsx adapts app/src/lib/approvals.ts and app/src/components/approvals/question-notice.tsx for thread-scoped durable approval/question reads and responses. shared/hyper-openbot-policy.ts is new restricted transport validation, including encoded traversal refusal.

## Enhancement integration, November 14

- Main now owns a BatchMode, StrictHostKeyChecking SSH child to the authorized development VM through a randomly named mode-0700 directory and Unix socket. Node HTTP and `ws+unix` use that socket exclusively. The public reference port-forward is untouched. SSH, sockets and requests close on renderer destruction or app exit. Current draft transport is Linux-only; portable lifecycle configuration belongs to #7.
- HTTP bodies and responses cross IPC as bytes. Runtime validation, ten-minute request/connection deadlines, fifteen-second SSH/socket handshake deadlines, cancellation checks after serialization, restricted paths and a response-content header allowlist apply. Cookies stay in main's session. No backend credential or license configuration is embedded.
- The pinned SDK's `createRuntimeFetch` directly calls global fetch for discovery/resource requests. It offers per-agent fetch but no complete provider fetch/socket adapter. `HyperSdkTransport.ts` intercepts only the synthetic OpenBot origin and exact gateway path while a provider is mounted, forwards all other traffic unchanged, and restores globals when the last provider unmounts. Phoenix framing is preserved through a standard WebSocket interface and the maintained `ws` library, rather than reimplemented.
- `HyperThreadMessages.ts` ports `app/src/lib/copilot/thread-messages.ts` including schema validation and stored tool-call normalization. `HyperHistoryMerge.ts` ports `mergeStoredMessages` and `moreCalls` from `app/src/components/channels/channel-chat.tsx`. Longer live text survives a lagging history read. History failures and unreadable records are visible.
- Run initialization, failure/error events and Stop are observed separately. Failed runs reject composer submission, keeping draft and attachments retryable with the same message ID. Compound content is rendered as text, image previews and downloadable attachment references, including restored history.
- Bot creation/profile/lifecycle, skill creation/editing/grants and connection directory/detail/OAuth initiation are mounted from the corresponding behavior subdirectories. Their REUSE.md files map exact source contracts. External authorization URLs open for the person to complete; the agent does not approve accounts or collect API keys.
- Eleven original computer frontend tools are registered, filtered per calling Bot/capabilities and executed through the durable original approval gate with captured run context. Approval/question completion triggers history reconnect. `HyperComputerScreen.ts` ports `app/src/lib/computers/screen.ts`; a read-only native computer panel polls non-waking status and validated screenshots and displays actual conversation tool activity. Live remote input, terminal, private sign-in/secret cards and generative UI execution are not advertised by this panel.
- A visible sidebar Chat entry opens an existing native Chat view or creates one through the existing folder API. No separate window, shell, global CSS or protocol identifier was introduced.

Additional exact dependencies required by these actual imports: `ws` 8.23.0 for main-process WebSockets over the private Unix tunnel with cookie/Origin headers; `@types/ws` 8.18.1 for compilation; `zod` 4.6.7 for the original computer tool schemas; `rxjs` 7.8.1 for original per-agent run middleware. Existing dependency versions were preserved. Npm changed dev flags where dependencies became reachable from production and restored existing platform libc metadata; the large initial addition is the original SDK dependency graph, not upgrades to existing packages.

Validation now includes 56 focused tests plus an opt-in live bridge test. The live test opened a real Phoenix socket, received seven text events, and verified exact saved reply ID/text after bounded persistence settling. It uses a simulated IPC host with the real secure SSH/HTTP/WebSocket transport and real backend. The separate actual Electron test subsequently passed with 106 live text deliveries and exact saved/UI text; reopening the same native view/channel/thread/message IDs after app restart also passed. The bridge-only test does not establish that result by itself.

## Native acceptance and review corrections

The actual Electron pointer test exposed the existing support bubble covering Send. The Chat view now reserves footer space without moving the global support control. System instruction messages remain in agent context and are excluded from the visible transcript. Active agent runs drive Stop/busy state on reconnect; durable waiting tool placeholders merge into their saved outcomes; obsolete gateway-join deadlines are cancelled on view release.

Linux startup previously supplied an empty device ID, causing native collaboration/folder initialization to panic after restart. Linux now reads its existing machine ID from the standard OS locations and fails clearly if unavailable; Windows identity behavior and data paths are unchanged. Three focused regressions reproduced the old empty-ID behavior and pass with the fix.

The trusted main process now binds this personal backend to the native identity read directly from the core. Cookie partitions are per identity, authentication changes invalidate leases and cancel traffic, and sign-out waits for queued cookie writes before clearing them. The owner binding survives logout, including for a cookie-free personal backend. Another identity cannot silently inherit it. A trusted reconnect/settings flow is deferred to #7.

Final validation before the evidence commit: typecheck, production frontend build and 498 tests passed. One opt-in simulated-IPC live test was skipped in that suite; the separate actual Electron client exercised the real backend. See [native acceptance](../../../../docs/HYPER_OPENBOT_NATIVE.md).
