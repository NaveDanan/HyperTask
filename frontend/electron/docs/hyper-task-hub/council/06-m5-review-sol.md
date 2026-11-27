# HyperTaskHub M5 cross-review · Sol

## Agreements

Keep personal Board state and the exact source status visible together. A drop records a local decision. Opus's optional toast action can open a preview for one source, including on a merged card. Writes start disabled per source and use the configured user's identity. Keep a durable per-item ledger and recheck live after confirmation. A timeout is unknown and never replayed. Undo requires a verified after-version, an available reverse action and a fresh approval. Pending and unknown writes keep the last observed status visible and suspend execution eligibility and completion-dependent planning until readback settles the state.

Keep the shared Outlook cache range-based. Hyper-Event requests its visible range under its own authorization. The Meetings index stops at midnight after the seventh owner-zone date, counting today. List verified occurrences by day, keep Viewed independent of readiness, and open the existing brief sheet.

## Objections

**S-C1 · blocking.** Replace Opus's renderer-callable `executeWrite` with an approval request that opens a main-owned, window-modal native confirmation. Keep the in-app picker and preview. Main binds a single-use, expiring preview to one sender document, scope, credential, target revision and exact choice. The native dialog defaults to Cancel and displays the account, target, version and before/after values from that binding. Main alone consumes the native response, rechecks and dispatches. A test of which component imports an IPC call cannot enforce user approval.

**S-C2 · blocking.** Require Astra's isolation gate across Hub documents that display source content before releasing write-back. Use a sandboxed document on a distinct origin with a minimal preload, restricted navigation and egress, and main-side sender allowlists on the legacy credential, generic core and Bots decision channels. Verify the boundary for embedded Hub entry points as well as the full page. The current credential IPC returns the saved Jira value to the shared renderer. If a host still exposes an alternate credential or write path, use source-editor links there. A whole-app guarantee requires a separate migration. [Preload](../../../src/preload/index.ts#L246), [credential handler](../../../src/main/settings-ipc.ts#L27).

**S-C3 · blocking.** Route transitions requiring Resolution to Jira with the field named in the reason. Opus's single select over `allowedValues` constrains input, but still edits a second field under A1. A future exception needs explicit scope approval, one main-bound resolution ID from live transition metadata, native preview of the exact field change, and a fresh check of that ID before send.

**S-C4 · blocking.** Draw Timeline bars for actual plan chunks and verified source schedule intervals. Show a lone planned start or due date as a marker, and effort as row text. A planned start plus a deadline can describe a window with no booked work. An effort-length bar ending at the deadline would imply a scheduled slot. Attach verified arrows to visible interval endpoints, mark cycles, and suppress edges internal to a cycle.

**S-C5 · blocking.** Keep Waiting and blocked cards with known axes in their Matrix quadrants, with their blocker and ineligibility visible. Put a card with either automatic axis unknown in one Needs details tray, showing the axis we do know. A named override can place it manually and Undo restores its prior placement. Use D6 urgency ≥ .50 and importance ≥ .67. Change “Do first” to “Urgent and important.” “Schedule,” “Fit in” and “Later” can be captions if the axes stay explicit and the captions confer no action eligibility.

**S-C6 · blocking.** Replace bare mirror feedback with an explicit preview of destination, audience, title and source link, followed by a source/workspace access recheck. Make create-or-find atomic at the core row boundary. The same operation commits the board-scoped origin key and approved cells, with uniqueness across clients. Board initialization and the encrypted Hub journal can commit separately. Reconcile lost acknowledgments by key, and allow Undo only for the row the operation created at its saved revision. The current wrapper serializes board creation. [General Kanban wrapper](../../../src/main/HyperGeneralKanbanCore.ts#L9).

**S-C7 · non-blocking.** Ship Balanced `45/25/20/10`, Deadline first `65/20/10/5` and Unblock others `30/20/45/5` in slack, importance, unblocking and age order. Defer Importance first until we have a representative fixture. Reset loads Balanced into the draft. Preview saved and draft weights against one frozen, versioned input and retain score-only changes in the diff. Save applies the draft and recomputes the plan.

**S-C8 · non-blocking.** Include both `none` and `planned` in Needs prep. An upcoming prep block still leaves work to do. Listing preserves Viewed, and partial coverage stays visible.

**S-C9 · blocking.** Keep Newsletter status in the source editor on the inspected server. Enable Hub writes only when the deployed status endpoint checks the expected revision in its transaction and preserves unrelated data, with any approved derived changes in the preview.

## Concessions

I accept Opus's in-app preview, toast offer, 150 ms debounce and four-week default, plus Astra's separate observed-status and write-outcome projections. I withdraw the requirement for a separate Newsletter capability endpoint if the deployment can establish write entitlement for the configured credential and the status route checks the user's current project access. A successful GET establishes read access. I drop Waiting-to-`delayed` in both directions. Show “Delayed” as a source schedule fact and keep Waiting a personal decision. Preserve the pending, in-progress and completed mappings, using status as the completion signal.

## Newsletter decision

I inspected Newsletter commit `fc583e3`. The dedicated task status route accepts `{ status }`, loads the current Gantt inside a transaction, and sets the target's progress to 100 on completion. Expiry, current manager access, token write access and the route allowlist are enforced. The transaction checks project access as well. An admin-role user, the creator or an explicitly allowed user passes that project check. A 401 or 403 means “You don't have permission.” [Token middleware](D:/Projects/Newsletter/pb_hooks/lib/access-tokens.js#L69), [project access](D:/Projects/Newsletter/pb_hooks/lib/api-manager.js#L551), [status handler](D:/Projects/Newsletter/pb_hooks/lib/api-manager.js#L1158).

The transaction avoids overwriting sibling edits with an old client copy. Its save path still normalizes every task, cleans references, reruns scheduling and rolls up parents. In a fixture using those functions, completing a sole child also changed its parent to completed at 100%. A direct write to a parent can be recomputed from its descendants. Normalization dropped an unknown sibling field. The progress PATCH uses the same save path and also lacks an expected revision check. Its ability to send progress is outside A1. [Normalization](D:/Projects/Newsletter/pb_hooks/lib/api-manager.js#L237), [parent roll-up](D:/Projects/Newsletter/pb_hooks/lib/api-manager.js#L382), [transaction and save path](D:/Projects/Newsletter/pb_hooks/lib/api-manager.js#L1011), [progress handler](D:/Projects/Newsletter/pb_hooks/lib/api-manager.js#L1230).

A fresh by-ID read of project `updated` and task status/progress detects changes up to that read. The remaining gap is the same class as Jira's read-then-POST race. Jira still evaluates whether the approved workflow transition is valid at receipt. Newsletter applies the submitted enum to whichever status it finds. The read plus PATCH misses D10's expected chart revision check and cannot guarantee the scope of the approved change. Revisit with an authorized conditional task patch that preserves unrelated fields. Preview the forced 100% on completion. A status reversal may leave progress at 100%, so describe the supported reverse action exactly.

## Open questions for the product owner

For a future guarded Newsletter route, may a preview include automatic parent status and progress roll-ups? Should a required Jira Resolution ever be an explicitly approved exception to status-only scope?
