Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 01-audit-runtime-evidence-available-to-customer-streaming.md, 02-research-run-scoped-streaming-across-flutter-and-backend-targets.md
Assignee: Codex

## Question

What is the authoritative customer-chat run state machine and event-reduction contract? Specify request and run identity, monotonic sequencing, duplicate suppression, gap recovery, cursor resume, authoritative resync, one-active-run behavior, Stop, connection loss, retry, failure, cancellation, supersession, and terminal outcomes. Reconcile new customer input with the domain's Interruption and Irreversible Side Effect rules so stale progress, text, or GenUI can never overwrite a newer valid run and committed actions are never silently repeated or undone.

## Answer

The user delegated the remaining lifecycle decisions. The [Run Lifecycle, Ordering, Replay, And Recovery Contract](../assets/run-lifecycle-ordering-replay-and-recovery-contract.md) defines one durable Customer Chat Run with lifecycle status plus execution phase, one current generation per session, a contiguous customer-safe event log, explicit Stop, cursor replay, authoritative snapshots, executor leases, and exactly-once terminal materialization.

New input supersedes reversible presentation, but an irreversible attempt fences competing execution until its outcome is committed, failed, or reconciled. A committed outcome is never undone or hidden: the newest run becomes the sole active response and must acknowledge it before handling the follow-up. Transport loss only reconnects, unknown irreversible outcomes are never blindly retried, and stale events may finalize only their own old draft/surface—not mutate the newer run.
