# Task 4 Report

## Implementation summary

- Added [`services/kfc-agent-backend/src/ordering/toolCatalog.ts`](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/src/ordering/toolCatalog.ts) with strict `zod` argument schemas for every defined ordering tool and a shared parser.
- Added [`services/kfc-agent-backend/src/ordering/toolExecutor.ts`](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/src/ordering/toolExecutor.ts) to validate requests, dispatch tool calls through `ExternalClients`, enforce required runtime context for cart/address/order/session dependent tools, and preserve fixture provenance from client results.
- Added [`services/kfc-agent-backend/src/ordering/safetyGates.ts`](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/src/ordering/safetyGates.ts) to block unsafe preview/place flows without valid fulfillment, block order placement without explicit confirmation, require promotion evidence for promo claims, require paid payment evidence for payment-success claims, and reject allergen certainty claims.
- Added focused tests in [`services/kfc-agent-backend/test/ordering/tool-executor.test.ts`](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/test/ordering/tool-executor.test.ts) and [`services/kfc-agent-backend/test/ordering/safety-gates.test.ts`](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/test/ordering/safety-gates.test.ts).

## Tests and outputs

Initial expected failure before implementation:

```text
$ cd services/kfc-agent-backend
$ npm test -- --run test/ordering/tool-executor.test.ts test/ordering/safety-gates.test.ts
FAIL test/ordering/safety-gates.test.ts
Error: Cannot find module '../../src/ordering/safetyGates.js'
FAIL test/ordering/tool-executor.test.ts
Error: Cannot find module '../../src/ordering/toolExecutor.js'
```

Passing focused tests after implementation:

```text
$ cd services/kfc-agent-backend
$ npm test -- --run test/ordering/tool-executor.test.ts test/ordering/safety-gates.test.ts
Test Files  2 passed (2)
Tests       6 passed (6)
```

Backend build:

```text
$ cd services/kfc-agent-backend
$ npm run build
tsc -p tsconfig.json
```

## Files changed

- `services/kfc-agent-backend/src/ordering/toolCatalog.ts`
- `services/kfc-agent-backend/src/ordering/toolExecutor.ts`
- `services/kfc-agent-backend/src/ordering/safetyGates.ts`
- `services/kfc-agent-backend/test/ordering/tool-executor.test.ts`
- `services/kfc-agent-backend/test/ordering/safety-gates.test.ts`

## Self-review findings

- Scope stayed inside the Task 4 backend catalog/executor/gates files plus the two focused tests.
- Tool execution goes through `ExternalClients`; it does not reach into fixture files or `OrderingDataService` directly.
- Voucher validation intentionally uses `PromotionClient.validateVoucherInput`, including a synthetic subtotal-only cart when no runtime cart exists, so the backend does not invent successful promo redemption.
- Safety gates report multiple applicable blockers for the same planned call, which matches the confirmation and fulfillment constraints better than short-circuiting on the first failure.

## Concerns

- The brief mixed two executor shapes: prose said it consumes `AgentGraphState`, while sample tests called it directly with only `(clients, request)`. The implementation supports both forms to avoid forcing planner work into Task 4.

## Review fix addendum (2026-07-08)

### Findings fixed

- Critical 1: Tightened `payment_success` gating so `createPaymentLink` no longer counts as success evidence. The gate now requires a successful `checkPaymentStatus` trace and `state.paymentAttempt.status === 'paid'`.
- Important 2: Shifted the focused executor coverage to the state-centric contract (`executeToolCall(clients, state, request)`), while preserving the direct request shape only as a compatibility adapter test.
- Important 3: Removed preview-backed payment-link creation. `createPaymentLink` now requires a created order from `state.order` or explicit executor context `order`, not `orderPreview`.
- Minor 4: Added focused tests for the state-centric executor path and for propagation of failing client results from `checkPaymentStatus`.

### Changed files

- `services/kfc-agent-backend/src/ordering/toolExecutor.ts`
- `services/kfc-agent-backend/src/ordering/safetyGates.ts`
- `services/kfc-agent-backend/test/ordering/tool-executor.test.ts`
- `services/kfc-agent-backend/test/ordering/safety-gates.test.ts`

### Commands run

```text
$ cd services/kfc-agent-backend && npm test -- --run test/ordering/tool-executor.test.ts test/ordering/safety-gates.test.ts

> kfc-agent-backend@0.1.0 test
> vitest run --run test/ordering/tool-executor.test.ts test/ordering/safety-gates.test.ts

 RUN  v3.2.7 /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend

 ✓ test/ordering/safety-gates.test.ts (5 tests) 3ms
 ✓ test/ordering/tool-executor.test.ts (5 tests) 4ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Duration  239ms
```

```text
$ cd services/kfc-agent-backend && npm run build

> kfc-agent-backend@0.1.0 build
> tsc -p tsconfig.json
```

### Outputs summary

- Focused Task 4 test suite passed with 10/10 tests green.
- Backend TypeScript build completed successfully with `tsc -p tsconfig.json`.
