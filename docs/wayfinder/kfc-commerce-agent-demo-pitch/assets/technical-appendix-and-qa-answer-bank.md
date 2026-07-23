# Technical Appendix And Q&A Answer Bank

Prepared for [Design Technical Appendix And Q&A Answer Bank](../issues/05-design-technical-appendix-and-qa-answer-bank.md) on 2026-07-12.

> **Historical verification note (2026-07-20):** The checkout-bound command
> below records the July 12 evidence cut. Its commerce proof evaluator has
> since been retired and the command must not be used as a current test recipe.
> Historical artifact paths that are absent from this checkout are intentionally
> retained as plain provenance text rather than broken links.

## Decision

The technical appendix will contain five numbered slides, `A1` through `A5`. Each slide answers one technical question with a single readable architecture or evidence visual, one conclusion, and one explicit claim boundary. The appendix is supporting evidence for Q&A; it is not part of the five-minute main sequence unless a judge asks.

The maintained architecture is one explicit LangGraph `StateGraph`, not a supervisor with specialist agents and not a separate deterministic planner/composer pipeline. The selected model authors semantic commerce tool calls and a typed terminal response through bound schemas. The terminal response includes customer prose and its publication declaration in the same call. Deterministic code validates structure, verified state, authorization, policy, approval bindings, tool execution, typed evidence, and disclosure authority before persistence; there is no synchronous third model call.

## Historical July 12 verification cut

- Historical checkout: `9d4bff952e120ac774950735fbd5d1501b72cef0` with a shared dirty worktree.
- Historical focused verification: 10 test files, 66/66 deterministic tests passed in 4.88 seconds.
- Command: `npm test -- --maxWorkers=1 --no-file-parallelism test/graph/order-confirmation.test.ts test/ordering/tool-executor.test.ts test/api/human-takeover.test.ts test/monitor/session-intelligence.test.ts test/evaluation/context-eval-runner.test.ts test/evaluation/genui-proof-evaluator.test.ts test/scenarios/scenario-replay.test.ts test/commerce/pos-capability.test.ts test/commerceProof/contracts.test.ts test/commerceProof/evaluators.test.ts`.
- This command is preserved only as historical provenance. Deleted paths in it are not maintained entry points, and the result is not current source, live-model, deployed-runtime, vendor-sandbox, or production-order proof.

## A1 - Runtime request flow

### Slide job

Answer: **What happens after a customer sends a message?**

### Takeaway title

`One request enters one governed commerce loop.`

### Visible composition

Use one horizontal flow with six stages and no infrastructure cloud:

`CHANNEL` -> `ROUTE / RUN` -> `LANGGRAPH STATEGRAPH` -> `BOUND TOOLS` -> `VERIFIED STATE` -> `VERIFIED RESPONSE + GENUI`

Short labels beneath the stages:

- `KFC chat, Messenger, Zalo`
- `Synchronous chat or durable channel run`
- `Model-authored calls; explicit graph routing`
- `Schema, authority, policy, execution`
- `Cart, fulfillment, order, payment`
- `Typed publication validation; operator events`

Bottom conclusion:

`The model submits customer prose and a typed publication declaration after inspecting tool results; deterministic boundaries validate evidence, authorization, and approval state before persistence.`

### Evidence

- KFC chat, GenUI, dashboard-stream, and human-control routes: [`worker.ts`](../../../../services/kfc-agent-backend/src/worker.ts)
- StateGraph invocation, checkpoint/resume handling, and output projection: [`agentStateGraphRunner.ts`](../../../../services/kfc-agent-backend/src/agent/agentStateGraphRunner.ts)
- Explicit model/tool/approval/publication/persistence topology: [`agentStateGraph.ts`](../../../../services/kfc-agent-backend/src/agent/agentStateGraph.ts)
- Bound tool definitions and graph-owned execution bridge: [`singleAgentRuntime.ts`](../../../../services/kfc-agent-backend/src/agent/singleAgentRuntime.ts)
- Typed tool catalog and verified executor: [`toolCatalog.ts`](../../../../services/kfc-agent-backend/src/ordering/toolCatalog.ts), [`agentToolExecutor.ts`](../../../../services/kfc-agent-backend/src/ordering/agentToolExecutor.ts)
- Typed response evidence and publication validation: [`responseGrounding.ts`](../../../../services/kfc-agent-backend/src/agent/responseGrounding.ts), [`responsePrivacyAttestation.ts`](../../../../services/kfc-agent-backend/src/agent/responsePrivacyAttestation.ts)

### Boundary

Say `single explicit StateGraph agent loop`. Do not describe a supervisor, specialist-agent team, autonomous multi-agent architecture, deterministic semantic planner, or deterministic customer-response composer.

## A2 - Planning, policy, tools, and state authority

### Slide job

Answer: **Can the model hallucinate an order or bypass confirmation?**

### Takeaway title

`The model proposes. The system decides what can execute.`

### Visible composition

Use a vertical ownership stack:

1. `MODEL + BOUND SCHEMAS` - semantically authors commerce calls and the typed terminal response.
2. `STRUCTURAL VALIDATION` - rejects unknown tools, invalid arguments, duplicates, and invalid call bundles.
3. `VERIFIED AUTHORITY` - checks provider revisions, customer access, policy, and exact-action approval bindings.
4. `GRAPH-OWNED EXECUTOR` - calls bounded commerce clients and records provenance.
5. `PUBLICATION BOUNDARY` - deterministic validation checks the typed declaration, closed-world evidence, authorization, and approval state.
6. `PERSISTED STATE` - owns the cart, order, payment, handoff, transcript, and event truth.

Place the customer-facing result beside the bottom layer, not beside the LLM:

`GenUI projects verified state; the author model submits typed evidence references with customer prose, and deterministic publication checks fail closed on malformed declarations, unavailable or mismatched evidence references, and unauthorized disclosures. The release-blocking post-turn judge detects semantic contradictions.`

### Evidence

- Model-authored tool-call validation and explicit graph routing: [`agentStateGraph.ts`](../../../../services/kfc-agent-backend/src/agent/agentStateGraph.ts)
- Bound tool definitions and argument schemas: [`singleAgentRuntime.ts`](../../../../services/kfc-agent-backend/src/agent/singleAgentRuntime.ts), [`toolCatalog.ts`](../../../../services/kfc-agent-backend/src/ordering/toolCatalog.ts)
- Verified-state, authorization, provider-revision, and irreversible-action enforcement: [`agentToolExecutor.ts`](../../../../services/kfc-agent-backend/src/ordering/agentToolExecutor.ts)
- Typed response evidence and fail-closed grounding: [`responseGrounding.ts`](../../../../services/kfc-agent-backend/src/agent/responseGrounding.ts), [`response-grounding.test.ts`](../../../../services/kfc-agent-backend/test/agent/response-grounding.test.ts)
- Side-effect classification and irreversible-run guard: [`toolExecutor.ts`](../../../../services/kfc-agent-backend/src/ordering/toolExecutor.ts)
- Approval interrupt, stale-binding, rejection, and fail-closed tests: [`agent-state-graph.test.ts`](../../../../services/kfc-agent-backend/test/agent/agent-state-graph.test.ts), [`single-agent-runtime.test.ts`](../../../../services/kfc-agent-backend/test/agent/single-agent-runtime.test.ts)

### Boundary

The state and commerce clients are prototype/fixture backed. Structural
validation and the fail-closed approval interrupt are implemented, but
authenticated positive approval remains a release blocker and none of these
boundaries makes the prototype a production KFC system.

## A3 - Reliability, interruption, recovery, and human control

### Slide job

Answer: **What happens when messages arrive quickly, a run becomes stale, or a person needs to intervene?**

### Takeaway title

`New intent can replace safe work; irreversible work is protected.`

### Visible composition

Use one left-to-right sequence with a control branch:

`NEW CUSTOMER TURNS` -> `PENDING + COALESCED` -> `GENERATION-OWNED RUN` -> `DELIVER OR SUPPRESS`

Under the run, show the rule:

`Supersede only before an irreversible boundary.`

Add a short operator branch from persisted session state:

`JOIN` -> `HUMAN REPLY` -> `RESUME AI WITH CONTEXT`

Bottom conclusion:

`The system preserves one current run and one explicit control owner per session.`

### Evidence

- Pending-turn reservation, debounce, generation ownership, coalescing, stale-wakeup rejection, and safe supersession: [`coordinator.ts`](../../../../services/kfc-agent-backend/src/agentRuns/coordinator.ts)
- StateGraph-run current checks before inference, tool execution, response publication, and persistence: [`agentStateGraphRunner.ts`](../../../../services/kfc-agent-backend/src/agent/agentStateGraphRunner.ts), [`agentStateGraph.ts`](../../../../services/kfc-agent-backend/src/agent/agentStateGraph.ts), [`singleAgentRuntime.ts`](../../../../services/kfc-agent-backend/src/agent/singleAgentRuntime.ts)
- Irreversible boundary enforcement and stale-delivery suppression: [`toolExecutor.ts`](../../../../services/kfc-agent-backend/src/ordering/toolExecutor.ts), [`routeAgentRuntime.ts`](../../../../services/kfc-agent-backend/src/api/routeAgentRuntime.ts)
- Join, human-message, and resume routes: [`worker.ts`](../../../../services/kfc-agent-backend/src/worker.ts)
- Human takeover deterministic proof: [`human-takeover.test.ts`](../../../../services/kfc-agent-backend/test/api/human-takeover.test.ts)
- Historical live warning -> human joined -> human reply -> AI resumed artifact: `artifacts/warning-escalation-proof/2026-07-11T06-11-03-078Z/manifest.json` (unavailable in this checkout)

### Boundary

Do not claim exactly-once delivery across all failures, production queue SLAs, or durable reconciliation after external system ambiguity. The live takeover artifact is 117.56 seconds, is not Git-SHA bound, and is not order-completion proof.

## A4 - Evaluation and proof methodology

### Slide job

Answer: **How do you know the agent is reliable rather than merely producing a convincing answer?**

### Takeaway title

`We test outcomes at four separate proof layers.`

### Visible composition

Use four horizontal layers, each with its own question:

1. `DETERMINISTIC CONTRACTS` - Did StateGraph routing, structural validation, tools, state transitions, and adapters behave correctly?
2. `CANONICAL V1 OUTCOMES` - Do the nine scenarios and 46 turns define the required state, effects, presentation, provenance, persistence, and latency?
3. `LIVE UI + GENUI` - Did the customer see the correct structured result with complete screenshots and telemetry?
4. `LIVE MODEL + DEPLOYED PROOF` - Did both pinned providers pass Text/GenUI parity for three unchanged repetitions on the identified runtime?

Show the continuous loop beneath them:

`Observe logs -> Find gaps -> Improve behavior -> Re-evaluate`

Bottom conclusion:

`A result is reported at its real evidence layer; the layers are never collapsed into one pass-rate claim.`

### Evidence

- Historical July 12 focused run: 66/66 deterministic checks on its recorded dirty worktree; it is not current release evidence.
- Canonical v1 9-scenario/46-turn/92-case contract and attestation: [`liveQualityContracts.ts`](../../../../services/kfc-agent-backend/src/evaluation/liveQualityContracts.ts), [`scenarioCoverageLedger.ts`](../../../../services/kfc-agent-backend/test/scenarios/scenarioCoverageLedger.ts), [`liveQualityDataset.ts`](../../../../services/kfc-agent-backend/src/evaluation/liveQualityDataset.ts)
- Selected provider/mode StateGraph replay and its offline selection checks: [`live-ai-scenario-replay.test.ts`](../../../../services/kfc-agent-backend/test/scenarios/live-ai-scenario-replay.test.ts), [`live-scenario-selection.test.ts`](../../../../services/kfc-agent-backend/test/evaluation/live-scenario-selection.test.ts)
- Shared outcome evaluator and StateGraph projection: [`liveQualityEvaluators.ts`](../../../../services/kfc-agent-backend/src/evaluation/liveQualityEvaluators.ts), [`liveQualityStateGraph.ts`](../../../../services/kfc-agent-backend/src/evaluation/liveQualityStateGraph.ts)
- GenUI evaluator checks widget correctness, lifecycle coverage, screenshot completeness, forbidden handoff, and response concision: [`genUiProofEvaluator.ts`](../../../../services/kfc-agent-backend/src/evaluation/genUiProofEvaluator.ts)
- Historical local live-AI GenUI manifest: nine sessions and 50 screenshots, but no commit/dirty binding; `artifacts/genui-live-proof/2026-07-11T08-54-21-074Z/integration-test/manifest.json` is unavailable in this checkout.
- Evidence-layer boundary and current live replay limitations: [`Pitch Evidence And Demo Readiness Audit`](./pitch-evidence-and-demo-readiness-audit.md)

### Boundary

The nine scenarios are a representative engineering dataset, not user research, a pilot, or measured business impact. Offline attestation and evaluator tests prove corpus and evaluator behavior, not provider quality. Do not claim the paid matrix passed without an accepted artifact, and do not collapse a complete qualification's 54 scenario-mode runs plus 276 turn-mode evaluations per provider into one blended `9/9` or `all tests pass` claim.

## A5 - OMS/POS adapter contracts

### Slide job

Answer: **Can this call KFC's existing OMS or POS?**

### Takeaway title

`Stable adapter contracts isolate the agent from OMS/POS specifics.`

### Visible composition

Use one contract boundary with two replaceable branches:

`AGENT TOOLS` -> `COMMERCE CONTRACT` -> `OMS ADAPTER`

`                                      -> POS ADAPTER`

Add four responsibilities under the contract:

- `Typed order and status models`
- `Correlation + idempotency keys`
- `Failure and cancellation mapping`
- `Raw status preserved for reconciliation`

Place a red evidence label at the bottom:

`CURRENT PROOF: SIMULATED ADAPTERS`

Then one forward-looking line:

`A real integration requires authoritative APIs, sandbox access, authentication, status semantics, webhooks, and vendor conformance tests.`

### Evidence

- Stable client interfaces for OMS and other commerce systems: [`interfaces.ts`](../../../../services/kfc-agent-backend/src/clients/interfaces.ts)
- OMS/POS orchestration, idempotent in-process replay, status projection, and compensation attempt: [`omsWithPos.ts`](../../../../services/kfc-agent-backend/src/commerce/omsWithPos.ts)
- HTTP POS adapter with idempotency header: [`httpPosClient.ts`](../../../../services/kfc-agent-backend/src/commerce/httpPosClient.ts)
- Historical simulated component report: `artifacts/mock-pos-proof/2026-07-10T20-24-31-483Z/report.json` (unavailable in this checkout)
- Claim gate and vendor onboarding inputs: [`Simulated Proof Matrix And Vendor Onboarding Handoff`](../../kfc-oms-pos-integration-capability/assets/simulated-proof-matrix-and-vendor-onboarding-handoff.md)

### Boundary

Use only: `Demonstrated simulated OMS/POS orchestration through replaceable adapter contracts.` Do not claim KFC compatibility, a vendor sandbox, restart-safe idempotency, production durability, or production readiness.

## Exact 20-second Q&A answer bank

### 1. What makes this agentic instead of a chatbot?

`A chatbot can generate a plausible reply. Our model-driven agent can take multiple semantic tool rounds inside one explicit LangGraph StateGraph, inspect each verified result, and then submit customer prose with a typed publication declaration. Deterministic boundaries validate the calls, evidence references, authorization, and approval state. Verified state changes—not text alone—define success.`

### 2. Is this a multi-agent system?

`No. It is intentionally one explicit StateGraph commerce-agent loop. The same selected model can take several tool rounds, but there is no supervisor delegating to autonomous specialists and no separate deterministic semantic planner. We keep one verified state authority and one policy boundary for consent, cart, fulfillment, payment, and recovery decisions.`

### 3. Can the LLM hallucinate an item, price, or completed order?

`The model authors a typed tool call or terminal response, but unknown tools, invalid arguments, duplicate or unsafe call bundles, stale provider state, malformed evidence declarations, and unauthorized disclosures are rejected. Irreversible calls pause at an exact-action approval interrupt and resumes are revalidated; authenticated positive approval is still a release blocker. GenUI projects verified state, while deterministic publication checks validate typed evidence references and disclosure authority without a third model call. A release-blocking post-turn judge detects semantic contradictions between customer prose and cited evidence.`

### 4. What happens if the customer sends another message while the agent is working?

`Channel turns are reserved, briefly coalesced, and assigned to a generation-owned run. A newer turn can supersede an older run only before an irreversible side effect. Stale responses are suppressed. Once an irreversible boundary is recorded, the system protects that execution instead of pretending it can safely rewind it.`

### 5. How does human takeover work?

`The session has an explicit control state. An operator can join, which pauses AI replies; the human can respond in the same channel; then Resume AI returns control with the takeover transcript preserved. We have deterministic tests and a live warning-to-resume artifact, although that live artifact is separate from the ordering demo.`

### 6. How do you evaluate agent quality?

`We separate deterministic StateGraph/tool contracts, the canonical nine-scenario/46-turn/92-case outcome ledger, live Flutter and GenUI evidence, and live-model or deployed proof. The shared evaluator grades state, effects, presentation, provenance, persistence, and latency. Customer publication is guarded by typed evidence and authority checks in the request path; the outcome judge remains post-turn and non-authoritative. A complete qualification must still run the LangSmith adapter for every turn and compare both modes and providers; the current selected replay does not prove that matrix.`

### 7. Did all nine scenarios pass?

`They are nine representative journey designs covering 46 customer turns and 92 Text/GenUI cases, not a public pass-rate claim. A complete three-repetition qualification comprises 54 scenario-mode runs and 276 turn-mode evaluations per provider. The July 11 artifacts remain historical, and this appendix does not claim a current accepted live matrix result.`

### 8. What is the source of truth when the model and system disagree?

`Persisted backend state and successful typed tool results win. A model-authored call or response is not commerce truth by itself. The cart, fulfillment, order, payment, handoff, tool trace, and events are recorded centrally; GenUI projects that state, and deterministic publication validation binds the response digest and typed evidence declaration to current authority.`

### 9. Can this integrate with KFC's real OMS/POS today?

`We demonstrated the integration shape through replaceable, simulated OMS/POS adapters: typed commands, correlation, idempotency keys, status mapping, and failure handling. We have not connected to KFC production or a named vendor sandbox. Real compatibility requires authoritative contracts, credentials, test stores, webhooks, and vendor conformance evidence.`

### 10. What happens if the POS result is ambiguous or one system fails?

`The simulated layer preserves raw OMS and POS outcomes, classifies conflicts, and attempts defined compensation where appropriate. It does not claim every ambiguous external request is automatically reconciled. Production deployment would require durable retries, vendor idempotency guarantees, reconciliation jobs, alerts, and an owned operations process.`

### 11. Why use GenUI instead of only text?

`Text is useful for intent, but ordering contains structured decisions. GenUI turns verified store, price, ETA, fee, address, payment, and confirmation state into explicit customer actions. The customer-run stream can stage provisional typed revisions before the authoritative snapshot, but those revisions are projections of the completed attachment—not model-authored incremental structure, JSON patches, or a formal A2UI protocol.`

### 12. What is the biggest remaining technical risk?

`The largest proof gap is release-bound live reliability: the exact three-turn combo and upsize path, its latency, and a matching fallback recording are not yet proven on one identified runtime snapshot. Production OMS/POS compatibility and measured business impact also remain intentionally unclaimed.`

## Appendix presentation rules

- Keep `A1` through `A5` after the main deck and reveal them only for relevant questions.
- Use the existing KFC red, black, and warm-white visual system.
- Use one readable visual per appendix slide; do not create dense code screenshots or infrastructure clouds.
- Keep raw file paths, test commands, and detailed claim boundaries in speaker notes, not on the visible slide.
- Each appendix slide must remain answerable in about 20 seconds.
- If a judge asks beyond current evidence, answer directly: what is implemented, what is simulated, and what must still be validated.
