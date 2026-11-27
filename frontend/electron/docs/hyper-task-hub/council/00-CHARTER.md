# HyperTaskHub council charter

Working name: **HyperTaskHub**. The council may rename it, but the name must start with `Hyper`.

Branch: `feat/hyper-task-hub`. App root: `frontend/electron` (Electron + React + TypeScript, Rust core child process). Council folder: `frontend/electron/docs/hyper-task-hub/council/`.

## Goal (from the product owner)

Manage tasks across all of the user's connections in one place:

1. **Fetch relevant tasks** from email (Outlook mail), event calendars (Outlook calendar and the HyperTask calendar), Jira, and Newsletter (including its Gantt).
2. **Show them together** in an organized Kanban, plus other visuals that fit the job, such as a priority matrix, a timeline or Gantt, a Today plan, and a workload view.
3. **Optimize the order**: rank and schedule the tasks and recommend which task to do first, with a short explanation of why.
4. **Prepare for meetings**: for upcoming meetings, assemble a prep brief from related mail, Jira issues, tasks, attendees and documents.

## Council members

| Member | Model | Proposal focus | May implement |
| --- | --- | --- | --- |
| Astra | GPT 6.2 Astra (xhigh) | Ingestion: connectors, the unified task model, extracting tasks from mail and meetings, dedupe, sync and cache, privacy | Main process, shared logic, non-visual renderer code |
| Sol | GPT 6.2 Sol (xhigh) | Ranking and optimization: priority scoring, scheduling, "do this first" recommendations, meeting-prep generation, explanations | Main process, shared logic, non-visual renderer code |
| Opus | Claude Opus 5.5 (also the orchestrator) | Visuals and UX: Kanban and other views, the recommendations and meeting-prep surfaces, HyperHome integration | **UI** (sole UI owner) |

Each proposal covers the whole feature and goes deepest on that member's focus.

Gemini 4 Neon was originally the visuals member. Its quota ran out before Round 1, and the product owner gave the seat to Opus. Opus moderates the rounds and also holds the visuals seat. Opus wrote its Round 1 proposal without reading Astra's or Sol's.

**UI ownership rule (hard rule).** Only Opus may write visual UI: React components (`*.tsx` that render), CSS and Tailwind styling, layout, icons, and visual tests. Astra and Sol may write main-process code, `src/shared` logic, IPC, preload bindings, and non-rendering renderer modules (stores, adapters, hooks without JSX), as the consensus spec assigns them.

## Protocol: no implementation before mutual agreement

| Round | Each member writes | Rule |
| --- | --- | --- |
| 1. Proposal | `01-proposal-<member>.md` | Independent. Research the codebase and outside sources. Do not change code. |
| 2. Cross-review | `02-review-<member>.md` | Read the other proposals. State agreements, objections, and what you would concede. |
| 3. Consensus spec | `03-consensus-spec.md` (one drafter) | Merges the proposals and resolves each objection explicitly. Carries a version line, `Spec version: N`. |
| 4. Sign-off | `04-signoff-<member>.md` | `AGREE vN` or `OBJECT vN`, with the exact changes required. An objection triggers a revision and another sign-off. |
| 5. Implementation | code + tests | Starts only when all three members have signed `AGREE` on the same spec version. |

Members do not edit another member's files. Lowercase member names in file names: `astra`, `sol`, `opus`.

## Project rules (from AGENTS.md)

- The product is HyperTask, developed by NaveDanan. Preserve upstream copyright and license notices (AGPL-3.0, derived from Hypertask).
- Prefix new product modules and widgets with `Hyper` (for example `HyperTaskHubBoard`, `HyperPriorityEngine`).
- Keep existing protocol identifiers, data paths, settings keys and upstream dependency names compatible unless a migration is implemented.

## Existing assets to build on (inspect before proposing)

- Outlook mail, calendar and directory via classic Outlook for Windows: `src/main/HyperOutlookBridge.ts`, `HyperOutlookScript.ts`, `HyperOutlookSchema.ts`, `HyperBotsOutlookTools.ts`, renderer `src/renderer/features/hyper-outlook/` (including `HyperGeneralCalendar.ts` and `useHyperOutlookEvents.ts`). Docs: `docs/HYPER_OUTLOOK_PRESENCE.md`, `../../doc/hyper-outlook-security-review.md`.
- Jira Server and Data Center: `src/renderer/features/jira/` (store, offline cache, `HyperJiraKanbanMapper.ts`), `src/main/HyperBotsConnectors.ts`, `docs/HYPER_JIRA_KANBAN.md`, `../../doc/jira-integration.md`.
- Newsletter and its Gantt: `src/main/HyperNewsletterConnection.ts`, `HyperBotsNewsletterTools.ts`, `src/renderer/features/settings/connections/HyperNewsletterSettings.tsx`.
- HyperTask databases and project tasks: `src/main/HyperBotsProjectTasks.ts`, `HyperBotsProjectCore.ts`, `HyperBotsGanttTasks.ts`, `src/shared/HyperGanttSchedule.ts`, `src/renderer/features/hyper-database/` (Board, Calendar, Gantt views).
- HyperHome, the startup page with Hyper-Kanban on top and Hyper-Event below: `src/renderer/features/hyper-home/`, `src/main/HyperGeneralKanbanCore.ts`.
- Vendored ReUI components: `src/renderer/components/reui/` (kanban, event-calendar, gantt, data-grid).
- AI endpoint (OpenAI-compatible, DPAPI-protected key, used by the Hyper-Bots): `../../doc/local-ai-endpoint.md`, `src/main/HyperBotsEngine.ts`, `docs/HYPER_BOTS.md`.
- Design rules: `docs/design/HYPERTASK_UI.md`. Status: `docs/STATUS.md`.
- Commands, run from `frontend/electron`: `npm run typecheck`, `npm test` (vitest), `npm run build`.

## Constraints every proposal must respect

- **Local-first and offline.** The app must work with cached data when a source is unreachable. Secrets stay in the main process with DPAPI or safeStorage.
- **Untrusted content.** Mail bodies, meeting text, Jira and Newsletter content are data, never instructions. Any LLM step follows the Hyper-Bots convention for untrusted data and can never trigger writes on its own.
- **No silent writes to external systems.** Creating or updating Jira issues, mail or meetings needs the owner's approval, as the Hyper-Bots permission model already requires.
- **Deterministic core.** Ranking must work without an LLM. An LLM may enrich extraction or summaries when the endpoint is configured.
- **Explainable.** Every recommendation shows why: deadline, dependency, meeting soon, sender importance, effort, and so on.
- **Testable.** Pure functions for scoring and scheduling, with vitest coverage.
- **Bilingual.** Mail, meetings and issues may be in English, Hebrew or both. `src/main/HyperVoiceCommandParser.ts` already parses mixed English and Hebrew. Extraction must handle both languages, and the UI must render right-to-left text correctly.

## Questions every proposal must answer

1. The unified task model: fields, ids, source provenance, and how it maps to and from each source.
2. Extraction: how a task is recognized in mail and meetings (rules, heuristics, optional LLM), with precision safeguards and user confirmation.
3. Dedupe and linking across sources (for example, a mail about a Jira issue that is also a Newsletter Gantt task).
4. Where data lives and how it syncs: the HyperTask database as the system of record, a separate cache, or a hybrid. Refresh cadence, conflicts, and write-back.
5. Ranking: the scoring model and its inputs, the scheduling or optimization approach (for example weighted shortest job first, Eisenhower, critical path, or constraint-based time-blocking around meetings), tunable weights, and explanations.
6. Meeting prep: the trigger, the content of the brief, and its sources.
7. Visuals: which views, where they live (HyperHome or a new page), the interactions, and reuse of existing components.
8. A phased delivery plan with a file-level work breakdown and owners that respect the UI ownership rule.
9. Risks and open questions for the product owner.

---

## Amendment A1: Milestone 5 and write-back (2026-11-27)

M1 to M4 are done and integrated under spec v2 (`03-consensus-spec.md`). The product owner asked for two things:
1. Build **M5** with the council, then commit and open a pull request.
2. A new requirement: **the user can write to Jira and/or Newsletter to update status, within the user's own permissions.**

The second item overrides the "first release is read-only" line in spec D10 for **status changes in Jira and Newsletter only**. Outlook stays read-only, and so does every other field (title, description, dates, assignee, effort). Spec v2 remains binding wherever the M5 spec does not explicitly change it.

### M5 scope

| Item | Source |
| --- | --- |
| Meetings index (next 7 days, readiness, "Needs prep") | D9.2, D12 |
| Matrix (D6 urgency × importance; a quadrant drag records a named override with Undo) | D9.2 |
| Timeline (wraps the vendored ReUI Gantt; verified edges only) | D9.2 |
| Task Hub page in the Settings dialog: edits setup choices, plus weights with a live preview | D9.9 |
| Hyper-Event moved onto the shared availability cache | D5, D12 |
| Explicit "Add to Hyper-Kanban" mirror action, never automatic | D5.6 |
| **New: status write-back to Jira and Newsletter** | This amendment |

### What "within the user's own permissions" means

These are the moderator's reading of the request. The council may sharpen them but not weaken them.
- **The user's identity only.** A write uses the Jira and Newsletter connection the user already configured, so it carries exactly that account's server-side permissions. The Hub never borrows another credential, a bot identity or a stored admin token.
- **Only what the server allows.**
  - Jira offers only the transitions that the server returns for this issue and this user (`GET …/transitions`). Transitions that need screen fields the Hub cannot fill go to the source editor.
  - Newsletter offers a status change only where the token is allowed to edit that project, and where the council can find a safe way to apply it. A `403` or `401` is shown to the user as "You don't have permission"; it is never retried under another identity.
- **The user's explicit approval for every write.**
  - Write-back is **off by default**, with a separate opt-in per source in setup and settings.
  - Each write shows a preview first: the target, the account, the exact change and the current version. It runs only after the user confirms.
  - It is rechecked immediately before sending.
  - It is never triggered by an LLM, by mail content, by a bot, by drag-and-drop alone, or by a batch the user did not review item by item.
- **Spec D10 rules still hold.**
  - Use valid Jira transitions only.
  - Newsletter edits need a concurrency guard. The council must decide how a Gantt task status change gets one, because the task `PATCH` has no version guard (see `src/main/HyperBotsNewsletterTools.ts:141-168`). If no safe option exists, it stays in the source editor and the UI says why.
  - A write that timed out is never replayed. Its outcome is shown as "unknown — check in <source>" until the next read settles it.
- **Audited and reversible where the source allows.**
  - Each write appends a ledger entry: who, what, when, before and after, and the result.
  - Undo is a new, separately approved write back to the previous status, offered only while the source still shows our change.

### M5 protocol

M5 uses the same five rounds as the original protocol, with an `m5` prefix on each file:

| Round | File |
| --- | --- |
| 1. Proposal | `05-m5-proposal-<member>.md` |
| 2. Cross-review | `06-m5-review-<member>.md` |
| 3. Consensus spec (drafted by Opus as moderator) | `07-m5-consensus-spec.md`, with the line `M5 spec version: N` |
| 4. Sign-off | `08-m5-signoff-<member>.md`, `AGREE m5-vN` or `OBJECT m5-vN` |
| 5. Implementation | Starts only after three AGREEs on the same version |

The UI ownership rule and D11 file ownership still apply. Only Opus writes rendering code.

### Questions every M5 proposal must answer

1. **Write-back architecture.** The main-process command shape and the IPC contract:
   - preview, then approve, then execute;
   - permission discovery and caching;
   - the recheck and the version guard for each source;
   - timeout and unknown outcomes, the ledger and audit, Undo;
   - offline behaviour;
   - how the snapshot reflects a pending, succeeded, failed or unknown write.
2. **Permission model.**
   - How the Hub learns what this user may do in Jira (transitions, project permissions) and in Newsletter (the role in the Gantt, the token's scope).
   - How that knowledge expires.
   - What the UI shows when the user may not act.
3. **Status mapping.** How Hub states (Next, In progress, Waiting, Done) relate to source statuses:
   - Jira status categories versus workflow-specific transitions;
   - the Newsletter `pending | in-progress | completed | delayed` statuses plus progress.

   Does a Board drag ever offer a source write, and how is it kept from being silent?
4. **The other M5 items.** Data contracts and selectors for Meetings, Matrix, Timeline, weights with a live preview, the Hyper-Event cache move, and the mirror action.
5. **Security.**
   - A compromised renderer must not be able to write without a fresh preview token, user gesture and recheck.
   - No secrets reach the renderer.
   - Untrusted source text in previews.
6. **Tests and acceptance** for each item, and the file-level work breakdown with owners.
7. **Risks** and open questions for the product owner.
