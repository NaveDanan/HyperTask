AGREE v2

## Non-blocking notes

- **S1 (D6.1–D6.2, D9.5).** The engine normalizes weights safely, uses a fixed denominator, sums raw points in table order and rounds the total once. The reason payload keeps raw points, and a display-only adjustment reconciles the individually rounded contributions with the score.
- **S2 (D6.1, D6.3, D7.6).** Slack before a deadline requires known effort and covered working time. A reached deadline sets urgency to 1. The 45-minute estimate applies to placement and effective-due propagation. Free time requires complete coverage or an explicit owner window. Stale or partially refreshed coverage can support a provisional plan while the underlying complete read remains authorized. Owner windows are provisional and exclude known busy time.
- **S3 (D2, D7.2, D7.4).** Planning starts with open `ready` or `doing` work. Both passes enforce finish-to-start edges and report missing or unplaceable predecessors and cycles. Fixed placements count only after validation against work windows, release time, busy intervals, other reservations and predecessor finishes. A split counts once its final chunk is placed. Forecasts can unlock later placements. Start rechecks actual readiness, and source-owned prerequisites still require authoritative completion or explicit edge resolution.
- **S4 (D7.3, D12 M2).** Both objective sums use integer hundredths and count each fully placed task once. The first sum includes a civil deadline at the end of today, even after working hours. The second counts all fully placed work. Score-first wins an exact tie. M2 tests both the civil boundary and shuffled-input ties.
- **S5 (D4.7–D4.8, D8.1, D8.5, D12 M2/M4).** M2 reduces private, confidential and unclassified events to applicable busy time before caching or projection. M4 briefs require an accessible, verified accepted or owner-organized occurrence, including its original start. A verified series key selects history only after occurrence verification. Readiness checks prepared first, then a valid prep block, and tracks Viewed separately.
- **S6 (D8.2).** Evidence admission precedes scoring, automatic mail requires a shared project or topic, and identity matches require verification. Manual links, points, source time and scoped id give a stable order. The five-thread cap uses connection, store and verified thread id, with a scoped message fallback. Attendee-only work has its own three-item cap.
- **S7 (D3.2, D8.6, D9.6).** The merged IPC rules cover sender, schema, scope generation, target, access and revision. Scope changes clear pending renderer state. Revocation and lost Start eligibility take effect immediately, including on HyperHome. Summary requests recheck scope, occurrence and evidence before sending excerpts and before accepting replies.
- **S8 (D4.5, D9.9).** M3 requires scope and retention confirmation before scanning. After the 90% precision gate, a cohort's suggestions may default on within the owner-approved connection and folders.

### Ranking and planner check

For a reproducible M2 fixture, set the clock to 09:00 and use fully covered free windows of 09:00–10:00 and 11:00–19:00. Set the checklist deadline to 18:45 that day. Both tasks are ready and released, with no pins or explicit order. The renewal has `60 − 30 = 30` minutes of slack and scores `45 × 0.9375 = 42.1875`, displayed as `42.19`. The checklist has `525 − 45 = 480` minutes of slack and scores `0 + 25 + 8 + 10 = 43.00`.

With no successor deadlines to pull the checklist's effective due forward, score-first places the checklist at 09:00 and the renewal at 11:00. Due-first places the renewal at 09:00 and the checklist at 11:00. The on-time sums are `4400` and `8719` respectively. Due-first wins on the first objective and returns `start-now` for the renewal.

### Ingestion and ownership check

A1–A3 provide the covered, scoped snapshots and verified Outlook inputs that ranking, planning and briefs need. A4 puts reported-only Jira items in Waiting, outside planned capacity. A5 gates scanning and summaries at first use. A6 supplies accessible Newsletter article context through the adapter and the D8 evidence rules. D11 keeps `HyperPriorityEngine.ts`, `HyperDayPlanner.ts`, `HyperMeetingBrief.ts`, `HyperTaskHubSelectors.ts`, `HyperTaskHubReasons.ts`, fixtures and benchmarks with Sol. Astra owns the contract and data layer, and Opus owns rendering.
