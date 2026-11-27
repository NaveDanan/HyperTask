AGREE v2

## Non-blocking notes

- A1 (D3.4, D6.1, D7.6). Timed blocks require complete coverage across enabled sources or an owner-declared window. A newer partial read can add busy time to an authorized complete snapshot. The resulting placement is provisional. An uncovered gap returns `no-coverage`.
- A2 (D3.2, D8.6, D9.6). Main validates the sender, schema and scope generation, resolves the target, and checks access and revision before acting. A scope change clears optimistic state and invalidates old replies. Summary checks run both before excerpts leave the device and before the reply is accepted.
- A3 (D4.7–D4.8, D12 M2). Hub Outlook operations check the expected store at execution, including detail reads and `mail.open`. The additive calendar read reports coverage and exhaustion. M2 checks both the disk cache and Focus for busy-time-only handling of private, confidential and unclassified events, and exercises a queued read across a profile switch.
- A4 (D4.1). The Jira query includes both assignee and reporter within the selected project and filter. It removes the filter's top-level ordering before applying one stable sort. Reported-only issues start in Waiting. Issues that leave the query follow D3.4 reconciliation.
- A5 (D4.5, D9.9, D12 M3–M4). Scope selection precedes import. M3 requires mailbox opt-in, folder selection and retention confirmation before scanning. The precision gate governs suggestions within that scope. M4 requires AI consent and excerpt selection for each brief sent for summary.
- A6 (D8.4, D12 M4). The M4 adapter resolves owner-selected or explicitly linked articles by connection and article ID, checks access and can cite a summary excerpt. Authorship alone creates no task.

Sol's changes fit the ingestion contract. D5 keeps verified mirrors distinct from evidence links, and D8 groups mail by connection, store and verified thread ID. D11 gives Astra the adapters, IPC and snapshot client, Sol the selectors, and Opus the rendering files. D12 keeps each dependency in place for its first consumer, from Jira and native mirrors in M1 through verified meeting briefs in M4.
