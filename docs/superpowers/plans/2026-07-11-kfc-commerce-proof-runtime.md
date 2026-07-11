# KFC Commerce Proof Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one repeatable backend proof that a KFC customer answer causes an AI commerce tool to call a separate Demo Commerce Gateway, Mock OMS, and Mock POS with correlated observable results.

**Architecture:** Preserve the existing agent-facing `OmsClient` and add a project-owned versioned commerce-proof contract. Three focused Fastify builders expose Mock OMS, Mock POS, and Gateway HTTP boundaries; a proof runner starts them with the agent backend, collects temporary trace events, runs eight deterministic scenarios, evaluates them, writes a manifest, and shuts down all processes.

**Tech Stack:** TypeScript, Node.js 22, Fastify 5, Zod 3, Vitest 3, LangSmith SDK, existing Flutter backend-backed `integration_test` in a later visual-proof plan.

---

## File Structure

- `src/commerceProof/contracts.ts`: versioned Zod schemas and inferred DTOs shared by clients and services.
- `src/commerceProof/traceEvents.ts`: safe trace-event schema, event vocabulary, and redaction validation.
- `src/commerceProof/scenarios.ts`: eight scenario IDs and deterministic mock behavior definitions.
- `src/commerceProof/mockOmsServer.ts`: authenticated Mock OMS HTTP service and scenario controls.
- `src/commerceProof/mockPosServer.ts`: authenticated Mock POS HTTP service and scenario controls.
- `src/commerceProof/httpClients.ts`: validated OMS/POS HTTP clients with timeout and trace propagation.
- `src/commerceProof/gatewayServer.ts`: gateway orchestration, correlation, duplicate suppression, cancellation, and readiness.
- `src/commerceProof/traceCollector.ts`: runner-owned in-memory event collector.
- `src/commerceProof/evaluators.ts`: deterministic scenario evaluators.
- `src/commerceProof/proofRunner.ts`: service lifecycle, scenario execution, artifact output, and shutdown.
- `scripts/run-mock-commerce-proof.ts`: CLI entry point.
- `test/commerceProof/*.test.ts`: unit, contract, component, evaluator, and runner tests.

### Task 1: Versioned Domain And Trace Contracts

**Files:**
- Create: `services/kfc-agent-backend/src/commerceProof/contracts.ts`
- Create: `services/kfc-agent-backend/src/commerceProof/traceEvents.ts`
- Create: `services/kfc-agent-backend/test/commerceProof/contracts.test.ts`

- [x] **Step 1: Write failing schema tests**

Test that a valid command/result carries `traceId`, `sessionId`, `clientMessageId`, `idempotencyKey`, `commerceOrderId`, `omsOrderId`, `posTicketId`, raw statuses, derived customer status, and independent simulation labels. Test rejection of missing trace IDs, unknown statuses, secrets, and customer PII in trace summaries.

- [x] **Step 2: Verify red**

Run `npm test -- test/commerceProof/contracts.test.ts --maxWorkers=1 --no-file-parallelism` and expect module-not-found failure.

- [x] **Step 3: Implement minimal schemas**

Export `commerceContractVersion = "kfc-commerce-proof-v1"`, Zod schemas, inferred types, the eleven ordered event names, and `safeTraceEventSchema`. Keep customer cart/fulfillment payloads summarized rather than copying the existing full `Order` shape into trace events.

- [x] **Step 4: Verify green and build**

Run the focused test and `npm run build`; expect both to pass.

- [x] **Step 5: Commit**

Commit as `feat: define commerce proof contracts`.

### Task 2: Deterministic Mock OMS Service

**Files:**
- Create: `services/kfc-agent-backend/src/commerceProof/scenarios.ts`
- Create: `services/kfc-agent-backend/src/commerceProof/mockOmsServer.ts`
- Create: `services/kfc-agent-backend/test/commerceProof/mock-oms-server.test.ts`

- [x] **Step 1: Write failing HTTP contract tests**

Cover `/health`, `/ready`, bearer authentication, `POST /v1/orders/preview`, `POST /v1/orders`, `GET /v1/orders/:omsOrderId`, `POST /v1/orders/:omsOrderId/cancel`, idempotent reuse, and admin-token-only `PUT /__admin/scenarios/:scenarioId`.

- [x] **Step 2: Verify red**

Run the focused test and expect the server builder import to fail.

- [x] **Step 3: Implement the in-memory mock**

Use per-server maps only for the proof run. Return `service`, `contractVersion`, and `dependencyClass: "simulated"`; generate deterministic `OMS-####` IDs; apply fixed success, cancellation-failure, delay, and conflicting-state controls keyed by scenario and operation.

- [x] **Step 4: Verify green and build**

Run the focused test and TypeScript build.

- [x] **Step 5: Commit**

Commit as `feat: add mock OMS proof service`.

### Task 3: Deterministic Mock POS Service

**Files:**
- Create: `services/kfc-agent-backend/src/commerceProof/mockPosServer.ts`
- Create: `services/kfc-agent-backend/test/commerceProof/mock-pos-server.test.ts`
- Preserve: `services/kfc-agent-backend/src/commerce/mockPosServer.ts`

- [x] **Step 1: Write failing HTTP contract tests**

Cover health/readiness, auth, submit/status/cancel routes, required `Idempotency-Key`, correlation fields, duplicate reuse, rejection, five-second delay, cancellation failure, and scenario isolation.

- [x] **Step 2: Verify red**

Run the focused test and expect the new builder import to fail.

- [x] **Step 3: Implement and preserve compatibility**

Implement the v1 proof server under `commerceProof`; retain the old `buildMockPosServer` unchanged because its existing tests and scripts remain valid.

- [x] **Step 4: Verify green and regression tests**

Run the focused test, `test/commerce/pos-capability.test.ts`, and build.

- [x] **Step 5: Commit**

Commit as `feat: add versioned mock POS proof service`.

### Task 4: Validated HTTP Clients And Gateway

**Files:**
- Create: `services/kfc-agent-backend/src/commerceProof/httpClients.ts`
- Create: `services/kfc-agent-backend/src/commerceProof/gatewayServer.ts`
- Create: `services/kfc-agent-backend/test/commerceProof/gateway-server.test.ts`
- Modify: `services/kfc-agent-backend/src/clients/kfcCommerceGateway.ts`

- [ ] **Step 1: Write failing component tests**

Start real Mock OMS/POS servers and assert success correlation, duplicate suppression without downstream calls, rejection compensation, failed compensation truthfulness, POS timeout as `ambiguous_pos_submission`, POS-first cancellation, partial cancellation, and conflicting raw states.

- [ ] **Step 2: Verify red**

Run the focused test and expect the gateway builder import to fail.

- [ ] **Step 3: Implement clients and gateway**

Validate every response with Zod, apply a three-second `AbortSignal.timeout`, propagate `X-Trace-Id` and LangSmith headers, derive customer status without overwriting source status, and keep idempotency memory scoped to one gateway process.

- [ ] **Step 4: Adapt the existing agent client**

Map the stable gateway result back to existing `ToolResult<Order>` without exposing vendor-specific DTOs. Preserve current payment routes and error codes.

- [ ] **Step 5: Verify green and regressions**

Run gateway, existing gateway-client, POS capability tests, and build.

- [ ] **Step 6: Commit**

Commit as `feat: orchestrate mock OMS and POS through gateway`.

### Task 5: Deep Readiness And Temporary Trace Collector

**Files:**
- Create: `services/kfc-agent-backend/src/commerceProof/traceCollector.ts`
- Create: `services/kfc-agent-backend/test/commerceProof/trace-collector.test.ts`
- Modify: `services/kfc-agent-backend/src/api/routeHandlers.ts`
- Modify: `services/kfc-agent-backend/src/api/serverOptions.ts`
- Modify: `services/kfc-agent-backend/test/api/health.test.ts`

- [ ] **Step 1: Write failing readiness and collector tests**

Require `configured`, `reachable`, `authenticated`, `dependencyClass`, `latencyMs`, and status. Prove configuration-only gateway mode is not ready, simulated gateway is not labelled production, collector sequence is monotonic, invalid tokens fail, and PII/secrets are rejected.

- [ ] **Step 2: Verify red**

Run focused health and collector tests; expect the new fields/collector to be missing.

- [ ] **Step 3: Implement deep checks and collector**

Use side-effect-free health calls, bounded timeouts, explicit dependency classification, and a loopback-only Fastify collector keyed by `runId` and `traceId`.

- [ ] **Step 4: Verify green and regressions**

Run focused tests, all API tests, and build.

- [ ] **Step 5: Commit**

Commit as `feat: add commerce proof readiness and tracing`.

### Task 6: Deterministic Evaluators And Four-Service Runner

**Files:**
- Create: `services/kfc-agent-backend/src/commerceProof/evaluators.ts`
- Create: `services/kfc-agent-backend/src/commerceProof/proofRunner.ts`
- Create: `services/kfc-agent-backend/scripts/run-mock-commerce-proof.ts`
- Create: `services/kfc-agent-backend/test/commerceProof/evaluators.test.ts`
- Create: `services/kfc-agent-backend/test/commerceProof/proof-runner.test.ts`
- Modify: `services/kfc-agent-backend/package.json`

- [ ] **Step 1: Write failing evaluator tests**

Assert tool selection/arguments, hop order, trace continuity, identifier correlation, simulation labels, timeout/conflict, duplicate suppression, compensation truthfulness, response grounding, GenUI kind, and disabled KFC human controls.

- [ ] **Step 2: Verify red and implement evaluators**

Run the focused test, observe module failure, implement boolean scores plus explicit failure messages, and rerun green.

- [ ] **Step 3: Write failing runner test**

Run the proof in a temporary artifact directory and assert eight scenario directories, readiness/provenance, no secret leakage, complete shutdown, and overall pass. Use deterministic planner/composer dependencies in this component test; do not create a mock Flutter integration test.

- [ ] **Step 4: Implement runner and CLI**

Start services on ephemeral loopback ports, poll readiness, configure scenarios sequentially, invoke the normal backend KFC route, collect evidence, emit `not_run|passed|failed|not_applicable`, support `--require-langsmith`, and close services in `finally`.

- [ ] **Step 5: Verify green**

Run runner/evaluator tests and `npm run proof:commerce:mock`; expect eight passing scenarios and a manifest path.

- [ ] **Step 6: Commit**

Commit as `feat: add mock commerce proof runner`.

### Task 7: Full Verification And Documentation

**Files:**
- Modify: `services/kfc-agent-backend/README.md`
- Modify: `docs/wayfinder/kfc-oms-pos-integration-capability/map.md`

- [ ] **Step 1: Document exact proof commands and claim boundary**

Document default local mode, `--require-langsmith`, artifact layout, four simulated services, and the exact allowed claim. State that no Patrol or mock-backed Flutter integration test is used.

- [ ] **Step 2: Run full backend verification**

Run `npm run build` and `npm test -- --maxWorkers=1 --no-file-parallelism`; expect zero failures.

- [ ] **Step 3: Run the local proof**

Run `npm run proof:commerce:mock`; inspect the manifest, readiness, eight traces, evaluator results, and process cleanup.

- [ ] **Step 4: Inspect repository hygiene**

Verify generated artifacts are ignored or intentionally excluded, no credentials appear in tracked files, and only scoped source/docs/tests are changed.

- [ ] **Step 5: Commit**

Commit as `docs: document mock commerce proof runtime`.
