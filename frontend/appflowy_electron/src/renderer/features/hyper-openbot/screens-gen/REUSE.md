# Native interactive screens and gallery

Pinned upstream `/home/naved/HyperTask-OpenBot-baseline` at
`f8af37ab73e96784f174a11104505a965e722cab`. Copyright (c) 2026 CopilotKit.
MIT license is retained in `../LICENSE`. HyperTask was developed by NaveDanan.

| Local file | Exact upstream source | Native adaptation |
| --- | --- | --- |
| charts.tsx, cards.tsx, table.tsx, quote.tsx | app/src/components/gallery/charts.tsx, cards.tsx, table.tsx, quote.tsx | Original schemas, tool names, sample props, chart/card/table/quote behavior. Hyper exports and native tokens. |
| frame.tsx, palette.ts, positions.ts, streaming.ts, refused.tsx, failed.tsx | app/src/components/gallery/frame.tsx, palette.ts, positions.ts, streaming.ts, refused.tsx, failed.tsx | Layout, link refusal, data colors, stable keys, streaming contexts and refusal/failure text. |
| markdown.tsx | app/src/components/gallery/markdown.tsx | Existing native inert Markdown renderer. |
| decisions.tsx | app/src/components/gallery/decisions.tsx | Approval, decline, alternative note, choice and free-text answers; completed answers retain recorded results. |
| HyperDecisionCard.tsx | app/src/components/decisions/decision-card.tsx | Native radios, alternative answer field, newest-card number/Enter keys, collapsed recorded answer, retryable response errors. Native events replace unavailable upstream hotkey/motion packages. |
| form.tsx | app/src/components/gallery/form.tsx | Original schemas, field IDs, eight-field limit, email/number/select/text validation, optional omissions, submitted-answer rendering and invalid-argument response. |
| activity.tsx | app/src/components/gallery/activity.tsx | Activity/refusal reports, function-specific grants, reading/refusal/empty states, Bot names and follow-up conversation turns. |
| HyperReportContext.tsx | app/src/lib/copilot/conversation.tsx, app/src/lib/agents/bot-names.ts, app/src/lib/components/queries.ts | Bound calling-Bot context, follow-up callback, Bot-name lookup and restricted data-function transport. |
| HyperAuditWords.ts, HyperToolName.ts, HyperToolNameWords.ts | shared/audit-words.ts, tool-name.ts, tool-name-words.ts | Exact audit/tool wording. |
| HyperCheckInOffer.ts, HyperConnectPrompt.ts, HyperResearch.ts, HyperSubagent.ts, HyperToolSearch.ts | shared/check-in-offer.ts, connect-prompt.ts, research.ts, subagent.ts, tool-search.ts | Original protocol constants and helper contracts needed for audit wording. No subagents are started by this implementation. |
| HyperGalleryRegistry.ts | app/src/lib/copilot/gallery-registry.ts | Stable eager catalogue, manifest, renderable names and exact tool schemas. Explicit module list excludes tests and infrastructure. |
| HyperGalleryRuntime.tsx | app/src/lib/copilot/gallery-tools.tsx, sandboxed-tools.tsx, active-bot.tsx, bot-offer.ts; shared/tool-steps.ts | SDK registration, catalogue announcement, per-run published descriptions and grants, call-context identity, mixed-step refusal, independent call-ID decision waits, abort cleanup and published sandbox refresh. |
| HyperInteractiveResult.tsx | app/src/lib/copilot/gallery-tools.tsx, sandboxed-tools.tsx | Server permission recheck every five seconds; schema validation; stale-result guard; revocation resolves waiting decisions. Published markup runs only inside the original SDK sandbox renderer. |
| HyperConversationResult.tsx | app/src/lib/copilot/gallery-tools.tsx, sandboxed-tools.tsx; app/src/components/channels/chat-transcript.tsx | Native transcript callback with durable refusal, premature-call suppression, complete/partial arguments, decision answers and unknown-tool fallback. |
| HyperGenerativeActivity.tsx | app/src/components/channels/chat-transcript.tsx | Validated streaming activity content passed to the original SDK sandbox renderer. No generated source is evaluated in the renderer main world. |
| HyperScreensApi.ts, HyperScreensTypes.ts | app/src/lib/components/queries.ts, mutations.ts; app/src/lib/sandboxed/queries.ts, mutations.ts | Same API paths, methods, bodies and response envelopes through native IPC transport. Malformed permission decisions deny. |
| HyperGallerySection.tsx, HyperAdminComponentsSection.tsx | app/src/routes/_authed/settings/components-gallery/index.tsx, $name.tsx; app/src/routes/_authed/admin/components/index.tsx, $name.tsx | Published personal gallery; edition-specific text; detail preview/facts; draft description edit/cancel/save; publication, per-Bot and data-function grants; server read-back after mutations; retry and focus refresh. Native in-section navigation replaces router links and sheets. |
| HyperPlaygroundSection.tsx | app/src/routes/_authed/admin/playground.tsx | Draft editor, strict JSON-object validation, live original sandbox preview, save, save-before-publish, authoritative saved-list reload, open draft, revision/publication status and named delete confirmation. Editor state remains in memory. |
| HyperScreensDestination.tsx, HyperGeneratedScreen.tsx | app/src/routes/_authed/_app/s/$screen.tsx; settings/admin component routes above | Canonical `screens` destination, typed nested paths, safe route parsing, gallery fallback, published screen rendering with explicit Bot selection and server grant checks. Native section registry replaces upstream skin/router resolution. Skin-specific routines, memory and task implementations remain in their separately owned native sections. |

## Integration

`index.ts` exports the destination, typed `HyperScreensDestinationProps` and
`HyperScreenDestination`, result/sandbox renderers, catalogue and runtime registration.
`HyperGeneratedScreenProps` is exported from `HyperGeneratedScreen.tsx`.

Register `screens` once. Navigate with
`context.navigate?.('screens', {path: '/settings/components-gallery/askChoice'})`.
Supported paths are `/settings/components-gallery[/name]`, `/admin/components[/name]`,
`/admin/playground`, and `/s/name?agentId=bot&args=<encoded JSON object>`.
The generated-screen destination offers explicit Bot selection when no Bot is supplied.
It checks server grants before mounting the component. Destination arguments never establish
calling-Bot provenance for an SDK tool invocation.

Mount `HyperGalleryTools` under the native provider. Call `hyperPrepareGalleryAgent(agent)`
next to existing runtime preparation before connecting or running it. Tool handlers use the SDK
calling agent's `runtimeAgentId`, rejecting placeholder and `channel:` identities. Historical
transcript rendering uses that thread's bound runtime agent, as upstream uses its declared Bot.
A pending decision takes its identity from the captured SDK call context. Changing the selected
conversation cannot redirect its answer. Raw activity messages retain their ordered transcript
position and go only to the SDK sandbox renderer.

The `_app/start.$startId.tsx` transition is supplied by the merged native Home and
`conversations/HyperInitialDraftTransfer.ts` flow: channel creation/upload/send are awaited,
stable message IDs and drafts survive failures, navigation cancels stale work and the actual
conversation receiver performs submission. This area does not introduce an OpenBot router,
skin or second draft store. Parent notification/upload session invalidation and voice
model/credential guards remain intact after merging `13298d5`.

Shared edits are limited to the screens slot and the typed nested-path plumbing in
`HyperOpenBotSections.tsx`, the documented conversation runtime/transcript/activity seam in
`HyperOpenBotPage.tsx`, and the appended screens policy test block. API families are
`components` and `sandboxed`; existing `agents` and `capabilities` families are reused.
No main-process, CSP, webPreferences, credential storage or dependency-lock changes.

Focused tests mock transport and SDK sandbox mounting. They exercise exact permission/mutation
payloads, malformed and failed decisions, identity requirements, durable refusal and premature
calls, argument parsing, compiled registration, independent decision answers/abort, mixed-step
refusal, original form validation, author JSON validation, save-before-publish ordering and
nested destination parsing. These tests do not claim live backend or Electron execution.

`/s/name` resolves existing native section extensions first, including the retained memories/memory
and goals/routines aliases. Compiled gallery names and `custom_` names then resolve to the
permission-checked screen renderer. Unknown screen names return to the gallery. Extra skin
implementations are not copied into this folder or replaced by synthetic data.

## Validation

Node 24.18.1: focused screens/policy tests passed, full suite passed with 827 tests and five
existing skips, typecheck passed, production build passed. The existing Vite configuration and
launcher chunk warnings remain. No live backend or Electron app was used. The local dependency
tree reused the already locked xterm packages through a link to the provided shared dependency
tree; no package installation or lockfile edit was needed.
