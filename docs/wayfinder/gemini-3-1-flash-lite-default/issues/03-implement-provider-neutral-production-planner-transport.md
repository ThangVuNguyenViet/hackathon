Status: resolved
Type: task
Labels: wayfinder:task
Parent: ../map.md
Blocked by: 02-prove-vertex-gemini-3-1-runtime-contract.md
Assignee: Codex

## Question

Implement the minimum provider-neutral production planner transport so the existing planner behavior can use OpenAI Responses or Vertex Chat Completions without duplicating planner logic. Add the verified Vertex credential refresh, strict structured-output mapping, minimal thinking, response extraction, usage telemetry, and model-neutral configuration/readiness reporting. Keep GPT-4.1 as the configured default and deployment rollback. What exact code and checks prove both transports preserve the same planner contract?

## Answer

`services/kfc-agent-backend/src/llm/vertexPlannerTransport.ts` is the only provider-specific planner seam. It validates the service-account secret, mints and caches scoped OAuth tokens with native Web Crypto, refreshes expiring tokens, preserves abort signals, maps the existing Responses request into Vertex `global` Chat Completions, carries strict JSON Schema formats unchanged, configures `thinking_level=minimal`, deliberately omits Gemini temperature/output-token limits, and normalizes Vertex text, errors, and usage back into the existing Responses envelope.

The production planner, classifiers, normalization, validation, retries, and behavior guards remain shared. `serverOptions.ts` selects the transport from `TOOL_PLANNER_PROVIDER`, while model-neutral model variables and readiness output report the configured provider/model without exposing `VERTEX_SERVICE_ACCOUNT_JSON`. OpenAI and the existing GPT-4.1 variables remain the defaults and deployment rollback. The arena reuses the same Responses-to-Chat-Completions mapping.

Checks:

- `npm run build` passed.
- `npm run worker:deploy:dry-run` passed.
- The focused transport/config/readiness regression passed 47/47.
- The full deterministic suite passed 884/884 non-live tests. A later rerun exposed one unrelated `ambiguous_pos_submission` proof race with 883 other passes; its isolated rerun passed 2/2.
- `test/llm/vertex-planner-transport.test.ts` covers strict mapping, uncapped minimal thinking, OAuth refresh, abort propagation, response/usage extraction, array errors, invalid credentials, and the shared planner output contract.
- The inherited 936-line `toolPlanner.ts` keeps `check:architecture` red and was not modified. The new transport is 227 lines; deduplicating Worker config reduced `worker.ts` from 917 to 863 lines.

PR #20 and its quota-invalidated live proof were not integrated or used as evidence.
