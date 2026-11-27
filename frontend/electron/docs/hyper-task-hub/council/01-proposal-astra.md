# HyperTaskHub | Astra's independent proposal

## Summary

Give me one card for a Jira issue, one place to see the messages about it, and a separate card if someone asks me to do something else about that issue.
Import work I already own. Put inferred requests in a review inbox with the sentence that prompted them.
Keep personal decisions on this device. Preserve each source's authority over its records and show when we last checked them.
My first release would ship an inspectable Today plan, a board and a meeting brief. All three should work with the AI endpoint switched off.

## 1. What counts as a task, and where did it come from?

A task is an action somebody can finish. An appointment occupies time. A message or article supplies evidence. One record can play more than one role. A meeting can reserve an hour and contain two assignments for me. A single “complete” button on the appointment would lose that distinction.

The following paths are relative to `frontend/electron`. This inventory describes the desktop implementation, inspected on the feature branch. Proposed additions are called out separately.

| Source | What HyperTask can read today | Mapping into the Hub |
| --- | --- | --- |
| Outlook mail | Classic Outlook must be running on Windows. The serialized STA bridge lists Inbox, Sent and Drafts in the default store. A summary includes EntryID, message kind, sender, subject, received time, unread, importance, protection, attachment indicator and preview. Detail adds To, Cc, reply-to, bounded plain text, truncation, attachment names/sizes, a version hash when available and meeting metadata. A list returns at most 50 matches after scanning at most 500 items. See `src/main/HyperOutlookBridge.ts:64`, `src/main/HyperOutlookBridge.ts:139`, `src/main/HyperOutlookSchema.ts:41`, `src/main/HyperOutlookSchema.ts:65`, `src/main/HyperOutlookScript.ts:705`. | Treat received messages as evidence and use Sent to check replies or identify a promise I made. Exclude Drafts from automatic extraction. The current contract lacks follow-up state, task due date, conversation ID and a paging cursor. |
| Outlook calendar | A range query expands recurrences in the default calendar, skips cancellations and stops after scanning 2,000 occurrences. Items carry start/end, all-day, busy status, response, organizer, attendees, location, bounded body, categories and last modification. A moved exception retains its original occurrence start in the composite ID. See `src/main/HyperOutlookScript.ts:37`, `src/main/HyperOutlookScript.ts:52`, `src/main/HyperOutlookScript.ts:596`, `src/main/HyperOutlookSchema.ts:57`. | Keep occurrence identity. Join an invitation through its returned event ID when available. Private events supply only a busy interval to the Hub. Free, cancelled and declined events release time. |
| HyperTask calendar | Hyper-Event is a database view identified by `hyper_general_calendar`. The controller reads calendar rows; the mapper returns row ID, date-field ID, title, start, optional end and all-day semantics. Outlook events have a separate renderer overlay. See `src/renderer/features/hyper-outlook/HyperGeneralCalendar.ts:8`, `src/renderer/features/hyper-database/HyperDatabaseController.ts:460`, `src/renderer/features/hyper-database/views/calendar/HyperCalendarData.ts:38`, `src/renderer/features/hyper-outlook/useHyperOutlookEvents.ts:57`. | Read selected native calendars through core. Retain database/row identity and the date-field role. Treat appointments as time constraints and mapped task dates as milestones. A date alone says little about availability. |
| Jira | Server/DC REST v2 supplies paged JQL search, issue details, identity and transitions. Dashboard search fields include summary, description, assignee, reporter, priority, type, status/category, created, updated, due date and resolution. Main already has field-selectable search and get tools in addition to create. See `src/renderer/features/jira/data/jira-api-client.ts:87`, `src/renderer/features/jira/data/models/jira-issue.ts:71`, `src/main/HyperBotsConnectors.ts:85`, `src/main/HyperBotsJiraTools.ts:18`. | Use numeric issue ID within the configured Jira instance. Keep key and browse URL as aliases. Read estimates and issue links explicitly when permitted. Only configured blocking link directions imply scheduling dependencies. |
| Newsletter | Connection status exposes base URL and Gantt capability. Main reads paged article summaries with draft/published status, author, excerpt and updated time, then HTML by ID and content offset. Project list and project detail return chart tasks, resources, roles, zoom and edit metadata. The bot slices project results locally. Task fields include ID, name, start, duration, optional end, status, progress, predecessor IDs, resource and milestone. See `src/main/HyperNewsletterConnection.ts:47`, `src/main/HyperNewsletterConnection.ts:82`, `src/main/HyperBotsNewsletterTools.ts:19`, `src/main/HyperBotsNewsletterTools.ts:60`, `src/main/HyperBotsNewsletterTools.ts:105`. | Articles are context by default. A draft by my namesake is insufficient evidence that I owe an edit. Import tasks for a resource I explicitly map to myself, keyed by connection, project and task ID. Carry project-level revision. A chart's elapsed days cover a schedule interval and supply no personal effort estimate. |
| HyperTask projects | Account/workspace-pinned protobuf reads discover accessible board and Gantt views, page task rows, and return title, description, status, assignees and available Gantt dates. People may be mapped select labels. The view finder stops at 40. See `src/main/HyperBotsProjectCore.ts:15`, `src/main/HyperBotsProjectTasks.ts:98`, `src/main/HyperBotsProjectTasks.ts:143`, `src/main/HyperBotsProjectTasks.ts:226`, `src/main/HyperBotsGanttTasks.ts:42`, `src/shared/HyperGanttSchedule.ts:51`. | Use workspace, database and row as identity; store view ID for navigation. Resolve to a shared database ID before collapsing linked views. Allow selection of unassigned rows from personal boards. Keep ambiguous people labels in review. |

I would use a stable local UUID for the user's action. Below is the projected card contract. The store also holds immutable observations by source revision. A field can cite several observations when sources disagree.

```ts
type HyperSource = 'mail' | 'outlookEvent' | 'calendarRow' | 'jira'
  | 'article' | 'newsletterTask' | 'projectRow'

interface HyperEvidence {
  source: HyperSource
  connectionId: string
  nativeKey: string[]    // ordered parts, including project or occurrence where needed
  revision?: string
  observedAt: string
  role: 'origin' | 'mirror' | 'mentions' | 'assignment'
  span?: { start: number; end: number; excerpt: string; rule: string }
}

type HyperWhen = { day: string; zone: string } | { instant: string }

interface HyperHubTask {
  id: string
  title: string
  ownerId?: string
  state: 'review' | 'ready' | 'doing' | 'waiting' | 'done' | 'dismissed'
  sourceStatus?: string
  due?: HyperWhen
  earliestStart?: HyperWhen
  effortMinutes?: number
  priority?: number
  blockedBy: string[]
  meetingIds: string[]
  evidence: HyperEvidence[]
  fieldOrigins: Partial<Record<'title' | 'ownerId' | 'due' | 'priority',
    number | 'owner'>>   // index in this projection's evidence array
}
```

Store field origins by durable observation ID internally. Preserve source-local dates, original priority labels, ownership and raw status alongside the projection. A user-edited title wins for display. A changed source deadline remains visible even when the owner has set a different personal target. Keep planned blocks separately so dragging tomorrow's work to today cannot change a Jira due date.

## 2. How should we recognize a request?

Start with explicit signals. Extend the classic bridge with an additive, main-only header scan returning store identity, last-modified time, flag state, task start/due/completion, conversation ID and, where available, Internet Message-ID and In-Reply-To. Decode unavailable fields as unknown. Filter COM sentinel dates. An active personal flag qualifies as a follow-up once the user enables flagged imports. A completed flag closes the flag-derived follow-up; clearing it retracts the flag evidence. Preserve any independent accepted action. Microsoft documents separate follow-up states and dates, classic Outlook task properties and a primary-mailbox To Do list with links to the original message. These are semantics we can adopt through COM. [Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/resources/followupflag?view=graph-rest-1.0) · [Classic Outlook](https://learn.microsoft.com/en-us/office/vba/outlook/Concepts/Electronic-Business-Cards/setting-items-for-follow-up) · [Microsoft To Do](https://support.microsoft.com/en-us/todo/using-microsoft-to-do-with-flagged-email-from-outlook)

Extract each request from the latest authored passage. Remove quoted history, forwarded headers, signatures and automatic footers. Preserve original offsets through Unicode normalization, case folding and Hebrew niqqud removal. Reuse the voice parser's diacritic and temporal vocabulary, with a dedicated extractor for written requests. One thread can contain a request, a promise and a subsequent cancellation. Sentence-level action detection and using nearby context to resolve a commitment both have research precedent. See `src/main/HyperVoiceCommandParser.ts:90`. [Bennett and Carbonell](https://www.microsoft.com/en-us/research/publication/detecting-action-items-e-mail/) · [Smart To-Do](https://www.microsoft.com/en-us/research/wp-content/uploads/2020/04/SmartToDo.pdf)

| Latest passage | Proposed decision |
| --- | --- |
| “Dana, can you send the signed plan by Thursday?” / “דנה, תוכלי לשלוח את התכנית עד יום חמישי?” | If Dana matches a verified owner alias and recipient, suggest “Send the signed plan”. Show the quoted deadline and its resolved date. |
| “אשלח את ה־report מחר” in Sent | Suggest my promise. Resolve tomorrow against the message's local date and known timezone. Ask for clarification on ambiguous dates such as 03/04. |
| “Have you approved the copy?” directly to me | After one working day, suggest a reply when tracked Inbox/Sent coverage and thread evidence support “no reply seen”. A later reply suppresses the nudge. It does not prove the copy was approved. |
| “Action items / משימות: נועה תבדוק את DEV-17; דן ישלח תקציר” | Split at the ownership change. For Noa suggest checking DEV-17. Keep Dan's action as context. In “we should review this”, ownership is unknown. |
| “FYI”, “אין צורך לשלוח”, quoted “please approve”, meeting acceptance or distribution-list traffic | Suppress the suggestion unless a separate current, directed request survives. A Cc, question mark, VIP sender or unread bit alone earns no card. |

Use identity from the connected account and owner-confirmed aliases. Outgoing questions belong in Waiting if I choose to chase them. Conversation membership alone cannot prove who answered which question; when coverage is incomplete, show “possible reply needed” on demand. Superhuman's conditional reminder offers a good model for a reminder the owner can cancel. [Superhuman Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me)

Review shows the exact sentence, source, inferred owner/date and reason. Accept or edit creates one local action, Link attaches the evidence to existing work, Later snoozes, Dismiss suppresses that action fingerprint. Preserve these decisions across rule updates. A materially new request gets fresh evidence. Review items never consume capacity. Measure per-rule precision, duplicates per accepted action and wrong-owner errors on separately labeled English, Hebrew and mixed fixtures. For the initial pilot I would require at least 90% precision on reviewed text suggestions in each language cohort before enabling background suggestions by default. Keep low-sample cohorts opt-in and measure missed actions on a random sample of suppressed mail.

Optional AI may phrase a title or suggest another action from an owner-enabled excerpt. Use a tool-free call, a strict output schema and exact substring citations. Reject invented dates, identities and spans. Reuse the existing untrusted-data envelope for every source, including HTML converted to inert text. Endpoint configuration alone grants no permission to send mailbox content. Limit input to opted-in sources, exclude protected content and discard prompt/output logs. See `src/main/HyperBotsRuntime.ts:95`, `src/main/HyperBotsEngine.ts:101`, `../../doc/local-ai-endpoint.md:23`.

## 3. When should two records become one card?

Upsert exact scoped native identity first. For a validated Jira mirror, verify the key and configured canonical browse URL against the issue. The existing mapper checks both, and a full refresh leaves old mirror rows intact. Mark that row as a mirror so stale copies cannot resurrect completed or inaccessible work. See `src/renderer/features/jira/data/HyperJiraKanbanMapper.ts:35`, `docs/HYPER_JIRA_KANBAN.md:9`.

“DEV-17: send QA the logs” links to DEV-17; sending logs may still deserve its own checkbox. A Newsletter milestone mentioning DEV-17 can be related to both. Resolve a bare key within a single known instance. Match URLs against configured origin **and context path**, stripping presentation-only fragments after recognizing the route. Never fetch a URL to discover its identity. A meeting URL can recur for months and identifies neither a task nor an occurrence.

For fuzzy suggestions, compare normalized title tokens within the same owner/project and time range. Require another independent match, such as participants or deadline. Show the matching facts and let the owner merge, split or mark distinct. Persist negative matches. Keep all evidence and per-source statuses after a merge. One dismissed email must never close a Jira issue.

## 4. Where should data live and how should it sync?

Use a hybrid. Source systems own their records; Rust core owns native HyperTask rows. A device-local main-process store owns personal actions, triage, dismissals, identity mappings, links and plans. Put versioned data under `<support>/hyper_task_hub/users/<accountHash>/<workspaceHash>/`. Separate durable decisions from replaceable source observations so clearing the cache cannot erase a plan. Use encrypted payloads with an OS-protected key, including excerpts and cache journals. Retain minimal evidence for 30 days by default; keep opaque dismissal fingerprints longer. Remove cached payloads, related excerpts and derived brief text on disconnect or access revocation. Show surviving owner-authored tasks with unavailable references. Follow the existing account isolation and credential storage conventions. See `docs/HYPER_BOTS.md:77`, `src/main/HyperNewsletterConnection.ts:77`.

```ts
interface HyperReadScope {
  accountId: string
  workspaceId: string
  connectionId: string
  generation: number
}
interface HyperReadPage {
  observations: HyperEvidence[]
  next?: string
  coverage: 'partial' | 'complete'
}
interface HyperReadConnector {
  page(scope: HyperReadScope, cursor: string | undefined,
       signal: AbortSignal): Promise<HyperReadPage>
}
```

The calendar script masks sensitivity value 2, while the mail helper also suppresses confidential and rights-protected content. Extend the calendar adapter to map confidential or unreadable sensitivity to busy-only before indexing, including subjects, attendee names and attachment metadata. Pass plain text to the renderer and allow navigation only through typed source targets validated in main. See `src/main/HyperOutlookScript.ts:52`, `src/main/HyperOutlookScript.ts:182`.

The page sketch omits source-specific payload types for brevity. Validate those at the adapter boundary. `HyperHubSync` captures scope, orders per-source reads and commits records and their cursor together. `HyperHubStore` checks generation again inside the transaction. Cancel on sign-out; ignore late completions. No renderer-supplied account ID selects a partition. No write method belongs on the read connector.

- **Outlook.** Refresh on presence recovery, focus when stale, and every five minutes while active. Start with 14 days of Inbox/Sent and a rolling calendar window of yesterday through 14 days ahead. Introduce a bounded modified-time scan with continuation through timestamp ties and explicit exhaustion. Include a separate inventory for active flags on older mail. Replay an overlap and upsert by ID. Existing received-time limits miss old mail flagged today. A scan that hits a limit keeps its incomplete marker. Reconcile previously seen calendar occurrences only inside a completely scanned interval.
- **Jira.** For a configured project use `project = "ABC" AND assignee = currentUser() AND statusCategory != Done ORDER BY updated ASC, key ASC`. Honor a narrower configured filter by parenthesizing its predicate before adding personal scope. Separate “reported by me” into Waiting. Project-wide updates including closed/reassigned items, or targeted rereads of tracked IDs plus a daily full membership scan, retire issues leaving the query. Reuse the dashboard snapshot where its coverage matches; share its five-minute trigger. A Hub-specific query uses its own cursor, leaves dashboard keys intact and uses main's credential-bound search transport. Existing incremental sync overlaps five minutes and only full sync removes missing issues. Explicitly distinguish server total from fetch cap. See `src/renderer/features/jira/data/jira-local-store.ts:27`, `src/renderer/features/jira/data/jira-repository.ts:66`, `src/renderer/features/jira/data/jira-api-client.ts:114`, `docs/HYPER_JIRA_KANBAN.md:3`. [Atlassian functions](https://confluence.atlassian.com/jirasoftwareserver101/advanced-searching-functions-reference-1455427016.html) · [Atlassian fields](https://confluence.atlassian.com/jirasoftwareserver104/advanced-searching-fields-reference-1527941030.html)
- **Newsletter and core.** Poll selected projects and article summaries every 15 minutes. Compare project revisions, fetch each changed chart once and slice the downloaded snapshot locally. Reconcile deletions only after a complete authoritative read. For selected local views, invalidate changed rows on core notifications and rescan on workspace resume. Check access before rendering.
- **Failures and writes.** Display last success and partial coverage per source, retain cached work through network outages and back off with jitter. Keep local planning available offline. Launch external editors for the first release. Later, a distinct main-process command can preview target, account, exact change and current source version for approval. Recheck before execution. Jira status changes require a valid transition. Newsletter chart replacement has an expected revision; its task PATCH lacks that check. Keep unsupported conflict-sensitive edits in the source editor. Never replay a timed-out send. See `src/main/HyperBotsOutlookTools.ts:109`, `src/main/HyperBotsJiraTools.ts:70`, `src/main/HyperBotsNewsletterTools.ts:141`, `src/main/HyperOutlookBridge.ts:152`.

## 5. What should I do first?

Filter to accepted, actionable work. Defer waiting, unmet predecessors and future starts. Compute slack in working minutes before the earliest confirmed deadline or dependent meeting, after removing busy time and estimated effort. My starting score uses bounded 0–1 inputs: 45 points for shrinking slack, 25 for owner-set importance, 20 for unblocking accepted work and 10 for age. Let owners tune weights and working hours. Reserve a modest aging allowance for undated work. Do not turn model confidence or sender seniority into urgency.

Place pinned blocks first, then try deadline-critical chains and fill free intervals by score. Break ties by deadline and stable ID. Treat milestones as zero-duration and mark dependency cycles for review. Never split work without an explicit chunk size. Unknown effort gets a labeled planning estimate editable in place. “Review the release notes first. QA meets at 11:00, this takes 25 minutes, and your next free slot is 10:15–10:45.” If nothing fits, show the shortfall. Motion documents duration, start and deadline constraints; Reclaim distinguishes priorities when allocating calendar time. [Motion scheduling inputs](https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/what-auto-scheduling-considers) · [Reclaim priorities](https://help.reclaim.ai/en/articles/4292868-using-priorities-to-control-how-tasks-get-scheduled)

## 6. What belongs in a meeting brief?

Build a local brief for the next accepted or organizer-owned meeting within 24 hours, refresh when opened, and invalidate it after a move, cancellation or related change. Lead with decisions due and my open actions. Then show attendees, relevant issue state, latest related correspondence and owner-accessible document references. Rank explicit occurrence links and issue keys first. Require a shared project or topic before attendee overlap brings in a message. Show the reason each item appears, source revision/time and an open-source action. Attachment names are references; the mail bridge returns no file contents. “No linked documents” is a complete answer. Suppress detail for private meetings and mark stale sections offline.

## 7. Where should the views live?

Give HyperTaskHub a dedicated page with Review, Board and Today. Preserve HyperHome's two working sections and add a compact next action and next meeting entry point. Board groups by personal workflow and displays source status alongside it. A drag changes local intent. Today shows a time grid, unscheduled work and a capacity count such as “4 h planned / 3 h free”. Keep dependency Gantt for project planning; defer the priority matrix until owners need to compare importance independently of urgency. Use ReUI Kanban, event-calendar and Gantt under their current licenses. Support keyboard triage, undo, logical layout and isolated direction for Hebrew text, Jira keys and times. See `src/renderer/features/hyper-home/HyperHomePage.tsx:112`, `docs/design/HYPERTASK_UI.md:12`. Sunsama's workload review and Akiflow's inbox beside a calendar fit these two distinct decisions: accepting work and finding time for it. [Sunsama daily planning](https://help.sunsama.com/docs/getting-started/basics/daily-planning-the-basics/) · [Akiflow](https://akiflow.com/)

## 8. Who builds what, and in what order?

Implementation begins after all three members sign the same consensus version.

| Phase | Owners and files | Acceptance test |
| --- | --- | --- |
| Read-only vertical slice | Astra owns `src/shared/HyperHubTask.ts`, main `HyperHubStore.ts`, `HyperHubSync.ts`, `HyperHubJira.ts`, `HyperHubProject.ts`, `HyperHubIpc.ts` and narrow preload bindings. Neon owns `HyperTaskHubBoard.tsx`. | Import an issue and its board mirror, restart offline, see one card, switch user and see neither record. |
| Mail, calendars and Newsletter | Astra extends the three existing Outlook bridge/schema/script files; adds main `HyperHubOutlook.ts`, `HyperHubCalendar.ts`, `HyperHubNewsletter.ts` and shared `HyperHubExtraction.ts`, `HyperHubLinks.ts`. Neon owns `HyperHubReview.tsx` and visual tests. | Replay a moved occurrence, a late flag on old mail, a Hebrew negation and two assignments in one message. Scope change during fetch commits zero stale records. |
| Planning and prep | Sol owns pure `src/shared/HyperPriorityEngine.ts`, `HyperHubSchedule.ts` and main `HyperMeetingPrep.ts`. Neon and Opus own `HyperHubToday.tsx`, `HyperMeetingBrief.tsx`, Home integration, styling and visual tests. | Freeze clock and timezone. Verify dependency order, daylight-saving boundaries, no overlapping blocks, impossible deadlines and brief invalidation offline. |

Use Vitest fixtures and fake transports. Run typecheck, tests and build from the Electron app. A consenting classic Outlook profile should validate flag semantics, paging ties and moved exceptions before enabling those imports broadly.

## 9. What decisions remain?

Which personal boards and Newsletter resources should count as mine? My default is explicit selection. May the Hub retain excerpts from corporate mail on this device, and may a configured endpoint receive any? Offer metadata-only ingestion and default to local rules. Which working week, timezone and holiday calendar should define “next working day”? Ask during setup and allow a per-user override. The largest delivery uncertainty is complete COM enumeration in a busy mailbox. Keep coverage visible until a real profile demonstrates recovery across restart, offline periods and flag changes.

## Positions I hold strongly

Every inferred obligation needs an attributable sentence and an owner decision. A mention can link two records without joining their completion states. Partial reads cannot establish deletion, a missed reply or free time. A shared workspace must receive external content only through an explicit owner action.

## Where I am flexible

I would shorten the initial lookback, tune the score weights or release Today ahead of the project timeline. I'd also accept a different local store if it preserves account isolation, atomic cursor commits and durable personal decisions when the source cache is cleared.
