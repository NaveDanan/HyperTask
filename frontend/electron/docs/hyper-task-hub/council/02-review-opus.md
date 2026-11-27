# Round 2 review: Opus (visuals and UX)

I read `01-proposal-astra.md` and `01-proposal-sol.md` against my own `01-proposal-opus.md`. The three proposals agree on far more than they differ. The real conflicts are naming, the status vocabulary, where triage lives, and how far the first release writes to sources. On the last of these I concede to Astra and Sol.

## Agreements

- **A dedicated HyperTaskHub page, with HyperHome keeping its Kanban/Event split plus a compact next-action and next-meeting entry.** All three proposals (Astra §7, Sol §7, Opus §7.1).
- **Hybrid storage.** Sources keep authority over their records. The Rust core owns native rows. A device-local, main-process store owns triage decisions, dismissals, links, pins, snoozes and plans. All three (Astra §4, Sol §4, Opus §4).
- **Durable decisions are stored apart from a rebuildable source projection,** so clearing the cache never erases a plan (Astra §4, Sol §4). I accept this.
- **Inferred tasks from free text need an owner decision, and the exact sentence is shown.** Explicitly owned work (assigned Jira issues, owned project rows, assigned Newsletter tasks) imports directly. All three.
- **Dismissals persist per action fingerprint and survive re-sync and rule updates** (Astra §2, Sol §2, Opus §2).
- **A mention links records without joining their completion.** "DEV-17: send QA the logs" stays its own task (Astra §3, Sol §3). I accept this. It is better than my "possibly the same" framing for key mentions, which I keep only for fuzzy title matches.
- **Merges are confirmed, reversible and keep every source reference** (all three).
- **Deterministic weighted score with per-signal contributions, plus a greedy, reproducible day planner around working hours and busy time.** No solver in v1 (Sol §5, Astra §5, Opus §5).
- **Partial reads prove nothing.** Incomplete coverage cannot establish a deletion, a missed reply or free time, and coverage is shown per source (Astra §4, Sol §4). I accept this. My source-status chips render it.
- **Optional LLM steps are tool-free, schema-validated and cite exact substrings,** using the existing untrusted-data envelope (Astra §2, Sol §6).
- **Meeting brief:** local, deterministic and cited, with private, cancelled and declined meetings suppressed, and an optional summary as a separate action (Astra §6, Sol §6, Opus §6).
- **UI:** `dir="auto"` and isolated keys and times for Hebrew, keyboard triage, ReUI Kanban and event-calendar reuse (all three).

## Conflicts and resolutions

### C1. Status vocabulary
- Astra: `review | ready | doing | waiting | done | dismissed` (§1).
- Opus: `triage | next | in_progress | waiting | done | dismissed` (§1).
- Sol (planning only): `ready | done | waiting` (§5).

**Resolution: concede.** Adopt Astra's ids as the stored enum. The UI labels them Review, Next, In progress, Waiting, Done. Sol's planning state is derived: `ready` maps to ready or doing, and waiting stays waiting.

### C2. Where review (triage) lives
- Opus: a first Board column (§7.4).
- Astra: a dedicated Review view; "review items never consume capacity" (§2, §7).

**Resolution: concede.** Review becomes its own view, a keyboard queue. Mixing unaccepted suggestions into a board of accepted work blurs exactly the distinction Astra is protecting. The Board shows a "3 to review" link in its toolbar, not a column.

### C3. External write-back from the Board
- Opus: a drag that maps to an external state opens a confirm, then writes (§7.4).
- Astra and Sol: the first release reads external sources only. Drags change local intent; changes to the source happen in the source (Astra §4, Sol §4).

**Resolution: concede.** v1 is read-only toward Jira, Outlook and Newsletter. A drag changes local state only. The card then shows both states, such as "Doing for me · Jira: To Do", with an "Open in Jira" action. Sol's "Done for me" semantics apply: the task leaves the queue, but its dependency stays unmet until the source completes. Write-back with a main-process confirm moves to a later phase.

### C4. Task model shape
- Astra: evidence-based records with `fieldOrigins` (§1).
- Sol: per-value provenance (§1).
- Opus: a flat view model (§1).

**Resolution: compromise.** The store uses Astra's evidence model. IPC sends the renderer a projection, `HyperHubTaskView`, with what renders:
- title (owner-edited wins), state, `sourceStatus` per source, due, effort;
- people with roles, meeting ids, blocks and blocked-by;
- a review span (`excerpt`, `rule`, `confidence`), plus pin, snooze and manual order;
- one `HyperHubSourceRef` per evidence item, each with a validated, typed `openTarget` that main resolves. The renderer never builds URLs.

Astra owns both types.

### C5. Score formula
- Sol: ten signals with weights 24/20/10/5/10/10/6/5/4/6 (§5).
- Astra: four inputs: slack 45, importance 25, unblocking 20, age 10 (§5).

**Resolution: compromise. Sol owns the formula.** I ask Sol to take Astra's slack idea into the deadline signal. When calendar coverage is fresh, compute urgency from working-minute slack (free working time before the deadline minus effort). When coverage is stale or missing, fall back to `hoursUntilDue / 168`.

Slack is what makes Astra's best explanation possible: "this takes 25 minutes and your next free slot is 10:15–10:45". "Due in 48h" says much less. Both proposals refuse to treat sender seniority or mail Importance as urgency, and so do I.

### C6. Reason payload for "Why?"
Sol's `HyperRanked.reasons` is `{ signal, points, evidenceId }` (§5). The UI cannot write "Due in 5 h" or "Blocks 3 tasks" from that without re-deriving facts.

**Resolution: hold.** Add `facts: Record<string, number | string>` to each reason, for example `{ hoursUntilDue: 5 }` or `{ successors: 3 }`. Add structured placement reasons from the planner, such as `{ code: 'fits-before-meeting', meetingId, gapStart, gapEnd }`. The UI localizes from codes and facts, as Sol already proposes ("localize structured reasons at display time").

### C7. Where ranking runs, and responsiveness
Sol: pure shared modules. Opus: main or a worker.

**Resolution: compromise.**
- Main runs the engine on every data or feedback change and pushes an authoritative snapshot.
- Because the modules are pure and in `src/shared`, the renderer may re-run them for an optimistic preview right after a pin, reorder or snooze. That keeps drag feedback instant, and main's next snapshot replaces the preview.
- Budget: 500 tasks ranked and planned in under 50 ms. Sol already plans a 500-task benchmark.

### C8. View set and phasing
- Opus: Focus, Board, Matrix, Timeline, Meetings (§7).
- Astra: Review, Board, Today; matrix deferred (§7).
- Sol: Board and Today; matrix secondary; workload later (§7).

**Resolution: compromise.**
- v1 views: **Today** (rename of my "Focus", since two of three say Today; same layout: "Do this first" card, ranked list, time grid, capacity), **Board**, **Review**.
- **Meetings** and the prep sheet in the meeting-prep phase.
- **Matrix** and **Timeline** last.

The view switch stays one segmented control, so later views slot in without changing the layout.

### C9. Outlook refresh cadence and polling load
Sol: every minute while Today is visible (§4). The current Hyper-Event hook already polls every 60 s, in the renderer, per view (`src/renderer/features/hyper-outlook/useHyperOutlookEvents.ts:43`). The bridge is a single serialized STA PowerShell process (`src/main/HyperOutlookBridge.ts`), shared with Hyper-Bots.

**Resolution: hold.**
- One main-process availability cache serves both Hyper-Event and the Hub, so they never poll twice.
- Today refreshes at most every 60 s, and only while visible.
- Mail header scans follow Astra's 5-minute cadence.

### C10. File names and owners
The three proposals name different files:
- types: `HyperHubTask.ts` (Astra), `HyperTaskHubTypes.ts` (Sol), `HyperTaskHub.ts` (Opus);
- store: `HyperHubStore.ts` (Astra), `HyperTaskHubRepository.ts` (Sol);
- Neon still appears as an owner in Astra's and Sol's plans.

**Resolution: compromise.**
- Main and shared modules use the short `HyperHub*` prefix, flat in `src/main` and `src/shared`, following the current flat convention:
  - Astra: `HyperHubTask.ts` (types), `HyperHubStore.ts`, `HyperHubSync.ts`, `HyperHubIpc.ts`, the source adapters `HyperHub{Jira,Project,Outlook,Calendar,Newsletter}.ts`, `HyperHubExtraction.ts` and `HyperHubLinks.ts`.
  - Sol: `HyperPriorityEngine.ts`, `HyperDayPlanner.ts` and `HyperMeetingBrief.ts`.
- Renderer: `src/renderer/features/hyper-task-hub/`. Its `state/` folder (store, client, selectors) belongs to Astra. Every rendering component belongs to Opus.
- Every "Neon" assignment becomes Opus.

### C11. Reconciling a planned block with the source due date
Astra: "keep planned blocks separately so dragging tomorrow's work to today cannot change a Jira due date" (§1).

**Resolution: agree.** In the UI, dragging a plan block shows a "Planned" time; the "Due" chip is unchanged.

## Objections

1. **The readiness ring definition (my own, revised).** In my §6, "brief opened" counted as ready. That is a weak proxy, so I drop it. Readiness becomes:
   - *none*: related open items exist and nothing is planned;
   - *planned*: a prep block is scheduled;
   - *ready*: the prep tasks are done, or the owner marked it ready.
2. **Sol's 45-minute provisional effort (§5)** is fine for planning. The UI must label it in place: "~45 min (estimate)", editable inline. Otherwise the plan looks more certain than it is. Astra says the same in §5.
3. **Astra's 90% precision gate (§2)** before background suggestions are on by default: I support it. Until a cohort passes, the Review view labels mail suggestions "Suggestions (preview)" and mail scanning stays opt-in. Sol agrees (§9).
4. **The ReUI Kanban has no virtualization** (`src/renderer/components/reui/kanban.tsx:187` renders all items through dnd-kit). Each column therefore caps at 50 cards, with "+N more", and Done shows today only. Nobody proposed unbounded columns, but the spec should say so.
5. **Astra's phase 1 has no calendar** (§8). Without busy intervals, Sol's planner falls back to "request manual availability". That would make the headline Today view hollow in v1. Outlook calendar reads already exist (`list` in `src/main/HyperOutlookSchema.ts:26`). Busy-interval import, with private items treated as busy-only, belongs in phase 1. Mail stays in phase 2.

## Gaps no proposal covers well

- **Setup and settings UI.** Several things need a home:
  - which Jira projects, boards, Newsletter resources and mail folders count as "mine";
  - owner identity aliases in English and Hebrew, needed for extraction;
  - working week (Sunday–Thursday or Monday–Friday), hours, breaks and timezone;
  - score weights with live preview;
  - the AI summary opt-in.

  I propose a first-run setup in the Hub (a three-step sheet) and a "Task Hub" page in the Settings dialog built with the existing `settings-layout.tsx` blocks. Astra owns the settings persistence (main). Opus owns the UI.
- **Undo.** Every local action (accept, dismiss, snooze, pin, done for me, merge) gets a sonner toast with Undo, backed by ledger reversal in the store.
- **Prep notifications.** v1 is in-app only: the HyperHome bar, the sidebar count, and the Today grid. No OS notifications until there is an owner setting.
- **Plan horizon.** Today only in v1. Overflow lists "Didn't fit today", with "Plan tomorrow" as a later step.
- **Empty and first-run states for each source.** Partly covered. The spec should list them per view.

## Draft decisions I would sign today

1. The page is HyperTaskHub, opened as `localToolPlugin('taskhub')`, from a "Task Hub" sidebar entry (lucide `ListTodo`) under Home, with a Review count pill.
2. v1 views are Today (default), Board and Review. Meetings (with the prep sheet) comes in the prep phase; Matrix and Timeline come last.
3. HyperHome keeps its split and gains a collapsible `HyperHomeFocusBar`: next action, next meeting, and the review count.
4. Stored states are `review | ready | doing | waiting | done | dismissed`, labelled Review, Next, In progress, Waiting, Done.
5. v1 is read-only toward Jira, Outlook and Newsletter. Drags and done change local state only, and each card shows both its local and its source state.
6. Inferred tasks always go through Review with their quoted span. Explicitly owned work imports directly. Mail scanning is opt-in.
7. Mentions link records; only confirmed merges join them. Merges are reversible.
8. Storage is a device-local, encrypted, account- and workspace-scoped main-process store, split into a durable ledger and a rebuildable projection (Astra §4 path).
9. Sol's weighted score is authoritative, with the deadline signal computed from slack when calendar coverage is fresh. Reasons carry `facts`.
10. Sol's two greedy passes plan the day. Pins and manual order come first, and placement reasons come back as structured codes.
11. The engine runs in main. The renderer may run the same pure modules for optimistic previews. The target is 500 tasks in under 50 ms.
12. One main-process Outlook availability cache feeds both Hyper-Event and the Hub.
13. Phase 1 covers Jira, HyperTask project rows, and Outlook calendar busy intervals, then ranking, the Today plan, Board, the Hub shell and the HyperHome bar. Phase 2 covers the mail header scan and extraction, Newsletter, links and merges, and the Review view. Phase 3 covers meeting briefs and the Meetings view. Phase 4 covers Matrix, Timeline, the weights UI, write-back with confirmation, and Hyper-Bots tools.
14. File ownership follows C10. Opus owns every rendering component and the wiring in `tabs/plugin.ts`, `plugins/registry.tsx`, `sidebar/SidebarButtons.tsx` and `hyper-home/HyperHomePage.tsx`.
15. The list never reorders under the cursor; a pending re-rank shows an Apply pill. External content never enters the shared workspace without an explicit owner action.
