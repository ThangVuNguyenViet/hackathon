# KFC Model-Driven Small-Talk Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conservative `gpt-4.1-nano` social-turn router that produces model-written greetings, thanks, and goodbyes without invoking the full commerce planner, while sending every uncertain or business-relevant turn through the `gpt-4.1` path.

**Architecture:** A focused `SmallTalkRouter` interface and OpenAI adapter run concurrently with the existing D1 context load inside `runAgentTurnCore`. Only a validated `handle_social` result may skip the planner, tools, GenUI, and composer; every error, timeout, structured action, mixed request, or `continue_to_planner` result uses the existing orchestration loop. The runtime remains a single-agent custom state loop using `AgentGraphState`; this plan does not migrate to LangGraph `StateGraph`.

**Tech Stack:** TypeScript, Zod, OpenAI Responses API, Cloudflare Workers/D1 `waitUntil`, LangSmith tracing, Vitest, Flutter tests, Bash deployment checks.

## Global Constraints

- Customer-facing social responses must be model-written; runtime code must contain no canned greeting, thanks, or goodbye response.
- Runtime routing must not use keyword lists, regular-expression phrase classifiers, stopword lists, or demo-specific phrases.
- `handle_social` is limited to self-contained greetings, thanks, and goodbyes.
- Menu, pricing, promotions, products, recommendations, cart, ordering, fulfillment, vouchers, loyalty, payment, invoices, order status, complaints, feedback, safety, allergens, handoff, mixed turns, acknowledgements, confirmations, references, ambiguity, and structured GenUI actions must continue to the full planner.
- The commerce planner uses `gpt-4.1`; the router defaults to `gpt-4.1-nano` with a 2500 ms timeout.
- Router errors append `llm:small_talk_router_failed`, fail open to the planner, and never fail the HTTP response.
- `/chat/kfc/message`, idempotency, D1, Flutter, GenUI, synchronous intelligence, deferred monitor refinement, and production LangSmith project contracts remain compatible.
- Trace delivery remains deferred through one `waitUntil` flush.
- Production acceptance requires greeting p95 below 6000 ms, menu and overall p95 below 8000 ms, and 100% HTTP success.

## File Map

- Create `services/kfc-agent-backend/src/llm/smallTalkRouter.ts`: router contracts, OpenAI adapter, strict prompt, timeout, parsing.
- Create `services/kfc-agent-backend/test/llm/small-talk-router.test.ts`: adapter unit tests.
- Modify `services/kfc-agent-backend/src/config/env.ts`: router model and timeout environment parsing.
- Modify `services/kfc-agent-backend/src/api/serverOptions.ts`: construct the router when OpenAI is configured.
- Modify `services/kfc-agent-backend/src/api/routeHandlers.ts`: inject the router into all normalized channel turns.
- Modify `services/kfc-agent-backend/src/worker.ts`: expose Worker variables and map them into server options.
- Modify `services/kfc-agent-backend/.env.example`: document router variables.
- Modify `services/kfc-agent-backend/src/graph/buildGraph.ts`: concurrent routing, fast path, diagnostic event, tracing, GenUI suppression.
- Modify `services/kfc-agent-backend/test/graph/agent-tracing.test.ts`: fast-path, fallback, trace, and concurrency tests.
- Modify `services/kfc-agent-backend/test/api/chat.test.ts`: HTTP response, idempotency, intelligence, and deferred-monitor regression tests.
- Modify `services/kfc-agent-backend/test/api/server-options.test.ts`: configuration defaults and dependency injection.
- Create `services/kfc-agent-backend/src/evaluation/smallTalkRouterEvalCases.ts`: labeled live-evaluation corpus.
- Create `services/kfc-agent-backend/test/llm/live-small-talk-router.test.ts`: gated real-model correctness test.
- Modify `services/kfc-agent-backend/package.json`: live router test command.
- Modify `services/kfc-agent-backend/src/evaluation/productionLatency.ts`: separate greeting/menu/overall targets.
- Modify `services/kfc-agent-backend/test/evaluation/production-latency.test.ts`: target-specific p95 tests.
- Modify `services/kfc-agent-backend/scripts/run-production-latency-probe.ts`: child-span gates and 6000 ms greeting target.
- Modify `scripts/deploy-backend-cloudflare-worker.sh`: pass router model and timeout to the Worker.
- Modify `tests/deployment/deploy_scripts.test.sh`: protect deployment configuration.

---

### Task 1: Implement the constrained OpenAI router adapter

**Files:**
- Create: `services/kfc-agent-backend/src/llm/smallTalkRouter.ts`
- Create: `services/kfc-agent-backend/test/llm/small-talk-router.test.ts`

**Interfaces:**
- Consumes: `Channel` from `src/domain/types.ts`, `fetch`, OpenAI Responses API.
- Produces: `SmallTalkRouterInput`, `SmallTalkRouterOutput`, `SmallTalkRouter`, `OpenAISmallTalkRouterOptions`, and `OpenAISmallTalkRouter`.

- [ ] **Step 1: Write failing adapter contract tests**

Create tests that capture the request body and verify both decisions, structured-action bypass, invalid empty social output, HTTP failure, and timeout:

```ts
const social = await router.route({
  latestUserMessage: 'social test input',
  channel: 'kfc',
  hasStructuredAction: false,
});
expect(social).toEqual({ decision: 'handle_social', responseText: 'model social reply' });
expect(requestBody).toMatchObject({ model: 'gpt-4.1-nano', temperature: 0 });
expect(JSON.stringify(requestBody)).not.toContain('toolCatalog');

const continued = await router.route({
  latestUserMessage: 'commerce test input',
  channel: 'kfc',
  hasStructuredAction: false,
});
expect(continued).toEqual({ decision: 'continue_to_planner' });

await expect(emptyResponseRouter.route(input)).rejects.toThrow();
await expect(httpFailureRouter.route(input)).rejects.toThrow('HTTP 503');
await expect(timeoutRouter.route(input)).rejects.toThrow();
expect(fetchForStructuredAction).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `npx vitest run test/llm/small-talk-router.test.ts`

Expected: FAIL because `src/llm/smallTalkRouter.ts` does not exist.

- [ ] **Step 3: Implement the router contract and OpenAI adapter**

Implement the discriminated output and strict parsing:

```ts
export interface SmallTalkRouterInput {
  latestUserMessage: string;
  channel: Channel;
  hasStructuredAction: boolean;
}

export type SmallTalkRouterOutput =
  | { decision: 'handle_social'; responseText: string }
  | { decision: 'continue_to_planner' };

export interface SmallTalkRouter {
  readonly model?: string;
  readonly promptVersion?: string;
  route(input: SmallTalkRouterInput): Promise<SmallTalkRouterOutput>;
}

const outputSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('handle_social'),
    responseText: z.string().trim().min(1),
  }),
  z.object({
    decision: z.literal('continue_to_planner'),
    responseText: z.never().optional(),
  }),
]);
```

Expose `readonly promptVersion = 'small-talk-router-v1'`, expose the configured model, return `continue_to_planner` without fetching when `hasStructuredAction` is true, call `${baseUrl}/responses` with `temperature: 0`, abort after `timeoutMs`, reject non-OK responses, extract `output_text` or nested output text, parse JSON, and validate with `outputSchema`.

The instructions must describe the policy categories from Global Constraints and must say that uncertainty returns `continue_to_planner`. Do not include example customer phrases or example response wording.

- [ ] **Step 4: Run adapter tests and build**

Run: `npx vitest run test/llm/small-talk-router.test.ts && npm run build`

Expected: adapter tests PASS and TypeScript build exits 0.

- [ ] **Step 5: Commit the adapter**

```bash
git add services/kfc-agent-backend/src/llm/smallTalkRouter.ts services/kfc-agent-backend/test/llm/small-talk-router.test.ts
git commit -m "feat(kfc): add constrained small-talk router"
```

### Task 2: Wire router configuration and dependency injection

**Files:**
- Modify: `services/kfc-agent-backend/src/config/env.ts`
- Modify: `services/kfc-agent-backend/src/api/serverOptions.ts`
- Modify: `services/kfc-agent-backend/src/api/routeHandlers.ts`
- Modify: `services/kfc-agent-backend/src/worker.ts`
- Modify: `services/kfc-agent-backend/.env.example`
- Modify: `services/kfc-agent-backend/test/api/server-options.test.ts`

**Interfaces:**
- Consumes: `OpenAISmallTalkRouter` from Task 1.
- Produces: `RouteOptions.smallTalkRouter?: SmallTalkRouter`, `AgentTurnInput.smallTalkRouter?: SmallTalkRouter`, `OPENAI_SMALL_TALK_ROUTER_MODEL`, and `OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS`.

- [ ] **Step 1: Write failing configuration tests**

Add assertions:

```ts
expect(env.OPENAI_SMALL_TALK_ROUTER_MODEL).toBe('gpt-4.1-nano');
expect(env.OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS).toBe(2500);
expect(buildServerOptionsFromEnv(env).smallTalkRouter).toEqual(expect.any(Object));
expect(buildServerOptionsFromEnv(loadEnv({ PORT: '18090' } as NodeJS.ProcessEnv)).smallTalkRouter).toBeUndefined();
```

Also assert an explicit model and timeout survive parsing.

- [ ] **Step 2: Run configuration tests and verify RED**

Run: `npx vitest run test/api/server-options.test.ts`

Expected: FAIL because the router variables and option are absent.

- [ ] **Step 3: Add environment fields and construct the adapter**

Add to `appEnvSchema`:

```ts
OPENAI_SMALL_TALK_ROUTER_MODEL: z.string().default('gpt-4.1-nano'),
OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
```

Add to `buildServerOptionsFromEnv`:

```ts
smallTalkRouter: openAiApiKey
  ? new OpenAISmallTalkRouter({
      apiKey: openAiApiKey,
      model: env.OPENAI_SMALL_TALK_ROUTER_MODEL,
      baseUrl: openAiBaseUrl,
      timeoutMs: env.OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS,
    })
  : undefined,
```

Add the optional router to `RouteOptions` and pass `smallTalkRouter: options.smallTalkRouter` at each of the five `runAgentTurn` call sites in `routeHandlers.ts` so KFC, Messenger, Zalo, resume, and queued paths retain channel parity.

- [ ] **Step 4: Add Worker defaults and example configuration**

Add to `WorkerEnv`:

```ts
OPENAI_SMALL_TALK_ROUTER_MODEL?: string;
OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS?: string;
```

At each of the Worker fetch, queue, and scheduled `buildServerOptionsFromEnv` calls, add:

```ts
OPENAI_SMALL_TALK_ROUTER_MODEL:
  env.OPENAI_SMALL_TALK_ROUTER_MODEL ?? 'gpt-4.1-nano',
OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS:
  Number(env.OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS ?? '2500'),
```

Add to `.env.example`:

```dotenv
OPENAI_SMALL_TALK_ROUTER_MODEL=gpt-4.1-nano
OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS=2500
```

- [ ] **Step 5: Run focused configuration, API, and Worker tests**

Run: `npx vitest run test/api/server-options.test.ts test/api/chat.test.ts test/worker/worker.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 6: Commit configuration wiring**

```bash
git add services/kfc-agent-backend/src/config/env.ts services/kfc-agent-backend/src/api/serverOptions.ts services/kfc-agent-backend/src/api/routeHandlers.ts services/kfc-agent-backend/src/worker.ts services/kfc-agent-backend/.env.example services/kfc-agent-backend/test/api/server-options.test.ts
git commit -m "feat(kfc): configure small-talk routing"
```

### Task 3: Add the concurrent graph fast path and LangSmith span

**Files:**
- Modify: `services/kfc-agent-backend/src/graph/buildGraph.ts`
- Modify: `services/kfc-agent-backend/test/graph/agent-tracing.test.ts`

**Interfaces:**
- Consumes: `SmallTalkRouter` and `SmallTalkRouterOutput` from Task 1, optional injected router from Task 2.
- Produces: `small_talk_router` child span, `llm:small_talk_router_failed` diagnostic event, accepted social fast path.

- [ ] **Step 1: Write failing graph tests for accepted and rejected routing**

Add a social test with counting planner, composer, and router objects:

```ts
expect(output.responseText).toBe('model social reply');
expect(router.route).toHaveBeenCalledTimes(1);
expect(planner.plan).not.toHaveBeenCalled();
expect(composer.composeResponse).not.toHaveBeenCalled();
expect(output.genUi).toBeUndefined();
expect(tracer.started('small_talk_router')).toBeDefined();
expect(tracer.started('planner_iteration')).toBeUndefined();
expect(tracer.started('response_compose')).toBeUndefined();
```

Add a commerce test whose router returns `continue_to_planner` and assert the existing planner and tool path runs. Add a router-throws test and assert `llm:small_talk_router_failed` exists while the planner still runs.

- [ ] **Step 2: Write a failing concurrency test**

Use a `MemoryStore` subclass whose `listTurns` waits on a deferred promise. Start `runAgentTurn`, wait until `listTurns` is blocked, and assert the router has already been called before releasing the context gate:

```ts
const turnPromise = runAgentTurn(input);
await contextLoadStarted.promise;
expect(router.route).toHaveBeenCalledTimes(1);
releaseContextLoad.resolve();
await turnPromise;
```

- [ ] **Step 3: Run graph tests and verify RED**

Run: `npx vitest run test/graph/agent-tracing.test.ts`

Expected: FAIL because `AgentTurnInput` and `runAgentTurnCore` do not use the router.

- [ ] **Step 4: Start and trace routing before context load**

Add `smallTalkRouter?: SmallTalkRouter` to `AgentTurnInput`. Add a helper that starts `small_talk_router`, calls the router, records full inputs/outputs, and converts errors into a diagnostic event plus `continue_to_planner`:

```ts
async function routeSmallTalk(
  input: AgentTurnInput,
  turnTrace: AgentTraceSpan,
): Promise<SmallTalkRouterOutput | undefined> {
  if (!input.smallTalkRouter) return undefined;
  const routerInput = {
    latestUserMessage: input.text,
    channel: input.channel,
    hasStructuredAction: Boolean(input.metadata?.rawEvent?.genUiAction),
  };
  const span = await turnTrace.startSpan({
    name: 'small_talk_router',
    runType: 'llm',
    inputs: { routerInput },
    metadata: {
      component: 'SmallTalkRouter',
      model: input.smallTalkRouter.model ?? null,
      promptVersion: input.smallTalkRouter.promptVersion ?? null,
    },
    tags: ['agent-router'],
  });
  try {
    const output = await input.smallTalkRouter.route(routerInput);
    await span.end({ routerOutput: output });
    return output;
  } catch (error) {
    await span.fail(error);
    await input.store.appendEvent(input.sessionId, 'llm:small_talk_router_failed', {
      message: error instanceof Error ? error.message : 'Unknown small-talk router failure',
    });
    return { decision: 'continue_to_planner' };
  }
}
```

At the first line of `runAgentTurnCore`, start `const routingPromise = routeSmallTalk(input, turnTrace)` before creating `contextSpan`. Immediately after `contextSpan.end(...)`, await `routingPromise`, then perform the existing run-current check. This ordering overlaps router inference with D1 work and observes router rejection before any stale-run return.

- [ ] **Step 5: Implement the accepted social fast path**

Add `suppressGenUi?: boolean` to `composeAndAppendAssistantTurn` and set:

```ts
const genUi = input.suppressGenUi
  ? undefined
  : selectKfcGenUiAttachment({
      state: buildContextPolicyState(input.state, {
        metadata: input.turnInput.metadata,
        policy: contextPolicy,
        preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
        preserveMenuSearchResults: shouldPreserveCurrentMenuSearchResults(input.currentTurnToolTrace),
        preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
        preserveHandoff: shouldPreserveCurrentHandoff(input.currentTurnToolTrace),
      }),
      turnToolNames: input.currentTurnToolTrace.map((entry) => entry.toolName),
      reuseVerifiedMenuResults: contextPolicyIsActive(contextPolicy, 'menuSearchResults'),
    });
```

After awaiting the router and passing the run-current check, add:

```ts
if (routing?.decision === 'handle_social') {
  state.entities = { smallTalk: true, suppressGenUi: true };
  await persistVerifiedStateSnapshot(input.store, state);
  const intelligenceSpan = await turnTrace.startSpan({
    name: 'session_intelligence',
    runType: 'chain',
    inputs: { customerTurnCount, state: traceStateSummary(state) },
    metadata: { component: 'resolveMonitorSessionIntelligence' },
    tags: ['agent-session-intelligence'],
  });
  await emitSessionIntelligence(input, state, customerTurnCount);
  await intelligenceSpan.end({
    customerTurnCount,
    escalationReasons: [...state.escalationReasons],
  });
  return composeAndAppendAssistantTurn({
    turnInput: input,
    state,
    replyIntent: 'general_reply',
    fallbackText: routing.responseText,
    currentTurnToolTrace: [],
    turnTrace,
    preferFallbackText: true,
    suppressGenUi: true,
  });
}
```

Use `const routing = await routingPromise` before the stale-run check so router rejections are always observed.

- [ ] **Step 6: Run graph, source-guard, and tracing tests**

Run: `npx vitest run test/graph/agent-tracing.test.ts test/graph/ai-tool-graph.test.ts test/runtime/runtime-source-guard.test.ts test/observability/agent-tracing.test.ts`

Expected: all tests PASS; source guard reports no phrase classifier or canned response.

- [ ] **Step 7: Commit graph integration**

```bash
git add services/kfc-agent-backend/src/graph/buildGraph.ts services/kfc-agent-backend/test/graph/agent-tracing.test.ts
git commit -m "feat(kfc): route social turns before planning"
```

### Task 4: Protect HTTP, idempotency, intelligence, and background behavior

**Files:**
- Modify: `services/kfc-agent-backend/test/api/chat.test.ts`
- Modify: `services/kfc-agent-backend/test/worker/worker.test.ts`

**Interfaces:**
- Consumes: route injection and graph behavior from Tasks 2-3.
- Produces: regression coverage for the unchanged public response and asynchronous contracts.

- [ ] **Step 1: Add HTTP fast-path and replay tests**

Create a static social router with a call counter. Send a KFC message twice with the same `clientMessageId` and assert:

```ts
expect(first.status).toBe(200);
expect(first.body).toMatchObject({
  responseText: 'model social reply',
  sessionId,
  customerId,
  replayed: false,
});
expect(second.body).toMatchObject({ responseText: 'model social reply', replayed: true });
expect(routerCalls).toBe(1);
expect(plannerCalls).toBe(0);
expect(composerCalls).toBe(0);
```

Keep the existing conflict-fingerprint assertion unchanged.

- [ ] **Step 2: Add intelligence and failure isolation tests**

Assert one synchronous `session_intelligence_updated` event after the response path and exactly one judge invocation after deferred tasks drain. Add a router failure case and assert HTTP 200, one `llm:small_talk_router_failed`, and normal planner output.

- [ ] **Step 3: Run API and Worker tests**

Run: `npx vitest run test/api/chat.test.ts test/worker/worker.test.ts test/monitor/session-intelligence-graph.test.ts`

Expected: all tests PASS.

- [ ] **Step 4: Commit contract coverage**

```bash
git add services/kfc-agent-backend/test/api/chat.test.ts services/kfc-agent-backend/test/worker/worker.test.ts
git commit -m "test(kfc): protect social routing contracts"
```

### Task 5: Add a live model routing correctness gate

**Files:**
- Create: `services/kfc-agent-backend/src/evaluation/smallTalkRouterEvalCases.ts`
- Create: `services/kfc-agent-backend/test/llm/live-small-talk-router.test.ts`
- Modify: `services/kfc-agent-backend/package.json`

**Interfaces:**
- Consumes: `OpenAISmallTalkRouter` from Task 1.
- Produces: `smallTalkRouterEvalCases` and `npm run test:live:small-talk-router`.

- [ ] **Step 1: Create the labeled evaluation corpus**

Define cases with stable IDs, text, and expected decision. Include three pure social cases and at least nine non-social cases covering mixed social/menu, mixed thanks/cart mutation, ambiguous acknowledgement, menu, ordering, payment, complaint, allergen safety, and human handoff:

```ts
export const smallTalkRouterEvalCases = [
  { id: 'social-greeting', text: 'Xin chào KFC', expected: 'handle_social' },
  { id: 'social-thanks', text: 'Cảm ơn bạn nhiều', expected: 'handle_social' },
  { id: 'social-goodbye', text: 'Tạm biệt nhé', expected: 'handle_social' },
  { id: 'mixed-greeting-menu', text: 'Xin chào, hôm nay có món gì?', expected: 'continue_to_planner' },
  { id: 'mixed-thanks-cart', text: 'Cảm ơn, thêm khoai tây vào giỏ giúp mình', expected: 'continue_to_planner' },
  { id: 'ambiguous-ack', text: 'Ừ, cảm ơn', expected: 'continue_to_planner' },
  { id: 'menu', text: 'Cho mình xem menu', expected: 'continue_to_planner' },
  { id: 'ordering', text: 'Thêm một phần gà vào giỏ', expected: 'continue_to_planner' },
  { id: 'payment', text: 'Mình thanh toán rồi mà báo lỗi', expected: 'continue_to_planner' },
  { id: 'complaint', text: 'Đơn giao thiếu món', expected: 'continue_to_planner' },
  { id: 'safety', text: 'Món này có chất gây dị ứng không?', expected: 'continue_to_planner' },
  { id: 'handoff', text: 'Cho mình gặp nhân viên', expected: 'continue_to_planner' },
] as const;
```

These strings remain under `src/evaluation` and are not imported by runtime routing.

- [ ] **Step 2: Write the gated live test**

When `RUN_LIVE_SMALL_TALK_ROUTER=1`, require `OPENAI_API_KEY`, instantiate the router with `OPENAI_SMALL_TALK_ROUTER_MODEL || 'gpt-4.1-nano'`, run every case, and assert the exact decision. Also assert every accepted response is non-empty.

- [ ] **Step 3: Add the package command and run the live gate**

Add:

```json
"test:live:small-talk-router": "set -a; [ ! -f ../../.env ] || . ../../.env; [ ! -f ../../../../.env ] || . ../../../../.env; set +a; RUN_LIVE_SMALL_TALK_ROUTER=1 vitest run test/llm/live-small-talk-router.test.ts --maxWorkers=1 --no-file-parallelism"
```

Run: `npm run test:live:small-talk-router`

Expected: all corpus cases PASS. If any non-social case returns `handle_social`, stop and tighten the category-only prompt before continuing.

- [ ] **Step 4: Run the unchanged full-planner live scenario gate**

Run:

```bash
set -a
source /Users/vietthangvunguyen/Workspace/hackathon/.env
set +a
OPENAI_TOOL_PLANNER_MODEL=gpt-4.1 RUN_LIVE_AI_SCENARIOS=1 npx vitest run test/scenarios/live-ai-scenario-replay.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: all nine live scenario cases and UC-01 through UC-39 coverage PASS.

- [ ] **Step 5: Commit the live gate**

```bash
git add services/kfc-agent-backend/src/evaluation/smallTalkRouterEvalCases.ts services/kfc-agent-backend/test/llm/live-small-talk-router.test.ts services/kfc-agent-backend/package.json
git commit -m "test(kfc): evaluate live social routing"
```

### Task 6: Strengthen production latency and trace acceptance

**Files:**
- Modify: `services/kfc-agent-backend/src/evaluation/productionLatency.ts`
- Modify: `services/kfc-agent-backend/test/evaluation/production-latency.test.ts`
- Modify: `services/kfc-agent-backend/scripts/run-production-latency-probe.ts`
- Modify: `scripts/deploy-backend-cloudflare-worker.sh`
- Modify: `tests/deployment/deploy_scripts.test.sh`

**Interfaces:**
- Consumes: production LangSmith root and child spans.
- Produces: separate latency thresholds and social-router trace gates.

- [ ] **Step 1: Write failing target-specific latency tests**

Change the evaluator input to:

```ts
interface ProductionLatencyTargets {
  greetingP95Ms: number;
  menuP95Ms: number;
  overallP95Ms: number;
}
```

Add tests proving a 6100 ms greeting p95 fails while a 7900 ms menu p95 passes, and that success rate must remain exactly 1.

- [ ] **Step 2: Implement target-specific evaluation**

Use strict `<` comparisons and emit `greeting_p95`, `menu_p95`, and `overall_p95` independently.

- [ ] **Step 3: Add LangSmith child-span gates to the production probe**

Collect root `agent_turn` trace IDs and classify them by `clientMessageId`. Query child spans with the probe metadata as a `traceFilter`:

```ts
const routerRuns = client.listRuns({
  projectName,
  startTime: startedAt,
  filter: 'eq(name, "small_talk_router")',
  traceFilter: productionProbeMetadataFilter(probeRunId),
  limit: iterations * 2,
});
```

Also query `planner_iteration` and `response_compose`. Require 40 router spans, zero greeting planner/composer spans, at least one planner span for each menu trace, 40 agent roots, and 40 monitor roots. Report every count and trace-gate failure in the JSON artifact.

Use defaults:

```ts
const greetingTargetP95Ms = Number(process.env.PRODUCTION_GREETING_TARGET_MS ?? '6000');
const menuTargetP95Ms = Number(process.env.PRODUCTION_MENU_TARGET_MS ?? '8000');
const overallTargetP95Ms = Number(process.env.PRODUCTION_OVERALL_TARGET_MS ?? '8000');
```

- [ ] **Step 4: Protect deployment variables**

In `deploy-backend-cloudflare-worker.sh`, set defaults and pass both variables:

```bash
OPENAI_SMALL_TALK_ROUTER_MODEL="${OPENAI_SMALL_TALK_ROUTER_MODEL:-gpt-4.1-nano}"
OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS="${OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS:-2500}"
```

```bash
--var "OPENAI_SMALL_TALK_ROUTER_MODEL:$OPENAI_SMALL_TALK_ROUTER_MODEL" \
--var "OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS:$OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS" \
```

Add shell assertions for these variable names and `.env.example` entries.

- [ ] **Step 5: Run evaluation and deployment tests**

Run:

```bash
cd services/kfc-agent-backend
npx vitest run test/evaluation/production-latency.test.ts
cd ../..
bash tests/deployment/deploy_scripts.test.sh
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit acceptance tooling**

```bash
git add services/kfc-agent-backend/src/evaluation/productionLatency.ts services/kfc-agent-backend/test/evaluation/production-latency.test.ts services/kfc-agent-backend/scripts/run-production-latency-probe.ts scripts/deploy-backend-cloudflare-worker.sh tests/deployment/deploy_scripts.test.sh
git commit -m "test(kfc): gate social routing latency and traces"
```

### Task 7: Verify, deploy, and retain only on full acceptance

**Files:**
- Verify all files changed in Tasks 1-6.
- Produce ignored artifacts under `artifacts/production-latency/` and `artifacts/deployment/`.

**Interfaces:**
- Consumes: committed router implementation and acceptance tooling.
- Produces: verified local branch, deployed Worker release, production report, or rollback.

- [ ] **Step 1: Run the full backend verification**

```bash
cd services/kfc-agent-backend
npm run build
npm test -- --maxWorkers=1 --no-file-parallelism
```

Expected: build exits 0 and every runnable test passes.

- [ ] **Step 2: Run Flutter customer-chat tests**

```bash
cd apps/kfc_live_monitor_flutter
flutter test test/features/customer_chat/data/customer_chat_repository_test.dart test/features/customer_chat/application/customer_chat_controller_test.dart
```

Expected: all 10 tests PASS.

- [ ] **Step 3: Confirm a clean branch and record rollback target**

```bash
git status --short
git rev-parse HEAD
cd services/kfc-agent-backend
rollback_version="$(npx wrangler deployments list | awk '/Version\(s\):/{getline; print $2}' | tail -1)"
[[ "$rollback_version" =~ ^[0-9a-f-]{36}$ ]]
printf '%s\n' "$rollback_version"
mkdir -p ../../artifacts/deployment
printf '%s\n' "$rollback_version" > ../../artifacts/deployment/small-talk-router-rollback-version.txt
```

Expected: `git status --short` is empty. Record the active Worker version ID before deployment.

- [ ] **Step 4: Deploy the committed Worker**

```bash
ENV_FILE=/Users/vietthangvunguyen/Workspace/hackathon/.env ./scripts/deploy-backend-cloudflare-worker.sh
```

Expected: deploy exits 0, `/health` is 200, and `/ready?deep=1` reports the exact local HEAD SHA, `dirty: false`, LangSmith project `kfc-agent-backend-local`, APAC endpoint, and sampling rate 1.

- [ ] **Step 5: Run the production 20+20 gate**

```bash
cd services/kfc-agent-backend
set -a
source /Users/vietthangvunguyen/Workspace/hackathon/.env
set +a
npm run proof:production:latency
```

Expected: 40/40 HTTP 200, greeting p95 below 6000 ms, menu and overall p95 below 8000 ms, 40 router spans, zero greeting planner/composer spans, one or more planner spans for every menu trace, 40 agent roots, and 40 monitor roots.

- [ ] **Step 6: Check production diagnostic events**

Use the emitted `probeRunId`:

```bash
report_path="$(ls -t ../../artifacts/production-latency/latency-*.json | head -1)"
probe_run_id="$(jq -r .probeRunId "$report_path")"
npx wrangler d1 execute kfc-agent-demo --remote --command "SELECT source_type, COUNT(*) AS count FROM conversation_events WHERE session_id LIKE 'kfc:${probe_run_id}-%' AND source_type IN ('llm:small_talk_router_failed','llm:tool_planner_failed','llm:response_composer_failed') GROUP BY source_type;"
```

Expected: empty result set.

- [ ] **Step 7: Retain or roll back**

If every gate passes, keep the active version and record the report path and Worker version. If any correctness, trace, availability, or latency gate fails:

```bash
rollback_version="$(cat ../../artifacts/deployment/small-talk-router-rollback-version.txt)"
npx wrangler rollback "$rollback_version" --message "Rollback: small-talk router acceptance failed"
```

Expected after rollback: `/ready?deep=1` reports the recorded previous release SHA.

- [ ] **Step 8: Commit any verification-only source adjustments before redeploying**

If verification required a source or test correction, repeat its TDD cycle, commit it with a scoped message, rerun Steps 1-7, and never deploy a dirty tree.
