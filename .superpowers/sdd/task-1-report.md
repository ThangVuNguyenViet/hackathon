# Task 1 Report: Add Ordering Domain Types And Graph State

## Implementation summary

- Added `services/kfc-agent-backend/src/ordering/types.ts` with the ordering-domain DTOs and contracts required by Task 1:
  - `SourceProvenance`
  - `ToolTraceEntry`
  - `FulfillmentState`
  - `PromotionContext`
  - `ContentEvidence`
  - `SelectedModifier`
  - `ToolCallRequest`
  - `ToolCallResult`
- Kept the new ordering contracts aligned with existing shared domain contracts by consuming `Address`, `Cart`, `MenuItem`, `Order`, and `ToolResult` from `src/domain/types.ts`.
- Extended `services/kfc-agent-backend/src/graph/state.ts` so `AgentGraphState` can carry ordering entities, modifiers, fulfillment, promotions, content evidence, customer context, payment attempt, invoice request, handoff state, and tool trace entries.
- Added the focused contract test in `services/kfc-agent-backend/test/domain/contracts.test.ts` that models fixture-backed fulfillment, promotion, content evidence, and tool trace data inside `AgentGraphState`.

## Tests and outputs

### 1. Brief-prescribed failing test run

Command:

```bash
cd services/kfc-agent-backend
npm test -- --run test/domain/contracts.test.ts
```

Observed output:

```text
RUN  v3.2.7 /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
✓ test/domain/contracts.test.ts (4 tests)
Test Files  1 passed (1)
Tests  4 passed (4)
```

Note:
- The brief expected this step to fail before implementation.
- In this repo, the current `vitest run` path does not type-check type-only imports, so that command passed even before `src/ordering/types.ts` existed and before `AgentGraphState` had the new optional fields.

### 2. Focused contract test after implementation

Command:

```bash
cd services/kfc-agent-backend
npm test -- --run test/domain/contracts.test.ts
```

Observed output:

```text
RUN  v3.2.7 /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
✓ test/domain/contracts.test.ts (4 tests)
Test Files  1 passed (1)
Tests  4 passed (4)
```

### 3. Backend build / type validation

Command:

```bash
cd services/kfc-agent-backend
npm run build
```

Observed output:

```text
> kfc-agent-backend@0.1.0 build
> tsc -p tsconfig.json
```

Result:
- Passed after one narrow test fix to avoid dereferencing optional `promotionContext.validation` without narrowing.

## Files changed

- `services/kfc-agent-backend/src/ordering/types.ts`
- `services/kfc-agent-backend/src/graph/state.ts`
- `services/kfc-agent-backend/test/domain/contracts.test.ts`

## Self-review findings

- Scope stayed within Task 1: domain ordering types, graph state contract updates, and one focused contract test.
- No service/client/planner/tool execution/orchestration logic was added.
- `ToolCallResult` extends the existing shared `ToolResult<unknown>` contract so the new ordering layer reuses the existing success/error shape instead of duplicating it.
- The new graph state fields are optional, which keeps existing call sites compatible for later tasks.

## Concerns

- The brief’s prescribed “failing test before implementation” step is not enforceable with the current `vitest run` setup because type-only import problems are not caught there. `npm run build` is currently the reliable contract/type gate for this task.

## Review fix: enforceable ordering contract gate

Reviewer finding:
- The Task 1 contract test was not an enforceable type-contract gate because it depended on `import type` and runtime object literals only, so `vitest run` would not prove that `src/ordering/types.ts` actually resolved at runtime.

Fix applied:
- Added runtime export `TOOL_NAMES` in `services/kfc-agent-backend/src/ordering/types.ts` and derived `ToolName` from that readonly tuple, so the source of truth stays in one place and Vitest now has a real runtime module-resolution edge to the ordering contract module.
- Updated `services/kfc-agent-backend/test/domain/contracts.test.ts` to import and assert `TOOL_NAMES`, and switched the new ordering fixtures plus graph state fixture to `satisfies`-based compile-time checks for explicit contract coverage.
- Kept Task 1 scope limited to ordering domain types, graph state shape, and the focused contract test. No services, clients, tools, planner logic, or graph orchestration were added.
- Documented the gate split: `npm test -- --run test/domain/contracts.test.ts` now proves the runtime module edge for `src/ordering/types.ts`, while `npm run build` remains the required type gate for `AgentGraphState` coverage because Vitest does not type-check.

Changed files:
- `services/kfc-agent-backend/src/ordering/types.ts`
- `services/kfc-agent-backend/test/domain/contracts.test.ts`
- `.superpowers/sdd/task-1-report.md`

Commands and outputs:

1. Focused contract test

Command:

```bash
cd services/kfc-agent-backend
npm test -- --run test/domain/contracts.test.ts
```

Output:

```text
> kfc-agent-backend@0.1.0 test
> vitest run --run test/domain/contracts.test.ts

RUN  v3.2.7 /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
✓ test/domain/contracts.test.ts (4 tests) 2ms

Test Files  1 passed (1)
Tests  4 passed (4)
Start at  02:09:53
Duration  258ms (transform 32ms, setup 0ms, collect 23ms, tests 2ms, environment 0ms, prepare 56ms)
```

2. TypeScript build

Command:

```bash
cd services/kfc-agent-backend
npm run build
```

Output:

```text
> kfc-agent-backend@0.1.0 build
> tsc -p tsconfig.json
```
