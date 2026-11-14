# Conversation port

Upstream is OpenBot commit f8af37ab73e96784f174a11104505a965e722cab, Copyright (c) 2026 CopilotKit, MIT. HyperTask adaptations by NaveDanan. See ../composer/LICENSE for the retained license.

## Comparison before implementation

Native single-Bot chat already covered draft retention, stable retry IDs, attachment staging, run recovery, model selection, approvals, durable history and inert Markdown. It created multi-Bot channels as single-agent CopilotKit sessions. No native group transcript, group membership, group addressing, multi-recipient selector or Team Bot consent card existed.

## File mapping

- HyperConversationsApi.ts adapts app/src/lib/groups.ts and the consent mutation from app/src/lib/team-bots.ts. Query caching is replaced with native component lifecycle polling; API payloads and first-message rollback from app/src/lib/channels/start.ts are preserved.
- HyperGroupChat.tsx adapts app/src/components/channels/group-chat.tsx, group-people.tsx and team-bot-consent.tsx. Uses HyperTask Button/Input, existing inert HyperMarkdown and HyperComposer. Addressing uses an explicit recipient selector. Group runs stay on the server and do not bind the first Bot to CopilotKit. Polling follows upstream's active-turn and bounded first-reply rules. Failed sends retain the composer and retry ID. Identity comes from server /api/me and never from a guessed local user.
- HyperNewConversationSection.tsx adapts recipient selection from app/src/routes/_authed/_app/channel/new.tsx. Selection order determines Bot reply order. Creates on Start rather than first send. No web router, shell or global CSS imported.
- index.ts exports the native components and API contracts.
- HyperConversationsApi.test.ts covers contracts, rollback and polling. HyperGroupChat.test.tsx covers loading, refusal and consent failure states.
- ../HyperOpenBotPage.tsx dispatches multi-Bot channels to HyperGroupChat and creates them through /api/groups. Existing single-Bot recovery remains intact.
- Shared policy adds groups, team-bots and me, verified against server/src/app.ts route mounts. The me family supports the current-user read used for consent and membership permissions. No credentials are retained.

## Remaining parity work

This increment does not complete the assigned conversation scope. Group ask_person inbox integration, pause banners, read marks, inline @ mention completion, slash commands, first-send creation with held attachments/model selection, new-Bot creation inside the recipient picker, roster detail lookup for hidden Bots, Team Bot publication/audience/assignments and preference clearing remain unported. The upstream team-bots route redirects to Bots; sharing controls need coordination with the Bots area.

The remaining channels/copilot/composing/delivery/dictation/voice/hotkeys/subagents/marks/typed-reveal modules have not received an exhaustive behavior port. Existing composer/transcript implementations were preserved. Generative/interactive output stays behind the existing transcript tool-result seam for the screens specialist. No new dependency or live backend access was used.

## Group questions follow-up

HyperGroupQuestions.tsx adapts app/src/components/approvals/question-notice.tsx and app/src/lib/approvals.ts. HyperGroupChat polls the inbox every ten seconds and on working-state changes. Replies addressed to the asking conversation Bot answer its question; another recipient receives a normal group message. Answer and dismissal use server-authoritative writes and retain the question after refusal. Multipart answers retain upstream label/option/free-text serialization, with all decisions displayed together in a native fieldset rather than upstream's paged questionnaire. No answer is persisted locally. HyperGroupQuestions.test.ts covers handoffs, channel isolation, exact transport contracts, failures and multipart serialization. Approval routes were already allowed; no new family is needed.

HyperDeliveryApi.ts maps app/src/lib/delivery.ts; HyperDeliveryControls.tsx maps app/src/components/delivery/reaching-you.tsx. Destinations are scoped to the current conversation, so the current channel replaces the upstream conversation picker. Phone verification, link expiry, unavailable transports, STOP state, device removal and delivery history use server results. Phone/code/challenge and link commands stay in component memory. Native inline controls replace the upstream dialog. Minimal main-process edit synthesizes the fixed upstream anti-CSRF headers for exact audio/voice endpoints, without accepting arbitrary renderer headers.
