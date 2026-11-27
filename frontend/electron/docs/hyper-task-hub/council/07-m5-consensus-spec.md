# HyperTaskHub M5 consensus spec

M5 spec version: 5
Status: **APPROVED** (m5-v5: Opus AGREE, Astra AGREE, Sol AGREE; `08-m5-signoff-<member>-v5.md`).
- m5-v1: Opus AGREE, Astra OBJECT, Sol OBJECT.
- m5-v2: Opus AGREE, Astra OBJECT (A5), Sol OBJECT (E1.7).
- m5-v3: Opus AGREE, Astra AGREE, Sol OBJECT (owner-release wording).
- m5-v4: Opus AGREE, Astra AGREE, Sol OBJECT (the text was paraphrased, not verbatim).

Every required change is merged; see "Changes from m5-v1" and "Changes from m5-v2" at the end.
Drafted by Opus as moderator from `05-m5-proposal-{astra,sol,opus}.md`, `06-m5-review-{astra,sol,opus}.md` and the product owner's decisions of 2026-11-27.

Spec v2 (`03-consensus-spec.md`) stays binding wherever this document does not change it. Section numbers here use the prefix **E**. References to `D*` point to spec v2.

## E0. Product owner decisions (2026-11-27)

The council was split on four points, and the product owner chose the recommended option on each.

| # | Question | Decision | Objections settled |
| --- | --- | --- | --- |
| 1 | Isolate Task Hub in a sandboxed renderer before write-back? | **No. Ship with the main-owned native confirmation.** The existing renderer access to the saved Jira credential is documented as a known, app-wide risk outside M5 (see E1.11). | A-C2, S-C2 (overruled); O-C2 (upheld) |
| 2 | Newsletter status write-back in M5? | **Yes, for leaf Gantt tasks,** through the dedicated status route. A fresh read comes immediately before the send, and the side effects are disclosed. | S-C9 (overruled); O-C1, A-C3 (upheld) |
| 3 | When a Jira transition requires Resolution? | **Let the owner pick Resolution** from the values Jira returns for that transition. Any other required field opens Jira. This is an explicit owner approval of the one exception to status-only scope that S-C3 asked for. | S-C3 (its conditions adopted in E1.5) |
| 4 | Hyper-Kanban mirror uniqueness? | **A per-device guard.** No Rust core change. A cross-device duplicate is possible and is folded by the Hub. | S-C6 (overruled); A concession, O-C4 (upheld) |

## E1. Status write-back (Jira and Newsletter)

### E1.1 Scope

- **Jira:** issue status changes through workflow transitions. The only field a transition may also carry is `resolution`, under E1.5.
- **Newsletter:** the status of a **leaf** Gantt task (one with no subtasks), set to `pending`, `in-progress`, `completed` or `delayed` through `PATCH /api/projects/{projectId}/tasks/{taskId}/status` with body `{ status }` and nothing else. The task `PATCH`, the chart `PATCH` and `/progress` are never used. Parent rows and charts whose structure the Hub cannot verify go to the editor.
- **Outlook stays read-only,** and so does every other field: title, description, dates, assignee, effort and progress. Progress changes only as a disclosed server side effect.
- **Eligible write targets:** an `origin` or `assignment` reference that the owner's scope currently selects and can access. A `mention`, `mirror` or article is never a target. On a merged card, each write-capable reference gets its own entry, and each preview resolves exactly one reference.

### E1.2 Opt-in

- The setup scope gains `writeBack: { jira: boolean; newsletter: boolean }`. Both default to `false` for new and existing partitions.
- Consent is bound to the configured connection's fingerprint. Replacing or removing the connection clears it.
- Turning a source off invalidates its outstanding previews and open confirmations.
- Settings shows an explainer when write-back is off. The menu entry stays visible, opens the explainer, and links to Settings → Task Hub.

### E1.3 Contract (Astra; names are binding, field details may be refined additively)

```ts
type HyperHubWriteSource = 'jira' | 'newsletter';
type HyperHubStatusIntent =
  | { kind: 'state'; state: 'ready' | 'doing' | 'done' }   // from a toast offer or chip
  | { kind: 'choose' }                                      // from the card menu
  | { kind: 'reverse'; operationId: string };               // source Undo
type HyperHubStatusCategory = 'new' | 'indeterminate' | 'done' | 'unknown';
type HyperHubStatusEffect =
  | { code: 'progress-set'; from: number | null; to: 100 }      // Newsletter completed
  | { code: 'progress-kept'; value: number }                     // leaving completed: progress stays
  | { code: 'parent-rollup' }                                    // Newsletter may recompute parents
  | { code: 'chart-normalized' }                                 // Newsletter normalizes and reschedules the chart
  | { code: 'resolution-set'; valueName: string }                // Jira exception, after a choice
  | { code: 'any-status-transition' }                            // Jira global transition: can apply after an intervening status change
  | { code: 'workflow-effects' };                                // Jira post-functions may do more
interface HyperHubStatusCandidate {
  candidateId: string;
  actionLabel: string;              // Jira workflow action name, or the Newsletter status label
  to: { id: string; name: string; category: HyperHubStatusCategory };
  preselected: boolean;
  resolution?: { values: { id: string; name: string }[] };   // present only when required (E1.5)
  effects: HyperHubStatusEffect[];
}
interface HyperHubStatusUnavailable { actionLabel: string; toName: string; reason: 'required-fields' | 'metadata' | 'self'; fields?: string[] }
interface HyperHubStatusPreview {
  previewId: string; expiresAt: HyperHubInstant;       // single use, 60 s
  source: HyperHubWriteSource; site: string;
  accountLabel: string;   // Jira: the verified principal from /myself; Newsletter: "Configured Newsletter connection"
  target: { key?: string; title: string; container?: string };   // bounded plain text; Newsletter: container = project, key = task id
  current: { id: string; name: string; category: HyperHubStatusCategory; progress?: number | null };
  versionLabel: string;                                   // e.g. Jira `updated` or project `updated`
  candidates: HyperHubStatusCandidate[]; unavailable: HyperHubStatusUnavailable[];
  permissionCheckedOnConfirm: boolean;                    // Newsletter: true
}
type HyperHubStatusRejectCode = 'disabled' | 'offline' | 'forbidden' | 'reconnect' | 'not-found' | 'not-leaf'
  | 'unsupported' | 'held' | 'no-actions' | 'scope-changed' | 'revision-conflict' | 'invalid'
  | 'access-denied' | 'unavailable';   // IPC guard failures are mapped into these unions, never a bare { ok: false }
type HyperHubStatusPreviewResult = HyperHubVersion & ({ ok: true; preview: HyperHubStatusPreview } | { ok: false; code: HyperHubStatusRejectCode });
type HyperHubStatusApproveResult = HyperHubVersion & (
  | { outcome: 'cancelled' } | { outcome: 'expired' }
  | { outcome: 'succeeded'; write: HyperHubWriteView }
  | { outcome: 'conflict'; preview: HyperHubStatusPreview }      // fresh preview with the new values
  | { outcome: 'failed'; code: HyperHubStatusRejectCode | 'rejected'; write?: HyperHubWriteView }
  | { outcome: 'unknown'; write: HyperHubWriteView });
interface HyperHubWriteView {
  operationId: string; taskId: string; evidenceId: string; source: HyperHubWriteSource;
  state: 'pending' | 'succeeded' | 'failed' | 'unknown';
  at: HyperHubInstant; fromName: string; toName: string; observedName?: string; code?: string;
  undoAvailable: boolean;
}
// HyperHubSourceRef gains:   statusWrite?: { available: boolean; code?: HyperHubStatusRejectCode }  (a cached hint, never authority)
// HyperHubSnapshot gains:    writes?: HyperHubWriteView[]
// HyperHubSettingsSummary gains: writeBack?: Record<HyperHubWriteSource, { enabled: boolean; available: boolean; code?: HyperHubStatusRejectCode }>
```

**Channels** (additive, under the existing prefix):
- `hyper-task-hub:preview-status`, taking `{ scopeGeneration, expectedRevision, handle?, intent }`. The handle is required for the `state` and `choose` intents. For `reverse`, main resolves `operationId` in the current partition and authorizes its recorded target by id, because a closed issue can lose its snapshot handle;
- `hyper-task-hub:approve-status`, taking `{ previewId, candidateId, resolutionId? }`;
- `hyper-task-hub:discard-status`, taking `{ previewId }`.

There is no execute channel. Strict schemas accept handles, ids and enums only: no URLs, no free fields, no approval flag.

### E1.4 Native confirmation (main)

A preview is a random, single-use token. Main binds it to:
- the originating trusted top-level main-frame document and its window;
- the partition, generation and principal (the verified Jira principal, or the Newsletter credential fingerprint);
- the credential binding and the target revision;
- once approved, the exact selected candidate, including any server-listed Resolution.

`approve-status` validates the candidate and Resolution against the token, synchronously consumes it, and only then opens one window-modal `dialog.showMessageBox` on the originating window. Approval from a second registered window, or after navigation, is refused and sends nothing.
- buttons `['Cancel', 'Change in Jira' | 'Change in Newsletter']`, with `defaultId` and `cancelId` both 0 and `noLink: true`;
- at most one active confirmation per window. A second approve while one is open returns `cancelled` without opening another.

Main builds the text only from the bound preview record. Untrusted values are bounded (at most 200 characters each), stripped of control and bidi-override characters, and wrapped in U+2068/U+2069 isolates:

```
title:   Change status in Jira?        (or Newsletter)
message: Jira:       ENG-317 · <title>
         Newsletter: <project> · task <taskId> · <title>
detail:  In Review → Done  (Resolve issue)
         Resolution: Fixed                                             (only with E1.5)
         Jira can apply this from any status.                          (global transition)
         Completion sets progress to <observed>% → 100%. Undo restores the status and leaves progress at 100%.   (Newsletter → completed)
         Progress stays at <observed>%.                                (Newsletter, leaving completed)
         Newsletter also normalizes and reschedules the chart and can recompute parent roll-ups.   (Newsletter, always)
         Account: <accountLabel> · <site>
         Version: <versionLabel>
         Newsletter checks your permission when you confirm.           (Newsletter)
```

The in-app review dialog (E1.10) shows the same lines before approval.

Only the native response authorizes dispatch. An IPC boolean, a DOM click or a bot decision never does. Cancel, expiry, navigation, window close, scope change, opt-out or a connection change all discard the preview.

### E1.5 Recheck and dispatch (main)

**Before sending:**
1. Serialize per connection and target.
2. Re-resolve the live credential and principal, opt-in, scope membership, selection and generation.
3. Persist a durable claim **before** the final source recheck. If the claim cannot be persisted, nothing is sent.
4. Run the final source recheck (below).
5. After the final await, verify the originating document, expiry, scope, opt-in and credential binding again. If the owner opted out during claim persistence, nothing is sent.
6. Dispatch once with the bound credential.

**Jira:**
- Run a fresh by-ID `GET` for `status` (id and category), `updated`, project, assignee and reporter, plus `GET …/transitions?expand=transitions.fields`.
- Require all of the following to match:
  - the status id;
  - `updated`;
  - the transition id, still present with the same destination and the same required-field signature;
  - for E1.5, the chosen `resolutionId` still in that transition's `allowedValues`.
- Global transitions are allowed. The fresh by-ID status and version read is the final remote check. The residual race is disclosed: Jira can still apply a global transition after an intervening status change (`any-status-transition`). This is the same race class the owner accepted in E0 #2.
- `POST` the body `{ transition: { id } }`, plus `fields: { resolution: { id } }` only under E1.5.
- A `204` is followed by a targeted read that supplies the after revision.
- **The Resolution exception (E0 #3)** applies only when every required field of the transition is `resolution` and its metadata lists `allowedValues`. The value is a server-supplied id that main binds and re-verifies, and it appears in both the in-app review and the native confirmation. Any other required field, or missing metadata, makes the transition `unavailable` with reason `required-fields`, naming the field, and offers **Open in Jira**.
- Self-transitions are listed as `unavailable: self`.

**Newsletter:**
- Run a fresh `GET /api/projects/{projectId}`.
- Require all of the following to match:
  - project `updated`;
  - the task's `status` and `progress`;
  - the task is still a leaf. On the complete, validated, ordered chart (before resource filtering), the immediately following row is absent or its `indentLevel` is at most the target's;
  - the current assignment scope.
- `PATCH …/tasks/{taskId}/status` with `{ status }` only, then read back with the project `GET`, locating the task by id.
- Write permission is discovered only by this approved send. Neither the token's `access` flag nor the project role is readable in advance, so the hint is optimistic. The preview says so (`permissionCheckedOnConfirm`). The Hub never probes with a dummy write.

**On source drift,** the result is `conflict` with a fresh preview showing the new values, but only if the original scope still authorizes the target. If scope, assignment, access or leaf eligibility is lost, the applicable rejection is returned without target details.

**Errors:**

| Response | Result |
| --- | --- |
| `401` | `reconnect`, shown with A1's permission message ("You don't have permission. Reconnect <source>.") |
| `403` | `forbidden` ("You don't have permission"). Clears hints. Read access is rechecked separately, and lost read access is purged. |
| `404` | `not-found` ("Issue unavailable", with no prior title) |
| Jira `400`/`409` on the transition | Rediscover. If the inputs changed: `conflict` with a fresh preview (when still authorized). If they are unchanged: `failed` with code `rejected`, and **Open in Jira**. |
| Timeout, connection loss after dispatch, an ambiguous reply, or a claim interrupted by a restart | `unknown` |

`unknown` is never replayed. A targeted authorized read (including closed Jira issues) settles what the card shows, and the audit keeps the attribution uncertain. Raw bodies, headers and fingerprints stay in main, and the renderer receives enumerated codes only.

### E1.6 Ledger, audit and Undo

**Ledger entries.** Append claim and terminal events under one `operationId` in the encrypted ledger. The **receipt** (what the transport reported) and the **observation** (what an authorized read found) are tracked separately:
- An acknowledged write followed by a failed `GET` keeps its receipt.
- A later authorized read supplies the observed facts.
- An ambiguous receipt stays `unknown` in the audit and can never enable Undo.
- Late results are persisted only in the originating partition, never published into a partition that has since become active.

Each entry holds:
- the local owner and the verified source principal (Jira) or the bound credential fingerprint (Newsletter);
- the time;
- the connection and an opaque target id;
- the before status, revision and progress;
- the requested after status;
- the result;
- the observed after status, revision and progress;
- the inverse operation id.

Labels are kept to a minimum, and source text is purged under D3. Clearing the cache keeps the audit.

**Undo.** Source Undo is `preview-status` with `intent: reverse`, available only when all of the following hold:
- the send was acknowledged, its verified after-state shows the requested status, and that status, revision and progress still match the source;
- the current scope and read access are valid;
- a reverse action exists. For Jira, that is a transition to the exact previous status id, and if several exist the owner chooses.

The approved reverse send obeys E1.5 in full, including Newsletter's permission check on confirm. Undo always gets its own preview and native confirmation, and its result is linked as a new entry. `undoAvailable` reflects these conditions, and the UI offers Undo only when it is true. Local feedback Undo never reverses a source write.

### E1.7 Snapshot effects (Sol)

| Write state | Effect |
| --- | --- |
| Pending; acknowledged and awaiting verified readback (including an acknowledged write whose readback failed, which keeps its `succeeded` receipt); or unknown and awaiting authorized reconciliation | Show the last observed source status with the write state. Ranking facts (D6 points) stay as observed. The target is **held**, and the hold is projected separately from the audit outcome. While held: <ul><li>it is not Start-eligible and not recommended;</li><li>any other Hub write to it is refused (`held`);</li><li>its authoritative completion is uncertain, so dependents are not released and prep cannot rely on it, including on a reopen;</li><li>a held prep task cannot make a meeting Prepared, and a held block cannot make it Planned. Owner confirmation still counts;</li><li>fixed reservations stay busy but are excluded from the forecast and from readiness.</li></ul> Remove a held "Do this first" immediately. Start is rechecked in main.<br><br>**Release:**<ul><li>A definitive failure, or a verified authorized read after acknowledgment, releases the hold.</li><li>After an ambiguous dispatch, reconcile no earlier than 30 seconds after dispatch, or after recovery if the dispatch time is unavailable. Automatically release only on an authorized read known to follow the completion of that request, established by source evidence or a documented server processing bound. Closing the client connection is no such guarantee. Otherwise the hold is kept, including across restart, and **Check in <source>** stays available.</li><li>**Owner release.** Offer **I checked in <source>** for a held ambiguous dispatch only after the earliest reconciliation time and a fresh authorized read of its target. Show the observed status and explain that the earlier update may still apply. Main rechecks scope, connection, authorization and observation before recording the owner's explicit confirmation under the same operation id. Release the hold for Start, planning, dependency release and prep. Recompute from the observation under normal source authority and eligibility rules. Apply later reads normally. The audit stays `unknown` and Undo stays unavailable. Refuse further Hub writes to that target with `held` until an authorized read is known to follow completion of the ambiguous request.</li></ul> |
| Succeeded | Merge only the verified readback into the observation, then recompute ranking, plan and readiness. Completion unblocks successors only if the written reference is authoritative for that card. Local decisions are kept, and both statuses stay visible. |
| Failed | Show the reason, lift the hold, and recompute from the last valid observation or the fresher conflict read. A scope loss takes precedence over every result. |

### E1.8 Status mapping (Sol, `src/shared/HyperHubStatusMapping.ts`)

| Hub state | Jira destination | Newsletter |
| --- | --- | --- |
| Next (`ready`) | category `new` | `pending` |
| In progress (`doing`) | category `indeterminate` | `in-progress` |
| Waiting | none: a local decision only | none: `delayed` is a source schedule fact, never mapped automatically |
| Done | category `done` | `completed` |

- Source status seeds local state only where the owner has made no local decision.
- A missing or undefined Jira category means unknown completion.
- Newsletter progress is independent metadata, and status decides completion.
- For the `choose` and `state` intents, the chooser lists all eligible non-self options: returned transitions (Jira) or the other statuses (Newsletter). For `reverse`, it lists only options to the exact recorded previous status, on either source. It preselects exactly one candidate only when exactly one matches the intent. With `choose`, nothing is preselected.
- Labels never identify a transition; ids and typed values do.

The pure functions are:
- `hyperMapSourceStatus`;
- `hyperChooseJiraCandidates`;
- `hyperChooseNewsletterCandidates`;
- `hyperDetectStatusConflict`;
- `hyperStatusEffects`.

### E1.9 Where a write is offered (Opus)

- **The card menu, per write-capable reference:** "Change status in Jira (ENG-317)…" or "Change status in Newsletter (<project>)…". It is available in Board, Focus, Matrix and Timeline, and reachable by keyboard.
- **The status-differs chip.** When write-back is on and the local state's category differs from the source category, the card and the Do-this-first card show "<source>: <observed status>". Clicking the chip opens the review dialog with a `state` intent.
- **A toast offer after a local move.** After a Board drop, Start (Next → In progress) or Done-for-me on a write-capable card, the local Undo toast adds a secondary action, **Also update <source>…**. No preview is fetched until the owner clicks it. Dismissing the toast changes nothing.
- **Never offered:** after a Matrix drag, sync, Triage, reranking or scheduling. No shortcut approves a write, and nothing writes in batches.

### E1.10 Review dialog (Opus)

This is the in-app step before the native confirmation. It renders the main-built preview:
- target, account and site, current status and version;
- the candidates as a radio group showing the action label, the destination, and a category Badge (light variants);
- a Resolution select when required;
- the effects as plain sentences;
- `unavailable` rows with their reasons and **Open in Jira/Newsletter**.

The primary button **Change status…** calls `approve-status`. The dialog then shows "Confirm in the dialog" until the result returns.

| Result | Dialog behaviour |
| --- | --- |
| `conflict` | Stays open. An alert says "<key> changed in <source> since you opened this. It's now <status>." The fresh preview replaces the old one. |
| `forbidden` | An alert with **Open in source**, and no retry. |
| `expired` | The primary button becomes **Check again**, which runs `preview-status`. |
| `succeeded` | Closes. The toast uses the write's actual source name. If readback succeeded, it says "<key> is now <observed status> in <source>". While readback is outstanding, it says "<source> accepted the update. Checking status." It offers **Undo** only when `write.undoAvailable` is true; Undo opens the dialog with the reverse intent. |
| `unknown` | Closes. The card shows a sticky warning badge, "<source> update unknown · Check in <source>", which opens the matching source. |

The initial focus is Cancel. All source text uses `dir="auto"` and `<bdi>`, and never HTML.

### E1.11 Threat model (owner decision 1)

> Task Hub write-back cannot be approved by renderer code. Each write needs a fresh, single-use preview bound in main and a main-owned native confirmation. Main rechecks before sending. It does **not** protect against the pre-existing renderer access to the saved Jira credential (`src/preload/index.ts`, `src/main/settings-ipc.ts:27`). The existing Jira feature uses that path to call Jira from the renderer. Moving those reads into main is separate hardening work for the product owner.

This text goes into the README's Privacy and safety section and into the Settings write-back explainer, in short form. Hub components must not use `dangerouslySetInnerHTML` or render Markdown from source content, and a test asserts it.

## E2. Meetings index

- **Window:** from the snapshot clock to the midnight after the seventh owner-zone civil date, counting today. It is correct across DST.
- **Contract (Astra):** the snapshot carries `meetingWindow?: { requested: HyperHubInterval; coverage: HyperHubCoverage[] }`, and the agenda covers that window.
- **Selector (Sol):** `hyperSelectMeetingDays(snapshot, { now, needsPrep })` returns days, each with a local date, coverage, and rows sorted by start, then occurrence id. `now` defaults to `snapshot.asOf`. Empty days keep their coverage. The selector reuses the existing linked-open count and builds no brief.
- **Needs prep** means eligible occurrences whose readiness is `none` or `planned`. Viewed changes neither membership nor the count, and listing a meeting does not mark it Viewed.
- **UI (Opus):**
  - sticky day headers ("Today", "Tomorrow", then "Tue 1 Dec");
  - each row shows the time range, the subject, the readiness badge, Viewed, the open-item count, **Join** (for `https:` links only) and a stale badge;
  - private, confidential and unknown-sensitivity items appear as muted "Busy" rows that cannot be clicked;
  - the **Needs prep** toggle shows a count;
  - keys: J and K move, Enter opens the shared brief sheet;
  - empty, partial and unconfigured states.

## E3. Matrix

- **Axes (Sol):** `HyperHubRanked.urgency` and `importance`.
  - **Urgent** means urgency ≥ 0.50.
  - **Important** means importance ≥ 0.67.
  - The owner's priority, including zero, wins over the mapped Jira priority.
  - Slack that is stale or owner-declared is marked provisional.
- **Quadrants:**

  | Quadrant | Caption |
  | --- | --- |
  | **Urgent and important** | none |
  | **Important** | "Schedule" |
  | **Urgent** | "Fit in" |
  | **Neither** | "Later" |

  Axis labels stay explicit. Captions confer no permission and no eligibility.
- **Placement:** a card with a manual override goes to that quadrant and keeps its measured axis facts. Without an override, a card with either automatic axis unknown goes to the **Needs details** tray. The tray shows the known axis and what is missing, for example "Effort needed to calculate urgency". Undo restores the prior override or the automatic placement.
- **Exclusions:** Review, Dismissed and Done stay out of the Matrix. Waiting and blocked cards with known axes stay in their quadrant, with their blocker reason and ineligibility visible.
- **Overrides:** a drag or keyboard move records feedback `set-matrix-quadrant { taskId, quadrant: 'urgent-important' | 'important' | 'urgent' | 'neither' }` in the local ledger. Undo restores the prior override or the automatic placement. The override persists through sync and weight changes, and it never changes scores, priorities, deadlines, the plan or eligibility. **Why?** shows "Moved by you".
- **Order inside a quadrant:** rank position, then code-unit id.
- **Caps and stability:** at most 50 cards per quadrant, then "+N more". D9.6 stability applies to automatic moves, and the owner's own move applies immediately.
- **Selector and reasons:** `hyperSelectMatrix(snapshot, filters)` and `hyperFormatMatrixReason(reason, locale)`, in English and Hebrew.

## E4. Timeline

- **Range:** 7 or 28 days from a selected owner-zone civil date. The default is today and 28 days. Bounds are half-open.
- **Grouping:** by scoped project (the default) or by primary source. A merged card appears once.
- **Bars:** valid plan chunks (fixed or provisional), and verified source schedule intervals when the source supplies both endpoints as paired schedule fields. **Astra** owns the contract and the adapter projection of those paired endpoints, with their provenance.
- **Markers:** a lone planned start, and the due date (a civil due date sits in its own day cell). Independent planned and due fields alone only ever make markers.
- **Effort** appears as row text only. Effort never creates a span.
- **Clipping:** geometry is clipped to the range, and the original dates are kept for display.
- **Edges:** the graph is built before filters are applied. One finish-to-start arrow is drawn per verified, unresolved edge whose actual predecessor finish and successor start are both in range. The arrow uses the predecessor's last plan chunk and the successor's first plan chunk, or the paired source interval when that row has no plan chunks. Both endpoint bars must be visible after filtering. Hidden or missing predecessors are reported as row facts.
- **Cycles:** rows in `cycleTaskIds` are flagged, and edges inside a cycle are suppressed.
- **Undated items:** an "Undated" list. Dated items outside the range are counted.
- **Read-only:** no drag and no resize.
- **Selector (Sol):** `hyperSelectTimeline(snapshot, range, groupBy, filters)`.
- **UI (Opus):** wraps the vendored ReUI `Gantt` with interactions off, following the `HyperGanttTimeline` styling approach. Vendor files are not edited.

## E5. Weights and Settings → Task Hub

- **Persistence (Astra):** `settings.weights` (already in the summary) persists four numbers in the encrypted partition. Absent values mean 45/25/20/10.
- **Channels:**
  - `hyper-task-hub:preview-weights { scopeGeneration, expectedRevision, draft, seq }` returns `{ seq, diff }`. It ranks one frozen input at a fixed preview clock, with no side effects, and discards out-of-order replies.
  - `hyper-task-hub:save-weights { scopeGeneration, expectedRevision, weights }` validates both values at commit, then recomputes and publishes once. Stale preview replies are discarded on a scope change.
- **Validation (Sol):**
  - four finite, non-negative values, at least one of them positive, edited in the UI from 0 to 100;
  - an invalid draft keeps the last valid preview;
  - normalization: divide by the largest value, then by the scaled sum;
  - the D6 formula applies, and unknown signals contribute zero with the full denominator.
- **Presets:** *Balanced* 45/25/20/10, *Deadline first* 65/20/10/5 and *Unblock others* 30/20/45/5. Reset loads Balanced into the draft.
- **Diff (Sol, `hyperPreviewWeights`):** task id, old and new position, score cents, and signed per-signal deltas, over the same eligible Focus cohort, respecting pins and manual order. Score-only changes are included. The diff also returns the draft top ten, including unchanged rows, and a movement count based on changed positions. The budget is under 20 ms per warmed diff at 500 tasks.
- **Debounce:** 150 ms in the UI.
- **Settings page (Opus):** an additive `SettingsPage.taskHub = 'taskhub'` with the `ListTodo` icon, built with `settings-layout.tsx`. Its sections:
  - Sources, You and Work week, reusing the setup step bodies extracted to `setup/HyperHubSetupSections.tsx`;
  - **Write-back**, with one switch per source plus the explainer and threat-model line ("Outlook stays read-only.");
  - **Ranking**, with sliders, normalized percentages, presets, Reset, and the live preview (top 10 with ↑/↓ and "N tasks move"), plus Save and Cancel;
  - **Privacy**, with retention and AI consent.
- **The Hub's gear** opens the first-run sheet until setup is complete, and Settings → Task Hub after that.

## E6. Hyper-Event on the shared availability cache

**Astra (A-C4):**
- Replace the independent renderer poller in `useHyperOutlookEvents.ts` with a subscription to the visible interval, served from a shared main cache. The cache is keyed by authorized store, generation and interval. Overlapping reads are coalesced, and coverage is tracked per interval.
- Hyper-Event's own authorization and visibility never opt the Hub into import, and changing the calendar's range keeps the Hub's import horizon.
- Protected items are projected as anonymous busy spans. Editor metadata resolves on demand from a scoped occurrence handle. An editor save invalidates the affected ranges.
- Calendar markers, the per-view toggle, presence and closed-Outlook handling, refresh and editor operations are all preserved.

**Tests:**
- month navigation beyond the Hub's seven days;
- use before Hub setup;
- presence changes;
- refresh after an editor save;
- same-range coalescing;
- store replacement;
- the protected-item contents on disk.

User-visible behaviour stays the same. Assertions that count minute-by-minute `client.list` calls move into the shared-cache tests. The hook tests assert visible-range subscriptions, focus refresh and unsubscribe.

**Prep entry (Opus):** `HyperOutlookEventDialog.tsx` shows **Prep brief** for occurrences that main verifies as eligible agenda items, using the shared brief-request store. A readiness marker on the event appears only if `HyperCalendarView.tsx` can render it without a vendor edit.

## E7. Add to Hyper-Kanban (owner decision 4)

**Eligibility:** accepted, non-native items only. Never Triage items, items derived from private meetings, or mail excerpts.

**The flow (Astra):**
1. `hyper-task-hub:preview-mirror { …version, taskId }` returns the destination board, its audience (the workspace), the exact title and source link to copy, and a single-use token.
2. The in-app confirmation calls `hyper-task-hub:apply-mirror { token }`.
3. Main rechecks source and workspace write access, serializes per board and origin key (following the `hyperCoreWithGeneralKanban` queue pattern), finds an existing row by its durable origin key, and creates the row with that key and the approved cells only if none exists.
4. A journal entry links the result row. A lost acknowledgement is reconciled by key before any new attempt, and an existing match is opened instead.

**Undo:** deletion is offered only through a revision-conditional delete. The current core's `DeleteRows` accepts only view and row ids, and an edit can land between a revision read in main and the delete. So M5 offers **Open in Hyper-Kanban** instead of Undo, and sends no delete. If the core later gains a conditional delete, Undo also requires creation evidence linked to this operation.

**Duplicates and matching:** a duplicate created by two devices at the same moment is possible. Astra extends `HyperHubProjectSource`, `hyperHubIndex` and the snapshot grouping, so that each eligible source matches its mirror rows through the durable, scoped origin key written at creation. The existing index joins only verified Jira aliases. A cross-device duplicate then folds into one Hub card.

**UI (Opus):**
- the card-menu item **Add to Hyper-Kanban…**, then the confirmation;
- the toast "Added to Hyper-Kanban" with **Open**, not Undo;
- mirrored cards show **Open in Hyper-Kanban**.

## E8. Views and other UI (Opus)

- **The view switch** has five views: **Focus, Board, Meetings, Matrix, Timeline**, on keys 1 to 5. Filters are shared, and the choice is saved per user.
- **Command palette (carried over from D9.1):** "Task Hub: Do this first", "Task Hub: Triage" and "Prep: <next meeting>".
- **Held and write states on cards** (always named with the write's own source label, never a hard-coded "Jira"):
  - pending: "Updating <source>…" with a spinner;
  - unknown: a warning badge with **Check in <source>**, which opens the matching source. Offer **I checked in <source>** only while the owner-release conditions in E1.7 are met.
  - failed: the reason, shown in the toast and in the card's tooltip;
  - held: "Waiting for <source> to confirm". A held card is not Start-eligible.
- **Visual quality:** D9.8 applies. Every new view and dialog state is reviewed in harness screenshots in light and dark themes, with Hebrew content.

## E9. Files and owners

| Owner | Files |
| --- | --- |
| Astra | `src/shared/HyperTaskHub.ts` (E1.3, E2, E3 feedback, E5, E7 contract) and `HyperTaskHub.fixtures.ts` (`HyperHubM5Fixture`: write states, 7-day meetings with readiness mix, matrix axes incl. unknown, timeline intervals/edges/cycle/undated, weights); new `src/main/hyper-task-hub/HyperTaskHubWriteback.ts` (coordinator, native confirmation, ledger) with source writers in `HyperHubJiraStatusWriter.ts` and `HyperHubNewsletterStatusWriter.ts`; `HyperTaskHubIpc.ts`, `HyperTaskHubService.ts`, `HyperTaskHubStore.ts`, `HyperTaskHubSync.ts`, `HyperHubOutlookSource.ts`; new `HyperHubMirror.ts`; `src/main/HyperGeneralKanbanCore.ts` if needed; `src/preload/index.ts`, `src/shared/api.ts`, `src/main/index.ts`; renderer `state/HyperTaskHubClient.ts`, `state/useHyperTaskHub.ts` (status preview and approve, weights preview and save, mirror); `src/renderer/features/hyper-outlook/useHyperOutlookEvents.ts` and `hyper-outlook-client.ts` (non-rendering transport); tests beside each |
| Sol | `src/shared/HyperPriorityEngine.ts` (weights input), new `src/shared/HyperHubStatusMapping.ts`, new `src/shared/HyperHubWeights.ts` (`hyperNormalizeWeights`, `hyperPreviewWeights`), `src/shared/HyperDayPlanner.ts` and `HyperMeetingBrief.ts` (holds), `state/HyperTaskHubSelectors.ts` (`hyperSelectMatrix`, `hyperSelectTimeline`, `hyperSelectMeetingDays`, held eligibility), `state/HyperTaskHubReasons.ts` (matrix, write-back states and reject codes, held reasons, EN/HE); test-local fixtures and benchmark. The shared `HyperHubM5Fixture` stays with Astra. |
| Opus | Everything that renders: `HyperTaskHubView.tsx`, `HyperTaskHubPage.tsx`, `meetings/*`, `matrix/*`, `timeline/*`, `writeback/*` (review dialog, write badges, toast offers), `board/HyperHubCard.tsx`, `focus/*`, `setup/*`, `src/renderer/features/settings/HyperTaskHubSettings.tsx`, `SettingsDialog.tsx` and `settings-dialog-store.ts` (additive page), `hyper-outlook/HyperOutlookEventDialog.tsx` (Prep entry), command palette entries; visual tests, harness screenshots, README and STATUS docs |

## E10. Work order and acceptance

**Work order:**
1. Astra lands the contract and `HyperHubM5Fixture` first, including fixture client methods.
2. In parallel:
   - Astra builds main and the data layer;
   - Sol builds pure logic, selectors and reasons;
   - Opus builds the UI against fixtures.
3. Opus integrates.
4. Then: typecheck, Vitest and build; harness screenshots in light, dark and Hebrew; one commit series on `feat/hyper-task-hub`; and a PR.

**Acceptance:**
- **Write-back:**
  - forged or replayed or expired previews;
  - a second approve during an open dialog opens no second dialog;
  - a connection switch while the dialog is open causes zero sends;
  - a failed claim persistence causes zero sends;
  - the exact outbound method, path, body and count for each source, with Newsletter's body exactly `{ status }`;
  - the Resolution exception sends only server-listed ids, and other required fields go to the editor;
  - self-transitions are excluded;
  - 401, 403 and 404 mapping;
  - Jira 400/409 conflict leads to a fresh preview;
  - a timeout after commit gives `unknown`, with no replay, settled by a targeted read, including a closed issue;
  - a restart with an interrupted claim gives `unknown`;
  - Undo only on a matching after-version, with its own confirmation;
  - Newsletter parent rows are rejected as `not-leaf`;
  - the completion disclosure;
  - opt-in off by default, cleared on connection replacement;
  - holds block Start, Do-this-first, Prepared and Planned, and the release of dependents;
  - a held reopen;
  - a timeout at 30 seconds, an authorized `GET` at 31 seconds and a server commit at 32 seconds: the `GET` leaves the target held, and a second write is refused. More generally, a read after 30 seconds and client disconnect leaves the target held while the server can still commit;
  - an acknowledged send followed by a failed readback keeps the `succeeded` receipt and the hold;
  - across a restart and a workspace switch, the originating partition keeps the receipt and the hold until authorized readback succeeds;
  - an ambiguous send keeps its uncertainty and never enables Undo;
  - An early or failed read leaves owner release unavailable. After a qualifying read, confirm the owner decision and verify normal Start, planning, dependency and prep rules, an `unknown` audit, no Undo, and refusal of a second write while the first can still commit.
  - an opt-out during claim persistence causes zero sends;
  - approval from a second registered window, and after navigation, causes zero sends;
  - IPC guard failures map into the declared result unions;
  - late results across a restart and a workspace switch land only in the originating partition;
  - a valid leaf task immediately before a sibling's subtree;
  - Undo is shown only when `undoAvailable`;
  - no `dangerouslySetInnerHTML` in Hub files.
- **Meetings:** the seventh-day boundary across Jerusalem DST; Needs prep membership (`none` + `planned`); Viewed independence; private rows show "Busy".
- **Matrix:** thresholds at the boundaries; without an override, unknown axes go to Needs details; an override places the card and keeps its measured facts; Waiting stays in place with its blocker; overrides persist through weight changes and Undo; permutation stability.
- **Timeline:** no span from effort alone; verified edges only; cycle edges suppressed; split-chunk attachment; clipping; the undated list and out-of-range count.
- **Weights:** validation; normalization; preview and save parity; out-of-order replies discarded; a stale save whose revision matches the new scope is rejected, and so is a save across two partitions with equal revisions; the 500-task benchmark under 20 ms per diff.
- **Hyper-Event:** the E6 tests, with user-visible behaviour unchanged.
- **Mirror:** idempotent per device; reconciliation after a restart; two non-Jira mirrors still match after a cache rebuild; the Undo fallback sends zero deletes; no excerpts copied.

## E11. Objection ledger

| Objection | Resolution |
| --- | --- |
| O-C1 Newsletter ships (Opus) | Adopted: E0 #2, E1.1, E1.5 |
| O-C2 Isolation not an M5 gate (Opus) | Adopted: E0 #1, E1.11 |
| O-C3 Resolution exception (Opus) | Adopted with S-C3's conditions: E0 #3, E1.5 |
| O-C4 Mirror in main (Opus) | Adopted: E0 #4, E7 |
| O-C5 Drop "Do first" (Opus) | Adopted with Sol's labels: E3 |
| O-C6 Hyper-Event keeps behaviour (Opus) | Adopted: E6 |
| A-C1, S-C1 Native, main-owned confirmation | Adopted: E1.4 |
| A-C2, S-C2 Renderer isolation gate | Overruled by the owner (E0 #1). Recorded honestly in E1.11 |
| A-C3 Newsletter preconditions, disclosure, no `delayed` mapping | Adopted: E1.4, E1.5, E1.8 |
| A-C4 Hyper-Event range subscription | Adopted: E6 |
| A-C5 Matrix trays, Timeline, Needs prep | Adopted: E2 and E4. For Waiting, S-C5's in-quadrant placement wins and the blocker stays visible |
| S-C3 Resolution to the editor | Settled by the owner's explicit approval (E0 #3), using S-C3's own conditions |
| S-C4 Timeline spans | Adopted: E4 |
| S-C5 Matrix placement and labels | Adopted: E3 |
| S-C6 Core-atomic mirror | Overruled by the owner (E0 #4). Astra's main-side design is in E7 |
| S-C7 Presets | Adopted: E5 |
| S-C8 Needs prep | Adopted: E2 |
| S-C9 Newsletter editor-only | Overruled by the owner (E0 #2). Sol's disclosure requirements are in E1.4 and E1.5 |
| Sol's "global transitions go to the editor" (proposal §1) | Not adopted. Global transitions are allowed, with the fresh status recheck and the race disclosed (E1.5). Sol accepted this at the m5-v1 sign-off. |

## Changes from m5-v1

Every required change from `08-m5-signoff-astra.md` (A1 to A9) and `08-m5-signoff-sol.md` is merged:

| Change | Where |
| --- | --- |
| The token is bound to the originating trusted document, window, partition, generation, principal, credential, revision and candidate (plus any Resolution). It is validated before the dialog and consumed synchronously. Approval from a second window or after navigation sends nothing. IPC guard failures are mapped into the result unions. | A1, Sol · E1.3, E1.4, E10 |
| The claim is persisted before the final source recheck. Document, expiry, scope, opt-in and credential are re-verified after the final await. | Sol · E1.5 |
| The residual race of global transitions is disclosed (`any-status-transition`). | Sol · E1.3, E1.4, E1.5 |
| The verified Jira principal, or "Configured Newsletter connection" with a bound fingerprint. Newsletter shows the project, task id and title. The observed-progress, normalization, rescheduling and roll-up disclosures are added. | A2, Sol · E1.3, E1.4, E1.6 |
| A conflict carries a fresh preview only while the target is still authorized; otherwise a rejection without details. A Jira 400/409 with unchanged inputs gives `rejected` and Open in Jira. Newsletter 401 shows the permission message. Leaf checking uses the complete ordered chart. Readback uses the project `GET`. | A3, Sol · E1.5 |
| Reverse previews resolve `operationId` in the current partition. Undo appears only when `undoAvailable`. The reverse send obeys E1.5. | A4, Sol · E1.3, E1.6 |
| The hold covers pending and unresolved-unknown writes and is separate from the audit. Receipt and observation are tracked separately. A read that may precede a late commit cannot clear the hold (the 30-second rule). Held targets refuse new writes. Late results stay in their originating partition. | A5, Sol · E1.6, E1.7 |
| Reverse lists only options to the exact previous status. | Sol · E1.8 |
| `save-weights` carries `scopeGeneration`. The diff includes the draft top ten and a movement count. | A6, Sol · E5, E10 |
| Mirror matching by durable origin key through the project source and index. No delete with the current core: Open in Hyper-Kanban instead. | A7, A8 · E7, E10 |
| The Hyper-Event poll-count assertions move to the shared-cache tests. | A9 · E6 |
| Matrix: an override places the card and keeps its measured facts; without one, an unknown axis goes to Needs details. | Sol · E3 |
| Timeline: edges need the actual endpoints in range. Astra projects paired schedule endpoints. | Sol · E4 |
| Meetings: `now` defaults to `asOf`, and empty days keep their coverage. Sol uses test-local fixtures. | Sol, non-blocking · E2, E9 |

## Changes from m5-v2

Every required change from `08-m5-signoff-astra-v2.md` and `08-m5-signoff-sol-v2.md` is merged:

| Change | Where |
| --- | --- |
| The hold now also covers an acknowledged write whose readback is outstanding or failed (it keeps its `succeeded` receipt). The fixed 30-second release is replaced: an ambiguous dispatch releases only on a read known to follow the request's completion (source evidence or a documented processing bound), and otherwise stays held across restart, with Check in <source>. | Astra 1 and 2, Sol · E1.7 |
| Undo requires an acknowledged send whose verified after-state shows the requested status. | Sol · E1.6 |
| The success toast uses the source name and the observed status, or "<source> accepted the update. Checking status." while readback is outstanding. Unknown and held badges use the write's own source label and open the matching source. | Astra 3, Sol · E1.10, E8 |
| Timeline edges use plan chunks, or the paired source interval when a row has none, and both endpoint bars must be visible after filtering. | Sol · E4 |
| New acceptance tests: the 30/31/32-second late commit; a failed readback; restart and workspace switch; an ambiguous send never enabling Undo; Matrix override placement. | Astra 4, Sol · E10 |
| **Added by the moderator.** An owner release, **I checked in <source>**. After the earliest reconciliation time and a fresh authorized read, the owner may release a hold. It is recorded as an owner decision, the audit stays `unknown`, Undo stays unavailable, and later reads apply normally. Without it, an ambiguous write to a source that offers no completion evidence (Newsletter, and Jira without changelog proof) would block that task indefinitely. | Opus · E1.7, E8, E10 |

## Changes from m5-v3

Sol's `08-m5-signoff-sol-v3.md` replacement text is adopted verbatim. It matches the clarification in Astra's `08-m5-signoff-astra-v3.md`:

| Change | Where |
| --- | --- |
| "Release only on" becomes "Automatically release only on". The owner release is rewritten: it shows the observed status and that the earlier update may still apply; main rechecks before recording the decision under the same operation id; normal source-authority rules then apply; further Hub writes stay `held` until a read is known to follow the ambiguous request's completion. | E1.7 |
| Source-neutral labels: "<source>: <observed status>", **Also update <source>…**, and "<key> changed in <source>…". | E1.9, E1.10 |
| The owner release is offered only while the E1.7 conditions are met. | E8 |
| Owner-release acceptance: an early or failed read leaves it unavailable; after a qualifying read, normal rules resume, the audit stays `unknown`, there is no Undo, and a second write is refused. | E10 |


## Changes from m5-v4

The E1.7 owner-release bullet, the second sentence of the E8 unknown bullet, and the E10 owner-release acceptance bullet are restored word for word from `08-m5-signoff-sol-v4.md`. There is no change in meaning.
