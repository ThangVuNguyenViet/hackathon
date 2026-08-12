# Task 1C — KFC LangChain execution-core report

## Result

KFC now has a business-owned LangChain `createAgent` pack and an imperative turn service. The core loads the exact current user turn and bounded canonical conversation history from the application store, loads verified KFC state through an injected application seam, resolves model-visible tools from trusted state policy, runs one LangChain tool loop, validates strict grounded publication output, projects verified KFC GenUI, and returns a typed result for Task 1D persistence and delivery.

Irreversible typed tool calls are canonicalized and returned as a pending confirmation without calling the injected executor. The core neither creates nor restores a `StateGraph`, framework checkpoint/session state, a direct OpenAI SDK executor, a runtime switch, or route/resume composition.

## RED evidence

The focused pack test was written before production code.

```text
PATH=".../codex-primary-runtime/dependencies/node/bin:$PATH" \
  npx vitest run test/business/kfc-langchain-pack.test.ts

FAIL test/business/kfc-langchain-pack.test.ts
Error: Cannot find module '../../src/businesses/kfc/pack.js'
Test Files 1 failed (1)
```

A second RED/GREEN cycle covered trusted tool exposure:

```text
expected [ 'searchMenu', ...32 more ] to deeply equal [ 'searchMenu' ]
Tests 1 failed | 2 passed (3)
```

The implementation added the injected `resolveActiveToolNames` policy and now exposes only the tools selected from trusted application state; customer text is never inspected for tool or pack selection.

## GREEN implementation

- `KfcAgentPack` implements the neutral `BusinessAgentPack` boundary with `id` and `runTurn` only.
- `runKfcLangChainTurn` validates the exact persisted user turn identity, reconstructs at most 12 user/assistant messages, truncates each message to 4,000 characters, and does not store framework history.
- The per-turn agent uses LangChain `createAgent`, provider-native strict structured output, `modelCallLimitMiddleware` with six model calls, and `toolCallLimitMiddleware` with eight tool calls.
- The KFC tool adapter reuses every canonical commerce tool schema and `agentToolCallDisposition`; canonical arguments, trusted state, and injected application policy determine execution.
- Reads and reversible mutations cross the injected trusted executor seam. Successful calls return bounded receipts and evidence IDs for closed-world publication validation.
- Irreversible calls never reach that executor. They return `confirmation_required` plus the exact canonical action for Task 1D to persist, reserve, authorize, resume, and execute exactly once.
- The strict KFC-owned publication schema preserves factual-evidence references, limitation shape, publication privacy declaration, and selected-action structure. The core rejects unsupported claims, unauthorized/private metadata declarations, unissued evidence references, and untrusted selected-action responses; Task 1D may inject the existing stronger application-authority validator.
- Verified state remains the source for the existing KFC GenUI selector. The core does not persist or deliver presentation.
- The graph-era proof metadata path was removed from the surviving application turn persistence helper; no compatibility graph proof was restored.

## Focused verification

Fresh final command:

```text
npx vitest run \
  test/architecture/langchain-only-production-runtime.test.ts \
  test/business/kfc-langchain-pack.test.ts \
  test/agent/kfc-create-agent.test.ts \
  test/agent/kfc-create-agent-tools.test.ts \
  test/genui/kfc-genui-selector.test.ts \
  test/genui/kfc-genui-contract.test.ts \
  test/agent/model-publication-projection.test.ts \
  test/agent/model-publication-guest-authority.test.ts

Test Files 8 passed (8)
Tests      95 passed (95)
```

Additional gates:

```text
KFC scoped strict TypeScript: exit 0, zero diagnostics
KFC scoped ESLint --max-warnings=0: exit 0
KFC scoped Prettier check: exit 0
git diff --check: exit 0
Architecture size check: 461 files, 900-line ceiling, no baseline growth
LangChain-only production guard: 1/1 passed
```

The existing standalone GenUI selector and contract suites account for 55 of the 95 passing assertions. The route-backed GenUI action suite remains a Task 1D seam because it imports the intentionally deleted `graph/buildGraph` route runtime; it was not made compatible in Task 1C.

## Remaining full typecheck

`npm run typecheck -- --pretty false` remains intentionally RED with exactly 507 diagnostics:

```text
task1d_route_confirmation_resume=16
obsolete_downstream_scripts_evaluations=24
obsolete_downstream_tests=467
other=0
```

There are zero diagnostics in `src/businesses/kfc`, `src/agent/kfcCreateAgent.ts`, the rewritten focused KFC tests, or any other production group outside the explicitly enumerated Task 1D route/resume and obsolete evaluation paths.

## Replaced and deleted obsolete graph tests/code

- Replaced the graph/nested-checkpoint `test/agent/kfc-create-agent.test.ts` with a focused real `createAgent` structured-output/prompt contract.
- Replaced the graph coordinator `test/agent/kfc-create-agent-tools.test.ts` with focused canonical-schema, trusted-read, and no-preconfirmation-execution contracts.
- Deleted the now-unreferenced graph-era KFC agent runtime/context/coordinator/tool adapter, active-profile, direct-SDK response adapter/instructions, direct turn helper, and OpenAI-named GenUI adapter. Existing framework-neutral KFC GenUI projection remains in `src/genui`.
- Historical route/resume, SDK-session, graph, proof, scenario, and evaluation tests were left for the broad Task 1D/downstream cleanup rather than rewritten as compatibility tests.

## Files

Primary new production modules:

- `src/businesses/kfc/pack.ts`
- `src/businesses/kfc/langchainTurnService.ts`
- `src/businesses/kfc/tools.ts`
- `src/businesses/kfc/publication.ts`
- `src/businesses/kfc/instructions.ts`
- `src/businesses/kfc/turnContracts.ts`

The existing `src/agent/kfcCreateAgent.ts` now contains only the maintained LangChain factory. Surviving commerce, state-hydration, persistence, monitoring, and verified-state modules import the KFC-owned application turn contract rather than the deleted graph contract. The complete path list is captured by the commit diff.

Commit subject:

```text
refactor(kfc): rebuild execution core on LangChain
```

The final commit SHA is reported in the task handoff.

## Self-review

- Confirmed both RED failures were caused by absent required behavior, not syntax or fixture errors.
- Confirmed the shared registry contract did not gain KFC types or policy.
- Confirmed active tools derive only from an injected trusted-state resolver, never customer prose, IDs, prefixes, or metadata.
- Confirmed canonical schemas validate every model tool call and irreversible calls cannot reach the executor.
- Confirmed the canonical transcript remains application-owned and no assistant turn, checkpoint, SDK session item, route delivery, or confirmation resume is persisted by this core.
- Confirmed production guard and direct source search contain no direct OpenAI SDK or explicit LangGraph runtime in the new core.
- Confirmed the unchanged gateway idempotency baseline path was not modified.

## Task 1D concerns

1. Compose the real KFC `loadState`, authorization-aware `resolveActiveToolNames`, and trusted `executeTool` adapters around this pack; do not replace them with permissive defaults.
2. Persist the returned pending action with the existing application confirmation authority, reserve irreversible operations, validate the stored action digest, and execute approved resumes exactly once. This core intentionally does not resume actions.
3. Apply the existing strong publication authority/attestation validator through `validatePublication`, then atomically persist verified state, assistant turn, GenUI, and delivery under the current run fence.
4. Rewire web, Messenger, and Zalo routes to the same KFC pack and retire the remaining graph-named route/proof tests and evaluation scripts rather than reintroducing compatibility modules.
5. `AgentGraphState` remains the established KFC business-state type name, but it contains no LangGraph runtime object or checkpoint state. A later mechanical rename is optional and must not become a universal business-state abstraction.
