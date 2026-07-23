# KFC Agentic LangSmith Proof Implementation Plan

> **Superseded orchestration plan (2026-07-20).** The tracing and evaluation
> goals remain useful historical evidence, but the procedural
> router/planner/composer implementation below is not the active target. The
> production runtime is one explicitly authored `@langchain/langgraph`
> `StateGraph`, with LangSmith observing that graph rather than defining a
> second orchestration loop.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trace the real KFC `runAgentTurn` decision path in LangSmith, replay a multi-turn agentic demo, evaluate the same checkout against all 14 golden context cases, and produce raw plus annotated Chrome proof artifacts.

**Architecture:** Add a project-owned optional tracing contract with no-op, in-memory, and LangSmith implementations. Wrap `runAgentTurn` with a root trace and emit ordered child spans from the existing procedural orchestration without migrating to `StateGraph`. A single proof runner records the checkout identity, runs the scripted scenario and native LangSmith experiment, then writes a manifest consumed by the Chrome screenshot walkthrough.

**Tech Stack:** TypeScript 5.8, Vitest 3, LangSmith JS 0.3, existing OpenAI Responses API planner/composer, Chrome control, built-in image editing.

## Global Constraints

- Preserve all pre-existing dirty checkout changes and stage only files created or edited by this plan.
- Do not migrate `runAgentTurn` to a compiled LangGraph `StateGraph`.
- Do not expose chain-of-thought, credentials, raw provider payloads, saved addresses, email addresses, phone numbers, or unrestricted history.
- Tracing failures must never change planning, tool execution, persistence, handoff, or customer response behavior.
- When LangSmith configuration is absent, tracing must be a no-op.
- Raw Chrome screenshots remain unchanged; annotated screenshots are separate files.
- Customer-facing scripted messages contain no debug prefixes, timestamps, or proof-only wording.
- The trace, experiment, manifest, and screenshots must identify the exact same Git commit and dirty-worktree state.

---

### Task 1: Safe tracing contract and LangSmith adapter

**Files:**
- Create: `services/kfc-agent-backend/src/observability/agentTracing.ts`
- Create: `services/kfc-agent-backend/src/observability/langsmithAgentTracer.ts`
- Create: `services/kfc-agent-backend/test/observability/agent-tracing.test.ts`

**Interfaces:**
- Produces: `AgentTracer.startTurn(input): Promise<AgentTurnTrace>`
- Produces: `AgentTurnTrace.startSpan(input): Promise<AgentTraceSpan>`
- Produces: `AgentTraceSpan.end(outputs)` and `AgentTraceSpan.fail(error)`
- Produces: `createSafeAgentTracer(delegate, onDiagnostic)` and `createNoopAgentTracer()`
- Produces: `LangSmithAgentTracer` backed by `RunTree`

- [ ] **Step 1: Write failing tests for no-op behavior, event ordering, and failure isolation**

```ts
it('records ordered child spans under one agent turn', async () => {
  const capture = new CapturingAgentTracer();
  const turn = await capture.startTurn({ name: 'agent_turn', inputs: { sessionId: 'demo' } });
  const planner = await turn.startSpan({ name: 'planner_iteration', runType: 'llm', inputs: { iteration: 1 } });
  await planner.end({ intent: 'cart_edit' });
  await turn.end({ replyIntent: 'general_reply' });
  expect(capture.events.map((event) => `${event.phase}:${event.name}`)).toEqual([
    'start:agent_turn',
    'start:planner_iteration',
    'end:planner_iteration',
    'end:agent_turn',
  ]);
});

it('swallows delegate failures and reports a local diagnostic', async () => {
  const diagnostics: string[] = [];
  const safe = createSafeAgentTracer(new ThrowingAgentTracer(), (message) => diagnostics.push(message));
  const turn = await safe.startTurn({ name: 'agent_turn', inputs: {} });
  const span = await turn.startSpan({ name: 'tool_call', runType: 'tool', inputs: {} });
  await span.end({ ok: true });
  expect(diagnostics).toContain('agent_trace_start_failed');
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd services/kfc-agent-backend && npm test -- test/observability/agent-tracing.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: FAIL because `agentTracing.ts` and its exported contract do not exist.

- [ ] **Step 3: Implement the minimal tracing contract and safe wrappers**

```ts
export type AgentTraceRunType = 'chain' | 'llm' | 'tool';

export interface AgentTraceSpanInput {
  name: string;
  runType: AgentTraceRunType;
  inputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface AgentTraceSpan {
  startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan>;
  end(outputs?: Record<string, unknown>): Promise<void>;
  fail(error: unknown): Promise<void>;
}

export interface AgentTracer {
  startTurn(input: Omit<AgentTraceSpanInput, 'runType'>): Promise<AgentTraceSpan>;
}
```

Implement no-op spans and safe proxy spans that catch delegate errors and emit only stable diagnostic codes.

- [ ] **Step 4: Implement `LangSmithAgentTracer` with `RunTree`**

Map `startTurn` to a root `RunTree`, child spans to `createChild`, successful completion to `end` plus `patchRun`, and failure to the LangSmith error field. Flush pending batches after the root ends. Do not mutate global environment variables.

- [ ] **Step 5: Run focused tests and build**

Run: `cd services/kfc-agent-backend && npm test -- test/observability/agent-tracing.test.ts --maxWorkers=1 --no-file-parallelism && npm run build`

Expected: focused tests PASS and TypeScript build exits 0.

### Task 2: Instrument the real agent turn without changing behavior

**Files:**
- Modify: `services/kfc-agent-backend/src/graph/buildGraph.ts:29-46,1830-2535`
- Create: `services/kfc-agent-backend/test/graph/agent-tracing.test.ts`

**Interfaces:**
- Consumes: `AgentTracer`, `AgentTraceSpan`, and safe tracing helpers from Task 1.
- Produces: optional `tracer?: AgentTracer` on `AgentTurnInput`.
- Produces: trace names `context_load`, `planner_iteration`, `policy_gate`, `tool_call`, `state_update`, `session_intelligence`, and `response_compose`.

- [ ] **Step 1: Write a failing graph test for blocked ambiguous mutation**

```ts
it('traces clarification and blocked cart mutation without executing updateCart', async () => {
  const tracer = new CapturingAgentTracer();
  const output = await runAgentTurn(buildInput({
    text: 'bỏ món đó',
    tracer,
    toolPlanner: ambiguousRemovalPlanner,
    priorCart: oneItemCart,
  }));
  expect(output.replyIntent).toBe('ask_clarification');
  expect(tracer.completedSpan('policy_gate').outputs).toMatchObject({
    allowedToolNames: [],
    blockedReasons: ['cart_mutation_confirmation_required'],
  });
  expect(tracer.startedNames()).not.toContain('tool_call:updateCart');
});
```

- [ ] **Step 2: Run the focused graph test and confirm RED**

Run: `cd services/kfc-agent-backend && npm test -- test/graph/agent-tracing.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: FAIL because `AgentTurnInput` does not accept or emit tracing.

- [ ] **Step 3: Add a root wrapper while preserving the existing core**

Rename the current implementation to `runAgentTurnCore(input, turnTrace)` and keep `runAgentTurn` as the public wrapper:

```ts
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const tracer = createSafeAgentTracer(input.tracer ?? createNoopAgentTracer(), recordTraceDiagnostic);
  const turnTrace = await tracer.startTurn(buildTurnTraceInput(input));
  try {
    const output = await runAgentTurnCore(input, turnTrace);
    await turnTrace.end(summarizeTurnOutput(output));
    return output;
  } catch (error) {
    await turnTrace.fail(error);
    throw error;
  }
}
```

The wrapper must preserve every existing early return and exception behavior.

- [ ] **Step 4: Trace context loading and every planner iteration**

Start `context_load` before verified-state and bounded-turn loading, and end it with a redacted state summary. Wrap each `toolPlanner.plan` call in `planner_iteration`, recording iteration number, model-safe inputs, intent, context policy, proposed tool names, response claims, and clarification signal.

- [ ] **Step 5: Trace policy decisions, tool execution, and state updates**

For every safety-gate application that governs a proposed tool, emit `policy_gate` with proposed names, allowed names, and blocked reason codes. Wrap each allowed `executeToolCall` in a `tool_call:<toolName>` span and emit a following `state_update` with redacted before/after summaries.

- [ ] **Step 6: Trace intelligence and response composition**

Wrap `emitSessionIntelligence` and `composeAndAppendAssistantTurn` at their real call sites. Neutral greeting and no-planner paths must still produce valid root traces without fabricated planner or tool spans.

- [ ] **Step 7: Add allowed-tool and trace-failure tests**

Verify that a named cart removal emits planner, policy, tool, state, and response spans; verify the final customer output is byte-for-byte identical with a no-op tracer, capturing tracer, and throwing tracer.

- [ ] **Step 8: Run graph regression tests**

Run: `cd services/kfc-agent-backend && npm test -- test/graph/agent-tracing.test.ts test/graph/planner-context-policy.test.ts test/graph/context-policy.test.ts test/graph/ai-tool-graph.test.ts test/graph/order-confirmation.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: all selected graph tests PASS.

### Task 3: One-command trace, experiment, and proof manifest

**Files:**
- Create: `services/kfc-agent-backend/src/proof/langsmithAgenticProof.ts`
- Create: `services/kfc-agent-backend/scripts/run-langsmith-agentic-proof.ts`
- Create: `services/kfc-agent-backend/test/proof/langsmith-agentic-proof.test.ts`
- Modify: `services/kfc-agent-backend/package.json`

**Interfaces:**
- Consumes: `LangSmithAgentTracer`, `runAgentTurn`, existing fixtures, `createContextExperimentTarget`, and `createContextExperimentEvaluator`.
- Produces: `runLangSmithAgenticProof(options): Promise<AgenticProofManifest>`.
- Produces: `buildAgenticProofManifest(input): AgenticProofManifest` for deterministic manifest validation.
- Produces: package script `proof:langsmith:agentic`.
- Produces: `artifacts/langsmith-agentic-proof/<timestamp>/manifest.json` and `walkthrough.md`.

- [ ] **Step 1: Write failing tests for prerequisites, metadata, and manifest shape**

```ts
it('rejects missing OpenAI and LangSmith credentials before a run', async () => {
  await expect(runLangSmithAgenticProof({ openAiApiKey: '', langSmithApiKey: '' } as never))
    .rejects.toThrow('OPENAI_API_KEY and LANGSMITH_API_KEY are required');
});

it('records one checkout identity for scenario and experiment', () => {
  const checkout = { commit: 'abc123', branch: 'main', dirty: true, changedPaths: ['src/graph/buildGraph.ts'] };
  const manifest = buildAgenticProofManifest({
    generatedAt: '2026-07-11T00:00:00.000Z',
    checkout,
    scenario: { id: 'agentic-demo', traceUrl: 'https://smith.example/trace', turnCount: 6 },
    experiment: {
      name: 'kfc-context-eval-test',
      url: 'https://smith.example/experiment',
      caseCount: 14,
      scores: {
        context_relevance_pass: 1,
        forbidden_context_absent: 1,
        required_behavior_present: 1,
        forbidden_tools_absent: 1,
        required_tools_present: 1,
        state_mutation_allowed: 1,
      },
    },
  });
  expect(manifest.trace.commit).toBe(manifest.experiment.commit);
  expect(manifest.trace.dirty).toBe(manifest.experiment.dirty);
  expect(manifest.experiment.caseCount).toBe(14);
  expect(Object.values(manifest.experiment.scores).every((score) => score === 1)).toBe(true);
});
```

- [ ] **Step 2: Run the focused proof test and confirm RED**

Run: `cd services/kfc-agent-backend && npm test -- test/proof/langsmith-agentic-proof.test.ts --maxWorkers=1 --no-file-parallelism`

Expected: FAIL because the proof module does not exist.

- [ ] **Step 3: Implement checkout identity and redaction helpers**

Capture `git rev-parse HEAD` and `git status --porcelain` once at process start. Store only the commit, branch, dirty boolean, and changed path names. Add a recursive forbidden-key check for secrets and customer PII before posting trace metadata or writing the manifest.

- [ ] **Step 4: Implement the scripted multi-turn scenario**

Use fixture-backed upstream clients with the real OpenAI planner/composer. Replay natural Vietnamese customer messages for concrete selection, ambiguous removal, named removal, fulfillment continuation, explicit confirmation, and justified support handoff. Record per-turn trace URLs and assertions for expected mutation or restraint.

- [ ] **Step 5: Run the native 14-case live experiment in the same process**

Call LangSmith `evaluate` with `kfc-context-relevance-golden-v1`, `createContextExperimentTarget({ mode: 'live' })`, and `createContextExperimentEvaluator()`. Fail the command unless every one of the six score keys passes all 14 cases.

- [ ] **Step 6: Write manifest and walkthrough atomically**

The manifest contains checkout identity, scenario ID, root trace URL, experiment name and URL, six score summaries, raw/annotated screenshot slots, and a numbered callout legend. Write to a temporary sibling file and rename it to `manifest.json` only after all required proof stages pass.

- [ ] **Step 7: Add package script and run focused tests**

Add:

```json
"proof:langsmith:agentic": "set -a; [ ! -f ../../.env ] || . ../../.env; set +a; tsx scripts/run-langsmith-agentic-proof.ts"
```

Run: `cd services/kfc-agent-backend && npm test -- test/proof/langsmith-agentic-proof.test.ts --maxWorkers=1 --no-file-parallelism && npm run build`

Expected: focused tests PASS and build exits 0.

### Task 4: Live Chrome proof and annotated walkthrough

**Files:**
- Create during proof: `artifacts/langsmith-agentic-proof/<timestamp>/trace-tree-raw.png`
- Create during proof: `artifacts/langsmith-agentic-proof/<timestamp>/trace-tree-annotated.png`
- Create during proof: `artifacts/langsmith-agentic-proof/<timestamp>/policy-detail-raw.png`
- Create during proof: `artifacts/langsmith-agentic-proof/<timestamp>/policy-detail-annotated.png`
- Create during proof: `artifacts/langsmith-agentic-proof/<timestamp>/experiment-raw.png`
- Create during proof: `artifacts/langsmith-agentic-proof/<timestamp>/experiment-annotated.png`
- Modify during proof: `artifacts/langsmith-agentic-proof/<timestamp>/manifest.json`
- Modify during proof: `artifacts/langsmith-agentic-proof/<timestamp>/walkthrough.md`

**Interfaces:**
- Consumes: proof URLs and callout legend from Task 3.
- Produces: raw and annotated PNG evidence plus a linked Markdown walkthrough.

- [ ] **Step 1: Run the complete live proof once**

Run: `cd services/kfc-agent-backend && npm run proof:langsmith:agentic`

Expected: exit 0, one timestamped proof directory, a root trace URL, a live experiment URL, 14 passed cases, and six perfect score summaries.

- [ ] **Step 2: Open the exact trace and experiment in Chrome**

Use the URLs from the manifest. Verify the root tree visibly contains the stages that occurred and the experiment visibly shows 14 runs with `1.00` for all six evaluator columns.

- [ ] **Step 3: Capture raw screenshots with Chrome**

Capture the trace tree, one policy/tool detail, and the experiment table. Save the original PNG bytes without crop annotations or overlays.

- [ ] **Step 4: Create separate annotated screenshots**

For each raw screenshot, inspect it first, then create a non-destructive edit with numbered boxes, arrows, and connector lines. Preserve all underlying UI text and values. Use short numeric markers in-image and keep full explanations in `walkthrough.md`.

- [ ] **Step 5: Validate visual evidence**

Inspect raw and annotated images side-by-side. Reject any annotation that moves, changes, or invents LangSmith text. Confirm every arrow endpoint matches its legend entry.

- [ ] **Step 6: Update manifest and walkthrough**

Record absolute and repo-relative image paths, captured Chrome URLs, trace/experiment identifiers, and the numbered legend. Embed the annotated images in the walkthrough with links to the corresponding raw originals.

### Task 5: Full verification and handoff

**Files:**
- Verify all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: all prior deliverables.
- Produces: fresh test/build/proof evidence and a concise handoff.

- [ ] **Step 1: Run the full backend suite serially**

Run: `cd services/kfc-agent-backend && npm test -- --maxWorkers=1 --no-file-parallelism`

Expected: all backend tests PASS with zero failures.

- [ ] **Step 2: Run the TypeScript build**

Run: `cd services/kfc-agent-backend && npm run build`

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 3: Re-run the proof command from the final checkout**

Run: `cd services/kfc-agent-backend && npm run proof:langsmith:agentic`

Expected: a fresh trace and experiment sharing the final checkout identity, 14/14 passing cases, and six `1.00` averages.

- [ ] **Step 4: Audit diff and artifact integrity**

Run: `git diff --check` and inspect `git status --short`, ensuring unrelated pre-existing modifications remain unstaged and unaltered. Verify the manifest contains no forbidden credential or PII keys.

- [ ] **Step 5: Report exact evidence**

Provide clickable paths to the implementation, manifest, walkthrough, raw screenshots, and annotated screenshots. State the recorded commit and dirty flag explicitly; do not describe a dirty proof as a reproducible clean-commit proof.
