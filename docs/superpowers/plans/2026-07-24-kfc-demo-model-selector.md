# KFC Demo Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Flutter KFC demo switch among four configured live models between turns while preserving one conversation, with Messenger remaining on GPT-4.1 mini.

**Architecture:** The Flutter controller owns the selected candidate and places its validated wire ID in every demo customer-run request. The backend resolves that dedicated field against server-created candidate bindings, snapshots the binding for execution, bypasses the old session-wide pin only for the `kfc` demo channel, and records the actual identity on the assistant turn. Messenger retains the default binding and existing durable pin.

**Tech Stack:** TypeScript, Zod, LangChain model bindings, Fastify, Vitest, Flutter, `state_beacon`, `shadcn_ui`, Flutter widget/unit tests.

## Global Constraints

- Demo default is `openai-gpt-4.1-mini`.
- Live choices are OpenAI GPT-4.1 mini, DeepSeek V4 Flash, Qwen 3.7 Max, and MiniMax M3.
- A changed selection affects the next run and remains selected without clearing history.
- A running request keeps the candidate captured at submission.
- Messenger never accepts a demo override and stays on the configured GPT-4.1 mini binding.
- Unknown or unavailable candidates fail explicitly; there is no silent fallback.
- Do not add StateGraph, model parameters, credential UI, search, favorites, or parallel response mode.

---

### Task 1: Validate and resolve demo candidates

**Files:**
- Modify: `services/kfc-agent-backend/src/config/agentModelProfile.ts`
- Modify: `services/kfc-agent-backend/src/customerRuns/contracts.ts`
- Modify: `services/kfc-agent-backend/src/api/routeHandlerContracts.ts`
- Modify: `services/kfc-agent-backend/src/api/serverOptions.ts`
- Modify: `services/kfc-agent-backend/src/api/routeHandlers.ts`
- Test: `services/kfc-agent-backend/test/customerRuns/customer-run-runtime.test.ts`
- Test: `services/kfc-agent-backend/test/config/agent-model-profile.test.ts`
- Test: `services/kfc-agent-backend/test/api/server-options.test.ts`

**Interfaces:**
- Produces: `isLiveAgentModelCandidateId(value: string): value is LiveAgentModelCandidateId`
- Produces: optional `candidateId` on `CustomerRunStartRequest`
- Produces: `RouteOptions.agentCandidates`, a server-created map of configured live bindings

- [ ] **Step 1: Write failing tests**

Add contract tests proving that the four live IDs parse, an unknown ID is
rejected, and the request fingerprint differs when only `candidateId` differs.
Add server-option tests proving configured credentials create the corresponding
binding map without changing the default `agent`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- test/customerRuns/customer-run-runtime.test.ts test/config/agent-model-profile.test.ts test/api/server-options.test.ts
```

Expected: failures because `candidateId`, the live-ID guard, and candidate map do
not exist.

- [ ] **Step 3: Implement the minimal contract**

Export a live candidate type guard, add
`candidateId: z.enum(liveAgentModelCandidateIds).optional()` to the strict run
schema, add a candidate-keyed binding map to `RouteOptions`, and construct only
credential-backed bindings in `buildServerOptionsFromEnv`.

- [ ] **Step 4: Verify GREEN**

Run the focused tests again and expect all to pass.

### Task 2: Execute each demo run with its captured model

**Files:**
- Modify: `services/kfc-agent-backend/src/api/routeHandlers.ts`
- Modify: `services/kfc-agent-backend/src/api/routeAgentRuntime.ts`
- Modify: `services/kfc-agent-backend/src/api/routeChatHandlers.ts`
- Modify: `services/kfc-agent-backend/src/businessPacks/kfcVietnam/kfcVietnamPack.ts`
- Modify: `services/kfc-agent-backend/src/domain/types.ts`
- Modify: `services/kfc-agent-backend/src/agent/agentTurnPersistence.ts`
- Test: `services/kfc-agent-backend/test/api/routes.test.ts`
- Test: `services/kfc-agent-backend/test/businessPacks/kfc-vietnam-pack.test.ts`
- Test: `services/kfc-agent-backend/test/persistence/session-agent-model-binding.test.ts`

**Interfaces:**
- Consumes: `CustomerRunStartRequest.candidateId`
- Consumes: `RouteOptions.agentCandidates`
- Produces: `ConversationTurnMetadata.agentModel`

- [ ] **Step 1: Write failing route and pack tests**

Cover two turns in one `kfc:` session using different trusted bindings; verify
both complete, retain prior history, and persist the corresponding assistant
identity. Cover unknown and known-but-unconfigured candidates with
`invalid_agent_candidate` and `agent_candidate_unavailable`. Verify a Messenger
turn still invokes `options.agent` and retains session binding.

- [ ] **Step 2: Run focused backend tests and verify RED**

Run:

```bash
npm test -- test/api/routes.test.ts test/businessPacks/kfc-vietnam-pack.test.ts test/persistence/session-agent-model-binding.test.ts
```

Expected: switching fails with `session_agent_model_binding_mismatch`, and
assistant metadata contains no model identity.

- [ ] **Step 3: Implement captured execution**

Resolve the selected binding before accepting a demo run. Carry the binding in
the streaming-run observer so text and trusted GenUI action paths use the same
captured value. Add an explicit `agentModelBinding` parameter to
`kfcAgentResponse`. Skip session-wide pinning only when `channel == 'kfc'`;
retain it for Messenger and other packs. Persist the trusted identity on the
assistant turn metadata.

- [ ] **Step 4: Verify GREEN**

Run the focused backend tests and expect all to pass.

### Task 3: Add Flutter selection state and request transport

**Files:**
- Create: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/domain/kfc_agent_model_candidate.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/application/customer_chat_state.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/application/customer_chat_controller.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/data/customer_chat_repository.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/data/customer_chat_fixture_repository.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/domain/kfc_customer_chat_models.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/domain/customer_run_models.dart`
- Test: `apps/kfc_live_monitor_flutter/test/features/customer_chat/data/customer_run_repository_test.dart`
- Test: `apps/kfc_live_monitor_flutter/test/features/customer_chat/application/customer_chat_controller_test.dart`

**Interfaces:**
- Produces: `KfcAgentModelCandidate` with `wireName`, `displayName`, and `providerLabel`
- Produces: `CustomerChatController.selectModel`
- Produces: assistant `CustomerChatMessage.modelCandidate`

- [ ] **Step 1: Write failing Flutter data/controller tests**

Assert GPT-4.1 mini is the initial selection, switching preserves messages,
subsequent text and GenUI submissions carry the new dedicated `candidateId`,
and an accepted run retains the candidate selected at submission.

- [ ] **Step 2: Run the focused Flutter tests and verify RED**

Run:

```bash
flutter test test/features/customer_chat/data/customer_run_repository_test.dart test/features/customer_chat/application/customer_chat_controller_test.dart
```

Expected: failures because candidate state and request serialization are absent.

- [ ] **Step 3: Implement the minimal Flutter domain and transport**

Add the four-value candidate enum, selected candidate to immutable state,
controller selection guarded by `!state.isSending`, optional `candidateId` to
the repository contract and JSON, and candidate capture on
`ActiveAssistantDraft`/materialized assistant messages.

- [ ] **Step 4: Verify GREEN**

Run the focused Flutter tests and expect all to pass.

### Task 4: Render the shadcn model selector

**Files:**
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/customer_chat_screen.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/testing/customer_chat_keys.dart`
- Test: `apps/kfc_live_monitor_flutter/test/features/customer_chat/presentation/customer_chat_screen_test.dart`

**Interfaces:**
- Consumes: `CustomerChatState.selectedModel`
- Consumes: `CustomerChatController.selectModel`

- [ ] **Step 1: Write failing widget tests**

Assert the composer contains a `ShadSelect<KfcAgentModelCandidate>`, defaults to
GPT-4.1 mini, exposes all four labels, changes selection without removing
messages, disables during an active run, and renders the captured model label
under each assistant response.

- [ ] **Step 2: Run the widget test and verify RED**

Run:

```bash
flutter test test/features/customer_chat/presentation/customer_chat_screen_test.dart
```

Expected: failure because the selector and labels do not exist.

- [ ] **Step 3: Implement the selector**

Place a compact `ShadSelect` in the composer above the text-entry row. Use
existing KFC tokens, short selected text, full option labels with provider
captions, and a stable widget key. Render model provenance as 11–12px secondary
text beneath assistant content.

- [ ] **Step 4: Verify GREEN**

Run the widget test and expect all to pass.

### Task 5: Full verification

**Files:**
- Modify only files required by failures caused by this feature.

- [ ] **Step 1: Format**

Run:

```bash
npm run format
dart format apps/kfc_live_monitor_flutter/lib apps/kfc_live_monitor_flutter/test
```

- [ ] **Step 2: Run backend gates**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

- [ ] **Step 3: Run Flutter gates**

Run:

```bash
flutter analyze
flutter test
```

- [ ] **Step 4: Inspect final diff**

Run `git diff --check` and verify Messenger code has no request-selected
candidate path and no credential or generated evidence files are changed.

- [ ] **Step 5: Commit and push**

Commit the implementation and verification updates, then push
`codex/kfc-kiss-model-agnostic`.
