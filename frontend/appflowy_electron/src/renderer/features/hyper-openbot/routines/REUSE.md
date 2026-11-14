# Routines and responsibilities reuse

Upstream: OpenBot, pinned `f8af37ab73e96784f174a11104505a965e722cab`, MIT, Copyright (c) 2026 CopilotKit. The license is preserved at `../LICENSE`. HyperTask is developed by NaveDanan.

All upstream paths below are relative to `app/src/`.

| Native file | Exact upstream source |
| --- | --- |
| `HyperRoutinesSection.tsx` | `routes/_authed/_app/routines.tsx`, `routines_.new.tsx`, `routines_.schedules.$routineId.tsx`, `routines_.goals.$goalId.tsx`, `routines_.check-ins.$checkInId.tsx`; `components/routines/new-routine-page.tsx`, `routine-page.tsx`, `routine-detail-missing.tsx`, `delete-row.tsx`, `routine-runs.tsx`, `goal-schedules.tsx`; `components/responsibilities/goal-page.tsx`; `components/suggestions/check-in-page.tsx`, `proactive-panel.tsx`, `suggestion-row.tsx`; `components/tasks/task-row.tsx` |
| `HyperResponsibilitiesSection.tsx` | `routes/_authed/_app/responsibilities.tsx`, `bots.$agentId.responsibilities.tsx`, `bots.$agentId.routines.tsx` |
| `HyperRoutineOverview.tsx` | `components/routines/routines-list.tsx`; `lib/routines/queries.ts`, `lib/responsibilities.ts`, `lib/proactive.ts` |
| `HyperRoutineForm.ts` | `lib/routines/form.ts` |
| `HyperRoutinePlan.ts` | `lib/routines/plan.ts` |
| `HyperRoutinesApi.ts` | `lib/routines/mutations.ts`, `lib/responsibilities.ts`, `lib/proactive.ts`, `lib/tasks/mutations.ts` |
| `HyperRoutineTypes.ts` | `lib/routines/queries.ts`, `lib/responsibilities.ts`, `lib/proactive.ts`, `lib/tasks/queries.ts` |
| `HyperRoutineMerged.ts` | `lib/routines/merged.ts` |
| `HyperRoutineEvents.ts` | `lib/routines/events.ts` |
| `HyperRoutineTasks.ts` | `lib/tasks/groups.ts`, `lib/tasks/queries.ts` |
| `HyperRoutineFlows.ts` | `components/routines/new-routine-page.tsx`, `components/responsibilities/triggers.tsx` |
| `HyperRoutineTriggers.tsx` | `components/responsibilities/triggers.tsx`, `lib/responsibilities.ts` |
| `HyperRoutineSharedApps.tsx` | `components/plugins/shared-app-notice.tsx`, `lib/plugins/shared-use.ts` |
| `HyperRoutinesConnectionPage.tsx` | `components/routines/routines-connection-page.tsx`, `routines-app-hint.tsx`, `new-routine-button.tsx` |
| `HyperRoutineControls.tsx` | Native query/action controls replacing upstream TanStack query/mutation and route UI; check-in blocking from `components/suggestions/proactive-panel.tsx` |
| `HyperRoutineNavigation.tsx`, `index.ts` | Native integration adapters for the route callbacks above |
| `HyperRoutinesApi.test.ts`, `HyperRoutineFlows.test.tsx` | Local mocked-transport, form contract, rollback, ordering, provider payload and rendered action guard tests |

## Supported workflows

- Global and agent-scoped merged routines, goals and check-ins; enabled-first ordering; goal schedules folded into their goal; orphan schedules retained when a goal read fails. Independent loading, read failure, retry, empty and polling states.
- Creation of a plain schedule, scheduled goal, event goal, immediate goal or read-only check-in. Upstream cron and Unicode limits, browser time zone, duplicate normalized check-in subjects, administrator permission, personal-edition Slack restriction, and paginated active non-task conversations containing the selected Bot.
- Creation starts/names one conversation when requested. Explicit refusal removes the empty conversation. Schedule refusal removes the newly saved goal; failed rollback attempts to pause it and locks creation. Uncertain writes keep the conversation and lock creation. Failed initial goal run keeps the saved goal and locks creation. Naming and empty-conversation cleanup failures remain best effort as upstream.
- Schedule pause/resume, real run-now, confirmed delete, missing state, conversation navigation, next/last run and run ledger. Routine editing stays conversational because upstream exposes no direct routine edit API.
- Goal details edit/save/discard, required success criteria for goals that end when met, active-only run, completed-goal action guards, pause/resume/complete, confirmed cascading deletion, progress/result/events, schedule controls and runs with waiting reasons and inert reply text.
- Check-in administrator and global personal-preference blocking, enabled-only run-now, queued/skipped/refused feedback, immediate interval writes, focus editing, last outcome/reason/count, and confirmed removal.
- Tasks ordered by attention state with seven-day resolved expiry, conversation navigation, resolve/reopen/retry, failure and next-step text. Suggestions support Work on it, Hide, safe HTTP(S) source links and Stop checking the originating setting.
- Typed webhook, GitHub, Linear, Sentry, PagerDuty, email and Slack trigger forms. Event/field filters, repository/senders, Slack workspace/mode/phrases/reactions/channels, provider signing secrets, generated key reveal/rotation/copy, endpoint copy, enable/disable, confirmed removal, inbound-email deployment warning and shared-account approval requests. Secrets stay in transient React state and request bodies.

## API contracts

Verified against `server/src/routines/routes.ts`, `responsibilities/routes.ts`, `proactive/routes.ts`, `tasks/routes.ts`, channel routes, settings routes, shared-use approval routes and `/api/me`.

- `GET/POST /api/routines`; `PUT /api/routines/:id/enabled`; `POST /api/routines/:id/run`; `DELETE /api/routines/:id`; `GET /api/routines/:id/runs`.
- `GET/POST /api/responsibilities`; `GET/PATCH/DELETE /api/responsibilities/:id`; `POST /api/responsibilities/:id/{pause,resume,complete,run}`; `GET /api/responsibilities/:id/runs`.
- `GET/POST /api/responsibilities/:id/triggers`; `PUT /api/responsibilities/triggers/:id/enabled`; `GET/POST /api/responsibilities/triggers/:id/secret`; `DELETE /api/responsibilities/triggers/:id`.
- `GET/POST /api/proactive/settings`, creation with `?refuseExisting=true`; `PATCH/DELETE /api/proactive/settings/:id`; `POST /api/proactive/settings/:id/run`; `GET /api/proactive/suggestions`; `POST /api/proactive/suggestions/:id/{start,dismiss}`.
- `GET /api/tasks`; `POST /api/tasks/:id/{resolve,reopen,again}`.
- `GET/POST /api/channels`; paginated `?cursor`; `PUT /api/channels/:id/title`; rollback `DELETE /api/channels/:id`.
- `GET /api/capabilities`, `/api/me`, `/api/settings/preferences`, `/api/approvals/shared-use/bot/:agentId`; `POST /api/approvals/shared-use` with `{botId,serverId,reason:'trigger'}`.

Own allowlist slot adds `routines`, `responsibilities`, `proactive/settings`, `proactive/suggestions`, `tasks`. Other called families already belong to the shared base or integrated owners. Own registry slot adds Routines and the legacy Responsibilities destination. The original transport edit adds JSON content type only for defined JSON bodies; parent `a933aa2` independently contains the same fix and its bridge tests, which the merge preserves.

## Integration and deliberate adaptations

Exported `HyperBotRoutinesTab({agentId, context?})` and `HyperBotResponsibilitiesTab({agentId, context?})` both open the merged Bot routines view, matching upstream's legacy redirect. The Bot owner supplies the existing section context directly or wraps them in `HyperRoutineNavigationProvider`. Without host navigation, conversation buttons are visibly disabled. `HyperRoutinesConnectionPage` and `HyperRoutinesAppHint` are exported for the Connections owner and use `context.navigate('routines')`.

Native in-section navigation replaces upstream URLs, dialogs become in-section controls, and remote run output remains inert text. No upstream shell, router, CSS or theme is imported. Endpoint copy uses the backend-provided path/address. An optional transient Public OpenBot URL field produces a complete webhook URL for registration, rejecting URL credentials and non-HTTP(S) protocols rather than using Electron's renderer origin. These changes do not require a live backend, deployment or credentials.

GitHub source-binding management lives in upstream `components/settings/github-sources.tsx`; the merged parent already owns it in `settings/HyperSettingsAutomation.tsx`. It is not duplicated here. The Bot/Connections owners must mount the exported components in their respective screens; their shared files are outside this area's ownership.

Validation uses Node 24.18.1 and the existing dependency symlink. No package installation, live backend, Electron launch, secret capture or deployment is performed. Imported parent commits include other owners' documentation; this area does not edit acceptance/progress documents.

## Final local verification

Node 24.18.1: typecheck passed; focused routines and policy tests passed, 43 tests across three files; full suite passed, 829 tests with five skipped across 110 passing and two skipped files; production build passed. Existing Vite configuration and ineffective dynamic import warnings remain. Self-review checked upstream payloads, lifecycle guards, secret handling, rollback paths and folder ownership. No live service or Electron verification was attempted under this task's constraints.
