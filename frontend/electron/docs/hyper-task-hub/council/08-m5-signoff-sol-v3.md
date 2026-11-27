OBJECT m5-v3

E1.7. Replace “Release only on” with “Automatically release only on”. Replace the owner-release bullet with:

> **Owner release.** Offer **I checked in <source>** for a held ambiguous dispatch only after the earliest reconciliation time and a fresh authorized read of its target. Show the observed status and explain that the earlier update may still apply. Main rechecks scope, connection, authorization and observation before recording the owner's explicit confirmation under the same operation id. Release the hold for Start, planning, dependency release and prep. Recompute from the observation under normal source authority and eligibility rules. Apply later reads normally. The audit stays `unknown` and Undo stays unavailable. Refuse further Hub writes to that target with `held` until an authorized read is known to follow completion of the ambiguous request.

E1.9. Replace `Jira: In Review` with `<source>: <observed status>` and **Also update Jira…** with **Also update <source>…**.

E1.10. Replace the conflict alert with “<key> changed in <source> since you opened this. It's now <status>.”

E8. Replace the second sentence of the `unknown` bullet with “Offer **I checked in <source>** only while the owner-release conditions in E1.7 are met.”

E10. Replace the owner-release acceptance bullet with “An early or failed read leaves owner release unavailable. After a qualifying read, confirm the owner decision and verify normal Start, planning, dependency and prep rules, an `unknown` audit, no Undo, and refusal of a second write while the first can still commit.”
