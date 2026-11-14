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

This branch is draft UI integration. Backend deployment and Electron live acceptance belong to parent. No live model tests ran during the authorized VM restart. Immediate post-run persistence reads never overwrite live text.

Activity/decision/computer components are reusable callback-driven components. Approval/question cards are wired to the durable original inbox and response APIs. Full original frontend tool registration, automatic continuation replay, live computer transport, private sign-in, bot creation, skill editing/grants and connection authorization remain unwired. Existing bot/skill/connection reads, lifecycle changes, channel CRUD, model selection and multipart attachments use original API contracts but require real Electron validation. Skill details currently show summary. Existing Extra vigilant server policy is unchanged.

HyperConversationActions.tsx adapts app/src/lib/approvals.ts and app/src/components/approvals/question-notice.tsx for thread-scoped durable approval/question reads and responses. shared/hyper-openbot-policy.ts is new restricted transport validation, including encoded traversal refusal.
