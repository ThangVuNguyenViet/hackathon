# Task 1B — PVCFC LangChain rebuild report

## Result

PVCFC execution is rebuilt on the maintained LangChain `createAgent` runtime without restoring the direct OpenAI SDK, local OpenAI Agents package, explicit LangGraph imports, KFC execution, checkpoint transcripts, or SDK session state.

The implementation keeps the neutral agent-pack registry, preserves the existing `PvcfcPublicDataProvider` contract and fixture bytes, and adds a PVCFC-owned tool/agent/web-route composition. Fixture mode composes without model credentials; a PVCFC request then fails closed with `pvcfc_agent_not_configured` until AstraFlow model credentials are supplied.

## RED evidence

Tests were added before production implementation:

- `test/business/pvcfc-langchain-tools.test.ts`
- `test/business/pvcfc-langchain-agent.test.ts`
- rewritten focused PVCFC route/server/import-boundary tests

Initial command:

```sh
PATH="/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npx vitest run test/business/pvcfc-langchain-tools.test.ts test/business/pvcfc-langchain-agent.test.ts
```

Expected RED result:

```text
Test Files  2 failed (2)
Error: Cannot find module '../../src/businesses/pvcfc/tools.js'
Error: Cannot find module '../../src/businesses/pvcfc/pack.js'
```

The route/server RED then showed the missing `pvcfcAgentModel` composition and the intentionally demolished KFC graph module-load seam. The fix isolated the trusted PVCFC web route; it did not restore or fabricate KFC behavior.

## GREEN implementation

### Provider tools

- Added four PVCFC-owned LangChain `tool()` definitions with strict Zod schemas and the required stable names:
  - `listPvcfcCollections`
  - `listPvcfcRecords`
  - `searchPvcfcRecords`
  - `getPvcfcRecord`
- Limits remain bounded to 1–20, query length to 500, and cursors/collection IDs are validated.
- List/search stay compact. Exact retrieval returns the provider result unchanged, including unknown nested fields.
- The unchanged fixture repository suite proves all 497 records remain reachable by bounded pagination and all 79 `source_inventory` records remain discovery-only for search while available through list/get.

### Agent pack and persistence

- Added a PVCFC-owned `PvcfcAgentPack` implementing the neutral `BusinessAgentPack` boundary.
- Injects `BaseChatModel`, `ConversationStore`, and `PvcfcPublicDataProvider`.
- Reconstructs at most 12 canonical user/assistant application turns, truncating each text to 4,000 characters; no checkpoint or framework transcript storage is introduced.
- Creates one LangChain `createAgent` loop per turn with limits of six model calls, eight tool calls, and recursion limit 32.
- Forces `toolChoice: 'required'` until a real provider evidence tool executes; a final response without evidence fails closed.
- Customer metadata is retained only inside the application audit envelope. It never enters the system prompt, changes tools, or chooses a pack. Customer prose remains a `HumanMessage`.
- Commits the assistant turn plus `agent:tool_trace` using schema `business-tool-trace-v1`. The trace contains only tool name/status/duration and run metrics—never arguments, provider results, customer prose, or SDK session mutation.
- Uses `commitAssistantTurnIfRunCurrent` / `appendEventIfRunCurrent` when a fence is supplied.

### Trusted route/server composition

- Added a PVCFC-owned `/chat/pvcfc/message` runtime using the neutral `AgentTurnRunner` registry with the trusted literal pack ID `pvcfc`.
- Returns `agentRuntime: 'langchain-create-agent'`, persists channel `web_chat`, and produces text-only presentation.
- The PVCFC route does not create KFC clients, consult KFC human-pause state, reserve irreversible KFC operations, or emit GenUI.
- `buildServerOptionsFromEnv` now creates `ChatOpenAI` with the configured AstraFlow-compatible API key, base URL, and `gpt-5.6-luna` model. SDK retries are disabled so the agent-owned limits remain authoritative.
- Fixture provider composition is driven by `PVCFC_PUBLIC_DATA_MODE`, independently of `PVCFC_ASTRAFLOW_API_KEY`.

## Verification

Required focused command:

```sh
PATH="/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npx vitest run test/business/pvcfc-langchain-tools.test.ts test/business/pvcfc-langchain-agent.test.ts test/api/pvcfc-agent-pack-route.test.ts test/api/pvcfc-chat-handler.test.ts test/api/pvcfc-server-options.test.ts test/architecture/pvcfc-agent-import-boundary.test.ts test/architecture/langchain-only-production-runtime.test.ts test/fixtures/pvcfc-public-data-repository.test.ts
```

Result:

```text
Test Files  8 passed (8)
Tests       21 passed (21)
```

Architecture size gate:

```text
Architecture size check passed (463 files, 900-line ceiling with no baseline growth).
```

Scoped Prettier, ESLint, and `git diff --check` also pass without errors or warnings.

## Remaining typecheck diagnostics

`npm run typecheck -- --pretty false` remains intentionally red after the Task 1A demolition:

```text
total=557
kfc_execution_replacement=341
confirmation_resume_replacement=40
obsolete_downstream_scripts_evaluations_proofs_tests=176
```

This is 25 fewer diagnostics than the Task 1A baseline of 582. The three categories are mutually exclusive, classified by owning file path: confirmation/approval/pause/resume paths first; obsolete scripts, evaluations, proofs, scenarios, workers, SDK-session/checkpoint persistence tests second; remaining KFC agent/graph/route and obsolete KFC tests last.

There are zero diagnostics in PVCFC production files, `pvcfcChatHandler.ts`, `pvcfcRouteRuntime.ts`, `server.ts`, or `serverOptions.ts`. One obsolete KFC test still imports the removed name `createPvcfcOpenAiTools`; it is counted in the KFC replacement group and was not made compatible with the forbidden SDK path.

## Files

Production:

- `src/businesses/pvcfc/tools.ts`
- `src/businesses/pvcfc/pack.ts`
- `src/businesses/pvcfc/instructions.ts`
- `src/api/pvcfcChatPayload.ts`
- `src/api/pvcfcChatHandler.ts`
- `src/api/pvcfcRouteRuntime.ts`
- `src/api/routeHandlerContracts.ts`
- `src/api/server.ts`
- `src/api/serverOptions.ts`

Focused tests and fixture model:

- `test/business/pvcfc-langchain-tools.test.ts`
- `test/business/pvcfc-langchain-agent.test.ts`
- `test/api/pvcfc-agent-pack-route.test.ts`
- `test/api/pvcfc-chat-handler.test.ts`
- `test/api/pvcfc-server-options.test.ts`
- `test/architecture/pvcfc-agent-import-boundary.test.ts`
- `test/fixtures/scriptedPvcfcChatModel.ts`

Commit subject: `refactor(pvcfc): rebuild agent on LangChain`

## Self-review

- Verified the RED failures were caused by the absent PVCFC production modules, not test mistakes.
- Verified exact tool names, strict schemas, provider delegation, compact results, unknown-field preservation, evidence enforcement, history reconstruction, metadata isolation, neutral trace redaction, route identity, web-chat persistence, model isolation, and fixture-only startup behavior.
- Re-ran the complete required focused suite after formatting and reviewed the production diff for forbidden imports and KFC behavior.
- Confirmed no fixture bytes, provider collection semantics, demo UI assets, TinyFish integration, direct `openai` dependency/import, or `@langchain/langgraph` import changed.

## Concerns

- The clean-slate tree still cannot load the demolished KFC/confirmation route graph. `buildServer` therefore registers the PVCFC-owned route surface whenever PVCFC model/provider capability is present and defers the old route module otherwise. The later KFC/confirmation substeps must consolidate route registration once their real replacements exist; this task deliberately does not add a successful KFC stub.
- `web_chat` is still absent from the KFC-owned legacy `Channel` union. The PVCFC pack uses a documented boundary assertion while persisting the correct runtime value. The later neutral-domain seam should remove that assertion rather than widening KFC policy types in this task.
