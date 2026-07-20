# Pitch Evidence And Demo Readiness Audit

Audited 2026-07-11 for [Audit Pitch Evidence And Demo Readiness](../issues/01-audit-pitch-evidence-and-demo-readiness.md). This is an evidence boundary, not a product change or a slide design.

> **Maintenance note (2026-07-20):** Historical measurements below retain
> their original audit dates and boundaries. Current architecture and
> qualification references were refreshed to the explicit LangGraph
> `StateGraph` runtime and the attested `kfc-live-quality-v1`
> 9-scenario/46-turn/92-case acceptance contract.
> Historical artifact paths that are not present in this checkout are retained
> as unlinked provenance text; they are not current evidence links.

## Decision

The July 11 audit found strong implemented and deterministic evidence for an agentic, governed commerce prototype, plus several useful live artifacts. It did **not** establish a demo-ready three-turn ordering path, a matching fallback recording, complete live-AI reliability, customer-visible semantic progress, text streaming, GenUI structural streaming/A2UI, production KFC OMS/POS compatibility, or measured business impact.

For the maintained runtime, the pitch can safely say that one model-driven agent authors typed commerce calls and a typed terminal response inside an explicit LangGraph `StateGraph`; deterministic code validates schemas, verified state, authorization, policy, tool execution, and typed response evidence; and every free-form customer response receives exactly one independent opposite-provider grounding-verification call before persistence. Missing verifier configuration keeps readiness red. Irreversible actions stop at an exact-action approval interrupt, but authenticated positive approval remains a release blocker. Fixtures and OMS/POS services must be called mocked or simulated, and the current system must not be called production-ready.

## Audit cut and provenance warning

The checkout was shared and changed concurrently during the audit. Product code was not edited by this ticket.

- Audit opened at `6726d314895530b65511cac85fa789054bfa22dd`, then advanced through `a91edd5897429482f2d8e309168cd96b3f36648e`, `6658fb8cbb7062e8c2beeae78893a247c71efc0f`, `58966b81c491fe6c5da2313c99e21663064d545a`, and `f36993463b89fe29372234dde8793fc8e6d63e3a` as other work landed.
- The selected deterministic suite ran entirely while `a91edd5897429482f2d8e309168cd96b3f36648e` was checked out and passed 87/87 tests.
- Two complete live-AI replays both produced the same headline result, 3/9 behavioral scenarios passing, but each spanned a concurrent checkout change. The first started at `a91edd58` and ended after `6658fb8c`; the second started clean at `58966b81` and ended at `f3699346` with unrelated dirty deployment files. They were audit-time operational observations, not clean-SHA proof artifacts.
- Manifests without a commit/dirty field cannot be upgraded to clean-checkout evidence by inference. Their exact runtime URL and time are recorded, but their source snapshot is **unbound**.

## AABW evidence standard

The [AABW Pitching Playbook](/Users/vietthangvunguyen/Downloads/AABW_Pitching_Playbook.pdf) requires a five-minute pitch plus two-minute Q&A, recommends finishing near 4:45, gives a one-minute demo the sequence `goal -> trigger -> agent acts -> outcome -> proof`, and ranks evidence from assumptions through benchmarks/user tests to pilot results. It explicitly asks judges to see the agent plan, use tools, act, verify, and recover. Therefore architecture alone is supporting evidence; the main evidence must show a real or honestly labelled controlled workflow and its result.

## Source-linked evidence inventory

### Implemented behavior

| Verifiable claim | Current source contract | Safe wording and boundary |
| --- | --- | --- |
| One explicit LangGraph `StateGraph` binds commerce tools for model-authored calls, executes validated calls against verified state, and requires a typed terminal response | [`agentStateGraph.ts`](../../../../services/kfc-agent-backend/src/agent/agentStateGraph.ts), [`singleAgentRuntime.ts`](../../../../services/kfc-agent-backend/src/agent/singleAgentRuntime.ts), [`agentToolExecutor.ts`](../../../../services/kfc-agent-backend/src/ordering/agentToolExecutor.ts), [`responseGrounding.ts`](../../../../services/kfc-agent-backend/src/agent/responseGrounding.ts) | “One model-driven agent makes semantic decisions; deterministic code validates structure and authority, executes bounded tools, and sends every free-form response through exactly one independent opposite-provider closed-world verifier.” Do not imply a supervisor/multi-agent system, a deterministic planner/composer, or a same-provider verifier fallback. |
| Irreversible ordering reaches an explicit approval interrupt; unsafe, stale, or unauthenticated resumes fail closed | [`agentStateGraph.ts`](../../../../services/kfc-agent-backend/src/agent/agentStateGraph.ts), [`agentToolExecutor.ts`](../../../../services/kfc-agent-backend/src/ordering/agentToolExecutor.ts), [`single-agent-runtime.test.ts`](../../../../services/kfc-agent-backend/test/agent/single-agent-runtime.test.ts) | “Order creation is blocked behind an exact-action approval boundary.” Authenticated positive resume remains a release blocker; do not present it as completed live proof. |
| Customer chat is a first-party Flutter surface backed by customer-run start, SSE event, cancel, text, and trusted GenUI-action routes | [`customer_chat_repository.dart`](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/data/customer_chat_repository.dart), [`customer_chat_controller.dart`](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/application/customer_chat_controller.dart), [`routeHandlers.ts`](../../../../services/kfc-agent-backend/src/api/routeHandlers.ts), [`routes.ts`](../../../../services/kfc-agent-backend/src/api/routes.ts) | “The app starts a text or trusted GenUI-action run, renders customer-safe progress and staged output, and can reconnect or request cancellation.” Do not call paced post-inference text deltas provider-token streaming. |
| Typed GenUI snapshots and staged revisions cover menu, cart, fulfillment, review/confirmation, payment methods/status, tracking, and handoff | [`kfcGenUiSelector.ts`](../../../../services/kfc-agent-backend/src/genui/kfcGenUiSelector.ts), [`runtime.ts`](../../../../services/kfc-agent-backend/src/customerRuns/runtime.ts), [`kfc_genui_renderer.dart`](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/genui/kfc_genui_renderer.dart) | “Structured GenUI turns verified state into safe customer actions.” Do not call it formal A2UI or model-authored incremental structure; revisions are projections of the complete attachment. |
| The Operations Dashboard consumes live backend events and can join a session, send a human reply, and resume AI | [`routes.ts`](../../../../services/kfc-agent-backend/src/api/routes.ts), [`backend_live_monitor_repository.dart`](../../../../apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/backend_live_monitor_repository.dart), [`session_card.dart`](../../../../apps/kfc_live_monitor_flutter/lib/features/live_monitor/presentation/widgets/session_card.dart) | “A live operator control plane can pause AI, let a human respond, and resume AI.” |
| Messenger and Zalo adapters, durable worker state, queue/run coordination, and interruption guards exist | [`messenger.ts`](../../../../services/kfc-agent-backend/src/channels/messenger.ts), [`zalo.ts`](../../../../services/kfc-agent-backend/src/channels/zalo.ts), [`worker.ts`](../../../../services/kfc-agent-backend/src/worker.ts), [`coordinator.ts`](../../../../services/kfc-agent-backend/src/agentRuns/coordinator.ts) | “The prototype has channel adapters and durable run coordination.” Do not infer production SLAs. |
| Replaceable OMS/POS interfaces and a simulated proof path exist | [`omsWithPos.ts`](../../../../services/kfc-agent-backend/src/commerce/omsWithPos.ts), [`httpPosClient.ts`](../../../../services/kfc-agent-backend/src/commerce/httpPosClient.ts), [current commerce audit](../../kfc-oms-pos-integration-capability/assets/current-commerce-prototype-audit.md) | “Demonstrated simulated OMS/POS orchestration through replaceable adapter contracts.” Never say KFC/vendor compatible. |

### Deterministic proof

| Evidence | Result | Snapshot and boundary | Recommended use |
| --- | --- | --- | --- |
| Historical selected backend verification run | 15 test files, 87/87 tests passed in 4.00 s: scenario scripts/replay, graph and confirmation, human loop, commerce proof contracts/evaluators, GenUI evaluator, and proof-manifest logic | Clean checkout `a91edd5897429482f2d8e309168cd96b3f36648e`; command: `npm test -- --maxWorkers=1 --no-file-parallelism ...` | Historical repeatability statement only. Say “87 selected deterministic checks passed in the July 11 audit,” not “87 current/live tests.” |
| Historical deterministic scenario replay | The retired path `services/kfc-agent-backend/test/scenarios/scenario-replay.test.ts` passed within the historical 87-test run; scripts covered the nine JSON scenarios and UC-01..UC-39 taxonomy | `a91edd58`; upstream data came from [`fixtures/generated`](../../../../services/kfc-agent-backend/fixtures/generated) and public-crawl-seeded fixtures | Historical evidence only; the retired test is unavailable in this checkout. |
| Current v1 live-quality contract | [`liveQualityContracts.ts`](../../../../services/kfc-agent-backend/src/evaluation/liveQualityContracts.ts), [`scenarioCoverageLedger.ts`](../../../../services/kfc-agent-backend/test/scenarios/scenarioCoverageLedger.ts), [`liveQualityDataset.ts`](../../../../services/kfc-agent-backend/src/evaluation/liveQualityDataset.ts), [`liveQualityEvaluators.ts`](../../../../services/kfc-agent-backend/src/evaluation/liveQualityEvaluators.ts), [`liveQualityStateGraph.ts`](../../../../services/kfc-agent-backend/src/evaluation/liveQualityStateGraph.ts), and [`live-ai-scenario-replay.test.ts`](../../../../services/kfc-agent-backend/test/scenarios/live-ai-scenario-replay.test.ts) define nine scenarios, 46 turns, and 92 attested Text/GenUI cases | Current static-ledger contract and selected StateGraph replay; offline tests verify corpus attestation and evaluator behavior, not a complete live matrix or provider quality | Use as the current qualification standard. Do not claim the paid matrix passed without an accepted run artifact. |
| Simulated POS component report | Historical `artifacts/mock-pos-proof/2026-07-10T20-24-31-483Z/report.json` said `simulated: true`, `passed: true`; it showed OMS/POS IDs, same-process idempotent replay, projected status, rejection, and attempted compensation | Generated 2026-07-10T20:24:31.483Z; the artifact is unavailable in this checkout and had no Git SHA/dirty field | OMS/POS appendix only, using the report’s narrow historical claim. |
| Golden/widget visuals | [`kfc_genui_catalog.png`](../../../../apps/kfc_live_monitor_flutter/test/goldens/customer_chat_genui/kfc_genui_catalog.png) and component goldens | Tracked test assets, not live evidence | Component catalog/appendix, not the main evidence slide. |

### Live proof

| Evidence | What it proves | Exact snapshot/runtime | Limits |
| --- | --- | --- | --- |
| Worker readiness queried during audit | `/ready` returned HTTP 200 with database, fixtures, Messenger, Zalo, OpenAI, and LangSmith checks green | Worker `https://kfc-agent-backend-demo.thangvnv0806.workers.dev`; clean release `a91edd5897429482f2d8e309168cd96b3f36648e`, built `2026-07-11T11:41:57Z`, queried `2026-07-11T11:43:57Z`; historical `artifacts/deployment/worker-deployment.json` is unavailable in this checkout | Configuration/readiness, not scenario success or dependency SLA. |
| Live Pages release files queried during audit | Customer and monitor aliases were reachable and served the same frontend release | `https://kfc-ai-chatbot.pages.dev` and `https://kfc-ai-live-monitor.pages.dev`; clean release `b290da13e25656646d1604001b5bcbb18e031ac5`, built `2026-07-11T11:36:10Z` | This Pages SHA is from another branch and is not an ancestor of the audit branch. The historical local `artifacts/deployment/pages-deployment.json` was stale (`b8e04c23`) and is unavailable in this checkout; the live `release.json` observed during the audit was authoritative for that historical observation. |
| Accepted deployed nine-scenario browser proof | Nine first-party browser scenarios, 49 turn screenshots, 82 durable turns, 381 durable events, and a monitor capture | Clean release `4e52c28faea35a957cf078990f5ad679d2867acc`; finalized `2026-07-11T00:21:03Z`; historical `artifacts/kfc-deployed-proof/20260710T235231Z-4e52c28faea3/proof-manifest.json` and `browser/browser-proof.json` are unavailable in this checkout | Strong historical deployed proof, but it is not the current worker/pages release and does not prove today’s three-turn path. The “monitor-all-scenarios” screenshot captured a loading/empty state and should not be used. |
| Historical full local live-AI Flutter GenUI proof | All nine scenarios passed, 50 screenshots, no missing screenshots, and nine sessions produced synchronous text plus GenUI | Local backend `http://127.0.0.1:58134`, live AI, macOS, run `2026-07-11T08-54-21-074Z`, generated `2026-07-11T09:13:30Z`; historical `artifacts/genui-live-proof/2026-07-11T08-54-21-074Z/integration-test/manifest.json` is unavailable in this checkout | The recorded manifest had no commit/dirty binding. It was a local run, not current deployment. Do not imply one clean current snapshot. |
| Historical focused Scenario 01 local live-AI Flutter proof | Seven agent responses across the ordering script, seven screenshots, and final `paymentOrderStatus`; test passed in 2:44 including screenshots | Local backend `http://127.0.0.1:54631`, live AI, macOS, run `2026-07-11T10-13-00-882Z`; historical manifest and log under `artifacts/genui-live-proof/2026-07-11T10-13-00-882Z/integration-test/` are unavailable in this checkout | The recorded manifest had no commit/dirty binding. Seven agent turns is over the pitch cap, and 2:44 is not a 55–65 second demo measurement. |
| Historical LangSmith agentic trace | Six-turn trace assertions passed: concrete item added, ambiguous removal blocked, named removal executed, fulfillment verified, confirmed mock order created, explicit handoff | Trace and 14-case experiment generated `2026-07-11T11:33:25Z`; base commit `ccad326c3cbb0bcca1379a5a7cbf2eaaa7801fce`; the recorded manifest was dirty and listed changed source/test paths; historical `artifacts/langsmith-agentic-proof/2026-07-11T11-33-25-848Z/manifest.json` is unavailable in this checkout | Causal historical technical evidence, not clean-checkout release evidence. Order ID was `KFC-MOCK-1001`. |
| LangSmith context experiment | 14 cases, all six aggregate scores reported as `1` | Same dirty `ccad326c` checkout and manifest above | Context/tool-policy evidence, not user/pilot or business-impact evidence. |
| Warning -> human joined -> human reply -> AI resumed video and screenshots | Six checkpoint states against the deployed worker and live monitor; final session returned to `ai_active` | Backend `https://kfc-agent-backend-demo.thangvnv0806.workers.dev`, monitor `https://kfc-ai-live-monitor.pages.dev`, run `2026-07-11T06-11-03-078Z`; historical manifest and video under `artifacts/warning-escalation-proof/2026-07-11T06-11-03-078Z/` are unavailable in this checkout | 117.56 s and no commit/release binding. It proves historical human-control behavior, not order completion and not a matching one-minute fallback. |
| Fresh deployed three-turn probe during this audit | Three POSTs completed in 1.532 s, 1.725 s, and 2.016 s (5.272 s total API time); six persisted turns and 15 events were observed | Current worker release `a91edd58`; session `kfc:pitch_probe_20260711T114605Z` | **Failed outcome:** every reply was “Mình cần thêm thông tin để hỗ trợ đúng.”; intent stayed `unclear`; no tools, GenUI, order, or payment. This is evidence against demo readiness. No external Messenger/Zalo message was sent. |
| Two full live-AI backend replays during audit | Both runs passed Scenario 01, Scenario 05, and Scenario 09; both failed Scenarios 02, 03, 04, 06, 07, and 08; UC-01..UC-39 coverage test passed | Run 1: 172.62 s across a moving checkout starting `a91edd58`; run 2: 165.20 s starting `58966b81` and ending `f3699346`; command `npm run test:live:scenarios -- --maxWorkers=1 --no-file-parallelism` | 3/9 behavioral scenarios passed, not 4/10: the fourth passing test is taxonomy coverage. Neither run is clean-SHA proof because concurrent checkout changes occurred. |
| Historical production-latency report | Six requests succeeded; menu p95 7,302 ms | `https://kfc-ai-chatbot.pages.dev`, project `kfc-agent-backend-local`; historical `artifacts/production-latency/latency-2026-07-11T11-34-09-283Z.json` is unavailable in this checkout | Overall/greeting p95 was 8,590 ms against an 8,000 ms target; only 5/6 monitor traces arrived. The historical report failed and had no checkout binding. Do not claim sub-eight-second p95. |

## Customer progress, streamed delivery, and GenUI/A2UI status

The maintained customer-run path now implements the following:

- [`CustomerChatState`](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/application/customer_chat_state.dart) owns an `ActiveAssistantDraft`, while [`customer_response_block.dart`](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/customer_response_block.dart) renders customer-safe progress, reconnect/stop state, text deltas, and provisional or authoritative GenUI.
- [`BackendCustomerChatRepository`](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/data/customer_chat_repository.dart) starts a customer run, consumes its SSE event stream with sequence-aware reconnection, and can request cancellation; synchronous message/action methods remain emergency or compatibility paths.
- [`CustomerRunCoordinator`](../../../../services/kfc-agent-backend/src/customerRuns/runtime.ts) emits run lifecycle, safe progress, paced text deltas, GenUI revisions/snapshots, and terminal events. [`progressProjection.ts`](../../../../services/kfc-agent-backend/src/customerRuns/progressProjection.ts) maps typed tool families to a closed customer-safe label vocabulary rather than exposing raw tool names or arguments.
- StateGraph model invocations—including typed terminal-response submission and the independent grounding-verification call—remain non-streaming. Text deltas are paced from the complete verified response after inference, so this is streamed delivery, not provider-token streaming.
- GenUI revisions are staged projections of the complete typed attachment before its authoritative snapshot. They are not model-authored incremental structure, JSON patches, or a formal A2UI protocol.

Therefore customer-safe progress, SSE delivery, stop/reconnect behavior, paced text deltas, and staged typed GenUI are implemented source contracts. They still require release-bound acceptance evidence before the pitch treats them as demo proof. “Provider-token streaming,” “model-authored structural streaming,” and “A2UI implemented” remain unsupported.

## Three-turn demo and fallback measurement

### Current verdict: not demo-ready

There is no current artifact that both completes a verified order in at most three agent turns and binds that result to the current deployed runtime.

- The fresh three-turn deployed probe took 5.272 s of API time but failed all functional checkpoints.
- The focused local Scenario 01 proof took 2:44 including capture overhead and used seven agent responses.
- The older real Messenger six-turn artifact’s persisted timestamps span 3:32.618 from first user turn to last assistant turn; its historical `artifacts/kfc-ai-chat-ordering/proof/20260710-141955-scenario01-messenger-final-replay/proof-summary.json`, unavailable in this checkout, recorded `containsOrderCreated: false` and `containsPaymentLinkCreated: false`. Its 13-second MP4 was an edited playback, not elapsed runtime.
- The newest human-control MP4 is 117.56 s and proves a separate warning/takeover/resume flow.
- The audit recorded an older 19-second edited monitor MP4 at `artifacts/monitor-live-proof/messenger-warning-escalation-human-loop-chrome.mp4`. It is unavailable in this checkout, had no manifest/commit binding, and was not the same scenario as the ordering demo.

The proposed 55–65 second demo and the exact-same-scenario fallback are therefore planned work for [Design Three-Turn Live Demo And Fallback](../issues/03-design-three-turn-live-demo-and-fallback.md), not current evidence. That ticket should fail closed until it produces a commit-bound synchronized recording, ordered event/state ledger, per-turn timing, verified final order state, and matching live/fallback scenario.

## Planned/assumed work

- Three-turn Vietnamese order flow, semantic progress milestones, 55–65 second timing, timeout/fallback threshold, and a matching preloaded recording.
- Release-bound acceptance for the implemented customer-run SSE, customer-safe progress, staged text/GenUI delivery, stop/reconnect, and supersession behavior; provider-token streaming or any later A2UI decision remains separate future scope.
- Production-grade OMS/POS durability, reconciliation, sandbox/vendor contracts, and real KFC integration evidence.
- Pilot/user-test evidence and measured conversion, revenue, completion-time, productivity, satisfaction, or handoff-rate improvement.

## Unsupported claims to exclude

- “Production-ready,” “connected to KFC production OMS/POS,” “vendor compatible,” or “creates real KFC orders.”
- “Uses KFC’s production system of record.” Fixture values are mocked upstream/API data, even where public KFC pages seeded product/payment facts.
- “The current live-quality matrix passes.” The July 11 audit observed 3/9 on the retired replay; the maintained v1 contract defines nine scenarios, 46 turns, and 92 Text/GenUI cases, but still requires a fresh accepted two-provider, two-mode, three-repetition qualification artifact.
- “Three-turn live demo is proven,” “55–65 seconds measured,” or “the fallback is the exact same scenario.”
- “Sub-eight-second p95 latency.” The latest six-sample report failed at 8.590 s overall/greeting p95.
- “Provider tokens stream directly,” “the model incrementally authors GenUI structure,” or “A2UI is implemented.” The maintained path streams customer-run events and paced post-inference output, which is a narrower claim.
- Measured business impact, user validation, pilot results, or ROI.

## Strongest evidence for the six main slides

| Slide | Strongest evidence now | Presentation rule |
| --- | --- | --- |
| 1. Team + promise | Live first-party chat URL and the clean Worker/Pages release identities | Use as credibility support, not a product-readiness claim. |
| 2. Problem insight | The concrete conversation-to-order gap embodied in [`01-dat-mon-ro-rang-giao-hang.json`](../../../../ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.json) and UC-01..UC-39 coverage | Frame as track/brief and workflow evidence, not customer research or pilot validation. |
| 3. Agentic workflow | Historical LangSmith six-assertion trace plus a current `goal -> explicit StateGraph -> model-authored bound tool calls -> structural/authority validation -> verified state -> independently verified response` visual grounded in `agentStateGraph.ts`, `agentToolExecutor.ts`, and `responseGrounding.ts` | The trace is dirty-checkout historical technical evidence; say mock order where shown, and do not depict a deterministic planner/composer. |
| 4. Why it wins | One readable local live-AI GenUI crop from Scenario 01 beside one readable `Human Joined`/`AI Resumed` crop | This is the strongest “one commerce state, two adaptive interfaces” proof. Do not use a collage or the empty `monitor-all-scenarios` capture. |
| 5. Evidence + impact | Historical `87/87 deterministic checks`, nine-scenario local live-AI GenUI capture, 14-case context experiment, and 3/9 audit result beside the current v1 9-scenario/46-turn/92-case qualification contract | Date the historical results and call them engineering/evaluation evidence. Do not call them current release proof or translate them into conversion or revenue impact. |
| 6. Demo + close | No current artifact qualifies. Until the demo ticket passes, use the clean historical `4e52c28f` final order-status screenshot only as a labelled preview and keep the actual demo promise conditional | The next ticket must create the exact three-turn live/fallback proof before this slide can be locked. |

## Strongest evidence for five technical appendix slides

| Appendix | Evidence package | Mandatory boundary |
| --- | --- | --- |
| A1. Runtime architecture | `routes.ts` -> `agentStateGraphRunner.ts` -> explicit `agentStateGraph.ts` -> bound tools/validation/execution -> typed response evidence -> exactly one independent opposite-provider verification -> persistence/dashboard; historical Worker `a91edd58`; Pages `b290da13` | Single agent, not supervisor + specialists or a deterministic planner/composer. A no-tool response uses one authoring call plus one verifier call; a one-tool-round response uses two authoring calls plus one verifier call. Missing verifier configuration keeps readiness red. Pages and Worker are separate historical release snapshots. |
| A2. Agent behavior and state authority | Historical LangSmith six-turn trace; current `agent-state-graph.test.ts`, `single-agent-runtime.test.ts`, and `response-grounding.test.ts`; `toolTrace`, persisted order/cart/session events; GenUI final snapshots | The model authors semantic calls; bounded validation, tools, and persisted state own commerce truth. The historical trace is mock/fixture backed, and positive approval still requires current proof. |
| A3. Reliability, recovery, human control | Human-loop deterministic test; six-checkpoint warning/takeover/resume manifest and video; run coordination/interruption source | The video is 117.56 s, unbound to a Git SHA, and is not order-completion proof. |
| A4. Evaluation and proof | Historical 87/87 deterministic run, 14-case LangSmith experiment, nine-scenario live GenUI manifest, and two 3/9 audit replays; current v1 static-ledger/dataset/evaluator/selected-replay contract | Separate historical deterministic, local live UI, live model, and deployed-browser evidence from the current qualification contract. A future complete qualification must run the shared evaluator through its LangSmith adapter for every turn and compare both providers and modes; the current selected replay does not establish that matrix. Never collapse the layers into one “all tests pass” number. |
| A5. OMS/POS adapter contracts | Simulated POS report, typed adapters, and [simulated proof/vendor handoff](../../kfc-oms-pos-integration-capability/assets/simulated-proof-matrix-and-vendor-onboarding-handoff.md) | “Simulated through replaceable adapters”; no KFC/vendor compatibility, durability, or production-readiness claim. |

## Readiness gates handed to later tickets

1. Lock claim language only against this ledger; no business impact number without new evidence.
2. Do not approve the live demo until one exact three-turn run creates and verifies an order on the intended release within the agreed timeout.
3. Record the identical scenario and bind live run, fallback video, event ledger, screenshots, release SHAs, fixture hashes, and final state in one fail-closed manifest.
4. Treat customer-safe progress, SSE delivery, paced post-inference text, and staged GenUI revisions as implemented source contracts but unavailable as demo or release proof until release-bound acceptance passes. Provider-token streaming, model-authored structural streaming, and formal A2UI remain unsupported.
5. Keep every OMS/POS and fixture reference visibly labelled simulated or mocked.
