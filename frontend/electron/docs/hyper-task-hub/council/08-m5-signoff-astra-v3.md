AGREE m5-v3

E1.7 covers items 1 and 2. A GET at second 31 cannot clear an ambiguous write that may commit at second 32. An acknowledged write whose readback fails keeps its `succeeded` receipt and its hold. E1.10 covers item 3. The toast names the source and reports an observed status only after readback. E10 covers item 4 with the late-commit sequence, refusal of a second write, and receipt and hold recovery in the originating partition.

The owner release is safe and implementable within E1.7's stated scope. After the earliest reconciliation time and a fresh authorized read of the target, main can append the owner's decision to that operation in its originating ledger. Start, planning, dependencies and prep can then use the observed status. If the timed-out request commits later, the next authorized observation updates those decisions.

The ledger can enforce the distinction across restart. The owner decision releases the local planning restrictions. A second Hub write to that target still returns `held` until source reconciliation establishes that the first request can no longer commit. Its audit stays `unknown` and Undo stays unavailable.
