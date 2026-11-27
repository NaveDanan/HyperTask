# Round 1 proposal: Opus (visuals and UX)

Written independently, without reading Astra's or Sol's proposals.

## Summary

1. **HyperTaskHub is a new local-tool page** (`localToolPlugin('taskhub')`, a sidebar entry under Home). It has five views behind one segmented switch: **Focus** (default), **Board**, **Matrix**, **Timeline** and **Meetings**. Triage is a mode inside the Board's first column, not a separate page.
2. **HyperHome keeps its Hyper-Kanban / Hyper-Event split.** It gains a 44px **Focus bar** on top: "Do this first", the next meeting with its prep status, and a triage count. Each item opens the hub.
3. **Focus is the most important view.** It shows one "Do this first" card with its reasons, a ranked Next list, and today's plan as a time-grid. Planned blocks sit between real meetings, so the plan is visible, not just the order.
4. **Every ranked item can explain itself.** A "Why?" popover shows the score as signed contributions, such as "Due tomorrow +32" and "Blocks 3 tasks +18", plus any manual overrides.
5. **The order never moves under the user's cursor.** While the user is interacting, a new ranking waits behind a "New order (3 moved) · Apply" pill. It applies on its own after 10 idle seconds or when the view is opened again.
6. **User actions are explicit constraints, not hidden learning:** pin, snooze, "not today", drag-reorder within Next, and quadrant drags. The UI records them as typed feedback events that the engine reads.
7. **Writes to Jira, Outlook or Newsletter always ask first.** A drag that implies an external write, such as Jira Done, shows the existing approval-style confirm. Hub-local status changes are immediate.
8. **Reuse:** the ReUI Kanban, Gantt and event-calendar time grid, shadcn primitives, `HyperPersonCard`, and the Jira page's layout and badge recipes. Tokens only; source identity comes from icon plus label, never new colours. Text is `dir="auto"` for Hebrew.
9. **Data boundary:** one renderer store, `useHyperTaskHub`, over a typed IPC API. Astra and Sol own the store and engine; I own every component that renders.

---

## 1. The unified task model (the UI's needs)

I leave the storage model to Astra. The UI needs one flattened **view model** per item, which the renderer store produces:

```ts
// src/shared/HyperTaskHub.ts (owner: Astra; fields the UI requires)
export type HyperHubSourceKind = 'outlook-mail' | 'outlook-event' | 'jira' | 'newsletter' | 'newsletter-gantt' | 'hypertask';
export type HyperHubStatus = 'triage' | 'next' | 'in_progress' | 'waiting' | 'done' | 'dismissed';
export interface HyperHubSourceRef {
  kind: HyperHubSourceKind;
  externalId: string;           // Jira key, Outlook EntryID, Newsletter task id, row id
  label: string;                // "PROJ-142", "Mail from Dana", "Gantt: Q1 launch"
  openable: boolean;            // the UI shows "Open in …" only when true
  stale?: boolean;              // last refresh failed; show the cached state
}
export interface HyperHubTask {
  id: string;                   // stable hub id
  title: string;                // shown with dir="auto"
  snippet?: string;             // at most 280 chars, plain text, never HTML
  status: HyperHubStatus;
  sources: HyperHubSourceRef[]; // 1..n after dedupe; [0] is primary
  due?: string;                 // ISO date or datetime
  start?: string;
  estimateMinutes?: number;
  people: { name: string; email?: string; role: 'requester' | 'assignee' | 'attendee' }[];
  relatedMeetingIds: string[];
  blocks: string[]; blockedBy: string[];
  extraction?: { confidence: number; rule: string; quote?: string }; // mail and meeting items only
  pinned?: { rank: number }; snoozedUntil?: string; userPriority?: 1 | 2 | 3 | 4;
}
```

The ranking result (owner: Sol) arrives with the items rather than inside them, so a re-rank never rewrites task objects:

```ts
export interface HyperHubRankedItem { taskId: string; rank: number; score: number; tier: 1 | 2 | 3 | 4;
  urgency: number; importance: number;                // 0..1, drive the Matrix
  reasons: { code: string; label: string; delta: number }[]; } // drive "Why?"
export interface HyperHubPlanBlock { taskId: string; start: string; end: string; kind: 'focus' | 'prep' | 'buffer' }
```

## 2. Extraction (the UI's part)

Mail and meeting extraction produce **suggestions**, never silent tasks.

- Items with `extraction.confidence` below Astra's auto-accept threshold land in **Triage**. Each card shows the quoted sentence that triggered it, highlighted, plus the rule ("Direct request · 'can you send … by Thursday'").
- Triage keys: `A` accept, `D` dismiss, `S` snooze, `E` edit title or due date before accepting, `Enter` opens the source.
- Dismissals are remembered per source message, so a re-sync never brings a suggestion back.
- I hold that flagged mail, meeting requests, Jira issues assigned to me and Newsletter Gantt tasks assigned to me skip Triage, because they are already explicit. Everything inferred from free text goes through Triage until the user turns on "auto-accept high confidence" in hub settings.

## 3. Dedupe and linking (the UI's part)

A merged item shows **one card with stacked source badges**, such as Jira and mail icons, and "2 sources". The Why popover and the detail sheet list each source with an "Open" action. A wrong merge can be undone with "Unlink from …", which sends a typed `unlink` feedback event. Fuzzy-title matches below certainty show as "Possibly the same as PROJ-142 · Link / Keep separate" in Triage rather than merging silently.

## 4. Storage and sync (opinion)

The UI shows sync honestly. A source-status row in the hub header has one chip per source:

- connected: "Jira · 2 min ago";
- syncing: a spinner;
- stale: a warning tint with "Outlook · stale since 09:12";
- failed or unconfigured: "Open settings", which deep-links into Settings → Connections.

Cached items stay visible when a source is offline and carry a `stale` dot.

My opinion on the system of record is a **hybrid**. A main-process hub store holds normalized items plus the user's overlay state: triage decisions, pins, snoozes, manual order, hub-local statuses. HyperTask databases stay a *source*. Accepted hub tasks can optionally be mirrored into the existing Hyper-Kanban board, as the Jira sync already does (`docs/HYPER_JIRA_KANBAN.md`). The database board cannot show scores, reasons or multi-source provenance, and writing every mail-derived suggestion into the user's workspace would pollute it. I am flexible on the mechanics.

## 5. Ranking (opinion)

I want a deterministic weighted score with signed, named contributions, because the Why popover needs exactly that. On top of it sits a greedy time-blocking pass that fills free calendar slots in rank order, respects working hours, and puts a prep block before meetings that need one.

Eisenhower is a **visualization** of two sub-scores (urgency and importance), not the algorithm. Pins are hard constraints that sit above score. Snoozed items leave the ranking until their time. I defer the formula and weights to Sol, with three UI requirements:

1. reasons with deltas;
2. a stable tie-break, so identical inputs give an identical order;
3. a cheap re-run under 50 ms for 500 items, so drag feedback feels instant.

## 6. Meeting prep (the UI's part)

The prep brief is a **right sheet**, 440px like the Gantt row sheet (`views/gantt/HyperGanttRowDetail.tsx`). It opens from a meeting in the Focus time-grid, a Meetings row, the HyperHome Focus bar, or a Hyper-Event chip. Contents, top to bottom:

1. **Header:** title, time, "in 25 min", join button when `joinUrl` exists, organizer.
2. **Attendees:** avatars with `HyperPersonCard` on hover. Attendees with open items from me are marked ("Dana · 2 open items").
3. **Open items with these people:** hub tasks where an attendee is requester or assignee, ranked.
4. **Related work:** Jira issues and Newsletter tasks matched by key, subject keyword or attendee.
5. **Recent threads:** the last mails with attendees on the subject, as snippets only, each with "Open in Outlook".
6. **Last time:** notes or tasks from the previous instance of a recurring meeting.
7. **Talking points:** deterministic bullets, such as "PROJ-142 is overdue — Dana is waiting". An optional "Summarize" button calls the LLM through the main process, and its output is labelled "AI summary".
8. **Footer:** "Add prep task" and "Block 15 min before".

A meeting's **readiness** shows as a small ring (none, partial, ready) on every surface that shows the meeting. "Ready" means the user opened the brief or completed its prep tasks.

## 7. Visuals

### 7.1 Where things live

- **Sidebar:** a new "Task Hub" entry (lucide `ListTodo`) under Home, next to Jira, with a count pill for triage items (`NavCount`).
- **Tab:** `LocalToolId` gains `'taskhub'`. This is additive, so existing ids are unchanged. The registry renders `HyperTaskHubPage` with content padding 0.
- **HyperHome:** `HyperHomeFocusBar` above the existing split. It is collapsible, and the collapsed state is saved under `KeyValueStorage` key `hyperHomeFocusBar`.
- **Command palette:** "Task Hub: Do this first", "Task Hub: Triage", "Prep: <next meeting>".

### 7.2 Hub shell

```
┌ Task Hub ─────────────────────────────────────────────────────────────────────────────┐
│ ◎ Task Hub  Wed 27 Nov · 5.5h free · 4h planned         [Focus|Board|Matrix|Timeline|Meetings]  ⟳  ⚙ │
│ ● Jira 2m  ● Outlook 1m  ◐ Newsletter stale 09:12 ↻  ○ HyperTask  │ Search…  │ Source ▾ Person ▾ │
├───────────────────────────────────────────────────────────────────────────────────────┤
│                                  (active view)                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The view choice is saved per user. The filters (source, person, project, due) are shared by all views.

### 7.3 Focus (default)

```
┌───────────────────────────────────────────────┬──────────────────────────────────┐
│ DO THIS FIRST                                 │ TODAY                    ‹ Wed › │
│ ┌───────────────────────────────────────────┐ │ 09:00 ▒▒ Focus: Fix login PROJ-142│
│ │ [Jira] PROJ-142 Fix login timeout   P1    │ │ 10:00 ██ Standup (Teams)  ◔ prep │
│ │ Due today 17:00 · blocks 3 · Dana waiting │ │ 10:30 ▒▒ Focus: Reply to Dana     │
│ │ Why? ▸ due today +34 · blocks 3 +18 …     │ │ 11:00 ░░ Prep: Q1 review          │
│ │ [Start]  [Snooze ▾]  [Not today]  [Open ↗]│ │ 11:30 ██ Q1 review  ● ready      │
│ └───────────────────────────────────────────┘ │ 12:30    free                     │
│ NEXT                                3 triage ▸│ 13:00 ▒▒ Focus: Budget sheet      │
│ 2 ⠿ [Mail] Send Q1 numbers to Dana  due Thu   │ ...                               │
│ 3 ⠿ [Gantt] Launch checklist        due Fri   │ Planned 4h of 5.5h free ▓▓▓▓▓░░   │
│ 4 ⠿ [Task] Update onboarding doc              │                                  │
│ … 18 more                                     │                                  │
└───────────────────────────────────────────────┴──────────────────────────────────┘
```

- **Left, the decision:**
  - the hero card holds the rank-1 item with its top two reasons inline;
  - the Next list is virtualized with `@tanstack/react-virtual` (already allowed);
  - rows use the `Item` recipe and a drag handle;
  - dragging inside Next creates a manual order, shown as a pin icon, with "Reset order" in the list menu.
- **Right, the plan:** the ReUI event-calendar time grid in day mode. Meetings show as solid events. Plan blocks are hatched and can be dragged; dragging a block records a `reschedule` feedback event. Prep blocks link to the brief.
- **Capacity bar:** planned versus free time today, the only workload visual in phase 1. Over capacity, it turns `warning` and offers "Move 2 items to tomorrow".
- **Narrow screens:** below `lg` the two panes stack, plan first as a compact agenda.

### 7.4 Board

```
┌ Triage 3 ───────┬ Next 12 ────────┬ In progress 2 ──┬ Waiting 4 ──────┬ Done today 5 ┐
│ ⚠ Mail · 0.62   │ ①[Jira]PROJ-142 │ [Task] Budget   │ [Mail] Waiting  │ ✓ …          │
│ "can you send…" │ ②[Mail] Q1 nums │ sheet           │ on Dana · 3d    │              │
│ [A] [D] [S]     │ ③[Gantt] Launch │                 │                 │              │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┴──────────────┘
Group: [Status ▾]   Swimlanes: [None|Source|Project|Person]   Sort Next: [Rank|Due|Manual]
```

- Built on the ReUI `Kanban`, `KanbanBoard` and `KanbanOverlay` primitives, with the column, scroll and drag-overlay recipes already worked out in `HyperBoardView.tsx` and `HyperBoardDecisions.md`. It does not render the database board itself, because hub items are not database rows.
- Cards show:
  - a source badge (icon plus short label, `Badge variant="outline" size="sm"`);
  - the rank number in Next only;
  - a priority tier badge: P1 `destructive-light`, P2 `warning-light`, P3 `info-light`, P4 `secondary`;
  - a due chip, with overdue in `text-destructive`;
  - people avatars and a stale dot.
- **Drops:**
  - drops between hub statuses are immediate;
  - a drop that maps to an external state, such as Jira Done or "reply sent", opens a confirm listing the exact write, mirroring the Hyper-Bots approval card. Cancelling keeps the hub status and skips the external write.
- **"Done today"** caps at today, with "Show older" linking to a filtered list, so the column stays small.

### 7.5 Matrix

A 2×2 grid laid out with CSS grid: Do now, Schedule, Delegate or quick, Drop or later. Items are placed by `urgency ≥ 0.5` and `importance ≥ 0.5` from Sol's sub-scores. Dragging to another quadrant records an override (`userPriority`, or an urgency or importance override) and shows "Moved by you" in Why. Each quadrant lists at most 8 items, then "+N more", which opens a filtered list.

### 7.6 Timeline

The ReUI Gantt, wrapped as `HyperHubTimeline`, is read-only for external items. It shows dated items and spans, dependency arrows (`blocks` / `blockedBy`), Newsletter Gantt tasks in their original structure, and a critical-path highlight when Sol's engine marks it. Editing dates of Jira or Newsletter items goes through the confirm flow. Hub-local tasks edit directly. Undated items appear in an "Unscheduled" tray, using the Gantt decisions' "Click to schedule" affordance.

### 7.7 Meetings

A list of the next 7 days of meetings, grouped by day. Each row shows time, title, attendees, a readiness ring and a count of related open items. Selecting a row opens the prep sheet (§6). Filter: "Needs prep" (organizer is me, or attendees with open items, or external attendees).

### 7.8 HyperHome Focus bar

```
◎ Do first: PROJ-142 Fix login timeout · due 17:00 [Start] │ ◔ Standup in 25 min · prep ▸ │ 3 to triage ▸
```

## 8. Interactions, states, quality

**Feedback events.** The UI sends these to the store; the engine consumes them:

```ts
type HyperHubFeedback =
  | { type: 'pin'; taskId: string; rank: number } | { type: 'unpin'; taskId: string }
  | { type: 'snooze'; taskId: string; until: string } | { type: 'not_today'; taskId: string }
  | { type: 'reorder'; taskId: string; beforeTaskId: string | null }
  | { type: 'set_status'; taskId: string; status: HyperHubStatus }
  | { type: 'override'; taskId: string; urgency?: number; importance?: number; userPriority?: 1|2|3|4 }
  | { type: 'reschedule'; taskId: string; start: string; end: string }
  | { type: 'accept' | 'dismiss'; taskId: string } | { type: 'unlink'; taskId: string; source: HyperHubSourceRef };
```

**Keyboard.**
- `J` and `K` move, `Enter` opens the detail sheet, `O` opens in source, `P` pins, `S` snoozes, `X` marks done, `?` shows help.
- `1` to `5` switch views when focus is not in a text field.
- The ReUI Kanban already has dnd-kit's keyboard sensor.

**Stability.** Re-ranks are applied in place only when the user is idle. Otherwise the "New order · Apply" pill appears. Moved rows animate with `transition-transform` and no extra motion library. An `aria-live="polite"` region announces "Order updated, 3 items moved".

**States.**
- Every view has `Skeleton` loading, an `Empty` state with a reason, and "Connect a source" buttons.
- When no source is connected, a single empty state lists the four connections, each with its settings deep link.
- Per-source errors appear only in the status chips. They never block the views.
- An offline ReUI `Alert variant="warning"` appears once per session: "Showing cached tasks from 09:12".

**Bilingual and right-to-left.** All user content (titles, snippets, quotes, names) renders with `dir="auto"`, inside `<bdi>` when inline with UI text, and uses `text-start` rather than `text-left`. Chrome stays in the app locale's direction. Tests include a Hebrew title and a mixed Hebrew and English one.

**Themes and tokens.** Tokens only, light and dark, no new colours. Sources are told apart by lucide icon and label:

| Source | Icon |
| --- | --- |
| Jira | `SquareCheckBig` |
| Mail | `Mail` |
| Meeting | `CalendarDays` |
| Newsletter Gantt | `ChartGantt` |
| HyperTask | `FileText` |

Source colour, if wanted later, would come from user-data colours, which the design rules allow.

**Performance.** Virtualized lists. The Kanban renders at most 50 cards per column, then "+N more", because the ReUI Kanban is not virtualized. Selectors are memoized per view. Ranking runs in the main process or a worker, never on the render path.

## 9. Delivery plan and file ownership

The UI ownership rule holds: Opus writes everything that renders. Astra and Sol own the rows marked as theirs.

| Phase | Scope | Owner and files |
| --- | --- | --- |
| 0. Contracts | Shared types, IPC and preload API, the feedback type | Astra: `src/shared/HyperTaskHub.ts`, `src/main/HyperTaskHubIpc.ts`, preload. Sol: `src/shared/HyperTaskHubRanking.ts` (ranked item, plan block, reasons) |
| 1. Structured sources + Focus + Board | Jira, HyperTask project tasks, Outlook calendar, Newsletter Gantt; ranking and day plan; Focus, Board, shell, sidebar entry | Astra: `src/main/hyper-task-hub/HyperHub{Jira,Outlook,Newsletter,Project}Source.ts`, `HyperTaskHubService.ts`, `HyperTaskHubStore.ts`. Sol: `src/shared/HyperPriorityEngine.ts`, `src/shared/HyperDayPlanner.ts` plus tests. Astra or Sol (non-visual renderer): `src/renderer/features/hyper-task-hub/state/useHyperTaskHub.ts`, `hyper-task-hub-client.ts`. **Opus:** `features/hyper-task-hub/HyperTaskHubPage.tsx`, `HyperTaskHubHeader.tsx`, `HyperSourceStatusBar.tsx`, `focus/*` (`HyperFocusView`, `HyperDoFirstCard`, `HyperRankedList`, `HyperDayPlan`, `HyperWhyPopover`, `HyperCapacityBar`), `board/*` (`HyperHubBoard`, `HyperHubCard`, `HyperExternalWriteConfirm`), and wiring in `features/tabs/plugin.ts`, `features/plugins/registry.tsx` and `features/sidebar/SidebarButtons.tsx` |
| 2. Mail extraction + Triage + linking | Rules for English and Hebrew; dedupe; triage feedback | Astra: `HyperHubMailExtractor.ts`, `HyperHubDedupe.ts` plus fixtures. **Opus:** `triage/HyperTriageColumn.tsx`, `triage/HyperTriageCard.tsx`, the possible-duplicate prompt |
| 3. Meeting prep | Brief assembly, readiness, optional LLM summary through main | Sol: `src/shared/HyperMeetingPrep.ts`. Astra: the main-process LLM call reusing the Hyper-Bots untrusted-data envelope. **Opus:** `meetings/HyperMeetingsView.tsx`, `meetings/HyperMeetingPrepSheet.tsx`, `HyperReadinessRing.tsx` |
| 4. Matrix, Timeline, HyperHome, palette | The remaining visuals | **Opus:** `matrix/HyperPriorityMatrix.tsx`, `timeline/HyperHubTimeline.tsx`, `hyper-home/HyperHomeFocusBar.tsx` plus the `HyperHomePage.tsx` edit, command palette entries. Sol: critical path in the engine |
| 5. Hyper-Bots tools (optional) | `@scout` tools: "what should I do first", "prep me for 2pm" | Astra: tool registration reusing the hub service |

**Verification per phase:** `npm run typecheck`, `npm test`, `npm run build`. UI phases also get web-harness screenshots in light, dark and Hebrew content, which I review.

## 10. Risks and questions for the product owner

1. **Mail scope.** The bridge's `mail.list` caps at 50 messages per call and covers Inbox, Sent and Drafts. Is "last 14 days of Inbox plus Sent for waiting-on" enough, or are other folders needed?
2. **Auto-accept.** Should high-confidence mail suggestions skip Triage? My default is no.
3. **Write-back.** Which drags may write to Jira or Newsletter (status, due date), and should they always ask, or follow the Hyper-Bots permission level?
4. **Working hours.** Is a hub setting (default 09:00 to 18:00, Sunday to Thursday or Monday to Friday by locale) acceptable?
5. **Risk:** the ReUI Kanban is not virtualized. The per-column cap mitigates it.
6. **Risk:** wrongly merged sources hurt trust. Hence the visible "2 sources" and one-click Unlink.

## Positions I hold strongly

- Focus (one "do this first" plus a visible day plan) is the default view. The Kanban is secondary.
- Inferred tasks go through Triage. No silent task creation from free text.
- Every rank has a visible, signed explanation. No opaque learning.
- The list never reorders under the cursor.
- External writes always confirm, and the confirm states the exact destination and change.
- Tokens, icons and `dir="auto"`; no new colours or dependencies.
- I do not render hub items through the database board. The hub is its own surface over its own view model.

## Where I am flexible

- The page name (HyperTaskHub, Hyper-Focus) and the sidebar icon.
- Whether accepted tasks also mirror into the existing Hyper-Kanban database.
- Whether Matrix and Timeline ship in phase 1 or later.
- The number and names of the Board columns, if the engine's state model differs.
- Whether ranking runs in main or in a renderer worker.
