Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 04-prototype-visible-progress-and-cue-motion-experience.md, 05-design-text-delta-streaming-and-partial-response-safety.md, 06-design-versioned-genui-structural-streaming.md, 07-design-run-lifecycle-ordering-replay-and-recovery-contracts.md, 08-design-evidence-correlation-and-demo-proof.md
Assignee: Codex

## Question

What exact acceptance matrix and rollout controls make the KFC first-party streaming chat safe to implement and promote? Cover backend schemas and projection, sequence/replay/idempotency, Flutter reducers, Cue motion and reduced motion, partial text, GenUI revisions, Stop, reconnect, failure, supersession, deterministic backend-backed integration tests, credentialed live-AI scenario replay, metrics, feature flagging, synchronous fallback, rollback, and promotion gates. Keep Messenger, Zalo, formal A2UI adoption, and unrelated monitor redesign outside the first rollout unless an earlier ticket changes the destination.

## Answer

The [Test Matrix And Feature-Flagged Rollout Contract](../assets/test-matrix-and-feature-flagged-rollout-contract.md) selects server-assigned staged exposure with a master `off`/`internal`/`cohort`/`on` policy, stable persisted session assignment, one client capability guard, and an independently suppressible provisional-GenUI capability. Synchronous fallback is legal only before `stream_accepted`; accepted runs retain streaming ownership through reconnect, Stop, terminal recovery, and rollback so side effects cannot be duplicated.

Acceptance combines serial deterministic backend suites, typed Flutter reducer tests, widget/golden/Cue and reduced-motion tests, production-codec backend-backed Flutter integration tests with fault injection, and one complete credentialed live-AI Proof Run. Absolute integrity gates, quantitative latency/health gates, staged internal/10%/50%/100% promotion, config-only rollback, accepted-run draining, and delayed legacy retirement make widening and reversal explicit. The existing per-scenario GenUI workflow remains diagnostic until it is replaced by the single fail-closed proof command.
