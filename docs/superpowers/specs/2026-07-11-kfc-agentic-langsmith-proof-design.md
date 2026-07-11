# KFC Agentic LangSmith Proof Design

## Goal

Make the existing KFC agent runtime demonstrably agentic in LangSmith by tracing its real decision path and evaluating the same code snapshot against the existing 14-case context-relevance dataset.

The proof must show observable behavior rather than hidden chain-of-thought: which context the runtime activated, which tools the planner proposed, which calls policy allowed or blocked, what verified evidence tools returned, how state changed, and whether the final behavior passed the golden evaluators.

## Current State

The authoritative orchestration path is `runAgentTurn` in `services/kfc-agent-backend/src/graph/buildGraph.ts`. It is a procedural stateful graph rather than a compiled LangGraph `StateGraph`. It loads verified state, invokes the multi-step planner up to four times, applies context policy and deterministic safeguards, executes typed tools, persists verified state, computes session intelligence, composes a response, and selects GenUI.

The repository already has two useful but separate LangSmith proof mechanisms:

- `scripts/run-langsmith-context-baseline.ts` manually creates nested planner, composer, and tool runs for one baseline scenario.
- `scripts/run-langsmith-context-experiment.ts` runs the 14-case `kfc-context-relevance-golden-v1` dataset and records six deterministic scores.

The production-style runtime does not yet emit the complete decision tree as nested LangSmith runs. `src/observability/tracing.ts` is not sufficient because it only emits a console record when configured.

## Chosen Approach

Add an optional, project-owned tracing interface to the runtime and a LangSmith implementation of that interface. Keep orchestration behavior unchanged and keep the no-credentials path as a no-op.

This is preferred over two alternatives:

1. Migrating `runAgentTurn` to a compiled `StateGraph` now would create a broad behavioral refactor during demo preparation.
2. Expanding only the baseline script would continue proving a special harness rather than the real runtime path.

The tracing interface keeps `buildGraph.ts` independent of the LangSmith SDK and allows tests to capture trace events in memory.

## Runtime Trace Model

Each customer turn produces one root `agent_turn` trace with ordered child runs:

1. `context_load`
2. One or more `planner_iteration` runs
3. `policy_gate` runs for proposed actions
4. `tool_call` runs for allowed tools
5. `state_update`
6. `session_intelligence`
7. `response_compose`
8. `agent_turn` completion with final output and evaluator-ready summaries

Substeps that do not occur must not be fabricated. For example, a neutral greeting can complete after context filtering and response composition without planner or tool runs.

Every run must use stable names and structured input/output fields so a presenter can read the LangSmith tree without opening raw JSON.

## Trace Data Contract

The root trace records:

- scenario ID and turn ID
- session ID in a demo-safe form
- channel and runtime mode
- Git commit and dirty-worktree flag
- latest customer message for scripted demo data only
- final response, reply intent, GenUI kind, suppression state, and final state summary

Planner runs record:

- iteration number and prompt/model identifiers
- relevant state summary and bounded recent turns
- returned intent, context policy, entities, proposed tools, claims, and clarification intent

Policy runs record:

- proposed tool calls
- allowed tool calls
- blocked calls and stable blocked-reason codes
- whether confirmation was required

Tool runs record:

- tool name and arguments
- boundary classification
- success status, result summary, and provenance
- irreversible-boundary metadata when applicable

State updates record a redacted before/after summary containing cart item codes and quantities, order/payment/handoff identifiers, fulfillment status, escalation reasons, and current-turn tool names. They must not copy arbitrary customer records or credentials into LangSmith.

## Privacy and Failure Behavior

Tracing must be best-effort and must never change the customer-facing result. A tracing failure is swallowed after a local diagnostic event; it must not block planning, tool execution, persistence, delivery, or handoff.

The implementation must not send API keys, access tokens, raw provider payloads, full saved addresses, email addresses, phone numbers, or unrestricted conversation history to LangSmith. The scripted demo may include its predefined Vietnamese customer messages.

When `LANGSMITH_API_KEY` or tracing configuration is absent, the runtime uses a no-op tracer with negligible behavior change.

## Demo Scenario

The primary demo is one scripted multi-turn session using fixture-backed upstream clients and the real OpenAI planner/composer path:

1. Customer selects a concrete menu item.
2. Customer says `bỏ món đó`; the agent asks for clarification and does not mutate the cart.
3. Customer names the item; the agent uses verified `updateCart` evidence.
4. Customer continues through address and fulfillment verification.
5. Customer explicitly confirms the order before placement or payment.
6. A later explicit support condition triggers a justified human handoff.

The trace must visibly distinguish proposed actions from allowed and executed actions. Customer-facing scripted messages must not contain debug prefixes, timestamps, or proof-only wording.

## Evaluation and Reproducibility

After the scripted trace, run the existing live LangSmith context experiment against all 14 golden cases. The demo is considered proven only when:

- the trace and experiment metadata record the same Git commit;
- the worktree dirty flag is explicit;
- all 14 cases complete;
- all six evaluators report `1.00` averages;
- the scripted trace contains planner, policy, tool, state, and response evidence for the steps that occurred;
- no trace contains forbidden sensitive fields.

If the checkout remains dirty, the report must say that the proof applies to the exact dirty snapshot rather than claiming a reproducible clean commit. A generated local proof manifest must record the commit, dirty state, experiment name and URL, root trace URL, scenario ID, timestamp, and evaluator summary.

## Visual Proof Artifacts

After the traced scenario and matching experiment are visible in LangSmith, use Chrome to capture the actual authenticated UI rather than recreating the interface. Produce both raw and annotated screenshots:

- one trace-tree screenshot showing the root turn and its planner, policy, tool, state, and response children;
- one focused trace-detail screenshot showing proposed, allowed, blocked, and executed actions;
- one experiment screenshot showing the 14 runs and six `1.00` evaluator averages;
- one failing-or-blocked-action detail screenshot when it materially explains the agent's restraint.

Preserve each raw screenshot unchanged. Create a separate annotated PNG with numbered highlights, boxes, arrows, and connector lines. Keep overlay text short; use numbered markers plus a Markdown legend when a full explanation would obscure trace data. The edit must preserve the underlying LangSmith UI, values, identifiers, and proportions except for the explanatory overlay.

Save the visual set under a timestamped proof directory in `artifacts/langsmith-agentic-proof/`. The manifest must list both raw and annotated paths, the Chrome URL captured, the callout legend, and the trace or experiment identifier visible in each image.

Before delivery, inspect every annotated image for legibility and confirm that callouts point to the intended trace nodes or evaluator columns. Do not present an annotated image if generation changed or invented underlying UI text.

## Testing Strategy

Implementation follows test-driven development:

- unit tests for no-op tracing and best-effort failure isolation;
- capture-tracer tests proving event order and structured payloads;
- graph tests proving clarification produces a blocked mutation with no tool execution;
- graph tests proving an allowed tool produces planner, policy, tool, and state evidence;
- script tests for metadata, proof-manifest generation, and credential prerequisites;
- existing graph, context-policy, scenario, observability, and build checks as regression coverage;
- one live scripted replay and one live 14-case LangSmith experiment for final proof.

## Non-Goals

- Migrating the runtime to a compiled LangGraph `StateGraph`.
- Exposing hidden chain-of-thought or model scratchpad content.
- Replacing deterministic safety gates with LLM evaluators.
- Making LangSmith required for production customer turns.
- Refactoring unrelated ordering, GenUI, channel, or human-loop behavior.

## Deliverables

- Optional runtime tracing interface and no-op implementation.
- LangSmith-backed nested trace implementation.
- Instrumented `runAgentTurn` decision path.
- Scripted multi-turn agentic proof runner.
- Local proof manifest linking the runtime trace to the matching experiment.
- Raw Chrome screenshots and separate annotated screenshots with numbered callouts and connector lines.
- Markdown visual walkthrough mapping every screenshot callout to the corresponding runtime decision.
- Automated tests and fresh verification output.
