# KFC Customer Run Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the versioned KFC customer-run contracts, safe rollout assignment, and durable sequenced run ledger needed before any Flutter client can enable streaming.

**Architecture:** Keep the existing Messenger/Zalo `AgentRun` model unchanged and introduce a KFC-only `CustomerRun` aggregate. A separate rollout policy selects `legacy` or `stream` before acceptance; streaming runs and events persist through the shared `ConversationStore` implementations for memory, D1, and Postgres. The master rollout mode defaults to `off`, and no HTTP route or Flutter behavior is enabled in this slice.

**Tech Stack:** TypeScript 5.8, Zod 3, Vitest 3, Cloudflare D1-compatible SQL, PostgreSQL.

## Global Constraints

- Use schema version `1` for the first customer-run wire and ledger contract.
- Do not reuse or modify Messenger/Zalo `AgentRun` lifecycle semantics.
- Customer streaming rollout defaults to `off`.
- Synchronous fallback selection occurs before streaming acceptance; this slice does not execute either response path.
- Persist contiguous per-run event sequence and reject stale expected sequence values.
- Keep Messenger, Zalo, Flutter UI, Cue motion, SSE endpoints, executor/queue work, and formal A2UI adoption outside this slice.
- Do not expose raw planner, policy, tool arguments, trace data, or technical errors in customer event payloads.

---

### Task 1: Versioned Customer-Run Contracts

**Files:**
- Create: `services/kfc-agent-backend/src/customerRuns/contracts.ts`
- Test: `services/kfc-agent-backend/test/customerRuns/contracts.test.ts`

**Interfaces:**
- Produces: `CUSTOMER_RUN_SCHEMA_VERSION`, `CustomerRun`, `CustomerRunEvent`, `CustomerRunStartRequest`, `customerRunStartRequestSchema`, `customerRunEventSchema`, and lifecycle/phase/event enums.
- Consumes: Zod only; it must not import API, persistence, graph, or channel code.

- [x] **Step 1: Write failing contract tests**

Cover: exactly one text/action input, required capability metadata, unsupported schema rejection, accepted lifecycle/phase values, event sequence starting at one, and rejection of unknown event types.

- [x] **Step 2: Run the contract test and verify RED**

Run: `npm test -- test/customerRuns/contracts.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: FAIL because `src/customerRuns/contracts.ts` does not exist.

- [x] **Step 3: Implement the minimal Zod-backed contract**

Define these stable shapes:

```ts
type CustomerRunStatus =
  | 'accepted' | 'running' | 'cancelling'
  | 'completed' | 'failed' | 'cancelled' | 'superseded';

type CustomerRunPhase =
  | 'queued' | 'planning' | 'read_only_tool' | 'state_change_tool'
  | 'irreversible_tool' | 'reconciling' | 'response_composition'
  | 'text_delivery' | 'finalizing';

interface CustomerRunEvent {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  sequence: number;
  type: CustomerRunEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
}
```

The start request is a closed object with `schemaVersion`, `sessionId`, `customerId`, `clientMessageId`, client capability metadata, and a discriminated `input` union for text or GenUI action.

- [x] **Step 4: Run the contract test and backend build**

Run: `npm test -- test/customerRuns/contracts.test.ts --maxWorkers=1 --no-file-parallelism && npm run build`

Expected: PASS and TypeScript exit 0.

### Task 2: Server Rollout Assignment With Master-Off Default

**Files:**
- Create: `services/kfc-agent-backend/src/customerRuns/rolloutPolicy.ts`
- Modify: `services/kfc-agent-backend/src/config/env.ts`
- Modify: `services/kfc-agent-backend/src/worker.ts`
- Test: `services/kfc-agent-backend/test/customerRuns/rollout-policy.test.ts`
- Test: `services/kfc-agent-backend/test/config/customer-streaming-env.test.ts`

**Interfaces:**
- Consumes: `CustomerRunStartRequest` client capability fields.
- Produces: `StreamingRolloutPolicy`, `StreamingAssignment`, `createStreamingRolloutPolicy`, and `decideStreamingAssignment`.

- [x] **Step 1: Write failing rollout and environment tests**

Cover: absent config selects `off`; incapable clients select legacy; internal allowlist overrides percentage; cohort selection is stable for the same salted customer/session key; unsupported schema selects legacy; `on` selects stream; provisional GenUI remains separately declared; invalid percentages/config fail parsing.

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- test/customerRuns/rollout-policy.test.ts test/config/customer-streaming-env.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: FAIL because rollout policy and environment fields do not exist.

- [x] **Step 3: Implement minimal policy and configuration parsing**

Use modes `off | internal | cohort | on`, a `0..100` cohort percentage, a non-empty policy revision, an internal allowlist, a stable cohort salt, supported schema min/max, and a provisional-GenUI boolean. Return a reason code with every `legacy | stream` assignment. Do not run an agent or persist assignment in this task.

- [x] **Step 4: Run targeted tests and backend build**

Run: `npm test -- test/customerRuns/rollout-policy.test.ts test/config/customer-streaming-env.test.ts --maxWorkers=1 --no-file-parallelism && npm run build`

Expected: PASS and TypeScript exit 0.

### Task 3: In-Memory Customer-Run Ledger

**Files:**
- Modify: `services/kfc-agent-backend/src/persistence/memoryStore.ts`
- Test: `services/kfc-agent-backend/test/persistence/memory-store.test.ts`

**Interfaces:**
- Produces on `ConversationStore`: `saveStreamingAssignment`, `findStreamingAssignment`, `createCustomerRun`, `getCustomerRun`, `findCustomerRunByRequest`, `appendCustomerRunEvent`, and `listCustomerRunEvents`.
- `appendCustomerRunEvent` consumes `expectedSequence`; it returns the stored envelope and rejects any value other than the run's next sequence.

- [x] **Step 1: Write failing in-memory persistence tests**

Cover: legacy assignment persistence, request identity/fingerprint lookup, idempotent same-run creation, fingerprint conflict, event sequences 1/2, stale expected sequence rejection, unknown run rejection, and event ordering.

- [x] **Step 2: Run the memory-store test and verify RED**

Run: `npm test -- test/persistence/memory-store.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: FAIL because the new store methods do not exist.

- [x] **Step 3: Implement minimal in-memory storage**

Use maps keyed by `(sessionId, clientMessageId)` and `runId`; store the next event sequence on `CustomerRun`. Return the existing run only when its request fingerprint matches, otherwise throw `CustomerRunIdempotencyConflictError`.

- [x] **Step 4: Run memory persistence and contract tests**

Run: `npm test -- test/persistence/memory-store.test.ts test/customerRuns/contracts.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: PASS.

### Task 4: Durable D1 And PostgreSQL Ledger

**Files:**
- Create: `services/kfc-agent-backend/migrations/0005_customer_run_streaming.sql`
- Modify: `services/kfc-agent-backend/src/persistence/d1Store.ts`
- Modify: `services/kfc-agent-backend/src/persistence/postgresStore.ts`
- Modify: `services/kfc-agent-backend/src/persistence/schema.sql`
- Modify: `services/kfc-agent-backend/test/support/fakeD1Database.ts`
- Modify: `services/kfc-agent-backend/test/persistence/d1-store.test.ts`
- Create: `services/kfc-agent-backend/test/persistence/customer-run-schema.test.ts`

**Interfaces:**
- Implements the Task 3 `ConversationStore` methods for D1 and PostgreSQL.
- Creates `customer_streaming_assignments`, `customer_runs`, and `customer_run_events` with unique request and `(run_id, sequence)` constraints.

- [x] **Step 1: Write failing D1 behavior and SQL schema tests**

Exercise the same assignment/idempotency/sequence contract as memory. Assert migration, D1 initialization, and Postgres bootstrap SQL contain the required unique constraints and indexes.

- [x] **Step 2: Run persistence tests and verify RED**

Run: `npm test -- test/persistence/d1-store.test.ts test/persistence/customer-run-schema.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: FAIL because tables and durable methods do not exist.

- [x] **Step 3: Implement D1 and PostgreSQL persistence**

D1 uses an atomic batch guarded by `next_event_sequence`; PostgreSQL uses one data-modifying CTE to compare-and-increment the sequence and insert the event. Both reject a stale expected sequence without writing an event. Extend the fake D1 adapter only for the exact new SQL shapes.

- [x] **Step 4: Run persistence tests, full serial backend tests, and build**

Run: `npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts test/persistence/customer-run-schema.test.ts test/customerRuns/contracts.test.ts test/customerRuns/rollout-policy.test.ts test/config/customer-streaming-env.test.ts --maxWorkers=1 --no-file-parallelism && npm test -- --maxWorkers=1 --no-file-parallelism && npm run build`

Expected: all tests pass and TypeScript exits 0.

### Task 5: Foundation Review And Disabled-State Proof

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-kfc-customer-run-foundation.md` (check completed steps only)

**Interfaces:**
- Verifies no API route or Flutter feature is enabled by this slice.

- [x] **Step 1: Inspect the diff against the Wayfinder contracts**

Confirm: separate KFC model, schema v1, master off, persisted assignment, request fingerprint uniqueness, contiguous run events, no dashboard event reuse, and no product-facing route/UI change.

- [x] **Step 2: Run final verification**

Run: `git diff --check && npm test -- --maxWorkers=1 --no-file-parallelism && npm run build`

Expected: zero whitespace errors, zero failed tests, and build exit 0.

- [x] **Step 3: Record remaining boundary**

The next plan begins with the idempotent `POST /chat/kfc/runs` start route, durable dispatch/outbox, executor ownership, replay/long-poll transport, and Stop. Do not implement those in this foundation plan.
