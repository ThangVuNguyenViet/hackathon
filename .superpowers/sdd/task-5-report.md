# Task 5 Report

## Implementation Summary

- Added `services/kfc-agent-backend/src/llm/toolPlanner.ts` with the Task 5 planner contract:
  - `ToolPlanner`, `ToolPlannerInput`, `ToolPlannerOutput`
  - `StaticToolPlanner` for queued test plans
  - `OpenAIToolPlanner` for OpenAI Responses-backed JSON planning
- Wired the planner seam into API route options in `services/kfc-agent-backend/src/api/routes.ts`.
- Added the matching optional `toolPlanner` field to `AgentTurnInput` in `services/kfc-agent-backend/src/graph/buildGraph.ts` so routes can pass the planner without changing current graph behavior.
- Left `services/kfc-agent-backend/src/api/serverOptions.ts` unchanged because it already mirrors `RouteOptions` through `BuildServerOptions = RouteOptions`; no extra type surface was required there.

## Tests And Outputs

- `cd services/kfc-agent-backend && npm test -- --run test/llm/tool-planner.test.ts`
  - Initial red run before implementation: failed with `Cannot find module '../../src/llm/toolPlanner.js'`
  - Post-implementation run: passed, `1 passed`, `2 passed`
- `cd services/kfc-agent-backend && npm run build`
  - Passed
- `git diff --check -- services/kfc-agent-backend/src/api/routes.ts services/kfc-agent-backend/src/graph/buildGraph.ts services/kfc-agent-backend/src/llm/toolPlanner.ts services/kfc-agent-backend/test/llm/tool-planner.test.ts`
  - Passed with no output

## Files Changed

- `services/kfc-agent-backend/src/llm/toolPlanner.ts`
- `services/kfc-agent-backend/src/api/routes.ts`
- `services/kfc-agent-backend/src/graph/buildGraph.ts`
- `services/kfc-agent-backend/test/llm/tool-planner.test.ts`
- `.superpowers/sdd/task-5-report.md`

## Self-Review Findings

- Scope stayed within the Task 5 planner seam and focused tests.
- No deterministic ordering flow was added.
- The graph does not consume the planner yet; the seam is intentionally wired only through route/input types, which matches the brief and avoids replacing later graph work.

## Concerns

- No functional concern. One implementation detail to note: `buildGraph.ts` needed a minimal type-only change so `runAgentTurn` can accept the new optional planner field passed from routes.

## Review Fix - 2026-07-08

### Findings Fixed

- Important: `OpenAIToolPlanner` now validates every model-proposed `toolName` against both the canonical tool catalog and the request-scoped `input.availableTools` before returning any `toolCalls`.
- Important: unknown or unavailable tool names now throw clear planner errors instead of being cast to `ToolCallRequest[]`.
- Minor: planner text extraction now trims output and rejects whitespace-only responses with `OpenAI tool planning returned no text`.
- Minor: focused tests now cover unknown tool names, unavailable tool names, blank output text, and OpenAI HTTP error propagation.

### Changed Files

- `services/kfc-agent-backend/src/llm/toolPlanner.ts`
- `services/kfc-agent-backend/test/llm/tool-planner.test.ts`
- `.superpowers/sdd/task-5-report.md`

### Commands

- `cd services/kfc-agent-backend && npm test -- --run test/llm/tool-planner.test.ts`
- `cd services/kfc-agent-backend && npm run build`

### Outputs

- `npm test -- --run test/llm/tool-planner.test.ts`
  - Passed: `Test Files 1 passed (1)`, `Tests 6 passed (6)`
- `npm run build`
  - Passed: `tsc -p tsconfig.json`
