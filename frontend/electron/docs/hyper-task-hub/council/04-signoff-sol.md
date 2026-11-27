OBJECT v1

1. **D6.1–D6.2 and D9.5. Make score and displayed reasons reconcile.**

   Replace this text.

   ```markdown
   1. **Score** = `round(100 × Σ wᵢ·xᵢ / Σ wᵢ, 2)`. The denominator is fixed. Unknown signals contribute 0 and are reported as unknown. Negative, non-finite or all-zero weight settings are rejected.
   ```

   With this text.

   ```markdown
   1. **Score** = `round(Σ pointsᵢ, 2)`, where `pointsᵢ = 100 × (wᵢ / Σ wᵢ) × xᵢ`. Sum in the table order and round the total once. The denominator covers all configured weights for every task. Unknown inputs contribute 0 and are reported as unknown. Reject negative, non-finite and all-zero weights. Divide all weights by their largest value before normalizing so valid finite weights cannot overflow the sum. `clamp` limits inputs to `[0, 1]`.
   ```

   Replace this text.

   ```markdown
      Pins and feasibility are reported separately, so the "Why?" panel adds up to the score exactly. (Opus R2 C6, Astra R2 C5)
   ```

   With this text.

   ```markdown
      Pins and feasibility are reported separately. Keep raw points in the reason payload and reconcile the display to the rounded score. (Opus R2 C6, Astra R2 C5)
   ```

   Replace this text.

   ```markdown
   5. **"Why?" popover.** Signed contributions that add up to the score, unknown signals, overrides ("Moved by you"), and the placement reason in words. Text is built from codes and facts.
   ```

   With this text.

   ```markdown
   5. **"Why?" popover.** Show signed contributions, unknown signals, overrides ("Moved by you"), and the placement reason in words. If individually rounded contributions do not sum to the displayed score, show the difference as a display-only rounding adjustment. Text is built from codes and facts.
   ```

   **Reason.** Raw points of `42.1875 + 8.25` sum to `50.4375`, which displays as `50.44`, and individually rounded reasons can also differ from the rounded total.

2. **D6.1, D6.3 and D7.6. Require covered time for slack and placement.**

   Replace this text.

   ```markdown
      | Slack (urgency) | 45 | `clamp(1 − slackMinutes / 480)`. Slack = free working minutes before the confirmed due or prep deadline, minus estimated effort. Unknown when availability coverage is missing. Overdue saturates at 1. |
   ```

   With this text.

   ```markdown
      | Slack (urgency) | 45 | `clamp(1 − slackMinutes / 480)`. Slack = free working minutes between the supplied clock and the earliest confirmed due or prep deadline, minus a known effort estimate. A confirmed deadline at or before the clock gives urgency 1. Otherwise, missing deadlines, missing effort, or uncovered working windows before the deadline make slack unknown. Label slack derived from a stale complete snapshot or owner-declared availability as provisional. |
   ```

   Replace this text.

   ```markdown
   3. **Unknown effort** uses a provisional 45-minute planning estimate. It is labelled "~45 min (estimate)" wherever it shows, can be edited inline, and contributes no score. After the owner has recorded at least 5 actual durations in a category, the median of the latest 10 is offered as that category's default.
   ```

   With this text.

   ```markdown
   3. **Unknown effort** uses a provisional 45-minute estimate for placement and effective-due propagation. It is labelled "~45 min (estimate)" wherever it shows and can be edited inline. Slack remains unknown until an effort estimate is recorded or the deadline is reached. After the owner has recorded at least 5 actual durations in a category, the median of the latest 10 is offered as that category's default.
   ```

   Replace this text.

   ```markdown
      - Availability older than 30 minutes, or partial, marks the plan **provisional** and labels it so.
      - With no availability, Focus shows the ranked list and asks for manual availability ("I'm free 09:00–12:00") before it proposes times.
   ```

   With this text.

   ```markdown
      - Offer times only inside intervals with complete coverage from every enabled availability source, or inside an explicit owner-declared availability window. A still-authorized last complete snapshot can cover an interval provisionally when it is older than 30 minutes or a newer refresh is partial. New busy intervals can narrow that coverage. A partial result alone establishes no free time.
      - Label stale or owner-declared plans **provisional**. Subtract known busy intervals from owner-declared availability. Where coverage is missing, show ranked work and ask for a manual window ("I'm free 09:00–12:00"). Return `no-coverage` for a placement the missing coverage prevents.
   ```

   **Reason.** A capped Outlook response can omit an appointment, and a day-only cache cannot establish how much time is free before a later deadline. [Outlook scan](../../../src/main/HyperOutlookScript.ts#L596)

3. **D2, D7.2 and D7.4. Keep forecast placements distinct from actual readiness.**

   Replace this text.

   ```markdown
   - **Planner eligibility** is derived from the personal state, source completion, snooze or release time, and verified predecessors.
   - **"Done for me"** clears the owner's queue. A successor stays blocked until the system that owns its predecessor completes it, or until the owner explicitly resolves the dependency.
   ```

   With this text.

   ```markdown
   - **Planner eligibility** starts with the owner's open `ready` or `doing` work. Apply source completion, release and snooze times, and the verified predecessor graph. A task with an unresolved predecessor can remain visible with a blocker. Triage and Waiting consume no planned capacity.
   - **"Done for me"** clears the owner's queue. A successor requires completion from the predecessor's authoritative system (the Hub for a local action), or explicit resolution of the edge by the owner.
   ```

   Replace this text.

   ```markdown
      - **Score-first pass:** pins, then the explicit Focus order, then descending score.
      - **Due-first pass:** pins, then the explicit Focus order, then effective due. Effective due is the task's own due, pulled earlier by the effective due of each successor minus that successor's effort.

      Both passes enforce finish-to-start edges and contiguous fits. A pass never splits a task without an explicit chunk size. Ties break by own due, then Hub id.
   ```

   With this text.

   ```markdown
      - **Score-first pass:** pins, then the explicit Focus order, then descending score.
      - **Due-first pass:** pins, then the explicit Focus order, then ascending effective due. Over the valid, unfinished graph, compute effective due backward as the minimum of the task's own deadline and each successor's effective due minus that successor's planning effort. Missing deadlines sort last. For either pass, break remaining ties by own due, then Hub id in code-unit order.

      In each pass, queue tasks whose unfinished predecessors have valid forecast placements, starting with roots. Place each at its earliest contiguous fit after its release time and every predecessor finish. Put missing or unplaceable predecessors in the blocker facts and report cycles. Validate a fixed task block against the current work windows, release, busy intervals, other fixed reservations and predecessor finishes before it counts as a placement. Keep conflicting reservations visible with `fixed-conflict` and exclude them from forecasts and suggested starts. Split only with an explicit positive chunk size. A split predecessor supplies a forecast finish only after its final chunk is placed.
   ```

   Replace this text.

   ```markdown
   4. **"Do this first"** is the earliest feasible block whose prerequisites are actually met: state `start-now`, or `start-later` with its start time. Starting requires actual readiness, not a forecast. If nothing fits, the reasons are returned: `waiting`, `cycle`, `no-window`, `fixed-conflict` or `no-coverage`.
   ```

   With this text.

   ```markdown
   4. **"Do this first"** is the earliest feasible block for an actually ready task. Report `start-now` if its start is the supplied clock, or `start-later` with its start time. Recheck actual readiness when Start is invoked. A planned predecessor finish can unblock a forecast only. Return blocker facts with `waiting`, `cycle`, `no-window`, `fixed-conflict` or `no-coverage` when a task cannot be recommended.
   ```

   **Reason.** A high-ranked successor can depend on a lower-ranked predecessor, and a fixed block can become invalid after a new calendar sync.

4. **D7.3 and D12 M2. Define the objective and require a fixture that exercises it.**

   Replace this text.

   ```markdown
   3. **Choosing a pass.** Compare the two lexicographically:
      1. weighted on-time work (Σ `1 + score`) for deadlines due in the rest of the workday;
      2. total placed value;
      3. pass order (score-first wins a tie).
   ```

   With this text.

   ```markdown
   3. **Choosing a pass.** Compare these values lexicographically:
      1. Sum `100 + scoreInCents` for fully placed tasks that finish by a confirmed deadline due in the remainder of the owner's civil day. Include a civil due date whose end boundary is the end of today, even after the last work window. Overdue tasks remain eligible and show a late reason.
      2. Sum `100 + scoreInCents` once per fully placed task, regardless of deadline. Use the integer hundredths of a point from D6 in both sums.
      3. Prefer score-first when both sums tie.
   ```

   Replace this text.

   ```markdown
   Sol's renewal-before-meeting example passes.
   ```

   With this text.

   ```markdown
   A new 30-minute renewal with lowest owner importance, no successors and a 10:00 deadline scores 42.19. A 45-minute checklist with highest owner importance, two open successors without deadlines, age at least 28 days, and a later deadline with at least 525 covered free working minutes scores 43.00. Given 09:00–10:00 free, a 10:00–11:00 meeting and a later free window, score-first misses the renewal deadline and due-first places it at 09:00. Due-first wins and supplies the first recommendation. Also test a civil-date deadline after the last working window and a tie with shuffled inputs.
   ```

   **Reason.** Calendar-day deadlines can fall after working hours, floating-point totals can break mathematical ties, and the R1 fixture scores can let both passes pick the renewal first under D6.

5. **D4.7, D8.1, D8.5 and D12 M2/M4. Gate briefing on verified meeting identity and privacy.**

   Replace this text.

   ```markdown
      - calendar coverage metadata;
   ```

   With this text.

   ```markdown
      - a calendar read with coverage metadata and sensitivity classification at availability ingest. For M4, include the store-scoped occurrence key with original start, a verified series key where available, and a distinction between appointments and accepted or owner-organized meetings.
   ```

   Replace this text.

   ```markdown
   1. **Eligibility.** Briefs cover accepted or owner-organized meetings that are not private, cancelled or declined.
      - Briefs are built on demand and pre-warmed within 24 hours.
      - A brief is invalidated when its occurrence moves, is cancelled, or its evidence changes, and is refreshed 30 minutes before start.
      - The occurrence is verified before evidence attaches. A series id alone never identifies a session.
   ```

   With this text.

   ```markdown
   1. **Eligibility.** Brief only verified accepted or owner-organized meetings. Exclude plain appointments, private or confidential items, items with unknown sensitivity, cancelled and declined meetings, and occurrences that the current scope cannot access. Private, confidential and unclassified items contribute applicable busy intervals only.
      - Briefs are built on demand and pre-warmed within 24 hours.
      - A brief is invalidated when its occurrence moves, is cancelled, loses eligibility or its evidence changes, and is refreshed 30 minutes before start.
      - Verify the store-scoped occurrence including original start before attaching evidence. Use verified series keys to select history for an already verified occurrence.
   ```

   Replace this text.

   ```markdown
   5. **Readiness** has three states, plus a separate Viewed marker:
      - *none*: related open items exist;
      - *planned*: a prep block is scheduled;
      - *prepared*: prep tasks are done or the owner confirmed it.
   ```

   With this text.

   ```markdown
   5. **Readiness** is computed in this order, with a separate Viewed marker:
      - *prepared* if the owner confirmed it or at least one explicit prep task exists and all such tasks are complete;
      - *planned* if there is a valid scheduled prep block;
      - *none* otherwise.
   ```

   Replace this text.

   ```markdown
   Outlook availability cache with coverage metadata, the native calendar source
   ```

   With this text.

   ```markdown
   Outlook availability cache with coverage metadata and private, confidential and unclassified events reduced to busy intervals before caching or projection, the native calendar source
   ```

   Replace this text.

   ```markdown
   No overlapping blocks.
   ```

   With this text.

   ```markdown
   No overlapping blocks. Private, confidential and unclassified Outlook events expose only applicable busy intervals in the cache and Focus.
   ```

   Replace this text.

   ```markdown
   `HyperMeetingBrief`, privacy filters, the brief sheet
   ```

   With this text.

   ```markdown
   `HyperMeetingBrief`, verified occurrence and series joins, the brief sheet
   ```

   **Reason.** Focus ingests Outlook in M2, but the current mapper masks only sensitivity 2 and treats plain appointments as organizer-owned. [Outlook mapper](../../../src/main/HyperOutlookScript.ts#L52)

6. **D8.2. Make evidence admission and thread caps deterministic.**

   Replace this text.

   ```markdown
   2. **Evidence order.**

      | Order | Evidence | Points |
      | --- | --- | ---: |
      | 1 | Manually linked evidence | (always first) |
      | 2 | Exact Jira key or trusted document link | +60 |
      | 3 | Verified series history, up to 2 prior occurrences | +35 |
      | 4 | Two distinctive subject terms (English or Hebrew tokens) | +20 |
      | 5 | Matching attendee or organizer identity | +15 |
      | 6 | Under 7 days old | +5 |

      - Mail needs a shared project or topic match. Attendee overlap alone is not enough.
      - At most 5 threads, grouped by thread.
      - Attendee-only open work appears in its own short "Open with attendees" list of at most 3.
      - Prior decisions appear only with a verified series and a cited excerpt.
   ```

   With this text.

   ```markdown
   2. **Evidence order.** Admit evidence with an authorized manual link, an exact scoped Jira key or trusted document link, verified series history, or a shared project or topic match. Require the shared project or topic match for automatic mail candidates. Use verified identities for attendee and organizer matching.

      | Evidence | Points |
      | --- | ---: |
      | Manually linked evidence | always first |
      | Exact scoped Jira key or trusted document link | +60 |
      | Verified series history, up to 2 prior occurrences | +35 |
      | Two distinctive subject terms (English or Hebrew tokens) | +20 |
      | Matching verified attendee or organizer identity | +15 |
      | Under 7 days old at the supplied clock | +5 |

      - Add each applicable signal once. Order by manual link, then descending total, descending source time and ascending scoped evidence id in code-unit order.
      - Group by connection, store and verified thread id. Use the individual scoped message id when thread identity is unknown. Rank groups by their best candidate and take at most 5.
      - Attendee-only open work appears in its own short "Open with attendees" list of at most 3, using the same tie-breaks within that list.
      - Prior decisions appear only with a verified series and a cited excerpt.
   ```

   **Reason.** Five equal-score records and a sixth equal candidate need stable selection, and organizer display text or an empty attendee SMTP value cannot establish identity. [Outlook mapper](../../../src/main/HyperOutlookScript.ts#L60)

7. **D3.2, D8.6 and D9.6. Apply eligibility and scope changes immediately.**

   Replace this text.

   ```markdown
      - The renderer never chooses a partition.
   ```

   With this text.

   ```markdown
      - Main validates the sender and request schema on every Hub IPC call. It resolves the partition and typed open targets from the active scope and verifies the target and applicable snapshot revision before accepting feedback, starting work or opening a source. The renderer clears the old projection, pending orders and optimistic actions on a scope change.
   ```

   Replace this text.

   ```markdown
   6. **Stability.** A list never reorders under the cursor. While the owner is interacting, a "New order (N moved) · Apply" pill waits; it applies after 10 idle seconds or on the next visit. An `aria-live="polite"` region announces "Order updated, N moved".
   ```

   With this text.

   ```markdown
   6. **Stability.** Defer list order changes during pointer or keyboard interaction. Show "New order (N moved) · Apply" and apply the pending order on request, after 10 idle seconds when the user is clear of the list, or on the next visit. Reflect revocation, scope changes and loss of Start eligibility immediately, including on the first card and HyperHome. Discard pending order and feedback from an obsolete scope or snapshot. Announce "Order updated, N moved" in an `aria-live="polite"` region.
   ```

   Replace this text.

   ```markdown
   6. **Optional "Summarize"** is an explicit per-brief action. It sends selected excerpts and ids only, as `{ source, untrusted_data }`, with zero tools, a validated schema and checked citations. The output is labelled "AI summary". On any failure it falls back to the deterministic brief. Owner opt-in is required.
   ```

   With this text.

   ```markdown
   6. **Optional "Summarize"** is an explicit per-brief action. It sends selected excerpts and ids only, as `{ source, untrusted_data }`, with zero tools, a validated schema and checked citations. Require owner opt-in and verify the active scope, occurrence and selected evidence revisions immediately before sending and again before accepting the reply. Discard a reply after access loss or scope change. Label accepted output "AI summary". On failure, show the deterministic brief if it remains authorized.
   ```

   **Reason.** A deferred sort can preserve positions, but stale Start controls or revoked source records would violate actual readiness and account isolation. [Existing trusted Outlook IPC](../../../src/main/HyperOutlookIpc.ts#L7)

8. **D4.5. Preserve mailbox opt-in after the precision gate.**

   Replace this text.

   ```markdown
   5. **Mail scanning is opt-in** and labelled "Suggestions (preview)". It becomes default-on per language cohort only after reviewed precision reaches at least 90% on that cohort's fixtures and pilot labels.
   ```

   With this text.

   ```markdown
   5. **Mail scanning is opt-in** per connection and selected folder scope. Until reviewed precision reaches at least 90% on a language cohort's fixtures and pilot labels, show "Suggestions (preview)". After the gate passes, setup may recommend enabling suggestions for that cohort. Scanning begins only after the owner confirms the scope and mail retention policy.
   ```

   **Reason.** Extraction precision qualifies a cohort for rollout and does not grant permission to scan or retain a mailbox.

## Non-blocking sign-off notes

- I approve the D6.1 Jira priority fallback. Treat it as one mapped source value for the same importance signal, with Jira provenance and no write into the owner's priority. An explicit owner value of zero wins. Missing or unmapped source priorities stay unknown. Jira search already requests `priority`, but the dashboard model keeps only its name. The Hub's main adapter can preserve the identifier from the raw field for a per-connection map. It should also preserve raw `duedate` as a civil date in its configured source zone. [Jira issue decoder](../../../src/renderer/features/jira/data/models/jira-issue.ts#L71)
- D7.8 is workable as written. Benchmark ranking and both passes on the same immutable 500-task fixture, with edges, calendar gaps and fixed blocks. Record ranking, planning, IPC and drag response separately. This is a target. Worker adoption follows profiling.
- D9 fits the available ReUI hooks. Use the Board move callback with stable visible card ids, keeping overflow reachable. The Hub calendar needs its own local block handler because the existing database calendar invokes Outlook updates. Define Matrix override fields when M5 lands and keep each named and undoable. Use a valid source deadline when computing slack after a Matrix edit. [Kanban moves](../../../src/renderer/components/reui/kanban.tsx#L506) · [Calendar update handler](../../../src/renderer/features/hyper-database/views/HyperCalendarView.tsx#L75)
- D11 is workable. I accept Astra owning the client and store and will take typed snapshots from that contract for the pure selectors and English/Hebrew reason templates. Opus owns rendering. M1 can integrate Board against fixture snapshots, M2 adds Focus and the Home action, M3 adds the Triage link, and M4 adds the meeting link and readiness when the brief target works. M4 can prove the local brief before integrating the optional summary.
- R2 C1–C4 are covered by D1–D3 and D7.8. D11 provides the projection and source handles. C5–C6 are covered by D6–D7 once items 1–4 and 7 are resolved. C7 and C8 are covered by D4–D5 with item 8 for durable consent. C9 is covered by D8 with items 5–6. C10 is covered by D9 and D12. C11 is covered by D3 and D11 with item 7. C12 is covered by the D12 milestone order. I accept the D11 file split as the resolution of C13.
- The R2 draft decisions on identity and ledger, scoped import and confirmed merges, ranking and planning, first action, cited briefs, first-release views and source-editor actions, and file ownership map to D1–D12 as above. The spec preamble keeps the same-version sign-off gate.
