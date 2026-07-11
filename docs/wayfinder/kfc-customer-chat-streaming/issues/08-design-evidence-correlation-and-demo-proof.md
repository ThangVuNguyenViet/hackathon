Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by: 01-audit-runtime-evidence-available-to-customer-streaming.md, 02-research-run-scoped-streaming-across-flutter-and-backend-targets.md, 03-define-customer-safe-progress-language-and-projection-rules.md, 04-prototype-visible-progress-and-cue-motion-experience.md, 05-design-text-delta-streaming-and-partial-response-safety.md, 06-design-versioned-genui-structural-streaming.md, 07-design-run-lifecycle-ordering-replay-and-recovery-contracts.md
Assignee: Codex

## Question

What evidence contract proves that every customer-visible progress change, text stream, GenUI revision, reconnect, cancellation, failure, and terminal outcome came from the real runtime? Define shared identities across customer events, persisted state, dashboard events, optional LangSmith spans, Flutter captures, and proof manifests. Specify latency metrics and a collaborator-runnable synchronized proof package containing screen recording, ordered event ledger, correlated backend evidence, timestamps, and fail-closed manifest checks. Targeted reruns may diagnose one slice, but define the full scripted scenario replay required for acceptance.

## Answer

The [Evidence Correlation And Demo Proof Contract](../assets/evidence-correlation-and-demo-proof-contract.md) selects a ledger-first proof architecture. The durable customer-run event log proves runtime commitment; structured Flutter applied-event observations prove reducer state; video/screenshots prove visibility; persisted turns, GenUI, action reservations, and downstream outcomes prove final state. Dashboard and optional LangSmith traces are correlated corroboration, never substitutes for missing authoritative events.

One fail-closed manifest joins request/run/event/draft/GenUI/action/turn/capture identities, validates sequence and digests, records clock uncertainty and granular latency milestones, verifies privacy/checksums/runtime modes, and rejects filtered or mixed-run artifacts. Acceptance requires all nine reviewed conversation scenarios plus the full deterministic streaming lifecycle/fault matrix in one proof execution; targeted reruns remain diagnostic-only.
