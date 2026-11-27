# HyperTaskHub council proposal · Sol

## Summary

Give HyperTaskHub a dedicated board and Today plan. Put next-action and meeting links on HyperHome.
Rank with a visible weighted score. Compare two deterministic plans around working hours, meetings and dependencies.
Ask the owner to confirm inferred tasks. Build meeting briefs from local evidence and offer an optional cited summary.

## 1. Unified task model

Give each task a stable Hub ID, primary source and linked evidence. A source reference has kind, connection scope, native ID, optional container ID, open target, revision and fetch time. A task has title, evidence excerpt, status, requester, assignees, project, created or first-seen time, planned start/end, optional due, priority, remaining minutes, predecessor IDs and meeting links. Keep provenance per scheduling value and edge. Preserve source labels and civil dates with their zones. Store overrides, snooze, pins and order against the Hub ID. Occurrences have separate identities, attendance and availability.

| Source | Identity and mapping |
| --- | --- |
| HyperTask Board/Gantt | Workspace + database ID + row ID. Retain view IDs for navigation. Reuse the project reader's status and people mappings and read actual date cells for time precision. A configured relation can supply predecessor edges. |
| Jira | Connection + immutable issue ID, with the key and browse URL as aliases. Import status, reporter, assignee, priority and due date. Add optional sprint state, remaining time and explicitly directed blocking links to the existing repository/cache. Discover priorities per connection and use the Data Center Agile API where available. |
| Newsletter | Connection + project ID + task ID. Import resource assignment, progress, milestones, predecessor IDs and planned dates. Keep project duration in days separate from personal effort in minutes. An article is context unless a configured editorial assignment identifies an action for the owner. |
| Outlook mail | Mailbox + EntryID for evidence. Each confirmed action gets a Hub ID and evidence span, so one message can yield several tasks. A conversation is context for follow-ups. Preserve a local link when a moved message has an invalidated EntryID. |
| Outlook / HyperTask calendars | Outlook uses mailbox scope plus the existing occurrence key. Native events keep workspace/database/row identity and an occurrence key when applicable. Store join/open targets and event versions. Agenda follow-ups reference their occurrence. |

The project reader exposes row IDs, statuses and people. Its Gantt wrapper returns date strings. Read the underlying seconds, time flags and inclusive date ranges using the shared helper. Native Gantt disables dependency lines, so require a relation mapped as predecessors. Newsletter already exposes `predecessorIds` and `durationDays`. Jira's current issue model includes priority and due date. `src/main/HyperBotsProjectTasks.ts:193,226`, `src/main/HyperBotsGanttTasks.ts:42`, `src/shared/HyperGanttSchedule.ts:41,75,117`, `src/renderer/features/hyper-database/HyperCellCodec.ts:69`, `src/renderer/features/hyper-database/views/HyperGanttView.tsx:124`, `src/main/HyperBotsNewsletterTools.ts:19`, `src/renderer/features/jira/data/models/jira-issue.ts:55,71`, [Jira Data Center Agile issue API](https://developer.atlassian.com/server/jira/platform/rest/v10000/api-group-issue/).

## 2. Extraction and confirmation

Start with selected mail or an enabled folder scan. Use the bridge's bounded list/read operations. Parse the latest authored text and agenda bullets after removing quoted replies, signatures and disclaimers. In Unicode-normalized English and Hebrew, look for an explicit action plus owner evidence such as direct recipient and a request addressed to them, a named assignment, or an owner flag. For example, “Dana, please review OPS-42 by 14:00” and “דנה, נא לבדוק את OPS-42 עד 14:00” each yield a review candidate if Dana is the owner. Meeting proposals require an action or prep request in the body or linked notes. An invitation by itself supplies a calendar interval. A broad CC, vague “we should”, or a quoted instruction stays out of the automatic review queue. Resolve dates against the message timestamp and configured zone. Ambiguous phrases such as “next Sunday” stay unset pending review.

Show the source span, proposed owner and due date for accept, edit, dismiss or attach. Persist dismissals. Optional AI returns the same candidate schema with verifiable spans. Structured fields and owner edits outrank inferences. Reuse bilingual language and temporal patterns where they fit written text, and respect protected-mail and private-event redaction. `src/main/HyperOutlookSchema.ts:41,57,64`, `src/main/HyperOutlookScript.ts:52,182,705`, `src/main/HyperBotsOutlookTools.ts:418,438`, `src/main/HyperVoiceCommandParser.ts:20,48`.

## 3. Dedupe and linking

Upsert exact scoped native IDs. Detect Jira mirrors in Hyper-Kanban by canonical Jira browse URL plus key and treat their row as an alias. The existing mapper already checks the URL before updating a matching key. Use one canonical status and deadline per planning task with the chosen source visible. A mail mentioning Jira becomes related evidence unless it duplicates the same action. “Send the customer a workaround for OPS-42” remains its own task even when OPS-42 is already tracked. A matching title across Newsletter and Jira suggests a link for confirmation. User-confirmed merges preserve both references, resolve conflicting due/effort fields explicitly, deduplicate redirected dependency edges, and support undo. Persist aliases and suppressions across refreshes. Reject ambiguous bare Jira keys across connections and surface cycles introduced by merges. `src/renderer/features/jira/data/HyperJiraKanbanMapper.ts:34,60,69`.

## 4. Storage, sync and write-back

Keep native tasks in the HyperTask database. Store a rebuildable device-local connector projection and a durable ledger of overrides, confirmed actions, merges and plan choices. Scope by user, workspace and connector account. Publish complete source generations atomically, serialize ledger edits and discard stale-generation replies. Record coverage and last success. Retain unconfirmed mail and calendar history for 30 days, plus seven days of upcoming events. Keep confirmed excerpts until their reference is removed. Exclude protected data, encrypt excerpts with safeStorage and keep secrets in main. Offer cache purge on disconnect.

Reuse Jira's existing five-minute scheduler and cache. Refresh selected Newsletter projects and opted-in mail every five minutes while the Hub is active. Refresh today's Outlook availability on open, reconnect and focus, then every minute while Today is visible, coalescing with calendar requests where ranges match. Refresh native rows on core notifications. Provide manual refresh and backoff. A partial or failed fetch preserves the last complete view and marks coverage stale. A missing search result is ambiguous. Mark removal only from an authoritative deletion or a confirmed source check. The current Outlook hook has a per-view in-memory snapshot and clears it on disconnect. A durable Hub snapshot requires its own storage. `docs/HYPER_JIRA_KANBAN.md:3`, `src/renderer/features/jira/data/jira-local-store.ts:28,37`, `src/renderer/features/hyper-outlook/useHyperOutlookEvents.ts:11,21,40,47`, `src/main/HyperNewsletterConnection.ts:52,77`.

First release reads external sources. Board drags update local planning state. Local “Done for me” hides a task from the owner's queue, while a dependency remains unmet until the authoritative task completes or the user explicitly resolves that dependency. Later write-back is a distinct action with a main-process confirmation tied to current target, payload and version. Refresh and show the diff on conflict. After a timeout, confirm the source state before any retry. Reuse existing native workspace checks and date-write semantics. `src/main/HyperBotsProjectCore.ts:18,35`, `src/shared/HyperGanttSchedule.ts:133`, `src/main/HyperBotsNewsletterTools.ts:142`, `docs/HYPER_BOTS.md:31`.

## 5. Ranking, scheduling and recommendation

Use `score = round(100 × sum(wᵢ × xᵢ) / sum(wᵢ), 2)`, where `clamp(x)` limits a value to 0–1. Weights below sum to 100. Unknown signals contribute zero with an “unknown” label, and the denominator stays fixed across tasks. Reject negative/nonfinite weights and all-zero settings. Show sliders, a live contribution breakdown and reset to defaults.

| Signal | Weight | Normalized value |
| --- | ---: | --- |
| Deadline | 24 | `clamp(1 - hoursUntilDue / 168)`. Overdue saturates at 1 and shows overdue age. For date-only due, use the next local midnight minus 1 ms in the source/project zone. |
| Explicit priority | 20 | Low .25, normal .5, high .75, urgent 1. Owner or configured native priority. |
| Jira priority | 10 | Map configured priority IDs to lowest .2, low .4, medium .6, high .8, highest 1. Unmapped is unknown. |
| Active Jira sprint | 5 | 1 for a confirmed active sprint, 0 otherwise. A sprint end is a planning hint. |
| Critical path | 10 | 1 for zero total float in a valid project network with known durations in common units, 0 otherwise. |
| Items blocked | 10 | `min(5, openDirectSuccessorCount) / 5`, using unique Hub IDs for verified edges. |
| Requester | 6 | 1 for an owner-marked key contact, .5 for an explicitly elevated contact, 0 otherwise. Mail Importance and job title carry no weight. |
| Effort | 5 | `clamp((120 - remainingMinutes) / 105)` for known positive minutes. Unknown effort gets a 45-minute provisional block and zero score contribution here. |
| Age | 4 | `clamp(daysSinceCreatedOrFirstSeen / 28)`. Editing a task preserves its age. |
| Meeting | 6 | `clamp(1 - hoursUntilMeeting / 24)` for the earliest upcoming occurrence with an explicit prep/action link. |

Collapse signals derived from the same field. An independent owner priority can supplement Jira priority. For critical path, compute `ES = max(predecessor EF)` and `EF = ES + duration` in topological order. A backward pass from a shared terminal computes `LS - ES` as total float. Exclude isolated nodes and withhold critical labels for incomplete or cyclic networks. Missing unfinished predecessors and cycles block planning. Completed predecessors satisfy their edges. [Kelley and Walker, 1959](https://doi.org/10.1145/1460299.1460318), [Kelley, 1961](https://pubsonline.informs.org/doi/10.1287/opre.9.3.296).

| Approach | Use in HyperTaskHub |
| --- | --- |
| WSJF | SAFe divides relative cost of delay by job duration. Useful as an evaluation baseline. A divisor magnifies shaky effort estimates, so use a capped quick-work contribution. [SAFe](https://framework.scaledagile.com/wsjf/) |
| Eisenhower matrix | Urgency and importance give two good triage axes. Quadrants leave ordering within a quadrant and actual availability open. [Eisenhower's address](https://www.presidency.ucsb.edu/documents/address-the-second-assembly-the-world-council-churches-evanston-illinois), [Covey's quadrants](https://www.franklincovey.com/courses/the-7-habits/habit-3/) |
| Earliest deadline first | Use due order as one pass. Classical EDF results assume a preemptive processor model. Personal tasks may need contiguous time and predecessor work. [Liu and Layland, 1973](https://web.cs.wpi.edu/~cs502/f07/Papers/Liu%20%26%20Layland%2C%20Real-time%20Scheduling.pdf) |
| Moore–Hodgson | Walk due dates and drop the longest job from any infeasible prefix. It minimizes the number of late jobs in the classical unweighted single-machine problem. Here, meeting gaps and task value matter. [Moore, 1968](https://doi.org/10.1287/mnsc.15.1.102), [Cheriyan, Ravi and Skutella, 2021](https://arxiv.org/abs/2104.06210) |
| Critical path | Use for project risk and enforce explicit precedence in both passes. A critical task may still need a colleague or a free interval. |
| Constraint solver | Optional intervals and no-overlap constraints can model this well. Adoption would require a precise objective, offline packaging and stable tie-breaking. Measure greedy misses first. [OR-Tools scheduling model](https://developers.google.com/optimization/scheduling/job_shop) |

**Choose two greedy passes.** Normalize working hours in the user's IANA zone, including editable workdays and breaks. Clip today's windows at the supplied clock and subtract the union of busy time, protected time and accepted local blocks. Treat Outlook busy, out-of-office and tentative as occupied by default. Ignore free, working-elsewhere, declined and cancelled events. Block a native calendar reservation when it is configured as busy. Union overlaps across calendars and use date-only endpoints as half-open civil-day intervals. Stale calendar coverage makes the plan provisional. With no snapshot, show ranked work and request manual availability before proposing times. `src/main/HyperOutlookScript.ts:77,597`, `src/renderer/features/hyper-outlook/HyperOutlookData.ts:23`, [Outlook availability values](https://learn.microsoft.com/en-us/office/vba/api/outlook.olbusystatus).

1. Validate finish-to-start edges. Queue the owner's open work, ordered by the pass's comparator. Future starts and snoozes set release times. Place dependency roots first, then enqueue successors once all open predecessors have valid placements, including fixed blocks. Keep outside dependencies waiting. Insert each task at its earliest contiguous fit after release and all predecessor finishes. Later entries can fill earlier gaps. Keep conflicting fixed blocks visible for review and exclude them from suggested starts. A planned predecessor finish forecasts the successor's start. Only actual completion or explicit resolution makes the successor ready now.
2. In both passes apply owner pins, then explicit Today order. First pass then sorts by descending score. Second pass sorts by earliest effective due, then score. Compute effective due backward as the minimum of the task's own due and each successor's effective due minus that successor's estimated minutes. This relaxed bound helps get prerequisites into the queue earlier. Compare ties by own due, then code-unit Hub ID. Missing due sorts last.
3. Choose lexicographically by sum of `1 + score` for on-time finishes against deadlines due in the remaining workday, then by sum of `1 + score` for all placed tasks, then prefer the score-first pass. Count deadlines from explicit source fields or owner confirmation, including confirmed prep dates. Past or missed deadlines remain actionable and get a warning. Return blocks and reasons for unscheduled work. Offer an estimate change or manual split when gaps are too short.

For `n` tasks, `e` edges and `b` normalized work/busy intervals, each pass uses `O(n log n + e + n(b+n))` time with a heap and scanned ordered gaps, after `O(b log b)` calendar preparation. Space is `O(n+e+b)`. Fixed arithmetic, input clock, sort keys and pass count make the result reproducible. This heuristic can miss better packings.

At 09:00 there is a meeting from 10:00 to 11:00. A 45-minute release checklist due in 48 hours blocks two 25- and 20-minute steps and is on the critical path. High explicit priority, a key requester and seven days of age give it **56.71** points. A low-priority 30-minute renewal due at 10:00 scores **33.14**. The score pass places the checklist at 09:00 and the renewal after the meeting. The due pass places the renewal at 09:00 and the checklist at 11:00, then the two dependent steps after 11:45. Pick the second pass. The card says “Renew the certificate first. It's due at 10:00, takes 30 minutes and fits before your 10:00 meeting.” If the next block starts later, show when. Keep “why” anchored to actual contributions and placement decisions.

Pin or reorder explicitly changes queue precedence for Today. A fixed block is a separate local reservation. Snooze changes release time. Completion removes the task from recommendations and may unlock successors. Provide undo. For later tuning, offer an editable effort default after five owner-recorded actual durations in a connector/task category, using the median of the latest ten. A completion timestamp alone cannot measure effort. Keep weights under direct owner control.

```ts
// HyperPriorityEngine.ts and HyperDayPlanner.ts
type HyperMs = number
type HyperInterval = { startMs: HyperMs; endMs: HyperMs }
type HyperSignal = 'due' | 'priority' | 'jiraPriority' | 'sprint' | 'critical'
  | 'blocks' | 'requester' | 'effort' | 'age' | 'meeting'
type HyperWeights = Readonly<Record<HyperSignal, number>>
type HyperRankingInput = {
  weights: HyperWeights
  rows: readonly {
    taskId: string
    signals: Partial<Record<HyperSignal, { value: number; evidenceId: string }>>
  }[]
}
type HyperRanked = {
  taskId: string
  score: number
  reasons: readonly { signal: HyperSignal; points: number; evidenceId: string }[]
}
declare function hyperRankTasks(input: HyperRankingInput): readonly HyperRanked[]
declare function hyperPlanDay(input: HyperDayInput): HyperDayPlan
type HyperPlanningTask = {
  id: string
  dueMs?: HyperMs
  releaseMs?: HyperMs
  minutes?: number
  predecessorIds: readonly string[]
  state: 'ready' | 'done' | 'waiting'
  confirmedDeadline: boolean
  pinned?: boolean
  manualOrder?: number
}
type HyperTaskBlock = HyperInterval & { taskId: string }
type HyperUnscheduledTask = {
  taskId: string
  reason: 'waiting' | 'cycle' | 'no-window' | 'fixed-conflict' | 'no-coverage'
}
type HyperRecommendation = {
  block: HyperTaskBlock
  state: 'start-now' | 'start-later' | 'waiting'
  reasons: readonly string[]
}
type HyperDayInput = {
  nowMs: HyperMs
  tasks: readonly HyperPlanningTask[]
  ranked: readonly HyperRanked[]
  working: readonly HyperInterval[]
  busy: readonly HyperInterval[]
  fixed: readonly HyperTaskBlock[]
  calendarCoverage: 'fresh' | 'stale' | 'missing'
}
type HyperDayPlan = {
  blocks: readonly HyperTaskBlock[]
  unscheduled: readonly HyperUnscheduledTask[]
  next: HyperRecommendation | null
  pass: 'score' | 'due'
  provisional: boolean
}
```

Normalize signals with the same supplied clock before ranking. Here `ready` means assignable to this owner, subject to graph and calendar checks. Return ranking in score order. Recommend from chronological blocks with the actual prerequisite status. Localize structured reasons at display time.

## 6. Meeting prep

Build briefs on demand, precompute within 24 hours and refresh on evidence changes or 30 minutes before start. Search 30 days of mail and up to two prior occurrences in a verified series. Index attendee SMTP identities, subject terms, scoped Jira keys, linked documents and open work with those attendees. Keep the bridge's original-start occurrence key. Add optional verified series and mailbox-scoped conversation IDs. Weak or legacy thread matches are display hints. Resolve documents within already-authorized sources and exclude private, cancelled and declined meetings from prep. `src/main/HyperOutlookScript.ts:37,52,215,597`, `src/main/HyperOutlookSchema.ts:57,64`, [Outlook ConversationID](https://learn.microsoft.com/en-us/office/vba/api/outlook.mailitem.conversationid), [Clean Global Object ID](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxocal/6dfb37ac-94e7-4a73-b6dd-f289bcb1f47c).

Manually linked evidence comes first. Score the rest by exact Jira key or trusted document link +60, verified series history +35, two distinctive subject terms +20, matching attendee or organizer identity +15, and age under seven days +5. Use normalized English/Hebrew tokens with stopwords and whole Jira keys. Admit direct, series, or topical matches, and show up to three attendee-only open tasks under “Open with attendees.” Group by thread, tie-break by recency then ID, and cap related threads at five. For “OPS-42 / שחרור גרסה,” a two-day-old message with the key, both Hebrew terms and an attendee gets 100. An unrelated recent message from that attendee gets 20 and stays out.

The brief shows time, join link, attendee list, agenda excerpt, linked issues and blockers, mail threads, prior decisions and open actions, and linked documents. Show why each item matched and what is stale or unavailable. Previous decisions require a source excerpt or confirmed note. Use `hyperBuildMeetingBrief(input: HyperMeetingBriefInput): HyperMeetingBrief` with a snapshot, occurrence and supplied clock. Optional “Summarize” in main sends only selected excerpts and IDs to the configured endpoint as `{ source, untrusted_data }`. Validate the output schema and citation membership, render as plain text, and fall back to the deterministic brief on failure. Give the summarizer zero tools. `src/main/HyperBotsEngine.ts:81,215`, `src/main/HyperBotsRuntime.ts:95,916`.

## 7. Visuals and interactions

Put Board and Today in a dedicated HyperTaskHub page. Use the existing ReUI Kanban and event calendar, with keyboard alternatives to drag. Board lanes show status, source and blockers. Today shows working hours, fixed meetings, proposed blocks and overflow reasons. HyperHome gets next action and next meeting links above its existing split. Add the urgency/importance matrix as a secondary view and a project Gantt for verified dependencies. A workload grid can show available, planned and unplaced minutes by day when the horizon expands. Support `dir="auto"` for bilingual content, isolate Jira keys and times, and label stale state in text. `src/renderer/features/hyper-home/HyperHomePage.tsx:88,112,126`, `src/renderer/features/hyper-outlook/HyperGeneralCalendar.ts:11`, `src/renderer/features/hyper-database/views/HyperCalendarView.tsx:64,73`, `docs/design/HYPERTASK_UI.md:58`.

Motion and Reclaim document balancing deadlines and priorities against availability. I would keep work hours and fixed meetings firm. Sunsama's reviewable daily plan and workload threshold are good precedents for an overflow notice. Akiflow's calendar lock is a useful distinction between a local draft and a published block. SkedPal's Time Maps suggest a later opt-in for focused work windows. [Motion](https://www.usemotion.com/help/time-management/auto-scheduling), [Reclaim](https://help.reclaim.ai/en/articles/8291694-how-reclaim-uses-priorities-to-intelligently-plan-your-workweek), [Sunsama daily planning](https://help.sunsama.com/docs/usage-guides/daily-planning/), [Sunsama workload](https://help.sunsama.com/docs/usage-guides/tasks/planned-and-actual-times/), [Akiflow](https://product.akiflow.com/en/help/articles/3089241-time-slots), [SkedPal](https://docs.skedpal.com/time-maps/introduction-to-time-maps).

## 8. Delivery and evaluation

1. After shared sign-off, Astra owns `src/shared/HyperTaskHubTypes.ts`, `src/main/HyperTaskHubRepository.ts`, source adapters and read IPC/preload. Neon or Opus owns `HyperTaskHubPage.tsx` and the source-linked board.
2. Sol owns `src/shared/HyperPriorityEngine.ts` and `HyperDayPlanner.ts` with adjacent Vitest fixtures. Neon or Opus owns `HyperTaskHubToday.tsx`, explanations, settings and HyperHome integration.
3. Sol owns `src/shared/HyperMeetingBrief.ts` and main-process summary wiring. Astra owns metadata adapters and extraction candidates. Neon or Opus owns `HyperTaskHubMeetingPrep.tsx` and its visual tests. Revisit external write-back after read-only validation.

Use a fixed clock and seeded permutations in Vitest. Assert the worked examples, same outputs for shuffled inputs, zero overlaps, work windows, dependency ordering, and zero private or protected evidence leakage. Cover switch between accounts, partial sync, ambiguous Jira keys, cyclic and missing edges, stale availability, moved recurrence exceptions, Jerusalem DST and Sunday-start workweeks, unknown effort, and Hebrew/English thread matches. Benchmark 500 tasks and compare tiny exhaustive schedules against both passes using missed weighted deadlines and time placed. Compare against EDF-only, score-only and WSJF-like baselines on the same fixtures. For a private pilot, label top-three recommendations before seeing algorithm outputs, track override rate and reasons, and score brief precision@5 plus citation validity. Ship after typecheck, Vitest, build and a real-source read-only smoke test.

## 9. Risks and owner questions

- Which Jira projects, Newsletter projects, calendar rows and mail folders count as personal work? Default new mail scanning to opt-in and imported work to the selected ownership scope.
- Which working days and protected periods should seed the first plan? Support Sunday–Thursday and Monday–Friday presets. Decide how stale is too stale to suggest a future slot.
- Which task values justify an explicit hard commitment, and should user-pinned order ever yield for one? Start with visible misses and user review.
- Can meeting evidence leave the device via the configured endpoint? Ship local prep first and require a per-brief summary action for approved endpoints.
- Old Outlook versions and inconsistent estimates will produce missing matches or unplaced work. Measure both in the pilot before widening ingestion or adopting a solver.

## Positions I hold strongly

- Dependencies need explicit edges, and a recommendation needs real readiness and a feasible start.
- A local plan should explain the deadline it protects and honor working hours. Time on an external calendar requires a deliberate action.
- Meeting prep must work offline with citations. An inferred task needs review before it competes for time.

## Where I am flexible

- Adjust the initial weight table, prep window, effort default and launch order after seeing labelled examples.
- Adopt a constraint solver if repeatable cases show substantial missed deadlines or poor use of time with the greedy plan.
