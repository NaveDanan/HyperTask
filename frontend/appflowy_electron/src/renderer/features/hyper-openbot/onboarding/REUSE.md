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

## Home and navigation integration

| Native file | Exact upstream sources | Behavior |
| --- | --- | --- |
| HyperHomeApi.ts | app/src/lib/channels/route.ts; app/src/lib/channels/queries.ts; app/src/lib/auth/greeting.ts; app/src/lib/agents/default-agent.ts | Routing payload, explicit choice audit, skill routing, ambiguity refusal, bounded Unicode-safe routing text, fallback Bot, paged roster, first-conversation greeting |
| HyperHomeComposer.tsx | app/src/routes/_authed/_app/index.tsx; app/src/lib/plugins/skill-commands.ts; app/src/lib/plugins/queries.ts | Text/files, Bot choice, granted skill selection, exact draft transfer, duplicate-submit lock, rejection recovery, per-user memory-only draft restoration |
| HyperNativeTour.tsx | app/src/components/onboarding/demos/intro-reel.tsx; app/src/components/onboarding/demos/welcome-demo.tsx; app/src/components/onboarding/demos/team-demo.tsx; app/src/components/onboarding/demos/computer-demo.tsx; app/src/components/onboarding/onboarding-wizard.tsx | Native guided section exploration, Back/Next/Close and heading focus |
| HyperDesktopReturnSection.tsx | app/src/routes/_authed/desktop-return.tsx; app/src/components/desktop/desktop-return.tsx; app/src/lib/plugins/mutations.ts | Encoded server connection confirmation, loading/error/retry, native Connections destination |

Home mounts starter tasks and the native tour, lists shared public Bots with four initially and
All Bots expansion, follows working conversations, refreshes the server roster on focus/every
15 seconds, and offers cursor pagination. Existing Bots/Skills/Connections panels are loaded
locally when no section registry entry exists. Other specialists' sections use their registry entries.
Upstream animations and illustration chrome are replaced with native explanatory text and controls.

### Parent-owned contract

Exported from HyperHomeApi.ts:

```ts
interface HyperInitialDraft {
  text: string;
  files: File[];
  commandIds: string[];
  submit: boolean;
}
interface HyperHomeContext {
  initialDraftSupported?: boolean;
  openConversation(channelId: string): void;
  startConversation(agentIds: string[], initialDraft?: HyperInitialDraft): void | Promise<void>;
}
```

The parent must extend HyperOpenBotSectionContext with the optional draft and capability marker.
Set `initialDraftSupported: true` only once the receiving conversation consumes the draft.
The marker prevents the old one-argument implementation from silently discarding text/files.
Creation, uploads and initial send must be awaited and reject on refusal/failure so Home retains
its draft and File objects. `submit: true` means the person pressed Send or chose a starter task.
`submit: false` means populate the receiving composer without sending. Preserve File identity
and do not serialize file contents or unsent text into browser storage. Home already performs
`POST /api/route`, including explicit-choice audit, so the parent must not route it a second time.
The shared receiver owns pending conversation navigation, upload lifecycle and send restoration.
Home optionally receives `initialText` for upstream `ask` prefilling, capped at 2000 characters.

`HyperDesktopReturnSection` is exported with `{ context, app?: string }`. The parent-owned
main callback must pass the app key after external OAuth return and open this native view.
No `openbot://` handler or second identity flow is installed. Nested Setup/Connections destinations
currently open their section; selecting their exact nested detail needs the parent's navigation seam.

`HyperStarterTasks` is also exported for the conversation owner to mount with `agentId`,
`channelId`, `disabled` and `onSelect(message)`. Home mounts it already. Account-level tour claims
remain server-owned on channel creation; focus refresh observes claims in another window.

## Booking and identity boundaries

Booking uses `https://open.bot/business` in the browser. The upstream inline Calendly iframe
and booking-event completion cannot run under the existing renderer `default-src 'self'` CSP.
Per owner instruction, CSP stays unchanged and browser fallback is the intended native behavior.

Private Bot sign-in at `app/src/routes/_authed/sign-in/$requestId.tsx` is implemented by Vault;
this area does not duplicate it. Browser identity client/resume/sign-out flows from lib/auth
remain main-owned. Only current-user/profile and the greeting logic are used in this renderer.

## Validation

The reproduced onboarding-refusal test now captures and checks the exact rejected Error identity
and asserts no follow-up user read occurs after the refused write. Focused tests cover original
routing request bodies, ambiguous routing refusal, skill failure refusal, fallback selection,
File identity transfer, unsupported navigation refusal, Unicode routing bounds, greeting,
pagination encoding, onboarding payloads/read-back, name validation, role checks, starter
eligibility and route allowlist acceptance/refusal. No backend or Electron app is used.

Validation on 2026-11-15: `npm run typecheck` passed; focused Vitest run passed
17 tests across four files; full `npm test` passed 581 tests with five skipped
across 79 files; `npm run build` passed. Build reports the existing ineffective
dynamic-import warning for startup/launcher.ts. `git diff --check` passed.
