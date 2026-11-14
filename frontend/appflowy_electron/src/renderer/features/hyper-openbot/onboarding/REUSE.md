# Onboarding source mapping

Upstream read-only pin: f8af37ab73e96784f174a11104505a965e722cab.
Copyright (c) 2026 CopilotKit. MIT, reproduced in ../LICENSE.
HyperTask was developed by NaveDanan.

| Native file | Exact upstream sources | Behavior |
| --- | --- | --- |
| HyperHomeSection.tsx | app/src/routes/_authed/onboarding.tsx; app/src/routes/_authed/_app/index.tsx; app/src/components/onboarding/ask-first-switch.tsx; app/src/components/onboarding/name-step.tsx | Stable persisted onboarding numbers, server-gated business step, name validation, approvals preference read/write/read-back, completion read-back, four Bot shortcuts, native section exploration |
| HyperOnboardingApi.ts | app/src/lib/onboarding/mutations.ts; app/src/lib/auth/queries.ts; app/src/lib/auth/mutations.ts; app/src/lib/setup/queries.ts; app/src/lib/setup/mutations.ts | User/capabilities, profile, onboarding and setup contracts |
| HyperSetupSection.tsx | app/src/routes/_authed/settings/setup.tsx; app/src/components/setup/setup-checklist.tsx | Role/local-evaluation gate, server rows, readiness and required states, environment and native-page fixes, read/check/retry |
| HyperStarterSuggestions.ts | app/src/components/starter-tour/suggestions.ts; shared/starter-tour.ts | Exact four starter messages, internal Bot IDs, account-level conversation eligibility |
| HyperStarterTasks.tsx | app/src/components/starter-tour/starter-suggestions.tsx; app/src/lib/settings/message-list.ts | Server preferences, focus refresh, capability-gated interactive starter, duplicate-send lock, safe retry error |
| index.ts | New HyperTask code | Public exports for native integration |

Server contracts verified in server/src/app.ts, server/src/people/profile.ts,
server/src/setup/routes.ts and server/src/user-preferences-routes.ts.
No credentials, cookies, generated interfaces, external frames or upstream theme are embedded.
Native controls use existing Button/Input and token classes. Section exploration opens registered
native sections in place; unavailable sections remain disabled until their owning area registers them.

## Remaining parity and integration work

- Home initial message, attachments, routing refusal and pending-start restoration need a shared
  composer handoff. Proposed lead-owned seam: `startConversation(agentIds: string[], initialDraft?:
  { text: string; files?: File[] }): void | Promise<void>`. The receiving conversation must retain
  the draft on routing/upload/send refusal, upload through the existing attachment transport,
  and send only after explicit submission. Home currently offers Bot launch buttons only.
- `HyperStarterTasks` is exported for the conversation composer owner to mount with `agentId`,
  `channelId`, `disabled` and `onSelect(message)`. It is not mounted into shared conversation code
  because this area owns only onboarding. Account tour claims remain server-owned on creation.
- Home's working-now list, shared-Bot discovery/pagination and first-conversation greeting rule
  are not ported. Current Home shows four roster entries and greets named users on every visit.
- Onboarding uses native text instead of components/onboarding demo animations, organization-flow
  illustrations and the onboarding-frame/wizard motion. No embedded booking calendar is loaded;
  the business step links to the upstream business page in the system browser. This preserves
  external booking access but does not detect booking completion.
- `_authed/desktop-return.tsx` and components/desktop/desktop-return.tsx are the browser OAuth
  return handoff using `openbot://open`. HyperTask main owns its protocol/identity lifecycle.
  No second OpenBot protocol handler or browser return route is installed by this area.
  Broker confirmation and connection focus refresh belong to the connections/lifecycle owners.
- `app/src/routes/_authed/sign-in/$requestId.tsx` is a private Bot-browser credential form,
  not identity sign-in. It delegates to components/passwords/sign-in-form.tsx. It remains unported
  under this task's no-renderer-credentials restriction and needs a trusted main-owned secret-entry
  design. It must not be replaced with account sign-in.
- lib/auth/client.ts, resume.ts and sign-out-offered.ts manage upstream browser identity,
  redirect/resume and sign-out prompting. Native identity/session/sign-out stay main-owned;
  their browser redirect and credential machinery is not applicable to this native area.
- Setup detail links open their native section but cannot select a nested settings tab until a
  shared navigation seam exists. No arbitrary upstream URL is rendered as an internal route.

Focused tests cover API payloads, read-back, refused writes, name validation, role gate,
server tour eligibility, internal Bot IDs and allowlist acceptance/refusal.
