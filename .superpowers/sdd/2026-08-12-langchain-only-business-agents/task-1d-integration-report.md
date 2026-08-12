# Task 1D — LangChain application integration report

## Result

The executable baseline now composes the real KFC and PVCFC LangChain `createAgent` packs through their supported application routes. KFC web chat, Messenger, and Zalo share the KFC-owned application turn transaction; PVCFC remains an isolated `web_chat` pack over its public-data provider. Production responses report `langchain-create-agent`. There is no runtime switch, direct OpenAI SDK, OpenAI Agents SDK, explicit LangGraph dependency, `StateGraph`, or framework checkpoint/session transcript.

The application remains authoritative for canonical transcript/state, trusted tool authorization, publication validation, confirmation pause/resume, irreversible effects, idempotency, run fences, verified state, GenUI, and delivery. The confirmation path now uses framework-neutral application identities (`sourceTurnId`, `actionScope`, and `actionId`) while preserving the historical SQL column names as inert storage compatibility.

## RED evidence

The KFC route and confirmation integration tests were added before production repair.

```text
npx vitest run \
  test/api/kfc-langchain-route-integration.test.ts \
  test/api/kfc-langchain-confirmation-integration.test.ts

FAIL test/api/kfc-langchain-route-integration.test.ts
Error: Cannot find module '../graph/buildGraph.js'

FAIL test/api/kfc-langchain-confirmation-integration.test.ts
The confirmation parser rejected sourceTurnId/actionScope/actionId and still
required the retired checkpoint identity tuple.
```

The initial complete TypeScript gate reproduced the brief's 507 diagnostics: 16 production route/resume seams, 24 obsolete scripts/evaluations, and 467 obsolete downstream test diagnostics. No unrelated diagnostic group appeared.

Subsequent focused RED cycles exposed real integration gaps rather than being excluded: dynamic tool authorization, trusted GenUI action authority, PVCFC fail-closed startup, Messenger/Zalo resumed delivery, social-media persistence, dashboard resume supersession, guest checkout authority, and stale graph session-reset helpers.

## Route and channel composition

| Surface | Trusted pack/application path | Business-owned result |
| --- | --- | --- |
| `POST /chat/kfc/message` and KFC run routes | KFC application transaction -> `KfcAgentPack` -> LangChain `createAgent` | Canonical KFC state, typed tools, validated customer response, optional GenUI/pause, atomic assistant commit |
| `POST /chat/kfc/genui-action` | Server-verified structured action -> exact selected-action authority -> KFC application transaction | Deterministic typed action execution followed by presentation-only model publication |
| `POST /chat/kfc/confirmations/resume` | Signed public capability -> stored canonical pause -> application resume coordinator | Exactly-once stored KFC action execution and fenced completion |
| Messenger webhook/agent run | Signed ingress and channel-scoped run -> KFC application transaction -> Messenger delivery journal | Standalone text plus trusted KFC catalog media; guest authority only from exact verified ingress |
| Zalo webhook/agent run | Zalo event and channel-scoped run -> KFC application transaction -> Zalo delivery journal | Inline completion when no deferred runtime is configured; queued completion under Worker defer |
| `POST /chat/pvcfc/message` | Literal PVCFC route -> `PvcfcAgentPack` -> LangChain `createAgent` | `web_chat`, PVCFC provider evidence, text-only response; no KFC cart, state, GenUI, confirmation, or human-pause dependency |

KFC tool exposure is recomputed by LangChain middleware before each model call from the current trusted state/profile. The executor repeats authorization immediately before execution. Customer prose, IDs, prefixes, and metadata do not select a pack, expose a tool, or authorize an action.

## Confirmation pause/resume and exactly-once proof

The canonical pause persists:

- exact canonical tool name and arguments;
- action digest and current approval-binding digest;
- session/customer/channel principal and authentication evidence;
- `sourceTurnId`, `actionScope`, and `actionId`;
- application session generation, creation time, and expiry.

Resume processing verifies the signed public capability against the stored snapshot, rehydrates the exact stored source turn and action, recomputes current binding authority, claims a durable resume lease, reserves the irreversible operation, executes only the stored canonical action, and commits/completes beneath the signed execution fence. A repeated request observes the durable terminal outcome instead of re-executing the provider effect.

Focused confirmation proof is 22/22 across `kfc-langchain-confirmation-integration.test.ts` and `confirmation-resume-authority.test.ts`. It includes changed-argument/digest mismatch, changed source turn/action ID, copied principal, cross-session capability, stale generation/binding, expiry, unauthorized resume, competing claims, provider ambiguity, and replay. The store/fence suites additionally exercise D1/Postgres-compatible pause identity and irreversible-operation authority.

## Persistence, delivery, and supported-behavior map

| Supported behavior | Surviving/new proof |
| --- | --- |
| Client-message idempotency and request replay | `test/api/chat.test.ts`, `test/api/synchronous-request-reservation.test.ts` |
| Authentication and dynamic active-tool authorization | `test/agent/agent-tool-profile.test.ts`, `test/agent/model-publication-guest-authority.test.ts`, `test/api/messenger-guest-checkout-ingress.test.ts` |
| Canonical argument and publication validation | `test/business/kfc-langchain-pack.test.ts`, `test/ordering/agent-tool-executor.test.ts`, `test/api/chat.test.ts` |
| Run/current-owner fences and supersession | `test/api/chat.test.ts`, `test/api/agent-run-text-delivery-runtime.test.ts`, `test/api/dashboard-resume-recovery.test.ts`, `test/api/human-takeover.test.ts` |
| Canonical transcript and atomic assistant commit | `test/api/kfc-langchain-route-integration.test.ts`, `test/api/chat.test.ts` |
| KFC response shape and runtime identity | `test/api/chat.test.ts`, `test/api/kfc-langchain-route-integration.test.ts` |
| Real typed tool execution and verified state | `test/business/kfc-langchain-pack.test.ts`, `test/ordering/agent-tool-executor.test.ts` |
| Confirmation pause/resume and exactly-once effect | `test/api/kfc-langchain-confirmation-integration.test.ts`, `test/api/confirmation-resume-authority.test.ts`, `test/persistence/confirmation-pause-store.test.ts`, `test/ordering/approval-execution-fence.test.ts` |
| Trusted GenUI selection/action | `test/genui/kfc-genui-selector.test.ts`, `test/genui/kfc-genui-contract.test.ts`, maintained GenUI cases in `test/api/chat.test.ts` |
| Human takeover, paused suppression, reply, and AI resume | `test/api/human-loop-channels.test.ts`, `test/api/human-takeover.test.ts` |
| Social media persistence and provider-failure isolation | `test/presentation/channel-presentation.test.ts`, `test/api/channel-media-throw-delivery.test.ts`, `test/evaluation/messenger-projection-parity.test.ts` |
| Privacy/redaction, voucher/dashboard events, and saved-address safety | maintained cases in `test/api/chat.test.ts`, `test/api/route-monitor-runtime-privacy.test.ts` |
| PVCFC route/provider isolation and fail-closed startup | `test/api/pvcfc-agent-pack-route.test.ts`, `test/api/pvcfc-server-options.test.ts`, `test/architecture/pvcfc-agent-import-boundary.test.ts` |

Assistant social presentation metadata is persisted with the assistant turn, then reconstructed for delivery so retries and resumed channel runs do not degrade to text-only. Text delivery is journaled first; media failure is isolated, redacted, and reported without changing a confirmed text send to failed. Messenger and Zalo both deliver through the agent-run fence.

## Deleted or replaced obsolete assets

Deleted 94 graph/SDK-only assets instead of adding compatibility shims:

- 1 orphan executable checkpoint approval module;
- 3 obsolete graph/direct-agent proof or eval scripts;
- 4 obsolete direct-agent/StateGraph evaluation modules;
- 86 obsolete graph, checkpoint-saver, SDK-session, direct-agent, proof, scenario, worker, or duplicated downstream tests.

The broad legacy exclusion list was removed from `vitest.ci.config.ts`; the maintained suite now runs every surviving test. Package scripts pointing at retired assets were removed. Unused `langGraphConfig*` helpers and active session-reset deletion of retired LangGraph tables were also removed. Historical D1/Postgres schema/column compatibility remains inert, as permitted by the brief.

## Verification

Required focused verification:

```text
npx vitest run [12 required KFC/PVCFC route, confirmation, delivery, GenUI,
and architecture files]

Test Files  12 passed (12)
Tests       126 passed (126)
```

Canonical complete gate:

```text
npm run check

format:check   passed
lint           passed with 0 errors and 391 budgeted legacy warnings
lint:strict    passed; warning budget preserved
typecheck      passed with 0 diagnostics
test:ci        192 files passed, 1 skipped; 1900 tests passed, 1 skipped
```

Additional gates:

```text
npm run check:architecture
Architecture size check passed (456 files, 900-line ceiling, no baseline growth).

npm run build
exit 0

npm run worker:deploy:dry-run
exit 0; Wrangler produced the Worker upload/binding plan and exited dry-run.

git diff --check
exit 0
```

The separately requested gateway baseline did not reproduce in the final tree:

```text
npx vitest run test/commerceProof/gateway-provider-idempotency.test.ts
Test Files 1 passed (1); Tests 18 passed (18)
```

No gateway behavior was changed to obtain that result.

## Files and commit

Primary new modules:

- `src/businesses/kfc/applicationTurn.ts`
- `src/api/confirmationPausePersistence.ts`
- `src/api/productionConfirmationResume.ts`
- `test/api/kfc-langchain-route-integration.test.ts`
- `test/api/kfc-langchain-confirmation-integration.test.ts`

The integration also updates route/channel composition, KFC tool middleware/execution, confirmation contracts and durable-store mappings, delivery presentation persistence, dashboard resume fencing, runtime guards, and focused maintained tests. The complete file set is captured by the commit diff.

Required commit subject:

```text
refactor(agent): integrate LangChain business runtimes
```

The final commit SHA is reported in the task handoff.

## Self-review and remaining concerns

- Confirmed KFC and PVCFC remain separate business packs behind only the neutral `id` + `runTurn` registry boundary.
- Confirmed the KFC application transaction, not LangChain, owns transcript, state, authorization, confirmation, effects, idempotency, publication, and delivery.
- Confirmed canonical action arguments/digests and actor/session identity are bound together; mismatch, replay, stale, unauthorized, and cross-session resumes fail closed.
- Confirmed trusted GenUI action authority is exact and presentation-only model continuation cannot invent a different action.
- Confirmed social media comes only from trusted KFC HTTPS assets and provider failure details are redacted.
- Confirmed source/package guards reject direct OpenAI SDK, OpenAI Agents SDK, explicit LangGraph, `StateGraph`, runtime switches, and deleted-module compatibility imports.
- Confirmed no TinyFish, demo UI, or fixture bytes changed in Task 1D.
- The one skipped maintained test is the credentialed live Worker interruption proof; no local unit/integration failure remains.
- TinyFish/web-search and revised demo scenarios remain later tasks after this clean LangChain-only baseline.
