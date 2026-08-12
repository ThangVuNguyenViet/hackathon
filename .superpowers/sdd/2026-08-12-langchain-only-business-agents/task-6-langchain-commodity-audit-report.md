# Task 6 — LangChain commodity audit report

## Result

The accepted KFC/PVCFC runtime now uses only supported public LangSmith/LangChain tracing integration. The former `LangChainTracer` proxy and its private run-construction/run-map lifecycle forwarding are gone. KFC executes the real `createAgent` call beneath the application-owned turn `RunTree` using `withRunTree`; LangChain automatic Runnable tracing supplies the createAgent/model/tool hierarchy and correlation. The small `AgentTracer` facade remains for application lifecycle spans, fail-open diagnostics, injected tests, deferred flush, and non-LangChain child spans.

No OpenAI SDK or explicit LangGraph runtime was introduced. `@langchain/openai` remains only a supported LangChain model integration. KFC and PVCFC business tools, policies, evidence validation, authorization, confirmation, idempotency, effects, persistence, delivery, and presentation remain application/domain authority.

## Before/after LOC and API map

| Area | Before | After |
| --- | ---: | ---: |
| `observability/langsmithAgentTracer.ts` | 463 LOC | 217 LOC |
| `observability/agentTracing.ts` | 171 LOC | 175 LOC |
| Private lifecycle proxy/coordinator | `NativeLifecycleCoordinator`, `NativeLifecycleLangChainTracer`, private create/run-map forwarding | deleted |
| LangSmith primitives | `RunTree` plus private `LangChainTracer` proxy | public `RunTree`, `withRunTree`, `getLangchainCallbacks`, `awaitAllCallbacks` |
| KFC createAgent correlation | application turn existed, createAgent/model/tool loop was not connected | automatic Runnable tracing under the active application `RunTree`; explicit trusted callbacks remain available for direct pack injection/tests |
| Dead helpers | unused direct OpenAI HTTP diagnostics and unused environment-mutating scenario trace recorder | deleted with their isolated tests |

The supported tracer implementation shrinks by 246 lines while adding explicit bounded metadata/tag filtering and preserving root/child spans, transport injection, failure recording, deferred flush, and public callback access.

## RED evidence

The architecture guard was expanded before production changes. It failed exactly on the active private API families:

```text
npx vitest run test/architecture/langchain-only-production-runtime.test.ts

FAIL 1 test
src/observability/langsmithAgentTracer.ts: private LangChain tracer run creation
src/observability/langsmithAgentTracer.ts: private LangChain tracer run-map mutation
```

The KFC pack correlation test was also written before wiring callbacks. It invoked the real `createAgent` path and failed because no chain/model callback event was observed:

```text
FAIL nests the createAgent and model runs under the application trace callback parent
expected false to be true
```

The bounded default diagnostic test was RED because tracing failures were fail-open but silent:

```text
FAIL emits only a bounded diagnostic code when no local diagnostic sink is injected
expected "warn" to be called once, but got 0 times
```

## Public trace hierarchy and fail-open proof

Production starts `kfc_langchain_turn` as the application root. `withRunTree` makes that root active for exactly the `KfcAgentPack.runTurn`/`createAgent` execution. LangChain's maintained callback manager detects the active public RunTree and creates the agent, middleware, model, and tool descendants. Production deliberately does not combine an explicit callback manager with active RunTree context: that combination produced duplicate native lifecycle end events in the installed versions. Context-only automatic tracing is the supported single path.

The injected-transport integration test proves:

- the application root and children carry one trace ID;
- a createAgent child has the application root as its direct parent;
- an LLM run is present in the same hierarchy;
- public request metadata cannot inject `scenarioId`, `probeRunId`, or arbitrary customer payload into trusted trace correlation metadata;
- the injected API key is never serialized into run payloads.

The safe facade memoizes application execution. A trace context delegate that invokes its callback zero times falls back to one application call; a delegate that invokes it concurrently twice receives the same promise and still executes the application once. Application exceptions remain authoritative even if tracing swallows or throws after the callback.

Root start, child start, end, fail, callback bridge, active context, and flush failures never fail the customer path. The default diagnostic is bounded to:

```json
{"event":"agent_trace_diagnostic","code":"agent_trace_start_failed"}
```

It never includes the thrown error message, customer payload, API key, fetched page, tool arguments, or internal state. Caller-supplied trace metadata remains restricted at the application call sites to trusted runtime/business/release/scenario correlation fields; KFC invocation metadata/tags are fixed application literals.

## Middleware decisions

### Retained maintained middleware

- KFC retains `modelCallLimitMiddleware({ runLimit: 6 })` and `toolCallLimitMiddleware({ runLimit: 8 })`.
- PVCFC retains its accepted model/tool call-limit middleware.
- Behavioral audit proves KFC stops after six physical model calls and rejects a nine-call effect batch against the eight-tool limit before any effect executes.

### No global tool retry

KFC tools include mutations and irreversible effects. The application owns idempotency, confirmation, reservations, execution fences, provider ambiguity, and durable outcomes. A generic tool retry could repeat an effect outside those authorities. The focused test proves an effect-capable failure is attempted exactly once.

### No summarization middleware

Both packs reconstruct a bounded final 12-message window from the canonical application transcript on every turn. KFC's focused test proves the model receives exactly canonical turns 3–14 from a 15-turn transcript, with no synthetic summary message. Adding LangChain summarization would create a second memory/summary state with independent persistence and invalidation semantics, so it is deliberately not enabled.

### No model retry middleware

The accepted application has a 30-second turn deadline, explicit external-call accounting, TinyFish budgets, and provider failure evidence. The installed generic model retry middleware was not added because no existing boundary classifies retryable provider failures while counting the retry against the same physical-call/deadline evidence. The focused test proves a transient-looking provider error remains one physical model attempt and preserves its stable failure message. A future bounded retry requires a separate proven transient classifier and deadline/attempt evidence contract.

## Remaining graph/OpenAI/custom-name audit

- The dead `llm/openAiDiagnostics.ts` direct HTTP helper was unused outside its isolated test and was deleted.
- The dead `observability/tracing.ts` environment-mutating scenario logger was unused outside its isolated test and was deleted.
- `@langchain/openai`, configured OpenAI provider/model identities, Worker readiness fields, and the OpenAI model-cost guard remain accurate provider-specific LangChain integration, not direct SDK orchestration.
- `graphExecutedToolResult` and surviving `src/graph/*` names describe stable KFC business-state/projection vocabulary retained from the application domain. They do not construct or import LangGraph and were not mechanically renamed.
- Customer-run, customer-context, structured-customer-action, persistence, and authorization filenames are application/domain vocabulary and remain custom by design.

## Retained custom-code authority

The audit intentionally retains D1/Postgres stores, transcript/run fences, confirmation pause/resume, idempotency, irreversible-operation reservations, outbox/delivery, authentication/authorization, evidence receipts and publication validation, KFC/PVCFC business tools and pack policy, TinyFish allowlists/budgets, GenUI projection, and human handoff. These encode business/application correctness; LangChain/LangSmith do not replace them.

## GREEN verification

All commands use bundled Node 24. The required focused suite is green:

```text
Test Files  7 passed (7)
Tests       41 passed (41)
```

The complete maintained gate and final independent gates are green:

```text
npm run check
  format:check                exit 0
  lint                        0 errors, 383 budgeted warnings
  lint:strict                 legacy warning budget preserved
  typecheck                   exit 0
  test:ci                     200 files passed, 1 skipped; 2,007 tests passed, 1 skipped
npm run lint:strict            383 warnings, legacy budget preserved
npm run check:architecture     464 files, 900-line ceiling, no baseline growth
npm run build                  exit 0
npm run worker:deploy:dry-run  exit 0
git diff --check               exit 0
```

Dry-run bundle output is 12,718.07 KiB raw / 1,336.81 KiB gzip, lower than the accepted Task 5 result (12,722.13 KiB / 1,337.36 KiB). No live LangSmith or TinyFish request was made.

## Files and commit

Primary production changes:

- `src/observability/langsmithAgentTracer.ts`
- `src/observability/agentTracing.ts`
- `src/businesses/kfc/applicationTurn.ts`
- `src/businesses/kfc/langchainTurnService.ts`
- deleted `src/observability/tracing.ts`
- deleted `src/llm/openAiDiagnostics.ts`

Primary tests:

- `test/observability/agent-tracing.test.ts`
- `test/api/trace-correlation-authority.test.ts`
- `test/agent/langchain-middleware-parity.test.ts`
- `test/business/kfc-langchain-pack.test.ts`
- `test/architecture/langchain-only-production-runtime.test.ts`

Required commit subject:

```text
refactor(agent): use maintained LangChain observability
```

## Remaining concerns

1. CI proves native trace shape with injected transport; a credentialed live LangSmith canary is still required for account/project ingestion, sampling, regional latency, and UI rendering.
2. LangChain's automatic spans may contain model/tool inputs as normal trace inputs. This task prevents unsafe application values from being added to metadata/tags; production LangSmith retention and access control remain deployment concerns.
3. Model retry remains deliberately absent until physical attempt/deadline/provider-evidence accounting is proven rather than inferred.
