Status: open
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 01-measure-current-live-verification-cost-and-duplication.md, 04-design-tiered-verification-matrix-and-canary.md, 05-design-dual-model-activation-and-quality-equivalence.md
Assignee:

## Question

Define the operational policy for measured cost, qualification failures, drift failures, diagnostics, and emergency releases. Which metrics and attribution dimensions are mandatory; how is a baseline converted into warning and blocking budgets; who sees and owns alerts; what resets a failure; how are zero-retry qualification and non-quarantined behavior tests enforced; when does a nightly failure block later deployment; and what exact infrastructure-only emergency path requires a compact canary followed by immediate full qualification without creating a behavior-change bypass?
