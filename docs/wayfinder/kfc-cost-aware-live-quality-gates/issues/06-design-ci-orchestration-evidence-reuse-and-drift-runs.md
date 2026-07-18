Status: open
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 03-define-release-fingerprint-and-change-classification.md, 04-design-tiered-verification-matrix-and-canary.md, 05-design-dual-model-activation-and-quality-equivalence.md
Assignee:

## Question

Design the minimum GitHub Actions and deployment orchestration that runs each required qualification once, publishes immutable evidence, lets deployment verify and reuse an exact matching result for at most 24 hours, cancels only superseded branch work, deduplicates identical fingerprints, and always runs a fresh nightly deployed drift suite. Specify concurrency groups, artifact identity and integrity, branch protection and deployment gates, stale-result handling, migration from the current workflow, and behavior when GitHub Actions, LangSmith, or a model provider is unavailable.
