# KFC Customer Chat Streaming Map

Labels: wayfinder:map

## Destination

Produce a decision-ready implementation specification for a Claude/Codex-inspired KFC Flutter customer chat that shows only verified, customer-safe agent progress, streams response text, and progressively renders versioned GenUI structures.

The map is complete when the runtime evidence, customer experience, streaming transports, lifecycle semantics, observability, proof, test strategy, and feature-flagged rollout are clear enough to implement without further product or architecture decisions. A user-reviewed prototype of the visible progress experience is part of that specification; product-code implementation is not.

## Notes

Domain: KFC first-party Flutter customer chat, conversational ordering runtime, customer-safe progress projection, text deltas, versioned GenUI Snapshots, run-scoped streaming, interruption, and proof.

Skills every session should consult: `wayfinder`, `grilling`, and `domain-modeling`. The visible-progress prototype must also consult `cue-animations`.

Planning only. Do not implement product code while resolving this map unless the user explicitly starts a separate implementation effort.

Settled direction:

- The experience should feel like Claude or the Codex app while remaining appropriate for KFC customers.
- Show compact customer-safe semantic progress only when backed by verified runtime events. Do not expose chain-of-thought, raw planner output, tool arguments, policy internals, or debug language.
- Keep semantic progress visible during planning and tool execution. Begin text-token streaming only when response composition starts, then collapse progress into a completed summary.
- Use subtle Cue motion for loading, status transitions, loading-to-done, and error/reconnect changes, with deterministic testing and reduced-motion support.
- Define the first structural milestone as versioned GenUI structural streaming, not as an already-existing A2UI implementation. Render only complete valid snapshots atomically; persist the final snapshot as the immutable GenUI Snapshot.
- Prefer an idempotent run-start request plus a run-scoped SSE stream, subject to research across Flutter, Fastify, and Cloudflare Worker targets. Do not make customer chat consume raw dashboard or LangSmith streams.
- Use ordered, replayable observation: monotonic per-run sequence, duplicate suppression, gap detection, cursor resume, authoritative resync, and increasing GenUI revisions. Existing `clientMessageId` remains the request idempotency key.
- Model one customer-visible active run per session. New input may supersede reversible work, but it must not silently undo irreversible effects. Support Stop for planning, read-only tools, and response generation, with explicit `completed`, `failed`, `cancelled`, and `superseded` outcomes.
- Failures are phase-aware. Retain useful partial text, degrade GenUI to authoritative text, reconnect automatically, and keep technical errors in monitor/proof surfaces.
- Correlate the customer stream, runtime events, dashboard events, optional LangSmith spans, and proof artifacts with shared session, request, run, and event identities.
- First rollout is the KFC first-party Flutter chat behind a feature flag with the synchronous response retained as fallback. Messenger, Zalo, monitor redesign, and formal third-party A2UI adoption are outside the first rollout.

Verified charting baseline:

- `CustomerChatState` exposes `isSending` but no typed progress or active-run model.
- `CustomerChatController` awaits one completed repository response and appends one completed assistant message.
- `CustomerChatScreen` renders a generic typing bubble while sending.
- `BackendCustomerChatRepository` uses synchronous POST requests for KFC text and GenUI actions; its update polling is used for handoff/session turns, not agent progress or text deltas.
- Backend planner and response-composer OpenAI calls are currently non-streaming.
- Tool results can emit typed `session_updated` dashboard events such as `tool_called`; coarse run events exist for coordinated channel runs. Planner and policy detail currently lives primarily in tracing spans rather than a customer-safe event contract.
- Dashboard streaming exists, but the Flutter customer chat does not consume it.
- Existing GenUI is a typed immutable attachment snapshot with a fixed widget-kind catalog. No A2UI protocol or incremental component-patch contract is present.
- The Flutter app does not currently declare Cue as a dependency.
- The shared working tree contains unrelated uncommitted backend edits; preserve them.

## Decisions so far

- [Audit Runtime Evidence Available To Customer Streaming](./issues/01-audit-runtime-evidence-available-to-customer-streaming.md) — Final turns/state/GenUI and successful tool/business outcomes can anchor streaming, but KFC lacks an always-on run lifecycle, safe phase projection, text/GenUI deltas, cancellation, replay sequencing, and terminal run events; tracing and dashboard feeds cannot be exposed directly.
- [Research Run-Scoped Streaming Across Flutter And Backend Targets](./issues/02-research-run-scoped-streaming-across-flutter-and-backend-targets.md) — Use idempotent run start, queue-backed independent execution, a durable sequenced event log, replay-first SSE through `package:http`, and long-poll fallback; disconnect is transport loss, Stop is explicit, and legacy synchronous routing is chosen only before run acceptance.
- [Define The Customer-Safe Progress Language And Projection Rules](./issues/03-define-customer-safe-progress-language-and-projection-rules.md) — Show one evidence-backed Vietnamese status, coalesce internal churn into fixed semantic families, collapse to a deterministic success-only summary at first text, and keep planner, policy, tool, trace, error, and escalation internals out of customer chat.
- [Prototype The Visible Progress And Cue Motion Experience](./issues/04-prototype-visible-progress-and-cue-motion-experience.md) — Use one compact morphing response block from claim-free dots through verified progress into streamed text and atomic GenUI, with composer Stop, secondary reconnect, subtle coordinated Cue scenes, and a static reduced-motion path.
- [Design Text-Delta Streaming And Partial-Response Safety](./issues/05-design-text-delta-streaming-and-partial-response-safety.md) — Buffer and validate the full provider candidate before exposing durable word/grapheme-safe customer deltas; completed and incomplete text materialize exactly once, replay from the run log, and share canonical finalization with synchronous fallback.
- [Design Versioned GenUI Structural Streaming](./issues/06-design-versioned-genui-structural-streaming.md) — Stream complete validated revisions for one stable KFC surface, keep provisional UI non-actionable, atomically persist one authoritative snapshot with revision/state-bound capabilities, degrade to text, and defer formal A2UI adoption.
- [Design Run Lifecycle, Ordering, Replay, And Recovery Contracts](./issues/07-design-run-lifecycle-ordering-replay-and-recovery-contracts.md) — Use one durable status-plus-phase run, contiguous replayable events, explicit Stop and terminal reduction, newest-run-only presentation, and irreversible-attempt fencing/reconciliation with mandatory acknowledgement of committed outcomes.
- [Design Evidence Correlation And Demo Proof](./issues/08-design-evidence-correlation-and-demo-proof.md) — Make the durable run ledger authoritative, correlate Flutter reductions and clean video to it, require one checksummed fail-closed bundle, and accept only a single full nine-scenario plus lifecycle-fault replay—not filtered diagnostic fragments.
- [Design Test Matrix And Feature-Flagged Rollout](./issues/09-design-test-matrix-and-feature-flagged-rollout.md) — Gate a server-assigned staged rollout on deterministic and backend-backed tests, one unified live Proof Run, quantitative health, pre-acceptance-only synchronous fallback, and accepted-run-safe rollback.

## Not yet specified

None. The transport, projection vocabulary, prototype, text, GenUI, lifecycle, evidence, proof, testing, and rollout decisions required by the destination are resolved.

## Out of scope

- Implementing the streaming architecture or editing Flutter/backend product code during this Wayfinder charting session.
- Exposing chain-of-thought, hidden reasoning, full prompts, credentials, raw tool arguments, or unfiltered technical traces to customers.
- Claiming that the current GenUI implementation is A2UI.
- Redesigning the live monitor beyond the correlation and evidence requirements needed by this specification.
- Rolling the first implementation out to Messenger or Zalo.
- Adopting a formal third-party A2UI protocol before the GenUI compatibility and architecture ticket resolves that decision.
- Creating a slide deck.

## Frontier

Open, unblocked, unassigned child tickets are the frontier. In this local Markdown tracker, `Blocked by` names the tickets that must close first.

The current frontier is empty. All child tickets are resolved and the destination is reached; implementation belongs in a separate effort.
