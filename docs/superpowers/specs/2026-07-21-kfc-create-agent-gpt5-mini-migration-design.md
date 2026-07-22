# KFC Hybrid `createAgent` and GPT-5 Mini Migration Design

## Status and authority

This document records the architecture approved on 2026-07-21 for replacing only the hand-authored semantic model/tool loop with one complete LangChain JavaScript `createAgent()` compiled graph nested inside a reduced deterministic KFC `StateGraph` workflow.

It supersedes:

- the top-level `langchain` and `createAgent` prohibition in `docs/wayfinder/kfc-model-agnostic-agent-runtime/assets/donor-adoption-manifest.md`;
- the obsolete GPT-4.1/custom-semantic-loop recovery plan in `/Users/vietthangvunguyen/.claude/plans/scalable-hugging-pearl.md`;
- tests that treat the exact obsolete low-level semantic node and edge topology as a business requirement.

Implementation, offline qualification, and paid testing are authorized. Deployment remains blocked until the required gates pass.

## Goal

Use the recommended high-level LangChain agent implementation for semantic model/tool iteration while retaining a small, deterministic outer KFC workflow for application-owned orchestration.

The production runtime contains one complete `createAgent()` instance using `gpt-5-mini-2025-08-07`, invoked by the outer KFC `StateGraph` through a named `semantic_agent` wrapper node. The wrapper is the explicit parent/subgraph state boundary: it maps outer state and context into the complete compiled agent, invokes it with inherited runtime configuration, and maps the typed result, shared budgets, and failures back into outer state. `createAgent` owns the semantic model/tool loop, dynamic tool middleware, whole-batch validation, bounded transient retry, standard HITL interruption, and provider-native structured output. The agent middleware and wrapper share the single semantic-correction budget, with the wrapper owning terminal provider-strategy parsing correction. The outer graph owns hydration, trusted routing, deadline and run-current gates, publication validation, persistence, GenUI, and delivery.

## Hybrid architecture

There is no `AgentKernel`, dual-runtime period, shadow execution, custom checkpoint privacy layer, candidate externalization, application-owned fresh post-approval invocation, or production multi-agent runtime.

The production request path is:

```text
HTTP / Messenger / Worker request
  -> existing request reservation and run fence
  -> cached, compiled outer KFC StateGraph
       -> hydrate_turn
       -> gate_runtime_current
       -> semantic_agent (one complete createAgent compiled graph)
          -> model/tool loop
          -> native HITL interrupt, if required
          -> provider-native structured response
       -> route_trusted_structured_action
       -> validate_publication
       -> persist_success_fenced OR persist_failure
       -> project_genui
       -> deliver
```

The parent and `createAgent()` graph do not share a compatible state schema: the outer workflow has its existing `messages` channel semantics and no native `structuredResponse` channel. Therefore the outer graph must not add the compiled agent directly as a node. A named `semantic_agent` wrapper node maps outer state/context to the agent input `{ messages, ...agentState }`, invokes the complete compiled agent with the inherited `RunnableConfig`, and maps `structuredResponse`, message/budget updates, interrupt metadata, and classified failure state back into the existing outer schema. The parent graph owns the explicit durable checkpointer. The nested agent does not construct or own an independent durable checkpointer; it inherits per-invocation checkpointing from the parent execution. Nested interrupts propagate through the wrapper and parent. Resume uses the same parent thread and `Command`, including the stable nested checkpoint namespace established by the wrapper's nested invocation.

The runtime identity is:

```text
langgraph-create-agent-workflow-v1
```

Only the hand-authored low-level semantic loop and tests coupled solely to that obsolete topology are removed after the hybrid replacement passes the required gates. The outer `StateGraph`, runner facade, state schema, persistence nodes, and deterministic routing remain and are adapted.

## Responsibility boundary

### Nested LangChain `createAgent()` owns

- semantic model and tool iteration;
- semantic message history during the nested agent run;
- dynamic model-visible tool selection on every model call;
- whole-batch validation before any authored tool batch executes;
- the shared six-physical-attempt guard and one classified transient retry;
- the shared one-semantic-correction budget;
- standard `humanInTheLoopMiddleware` interruption and nested `Command` resume;
- provider-native structured response generation through `responseFormat`;
- generic semantic-loop termination.

### KFC middleware and tool adapters inside `createAgent` own

- the system prompt;
- deterministic dynamic tool policy backed by current KFC state;
- canonical Zod input schemas;
- rejection of invalid, stale, duplicate, or unsafe whole batches without manufacturing calls;
- physical-attempt accounting around each actual provider handler invocation;
- transient classification that unwraps `MiddlewareError.cause`;
- semantic classification of invalid tool batches and structured-output parsing failures;
- mapping existing business-gateway outcomes into model-visible tool results;
- bounded lifecycle instrumentation.

### Outer KFC `StateGraph` owns

- authenticated turn hydration and canonical runtime context;
- one immutable 30,000 ms whole-turn deadline and abort signal;
- run-current and supersession gates before and after nested work;
- trusted structured-action routing based only on validated typed output and persisted state;
- final deterministic publication validation;
- fenced successful persistence and explicit failure persistence;
- confirmation-pause projection and persistence at exact checkpoint coordinates;
- GenUI projection and channel delivery;
- failure precedence and stale-publication suppression.

### Existing KFC application services remain authoritative for

- request reservation and idempotent replay;
- authenticated customer, session, run, and channel context;
- deterministic tool eligibility and capability evidence;
- the signed KFC approval receipt and exact current approval binding;
- the signed execution fence and durable irreversible-operation claim/CAS;
- the 60,000 ms irreversible-operation lease;
- provider idempotency, exactly-once mutation, and reconciliation;
- durable application state and event persistence.

`humanInTheLoopMiddleware` is workflow control only. A LangGraph approve decision never grants business authority. Immediately before an irreversible dispatch, existing KFC code must still verify the principal, exact binding, signed receipt, execution fence, durable claim/CAS, current run, deadline, provider revisions, authority generation, idempotency key, and reconciliation state.

A longer persistence lease never permits model or tool execution after the 30-second execution deadline.

## Dependencies and source policy

Add the exact dependency:

```json
"langchain": "1.5.3"
```

Retain the existing compatible direct dependencies:

- `@langchain/core` `1.2.3`;
- `@langchain/langgraph` `1.4.8`;
- `@langchain/openai` `1.5.5`;
- `@langchain/google` `0.2.1`;
- `langsmith` `0.8.3`;
- `zod` `3.25.76`.

The source guard must allow `createAgent`, `createMiddleware`, `humanInTheLoopMiddleware`, and other reviewed LangChain middleware used by the nested semantic runtime.

The guard continues to forbid `AgentExecutor`, `createReactAgent`, a second semantic runtime, hidden adapter retries, deterministic prose routing, scenario-specific tokens, canned responses, and manufactured or reordered model tool calls.

## GPT-5 mini profile

Pin the immutable snapshot across the production agent and OpenAI live qualification surfaces:

```text
gpt-5-mini-2025-08-07
```

Use the profile identity:

```text
openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low
```

Construct the OpenAI model as follows:

```ts
new ChatOpenAI({
  apiKey,
  model: 'gpt-5-mini-2025-08-07',
  useResponsesApi: true,
  reasoning: { effort: 'low' },
  verbosity: 'low',
  supportsStrictToolCalling: true,
  maxRetries: 0,
  configuration: baseUrl ? { baseURL: baseUrl } : undefined,
});
```

Remove `temperature: 0`. The adapter performs no implicit retry because retry behavior belongs to agent middleware and the shared physical-attempt ledger.

Production and qualification use the same model snapshot, reasoning effort, verbosity, tools, retry policy, and response schema. Preserve all existing business gates and the paid qualification order. Google live qualification remains outside this migration.

## Workflow construction

Build and cache the compiled outer workflow in `buildGraph.ts`. Construct one complete nested agent graph in a focused factory, then expose it through a named wrapper node because the existing outer and agent state schemas are not directly compatible:

```ts
const semanticAgent = createAgent({
  model,
  tools,
  middleware,
  responseFormat: providerStrategy(agentPublicationSchema),
  contextSchema: agentContextSchema,
});

async function semanticAgentNode(
  state: KfcOuterState,
  config: RunnableConfig,
): Promise<Partial<KfcOuterState>> {
  const agentConfig = inheritAgentRuntimeConfig(config, state);
  const agentInput = mapOuterStateToAgentInput(state);

  try {
    const result = await semanticAgent.invoke(agentInput, agentConfig);
    return mapAgentResultToOuterState(result, state);
  } catch (error) {
    if (isGraphInterrupt(error)) throw error;
    if (!hasStructuredOutputParsingCause(error)) {
      return mapAgentFailureToOuterState(error, state);
    }

    try {
      consumeSemanticCorrection(state.runtime);
    } catch {
      return mapAgentFailureToOuterState(
        new Error('agent_semantic_correction_limit_exceeded'),
        state,
      );
    }
    assertRuntimeActive(state.runtime);

    try {
      const result = await semanticAgent.invoke(
        appendBoundedStructuredOutputFeedback(agentInput),
        agentConfig,
      );
      return mapAgentResultToOuterState(result, state);
    } catch (correctedError) {
      if (isGraphInterrupt(correctedError)) throw correctedError;
      if (hasStructuredOutputParsingCause(correctedError)) {
        return mapAgentFailureToOuterState(
          new Error('agent_semantic_correction_limit_exceeded'),
          state,
        );
      }
      return mapAgentFailureToOuterState(correctedError, state);
    }
  }
}

const workflow = new StateGraph(kfcOuterStateSchema)
  .addNode('hydrate_turn', hydrateTurn)
  .addNode('gate_runtime_current', gateRuntimeCurrent)
  .addNode('semantic_agent', semanticAgentNode)
  .addNode('route_trusted_structured_action', routeTrustedStructuredAction)
  .addNode('validate_publication', validatePublication)
  .addNode('persist_success_fenced', persistSuccessFenced)
  .addNode('persist_failure', persistFailure)
  .addNode('project_genui', projectGenUi)
  .addNode('deliver', deliver)
  // deterministic edges and conditional failure routing
  .compile({ checkpointer: durableCheckpointer });
```

The wrapper must map the outer message representation to the agent's compatible `messages` input, pass the shared provider-attempt and semantic-correction ledger objects plus deadline/run-current context, and map typed `structuredResponse`, message updates, updated budgets, interrupt metadata, and classified failures back. It must pass the inherited `RunnableConfig` so the parent-owned checkpointer, `thread_id`, and nested checkpoint namespace remain authoritative. It must not swallow interrupts or convert them into ordinary failures. Direct `.addNode('semantic_agent', semanticAgent)` composition is forbidden unless a future migration first supplies and tests genuinely shared `messages` and `structuredResponse` channels.

The example is a responsibility map, not a mandate to discard compatible existing runner, schema, persistence, or routing modules. Adapt those modules where they already implement the required outer behavior.

The nested factory must not receive or compile with a separate durable checkpointer. The parent compilation owns it. Tests must verify the wrapper's input/output mappings, that the nested namespace remains stable across interrupt and resume, and that the parent is resumed with the same `thread_id` and `Command`.

## Nested middleware order and retry constraints

Middleware ordering is specified and tested by hook phase rather than as one misleading linear sequence. The contract for installed LangChain 1.5.3 is:

- `wrapModelCall` hooks nest in middleware-array order: the first matching middleware is outermost. The required nesting is dynamic prompt/tool policy outside the one-turn transient-retry wrapper, the retry wrapper outside the physical-attempt guard, and the guard immediately around every actual provider handler invocation. Therefore every initial call and retry reserves from the same six-attempt ledger before reaching the provider;
- `afterModel` hooks execute in reverse middleware-array order. Whole-batch authored-call validation must run before standard human-in-the-loop inspection, so `humanInTheLoopMiddleware(...)` appears earlier and the whole-batch validation middleware later in the array;
- tool execution occurs only after the reverse-order validation/HITL chain completes, and thin tool adapters invoke the existing business gateway only after any required HITL resume;
- lifecycle hooks may observe the phases but must not add `wrapModelCall` or `afterModel` behavior that changes this nesting or order.

Tests must record the actual hook/handler sequence, not merely inspect the middleware array. They must prove `dynamic policy -> retry -> physical-attempt guard -> provider` for both the first attempt and a classified retry, and `model -> whole-batch validation -> HITL -> tool` for an accepted irreversible call. A separate invalid irreversible batch test must prove validation stops the path before both HITL interruption and tool execution.

Retry classification must unwrap `MiddlewareError.cause`. `StructuredOutputParsingError` is semantic, never transient, and must not enter the provider-retry path.

For provider-native `providerStrategy`, LangChain 1.5.3 throws terminal `StructuredOutputParsingError` inside model handling before any post-model or post-agent lifecycle hook can run. The concrete catchable correction path is the `semantic_agent` wrapper around `agent.invoke()`: it traverses `MiddlewareError.cause`, catches only a structured-output parsing failure, consumes the single shared semantic-correction budget, appends bounded schema feedback to the mapped agent input, and invokes the same complete agent once more with the same inherited config, ledger objects, immutable deadline, abort signal, and run-current state. A second parsing failure, or an exhausted correction budget, maps to `agent_semantic_correction_limit_exceeded` and outer failure persistence. Graph interrupts are always rethrown, and every unrelated error keeps its existing classification. No post-model or post-agent lifecycle hook is a correction path.

## Dynamic tool policy

Register the complete KFC tool catalog with the nested agent, then filter the model-visible subset on every model call using the existing deterministic tool-profile rules.

Visibility depends on authenticated scopes, verified provider state, capability evidence, saved-address and payment authority, durable approval support, consumed tools, closed independent reads, and response-only state.

The model never receives all tools unconditionally. Consumed tools and closed initial reads do not reopen. The runtime does not auto-fetch evidence, select a target, infer a channel, synthesize a tool call, or add scenario-specific routing.

A prompt rule asks the model to request all currently necessary, non-speculative independent reads in the first independent-read batch.

## Model attempts and correction budgets

The complete turn preserves one shared ceiling of six physical provider calls. Every initial call, retry, tool-follow-up call, structured-response call, and wrapper-initiated corrected agent invocation consumes the same ledger.

Use one classified transient retry. `ChatOpenAI.maxRetries` remains zero so the ledger sees every physical provider attempt. The retry predicate is limited to network failure, timeout with remaining outer deadline, rate limit, and retryable server error. No retry begins after deadline expiry or run supersession.

The runtime preserves one semantic correction. Invalid model-authored tool batches, `StructuredOutputParsingError`, and other invalid provider-native structured responses may consume it. Typed provider or tool execution failures do not consume it; they close ordinary commerce planning and proceed to response composition from actual receipts.

## Whole-batch tool-call validation

Before any authored batch executes, middleware validates the complete batch against the current deterministic profile and canonical Zod schemas.

Accepted batches are either:

1. only currently eligible independent reads; or
2. one dependent read, mutation, approval action, or terminal operation.

Validation rejects stale profiles, unavailable tools, malformed arguments, duplicate calls, invalid approval batches, and unsafe parallel combinations.

The runtime never removes, appends, replaces, reorders, or manufactures semantic calls. A correctable invalid batch receives bounded feedback through the one semantic-correction path.

## Approvals

Use `humanInTheLoopMiddleware` and standard nested LangGraph interrupt/resume behavior. Nested interrupts propagate to the outer workflow, which persists the existing KFC confirmation pause against the exact parent thread, nested namespace, and checkpoint coordinates.

Approval editing is disabled. Supported workflow decisions are approve and reject. Resume the same parent workflow with the same thread and a `Command`; do not start a fresh agent invocation.

Irreversible KFC tools remain thin adapters around the existing business gateway. Before execution, existing approval code validates the authenticated principal, exact action digest, target, channel, capability evidence, provider revisions, authority generation, run, attempt, token, parent thread, stable nested namespace, checkpoint identity, deadline, and current ownership.

On approval, the existing exactly-once gateway injects server-owned confirmation and executes the canonical action. On rejection, no mutation executes and the nested agent resumes to compose the response.

The migration explicitly ignores the old checkpoint privacy contract. It does not introduce custom checkpoint sanitization, digest projection solely for privacy, candidate externalization, a second durable pause model, or a fresh post-approval invocation.

## Structured response and trusted routing

Replace the synthetic `submitGroundedResponse` tool with:

```ts
responseFormat: providerStrategy(agentPublicationSchema)
```

Read the final typed result from `structuredResponse`. The outer graph routes only trusted structured actions and passes publication data through existing deterministic validators. Those validators continue to enforce evidence closure, official-source requirements, publication references, selected-action effects and revisions, and the prohibition on claiming unexecuted mutations.

An invalid model-authored structured response consumes the one semantic correction through the wrapper-level `agent.invoke()` catch-and-reentry mechanism described above. The corrected invocation appends bounded schema feedback and uses the same complete agent, inherited config, deadline, and six-attempt ledger. A second invalid response fails as `agent_semantic_correction_limit_exceeded` and enters outer failure persistence.

## Deadlines, persistence, and failure precedence

The outer workflow creates one immutable 30,000 ms execution deadline and abort signal used by all nested model and tool operations. It gates run currency before nested invocation, after nested completion or interrupt, before publication, and before delivery.

The irreversible-operation lease is 60,000 ms: the execution deadline plus a bounded persistence margin. The margin permits persistence, reconciliation, and cleanup only.

Successful publication uses fenced persistence. Every terminal failure uses the explicit failure-persistence path. If failed-closed event persistence becomes stale, preserve an already-classified `agent_turn_deadline_exceeded`; translate other stale failed-closed commits to `customer_run_cancelled`. Successful stale commits never publish.

D1 lease comparisons must be millisecond-precise. Tests prove ownership at 59,999 ms and expiry at exactly 60,000 ms.

## Production latency

The universal soft-quality target is strictly less than 10,000 ms for greeting, menu, and overall production samples. The client-side cutoff and hard runtime deadline remain 30,000 ms.

Release, readiness, and each chat sample use separate named `AbortSignal.timeout(30_000)` instances. The chat signal is created inside each sample iteration.

## Tests

Retain as authoritative:

- all nine canonical scenarios and 46 canonical turns;
- all 92 Text/GenUI cases;
- business, authorization, tool, safety, provenance, state-transition, persistence, publication, and delivery oracles;
- exact approval, execution-fence, operation-claim/CAS, provider-idempotency, reconciliation, and exactly-once mutation tests;
- deadline, lease, run-fence, checkpoint, nested-namespace, and stale-publication tests;
- provider-attempt and semantic-correction limits.

Replace or adapt only:

- exact obsolete low-level semantic node and edge inventories;
- route-destination tests tied only to the old semantic loop;
- state-schema assertions that describe only removed semantic-loop internals;
- literal `submitGroundedResponse` and `bindTools()` mechanics;
- blanket `createAgent` and middleware bans.

New hybrid-runtime tests cover:

- cached outer-workflow construction and compilation with the durable checkpointer;
- wrapper composition of one complete `createAgent` compiled graph behind the named `semantic_agent` node;
- explicit outer-to-agent input mapping and agent-to-outer mapping for `structuredResponse`, messages, shared budgets, interrupt metadata, and failures;
- inherited `RunnableConfig` plus absence of an independently owned nested durable checkpointer;
- dynamic tool filtering after every model/tool transition;
- whole-batch validation before HITL inspection or tool execution;
- an invalid irreversible batch being rejected without an HITL interrupt and without reaching a tool;
- the physical-attempt guard inside the retry wrapper;
- unwrapping `MiddlewareError.cause` and excluding `StructuredOutputParsingError` from transient retry;
- shared six-attempt accounting including retry and structured output;
- one semantic correction through the `semantic_agent` wrapper, including terminal provider-strategy parsing failure and exactly one re-entry into the same complete agent with shared ledgers and inherited config;
- nested approval interrupt propagation and same-parent-thread `Command` resume;
- stable nested checkpoint namespace across pause and resume;
- HITL approval being insufficient without the existing signed KFC authority chain;
- typed execution failure proceeding to response composition;
- outer trusted routing, publication validation, success/failure persistence, GenUI, and delivery;
- GPT-5 mini profile and `langgraph-create-agent-workflow-v1` runtime identity.

## Implementation sequence

1. Remove the obsolete documentation and source-test prohibition on reviewed `createAgent` composition.
2. Add `langchain@1.5.3`, update the lockfile, and pin GPT-5 mini across OpenAI profile and qualification identity surfaces.
3. Add focused failing tests for outer-workflow composition, nested agent construction, middleware contracts, checkpoint ownership, and namespace-stable resume.
4. Implement the nested `createAgent` factory without an independent durable checkpointer.
5. Adapt `buildGraph.ts` to cache and compile the reduced outer workflow with its explicit durable checkpointer and the named `semantic_agent` wrapper around the complete nested agent graph.
6. Adapt existing runner, state schema, trusted routing, persistence, publication, GenUI, delivery, and failure responsibilities to the reduced outer workflow.
7. Replace `submitGroundedResponse` with provider-native structured output and implement the tested terminal correction path.
8. Adapt approval projection and resume to propagated nested interrupts, the same parent thread, stable nested namespace, and `Command` while preserving all existing KFC authority checks.
9. Remove only obsolete low-level semantic nodes/helpers and topology-only tests after hybrid-runtime tests pass.
10. Fix required existing blockers: D1 millisecond lease precision, 60-second memory boundary, deadline failure precedence, named latency signals, membership durable-resume test setup, observability category mappings, typing, and formatting.
11. Run the complete offline quality gate.
12. Run paid scenarios 03, 07, and 01 with GPT-5 mini.
13. Run the complete 11-scenario/50-turn Text replay serially.
14. Deploy only if every required gate passes.

## Verification gates

The offline gate includes formatting, lint, strict lint, type checking, unit/integration tests, build, architecture checks, policy checks, Worker dry-run, and root deployment-script tests.

Paid reports record scenario and turn pass rates, hard-deadline failures, soft-latency failures, semantic failures, tool/oracle failures, state-transition failures, provider-evidence failures, persistence/approval failures, infrastructure failures, provider, exact model snapshot, profile, mode, concurrency, and release SHA.

The paid qualification order remains focused scenario 03, then 07, then 01, followed by the complete nine-scenario/46-turn Text replay at concurrency nine. No deployment occurs after a failed gate. Google paid qualification and LangSmith dataset mutation remain outside scope.

## Acceptance criteria

The migration is complete only when:

- production uses one cached, compiled reduced outer KFC `StateGraph` whose named `semantic_agent` wrapper invokes one complete compiled `createAgent()` graph through an explicit tested state/config mapping boundary;
- the runtime identity is `langgraph-create-agent-workflow-v1`;
- the model is `gpt-5-mini-2025-08-07` with low reasoning and low verbosity;
- only the obsolete hand-authored low-level semantic loop and topology-only tests are removed;
- the outer graph retains hydration, deadline/run-current gates, trusted routing, publication validation, fenced success persistence, failure persistence, GenUI, and delivery;
- the outer graph owns the explicit durable checkpointer and the nested agent inherits checkpointing per invocation;
- nested approval interrupts resume the same parent thread with `Command` and a stable tested nested namespace;
- standard HITL workflow control never substitutes for the signed KFC receipt, exact binding, fence, claim/CAS, provider idempotency, or reconciliation;
- every physical provider attempt shares the six-call ceiling and one governed retry;
- the attempt guard is inside the retry wrapper, wrapped causes are classified, and structured-output parsing errors are not retried as transient;
- typed tool failures do not consume semantic correction;
- model-authored invalid calls or responses receive at most one correction; terminal structured-output parsing is corrected only by the tested wrapper-level catch-and-reentry path using the same complete agent, inherited config, and shared ledgers;
- the 30-second execution deadline and 60-second persistence lease remain separate;
- all canonical business and safety gates pass;
- focused and complete GPT-5 mini paid gates pass in the required order at concurrency nine;
- production latency remains below the universal 10-second soft target;
- no deployment gate is bypassed.
