# Approvals inbox

HyperTask by NaveDanan. Adapted upstream OpenBot code is MIT, Copyright (c) 2026 CopilotKit. Full notice: ../LICENSE. Read-only source pin: f8af37ab73e96784f174a11104505a965e722cab.

## Exact source mappings

| Local file | Upstream source | Behavior |
| --- | --- | --- |
| HyperApprovalsApi.ts | app/src/lib/approvals.ts | Inbox, decisions, question responses/dismissals, preferences, personal rule creation/change/removal, conversation grant revocation. Behaviour-only PATCH preserves account-scoped server data. |
| HyperApprovalsApi.ts | app/src/lib/team-bots.ts, clearTeamBotConsentsMutationOptions | DELETE shared Bot consents. No inbox read is required to confirm this independent operation. |
| HyperApprovalsApi.ts | app/src/lib/channels/queries.ts | Cursor pagination when resolving an inbox thread to its conversation. Repeated cursors fail instead of looping. |
| HyperApprovalsSection.tsx | app/src/components/approvals/settings.tsx, rules.tsx, conversation-allowances.tsx, waiting.tsx; app/src/routes/_authed/settings/approvals.tsx | Native consolidated inbox/settings; questions with channel IDs open their conversations; legacy questions support direct multipart answers and dismissal. Personal/team rule locks and enforced auto-review remain authoritative. All Bot patterns remain accessible in the consolidated rule list. |
| HyperApprovalsSection.tsx | app/src/components/settings/team-bot-consents.tsx | Hide reset for personal editions; success shown only after reset resolves; failed capability lookup has its own Retry. |
| HyperApprovalPresentation.tsx | shared/standing-rule.ts; shared/tool-name.ts, approvalDetails; app/src/components/approvals/waiting.tsx, ApprovalDetails | No standing answers for check-in tasks, closed action kinds or handoffs. Complete inert argument values; internal ref/snapshot/tool-call/signal handles omitted. |
| HyperDecisionHistory.tsx | app/src/components/approvals/inline-approval.tsx, CHOICE_WORDS; app/src/components/decisions/decision-card.tsx | Answered cards reuse activity/HyperApproval. The answer and execution status are separate. Newest decisions first, conversation opening, empty history. History is derived from the authoritative inbox, with no invented history API. |
| HyperMutation.ts | Native reliability adaptation of upstream mutation invalidation in app/src/lib/approvals.ts | Refused write, confirmed write and accepted write with failed read-back are distinct. Unconfirmed state blocks further writes. Draft is preserved until recovery confirms state, then the accepted rule draft is cleared to prevent duplicate submission. |
| HyperNotificationsApi.ts | app/src/lib/delivery.ts; app/src/lib/bot-lifecycle/queries.ts and mutations.ts | Delivery envelope, routing envelope, exact routing PUT payload, device deletion. Original person-facing kind/transport/delivery-state labels. |
| HyperApprovalsSection.tsx | app/src/routes/_authed/settings/notifications.tsx; app/src/components/settings/devices.tsx and update-routing.tsx | Only configured transports shown, unavailable transport preferences preserved on updates, four transports collapse to all, native devices and delivery states. Remote error strings are replaced by safe generic delivery guidance. Notification writes reload notification state independently of approvals. |
| HyperNotifications.tsx | app/src/lib/notifications/permission.ts and show.ts; app/src/components/notifications/notify-prompt.tsx | Notification API permission, refusal/unsupported handling, explicit enable/check-again controls, one-time prompt with the original nonsecret preference key, native Notification display and click callback. Electron uses its Notification API; upstream Tauri plugin IPC is inapplicable. |
| HyperReplyNotices.ts | app/src/lib/notifications/reply-notice.ts | Bot-only replies, notification-frequency gating, first-line fallback, 1.5-second settling after busy ends, 120-second upper bound, newest reply per conversation, bounded duplicate memory, permission/foreground/attention suppression and conversation tag/click behavior. Fresh reads are injected by the conversations owner; unknown reads fail closed. |
| HyperApprovals.test.tsx, HyperNotifications.test.ts | Native tests | Mocked transport contracts, policy restrictions, inert action details, refusal propagation, pagination/loop refusal, read-back outcomes, history, reset, notification permission/settling/suppression. |

The upstream /_authed/_app/approvals.tsx route redirects to the Bots page. HyperTask intentionally keeps an Approvals registry entry with local subnavigation rather than importing that router or shell. Existing activity/ cards are reused unchanged. HyperConversationActions.tsx is untouched.

## API contracts and policy ownership

Read against server/src/approvals/routes.ts, server/src/team-bots/routes.ts, server/src/delivery/routes.ts, server/src/agents/lifecycle-routes.ts, server/src/channels/routes.ts and the capabilities contract in app/src/lib/deployment/queries.ts.

- GET /api/approvals
- POST /api/approvals/:id/decision with { decision }
- POST /api/approvals/questions/:id/respond with { response }; no inConversation claim from the inbox
- POST /api/approvals/questions/:id/dismiss
- PATCH /api/approvals/preferences with enabled, autoReview or hostCommands
- POST /api/approvals/rules with botId, toolRef, effect, scope, behaviour
- PATCH /api/approvals/rules/:id with { behaviour }
- DELETE /api/approvals/rules/:id
- DELETE /api/approvals/conversation-grants/:id
- GET /api/channels with optional cursor
- GET /api/capabilities
- DELETE /api/team-bots/consents
- GET /api/delivery
- DELETE /api/delivery/devices/:id
- GET /api/bots/routing
- PUT /api/bots/routing/:kind with { transports }, an array or all

Only the approvals-inbox registry and allowlist slots were changed. The allowlist adds delivery and the exact team-bots/consents path, anchored to refuse descendants. All other families above already existed. Policy tests append allowed and refused examples.

## Exports and remaining integration

index.ts exports HyperApprovalsSection, API functions/types, HyperDecisionHistory, HyperApprovalDetails, HyperOffersStandingRule, notification permission/settings/prompt/display functions, and the reply event lifecycle.

The final parent integrates HyperNoticeChannelEvent from HyperChannelEvents, fresh attention/lifecycle/name reads, ordered notification processing and HyperForgetReplies on teardown. HyperNotifyPrompt is mounted in native Chat. The existing owned socket adapter admits the exact channels/events route; no unapproved generic socket was added. Requested Notifications/Approvals paths select their actual controls. Since HyperTask has no separate global attention notifier, an approval/question reply produces one needs-you replacement with the shared channel tag, including needs_input preferences.

The earlier bounded step excluded the broader board/admin flows. Final parent integration mounts the needs-you/task/check-in board, team settings/shared requests, English translation/batch/backtest and reviewer guidance in their Bot/routine/admin owners. This source map describes those implemented callers, not independent final-head or native acceptance. No missing flow was replaced with a fabricated success. The owner explicitly waived another Codex review and skipped native verification; that is recorded as unverified, not passed.

No live backend, Electron launch, credentials, deployments, push, PR, license acceptance, global CSS, CSP or webPreferences changes were used.

## Validation for this bounded step

- npm run typecheck: passed.
- Focused vitest, approvals-inbox plus shared policy: 21 passed across 3 files.
- npm test: 585 passed, 5 skipped across 78 files, including 2 skipped files.
- npm run build: passed; existing dynamic/static import warnings remain.
- git diff --check: passed.
- Review performed locally without subagents. Read-back recovery stays scoped to the state that the accepted mutation changed, including across tab navigation.
- No browser or live integration execution was performed. Exported event wiring described above remains an integration dependency.
