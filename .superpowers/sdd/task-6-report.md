# Task 6 Report

## Implementation Summary
- Replaced the phrase-matched production flow in `services/kfc-agent-backend/src/graph/buildGraph.ts` with a planner-driven tool loop that:
  - loads recent turns,
  - asks `ToolPlanner` for intent/entities/tool calls,
  - applies `applySafetyGates` before and after tool execution,
  - executes allowed tools through `executeToolCall`,
  - reduces verified tool results into graph state,
  - stores `toolTrace`,
  - emits dashboard/session updates from verified state only.
- Added cart bootstrap for planner-driven `updateCart` so the executor still works against a real cart object.
- Persisted fulfillment address from `quoteFulfillment` arguments into state so later `previewOrder` calls can satisfy executor requirements.
- Updated `services/kfc-agent-backend/src/llm/responseComposer.ts` prompt payload to use `verifiedFallback` and include `toolTrace`, `fulfillment`, `promotionContext`, and `contentEvidence`, with an explicit no-invention guardrail.

## Tests and Outputs
- RED:
  - `cd services/kfc-agent-backend && npm test -- --run test/graph/ai-tool-graph.test.ts test/graph/order-confirmation.test.ts`
  - Failed with missing `toolTrace`, missing `order_confirmation_required`, and hardcoded voucher behavior still active.
- GREEN:
  - `cd services/kfc-agent-backend && npm test -- --run test/graph/ai-tool-graph.test.ts test/graph/order-confirmation.test.ts`
  - Passed: `2` files, `9` tests.
- Additional verification:
  - `cd services/kfc-agent-backend && npm test -- --run test/graph/ai-tool-graph.test.ts test/graph/order-confirmation.test.ts test/llm/response-composer.test.ts`
  - Passed: `3` files, `11` tests.
  - `cd services/kfc-agent-backend && npm run build`
  - Passed.
- Constraint search:
  - `rg -n "scenarioOneCart|scenarioOneAddress|scenarioOneOrder|store_mock_nearest|voucherCode === 'KFC50'|lower\\.includes\\('sunrise city'|applyScenarioEvent" services/kfc-agent-backend/src`
  - Matches remain only in `services/kfc-agent-backend/src/scenarios/runner.ts`.

## Files Changed
- `services/kfc-agent-backend/src/graph/buildGraph.ts`
- `services/kfc-agent-backend/src/llm/responseComposer.ts`
- `services/kfc-agent-backend/test/graph/order-confirmation.test.ts`
- `services/kfc-agent-backend/test/graph/ai-tool-graph.test.ts`
- `services/kfc-agent-backend/test/llm/response-composer.test.ts`

## Self-Review Findings
- Fixed one real follow-up issue during review: the planner path now persists `quoteFulfillment` address input into `state.address` so later order preview/order placement flows have the verified fulfillment address available.
- Kept changes inside Task 6 backend graph/composer/test scope and did not touch scenario replay, dashboard read models, or app artifacts.

## Concerns
- The brief’s banned-pattern grep still reports matches in `services/kfc-agent-backend/src/scenarios/runner.ts`. I did not modify that file because the task instructions explicitly excluded scenario replay scope.

## Review Fix Follow-up (2026-07-08)

### Findings Fixed
- Wired production env-backed server options to instantiate `OpenAIToolPlanner` whenever `OPENAI_API_KEY` is present, reusing `OPENAI_MODEL` and `OPENAI_BASE_URL` exactly like the response composer.
- Stopped planner-authored `directResponse` from leaking when safety gates block a tool call or response claim. The graph now falls back to verified deterministic text keyed off blocked reasons such as missing confirmation, missing fulfillment verification, unsupported promotion claims, unverified payment success, and allergen certainty.
- Removed deterministic payment-method backfill from `checkPaymentStatus`; payment status can update without inventing `momo`.
- Added the minimal Task 6 scenario seam only: `runScenario(..., { toolPlanner })` now passes an optional planner through to `runAgentTurn` without replacing scenario injection logic.
- Added API/runtime coverage proving `/chat/mock` works with an injected planner and returns planner-backed `cart` and `toolTrace`.

### Changed Files
- `services/kfc-agent-backend/src/api/serverOptions.ts`
- `services/kfc-agent-backend/src/graph/buildGraph.ts`
- `services/kfc-agent-backend/src/ordering/types.ts`
- `services/kfc-agent-backend/src/scenarios/runner.ts`
- `services/kfc-agent-backend/test/api/chat.test.ts`
- `services/kfc-agent-backend/test/api/server-options.test.ts`
- `services/kfc-agent-backend/test/graph/ai-tool-graph.test.ts`

### Commands Run
- `cd services/kfc-agent-backend && npm test -- --run test/graph/ai-tool-graph.test.ts test/graph/order-confirmation.test.ts test/llm/response-composer.test.ts test/api/chat.test.ts`
  - Output: `Test Files 4 passed (4)`, `Tests 17 passed (17)`.
- `cd services/kfc-agent-backend && npm run build`
  - Output: `tsc -p tsconfig.json` completed successfully with exit code `0`.
- `rg -n "scenarioOneCart|scenarioOneAddress|scenarioOneOrder|store_mock_nearest|voucherCode === 'KFC50'|lower\\.includes\\('sunrise city'|deterministicFallback" services/kfc-agent-backend/src/graph services/kfc-agent-backend/src/llm services/kfc-agent-backend/test/graph`
  - Output: no matches, exit code `1`.
- Extra verification:
  - `cd services/kfc-agent-backend && npm test -- --run test/api/server-options.test.ts`
  - Output: `Test Files 1 passed (1)`, `Tests 2 passed (2)`.

### Notes
- I left the broader scenario replay replacement out of scope. Task 7 still owns removing the scenario-side injection path; Task 6 now only exposes the optional planner seam so that follow-up work can thread a planner through without another graph signature change.
