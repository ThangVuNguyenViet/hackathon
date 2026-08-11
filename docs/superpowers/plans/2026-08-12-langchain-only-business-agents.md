# LangChain-Only Business Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run KFC and PVCFC exclusively through separate LangChain `createAgent` business packs, add policy-bounded TinyFish Search and Fetch to both, refresh the PVCFC demo, and remove the direct OpenAI Agents SDK and authored LangGraph runtime.

**Architecture:** A tiny trusted registry dispatches a neutral turn to a business-owned `runTurn` implementation. Each pack constructs its own LangChain agent, tools, middleware, evidence policy, persistence adapter, and presentation; the shared layer contains no tool type or business policy. Application stores remain authoritative for transcript, approvals, effects, idempotency, and delivery, while TinyFish is an optional live-evidence capability behind pack-owned allowlists.

**Tech Stack:** TypeScript, LangChain 1.5.3, `@langchain/core` 1.2.3, `@langchain/openai` 1.5.5, `@langchain/google` 0.2.1, `@tiny-fish/sdk` 0.3.0, Zod 3.25.76, Vitest 3.2.4, Cloudflare Workers, React/Vite.

## Global Constraints

- Production agent code must not import `@kfc/openai-agents-runtime`, `@openai/agents`, direct `openai`, `@langchain/langgraph`, or `@langchain/langgraph-checkpoint`.
- LangChain `createAgent` is the only model/tool loop; no application-authored `StateGraph` is introduced.
- KFC and PVCFC remain separate packs. Shared code must not contain a universal business domain, shared allowlist, or shared evidence precedence.
- Trusted route configuration selects the pack. Customer prose, session IDs, and customer metadata never select it.
- The PVCFC provider's four operations remain stable and all 497 records, including 79 discovery-only records, remain reachable.
- Fixture/API evidence precedes live web evidence. Web evidence is untrusted, current, cited, and never persisted as canonical fixture/API data.
- TinyFish uses `@tiny-fish/sdk@0.3.0`, zero SDK retries, short explicit timeouts, at most one search and two single-URL fetches per turn, and the existing 30-second turn deadline.
- Missing `TINYFISH_API_KEY` leaves canonical provider tools usable and reports live web as unavailable.
- D1/PostgreSQL application state remains. Framework-specific OpenAI session items and LangGraph checkpoints are retired only after runtime references are removed.
- Preserve KFC authorization, confirmation, irreversible-operation reservation, idempotency, human handoff, atomic commit, delivery outbox, and GenUI behavior.
- CI never requires live TinyFish. Live Search/Fetch qualification is a separate credentialed canary.

## Command convention

- Run backend `npm`/`npx` commands with working directory `services/kfc-agent-backend`.
- Run PVCFC web `npm`/`npx` commands with working directory `apps/pvcfc_chat_web`.
- Run every `git add`, `git commit`, `git grep`, `git push`, and `gh` command from the repository root.

---

### Task 1: Make the shared business-pack boundary framework-neutral

**Files:**
- Modify: `services/kfc-agent-backend/src/business/agentPack.ts`
- Modify: `services/kfc-agent-backend/src/agent/agentTurnRunner.ts`
- Test: `services/kfc-agent-backend/test/business/agent-pack.test.ts`
- Test: `services/kfc-agent-backend/test/agent/agent-turn-runner.test.ts`
- Create: `services/kfc-agent-backend/test/architecture/langchain-only-business-boundary.test.ts`

**Interfaces:**
- Consumes: trusted `packId` and a business-specific turn value from route code.
- Produces:

```ts
export interface BusinessAgentPack<TTurn, TResult> {
  readonly id: string;
  runTurn(turn: TTurn): Promise<TResult>;
}

export interface AgentPackIdentity {
  readonly id: string;
}

export class AgentPackRegistry<TPack extends AgentPackIdentity> {
  constructor(packs: readonly TPack[], options?: { expectedIds?: readonly string[] });
  require(id: string | null | undefined): TPack;
}

export class AgentTurnRunner<TTurn, TResult> {
  run(input: { packId: string | null | undefined; turn: TTurn }): Promise<TResult>;
}
```

- The shared boundary exports no `FunctionTool`, `StructuredTool`, model, prompt, context, lifecycle, or presentation type.

- [ ] **Step 1: Write the failing neutral-boundary tests**

Add tests that instantiate two fake `BusinessAgentPack`s, prove explicit trusted selection and fail-closed missing/unknown IDs, and read the two production modules to reject imports matching:

```ts
/(?:openai-agents|openAi|langgraph|StructuredTool|FunctionTool)/u
```

The test must also prove that changing a turn's text or session ID to contain `pvcfc` cannot change the selected fake pack.

- [ ] **Step 2: Run the focused tests and capture RED**

Run:

```bash
npx vitest run test/business/agent-pack.test.ts test/agent/agent-turn-runner.test.ts test/architecture/langchain-only-business-boundary.test.ts
```

Expected: FAIL because `AgentPack` and `PreparedTurnResources` still expose OpenAI SDK tool types and the runner calls `prepareTurn`/`execute`.

- [ ] **Step 3: Implement the minimal neutral contract**

Replace the generic SDK-shaped contract with `BusinessAgentPack<TTurn, TResult>`. Keep the existing ID validation and immutable registry behavior. Reduce `AgentTurnRunner.run` to trusted lookup followed by `pack.runTurn(input.turn)`.

- [ ] **Step 4: Run focused tests, typecheck, and architecture gate**

Run:

```bash
npx vitest run test/business/agent-pack.test.ts test/agent/agent-turn-runner.test.ts test/architecture/langchain-only-business-boundary.test.ts
npm run typecheck
npm run check:architecture
```

Expected: focused tests pass; typecheck identifies only downstream pack adapters that still implement the old contract and are intentionally migrated in Tasks 2 and 5. Do not commit until typecheck is green; use temporary compatibility local types inside the business-owned packs if required, never in the shared boundary.

- [ ] **Step 5: Commit**

```bash
git add services/kfc-agent-backend/src/business/agentPack.ts services/kfc-agent-backend/src/agent/agentTurnRunner.ts services/kfc-agent-backend/test/business/agent-pack.test.ts services/kfc-agent-backend/test/agent/agent-turn-runner.test.ts services/kfc-agent-backend/test/architecture/langchain-only-business-boundary.test.ts
git commit -m "refactor(agent): neutralize business pack dispatch"
```

---

### Task 2: Migrate PVCFC provider tools and agent execution to LangChain

**Files:**
- Create: `services/kfc-agent-backend/src/businesses/pvcfc/langchainAgent.ts`
- Modify: `services/kfc-agent-backend/src/businesses/pvcfc/tools.ts`
- Modify: `services/kfc-agent-backend/src/businesses/pvcfc/pack.ts`
- Modify: `services/kfc-agent-backend/src/businesses/pvcfc/instructions.ts`
- Modify: `services/kfc-agent-backend/src/api/routeDirectAgentPacks.ts`
- Modify: `services/kfc-agent-backend/src/api/routeDirectWebChatResponse.ts`
- Test: `services/kfc-agent-backend/test/business/pvcfc-langchain-tools.test.ts`
- Test: `services/kfc-agent-backend/test/business/pvcfc-langchain-agent.test.ts`
- Modify: `services/kfc-agent-backend/test/api/pvcfc-agent-pack-route.test.ts`
- Modify: `services/kfc-agent-backend/test/architecture/pvcfc-agent-import-boundary.test.ts`

**Interfaces:**
- Consumes: `BaseChatModel`, `ConversationStore`, `PvcfcPublicDataProvider`, and `PvcfcAgentTurnInput`.
- Produces:

```ts
export interface PvcfcTurnToolReceipt {
  readonly name: string;
  readonly status: 'success' | 'error';
  readonly durationMs: number;
}

export interface PvcfcLangChainTurnResult {
  readonly responseText: string;
  readonly assistantTurn: ConversationTurn;
  readonly toolCalls: readonly PvcfcTurnToolReceipt[];
  readonly usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export function createPvcfcProviderTools(input: {
  provider: PvcfcPublicDataProvider;
  receipts: PvcfcTurnToolReceipt[];
}): readonly StructuredTool[];
```

- Tool names remain `listPvcfcCollections`, `listPvcfcRecords`, `searchPvcfcRecords`, and `getPvcfcRecord` for behavioral continuity.

- [ ] **Step 1: Write failing LangChain tool contract tests**

Use the bundled provider and invoke each returned `StructuredTool` directly. Assert Zod rejects invalid limits/cursors, listing can paginate all 497 locators, discovery-only records are gettable, search results remain compact, and receipts contain name/status/duration without full record content.

- [ ] **Step 2: Capture tool RED**

Run:

```bash
npx vitest run test/business/pvcfc-langchain-tools.test.ts
```

Expected: FAIL because `createPvcfcProviderTools` does not exist and current tools import `@kfc/openai-agents-runtime`.

- [ ] **Step 3: Convert the four tools using LangChain `tool()` and Zod**

Use schemas shaped as:

```ts
const pageInputSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  cursor: z.string().min(1).optional(),
});
```

Implement the four closures against `PvcfcPublicDataProvider`; return provider result objects without translating data. Record only bounded receipt metadata.

- [ ] **Step 4: Write failing PVCFC agent tests**

Use a scripted `BaseChatModel` that first calls `searchPvcfcRecords`, then returns an `AIMessage`. Assert:

- bounded `HumanMessage`/`AIMessage` history is reconstructed from `ConversationStore`;
- the exact PVCFC prompt is used;
- only four PVCFC provider tools are visible;
- the first model call cannot answer without a provider evidence tool;
- customer `metadata.customerCommand` and KFC-shaped prose never become developer/system instructions;
- the committed audit source/schema is neutral (`agent:tool_trace`, `business-tool-trace-v1`);
- no SDK session mutation is persisted;
- stale fences cannot commit an assistant turn.

- [ ] **Step 5: Capture agent RED**

Run:

```bash
npx vitest run test/business/pvcfc-langchain-agent.test.ts test/api/pvcfc-agent-pack-route.test.ts test/architecture/pvcfc-agent-import-boundary.test.ts
```

Expected: FAIL on the missing LangChain agent and current OpenAI executor imports/audit names.

- [ ] **Step 6: Implement the PVCFC LangChain turn**

Create a per-turn `createAgent` instance using the injected model, the four tools, the PVCFC system prompt, `modelCallLimitMiddleware({ runLimit: 6 })`, `toolCallLimitMiddleware({ runLimit: 8 })`, and a PVCFC-owned middleware that requires one provider tool before a factual response. Convert stored turns into bounded LangChain messages, invoke with the current human message, extract the final `AIMessage`, and commit the assistant turn/audit atomically through the existing fence-aware store APIs.

- [ ] **Step 7: Route PVCFC through the new pack without KFC state**

Change `PvcfcAgentPack` to implement `runTurn`; inject a LangChain model rather than `OpenAiResponsesExecutor`. Update route response metadata to:

```ts
{ agentRuntime: 'langchain-create-agent', transport: 'web_chat' }
```

Ensure the route does not create KFC clients, inspect KFC session control, or publish KFC presentation/state.

- [ ] **Step 8: Verify and commit**

Run:

```bash
npx vitest run test/business/pvcfc-langchain-tools.test.ts test/business/pvcfc-langchain-agent.test.ts test/api/pvcfc-agent-pack-route.test.ts test/api/pvcfc-chat-handler.test.ts test/architecture/pvcfc-agent-import-boundary.test.ts test/fixtures/pvcfc-public-data-repository.test.ts
npm run typecheck
npm run lint -- --max-warnings=0 src/businesses/pvcfc test/business/pvcfc-langchain-tools.test.ts test/business/pvcfc-langchain-agent.test.ts
```

Then commit:

```bash
git add services/kfc-agent-backend/src/businesses/pvcfc services/kfc-agent-backend/src/api/routeDirectAgentPacks.ts services/kfc-agent-backend/src/api/routeDirectWebChatResponse.ts services/kfc-agent-backend/test/business services/kfc-agent-backend/test/api/pvcfc-agent-pack-route.test.ts services/kfc-agent-backend/test/architecture/pvcfc-agent-import-boundary.test.ts
git commit -m "refactor(pvcfc): run public guidance with LangChain"
```

---

### Task 3: Add a safe, injected TinyFish client adapter

**Files:**
- Modify: `services/kfc-agent-backend/package.json`
- Modify: `services/kfc-agent-backend/package-lock.json`
- Create: `services/kfc-agent-backend/src/web/tinyFishClient.ts`
- Create: `services/kfc-agent-backend/src/web/businessWebEvidence.ts`
- Test: `services/kfc-agent-backend/test/web/tiny-fish-client.test.ts`
- Test: `services/kfc-agent-backend/test/web/business-web-evidence.test.ts`

**Interfaces:**
- Produces an infrastructure-only interface; it carries no KFC/PVCFC domains:

```ts
export interface TinyFishClient {
  search(input: {
    query: string;
    includeDomains: readonly string[];
    language: string;
    location: string;
  }): Promise<readonly TinyFishSearchResult[]>;
  fetch(input: {
    url: string;
    perUrlTimeoutMs: number;
  }): Promise<TinyFishFetchResult>;
}

export function createTinyFishClient(input: {
  apiKey: string;
  timeoutMs: number;
}): TinyFishClient;
```

- `createTinyFishClient` constructs `@tiny-fish/sdk` with `maxRetries: 0`; no key is read from `process.env` inside this module.

- [ ] **Step 1: Install the pinned SDK**

Run:

```bash
npm install --save-exact @tiny-fish/sdk@0.3.0
```

- [ ] **Step 2: Write failing adapter and URL-policy tests**

Test SDK response normalization and these URL failures: HTTP, username/password, non-allowlisted host, suffix-confusion host, IP literal, fragment-only difference, and an allowlisted input whose returned `final_url` redirects externally. Prove output truncates fetched text to the configured bound and never includes the API key.

- [ ] **Step 3: Capture RED**

Run:

```bash
npx vitest run test/web/tiny-fish-client.test.ts test/web/business-web-evidence.test.ts
```

Expected: FAIL because the adapter and policy helpers do not exist.

- [ ] **Step 4: Implement minimal SDK adaptation and URL validation**

Normalize hostnames with `new URL`, require HTTPS, reject credentials/IP literals, compare exact lowercase hostnames against the caller's list, and revalidate `final_url`. Export compact evidence types containing URL, title, optional published date, snippet/text, and `retrievedAt`.

- [ ] **Step 5: Verify Worker compatibility and commit**

Run:

```bash
npx vitest run test/web/tiny-fish-client.test.ts test/web/business-web-evidence.test.ts
npm run typecheck
npm run worker:deploy:dry-run
```

Then commit:

```bash
git add services/kfc-agent-backend/package.json services/kfc-agent-backend/package-lock.json services/kfc-agent-backend/src/web services/kfc-agent-backend/test/web
git commit -m "feat(web): add bounded TinyFish evidence client"
```

---

### Task 4: Expose PVCFC-owned TinyFish Search and Fetch tools

**Files:**
- Create: `services/kfc-agent-backend/src/businesses/pvcfc/webPolicy.ts`
- Create: `services/kfc-agent-backend/src/businesses/pvcfc/webTools.ts`
- Modify: `services/kfc-agent-backend/src/businesses/pvcfc/pack.ts`
- Modify: `services/kfc-agent-backend/src/businesses/pvcfc/instructions.ts`
- Modify: `services/kfc-agent-backend/src/config/env.ts`
- Modify: `services/kfc-agent-backend/src/worker.ts`
- Modify: `services/kfc-agent-backend/src/workerRouteOptions.ts`
- Modify: `services/kfc-agent-backend/src/workerReadiness.ts`
- Modify: `services/kfc-agent-backend/src/api/serverOptions.ts`
- Modify: `services/kfc-agent-backend/wrangler.toml`
- Test: `services/kfc-agent-backend/test/business/pvcfc-web-tools.test.ts`
- Test: `services/kfc-agent-backend/test/api/pvcfc-server-options.test.ts`
- Modify: `services/kfc-agent-backend/test/worker/worker-route-options.test.ts`
- Modify: `services/kfc-agent-backend/test/worker/worker.test.ts`

**Interfaces:**
- Produces `createPvcfcWebTools({ client, inventoryUrls, receipts, budget })` with tool names `searchPvcfcWeb` and `fetchPvcfcPage`.
- The search allowlist is an immutable PVCFC-owned constant containing only explicitly approved PVCFC first-party hosts.
- `fetchPvcfcPage` accepts one URL that is either inventoried or returned by `searchPvcfcWeb` during the same turn.

- [ ] **Step 1: Write failing web-tool policy tests**

Use an injected fake client. Assert fixture/API search occurs before web search for answerable product queries; current-news queries may call Search then Fetch; direct fetch rejects unknown URLs; inventoried URLs are accepted; current-turn searched URLs are accepted; redirect escape is rejected; calls stop at one search/two fetches; returned evidence preserves citations.

- [ ] **Step 2: Capture RED**

Run:

```bash
npx vitest run test/business/pvcfc-web-tools.test.ts
```

- [ ] **Step 3: Implement PVCFC web policy and tools**

Keep the allowlist, inventory admission, evidence precedence, and citation wording in `businesses/pvcfc`. Use `tool()` with Zod. Store current-turn discovered URLs and counters in a closure scoped to one `runTurn` call. Return compact evidence only.

- [ ] **Step 4: Add configuration and readiness projection**

Add `TINYFISH_API_KEY` as an optional secret to Node env parsing and `WorkerEnv`. Server composition injects `undefined` when the key is absent and a configured client when present. Readiness reports a non-gating capability:

```ts
webSearch: { configured: boolean; provider: 'tinyfish'; mode: 'search-fetch' }
```

Do not place secrets in `wrangler.toml`; add only comments/documented secret setup.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run test/business/pvcfc-web-tools.test.ts test/api/pvcfc-server-options.test.ts test/worker/worker-route-options.test.ts test/worker/worker.test.ts
npm run typecheck
npm run worker:deploy:dry-run
```

Then commit:

```bash
git add services/kfc-agent-backend/src/businesses/pvcfc services/kfc-agent-backend/src/config/env.ts services/kfc-agent-backend/src/worker.ts services/kfc-agent-backend/src/workerRouteOptions.ts services/kfc-agent-backend/src/workerReadiness.ts services/kfc-agent-backend/src/api/serverOptions.ts services/kfc-agent-backend/wrangler.toml services/kfc-agent-backend/test/business/pvcfc-web-tools.test.ts services/kfc-agent-backend/test/api/pvcfc-server-options.test.ts services/kfc-agent-backend/test/worker
git commit -m "feat(pvcfc): add official-site TinyFish evidence tools"
```

---

### Task 5: Replace KFC's graph/direct dual runtime with one LangChain turn service

**Files:**
- Create: `services/kfc-agent-backend/src/businesses/kfc/pack.ts`
- Create: `services/kfc-agent-backend/src/businesses/kfc/langchainTurnService.ts`
- Create: `services/kfc-agent-backend/src/businesses/kfc/webPolicy.ts`
- Create: `services/kfc-agent-backend/src/businesses/kfc/webTools.ts`
- Move/modify: `services/kfc-agent-backend/src/agent/kfcCreateAgent.ts`
- Modify: `services/kfc-agent-backend/src/agent/kfcCreateAgentMiddleware.ts`
- Modify: `services/kfc-agent-backend/src/agent/kfcCreateAgentTools.ts`
- Modify: `services/kfc-agent-backend/src/agent/singleAgentRuntime.ts`
- Modify: `services/kfc-agent-backend/src/api/routeAgentRuntime.ts`
- Modify: `services/kfc-agent-backend/src/api/routeMessengerRuntime.ts`
- Modify: `services/kfc-agent-backend/src/api/routeDirectAgentPacks.ts`
- Test: `services/kfc-agent-backend/test/business/kfc-langchain-pack.test.ts`
- Test: `services/kfc-agent-backend/test/business/kfc-web-tools.test.ts`
- Modify: `services/kfc-agent-backend/test/agent/kfc-create-agent.test.ts`
- Modify: `services/kfc-agent-backend/test/agent/kfc-create-agent-approval.test.ts`
- Modify: `services/kfc-agent-backend/test/api/chat.test.ts`
- Modify: `services/kfc-agent-backend/test/api/human-loop-channels.test.ts`

**Interfaces:**
- `KfcAgentPack.runTurn` consumes the existing trusted KFC turn input and returns the existing customer response, verified state, optional GenUI, and persistence publication.
- `runKfcLangChainTurn` owns one imperative application transaction around one `createAgent` invocation. It does not construct a graph.
- Confirmation middleware records an application-owned pending action and returns a pause result before an irreversible tool runs. The confirmation-resume route validates the stored action digest and executes it through the existing trusted action executor exactly once.
- KFC web tools are supplementary evidence only; they cannot call `updateCart`, `placeOrder`, payment, lifecycle, or verified-state projectors.

- [ ] **Step 1: Write failing no-graph KFC parity tests**

Add a scripted-model suite covering menu search, cart mutation, required confirmation, confirmation rejection, confirmation approval/exactly-once execution, duplicate client message, stale fence, human pause/resume, Messenger/Zalo delivery, GenUI selection, and supplementary web evidence. Read the resulting source modules and reject `StateGraph`, `Command`, `MemorySaver`, and `@langchain/langgraph` imports.

- [ ] **Step 2: Capture RED**

Run:

```bash
npx vitest run test/business/kfc-langchain-pack.test.ts test/business/kfc-web-tools.test.ts test/agent/kfc-create-agent.test.ts test/agent/kfc-create-agent-approval.test.ts test/api/human-loop-channels.test.ts
```

Expected: FAIL because KFC routing and approval still depend on the outer graph or the direct OpenAI pack.

- [ ] **Step 3: Build the imperative KFC application transaction around `createAgent`**

Reuse the existing typed commerce tools, provider schemas, authorization, evidence receipts, runtime cancellation, run fences, publication validation, and persistence functions. Replace graph state transitions with explicit local values in this order:

```text
load canonical transcript and verified business state
-> assemble LangChain messages and active tools
-> invoke createAgent
-> validate structured response and evidence
-> if confirmation required, persist pending action and return pause
-> otherwise execute authorized action through trusted executor
-> project verified state and GenUI
-> atomically commit assistant turn, state, and delivery
```

Do not route customer prose with keyword/regex rules. Only typed model output, trusted state, tool results, and authorization decisions may affect control flow.

- [ ] **Step 4: Use maintained LangChain middleware for commodity behavior**

Configure `modelRetryMiddleware`, `toolRetryMiddleware`, `modelCallLimitMiddleware`, and `toolCallLimitMiddleware`. Retain only KFC-specific error classification, evidence receipts, deadline checks, effect reservations, and structured-publication validation. Use `summarizationMiddleware` only after a focused history-bound test demonstrates equivalent transcript reconstruction.

- [ ] **Step 5: Add KFC-owned TinyFish tools**

Expose `searchKfcWeb` and `fetchKfcPage` with a KFC-owned official-domain allowlist. Prompt and tests must prove commerce APIs remain authoritative for prices, availability, promotions, cart, order, and payment; web results are cited supplemental information only.

- [ ] **Step 6: Switch all KFC channels to the one pack**

Remove runtime preference based on configured OpenAI agents. Web chat, Messenger, and existing channel routes call the same KFC LangChain pack and preserve their channel-specific persistence/delivery adapters. Set response metadata runtime to `langchain-create-agent`.

- [ ] **Step 7: Run the KFC safety/lifecycle gate and commit**

Run:

```bash
npx vitest run test/business/kfc-langchain-pack.test.ts test/business/kfc-web-tools.test.ts test/agent/kfc-create-agent.test.ts test/agent/kfc-create-agent-approval.test.ts test/api/chat.test.ts test/api/human-loop-channels.test.ts test/persistence/d1-irreversible-operation.test.ts test/persistence/irreversible-operation-authority-memory-store.test.ts test/api/agent-run-text-delivery-runtime.test.ts test/agent/kfc-open-ai-genui.test.ts
npm run typecheck
npm run check:architecture
```

Then commit only when the maintained KFC acceptance behavior is green:

```bash
git add services/kfc-agent-backend/src/businesses/kfc services/kfc-agent-backend/src/agent services/kfc-agent-backend/src/api/routeAgentRuntime.ts services/kfc-agent-backend/src/api/routeMessengerRuntime.ts services/kfc-agent-backend/src/api/routeDirectAgentPacks.ts services/kfc-agent-backend/test/business services/kfc-agent-backend/test/agent services/kfc-agent-backend/test/api
git commit -m "refactor(kfc): use one LangChain business pack"
```

---

### Task 6: Remove direct OpenAI SDK and explicit LangGraph production infrastructure

**Files:**
- Delete: `services/kfc-agent-backend/packages/openai-agents-runtime/`
- Delete: `services/kfc-agent-backend/src/agent/openAiResponsesExecutor.ts`
- Delete: `services/kfc-agent-backend/src/agent/openAiKfcAgent.ts`
- Delete: `services/kfc-agent-backend/src/agent/openAiSdkTool.ts`
- Delete: `services/kfc-agent-backend/src/agent/kfcOpenAiSdkToolAdapter.ts`
- Delete: `services/kfc-agent-backend/src/agent/kfcOpenAiTools.ts`
- Delete: `services/kfc-agent-backend/src/agent/kfcDirectTurnService.ts`
- Delete: `services/kfc-agent-backend/src/agent/observedOpenAiResponsesCompactionSession.ts`
- Delete: `services/kfc-agent-backend/src/agent/bufferedConversationStoreAgentSession.ts`
- Delete: `services/kfc-agent-backend/src/agent/agentStateGraph.ts`
- Delete: `services/kfc-agent-backend/src/agent/agentStateGraphRunner.ts`
- Delete: `services/kfc-agent-backend/src/agent/agentStateSchema.ts`
- Delete: `services/kfc-agent-backend/src/graph/buildGraph.ts`
- Delete: `services/kfc-agent-backend/src/graph/studioAgent.ts`
- Delete: `services/kfc-agent-backend/src/persistence/d1CheckpointSaver.ts`
- Delete: `services/kfc-agent-backend/src/persistence/postgresCheckpointSaver.ts`
- Delete: `services/kfc-agent-backend/scripts/check-direct-agent-sdk-boundaries.mjs`
- Delete: `services/kfc-agent-backend/scripts/check-direct-agent-sdk-boundaries.d.mts`
- Delete: `services/kfc-agent-backend/scripts/run-direct-agent-live-scenarios.ts`
- Modify: `services/kfc-agent-backend/package.json`
- Modify: `services/kfc-agent-backend/package-lock.json`
- Modify: `services/kfc-agent-backend/src/persistence/contracts.ts`
- Modify: `services/kfc-agent-backend/src/persistence/d1StoreAgentOperations.ts`
- Modify: `services/kfc-agent-backend/src/persistence/d1StoreSessionReset.ts`
- Modify: `services/kfc-agent-backend/src/persistence/d1StoreSupport.ts`
- Modify: `services/kfc-agent-backend/src/persistence/d1StoreTurnCommit.ts`
- Modify: `services/kfc-agent-backend/src/persistence/memoryStore.ts`
- Modify: `services/kfc-agent-backend/src/persistence/memoryStoreRunCommit.ts`
- Modify: `services/kfc-agent-backend/src/persistence/postgresStoreAgentOperations.ts`
- Modify: `services/kfc-agent-backend/src/persistence/postgresStoreCore.ts`
- Modify: `services/kfc-agent-backend/src/persistence/postgresStoreSessionReset.ts`
- Modify: `services/kfc-agent-backend/src/persistence/postgresStoreTurnCommit.ts`
- Modify: `services/kfc-agent-backend/src/persistence/runCommitPreparation.ts`
- Modify: `services/kfc-agent-backend/src/persistence/schema.sql`
- Modify: `services/kfc-agent-backend/src/config/env.ts`
- Modify: `services/kfc-agent-backend/src/worker.ts`
- Modify: `services/kfc-agent-backend/src/workerRouteOptions.ts`
- Modify: `services/kfc-agent-backend/src/workerReadiness.ts`
- Modify: `services/kfc-agent-backend/wrangler.toml`
- Delete: `services/kfc-agent-backend/langgraph.json`
- Test: `services/kfc-agent-backend/test/architecture/langchain-only-production-runtime.test.ts`

**Interfaces:**
- Conversation commit inputs no longer contain `sdkSessionMutation`.
- Stores no longer expose list/add/pop/clear agent-session-item methods.
- Runtime configuration has no `KFC_AGENT_RUNTIME`; readiness reports `langchain-create-agent` and application conversation state.
- Existing migration tables remain inert for rollout compatibility; no destructive SQL migration is included in this task.

- [ ] **Step 1: Write the failing repository-wide architecture guard**

Scan production TypeScript, package manifests, scripts, and Worker configuration. Assert forbidden dependencies/imports/runtime values are absent. Explicitly exclude documentation, migrations, and historical evidence from source-import checks while still rejecting active scripts/configuration.

- [ ] **Step 2: Capture RED**

Run:

```bash
npx vitest run test/architecture/langchain-only-production-runtime.test.ts
```

Expected: FAIL with the current direct SDK, graph imports, packages, and runtime flags.

- [ ] **Step 3: Remove SDK session mutations from persistence**

Delete the SDK `AgentInputItem` contracts and session-item store operations. Update assistant commits to persist canonical turns, business state, and neutral audit events only. Keep migration `0020_agent_sdk_session_items.sql` as historical schema until a later operational drop migration.

- [ ] **Step 4: Remove graph checkpoint dependencies and readiness**

Delete production checkpointer construction and reset operations against checkpoint tables. Keep migration `0007_langgraph_checkpoints.sql` as historical schema. Deep readiness checks `conversation_turns` and application lifecycle tables, not graph checkpoints.

- [ ] **Step 5: Remove packages, flags, scripts, and obsolete tests**

Remove `@kfc/openai-agents-runtime`, direct `openai`, `@langchain/langgraph`, and `@langchain/langgraph-checkpoint` from direct dependencies when `npm ls` proves no production import requires them. Remove `KFC_AGENT_RUNTIME`, OpenAI compaction env flags, Studio/dev graph scripts, and tests whose sole subject was deleted framework plumbing. Preserve and remap business-behavior assertions into Tasks 2 and 5 tests.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm install
npx vitest run test/architecture/langchain-only-production-runtime.test.ts
npm run typecheck
npm run lint
npm run lint:strict
npm run format:check
npm run check:architecture
npm run worker:deploy:dry-run
```

Then commit:

```bash
git add -A services/kfc-agent-backend
git commit -m "refactor(agent): remove legacy SDK and graph runtimes"
```

---

### Task 7: Replace custom commodity middleware and tracing safely

**Files:**
- Modify: `services/kfc-agent-backend/src/agent/kfcCreateAgentMiddleware.ts`
- Modify: `services/kfc-agent-backend/src/agent/agentTracing.ts`
- Delete: `services/kfc-agent-backend/src/agent/langsmithAgentTracer.ts`
- Modify: `services/kfc-agent-backend/src/agent/agentModelInvocation.ts`
- Modify: `services/kfc-agent-backend/src/businesses/pvcfc/langchainAgent.ts`
- Modify: `services/kfc-agent-backend/src/businesses/kfc/langchainTurnService.ts`
- Test: `services/kfc-agent-backend/test/agent/langchain-middleware-parity.test.ts`
- Test: `services/kfc-agent-backend/test/agent/langsmith-tracing.test.ts`

**Interfaces:**
- LangChain middleware owns generic retry, call limits, and summarization.
- Domain adapters still expose typed provider-attempt evidence and business error codes required by release gates.
- LangSmith uses automatic tracing with invocation `tags` and sanitized `metadata`; no private tracer method is called.

- [ ] **Step 1: Write failing parity and private-API guards**

Test retry counts, terminal failure classification, model/tool call limits, summary trigger/keep behavior, and sanitized trace metadata. Read tracing source and reject private method calls matching `/_createRun|_addRunToRunMap/u`.

- [ ] **Step 2: Capture RED**

Run:

```bash
npx vitest run test/agent/langchain-middleware-parity.test.ts test/agent/langsmith-tracing.test.ts
```

- [ ] **Step 3: Replace commodity behavior incrementally**

Wire LangChain's maintained middleware and remove only code proven redundant by the focused tests. Keep deadline/abort checks, KFC error translation, evidence receipts, authorization, and effect semantics.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run test/agent/langchain-middleware-parity.test.ts test/agent/langsmith-tracing.test.ts test/agent/kfc-create-agent.test.ts test/business/pvcfc-langchain-agent.test.ts
npm run typecheck
npm run lint
```

Then commit:

```bash
git add services/kfc-agent-backend/src/agent services/kfc-agent-backend/src/businesses services/kfc-agent-backend/test/agent
git commit -m "refactor(agent): use maintained LangChain middleware"
```

---

### Task 8: Refresh PVCFC demo scenarios and suggestion pills

**Files:**
- Create: `apps/pvcfc_chat_web/src/demoScenarios.ts`
- Modify: `apps/pvcfc_chat_web/src/App.tsx`
- Modify: `apps/pvcfc_chat_web/package.json`
- Modify: `apps/pvcfc_chat_web/package-lock.json`
- Create: `apps/pvcfc_chat_web/src/demoScenarios.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PvcfcDemoScenario {
  readonly id: string;
  readonly title: string;
  readonly turns: readonly string[];
  readonly evidenceMode: 'provider' | 'provider_then_live_web';
}

export const PVCFC_SUGGESTION_PILLS: readonly string[];
export const PVCFC_DEMO_SCENARIOS: readonly PvcfcDemoScenario[];
```

- [ ] **Step 1: Write failing copy/support tests**

Assert pills/scenarios cover product comparison, exact product evidence, dealer/contact, 2Nông/urban agriculture, company/facility facts, public reports, current official news, and inventoried-page fetch. Reject unsupported phrases implying live price, current inventory, confirmed hours, booked engineers, automated reminders, autonomous diagnosis, or OpenAI-specific runtime copy.

Add exact dev dependency `vitest@3.2.4` and script `"test": "vitest run"` to the PVCFC web package before running the RED test; do not add a browser DOM harness because this test exercises the exported data module only.

- [ ] **Step 2: Capture RED**

Run:

```bash
npx vitest run src/demoScenarios.test.ts
```

Expected: FAIL because scenarios are embedded in `App.tsx` and currently promise unsupported agronomic actions/GenUI.

- [ ] **Step 3: Extract and update demo content**

Replace the four current scenarios and pills with evidence-backed Vietnamese prompts. Remove the Generative UI toggle and obsolete PVCFC card/action paths from `App.tsx`; PVCFC presents cited text. Change replay copy from “mô hình OpenAI” to “trợ lý LangChain”.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run src/demoScenarios.test.ts
npm run build
```

Then commit:

```bash
git add apps/pvcfc_chat_web/src/App.tsx apps/pvcfc_chat_web/src/demoScenarios.ts apps/pvcfc_chat_web/src/demoScenarios.test.ts apps/pvcfc_chat_web/package.json apps/pvcfc_chat_web/package-lock.json
git commit -m "feat(pvcfc): refresh evidence-backed demo scenarios"
```

---

### Task 9: Full qualification, live TinyFish canary, and superseding PR

**Files:**
- Create: `services/kfc-agent-backend/scripts/run-tinyfish-live-canary.ts`
- Modify: `services/kfc-agent-backend/package.json`
- Create: `services/kfc-agent-backend/reports/langchain-only-business-agents-2026-08-12.md`
- Create: `docs/adr/0002-agent-loop-first-selective-langgraph.md`
- Modify: `README.md` or the existing runtime operations document located by `rg -n '(KFC_AGENT_RUNTIME|openai-responses|StateGraph)' README.md docs services/kfc-agent-backend/README.md`

**Interfaces:**
- `npm run test:live:tinyfish` runs only with `RUN_LIVE_TINYFISH=1` and `TINYFISH_API_KEY`; otherwise it reports skipped without failing CI.
- ADR-0002 carries forward PR #69's agent-loop-first decision, updated to the current business-pack/TinyFish design and explicit graph admission gate.

- [ ] **Step 1: Add a gated TinyFish live canary test-first**

The canary searches one approved PVCFC domain, fetches one returned official URL, verifies `final_url` remains allowlisted, records latency and content hash without full content, and performs no more than one search/one fetch.

- [ ] **Step 2: Run complete deterministic verification**

Backend:

```bash
npm run fixtures:pvcfc:check
npm run policies:check
npm run check
npm run build
npm run worker:deploy:dry-run
```

PVCFC web app:

```bash
npm test -- --run
npm run build
```

Repository architecture checks:

```bash
git grep -n -E '@kfc/openai-agents-runtime|@openai/agents|from ["'"']openai["'"']|@langchain/langgraph|@langchain/langgraph-checkpoint|openai-responses|KFC_AGENT_RUNTIME' -- ':!docs/**' ':!services/kfc-agent-backend/migrations/**' ':!services/kfc-agent-backend/reports/**'
```

Expected: `git grep` exits 1 with no matches; every build/gate exits 0.

- [ ] **Step 3: Run credentialed live canaries when keys are available**

Run:

```bash
RUN_LIVE_TINYFISH=1 npm run test:live:tinyfish
npm run test:live:scenarios
```

Record implementation status, deterministic proof, live proof, and any external provider limitation separately. A missing/blocked credential is not reported as deterministic implementation failure.

- [ ] **Step 4: Write the migration report and ADR**

The report must list commit SHAs, commands, pass/fail counts, Worker qualification, TinyFish evidence, deleted infrastructure, remaining custom code with business justification, and any rollout/database cleanup still pending. ADR-0002 must link PR #69 as historical evidence without importing its branch.

- [ ] **Step 5: Commit documentation**

```bash
git add services/kfc-agent-backend/scripts/run-tinyfish-live-canary.ts services/kfc-agent-backend/package.json services/kfc-agent-backend/reports/langchain-only-business-agents-2026-08-12.md docs/adr/0002-agent-loop-first-selective-langgraph.md README.md services/kfc-agent-backend/README.md
git commit -m "docs: qualify LangChain-only business agents"
```

Stage only paths that exist and were intentionally changed; do not add an unchanged README.

- [ ] **Step 6: Push and create the superseding PR**

```bash
git push -u origin codex/langchain-tinyfish-runtime
gh pr create --base main --head codex/langchain-tinyfish-runtime --title "refactor(agent): standardize business packs on LangChain" --body-file services/kfc-agent-backend/reports/langchain-only-business-agents-2026-08-12.md
```

The PR body must link `#69`, state that it supersedes rather than merges it, and include deterministic/live qualification separately.

- [ ] **Step 7: Close PR #69 only after the replacement PR exists**

Run:

```bash
replacement_pr_url=$(gh pr view codex/langchain-tinyfish-runtime --json url --jq .url)
gh pr close 69 --comment "Superseded by the LangChain-only business-pack migration in ${replacement_pr_url}. We retained the agent-loop-first ADR and historical qualification evidence; the diverged implementation was not merged."
```

Do not merge the replacement PR until required CI checks are green and the final diff review confirms unrelated shared-checkout work is absent.
