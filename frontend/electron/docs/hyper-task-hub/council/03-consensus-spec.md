# HyperTaskHub consensus spec

Spec version: 2
Drafted by Opus from `01-proposal-{astra,sol,opus}.md` and `02-review-{astra,sol,opus}.md`. Section references use the form `Astra R2 C5`, meaning `02-review-astra.md`, conflict 5.
Status: **APPROVED.** Astra, Sol and Opus all signed `AGREE v2` (`04-signoff-{astra,sol,opus}-v2.md`). Implementation may start.

## Changes from v1

Version 2 applies every blocking change from `04-signoff-astra.md` (`OBJECT v1`, items A1–A6) and `04-signoff-sol.md` (`OBJECT v1`, items S1–S8). Where the two overlap, their replacement texts are merged.

| Topic | Section | v1 sign-off items |
| --- | --- | --- |
| Covered time for timed placements and slack | D6.1, D6.3, D7.6 | A1, S2 |
| IPC sender, scope, revision and access checks | D3.2, D8.6, D9.6 | A2, S7 |
| Store-bound Outlook reads, with sensitive events reduced to busy time in M2 | D4.7, D4.8, D12 M2 | A3, S5 |
| Assigned and reported Jira query; saved-filter ordering | D4.1 | A4 |
| Mailbox consent in M3; AI consent in M4 | D4.5, D9.9, D12 | A5, S8 |
| Newsletter articles as brief evidence | D8.4, D12 M4 | A6 |
| Score and contributions reconcile | D6.1, D6.2, D9.5 | S1 |
| Forecast placements kept apart from actual readiness; fixed-block validation | D2, D7.2, D7.4 | S3 |
| Integer pass objective; due-first test fixture | D7.3, D12 M2 | S4 |
| Meeting eligibility and readiness order | D8.1, D8.5 | S5 |
| Deterministic evidence admission and thread caps | D8.2 | S6 |

Non-blocking clarifications folded in:
- the scope of encryption, and stable action mappings across cache rebuilds (Astra);
- the Jira-priority fallback rules (Sol);
- HyperHome links appearing as their destinations ship (Astra, Sol).

Paths are relative to `frontend/electron` unless stated otherwise.

---

## D1. Concepts and identity

1. **Action, occurrence, evidence.**
   - An *action* is something the owner can finish.
   - An *occurrence* reserves time.
   - *Evidence* (a message, article, row or issue) supports either one.
   - One record can play several roles. One message or meeting can yield several actions. (Astra R1 §1, Sol R2 agreements)
2. **Each action has a stable local UUID.** Every imported fact is an *observation* keyed by connector account plus native scope:

   | Source | Native key |
   | --- | --- |
   | Jira | instance + numeric issue id (key and browse URL are aliases) |
   | Newsletter | connection + project + task |
   | HyperTask | workspace + database + row (the view id is kept for navigation only) |
   | Outlook mail | store + EntryID, plus the action span for mail candidates |
   | Outlook calendar | store + the occurrence key, which includes the original start |

   An observation carries `revision`, `observedAt` and a role: `origin`, `mirror`, `mentions` or `assignment`. (Astra R2 C1, Sol R2 C1)
3. **Field provenance is kept per scheduling value and per dependency edge.** An owner edit wins for display. A changed source deadline stays visible next to a personal target. A planned block never changes a source due date. (Astra R1 §1, Opus R2 C11)
4. **Dates are typed.** A civil date carries its zone; an instant is ISO with an offset. A civil due date means the end of that source day.

## D2. Workflow states

- **Persisted personal state:** `review | ready | doing | waiting | done | dismissed`.
- **UI labels:** Triage, Next, In progress, Waiting, Done. Dismissed items are hidden, apart from Undo.
- Raw source status and authoritative completion are stored alongside the personal state, and the card shows both, e.g. "In progress for me · Jira: To Do".
- **Planner eligibility** starts with the owner's open `ready` or `doing` work. Then apply source completion, release and snooze times, and the verified predecessor graph. A task with an unresolved predecessor can stay visible with its blocker. Triage and Waiting items use no planned capacity.
- **"Done for me"** clears the owner's queue. A successor needs completion from its predecessor's authoritative system (the Hub, for a local action), or the owner's explicit resolution of that edge.

*Resolution.* Astra and Opus each conceded to the other's vocabulary in R2. Sol's R2 C2 broke the tie: Astra's ids and Opus's labels.

## D3. Storage, sync and coverage

1. **Hybrid store.** Sources keep authority over their records, and the Rust core owns native rows. A main-process store holds two parts:
   - a rebuildable, encrypted **observation cache**;
   - a durable **personal ledger**: triage decisions, dismissals keyed by action fingerprint, links, merges, negative matches, pins, snoozes, manual order, fixed blocks and personal states.

   Location: `<support>/hyper_task_hub/users/<accountHash>/<workspaceHash>/`. Encryption uses Electron `safeStorage`, which uses DPAPI on Windows. It covers the ledger, temporary files and journals as well as the observation cache.

   If the OS cannot encrypt, the Hub refuses to persist source text and says so. That includes Linux's `basic_text` fallback, which `HyperNewsletterConnection.ts` already detects.

   Clearing the cache never touches the ledger. An opaque, durable mapping from observation to action keeps pins and dismissals on the same UUID after a cache rebuild. (Astra R1 §4, all R2s)
2. **Scope safety.**
   - Every read captures `{accountId, workspaceId, connectionId, generation}`. Records and cursors are committed together, and the generation is rechecked inside the transaction.
   - Late replies after sign-out or a scope change are discarded.
   - Main derives the active partition. It validates the trusted sender and the request schema on every Hub IPC call, and binds renderer requests to the active scope generation.
   - Before main accepts feedback, starts work or opens a source, it resolves opaque evidence handles and typed open targets from the active scope. It then checks the target, current access, and the expected snapshot revision. Summary requests get the same check (D8.6).
   - On a scope change, the renderer clears its projection, pending orders and optimistic actions. Main rejects late snapshots, acknowledgements and summary replies from the old generation.
   - No write method exists on a read connector.
3. **Retention.**
   - Source excerpts expire after 30 days.
   - Opaque dismissal and negative-match fingerprints are kept longer.
   - Explicit disconnect or known access loss purges source-derived text, including cached briefs. Owner-authored actions survive and show "source unavailable".
4. **Coverage is explicit.** Each read reports `complete` or `partial` per query, interval and connection, plus the last success time.
   - A partial read can never establish a deletion, a missed reply, or a free slot.
   - Removal requires an authoritative reconciliation or a targeted check.
   - Today's Outlook list returns a bare array, stops after 500 mail candidates and 2,000 occurrences, and is treated as partial until the bridge reports exhaustion. (Astra R2 objections 1–2, Sol R2 objection 2)
5. **Refresh cadence.**

   | Source | Cadence |
   | --- | --- |
   | Outlook availability | One main-process availability cache. Refresh on Hub open, window focus or presence recovery when older than 60 s; every 5 minutes while the app is active; at most once a minute, coalesced, while Focus is visible. |
   | Opted-in mail | Every 5 minutes. |
   | Jira | Shares the existing 5-minute trigger, through main's credential-bound transport. The Hub never uses the renderer credential IPC. |
   | Newsletter | Selected projects every 15 minutes, fetching each project revision once. |
   | Native rows | On core notifications. |
   | All sources | Manual refresh; backoff with jitter. |

   Moving Hyper-Event's renderer poller onto the shared availability cache is planned for M5 and does not block the first release. (Astra R2 C4, Sol R2 C3, Opus R2 C9)
6. **No silent workspace writes.** External content enters the shared workspace, for example a Hyper-Kanban mirror, only through an explicit owner action, and not before M5.

## D4. Ingestion and extraction

1. **Direct import, within scopes the owner selects:**
   - Jira, for each selected project: combine its project constraint and the configured filter predicate with `statusCategory != Done AND (assignee = currentUser() OR reporter = currentUser())`. Remove any top-level ordering from the configured filter before wrapping its predicate, then apply `ORDER BY updated ASC, key ASC` once. Assigned issues are owned work. Reported-only issues start in Waiting. A record that leaves the query follows D3.4 reconciliation.
   - HyperTask board and Gantt rows the owner selects.
   - Newsletter Gantt tasks whose resource the owner has mapped to themselves.
   - Active personal Outlook flags, only after the bridge extension below is verified on a classic profile **and** the owner opts in.
2. **Invitations and meetings** provide availability and a possible brief, never a task on their own.
3. **Everything inferred from text goes to Triage, regardless of confidence:**
   - Mail requests, promises in Sent, unanswered direct questions, and meeting agenda items.
   - Each candidate shows its exact authored sentence, highlighted, plus the rule, the inferred owner and the resolved date. Ambiguous dates stay unset.
   - Dismissal is keyed to the action fingerprint, so a second request in the same message survives.

   (Astra R2 C7, Sol R2 C7; this reverses Opus R1's auto-accept for meeting requests.)
4. **Extraction is deterministic first.**
   - Read the latest authored passage only: strip quoted history, forwarded headers, signatures and footers.
   - Use Unicode normalization, case folding and Hebrew niqqud removal, preserving offsets.
   - Use bilingual request, promise and temporal patterns that build on `src/main/HyperVoiceCommandParser.ts`.
   - Suppress FYI, negations ("אין צורך"), quoted instructions, acceptances and distribution-list traffic. A Cc, a question mark, VIP status or the unread flag alone earns no card. (Astra R1 §2)
5. **Mail scanning is opt-in**, per connection and selected folder scope. Scanning starts only after the owner confirms the scope and the mail retention policy, and passing the precision gate never grants that permission.

   Until reviewed precision reaches at least 90% on a language cohort's fixtures and pilot labels, suggestions show as "Suggestions (preview)". After a cohort passes the gate, its suggestions may be on by default, but only inside the mailbox scope the owner has opted in to.
6. **Optional AI** may phrase a title or propose a candidate from an owner-enabled excerpt.
   - Tool-free, with a strict schema and exact substring citations.
   - Invented dates, identities or spans are rejected.
   - It uses the existing untrusted-data envelope.
   - Having an endpoint configured does not by itself permit sending mailbox content.
7. **Required bridge work** (Astra; an additive, main-only operation):
   - a header scan returning store identity, last-modified time, flag state with start, due and completion dates, conversation id, and Internet Message-ID and In-Reply-To where available;
   - modified-time continuation through ties, with an explicit exhaustion marker;
   - an active-flag inventory for older mail;
   - **an additive, store-bound calendar read in M2.** It reports interval coverage and exhaustion and classifies sensitivity at ingest. D4.8 applies at the bridge before any event is cached or projected: private, confidential or unclassifiable items return only what is needed to reserve time. For M4 it also returns the store-scoped occurrence key with original start, a verified series key where available, and whether the item is a plain appointment or an accepted or owner-organized meeting. The existing calendar `list` response stays unchanged for its current callers;
   - a typed `mail.open` for "Open in Outlook".

   Hub calendar and mail operations, including detail reads and `mail.open`, verify the expected store when they execute. Unknown fields decode as unknown, and COM sentinel dates are filtered out.
8. **Privacy filters, applied at ingest before anything is cached, indexed or projected:**
   - protected or confidential mail is excluded from indexes and briefs;
   - private, confidential and unclassified events reduce to the busy intervals that apply;
   - attachment names cite only their parent message.
9. **Native calendar rows** reserve time only when they have a timed start and end. Dated rows without an end are milestones. The Hyper-Event display fallback (a synthesized one-hour end) never reserves time. The owner can exclude a calendar. (Sol R2 gaps)

## D5. Dedupe and linking

1. Exact scoped identities and verified Jira mirrors collapse automatically. A mirror requires both the key and the configured canonical browse URL, following the check in `HyperJiraKanbanMapper.ts`. A stale mirror can never resurrect completed or inaccessible work.
2. A mention links records; it never joins their completion. "DEV-17: send QA the logs" stays its own action, linked to DEV-17.
3. A fuzzy or action-level merge always asks the owner. A merge needs corroboration: the same owner or project and time range, plus participants or the deadline. The prompt shows the matching facts.
4. Merges and splits are reversible. Undo restores both ids, assignments, edges and local decisions. Edges are revalidated and cycles reported after any identity change.
5. Every source reference and its status is kept after a merge. Negative matches persist. A bare Jira key resolves only within a single known instance. URLs are matched against the configured origin and context path, and are never fetched to learn their identity.

## D6. Ranking

**Owner:** Sol. **Code:** `src/shared/HyperPriorityEngine.ts`, a pure module.

1. **Score** = `round(Σ pointsᵢ, 2)`, where `pointsᵢ = 100 × (wᵢ / Σ wᵢ) × xᵢ`.
   - Sum in table order and round the total once.
   - The denominator covers all configured weights, for every task.
   - Unknown inputs contribute 0 and are reported as unknown.
   - Negative, non-finite and all-zero weights are rejected.
   - All weights are divided by their largest value before normalizing, so valid finite weights cannot overflow the sum.
   - `clamp` limits inputs to `[0, 1]`.

   | Signal | Weight | xᵢ |
   | --- | ---: | --- |
   | Slack (urgency) | 45 | `clamp(1 − slackMinutes / 480)`. Slack = free working minutes between the supplied clock and the earliest confirmed due or prep deadline, minus a known effort estimate. A confirmed deadline at or before the clock gives urgency 1. Otherwise slack is unknown when the deadline is missing, the effort is missing, or any working window before the deadline is uncovered. Slack derived from a stale complete snapshot or from owner-declared availability is labelled provisional. |
   | Importance | 25 | The owner's priority mapped to `0 / .33 / .67 / 1`. When the owner has not set one, the source's explicit priority field (Jira priority, mapped per connection by priority id) supplies the value. That is one mapped value for the same signal: it carries Jira provenance, is labelled "from Jira priority", and is never written into the owner's priority. An explicit owner value, including 0, always wins. A missing or unmapped source priority is unknown. Mail Importance, sender and job title never count. |
   | Unblocking | 20 | `min(verifiedOpenSuccessors, 5) / 5` |
   | Age | 10 | `clamp(daysSinceCreatedOrFirstSeen / 28)` |

   Signals derived from the same field collapse into one. Sprint, critical path, requester and meeting signals are deferred. They may be added only after coverage and benefit are shown on labelled examples. (Sol R2 C5 concession to Astra R1 §5; the importance seed is a drafter addition for review.)
2. **Output, per task:**
   - `score`;
   - separate `urgency` and `importance` values (0..1), which also drive the later Matrix;
   - `reasons[]`, each with `{ signal, points (unrounded), facts: Record<string, number | string>, evidenceId? }`;
   - `unknown[]`.

   Pins and feasibility are reported separately. The reason payload keeps raw points, and the display reconciles to the rounded score. (Opus R2 C6, Astra R2 C5)
3. **Unknown effort** uses a provisional 45-minute estimate for placement and for effective-due propagation. It is labelled "~45 min (estimate)" wherever it shows and can be edited inline. Slack stays unknown until an effort estimate is recorded or the deadline is reached. After the owner has recorded at least 5 actual durations in a category, the median of the latest 10 is offered as that category's default.

## D7. Day planning and "do this first"

**Owner:** Sol. **Code:** `src/shared/HyperDayPlanner.ts`, a pure module.

1. **Availability.**
   - Working windows use the owner's IANA zone, workdays, hours and breaks, clipped at the supplied clock.
   - Busy time is the union of Outlook busy, tentative and out-of-office time, native reservations and fixed local blocks. Free, working-elsewhere, declined and cancelled events release their time.
   - Date-only endpoints are half-open civil days.
2. **Two greedy passes**, behind one interface (Sol R1 §5):
   - **Score-first pass:** pins, then the explicit Focus order, then descending score.
   - **Due-first pass:** pins, then the explicit Focus order, then ascending effective due. Effective due is computed backward over the valid, unfinished graph: the minimum of the task's own deadline and, for each successor, that successor's effective due minus its planning effort. Missing deadlines sort last.

   In either pass, remaining ties break by own due, then Hub id in code-unit order.

   **Placement.**
   - Each pass queues tasks whose unfinished predecessors have valid forecast placements, starting with roots.
   - Each task goes at its earliest contiguous fit after its release time and after every predecessor finishes.
   - Missing or unplaceable predecessors go into the blocker facts, and cycles are reported.
   - A fixed block counts as a placement only after it is validated against the current work windows, release time, busy intervals, other fixed reservations and predecessor finishes. A conflicting reservation stays visible with `fixed-conflict` and is excluded from forecasts and suggested starts.
   - A task is split only when it has an explicit positive chunk size. A split predecessor supplies a forecast finish only after its final chunk is placed.
3. **Choosing a pass.** Compare these values lexicographically:
   1. The sum of `100 + scoreInCents` over fully placed tasks that finish by a confirmed deadline due in the rest of the owner's civil day. This includes a civil due date whose end boundary is the end of today, even when that falls after the last work window. Overdue tasks stay eligible and show a late reason.
   2. The sum of `100 + scoreInCents` over every fully placed task, counted once each, regardless of deadline. Both sums use D6's score in integer hundredths of a point.
   3. When both sums tie, prefer score-first.
4. **"Do this first"** is the earliest feasible block for a task that is actually ready.
   - It reports `start-now` if its start is the supplied clock, or `start-later` with its start time.
   - Actual readiness is rechecked when Start is invoked. A planned predecessor finish can unblock a forecast only.
   - When a task cannot be recommended, blocker facts come back with `waiting`, `cycle`, `no-window`, `fixed-conflict` or `no-coverage`.
5. **Placement reasons** are structured codes with facts, for example `{ code: 'fits-before-meeting', meetingId, gapStart, gapEnd, minutes }`. The UI localizes them.
6. **Coverage.**
   - Times are offered only inside intervals with complete coverage from every enabled availability source, or inside a window the owner has explicitly declared available.
   - A still-authorized last complete snapshot can cover an interval provisionally when it is older than 30 minutes or a newer refresh was partial. New busy intervals can narrow that coverage. A partial result alone never establishes free time.
   - Plans that rely on stale or owner-declared coverage are labelled **provisional**. Known busy intervals are subtracted from owner-declared availability.
   - Where coverage is missing, Focus shows ranked work and asks for a manual window ("I'm free 09:00–12:00"). A placement that missing coverage prevents returns `no-coverage`.
7. **Feedback** comes from typed events: pin, unpin, reorder, snooze, not-today, set-state, reschedule (a fixed block), accept, dismiss, link, unlink, merge and split. Each one is a ledger entry with Undo. Pins and reorder change queue order. Snooze changes the release time. A fixed block reserves time. Weights stay under direct owner control; there is no opaque learning.
8. **Runtime and performance.**
   - The engine and planner run in main on a versioned, immutable snapshot with a supplied clock. Results from an older scope or snapshot are rejected.
   - Computation moves to a worker that main owns only if profiling shows main-loop stalls.
   - The renderer shows drag feedback optimistically while recomputation runs.
   - **Target:** ranking plus both passes under 50 ms for 500 tasks. Ranking, planning, IPC and drag response are each measured separately on representative Windows hardware. This target is a benchmark, not a release gate.

## D8. Meeting prep

**Owners:** Sol (`src/shared/HyperMeetingBrief.ts`), Astra (adapters, privacy and the summary transport), Opus (UI).

1. **Eligibility.** Briefs cover only verified accepted or owner-organized meetings.
   - Excluded: plain appointments, private or confidential items, items with unknown sensitivity, cancelled and declined meetings, and occurrences the current scope cannot access. Private, confidential and unclassified items contribute only the busy intervals that apply.
   - Briefs are built on demand and pre-warmed within 24 hours.
   - A brief is invalidated when its occurrence moves, is cancelled, loses eligibility, or its evidence changes, and is refreshed 30 minutes before start.
   - The store-scoped occurrence, including its original start, is verified before evidence attaches. Verified series keys select history only for an occurrence that is already verified.
2. **Evidence admission and order.** Evidence is admitted through:
   - an authorized manual link;
   - an exact scoped Jira key or trusted document link;
   - verified series history;
   - a shared project or topic match. Automatic mail candidates always need this match.

   Attendee and organizer matching uses verified identities only.

   | Evidence | Points |
   | --- | ---: |
   | Manually linked evidence | always first |
   | Exact scoped Jira key or trusted document link | +60 |
   | Verified series history, up to 2 prior occurrences | +35 |
   | Two distinctive subject terms (English or Hebrew tokens) | +20 |
   | Matching verified attendee or organizer identity | +15 |
   | Under 7 days old at the supplied clock | +5 |

   - Each applicable signal is added once. Order: manual links first, then descending total, descending source time, and ascending scoped evidence id in code-unit order.
   - Group by connection, store and verified thread id. When the thread id is unknown, each scoped message is its own group. Groups rank by their best candidate, and at most 5 are shown.
   - Attendee-only open work appears in its own short "Open with attendees" list of at most 3, with the same tie-breaks.
   - Prior decisions appear only with a verified series and a cited excerpt.
3. **Brief content.** Time, join link, attendees, agenda excerpt, my open actions and decisions due, related issues and blockers, threads, prior decisions, and linked documents. Every item shows why it matched, its source time, and whether it is stale.
4. **In the first release, documents** resolve only from:
   - the configured Jira instance;
   - HyperTask pages and rows, after a workspace access check;
   - Newsletter projects, plus Newsletter articles the owner has selected or explicitly linked and that the configured connection can access. The M4 Newsletter adapter resolves articles by connection and article id and can cite a summary excerpt as context. Article authorship alone never creates a task.

   Attachments are references to their parent message only. "No linked documents" is a complete answer.
5. **Readiness** is computed in this order, with a separate Viewed marker:
   - *prepared* if the owner confirmed it, or at least one explicit prep task exists and all such tasks are complete;
   - *planned* if a valid prep block is scheduled;
   - *none* otherwise.
6. **Optional "Summarize"** is an explicit per-brief action.
   - It sends selected excerpts and ids only, as `{ source, untrusted_data }`, with zero tools, a validated schema and checked citations.
   - It requires owner opt-in. The active scope, the occurrence and the selected evidence revisions are verified right before sending and again before the reply is accepted. A reply is discarded after an access loss or a scope change.
   - Accepted output is labelled "AI summary".
   - On failure, the deterministic brief shows, if it is still authorized.

## D9. Visuals and UX

**Owner:** Opus, the only member who writes rendering code.

1. **Placement.**
   - The page is `localToolPlugin('taskhub')`, titled "Task Hub". `LocalToolId` gains `'taskhub'`; the change is additive.
   - The sidebar entry sits under Home, uses lucide `ListTodo`, and shows a Triage count with `NavCount`.
   - Command palette entries: "Task Hub: Do this first", "Task Hub: Triage", and "Prep: <next meeting>".
2. **Views,** in one segmented switch. The choice is saved per user, and the filters (source, person, project, due) are shared across views.
   - **Focus** (default): a "Do this first" card with its top reasons and actions; a ranked Next list (virtualized, with a drag handle, Pin and "Reset order"); today's ReUI event-calendar day grid, with meetings as read-only events and plan blocks hatched and draggable into fixed blocks; a capacity bar; and a "Didn't fit today" overflow with reasons.
   - **Board:** columns Triage, Next, In progress, Waiting and Done (today only). Triage is the visually distinct first column, collapsible and also addressable directly as a filter. Dragging a card from Triage to Next means Accept. Each column renders at most 50 cards, then "+N more". Hidden overflow keeps its relative order, and a drop lands relative to the visible cards. Drops change only local state.
   - **Triage keys:** A accept, D dismiss, S snooze, E edit, L link, Enter opens the source.
   - **Meetings** (M5): the next 7 days, a readiness marker, and a "Needs prep" filter. **Matrix** and **Timeline** also come in M5. The Matrix places items by D6 urgency and importance, and a quadrant drag records a named override with Undo. The Timeline wraps the ReUI Gantt and draws verified edges only.
3. **Meeting brief sheet.** One 440px right sheet holds the D8 content. Every entry point opens the same occurrence: Focus, Meetings, the HyperHome bar, and Hyper-Event chips (M5).
4. **HyperHome.** The split stays as it is. `HyperHomeFocusBar` adds a collapsible bar: next action, next meeting with its readiness, and the Triage count. Its collapsed state is saved under the `KeyValueStorage` key `hyperHomeFocusBar`. Each link appears only once its destination works: the next action and Focus link in M2, the Triage link in M3, and the meeting link with readiness in M4.
5. **"Why?" popover.**
   - It shows signed contributions, unknown signals, overrides ("Moved by you"), and the placement reason in words.
   - If the individually rounded contributions do not add up to the displayed score, the difference shows as a display-only rounding adjustment.
   - Text is built from codes and facts.
6. **Stability.**
   - List order changes wait while the owner is interacting with the pointer or keyboard. A "New order (N moved) · Apply" pill appears instead.
   - The pending order applies on request, after 10 idle seconds once the pointer is clear of the list, or on the next visit.
   - Revocation, scope changes and loss of Start eligibility show immediately, including on the first card and on HyperHome.
   - Pending order and feedback from an obsolete scope or snapshot are discarded.
   - An `aria-live="polite"` region announces "Order updated, N moved".
7. **States.**
   - A status chip per source: fresh, syncing, partial or stale (with its time), error or unconfigured (with an "Open settings" deep link).
   - Skeleton loading, `Empty` with a reason, and a single "connect a source" empty state when nothing is connected.
   - The offline alert appears once per session.
   - Each card shows both its local and its source state.
   - Undo goes through a sonner toast for every local action.
8. **Quality.**
   - Design-spec tokens only (`docs/design/HYPERTASK_UI.md`), with no new colours or dependencies.
   - Sources are told apart by lucide icon plus label:

     | Source | Icon |
     | --- | --- |
     | Jira | `SquareCheckBig` |
     | Mail | `Mail` |
     | Meeting | `CalendarDays` |
     | Newsletter Gantt | `ChartGantt` |
     | HyperTask | `FileText` |

   - Priority tiers use ReUI `Badge` light variants.
   - User content uses `dir="auto"`, with `<bdi>` for inline text, and `text-start`. Jira keys and times are isolated.
   - Keyboard: J and K move, Enter opens, O opens the source, P pins, S snoozes, X done-for-me, ? help, and 1 to 5 switch views when no field has focus.
   - Light and dark themes.
9. **Setup and settings.**
   - A three-step first-run sheet in the Hub covers: sources and scopes; identity aliases (English and Hebrew); and working week (Sunday–Thursday or Monday–Friday presets), hours, breaks and zone. Source scope choices are collected before the first import.
   - **Consent comes before first use:**
     - M3 exposes mailbox opt-in, folder selection and retention before any scan.
     - M4 collects AI consent before the first summary, and requires the per-brief excerpt selection in D8.6.
   - The M5 "Task Hub" page in the Settings dialog, built with `components/app/settings-layout.tsx`, edits these choices and adds weights with a live preview.
   - Persistence is Astra's work; the UI is Opus's.
   - Holidays are out of scope for the first release; the owner can mark days off.

## D10. Write-back

The first release is read-only toward Jira, Outlook and Newsletter. Changes to a source happen in that source's editor, through the "Open in …" actions.

Write-back comes later, as distinct main-process commands that preview the target, account, exact change and current version for approval, and recheck before running:
- Jira transitions must be valid transitions;
- Newsletter edits must carry the expected chart revision (a task PATCH has no version guard, so it stays in the source editor);
- a send that timed out is never replayed.

(All three R2s)

## D11. Files and owners

**Rule:** Astra owns ingestion, storage, IPC and the renderer data layer. Sol owns ranking, planning, the brief logic and the renderer selectors. Opus owns every file that renders, plus navigation and HyperHome wiring. A file has exactly one owner. Changing someone else's file requires asking its owner first.

| Owner | Files |
| --- | --- |
| Astra | `src/shared/HyperTaskHub.ts` (contract: observation, action, projection `HyperHubTaskView`, `HyperHubSourceRef` with typed `openTarget`, feedback events, coverage, snapshot), `src/shared/HyperHubExtraction.ts`, `src/shared/HyperHubLinks.ts`, `src/main/hyper-task-hub/HyperTaskHubStore.ts`, `HyperTaskHubSync.ts`, `HyperTaskHubService.ts`, `HyperTaskHubIpc.ts`, `HyperHubJiraSource.ts`, `HyperHubProjectSource.ts`, `HyperHubCalendarSource.ts` (native), `HyperHubOutlookSource.ts` (availability and mail), `HyperHubNewsletterSource.ts`, `HyperHubSummaryTransport.ts`; additive changes to `src/main/HyperOutlookBridge.ts`, `HyperOutlookSchema.ts`, `HyperOutlookScript.ts`, `HyperOutlookIpc.ts`; bindings in `src/preload/index.ts` and `src/shared/api.ts`; registration in `src/main/index.ts`; renderer `src/renderer/features/hyper-task-hub/state/HyperTaskHubClient.ts` and `state/useHyperTaskHub.ts` (snapshot store, optimistic feedback, scope reset); tests next to each file |
| Sol | `src/shared/HyperPriorityEngine.ts`, `src/shared/HyperDayPlanner.ts`, `src/shared/HyperMeetingBrief.ts`; renderer `src/renderer/features/hyper-task-hub/state/HyperTaskHubSelectors.ts` (Focus list, Board columns, Matrix quadrants, overflow) and `state/HyperTaskHubReasons.ts` (codes and facts to message templates, English and Hebrew); fixtures and benchmarks |
| Opus | Everything that renders under `src/renderer/features/hyper-task-hub/`: `HyperTaskHubPage.tsx`, `HyperTaskHubHeader.tsx`, `HyperSourceStatusBar.tsx`, `focus/*`, `board/*`, `triage/*`, `brief/HyperMeetingBriefSheet.tsx`, `meetings/*`, `matrix/*`, `timeline/*`, `setup/*`; `src/renderer/features/settings/HyperTaskHubSettings.tsx`; `src/renderer/features/hyper-home/HyperHomeFocusBar.tsx`; edits to `HyperHomePage.tsx`, `features/tabs/plugin.ts`, `features/plugins/registry.tsx`, `features/sidebar/SidebarButtons.tsx` and the command palette; visual tests and harness screenshots |

All three proposals named these files differently. The table above settles them; Astra R2 C11 is closest.

## D12. Milestones and acceptance

Each milestone must pass `npm run typecheck`, `npm test` and `npm run build`. UI milestones also need web-harness screenshots in light, dark and Hebrew content, reviewed by Opus.

| Milestone | Scope | Acceptance |
| --- | --- | --- |
| **M1. Contracts and Jira/native slice** | Contract types, store and ledger, sync with generations, IPC and preload, Jira and native project sources, the ranking engine, the Hub page shell, Board, and sidebar and tab entry | One Jira issue plus its Hyper-Kanban mirror yields one card; it survives an offline restart; switching user shows neither record; a scope change mid-fetch commits nothing stale. Engine tests use a fixed clock and shuffled-input determinism. |
| **M2. Availability and Focus** | The Outlook availability cache, with coverage metadata and with private, confidential and unclassified events reduced to busy intervals before caching or projection; the native calendar source, the Newsletter Gantt source, the two-pass planner, the Focus view, capacity and overflow, and the HyperHome bar (next action and Focus link) | Fixtures for moved occurrences, Jerusalem DST, Sunday-start weeks, unknown effort, cycles and missing edges, and stale or missing availability. No overlapping blocks. Private, confidential and unclassified Outlook events show only the busy intervals that apply, in both the disk cache and the Focus snapshot. A profile switch with a request queued commits nothing from the old store. **Due-first fixture:** a new 30-minute renewal with the lowest owner importance, no successors and a 10:00 deadline scores 42.19. A 45-minute checklist with the highest owner importance, two open successors without deadlines, age of at least 28 days, and a later deadline with at least 525 covered free working minutes scores 43.00. Given 09:00–10:00 free, a 10:00–11:00 meeting and a later free window, score-first misses the renewal deadline and due-first places it at 09:00. Due-first wins and supplies the first recommendation. Also tested: a civil-date deadline after the last working window, and a tie with shuffled inputs. 500-task benchmark recorded. |
| **M3. Mail and Triage** | Mailbox opt-in, folder selection and retention, collected before any scan; the bridge header scan and flag inventory (verified on a classic profile); bilingual extraction; links and merges with undo; the Triage column and keys; typed `mail.open`; and the HyperHome Triage link | The mixed Hebrew and English fixture (two assignments, one dismissal, a Jira key, a moved meeting) keeps the surviving action, deadline and excerpt across an offline replay. Protected mail never reaches the index. Per-cohort precision is measured. |
| **M4. Meeting brief** | `HyperMeetingBrief`; verified occurrence and series joins; Newsletter article evidence; the brief sheet from Focus and HyperHome; readiness and Viewed; AI consent before the first summary; the optional summary | Briefs are cited and work offline. Invalidation works on a move or cancellation. Private and confidential meetings show no detail. A summary failure falls back to the deterministic brief. Revocation purges cached briefs across processes, and a summary reply arriving after a scope change is discarded. |
| **M5. Secondary views** | Meetings index, Matrix, Timeline, the weights settings UI, Hyper-Event moved onto the shared availability cache, the explicit Hyper-Kanban mirror action | |
| **Later** | Confirmed write-back (D10), Hyper-Bots `@scout` tools, a multi-day workload view, and a constraint solver if greedy misses are shown to matter | |

**Working order inside a milestone:**
1. Astra lands the contract changes first.
2. Sol and Astra build against the contract in parallel.
3. Opus builds the UI against the contract, using fixture snapshots, in parallel.
4. Integration comes last.

Members work in the shared branch on disjoint files.

## D13. Questions for the product owner

None of these blocks M1.

1. Which Jira projects, HyperTask boards, Newsletter resources and mail folders count as "mine"? The default is explicit selection at setup.
2. May the Hub keep corporate mail excerpts on this device, encrypted, for 30 days? May an AI endpoint ever receive excerpts, per brief and opt-in only?
3. What should the default working week and hours be?
4. Does the 90% precision gate before mail suggestions turn on by default suit you?
