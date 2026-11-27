# HyperTaskHub

Task Hub gathers your work from Jira, HyperTask boards and Gantt charts, the Newsletter Gantt, Outlook mail and calendars into one ranked list and a plan for today. It also prepares you for meetings. It reads your sources, and changes a Jira or Newsletter status only when you turn that on and confirm each change.

Open it from **Task Hub** in the sidebar, under Home. HyperHome also shows the next action, your Triage count and the next meeting in a bar above the Kanban.

The design was agreed by a three-member council (Astra, Sol and Opus). The binding specs are [council/03-consensus-spec.md](council/03-consensus-spec.md) (v2) and, for milestone 5, [council/07-m5-consensus-spec.md](council/07-m5-consensus-spec.md) (M5 v5). Both were approved unanimously.

## Views

- **Focus** (the default). Contains:
  - **Do this first**: the earliest task that is ready and fits your time today, with a one-sentence reason. Actions are Start, Snooze, Not today and Open.
  - **Next**: the ranked list. Drag to reorder, or pin. When a new order arrives while you are working, it waits behind an Apply pill.
  - **Today**: the plan time-boxed around your meetings, with capacity and the tasks that did not fit.
- **Board**: Triage, Next, In progress, Waiting and Done (today). Moving a card changes only your local status; each card also shows the source's own status. Each column shows up to 50 cards.
- **Triage**: suggestions from mail. Each one shows the exact sentence it came from. Accept (A), Edit (E), Dismiss (D). A possible duplicate is offered as Merge or Keep separate (L merges).
- **Meetings**: the next seven days by day, each meeting with its prep readiness, Viewed and related open work. **Needs prep** shows meetings not yet prepared, including those with prep only planned. Private meetings show as Busy.
- **Matrix**: urgency against importance in four quadrants, plus **Needs details** for tasks Task Hub cannot place yet. Dragging a card (or Move to in its menu) records your own placement with Undo. It never changes the ranking, the plan or a source.
- **Timeline**: 7 days or 4 weeks of plan blocks, source schedules, planned starts and due dates, with arrows only for verified dependencies. Effort never draws a bar. Read-only.
- **Meeting brief**: a side sheet for an accepted or owner-organized meeting. It lists your open actions, decisions due, related issues, recent threads, the previous occurrence and linked documents, and says why each item matched. It also opens from Hyper-Event (**Prep brief**) and the command palette (**Prep: <meeting>**).

Keyboard: 1 to 5 switch views. On a card: Enter or O opens the source, P pins, S snoozes, X marks done for you.

## How ranking works

The score is deterministic and explained in the **Why?** popover:

| Signal | Weight | Meaning |
| --- | --- | --- |
| Slack | 45 | Free working time before the deadline, minus the effort |
| Importance | 25 | Your priority, or Jira priority when you have not set one |
| Unblocking | 20 | Verified tasks waiting on this one |
| Age | 10 | How long the task has been open |

Mail importance, the sender and job titles never count.

Today's plan runs two passes, score-first and due-first, and keeps the one that protects the most deadlines. Free time comes only from fully read calendars or windows you declare ("I'm free 09:00–12:00"). The Hub never guesses.

## Changing status in Jira and Newsletter

Off by default. Turn it on per source in **Settings → Task Hub → Changes to your sources**.

- **Where:** a card menu (**Change status in Jira…**), the chip on a card whose source status differs from yours (**Jira: In Review**), or **Also update Jira…** in the toast after you move a card. Moving a card never changes the source by itself.
- **What you see first:** the issue or task, your account, its current status and version, the statuses your permissions allow, and any side effects. Jira may ask for a Resolution; Task Hub lets you pick one from the values Jira offers. Any other required field opens the issue in Jira.
- **Confirm:** a system dialog that only you can approve. Task Hub reads the source again right before sending. If it changed, you see the new status and decide again.
- **Newsletter:** only tasks without subtasks. Completing a task sets its progress to 100%; Undo restores the status but leaves progress at 100%. Newsletter also normalizes the chart and can update parent rows. Newsletter checks your permission when you confirm.
- **If the result is unclear** (for example a timeout), Task Hub never sends again. The card says **Jira update unknown** and offers **Check in Jira**. After Task Hub reads the source again you can choose **I checked in Jira** to plan with what the source shows.
- **Undo** is a new change with its own confirmation, offered only while the source still shows your change.
- Outlook stays read-only.

## Privacy and safety

- Everything is stored locally and encrypted (`safeStorage` / DPAPI), per account and workspace. Source text expires after 30 days or less. Disconnecting a source removes its text.
- Mail scanning is off until you turn it on in setup and choose the folders and retention. Protected and confidential mail is skipped. Private meetings appear only as "Busy".
- Suggestions from mail always wait in Triage. A language stays in "preview" until reviewed suggestions reach 90% precision.
- The AI summary of a brief is optional. It needs your consent and sends only the excerpts you select, as data, with no tools. The output is labelled "AI summary".
- Nothing is written to Outlook. Jira and Newsletter receive only status changes you confirm (see above). "Open" takes you to the source.
- Write-back cannot be approved by page code: every change needs a fresh preview bound in the main process and a system confirmation. This does not change how other parts of HyperTask already reach Jira with your saved credentials.
- **Add to Hyper-Kanban** copies only a task's title and source link into the shared board, after you confirm what will be visible.

## Setup

The first time, the gear button opens a three-step setup. After that it opens **Settings → Task Hub**, which edits the same choices and adds write-back and ranking weights (with a live preview of which tasks move). The three setup steps are:

1. **Sources:**
   - Jira projects;
   - HyperTask boards and Gantt charts;
   - calendars for free time (Outlook, HyperTask calendars);
   - your Newsletter Gantt resource;
   - mail suggestions.
2. **You:** names you go by, in English and Hebrew.
3. **Work week:** Sunday–Thursday or Monday–Friday, hours and time zone.

## Code map

| Owner | Area | Files |
| --- | --- | --- |
| Astra | Contract and fixtures | `src/shared/HyperTaskHub.ts`, `src/shared/HyperTaskHub.fixtures.ts` |
| Astra | Ingestion and storage | `src/main/hyper-task-hub/*` (store, sync, service, IPC, Jira, project, Outlook, calendar and Newsletter sources) |
| Astra | Extraction and linking | `src/shared/HyperHubExtraction.ts`, `src/shared/HyperHubLinks.ts` |
| Astra | Write-back, weights, mirror | `src/main/hyper-task-hub/HyperTaskHubWriteback.ts`, `HyperHubJiraStatusWriter.ts`, `HyperHubNewsletterStatusWriter.ts`, `HyperHubMirror.ts`; Hyper-Event on the shared cache (`hyper-outlook/useHyperOutlookEvents.ts`) |
| Astra | Renderer data layer | `src/renderer/features/hyper-task-hub/state/HyperTaskHubClient.ts`, `state/useHyperTaskHub.ts` |
| Sol | Ranking and planning | `src/shared/HyperPriorityEngine.ts`, `src/shared/HyperDayPlanner.ts` |
| Sol | Meeting briefs | `src/shared/HyperMeetingBrief.ts` |
| Sol | Status mapping and weights | `src/shared/HyperHubStatusMapping.ts`, `src/shared/HyperHubWeights.ts` |
| Sol | Selectors and reason text | `state/HyperTaskHubSelectors.ts`, `state/HyperTaskHubReasons.ts` (English and Hebrew) |
| Opus | UI | everything that renders under `src/renderer/features/hyper-task-hub/` (including `meetings/`, `matrix/`, `timeline/`, `writeback/`, `mirror/`, `settings/`, `setup/`), `features/settings/HyperTaskHubSettings.tsx`, `hyper-home/HyperHomeFocusBar.tsx`, the Hyper-Event Prep entry, the command palette entries, and the sidebar, tab and registry wiring |

**Verification:** run `npm run typecheck`, `npm test` and `npm run build` from `frontend/electron`. The UI was reviewed in light and dark themes with Hebrew content in the web harness, using the contract fixtures.

## Status and limits

- **Done:** M1 (Jira and native Board), M2 (availability and Focus), M3 (mail and Triage), M4 (meeting briefs), M5 (Meetings, Matrix, Timeline, Settings → Task Hub with weights, Hyper-Event on the shared availability cache, Add to Hyper-Kanban, and confirmed status changes in Jira and Newsletter).
- **Needs live checks:** Jira transitions and Resolution screens on your workflows, and Newsletter status changes against the deployed server. The automated tests use fakes.
- **Needs a live classic Outlook profile:** flag status and dates, the inventory of older active flags, protected-mail classification, recurrence exceptions, and store-bound paging and opening across a profile switch. The automated tests use fixtures. Importing flagged mail stays off until these checks pass.
