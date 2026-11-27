OBJECT m5-v2

A5 still needs the changes below. A1–A4 and A6–A9 are covered. Sol's Matrix, Timeline and weights changes fit the data layer.

1. E1.7, hold release. Replace "Only an authorized read that starts after the request's connection has closed, and at least 30 seconds after dispatch, can clear the hold. A read that could precede a late commit cannot." with "After an acknowledged write, clear the hold on fresh authorized readback. After an ambiguous dispatch, keep the hold until source evidence establishes that the request can no longer commit and a fresh authorized read supplies the current state. If that evidence is unavailable, keep Check in source available and retain the hold across restart." The 30-second timeout in `HyperBotsHttpTools.ts` aborts the client's fetch. A server can commit at second 32 after a GET returned the old status at second 31.

2. E1.7, hold coverage. Replace "Pending, or awaiting authorized reconciliation (an unresolved unknown)" with "Pending, acknowledged and awaiting authorized readback, or unknown and awaiting authorized reconciliation." This covers a successful PATCH followed by a failed project GET. Keep the receipt as succeeded and the target held.

3. E1.10, success toast. Replace 'A toast says "<key> is now <status> in Jira".' with 'Use the actual source name. If readback succeeded, show the observed status. While readback is outstanding, show "<source> accepted the update. Checking status."'

4. E10, write-back acceptance. Replace "a read that could precede a late commit does not clear the hold" with "Test a timeout at 30 seconds, an authorized GET at 31 seconds and a server commit at 32 seconds. The GET leaves the target held and a second write is refused. Separately test an acknowledged send followed by failed readback. Across restart and a workspace switch, the originating partition keeps the receipt and hold until authorized readback succeeds."
