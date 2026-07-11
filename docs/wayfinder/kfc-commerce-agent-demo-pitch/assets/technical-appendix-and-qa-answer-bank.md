# Technical Appendix And Q&A Answer Bank

Prepared for [Design Technical Appendix And Q&A Answer Bank](../issues/05-design-technical-appendix-and-qa-answer-bank.md) on 2026-07-12.

## Decision

The technical appendix will contain five numbered slides, `A1` through `A5`. Each slide answers one technical question with a single readable architecture or evidence visual, one conclusion, and one explicit claim boundary. The appendix is supporting evidence for Q&A; it is not part of the five-minute main sequence unless a judge asks.

The verified architecture is a **single commerce agent loop**, not a supervisor with specialist agents. The model proposes structured plans. Typed tool schemas, safety gates, tool execution, and persisted backend state decide what may execute and what becomes customer-visible commerce truth.

## Current verification cut

- Current checkout: `9d4bff952e120ac774950735fbd5d1501b72cef0` with a shared dirty worktree.
- Fresh focused verification: 10 test files, 66/66 deterministic tests passed in 4.88 seconds.
- Command: `npm test -- --maxWorkers=1 --no-file-parallelism test/graph/order-confirmation.test.ts test/ordering/tool-executor.test.ts test/api/human-takeover.test.ts test/monitor/session-intelligence.test.ts test/evaluation/context-eval-runner.test.ts test/evaluation/genui-proof-evaluator.test.ts test/scenarios/scenario-replay.test.ts test/commerce/pos-capability.test.ts test/commerceProof/contracts.test.ts test/commerceProof/evaluators.test.ts`.
- This fresh run verifies current source behavior. It is not a live-model, deployed-runtime, vendor-sandbox, or production-order proof.

## A1 - Runtime request flow

### Slide job

Answer: **What happens after a customer sends a message?**

### Takeaway title

`One request enters one governed commerce loop.`

### Visible composition

Use one horizontal flow with six stages and no infrastructure cloud:

`CHANNEL` -> `ROUTE / RUN` -> `PLAN` -> `GATES + TOOLS` -> `VERIFIED STATE` -> `CUSTOMER + OPERATOR`

Short labels beneath the stages:

- `KFC chat, Messenger, Zalo`
- `Synchronous chat or durable channel run`
- `Intent, context, next actions`
- `Typed commerce operations`
- `Cart, fulfillment, order, payment`
- `Text + GenUI; monitor events`

Bottom conclusion:

`The response is composed only after tool results and state are recorded.`

### Evidence

- KFC chat and GenUI routes: [`worker.ts`](../../../../services/kfc-agent-backend/src/worker.ts#L440-L478)
- Channel run coordination and WebSocket monitor surface: [`worker.ts`](../../../../services/kfc-agent-backend/src/worker.ts#L227-L269), [`worker.ts`](../../../../services/kfc-agent-backend/src/worker.ts#L558-L620)
- Planner loop, gated execution, persistence, and response composition: [`buildGraph.ts`](../../../../services/kfc-agent-backend/src/graph/buildGraph.ts#L2234-L3037)
- Typed tool catalog: [`toolCatalog.ts`](../../../../services/kfc-agent-backend/src/ordering/toolCatalog.ts#L13-L135)

### Boundary

Say `single agent loop`. Do not describe a supervisor, specialist-agent team, or autonomous multi-agent architecture.

## A2 - Planning, policy, tools, and state authority

### Slide job

Answer: **Can the model hallucinate an order or bypass confirmation?**

### Takeaway title

`The model proposes. The system decides what can execute.`

### Visible composition

Use a vertical ownership stack:

1. `LLM PLANNER` - proposes intent, entities, tool calls, and response claims.
2. `TYPED TOOL CATALOG` - rejects unknown tools and invalid arguments.
3. `POLICY + SAFETY GATES` - require verified items, fulfillment, evidence, and customer approval.
4. `TOOL EXECUTOR` - calls bounded commerce clients and records provenance.
5. `PERSISTED STATE` - owns the cart, order, payment, handoff, and event truth.

Place the customer-facing result beside the bottom layer, not beside the LLM:

`GenUI and the final response reflect verified state.`

### Evidence

- Planner output validation and allowed-tool enforcement: [`toolPlanner.ts`](../../../../services/kfc-agent-backend/src/llm/toolPlanner.ts#L8-L105)
- Argument schemas for every tool: [`toolCatalog.ts`](../../../../services/kfc-agent-backend/src/ordering/toolCatalog.ts#L13-L135)
- Safety gates for fulfillment, explicit confirmation, verified item codes, promotions, payment, and allergen certainty: [`safetyGates.ts`](../../../../services/kfc-agent-backend/src/ordering/safetyGates.ts#L1-L166)
- Side-effect classification and irreversible-run guard: [`toolExecutor.ts`](../../../../services/kfc-agent-backend/src/ordering/toolExecutor.ts#L141-L211)
- Explicit and negated confirmation tests: [`order-confirmation.test.ts`](../../../../services/kfc-agent-backend/test/graph/order-confirmation.test.ts#L11-L163)

### Boundary

The state and commerce clients are prototype/fixture backed. The safety design is implemented, but it does not make the prototype a production KFC system.

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

- Pending-turn reservation, 1.5-second debounce, generation ownership, coalescing, stale-wakeup rejection, and safe supersession: [`coordinator.ts`](../../../../services/kfc-agent-backend/src/agentRuns/coordinator.ts#L27-L187)
- Run-current checks and suppressed stale replies: [`buildGraph.ts`](../../../../services/kfc-agent-backend/src/graph/buildGraph.ts#L137-L141), [`buildGraph.ts`](../../../../services/kfc-agent-backend/src/graph/buildGraph.ts#L2225-L2231), [`buildGraph.ts`](../../../../services/kfc-agent-backend/src/graph/buildGraph.ts#L2983-L3034)
- Irreversible boundary recording and delivery suppression: [`toolExecutor.ts`](../../../../services/kfc-agent-backend/src/ordering/toolExecutor.ts#L184-L211), [`routeHandlers.ts`](../../../../services/kfc-agent-backend/src/api/routeHandlers.ts#L1267-L1443)
- Join, human-message, and resume routes: [`worker.ts`](../../../../services/kfc-agent-backend/src/worker.ts#L516-L547)
- Human takeover deterministic proof: [`human-takeover.test.ts`](../../../../services/kfc-agent-backend/test/api/human-takeover.test.ts)
- Live warning -> human joined -> human reply -> AI resumed artifact: [`manifest.json`](../../../../artifacts/warning-escalation-proof/2026-07-11T06-11-03-078Z/manifest.json)

### Boundary

Do not claim exactly-once delivery across all failures, production queue SLAs, or durable reconciliation after external system ambiguity. The live takeover artifact is 117.56 seconds, is not Git-SHA bound, and is not order-completion proof.

## A4 - Evaluation and proof methodology

### Slide job

Answer: **How do you know the agent is reliable rather than merely producing a convincing answer?**

### Takeaway title

`We test outcomes at four separate proof layers.`

### Visible composition

Use four horizontal layers, each with its own question:

1. `DETERMINISTIC CONTRACTS` - Did gates, tools, state transitions, and adapters behave correctly?
2. `SCENARIO REPLAY` - Did nine representative journeys reach the intended state and recovery behavior?
3. `LIVE UI + GENUI` - Did the customer see the correct structured result with complete screenshots and telemetry?
4. `LIVE MODEL + DEPLOYED PROOF` - Did the current model/runtime produce the expected causal trace and outcome?

Show the continuous loop beneath them:

`Observe logs -> Find gaps -> Improve behavior -> Re-evaluate`

Bottom conclusion:

`A result is reported at its real evidence layer; the layers are never collapsed into one pass-rate claim.`

### Evidence

- Current fresh focused run: 66/66 deterministic checks on the current worktree.
- Scenario replay contract: [`scenario-replay.test.ts`](../../../../services/kfc-agent-backend/test/scenarios/scenario-replay.test.ts)
- Context evaluation runner: [`contextEvalRunner.ts`](../../../../services/kfc-agent-backend/src/evaluation/contextEvalRunner.ts)
- GenUI evaluator checks widget correctness, lifecycle coverage, screenshot completeness, forbidden handoff, and response concision: [`genUiProofEvaluator.ts`](../../../../services/kfc-agent-backend/src/evaluation/genUiProofEvaluator.ts)
- Historical local live-AI GenUI manifest: nine sessions and 50 screenshots, but no commit/dirty binding: [`manifest.json`](../../../../artifacts/genui-live-proof/2026-07-11T08-54-21-074Z/integration-test/manifest.json)
- Evidence-layer boundary and current live replay limitations: [`Pitch Evidence And Demo Readiness Audit`](./pitch-evidence-and-demo-readiness-audit.md)

### Boundary

The nine scenarios are a representative engineering dataset, not user research, a pilot, or measured business impact. Do not say all nine currently pass as live-model release tests. Do not expose one blended `9/9` or `all tests pass` claim.

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

- Stable client interfaces for OMS and other commerce systems: [`interfaces.ts`](../../../../services/kfc-agent-backend/src/clients/interfaces.ts#L1-L190)
- OMS/POS orchestration, idempotent in-process replay, status projection, and compensation attempt: [`omsWithPos.ts`](../../../../services/kfc-agent-backend/src/commerce/omsWithPos.ts)
- HTTP POS adapter with idempotency header: [`httpPosClient.ts`](../../../../services/kfc-agent-backend/src/commerce/httpPosClient.ts)
- Simulated component report: [`report.json`](../../../../artifacts/mock-pos-proof/2026-07-10T20-24-31-483Z/report.json)
- Claim gate and vendor onboarding inputs: [`Simulated Proof Matrix And Vendor Onboarding Handoff`](../../kfc-oms-pos-integration-capability/assets/simulated-proof-matrix-and-vendor-onboarding-handoff.md)

### Boundary

Use only: `Demonstrated simulated OMS/POS orchestration through replaceable adapter contracts.` Do not claim KFC compatibility, a vendor sandbox, restart-safe idempotency, production durability, or production readiness.

## Exact 20-second Q&A answer bank

### 1. What makes this agentic instead of a chatbot?

`A chatbot can generate a plausible reply. Our agent repeatedly interprets the goal, proposes the next actions, selects bounded commerce tools, passes policy gates, executes them, inspects the resulting cart or order state, and adapts or hands off. The important distinction is that verified state changes—not text alone—define success.`

### 2. Is this a multi-agent system?

`No. It is intentionally one commerce agent loop. The planner can take several steps, but there is no supervisor delegating to autonomous specialists. We kept one state authority and one policy boundary because ordering needs consistent consent, cart, fulfillment, payment, and recovery decisions.`

### 3. Can the LLM hallucinate an item, price, or completed order?

`The model can propose a tool call or response claim, but unknown tools and invalid arguments are rejected. Safety gates require verified item codes, valid fulfillment, explicit order confirmation, and tool evidence for sensitive claims. Customer GenUI and the final response are produced from persisted tool results and commerce state.`

### 4. What happens if the customer sends another message while the agent is working?

`Channel turns are reserved, briefly coalesced, and assigned to a generation-owned run. A newer turn can supersede an older run only before an irreversible side effect. Stale responses are suppressed. Once an irreversible boundary is recorded, the system protects that execution instead of pretending it can safely rewind it.`

### 5. How does human takeover work?

`The session has an explicit control state. An operator can join, which pauses AI replies; the human can respond in the same channel; then Resume AI returns control with the takeover transcript preserved. We have deterministic tests and a live warning-to-resume artifact, although that live artifact is separate from the ordering demo.`

### 6. How do you evaluate agent quality?

`We separate proof layers: deterministic contracts for gates and tools, scenario replay for end states, live Flutter and GenUI evidence for the customer surface, and live-model or deployed traces for runtime behavior. Logs and outcomes feed the next evaluation cycle. We never combine those layers into one misleading pass-rate number.`

### 7. Did all nine scenarios pass?

`They are nine representative journey designs, not a public pass-rate claim. The current focused deterministic suite is green, and we have a historical nine-scenario local live-UI run, but its source snapshot is not bound. The latest audited full live-model replay was not nine of nine, so we keep those evidence layers separate.`

### 8. What is the source of truth when the model and system disagree?

`Persisted backend state and successful typed tool results win. The planner's text or proposed call is not commerce truth. The cart, fulfillment, order, payment, handoff, tool trace, and events are recorded centrally, and the customer and operator interfaces render those verified results.`

### 9. Can this integrate with KFC's real OMS/POS today?

`We demonstrated the integration shape through replaceable, simulated OMS/POS adapters: typed commands, correlation, idempotency keys, status mapping, and failure handling. We have not connected to KFC production or a named vendor sandbox. Real compatibility requires authoritative contracts, credentials, test stores, webhooks, and vendor conformance evidence.`

### 10. What happens if the POS result is ambiguous or one system fails?

`The simulated layer preserves raw OMS and POS outcomes, classifies conflicts, and attempts defined compensation where appropriate. It does not claim every ambiguous external request is automatically reconciled. Production deployment would require durable retries, vendor idempotency guarantees, reconciliation jobs, alerts, and an owned operations process.`

### 11. Why use GenUI instead of only text?

`Text is useful for intent, but ordering contains structured decisions. GenUI turns verified store, price, ETA, fee, address, payment, and confirmation state into explicit customer actions. That reduces ambiguity while preserving the conversation. It is typed snapshot rendering today, not a claim of A2UI or structural streaming.`

### 12. What is the biggest remaining technical risk?

`The largest proof gap is release-bound live reliability: the exact three-turn combo and upsize path, its latency, and a matching fallback recording are not yet proven on one identified runtime snapshot. Production OMS/POS compatibility and measured business impact also remain intentionally unclaimed.`

## Appendix presentation rules

- Keep `A1` through `A5` after the main deck and reveal them only for relevant questions.
- Use the existing KFC red, black, and warm-white visual system.
- Use one readable visual per appendix slide; do not create dense code screenshots or infrastructure clouds.
- Keep raw file paths, test commands, and detailed claim boundaries in speaker notes, not on the visible slide.
- Each appendix slide must remain answerable in about 20 seconds.
- If a judge asks beyond current evidence, answer directly: what is implemented, what is simulated, and what must still be validated.
