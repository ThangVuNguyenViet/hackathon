# KFC Hybrid `createAgent` and GPT-5 Mini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace only the hand-authored semantic model/tool loop with one complete LangChain `createAgent()` compiled graph invoked through a named `semantic_agent` wrapper node inside a reduced deterministic KFC `StateGraph`, use `gpt-5-mini-2025-08-07`, and pass the canonical offline and paid live scenario gates.

**Architecture:** Keep the public `runAgentTurn()` facade and adapt `createKfcAgentStateGraph()`/`runKfcAgentStateGraphTurn()` into a cached, compiled outer workflow. The outer graph owns turn hydration, trusted structured-action routing, the immutable 30-second deadline and run-current gates, final publication validation, fenced success persistence, failure persistence, GenUI projection, and delivery. Its named `semantic_agent` wrapper node maps the existing outer state/context into one complete compiled `createAgent()` graph, invokes it with inherited runtime configuration, and maps typed output, shared budgets, interrupts, and failures back. The agent owns the semantic model/tool loop, dynamic tool middleware, whole-batch validation, one transient retry within six physical attempts, standard `humanInTheLoopMiddleware`, and provider-native structured output. The agent middleware and `semantic_agent` wrapper share one semantic-correction budget; the wrapper is the concrete interception point for terminal provider-strategy parsing failure. The parent outer graph owns the explicit durable checkpointer; the nested agent inherits per-invocation checkpointing. Nested interrupts propagate and resume the same parent thread with `Command` and a stable tested nested namespace. Existing KFC tool eligibility, signed approval receipts, exact current binding, execution fences, durable operation claim/CAS, provider idempotency/reconciliation, persistence, publication, and delivery remain authoritative; HITL is workflow control only.

**Tech Stack:** TypeScript, Node.js 22, LangChain JavaScript `langchain@1.5.3`, `@langchain/langgraph@1.4.8`, `@langchain/openai@1.5.5`, Zod, Vitest.

**Execution rule:** Do not create an `AgentKernel`, dual runtime, custom checkpoint sanitizer, privacy-only digest projection, candidate externalization, application-owned fresh post-approval invocation, or production multi-agent runtime. Do not delete all `StateGraph` code. Do not commit unless the user explicitly requests a commit.

## Status, runtime identity, and construction boundary

This is the authorized direct-cutover implementation plan for the hybrid architecture. It replaces only the hand-authored semantic graph loop; deployment remains blocked until every offline and paid gate passes.

The runtime identity is:

```text
langgraph-create-agent-workflow-v1
```

```text
runAgentTurn()
  -> cached compiled outer KFC StateGraph (owns durable checkpointer)
       -> hydrate + immutable deadline/run-current gates
       -> semantic_agent: one complete createAgent graph
            -> dynamic tools + whole-batch validation
            -> one transient retry / six physical attempts
            -> standard HITL + provider-native structured output
       -> trusted structured-action route
       -> final publication validation
       -> fenced success persistence OR failure persistence
       -> GenUI projection + delivery
```

`createAgent` owns semantic iteration, its middleware budgets, HITL workflow control, and provider-native structured output. The outer workflow owns hydration, trusted routing, the immutable deadline and run-current gates, final publication validation, success/failure persistence, GenUI, and delivery. Existing KFC services own business authorization and execution: a native HITL approval is not sufficient without the signed receipt, exact current binding, execution fence, durable operation claim/CAS, provider idempotency, and reconciliation.

---

## File structure

Create focused nested-agent files:

- `services/kfc-agent-backend/src/agent/kfcCreateAgent.ts` — constructs the single complete nested `createAgent()` graph without an independent durable checkpointer.
- `services/kfc-agent-backend/src/agent/kfcCreateAgentTools.ts` — defines executable LangChain `tool()` adapters around the existing `executePortableCommerceCall()`/`executeAgentToolCall()` boundary.
- `services/kfc-agent-backend/src/agent/kfcCreateAgentMiddleware.ts` — dynamic tool visibility, whole-batch validation, physical-attempt ledger inside retry, cause-aware transient classification, and the shared semantic-correction budget.
- `services/kfc-agent-backend/test/agent/kfc-create-agent.test.ts` — nested factory, middleware, structured output, correction, and execution-outcome tests.
- `services/kfc-agent-backend/test/agent/kfc-create-agent-approval.test.ts` — propagated HITL interrupt/resume, stable nested namespace, and exactly-once integration tests.

Retain and adapt outer-workflow integration surfaces:

- `services/kfc-agent-backend/package.json`
- `services/kfc-agent-backend/package-lock.json`
- `services/kfc-agent-backend/src/config/agentModelProfile.ts`
- `services/kfc-agent-backend/src/graph/buildGraph.ts` — caches/compiles the reduced outer workflow with the explicit durable checkpointer.
- `services/kfc-agent-backend/src/agent/agentStateGraph.ts` — retain and reduce the existing deterministic outer nodes and routing in place.
- `services/kfc-agent-backend/src/agent/agentStateGraphRunner.ts` — retain and adapt the existing parent invocation/resume facade and nested-interrupt projection in place.
- `services/kfc-agent-backend/src/agent/agentStateSchema.ts` and `services/kfc-agent-backend/src/agent/agentStateGraphContracts.ts` — retain and adapt the existing outer state, typed nested result, and persistence contracts in place.
- `services/kfc-agent-backend/src/graph/studioAgent.ts`
- `services/kfc-agent-backend/src/api/productionConfirmationResume.ts`
- `services/kfc-agent-backend/src/api/confirmationPausePersistence.ts`
- `services/kfc-agent-backend/src/graph/agentTurnState.ts`
- runtime identity consumers in readiness, route system handlers, proof files, and live qualification manifests.
- `services/kfc-agent-backend/test/runtime/runtime-source-guard.test.ts`
- topology-coupled graph tests listed in the design specification.
- `docs/wayfinder/kfc-model-agnostic-agent-runtime/assets/donor-adoption-manifest.md`

Delete only after hybrid-runtime parity is green:

- obsolete low-level semantic model/tool nodes, route helpers, and observability wrappers that have no remaining outer-workflow responsibility or imports;
- synthetic `submitGroundedResponse` tool definitions and topology-only assertions tied solely to the removed semantic loop.

Do not delete the outer graph, runner, schema, contracts, persistence/failure nodes, approval projection, trusted routing, GenUI, or delivery code. Ignore the old checkpoint privacy contract; remove privacy-only sanitizer/digest/candidate machinery only if it is otherwise obsolete, while preserving exact checkpoint coordinates needed for resume.

Keep existing business boundaries:

- `src/ordering/agentToolExecutor.ts`
- `src/ordering/toolExecutor.ts`
- `src/api/confirmationApprovalCapability.ts`
- `src/api/confirmationResumeAuthority.ts`
- `src/ordering/approvalReceipt.ts`
- `src/ordering/approvalExecutionFence.ts`
- existing durable operation-claim/CAS, provider idempotency/reconciliation, memory, D1, PostgreSQL checkpoint, and irreversible-operation stores.

---

## TDD implementation sequence

Execute Tasks 1-10 in order. Preserve RED/GREEN discipline and do not advance to paid qualification until the complete offline gate is green.

### Task 1: Permit and install nested `createAgent` composition

**Files:**
- Modify: `services/kfc-agent-backend/package.json:51-62`
- Modify: `services/kfc-agent-backend/package-lock.json`
- Modify: `services/kfc-agent-backend/test/runtime/runtime-source-guard.test.ts:53-114,235-250`
- Modify: `docs/wayfinder/kfc-model-agnostic-agent-runtime/assets/donor-adoption-manifest.md`

- [ ] **Step 1: Write the failing source-policy test**

Change the dependency assertion to require exact LangChain and add path-scoped acceptance for the reviewed factory:

```ts
it('uses the reviewed LangChain createAgent runtime', () => {
  const packageJson: unknown = JSON.parse(
    readFileSync('package.json', 'utf8'),
  );
  if (!isRecord(packageJson) || !isRecord(packageJson.dependencies)) {
    throw new Error('package_dependencies_missing');
  }

  expect(packageJson.dependencies.langchain).toBe('1.5.3');
  expect(packageJson.dependencies['@langchain/langgraph']).toBe('1.4.8');
});
```

Remove these blanket forbidden patterns:

```ts
/from\s+['"]langchain['"]/u,
/\bcreateAgent\s*\(/u,
/\bcreateMiddleware\s*\(/u,
/\bhumanInTheLoopMiddleware\s*\(/u,
/\bmodelCallLimitMiddleware\s*\(/u,
/langgraph-create-agent-workflow-v1/u,
```

Retain:

```ts
/from\s+['"]@langchain\/langgraph\/prebuilt['"]/u,
/\bcreateReactAgent\s*\(/u,
/\bAgentExecutor\b/u,
```

Add a scoped guard that permits `createAgent(` only in `src/agent/kfcCreateAgent.ts`:

```ts
it('keeps createAgent construction in one reviewed factory', () => {
  const violations = runtimeFiles().filter((file) =>
    file !== 'src/agent/kfcCreateAgent.ts' &&
    /\bcreateAgent\s*\(/u.test(readFileSync(file, 'utf8'))
  );
  expect(violations).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm --prefix services/kfc-agent-backend run test -- test/runtime/runtime-source-guard.test.ts
```

Expected: FAIL because `langchain` is absent and the reviewed factory does not exist.

- [ ] **Step 3: Add the exact dependency**

Run:

```bash
npm --prefix services/kfc-agent-backend install --save-exact langchain@1.5.3
```

Expected manifest entry:

```json
"langchain": "1.5.3"
```

- [ ] **Step 4: Remove obsolete documentation rules**

Replace the donor-manifest statements that prohibit top-level `langchain`, `createAgent`, middleware, and the LangChain convenience dependency with this rule:

```md
The production runtime uses one reviewed LangChain JavaScript `createAgent()`
compiled graph behind a named `semantic_agent` wrapper node in a reduced
deterministic KFC `StateGraph`. The wrapper explicitly maps the incompatible
outer and agent state channels. The parent workflow owns the explicit durable checkpointer,
hydration, deadline/run-current gates, trusted routing, publication validation,
persistence, GenUI, and delivery. The nested agent owns the semantic model/tool
loop, inherited per-invocation checkpointing, middleware, structured output,
and human-review workflow control. Business authorization, signed approval
receipts, exact binding, execution fences, durable operation claim/CAS,
provider idempotency/reconciliation, and publication remain application-owned.
`AgentExecutor`, `createReactAgent`, duplicate semantic runtimes, deterministic
language routing, scenario-specific behavior, and manufactured model calls
remain prohibited.
```

- [ ] **Step 5: Run the focused policy test and verify GREEN**

Run the Task 1 test command again.

Expected: PASS.

---

### Task 2: Pin GPT-5 mini production and qualification profiles

**Files:**
- Modify: `services/kfc-agent-backend/src/config/agentModelProfile.ts:5-31,73-107`
- Test: the existing model-profile/config tests found by `rg -l 'gpt-4\.1-mini|openai-gpt-4\.1-mini' services/kfc-agent-backend/test`
- Modify: OpenAI monitor, outcome-judge, live qualification manifest, README/help, package scripts, and proof identity fixtures returned by the same search.

- [ ] **Step 1: Write failing profile assertions**

For both production and qualification OpenAI modes, assert:

```ts
expect(profile).toMatchObject({
  provider: 'openai',
  model: 'gpt-5-mini-2025-08-07',
  profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
});
```

Mock `ChatOpenAI` construction and assert:

```ts
expect(ChatOpenAI).toHaveBeenCalledWith(expect.objectContaining({
  model: 'gpt-5-mini-2025-08-07',
  useResponsesApi: true,
  reasoning: { effort: 'low' },
  verbosity: 'low',
  supportsStrictToolCalling: true,
  maxRetries: 0,
}));
expect(ChatOpenAI).not.toHaveBeenCalledWith(
  expect.objectContaining({ temperature: expect.anything() }),
);
```

- [ ] **Step 2: Run the focused config tests and verify RED**

Run every matching model-profile test file with:

```bash
npm --prefix services/kfc-agent-backend run test -- <matching-test-files>
```

Expected: FAIL on GPT-4.1 mini identities and `temperature: 0`.

- [ ] **Step 3: Implement the exact OpenAI profile**

Use one exact identity for OpenAI production, qualification, monitor, and outcome judge; the containing field already identifies the role:

```ts
const openAiAgentProfile = {
  provider: 'openai',
  model: 'gpt-5-mini-2025-08-07',
  profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
} as const;
```

Construct OpenAI with:

```ts
return new ChatOpenAI({
  apiKey: input.openAiApiKey,
  model: input.profile.model,
  useResponsesApi: true,
  reasoning: { effort: 'low' },
  verbosity: 'low',
  supportsStrictToolCalling: true,
  maxRetries: 0,
  configuration: input.openAiBaseUrl?.trim()
    ? { baseURL: input.openAiBaseUrl.trim() }
    : undefined,
});
```

Update `test:live:interruption` to set:

```text
KFC_AGENT_MODEL=gpt-5-mini-2025-08-07
```

- [ ] **Step 4: Replace stale OpenAI identity fixtures**

Run:

```bash
rg -l 'gpt-4\.1-mini|openai-gpt-4\.1-mini' services/kfc-agent-backend scripts tests docs/wayfinder
```

For executable configuration, qualification manifests, and test fixtures that describe the active OpenAI agent, replace the old identity with the exact GPT-5 mini snapshot/profile. Do not change historical prose that is explicitly labelled obsolete.

- [ ] **Step 5: Run profile tests and source policy tests**

Run the Task 2 focused tests and:

```bash
npm --prefix services/kfc-agent-backend run test -- test/runtime/runtime-source-guard.test.ts
```

Expected: PASS.

---

### Task 3: Create executable LangChain tools around the existing business gateway

**Files:**
- Create: `services/kfc-agent-backend/src/agent/kfcCreateAgentTools.ts`
- Modify: `services/kfc-agent-backend/src/agent/singleAgentRuntime.ts` to export the existing execution helper needed by the adapter.
- Test: `services/kfc-agent-backend/test/agent/kfc-create-agent.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Cover:

```ts
it('registers every canonical KFC tool with its strict Zod schema', () => {
  const tools = createKfcCreateAgentTools();
  expect(tools.map((entry) => entry.name)).toEqual(toolNames);
});

it('executes through the existing authorized gateway', async () => {
  const execute = vi.fn().mockResolvedValue({ ok: true, toolName: 'searchMenu' });
  const tool = createKfcCreateAgentTools({ execute }).find(
    (entry) => entry.name === 'searchMenu',
  );
  await tool!.invoke({ query: 'gà rán' }, { context: fakeContext });
  expect(execute).toHaveBeenCalledTimes(1);
});
```

Also assert that invalid arguments fail before provider dispatch and that irreversible calls still require the existing receipt/fence context.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npm --prefix services/kfc-agent-backend run test -- test/agent/kfc-create-agent.test.ts
```

Expected: FAIL because `kfcCreateAgentTools.ts` does not exist.

- [ ] **Step 3: Implement thin `tool()` adapters**

Use the canonical catalog and schemas:

```ts
import { tool, type ToolRuntime } from 'langchain';
import { agentToolArgumentSchemas, toolNames } from '../ordering/toolCatalog.js';

export function createKfcCreateAgentTools(input: {
  execute: typeof executePortableCommerceCall;
} = { execute: executePortableCommerceCall }) {
  return toolNames.map((name) =>
    tool(
      async (args, runtime: ToolRuntime<unknown, KfcCreateAgentContext>) => {
        const context = runtime.context;
        if (!context) throw new Error('kfc_create_agent_context_missing');
        return input.execute({
          runtime: context.runtime,
          call: { toolName: name, arguments: args },
        });
      },
      {
        name,
        description: toolDescription(name),
        schema: agentToolArgumentSchemas[name] as never,
      },
    ),
  );
}
```

The adapter must not import provider clients. It delegates to the existing execution boundary, which reparses arguments and validates server-owned authority.

- [ ] **Step 4: Run adapter and existing gateway tests**

Run:

```bash
npm --prefix services/kfc-agent-backend run test -- \
  test/agent/kfc-create-agent.test.ts \
  test/ordering/agent-tool-executor.test.ts \
  test/ordering/tool-executor.test.ts
```

Expected: PASS.

---

### Task 4: Implement the complete nested `createAgent` graph

**Files:**
- Create: `services/kfc-agent-backend/src/agent/kfcCreateAgentMiddleware.ts`
- Create: `services/kfc-agent-backend/src/agent/kfcCreateAgent.ts`
- Modify: pure helpers extracted from `agentToolCallValidationNode.ts` only when needed.
- Test: `services/kfc-agent-backend/test/agent/kfc-create-agent.test.ts`

The factory returns one complete compiled `createAgent()` graph. Because the existing outer schema and the agent schema do not share compatible `messages`/`structuredResponse` channels, Task 5 composes it through an explicit named `semantic_agent` wrapper node rather than adding the compiled graph directly. The factory must not accept, create, or compile with an independent durable checkpointer.

- [ ] **Step 1: Add failing factory and middleware tests**

Test these contracts with a scripted `BaseChatModel`:

1. the factory calls `createAgent()` exactly once and does not own a durable checkpointer;
2. the returned compiled graph is invoked through the named `semantic_agent` wrapper with explicit input/output and inherited-runtime-config mappings;
3. model-visible tools equal the deterministic profile, not the full catalog;
4. consumed and closed-frontier tools do not reappear;
5. a batch is either independent reads only or exactly one dependent/mutation call;
6. one classified transient failure retries once;
7. the physical-attempt guard is inside the one-turn retry wrapper, so both handler calls reserve attempts;
8. transient classification unwraps `MiddlewareError.cause`;
9. `StructuredOutputParsingError` is semantic and is never sent through transient retry;
10. every physical attempt, including retry and structured-response correction, reserves from the shared ceiling of six;
11. a seventh physical attempt fails before provider invocation;
12. invalid authored batches and invalid structured responses share one semantic-correction budget exposed through the runtime context;
13. terminal `StructuredOutputParsingError` escapes the compiled agent to the Task 5 wrapper and is not consumed by post-model/post-agent lifecycle hooks or transient retry;
14. typed execution failures do not consume semantic correction;
15. final output is read from `structuredResponse`, not `submitGroundedResponse`;
16. an invalid irreversible batch is rejected before HITL, emits no interrupt, and reaches no tool.

Representative assertions:

```ts
expect(modelAttempts).toBe(2);
expect(runtime.providerAttempts.used).toBe(2);
expect(runtime.semanticCorrections.used).toBe(1);
expect(result.structuredResponse).toEqual(expectedPublication);
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
npm --prefix services/kfc-agent-backend run test -- test/agent/kfc-create-agent.test.ts
```

Expected: FAIL because the nested factory and middleware do not exist.

- [ ] **Step 3: Implement the nested factory without a checkpointer**

Specify and test ordering by hook phase:

- `wrapModelCall`, outer to inner: dynamic prompt/tool policy -> one-turn transient retry -> physical-attempt guard around each actual provider handler invocation;
- `afterModel`, execution order: whole-batch validation -> HITL inspection. LangChain 1.5.3 executes this phase in reverse middleware-array order, so register HITL earlier and whole-batch validation later;
- tool execution: existing business-gateway adapters run only after validation and any required approval resume;
- lifecycle hooks: tracing may observe these phases but must not reorder them.

Register middleware so those phase-specific contracts hold:

```ts
import {
  createAgent,
  humanInTheLoopMiddleware,
  providerStrategy,
} from 'langchain';

export function createKfcAgent(input: { model: BaseChatModel }) {
  return createAgent({
    model: input.model,
    tools: createKfcCreateAgentTools(),
    systemPrompt: AGENT_SYSTEM_PROMPT,
    contextSchema: kfcCreateAgentContextSchema,
    responseFormat: providerStrategy(groundedResponseSchema),
    version: 'v2',
    middleware: [
      // wrapModelCall is nested in array order: first is outermost.
      createDynamicToolPolicyMiddleware(),
      createOneTurnRetryMiddleware(),
      createPhysicalAttemptGuardMiddleware(),
      // afterModel runs in reverse array order: validation runs before HITL.
      humanInTheLoopMiddleware({
        interruptOn: reviewableToolConfiguration,
      }),
      createWholeBatchValidationMiddleware(),
      // This middleware must not define wrapModelCall or afterModel hooks.
      createKfcLifecycleTracingMiddleware(),
    ],
  });
}
```

Do not pass `checkpointer` here. `createAgent()` returns a compiled graph and the parent outer workflow supplies the explicit durable checkpointer when it compiles. Treat the displayed array as a hook-phase contract based on installed LangChain 1.5.3 behavior: `wrapModelCall` nests in array order with the first hook outermost, while `afterModel` executes in reverse array order. Integration tests must record and assert `dynamic policy -> retry -> physical-attempt guard -> provider` for both the first call and a retry, plus `model -> whole-batch validation -> HITL -> tool` for an accepted irreversible call. Lifecycle tracing must not define a `wrapModelCall` or `afterModel` hook that changes those sequences.

Configure HITL decisions as:

```ts
{ allowedDecisions: ['approve', 'reject'] }
```

Do not allow `edit`. HITL decisions control workflow only and never replace the signed KFC approval receipt or the existing business authorization chain.

- [ ] **Step 4: Put physical attempt accounting inside the one-turn retry wrapper**

Do not rely on `modelCallLimitMiddleware` for physical retry attempts. The one-turn retry middleware must call this guard immediately around each actual provider handler invocation, including the retry:

```ts
async function invokePhysicalAttempt(request, handler, runtime) {
  if (runtime.providerAttempts.used >= 6) {
    throw new Error('agent_provider_call_limit_exceeded');
  }
  runtime.providerAttempts.used += 1;
  assertRuntimeActive(runtime);
  return handler(request);
}
```

Catch only classified transient failures. Traverse `MiddlewareError.cause` before classifying the underlying error. Treat `StructuredOutputParsingError` as semantic, not transient. Retry once after a bounded delay only when the immutable outer deadline has time and the run is still current. Set adapter retries to zero. Tests must prove the first handler call and retry each consume one physical attempt.

- [ ] **Step 5: Implement dynamic tools and batch validation**

In `wrapModelCall`, derive the current profile using `createAgentToolProfileResolver`/`deriveAgentToolProfile`, then replace `request.tools` with only the permitted registered tools.

In `afterModel`, inspect the complete authored tool-call batch before HITL inspection or execution. LangChain 1.5.3 runs `afterModel` hooks in reverse middleware-array order, so `humanInTheLoopMiddleware(...)` must appear earlier and `createWholeBatchValidationMiddleware()` later in the array. Reuse:

- `ordinaryToolBindingManifest`
- `ordinaryToolBindingUpdateAfterAcceptedBatch`
- `isValidApprovalBatchShape`
- canonical schemas and side-effect disposition.

Never mutate, reorder, append, or synthesize calls. Add an integration test whose model authors an invalid irreversible batch and assert that validation rejects it without an HITL interrupt and without any tool invocation.

- [ ] **Step 6: Implement one shared semantic correction**

Use a runtime counter:

```ts
function consumeSemanticCorrection(runtime: KfcCreateAgentRuntime): void {
  if (runtime.semanticCorrections.used >= 1) {
    throw new Error('agent_semantic_correction_limit_exceeded');
  }
  runtime.semanticCorrections.used += 1;
}
```

Only model-authored invalid tool batches and invalid structured responses call this function. Provider and tool execution outcomes do not. In LangChain 1.5.3, `providerStrategy` raises terminal `StructuredOutputParsingError` inside model handling before any post-model or post-agent lifecycle hook runs. The catchable terminal path is implemented in Task 5 by the named `semantic_agent` wrapper around `agent.invoke()`, not by an agent lifecycle hook. The wrapper must traverse `MiddlewareError.cause`, consume this same counter, append bounded schema feedback, and re-enter the same complete agent once with the same inherited config, provider-attempt ledger, deadline, abort signal, and run-current state. A second structured-output parse failure or exhausted budget becomes `agent_semantic_correction_limit_exceeded`. The retry wrapper must continue to classify this error as non-transient. No post-model or post-agent lifecycle hook is a correction option.

- [ ] **Step 7: Run focused hybrid-runtime tests**

Run the Task 4 test command.

Expected: PASS.

---

### Task 5: Compose, invoke, and resume the hybrid outer workflow

**Files:**
- Modify: `services/kfc-agent-backend/src/graph/buildGraph.ts`
- Modify: `services/kfc-agent-backend/src/agent/agentStateGraph.ts` — retain and reduce the existing deterministic outer workflow in place.
- Modify: `services/kfc-agent-backend/src/agent/agentStateGraphRunner.ts` — retain and adapt the existing parent invocation/resume facade in place.
- Modify: `services/kfc-agent-backend/src/agent/agentStateSchema.ts` — retain and adapt the existing outer state schema in place.
- Modify: `services/kfc-agent-backend/src/agent/agentStateGraphContracts.ts` — retain and adapt the existing outer contracts in place.
- Modify: `services/kfc-agent-backend/src/api/productionConfirmationResume.ts`
- Modify: `services/kfc-agent-backend/src/api/confirmationPausePersistence.ts`
- Modify: `services/kfc-agent-backend/src/graph/agentTurnState.ts`
- Test: `services/kfc-agent-backend/test/agent/kfc-create-agent.test.ts` — wrapper state mapping and terminal structured-output correction integration.
- Test: `services/kfc-agent-backend/test/agent/kfc-create-agent-approval.test.ts`
- Adapt: `services/kfc-agent-backend/test/graph/native-confirmation-interrupt.test.ts`

- [ ] **Step 1: Write failing hybrid composition and native HITL tests**

Test:

- `buildGraph.ts` caches and compiles one reduced outer workflow per model/checkpointer configuration;
- the explicit durable checkpointer is passed only to the outer graph compilation;
- one complete `createAgent()` graph is invoked behind the named `semantic_agent` wrapper node, which explicitly maps the incompatible outer and agent state channels;
- the wrapper maps outer messages/context and shared ledgers into agent input, maps typed `structuredResponse`, message/budget updates, interrupt metadata, and classified failures back, and passes the inherited `RunnableConfig` unchanged except for the stable nested namespace;
- graph interrupts are rethrown through the wrapper rather than converted into ordinary failure state;
- the wrapper traverses `MiddlewareError.cause`, catches only terminal `StructuredOutputParsingError`, consumes the shared semantic-correction budget, appends bounded schema feedback, and invokes the same complete agent exactly once more with the same inherited config and six-attempt ledger;
- a second parsing failure or exhausted correction budget becomes `agent_semantic_correction_limit_exceeded`, while unrelated errors retain their existing classification;
- outer nodes retain hydration, immutable deadline/run-current gates, trusted structured-action routing, publication validation, fenced success persistence, failure persistence, GenUI, and delivery;
- initial parent invocation propagates exactly one nested interrupt for one irreversible action;
- review config permits approve/reject only;
- the pause is persisted against the exact parent thread, stable nested namespace, and checkpoint;
- approval resumes the parent with `new Command({ resume: { decisions: [{ type: 'approve' }] } })`;
- rejection resumes with `type: 'reject'` and performs zero irreversible calls;
- workflow approval alone cannot execute: signed receipt, exact current binding, fence, durable operation claim/CAS, and provider idempotency/reconciliation remain required;
- approve executes through the existing receipt/fence/idempotency gateway once;
- concurrent or duplicate resumes do not perform a second provider mutation;
- stale/tampered authority fails before tool dispatch;
- deadline or run supersession after nested completion enters failure persistence and never publishes.

- [ ] **Step 2: Run approval tests and verify RED**

Run:

```bash
npm --prefix services/kfc-agent-backend run test -- \
  test/agent/kfc-create-agent.test.ts \
  test/agent/kfc-create-agent-approval.test.ts \
  test/graph/native-confirmation-interrupt.test.ts
```

Expected: FAIL because the current outer graph still contains the hand-authored semantic loop and does not invoke the nested agent through the explicit wrapper boundary.

- [ ] **Step 3: Reduce the outer graph and compose the nested graph through an explicit state wrapper**

Retain/adapt the existing modules under `src/agent`: `agentStateGraph.ts`, `agentStateGraphRunner.ts`, `agentStateSchema.ts`, and `agentStateGraphContracts.ts`. Reduce them in place and remove only low-level semantic-loop nodes. Do not create duplicate `src/graph/agentStateGraph*` or `src/graph/agentStateSchema.ts` modules. Keep `src/graph/buildGraph.ts` as the facade/cache integration surface and `src/graph/studioAgent.ts` as the Studio export surface.

The outer schema's `messages` channel is not createAgent-compatible and it has no native `structuredResponse` channel, so do not pass the compiled agent directly to `.addNode()`. Add a named wrapper that performs the complete interface mapping and preserves interrupts:

```ts
const semanticAgent = createKfcAgent({ model });

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
  .compile({ checkpointer: durableCheckpointer });
```

The input mapping converts outer messages and agent state into createAgent-compatible input. The result mapping writes typed `structuredResponse`, message updates, provider-attempt and semantic-correction ledgers, interrupt metadata, and classified failure state back into the existing outer schema. The inherited `RunnableConfig` carries the parent `thread_id`, checkpointer context, and stable nested namespace; the wrapper must rethrow graph interrupts rather than convert them into failures. Direct `.addNode('semantic_agent', semanticAgent)` composition remains forbidden unless compatible shared `messages` and `structuredResponse` channels are introduced and tested first.

Use existing names where compatible; the contract is the responsibility boundary, not a mandatory rename. Create one immutable 30-second external-call scope before parent invocation and dispose it in `finally`. All nested model/tool calls share that scope, provider-attempt ledger, semantic-correction counter, and run-current state.

- [ ] **Step 4: Project propagated nested interrupts into the existing pause contract**

Parse the propagated interrupt payload:

```ts
result.__interrupt__[0].value = {
  actionRequests: [{ name, args }],
  reviewConfigs: [{ actionName, allowedDecisions }],
};
```

Require exactly one irreversible action and approve/reject only. Build the existing canonical approval binding and persist the existing confirmation pause with the exact parent thread, stable nested namespace, and checkpoint coordinates. Ordinary native checkpoint contents are accepted; the old checkpoint privacy contract is intentionally ignored. Do not add a sanitizer, privacy-only digest projection, or externalized action-candidate store.

- [ ] **Step 5: Resume the same parent workflow with `Command`**

Keep capability verification, exact current binding revalidation, durable atomic operation claim/CAS, signed receipt, signed execution fence, provider idempotency, and reconciliation in `productionConfirmationResume.ts`. Replace only the semantic continuation behavior so it resumes the same parent graph thread/checkpoint with `Command`; nested interrupt resume follows the stable namespace recorded at pause. Do not invoke a fresh agent.

- [ ] **Step 6: Cache and compile the outer workflow in `buildGraph.ts`**

Keep:

```ts
export async function runAgentTurn(
  input: AgentTurnInput,
): Promise<AgentTurnOutput>
```

Adapt `agentGraphFor()` to cache the compiled hybrid outer workflow keyed by model and durable checkpointer configuration. The outer compilation owns the checkpointer. Continue to use/adapt `runKfcAgentStateGraphTurn()` for parent invocation, result projection, persistence, and error precedence; do not replace it with a direct-agent runner.

- [ ] **Step 7: Run approval and exactly-once suites**

Run:

```bash
npm --prefix services/kfc-agent-backend run test -- \
  test/agent/kfc-create-agent.test.ts \
  test/agent/kfc-create-agent-approval.test.ts \
  test/graph/native-confirmation-interrupt.test.ts \
  test/api/confirmation-approval-capability.test.ts \
  test/api/confirmation-resume-authority.test.ts \
  test/api/confirmation-resume.test.ts \
  test/ordering/approval-execution-fence.test.ts \
  test/ordering/agent-tool-executor.test.ts
```

Expected: PASS, including stable nested namespace, same-parent-thread resume, business authority, and exactly-once assertions.

---

### Task 6: Update Studio, hybrid runtime identity, and structured publication

**Files:**
- Modify: `services/kfc-agent-backend/src/graph/studioAgent.ts`
- Modify: `services/kfc-agent-backend/src/workerReadiness.ts`
- Modify: `services/kfc-agent-backend/src/api/routeSystemHandlers.ts`
- Modify: `services/kfc-agent-backend/src/proof/kfcGenUiDeployedProof.ts`
- Modify: `services/kfc-agent-backend/src/domain/stateGraphTurnProof.ts`
- Modify: response-grounding tool definitions and tests.

- [ ] **Step 1: Write failing runtime-identity tests**

Replace expected identity with:

```text
langgraph-create-agent-workflow-v1
```

Add an assertion in `services/kfc-agent-backend/test/graph/studio-agent-runtime.test.ts` that Studio exports the same cached, compiled hybrid outer workflow and exposes the named `semantic_agent` wrapper plus its nested agent graph rather than a separate direct-agent runtime.

- [ ] **Step 2: Run identity and Studio tests and verify RED**

Run the matching readiness, system-handler, proof, and Studio tests.

Expected: FAIL on `langgraph-stategraph-v1` and the obsolete semantic-loop topology.

- [ ] **Step 3: Update identity and Studio exports**

Export the compiled hybrid outer workflow for Studio, including the named wrapper boundary and its nested complete agent graph. Move the runtime identity constant into a topology-neutral module such as `src/graph/buildGraph.ts`:

```ts
export const kfcAgentRuntimeImplementation = 'langgraph-create-agent-workflow-v1';
```

- [ ] **Step 4: Remove synthetic grounded-response tool mechanics**

Delete model exposure of `submitGroundedResponse`. Retain `groundedResponseSchema`, `validateGroundedResponse`, trusted selected-action routing, publication projection, and GenUI selection in the outer workflow. Read final response data from the nested result's `structuredResponse`. Correct terminal `StructuredOutputParsingError` only through the tested `semantic_agent` wrapper catch-and-reentry path from Task 5: consume the shared single semantic-correction budget, append bounded schema feedback, and invoke the same complete agent once more with the same inherited config and six-attempt ledger. Do not classify it as transient or rely on any post-model or post-agent lifecycle hook after provider-strategy termination.

- [ ] **Step 5: Run identity, publication, and GenUI tests**

Run the focused tests found by:

```bash
rg -l 'langgraph-stategraph-v1|submitGroundedResponse|GROUNDED_RESPONSE_TOOL_NAME' services/kfc-agent-backend/test
```

Expected: PASS after converting implementation-mechanism assertions to structured-response behavior.

---

### Task 7: Remove only the obsolete low-level semantic loop

**Files:**
- Delete obsolete low-level semantic nodes/helpers only after Tasks 1-6 pass.
- Retain and adapt the outer graph, runner, schema, contracts, trusted routing, persistence/failure nodes, approval projection, GenUI, and delivery modules.
- Adapt or delete exact topology-only tests tied solely to the removed semantic loop.
- Retain all business, deadline, persistence, approval, scenario, publication, and delivery tests.

- [ ] **Step 1: Classify remaining graph references**

Run:

```bash
rg -n 'agentStateGraph|agentStateGraphRunner|createKfcAgentStateGraph|runKfcAgentStateGraphTurn|submitGroundedResponse' services/kfc-agent-backend/src
```

Expected: `agentStateGraph`, `agentStateGraphRunner`, `createKfcAgentStateGraph`, and `runKfcAgentStateGraphTurn` remain where they implement the reduced outer workflow; `submitGroundedResponse` and references used only by obsolete low-level semantic nodes are absent. Every match must be classified as retained outer responsibility or deletion candidate.

- [ ] **Step 2: Delete only obsolete implementation pieces**

Delete hand-authored semantic model-call, tool-call, validation-routing, and response-submission nodes/helpers that have no remaining outer-workflow responsibility or imports. Remove a privacy-only checkpoint sanitizer/digest/candidate layer if it exists solely to satisfy the old checkpoint privacy contract, which is intentionally ignored.

Do not delete pure business helpers, the outer graph/runner/schema/contracts, deadline/run-current gates, trusted structured-action routing, success/failure persistence, confirmation-pause projection, GenUI, or delivery.

- [ ] **Step 3: Replace topology-only tests**

Delete assertions about exact obsolete semantic-node names, low-level edge inventories, old semantic route destinations, and literal `bindTools()`/`submitGroundedResponse` mechanics.

Replace them with hybrid behavior assertions for:

- cached/compiled outer workflow and named nested agent composition;
- parent-owned durable checkpointing and stable nested namespace;
- dynamic visible tools and whole-batch validation;
- propagated native interrupt and same-parent-thread `Command` resume;
- provider-native structured output and terminal semantic correction;
- outer deadline/run-current gates and six-call budget;
- trusted routing, publication validation, fenced persistence, failure persistence, GenUI, and delivery;
- signed KFC authority and business gateway effects.

- [ ] **Step 4: Run architecture and hybrid-runtime suites**

Run:

```bash
npm --prefix services/kfc-agent-backend run check:architecture
npm --prefix services/kfc-agent-backend run test -- \
  test/runtime/runtime-source-guard.test.ts \
  test/agent/kfc-create-agent.test.ts \
  test/agent/kfc-create-agent-approval.test.ts
```

Expected: PASS, one hybrid runtime identity, no obsolete low-level semantic-loop imports, and retained executable outer-workflow imports.

---

### Task 8: Run the complete offline gate

**Files:**
- Modify only files required by failing gates.

- [ ] **Step 1: Format changed files**

Run:

```bash
npm --prefix services/kfc-agent-backend run format
```

- [ ] **Step 2: Run static gates**

Run:

```bash
npm --prefix services/kfc-agent-backend run format:check
npm --prefix services/kfc-agent-backend run lint
npm --prefix services/kfc-agent-backend run lint:strict
npm --prefix services/kfc-agent-backend run typecheck
```

Expected: all commands exit zero.

- [ ] **Step 3: Run all backend tests**

Run:

```bash
npm --prefix services/kfc-agent-backend run test:ci
```

Expected: all non-live tests pass with no new skip or `.only`.

- [ ] **Step 4: Run build and policy gates**

Run:

```bash
npm --prefix services/kfc-agent-backend run build
npm --prefix services/kfc-agent-backend run check:architecture
npm --prefix services/kfc-agent-backend run policies:check
npm --prefix services/kfc-agent-backend run worker:deploy:dry-run
bash tests/deployment/deploy_scripts.test.sh
```

Expected: all commands exit zero.

---

### Task 9: Run paid GPT-5 mini focused live scenarios

**Files:**
- No source changes before collecting focused evidence.
- If a scenario fails, add a failing offline regression before changing production code.

- [ ] **Step 1: Run scenario 03**

Run from the repository root:

```bash
KFC_AGENT_PROVIDER=openai \
KFC_AGENT_MODEL=gpt-5-mini-2025-08-07 \
KFC_AGENT_PROFILE_MODE=production \
KFC_LIVE_SCENARIO_MODE=text \
npm --prefix services/kfc-agent-backend run test:live:scenarios -- \
  --testNamePattern='03-ton-kho-dia-chi-va-cua-hang\.json \[text\]'
```

Expected: scenario passes; typed tool failure does not consume semantic correction.

- [ ] **Step 2: Run scenario 07**

Use the same environment and:

```bash
npm --prefix services/kfc-agent-backend run test:live:scenarios -- \
  --testNamePattern='07-ca-nhan-hoa-va-loyalty\.json \[text\]'
```

Expected: approval interrupt/resume and membership behavior pass.

- [ ] **Step 3: Run scenario 01**

Use the same environment and:

```bash
npm --prefix services/kfc-agent-backend run test:live:scenarios -- \
  --testNamePattern='01-dat-mon-ro-rang-giao-hang\.json \[text\]'
```

Expected: representative order/deadline path passes.

- [ ] **Step 4: Stop on a focused failure**

Classify the failure as model/profile, semantic correction, tool/oracle, approval, deadline, persistence, or infrastructure. Add an offline test that reproduces it, observe RED, implement the minimal fix, rerun the offline gate, then repeat the focused scenario.

---

### Task 10: Run the complete paid demo gate

**Files:**
- No source changes unless an offline regression first reproduces a live failure.

- [ ] **Step 1: Run all nine scenarios at concurrency nine**

Run:

```bash
KFC_AGENT_PROVIDER=openai \
KFC_AGENT_MODEL=gpt-5-mini-2025-08-07 \
KFC_AGENT_PROFILE_MODE=production \
KFC_LIVE_SCENARIO_MODE=text \
KFC_LIVE_HIGH_RISK_REPETITIONS=1 \
KFC_LIVE_OUTCOME_JUDGE_PROVIDER=openai \
npm --prefix services/kfc-agent-backend run test:live:scenarios
```

The live scenario matrix runs serially so provider latency in one scenario does
not consume another scenario's turn deadline.

Expected: 11 scenario tests and all 50 canonical turns pass in one run.

- [ ] **Step 2: Record demo evidence**

Report:

- provider: OpenAI;
- model: `gpt-5-mini-2025-08-07`;
- profile: `openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low`;
- runtime: `langgraph-create-agent-workflow-v1`;
- mode: Text;
- concurrency: nine;
- scenario pass count;
- canonical turn pass count;
- hard-deadline, semantic, tool/oracle, approval, persistence, and infrastructure failures separately.

- [ ] **Step 3: Do not deploy on failure**

A failed focused, offline, or complete paid gate blocks deployment. Google live qualification and LangSmith dataset mutation remain outside scope.

---

## Acceptance criteria

The implementation is complete only when:

- `buildGraph.ts` caches and compiles one reduced deterministic outer KFC `StateGraph` with the explicit durable checkpointer;
- one complete `createAgent()` compiled graph is invoked by the named `semantic_agent` wrapper through explicit tested outer-to-agent and agent-to-outer state/config mappings, and owns no independent durable checkpointer;
- the runtime identity is exactly `langgraph-create-agent-workflow-v1`;
- OpenAI uses `gpt-5-mini-2025-08-07` with low reasoning, low verbosity, Responses API, strict tool calling, and `maxRetries: 0`;
- the outer graph retains hydration, trusted structured-action routing, immutable 30-second deadline/run-current gates, final publication validation, fenced success persistence, failure persistence, GenUI, and delivery;
- the nested agent owns dynamic tool visibility, whole-batch validation, standard HITL, provider-native structured output, one transient retry, and six shared physical attempts; its middleware and the wrapper share one semantic-correction budget, and the wrapper owns terminal provider-strategy parsing correction;
- the physical-attempt guard is inside the one-turn retry wrapper, `MiddlewareError.cause` is unwrapped, and `StructuredOutputParsingError` is semantic rather than transient;
- provider-strategy terminal correction uses only the tested `semantic_agent` wrapper catch-and-reentry path, invokes the same complete agent at most once more with inherited config, and shares the single semantic-correction budget and six-attempt ledger;
- nested interrupts propagate, persist the exact stable nested namespace, and resume the same parent thread with `Command`;
- HITL remains workflow control only, while the signed KFC receipt, exact binding, execution fence, durable operation claim/CAS, provider idempotency, and reconciliation remain authoritative;
- the old checkpoint privacy contract is not reintroduced through sanitization, privacy-only digest projection, candidate externalization, or a fresh invocation;
- only obsolete low-level semantic-loop code and topology-only assertions are removed; outer graph, runner, schema, persistence, approval, publication, and delivery responsibilities remain;
- all canonical business gates and the complete offline gate pass;
- paid scenarios run in order 03, 07, 01, then the full nine-scenario/46-turn Text replay at concurrency nine;
- no failed gate is bypassed and no deployment occurs on failure.
