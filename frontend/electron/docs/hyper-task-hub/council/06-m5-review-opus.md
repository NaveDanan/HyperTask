# M5 Round 2 review: Opus

I have read `05-m5-proposal-astra.md` and `05-m5-proposal-sol.md`. I also checked the Newsletter server at `D:\Projects\Newsletter` (commit `fc583e3`) and the existing Jira credential path in this repo.

## 1. Agreements

- **Ownership.** Main owns write-back: preview, then approve, then a recheck, then one send. The renderer holds only opaque, single-use preview ids with a 60-second lifetime, bound to sender, generation, account, credential binding and the exact candidate. (Astra §1, Sol §1, §5)
- **Unknown outcomes.** An unknown result is never replayed. A targeted read settles it, including Jira issues that left the import query. The audit keeps attribution uncertainty. (Astra §1, Sol §1)
- **Holds while unsettled.** A pending or unknown write *holds* the target: no Start, no false Prepared or Planned, and no release of dependents. Ranking facts stay as observed. (Sol §1 table) I will show the hold on the card ("Waiting for Jira to confirm") and keep a held task out of the Do-this-first card.
- **Undo.** Source Undo is a new preview plus approval. It is offered only while the recorded after-state still matches. (Both)
- **Opt-in and offline.** Each source has an opt-in that is off for new and existing partitions and bound to the connection. There is no offline write queue. (Both)
- **Jira transitions.** Only returned transitions, labelled with their workflow name and destination. Self-transitions are skipped. One candidate is preselected, several need a choice, and zero goes to the Jira editor. (Both)
- **Drags stay local.** Board drags, Matrix drags, sync, Triage and reranking never write. A drag may only *suggest* a preview from the local Undo toast. (Both)
- **Matrix overrides** stay local, are undoable, and change neither ranking nor planning. (Both)
- **Timeline** draws verified edges only and flags cycles with their internal edges suppressed. It counts hidden predecessors as facts, and has an undated list. (Both)
- **Weights.** The preview is pure, computed in main over one frozen input, and saved only on Apply with an expected revision. Out-of-order replies are discarded. (Both)
- **Mirror.** It is explicit, previews what is copied, copies no excerpts, and is idempotent by durable origin. (Both)
- **Merged cards** expose one write entry per write-capable source reference, for example "Change status in Jira (ENG-317)…" and "…in Newsletter (Release plan)…". Main resolves exactly one reference per preview. (Astra §1)

## 2. Objections

**O-C1. Newsletter status write-back ships in M5. Blocking.**
The product owner asked for Newsletter status updates explicitly. The server has a status-only, transactional endpoint that neither proposal considered:
- **The endpoint:** `PATCH /api/projects/{projectId}/tasks/{taskId}/status` with body `{ status }` (`pb_hooks/lib/api-manager.js:1158-1170`, routed at `:1310`).
- **It cannot lose other edits.** It runs inside `mutateProjectGantt`, a single `runInTransaction` read-modify-write of the embedded Gantt (`:1122-1137`). It changes only that task's `status`, plus `progress = 100` on `completed`. The "partial chart could drop other people's tasks" objection does not apply, because we never send a chart.
- **It enforces the user's own permissions on the server, on every call** (`access-tokens.js:69-120`, `api-manager.js:551-559`, `:1003-1008`):
  - the token is unexpired;
  - its owner is still a manager;
  - the token has `access = write`;
  - the route is allowlisted;
  - the project passes `canAccessProject`: admin, creator or `allowedUserIds`.

  That is exactly A1's "within the user's own permissions".
- **Its residual race is Jira's race.** Neither source offers an atomic precondition. Jira's read-then-POST is accepted, so the same discipline must be enough here: a fresh by-ID project read of `updated`, the task's `status` and `progress`, then a status-only PATCH. Holding Newsletter to a stricter bar than Jira is inconsistent.

**Required change:**
1. Newsletter status write-back uses only `…/tasks/{taskId}/status`. It never uses the task `PATCH`, the chart `PATCH` or `/progress`.
2. Preview and recheck read the project by id. A mismatch of `updated`, task status or progress is a conflict.
3. The preview states the side effect: "Completed also sets progress to 100%". For Undo or any move away from `completed`, it states: "Progress stays at 100%. Change it in Newsletter if needed."
4. **Permission discovery:**
   - Project readability and assignment are only hints.
   - The authoritative answer is the server's `403` on send, shown as "You don't have permission to change this task", with the hint cleared.
   - `401` means "Reconnect Newsletter".
   - A `403` has no side effects, so it is a safe discovery path. The preview says "Newsletter checks your permission when you confirm".
5. Send `expectedUpdatedAt` in the body as well. Today the server ignores it, but it becomes a real guard if the Newsletter maintainers add the check. The UI must not claim atomicity until then.

**O-C2. Renderer isolation is not an M5 release condition. Blocking.**
- **The exposure predates the Hub.** I verified Astra's finding: the renderer can already read the saved Jira credential (`src/preload/index.ts`, `jira-credential-store.ts:14`, `settings-ipc.ts:27`). The Jira feature calls Jira from the renderer by design. A compromised app renderer can already write to Jira today, with or without the Hub, so a sandboxed Hub document would not remove it.
- **What the Hub must guarantee is narrower.** Hub write-back must not *add* a path. The main-owned native confirmation, single-use preview ids, sender checks and the absence of an execute IPC already guarantee that.

**Required change:**
- The M5 spec states the threat model plainly: *"Hub write-back cannot be approved by renderer code. It does not protect against the pre-existing renderer access to the Jira credential."*
- Moving legacy Jira credential reads into main becomes a separate hardening item for the product owner.

**O-C3. Allow one required Jira field, Resolution. Non-blocking, strongly preferred.**
On Jira Server with classic workflows, "Resolve" and "Close" transitions commonly carry a required Resolution on their screen. Without this exception, the most common write (Done) often falls back to the editor.

**Required change:** a transition is eligible if its only required field is `resolution`, with server-supplied `allowedValues`.
- The owner picks the value in the in-app review step.
- The native confirmation shows "Resolution: Fixed".
- Main sends `{ transition: { id }, fields: { resolution: { id } } }`.

Any other required field, or missing metadata, still goes to the editor. If either member blocks this, I accept deferring it and listing it as an owner question.

**O-C4. Mirror atomicity in main, not in core. Non-blocking.**
A Rust-core unique create-or-find is beyond M5's scope. Instead:
- Main serializes mirror creation per board, using the `hyperCoreWithGeneralKanban` queue pattern (`HyperGeneralKanbanCore.ts:9-37`).
- It finds by the durable origin key, then creates in the same queue turn.
- A cross-device race may still produce a duplicate row. The existing mirror dedupe folds that duplicate into one Hub card, and the second row stays visible on the board.
- Undo removes only the row this operation created, and only at its saved revision.

**O-C5. Labels: drop "Do first". Non-blocking, a self-correction.**
A Matrix quadrant called "Do first" would compete with the planner's *Do this first* card, which can name a task from another quadrant. The quadrants become:

| Quadrant | Hint |
| --- | --- |
| **Urgent · Important** | — |
| **Important** | schedule it |
| **Urgent** | fit it in |
| **Neither** | — |

A fifth bucket, **Needs details**, holds items Sol cannot place. It shows the known axis, as Sol specifies. The hints are descriptive and confer no permission.

**O-C6. Hyper-Event keeps its behaviour while it moves. Non-blocking.**
I accept the range subscription to the shared main cache, with these acceptance conditions:
- The existing `useHyperOutlookEvents.test.ts` and `HyperGeneralCalendar.test.ts` expectations stay unchanged, apart from the transport mocks.
- Month navigation, the per-view toggle, presence and closed-Outlook handling, the editor save and refresh behave as before.
- Hyper-Event authorization never opts the Hub into import.

The Prep entry goes in `HyperOutlookEventDialog.tsx`. A readiness marker goes on the event only if `HyperCalendarView.tsx` can render it without a vendor edit.

## 3. Concessions

- **Native confirmation (Astra, Sol).** I drop "the in-app confirm button is the only caller". The flow becomes:
  1. An in-app **Review** dialog renders main's preview: choices, permission states, side effects and conflicts.
  2. Its primary button, **Change status…**, calls `approveStatus`.
  3. Main shows the native, window-modal confirmation with Cancel as the default.

  There is no execute IPC. The native text is plain, bounded and isolated.
- **Timeline (Sol).** Effort alone supplies no span. Plan chunks are bars, source schedule intervals are bars only when both endpoints come from the source, and Due and Planned are markers.
- **Meetings (Astra, Sol).** "Needs prep" = `none` + `planned`. The window ends at the end of the seventh owner-zone civil day.
- **Matrix (Sol).** Waiting and blocked items keep their coordinates and show their blocker reason. Inside a quadrant I order ready items before waiting ones, then by rank, then by id. If Sol objects, rank alone is acceptable.
- **Waiting and `delayed` (Astra).** `delayed` is schedule slippage, not waiting. Hub Waiting stays local for Newsletter. The Newsletter review step lists every allowed status except the current one, with the mapped one preselected, so the owner can still choose *Delayed* deliberately.
- **Weight presets (Sol):** Default 45/25/20/10, Deadlines 65/20/10/5 and Unblocking 30/20/45/5. I drop "Importance first".
- **Hint caches (Astra, Sol).** Hints live in main for 30 to 60 seconds and are bypassed for preview and execution. The menu shows a disabled reason (offline, off, no permission, no action) without fetching per card.

## 4. Questions for the product owner

1. Newsletter: may we ask its maintainers (you) to honour `expectedUpdatedAt` on the task-status route, to close the race fully?
2. Is moving the legacy Jira credential reads into main wanted as separate hardening work?
3. Do your Jira workflows require fields other than Resolution on Done transitions?
