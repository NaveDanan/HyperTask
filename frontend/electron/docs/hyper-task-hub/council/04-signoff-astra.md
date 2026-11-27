OBJECT v1

1. D7.6, coverage for timed recommendations

   Replace this text

   > Availability older than 30 minutes, or partial, marks the plan **provisional** and labels it so.

   With this text

   > Place a timed block only inside an interval covered by a complete availability read for every selected calendar, or inside an interval the owner explicitly marks available. Keep known busy intervals from newer partial reads. A previously complete interval older than 30 minutes, or refreshed only in part, can support a provisional block. Return `no-coverage` for gaps without either basis.

   Reason. D3.4 and all three reviews say a capped scan cannot prove free time. Calling an unseen gap provisional would still let Focus recommend working through an unseen meeting.

2. D3.2, scope checks at IPC

   Replace this text

   > The renderer never chooses a partition.

   With this text

   > Main derives the active partition and validates the trusted sender and request schema for every Hub IPC call. Bind renderer requests to the active scope generation. For feedback, check the target and expected revision before appending to the ledger. For open-source and summary requests, resolve opaque evidence handles in main and check current access to the target before opening it or sending excerpts. On a scope change, clear renderer projections and reject late snapshots, acknowledgements and summary replies from the old generation.

   Reason. Read-side commit checks cannot stop an old window action from changing the new ledger or opening material from a previous profile. `HyperOutlookIpc.ts` already checks the sender and schema.

3. D4.7 and D12 M2, Outlook availability and source identity

   Replace this text

   > calendar coverage metadata;

   With this text

   > an additive, store-bound calendar read in M2 that reports interval coverage and exhaustion. Apply D4.8 at the bridge before caching or projecting any event. For private, confidential or unclassifiable sensitivity return only the information needed to reserve time. Verify the expected store at execution for Hub calendar and mail operations, including detail reads and `mail.open`. Test a profile switch with a request queued, and a confidential event in the M2 disk cache and Focus snapshot. Preserve the existing calendar list response for its callers;

   Reason. `Hyper-Map` treats only sensitivity 2 as private, and `Hyper-MailResolve` looks in the current default store. An M4 brief filter is too late for the M2 cache, and a captured Hub generation alone cannot identify the store that COM actually read.

4. D4.1, assigned and reported Jira issues

   Replace this text

   > Jira issues assigned to the owner: `project = "<KEY>" AND assignee = currentUser() AND statusCategory != Done ORDER BY updated ASC, key ASC`, with any configured filter parenthesized first. "Reported by me" goes to Waiting.

   With this text

   > For each selected Jira project, combine its project constraint and the configured filter predicate with `statusCategory != Done AND (assignee = currentUser() OR reporter = currentUser())`. Remove any top-level ordering from the configured filter before wrapping its predicate, then apply `ORDER BY updated ASC, key ASC` once. Import assigned issues as owned work. Initially place reported-only issues in Waiting. A record that leaves the query follows D3.4 reconciliation.

   Reason. The specified query cannot return reported-only issues, and a saved custom JQL with its own `ORDER BY` cannot be nested as written. The dashboard already separates its filter from ordering in `jira-repository.ts`.

5. D9.9 and D4.5, consent at the first milestone that uses it

   Replace this text

   > A "Task Hub" page in the Settings dialog, built with `components/app/settings-layout.tsx`, adds mail opt-in, retention, AI summary opt-in, and weights with a live preview (M5).

   With this text

   > Collect source scope choices before the first import. In M3 expose mailbox opt-in, folder selection and retention before scanning. The D4.5 precision gate may enable suggestions by default within a mailbox the owner has opted in to scan. In M4 collect AI consent before the first summary and require the per-brief excerpt selection in D8.6. The M5 Settings page uses `components/app/settings-layout.tsx` to edit these choices and adds weights with a live preview.

   Reason. M3 and M4 depend on owner choices that v1 first assigns to M5. Cohort precision measures suggestion quality and conveys no permission to read a mailbox.

6. D8.4, Newsletter evidence in the M4 brief

   Replace this text

   > Newsletter projects.

   With this text

   > Newsletter projects and owner-selected or explicitly linked Newsletter articles accessible through the configured connection. The M4 Newsletter adapter resolves articles by connection and article ID and can cite a summary excerpt as context. Article authorship alone creates no task.

   Reason. Astra R2 C12 explicitly calls for article context. D1 counts articles as evidence, but the v1 resolver and milestones cover only projects and Gantt tasks. `HyperBotsNewsletterTools.ts` already exposes article reads independent of Gantt.

## Non-blocking notes

- D11's file split and the M1 Jira/mirror gate are workable. I accept the stored workflow names, the four-signal pilot with its labelled Jira importance fallback, and Sol's selector ownership. In M2 the Home bar can expose the working Focus destination and add Triage and brief links as those destinations ship.
- Apply D3.1 encryption to the ledger, temporary files and journals as well as the observation cache. `HyperNewsletterConnection.ts` already checks for the Linux `basic_text` fallback. An opaque durable observation-to-action mapping keeps pins and dismissals attached to the same UUID after cache rebuild.
