# KFC Model-Agnostic Agent Donor Adoption Manifest

Status: binding first implementation artifact for [Start the fresh-main KFC agent migration and classify donor work](https://github.com/ThangVuNguyenViet/hackathon/issues/45).

Architecture amendment (2026-07-21): the reviewed hybrid boundary below replaces only the hand-authored semantic model/tool loop with one complete LangChain `createAgent()` graph inside a reduced deterministic KFC `StateGraph`. It supersedes both the explicit low-level semantic topology target and a direct-facade `createAgent()` cutover. Earlier plans that preserve the custom router/planner/composer topology are historical evidence, not the migration target.

## Baseline and custody

- Canonical map: [Wayfinder: rebuild the KFC agent as one provider-agnostic runtime](https://github.com/ThangVuNguyenViet/hackathon/issues/44)
- Base: `main` and `origin/main` at `8537dbd496a72285ca8468e9bc1c9f4b8383d549`
- Canonical branch: `codex/model-agnostic-kfc-agent`
- Canonical worktree: `/Users/vietthangvunguyen/Workspace/hackathon-model-agnostic-kfc-agent`
- Superseded draft: [feat(agent): enforce policy-scoped workflow routing and provider-neutral planning](https://github.com/ThangVuNguyenViet/hackathon/pull/26), closed without merge

No donor branch, worktree, commit, trace, review, or dirty experiment may be deleted until the replacement PR is merged. Donors are inputs to this manifest, not merge bases.

| Donor | Frozen head | Working state | Custody |
| --- | --- | --- | --- |
| `hackathon-agent-quality-integration` | `153f52b173e7f605436ad2d8ff48af31bfaddcc4` | clean | Preserve |
| `hackathon-agent-quality-v2` | `717ba42d2985b0976911f5dc665d17f0dfbe1e28` | clean | Preserve |
| `hackathon-restore-kfc-live-gates` | `2b3a98246154ae2b8db5b9baad988317ebbb9ea3` | clean | Preserve |
| `hackathon-gemini-all-green` | `9d7a34a700637190dbeaa32b056c624a06f1691a` | clean | Preserve |
| `.worktrees/provider-portable-agent-runtime` | `d0baaa8a231486bbe91bd0f20f252d12c1ab9e0b` | clean | Preserve |
| `hackathon-model-agnostic-agent` | `db0fd10a653edb7bcc0dab17da084bca5e160f33` | intentionally dirty | Freeze exactly; never clean or reset |
| `hackathon-langsmith-dataset` | `cc1a4b6988e58181850f8b3e4ce47e29bdd270a4` | clean | Preserve through the reviewed 92-case attestation update; this migration patch does not authorize a remote sync |
| `hackathon-langsmith-id-binding` | `d6f2314194d4dab27f63e66f7ebeff679f49abac` | clean | Preserve as merged-proof evidence |

## Disposition meanings

- **Adopt** — retain the current-main implementation or replay a small reviewed patch with only integration changes.
- **Redesign** — retain the requirement, schema intent, or regression case; implement it at the new single-agent boundary.
- **Evidence-only** — retain traces, benchmarks, failure cases, prompts, or tests as diagnostic input; no production code is copied.
- **Reject** — do not port or cherry-pick. Delete the corresponding current-main machinery when its replacement is proven.

Cherry-picking a donor wholesale is prohibited.

## Non-negotiable architecture boundary

The production runtime uses one reviewed LangChain JavaScript `createAgent()`
factory behind a named wrapper node in a reduced deterministic KFC
`StateGraph`. The wrapper maps KFC outer state and invocation context into the
complete nested agent and maps its typed result or propagated interrupt back to
the outer workflow. LangChain middleware manages the semantic model/tool loop
and human review. The parent graph owns the durable checkpointer, immutable
turn deadline, trusted-action routing, publication validation, persistence,
GenUI, and delivery. Business authorization, exact approval receipts, provider
idempotency, and reconciliation remain application-owned. `AgentExecutor`,
`createReactAgent`, duplicate semantic runtimes, deterministic language
routing, scenario-specific behavior, and manufactured model calls remain
prohibited.

The inspectable production workflow has two responsibility layers:

- the outer graph hydrates and gates the turn, invokes the named semantic-agent wrapper, validates trusted structured output, persists success or failure under the current fence, projects GenUI, and delivers;
- the complete nested `createAgent()` owns semantic model/tool iteration, dynamic tool visibility, whole-batch authored-call validation, bounded retry and correction, native HITL interruption, and provider-native structured output;
- nested interrupts propagate through the wrapper and resume the same parent thread with `Command`; workflow approval never substitutes for the signed KFC business-authority chain;
- every physical provider call shares one six-attempt ledger and the one classified retry, while every model-authored semantic invalidity shares one correction budget;
- terminal structured-output parsing errors are caught at a tested wrapper or model-call boundary that can re-enter the same invocation budgets; a second invalid result fails closed.

Trusted structured UI commands are carried separately from customer text and
the migration draft routes them through `prepare_structured_action` without
natural-language interpretation. That branch is integration-pending and is not
qualification evidence until its focused and full offline gates pass;
irreversible actions additionally remain blocked on authenticated authority.
`runAgentTurn` only assembles trusted dependencies and invokes the cached,
compiled outer graph. There is no parallel legacy runtime or second production
semantic agent.

Every model invocation, validation result, tool dispatch, approval interrupt/resume, semantic correction, retry decision, persistence step, and stop decision must remain visible through stable LangSmith lifecycle spans and outcomes; tests must not require obsolete internal node names. Configure both provider adapters with inherited `maxRetries: 0` and no hedging. Every permitted physical retry re-enters the shared provider-attempt guard and records the bounded error class and attempt. Deterministic outer routing and middleware may inspect typed message/tool-call structure, errors, counters, and verified state; they may not interpret customer prose.

Deterministic code may validate schemas, authentication, authorization, verified identifiers and state, business policy, exact-cart invariants, approval digests, idempotency, retries, execution, verified collection projection, and stopping. It may not:

- route customer text through fixed keywords, phrases, or regular expressions;
- compile classifier labels or semantic axes into routes, plans, or tool calls;
- manufacture, replace, append, remove, or reorder semantic tool calls;
- infer consent from a model-supplied boolean;
- scan generated prose for required fixed words;
- supply canned customer responses to provider qualification.

The normal target is one authoring call without commerce tools, and two
authoring calls with one ordinary tool round trip. One semantic correction is
allowed, and the
synchronous customer-turn path fails closed before a seventh outbound model
inference attempt. Every authoring call, semantic correction, and graph-owned
transport retry increments the same six-attempt counter; hidden adapter retries
and hedges are disabled. Deterministic publication validation fails closed on
invalid schemas, unsupported evidence, unauthorized disclosure, stale
authority, or invalid approval state. The asynchronous monitor is outside that
path and remains separately governed. A future complete offline live-quality
qualification must run the shared evaluator through its LangSmith adapter for
every turn and compare both providers and modes; deterministic publication
validation does not weaken or replace that requirement.

Approval pauses use LangGraph `interrupt` and `Command` with the injected checkpointer, but server-side binding and commerce-authority checks remain stricter than a model-visible approval flag.

## Current-main foundation

### Adopt

| Contract | Current-main source | Integration rule |
| --- | --- | --- |
| HTTP/channel application boundary | `src/api/routes.ts`, `routeAgentRuntime.ts`, `routeChatHandlers.ts`, `routeChannelHandlers.ts`, `routeMessengerRuntime.ts`, `routeSystemHandlers.ts`, `routeHandlerContracts.ts` | Preserve public request schemas, channel delivery, response envelopes, and the store-backed webhook/customer-run reservation contracts. Do not inherit synchronous KFC message/GenUI-action idempotency unchanged. `runAgentTurn` remains the thin application entrypoint. |
| Trusted structured actions | `src/api/routeChatHandlers.ts`, `src/domain/customerCommand.ts`, and `customerCommandFromVerifiedAction` callers | Preserve persisted-attachment lookup, server reconstruction of action IDs, selectable values, item codes and supported payment methods, and server validation of client quantities. These commands are server-bound validated actions, not signed messages or natural-language interpretation shortcuts. |
| Provider/client boundary | `src/clients/interfaces.ts` and existing concrete clients | Preserve typed commerce boundaries. Agent tools call the existing executor rather than importing provider clients directly. |
| Commerce types and execution core | `src/ordering/types.ts`, `toolBoundaries.ts`, `toolExecutor.ts`, provider-backed data services | Reuse domain types, authentication and authorization checks, provider calls, error mapping, execution, and stale-run suppression. Request idempotency belongs in route/store code, not `toolExecutor.ts`, and must be made atomic as specified below. Apply the redesigns before exposing irreversible writes. |
| Persistence | `src/persistence/*`, including D1 and Postgres checkpoint savers | Preserve durable conversation, checkpoint, request, run, and event stores. |
| Checkpointed pause/resume mechanics | `src/api/routes.ts`, `routeSystemHandlers.ts`, `routeCommerceRuntime.ts`; `src/graph/buildGraph.ts`, `nodes.ts`, `turnSupport.ts`; `Command`; existing confirmation-resume and D1 interrupt tests | Preserve server-generated request IDs, checkpointed interrupts, exact resume request binding, cart/fulfillment/payment and provider-authority revisions, provider revalidation, and route/store reservation, replay, conflict, completion, and failure fencing. Preserve these mechanics, not the old planner graph topology. Do not treat the current public resume request as authenticated customer consent; approval identity is redesigned below. |
| Verified business facts | Existing cart, order, fulfillment, payment, promotion, customer, invoice, handoff, and evidence types | Verified provider state remains authoritative over model claims. |
| GenUI envelope and server-bound validation | Existing GenUI models, selector boundary, API validation, persisted attachments, Flutter renderer/action transport | Preserve widget/action models, persisted-attachment lookup, server reconstruction of selectable identifiers, and Flutter transport. Call this server-bound validation, not signing or versioning; only webhook transport is signed. Redesign action lifecycle and collection projection below. |
| Governed content provenance | Current governed policy/content fixtures and `contentEvidence` provenance | Preserve official-source identity and same-reference evidence. The retrieval/ranking call becomes a normal typed tool. |
| LangSmith client and trace adapter | `src/observability/agentTracing.ts`, `langsmithAgentTracer.ts`, Worker flush plumbing | Preserve private correlation and flushing primitives. Rename spans around the single agent/model/tool/approval path. |
| APAC dataset ownership safeguards | Current `liveQualityDatasetSync.ts` after merged dataset and ID-binding work | Preserve fail-closed dataset identity, canonical inventory attestation, create/read ID binding, mutation ordering, and idempotent sync. |

### Redesign

| Area | Required replacement |
| --- | --- |
| `buildGraph.ts`, `agentStateGraph.ts`, `agentStateGraphRunner.ts`, `agentStateSchema.ts`, `agentTurnState.ts` | Keep the external turn/checkpoint contract and reduce the existing outer `StateGraph` to deterministic hydration, gates, trusted routing, publication, persistence, GenUI, and delivery. Invoke one complete `createAgent()` through a wrapper node that explicitly maps the differing outer and nested state contracts. |
| Synchronous request idempotency | Atomically reserve `(sessionId, clientMessageId, requestFingerprint)` in `ConversationStore` before model/tool work; conflict on a changed fingerprint, replay a stored terminal response on a match, and complete once. Do not use `kfc_request_completed` event scans or conversation-turn uniqueness as the fence. |
| Approval identity | Authenticate the approving principal/channel and bind the receipt to customer, session, capability, exact action digest, and current verified/provider revisions before translating approve/reject into a graph resume. |
| GenUI action authority | Bind each attachment to its originating assistant turn, authenticated session/customer, schema version, and verified state/collection revision; enforce expiry and a one-shot or explicitly replayable lifecycle plus request idempotency atomically. |
| `verifiedState.ts` | Persist every successful collection and irreversible-action receipt. Store collections by normalized query/scope key and replace that key's snapshot atomically; never merge a new filtered result with stale rows from another query or scope. Remove presentation aliases and state fields that exist only for router/planner recovery. |
| `toolCatalog.ts` | Derive minimal model-facing schemas instead of exposing the current executor schemas wholesale. Use `{scope:"all"}` or `{scope:"filtered",query}` for menu discovery and a uniform collection result `{items,total,returned,complete,scope,cursor?}`. Validate model-selected identifiers and quantities against verified state, then inject authoritative cart item codes, modifier names/prices, subtotal/display metadata, and approval receipts server-side. |
| `toolExecutor.ts` and safety gates | Exact cart-code equality for availability/fulfillment. Remove model-controlled `confirmed`, model-supplied fulfillment item-code sets and voucher subtotals, and model-supplied modifier display metadata. Bind irreversible execution to authenticated, current, exact-action approval receipts while preserving stale-run suppression, trusted confirmation binding, and provider-authority revalidation. |
| Membership writes | Keep `acquireVoucher` and `redeemReward`. The model chooses the target; runtime previews, interrupts, verifies the digest/account/target, executes once, persists the receipt, and returns it to the agent. |
| Content retrieval | Keep typed governed evidence and provenance. Replace provider-specific semantic ranking or unmarked top-three fallbacks with a complete/partial typed result. |
| Model profiles | One provider-neutral profile contract with `gpt-5-mini-2025-08-07` using low reasoning and low verbosity, and `gemini-3.1-flash-lite` with `LOW` thinking. Fail on drift; no silent fallback or mixed production profile. |
| GenUI projection | Extend the existing menu picker with provider-derived category tabs, every verified row, and a visible five-distinct-item limit. Project complete verified collections without model truncation. |
| Text collection projection | The model supplies the introduction and recommendation. Deterministic transport chunking renders every verified row when completeness is promised. |
| Monitor | Keep it asynchronous and non-authoritative. It is not part of the customer critical path or a per-turn merge judge. |

### Reject from current main

Delete these production paths after the maintained replacement passes focused tests:

- any direct-facade `createAgent()` cutover that bypasses the reduced outer KFC workflow, plus the obsolete `langchain-create-agent-v1` identity; retain reusable application helpers and use `langgraph-create-agent-workflow-v1` for the hybrid runtime
- `src/llm/smallTalkRouter.ts`
- `src/llm/responseComposer.ts`
- `src/llm/contentSemanticRanker.ts`
- `src/llm/staticToolPlanner.ts`
- `src/llm/toolPlanner.ts`
- `src/llm/toolPlannerBehaviorGuards.ts`
- `src/llm/toolPlannerBoundedClassifiers.ts`
- `src/llm/toolPlannerClassifiers.ts`
- `src/llm/toolPlannerCompactOutput.ts`
- `src/llm/toolPlannerNormalization.ts`
- `src/llm/toolPlannerPlanPolicy.ts`
- `src/llm/toolPlannerPrompts.ts`
- `src/llm/toolPlannerRequest.ts`
- `src/llm/toolPlannerSavedAddressPolicy.ts`
- `src/llm/toolPlannerSemanticContract.ts`
- `src/llm/vertexPlannerTransport.ts`
- `src/graph/responseComposition.ts`
- natural-language branches in `src/graph/naturalLanguageExecution.ts`, `turnPlanning.ts`, `planningContext.ts`, `turnContext.ts`, `turnSupport.ts`, and `commerceLifecycle.ts` that route customer meaning or synthesize semantic decisions/calls
- planner/router/composer-specific arena adapters and test fixtures
- legacy router/planner/composer imports, configuration, option plumbing, and call sites in `src/worker.ts`, `src/api/serverOptions.ts`, route handler/runtime contracts, `src/graph/agentTurnState.ts`, `buildGraph.ts`, `nodes.ts`, `studioAgent.ts`, the `response_composition` phase in `src/customerRuns/contracts.ts` and `runtime.ts`, `src/scenarios/runner.ts`, `src/evaluation/contextEvalRunner.ts`, `contextLangsmithExperiment.ts`, `modelArena.ts`, and composer fixtures/tests; replace every consumer in the same migration so deleted components cannot remain half-wired
- the synthetic commerce proof runner, evaluator, trace collector/event vocabulary, CLI, and proof-only tests; retain `src/commerceProof/contracts.ts`, `scenarios.ts`, `httpClients.ts`, `gatewayServer.ts`, Mock OMS/POS servers, and their contract/component tests without representing them as live-agent, LangSmith, sandbox-vendor, or production proof
- `contentSemanticRanker` construction in `src/api/serverOptions.ts` and its option/ranking branches in `src/mock/createMockClients.ts`, plus ranker tests; preserve `ContentEvidence`, provenance, tool-result, and verified-state contracts
- planner-trajectory fields and allowances in `src/evaluation/liveQualityContracts.ts`, `liveQualitySchemas.ts`, `liveQualityEvaluators.ts`, their dataset adapters, and tests, including `plannerRecords` and `allowDeterministicExecution`; replace them with verified outcome and forbidden-effect evidence
- operational adapters `scripts/demo-human-loop.ts`, `run-langsmith-context-baseline.ts`, `run-langsmith-agentic-proof.ts`, and `run-live-ai-replay.ts`, plus the old router/planner/composer span assumptions in `run-production-latency-probe.ts`; rewire them to the single agent or delete them
- split-role configuration, readiness, showcase, proof, and live-command surfaces in `src/config/env.ts`, `src/index.ts`, `src/workerReadiness.ts`, `src/showcase/showcase.ts`, `src/proof/kfcGenUiDeployedProof.ts`, `scripts/run-langsmith-genui-eval.ts`, `package.json`, `.env.example`, and the active backend `README.md`; replace planner/router/composer variables and proof fields with one agent provider/model/profile/SHA identity while keeping the monitor separately identified
- cross-repository consumers in `scripts/deploy-backend-cloudflare-worker.sh`, `tests/deployment/deploy_scripts.test.sh`, and Flutter showcase models/content/tests that publish, parse, assert, or display separate planner/response identities; migrate them atomically with the backend showcase/proof schema to the single agent identity

Allowed runtime packages include the exact reviewed `langchain@1.5.3` convenience dependency, `@langchain/langgraph`, its required `@langchain/core` primitives, `@langchain/openai`, `@langchain/google`, and `langsmith`. Only `src/agent/kfcCreateAgent.ts` may construct the production `createAgent()` instance. The runtime task must prove compatible official package versions, Cloudflare Worker support, native checkpointing and interrupts, strict tools, tracing, and both provider adapters before deleting the old path.

## Donor commit disposition

| Donor | Disposition | Keep | Do not carry forward |
| --- | --- | --- | --- |
| `f4915c47` | Redesign | Workflow/capability tool-metadata concepts and tests for unioned mixed scopes, clarification/router-failure zero-tool scope, and no provider-context loading | `WorkflowRoute`, the separate model router, route-derived tool/context filtering, and composer changes; `toolMatchesWorkflowRoute` considers route labels, not authorization |
| `e702e483` | Redesign | Protected-model drift failure, exact provider/model proof metadata, affordable OpenAI requirement | OpenAI-only role manifest and old router/planner/composer command wiring |
| `a0ad7afa` | Redesign | Commerce policy, authorization, confirmation, stale-state, source-guard, and fail-closed tests | Policy-scoped custom planner, semantic recovery, normalization, classifier, and route machinery |
| `882211d6` | Evidence-only | Transient OAuth-token refresh retry, strict full/compact Vertex JSON-schema translation, provider/model binding, and bounded arena diagnostics for schema errors and superseded requests | Custom Vertex transport, model arena, and planner coupling; this commit contains no `json_object` HTTP-400 regression test or artifact |
| `a036c9a6` | Evidence-only | A parallel port on a different parent whose Vertex transport and transport-test snapshots exactly match `882211d6`; retain as independent conflict/reference evidence | Treating the complete patch as equivalent to `882211d6`; its arena implementation differs, and the custom transport/arena/planner coupling should not migrate |
| `02d123d6` | Reject | Nothing beyond historical proof of readiness drift | Obsolete readiness assertion |
| `6c2d0ccf` | Redesign | Typed `customerCommand` precedence that bypasses router/planner, shared domain constants in the route schema, and follow-up/clarification routing regressions | Custom router dependency and prompt-based social-route repair |
| `153f52b1` | Evidence-only | Payment-method, modifier, saved-address, cancellation, and handoff regression inputs, plus the inherited qualification harness mechanics: three × 18 cases, exact HEAD/status capture, and p95 baseline comparison; no immutable 54/54 result artifact exists in the clean worktree | Production code that compiles route/classifier/state hints into actions or tool calls, including synthesized `listPaymentMethods`, and the custom router/planner/classifier stack |
| `717ba42d` | Adopt manually | Strict typed composition results, evidence IDs and claim-kind categories, raw-string rejection, invalid/unsupported-reference and policy/source tests, verifier-disagreement/failure cases, and the injected provider-neutral verifier seam | OpenAI-only or non-injected verifier coupling, prose scanning, and a duplicate legacy composition pipeline |
| `2b3a9824` | Adopt manually | Restore the consolidated live-scenario CI command; remove the fake composer; require successful `searchMenu`, no `updateCart` or cart state, and a Pepsi `smartMenuPicker` | OpenAI-only model configuration and Pepsi-specific scope; this is filtered-catalog evidence, not full-menu evidence |
| `9d7a34a7` | Evidence-only | Prompt-level failure hypotheses for food-property evidence versus modifier availability, and exact modifier `groupId`/`modifierId`/quantity copying | Treating prompt-string assertions as behavioral regressions, or carrying the bounded classifier/prompts as production architecture |
| `d0baaa8a` | Evidence-only | Optional four-second identical-request hedge, loser-cancellation/no-hedge tests, and profile evidence comprising separate all-3.1/all-3.5 profiles plus a 2.5/3.5 production mix | Custom hedging/transport and the mixed production profile; generic retry behavior is inherited and this SHA contains no measured live-latency result artifact |
| `5ac28403`, `17447e50`, `375d2fa5`, `10ced3c7`, `db0fd10a` | Evidence-only | Deletion inventory, source guards, typed validation cases, grounding and gate lessons | The rebased custom router/planner/composer implementation |
| Frozen dirty model-agnostic experiment after `db0fd10a` | Evidence-only | Proof that removing classifiers/recovery deletes about 3,000 lines; exact failure cases discovered while simplifying | Dirty code, partial `toolPlannerValidation`, retained workflow router, and any uncommitted production patch |
| Merged LangSmith dataset/ID-binding work | Adopt from main | Canonical APAC ownership, digest, ID binding, safe create/update/delete ordering, local/LangSmith evaluator parity | Any stale inventory version, digest, or payment argument contract after the reviewed 92-case attestation update |

## Test and evidence disposition

### Adopt or port

- authentication, authorization, stale-run, idempotency, exact trusted-action, checkpoint, interrupt/resume, and provider-client contract tests;
- concurrent identical/conflicting synchronous request reservations, authenticated approval identity, and expired/consumed/wrong-revision GenUI action regressions;
- failure cases for recommendation-without-mutation, modifiers, saved address, pickup/delivery, exact-cart fulfillment, payment discovery/status, cancellation, handoff, food evidence, private contact, voucher acquisition, and reward redemption;
- exact provider/model/profile/SHA/dataset proof identity;
- three unchanged repetitions and immutable-SHA attestation;
- LangSmith dataset ownership, digest, sync idempotency, and local/remote evaluator parity;
- filtered catalog no-mutation intent from `2b3a9824`; the separate new full-menu requirement adds exact returned/presented IDs and categories.

### Redesign

- keep the static 46-turn `scenarioCoverageLedger.ts` as the executable behavior oracle, with the nine reviewed JSON/Markdown scripts as conversation inputs and presentation references;
- preserve the canonical Scenario 02 full-menu and drink-recommendation requirements without adding duplicate turns;
- strengthen pre-consent, accepted-combo, and accepted-upsize state snapshots;
- retain the reviewed Scenario 03 inventory/availability and opaque saved-address delivery flow; pickup-then-delivery remains a future separately reviewed requirement and must not add duplicate turns;
- correct scenario/fixture contradictions;
- compare Text and GenUI facts directly;
- evaluate exact verified IDs, sets, quantities, prices, provenance, approval receipts, persistence, forbidden effects, and latency.

The attested v2 case shape still parses legacy `allowDeterministicExecution`,
`toolOrder`, `toolOrderGroups`, and `textAnyOf` fields so the approved
9/46/92 inventory changes only for the reviewed payment `methodId` defect.
Those fields are inert compatibility data: the evaluator does not accept
deterministic execution, fixed words, or exact tool order as quality evidence.
Remove the fields in a separately reviewed inventory-schema version.

### Reject

- `plannerRecords`, proposed-call success, exact tool order, route labels, classifier labels, and deterministic-execution allowances as agent-quality criteria;
- `scenarioResponseExamples` or any canned provider response;
- hard-coded response words such as `món`, `giỏ`, or `gợi ý`;
- tests that require synthesized `updateCart`, `quoteFulfillment`, `previewOrder`, `placeOrder`, payment, status, or handoff calls;
- menu truncation tests that bless five displayed results;
- OpenAI-real-response versus Gemini-canned-response comparisons;
- any live artifact from a dirty or mixed-source worktree as qualification.

Issue #50's stale 48/96 wording is explicitly rejected: the canonical corpus remains 9 scenarios, 46 customer turns, 92 Text/GenUI cases, and the duplicate-turn donor must not be resurrected. For two-mode comparison, 46 × 2 modes × 3 repetitions = 276 turn evaluations per provider and 9 × 2 modes × 3 repetitions = 54 scenario-mode runs per provider. The mandatory release gate is Text-only across the two providers, so 46 × 3 repetitions × 2 providers = 276 mandatory Text turn evaluations and 9 × 3 repetitions × 2 providers = 54 mandatory Text scenario runs. The APAC dataset remains 92 examples; version `2026-07-20.1`, its canonical digest, and the `createPaymentLink.methodId` correction require reviewed local attestation before any separately authorized remote sync.

## Parallel ownership after this manifest

| Wayfinder task | Primary ownership | Must not edit |
| --- | --- | --- |
| [Replace the KFC planner stack with one provider-agnostic LangGraph runtime](https://github.com/ThangVuNguyenViet/hackathon/issues/49) | package dependencies; model profiles; official adapters; explicit `StateGraph` nodes and conditional edges; `runAgentTurn` integration; atomic synchronous request reservation; authenticated checkpoint/resume endpoint and authority integration; deploy/readiness/proof/showcase agent identity, including its Flutter showcase consumer | ordering schemas/executor semantics, scenario source/oracle, Flutter menu UI |
| [Expose complete verified commerce tools through bound agent actions](https://github.com/ThangVuNguyenViet/hackathon/issues/51) | ordering schemas/types/executor/safety; verified collections; approval receipts; GenUI attachment authority and backend projection; existing Flutter picker | agent/provider loop, route/checkpoint endpoint, scenario oracle and dataset sync |
| [Make the nine-scenario corpus the single outcome oracle](https://github.com/ThangVuNguyenViet/hackathon/issues/50) | static scenario coverage ledger; evaluator; attested dataset inventory and sync boundary; selected StateGraph replay; maintained scenario/capture artifacts | production agent loop, ordering implementation, Flutter widgets |
| [Trace every protected single-agent command in LangSmith](https://github.com/ThangVuNguyenViet/hackathon/issues/34) | observability adapter, agent/model/tool/approval/state/GenUI spans, immutable proof manifest | semantic runtime, commerce behavior, scenario requirements |
| [Converge the big-bang agent and delete legacy semantic machinery](https://github.com/ThangVuNguyenViet/hackathon/issues/48) | sole conflict resolution, deletion, combined checks, architecture review | new feature design outside reviewed handoffs |

Shared-file ownership is explicit: task 49 owns `package.json`, `serverOptions.ts`, `routes.ts`, `routeHandlerContracts.ts`, `routeAgentRuntime.ts`, `routeSystemHandlers.ts`, `buildGraph.ts`, deployment/readiness/proof/showcase identity surfaces, and the Flutter showcase identity consumer; task 51 owns `routeChatHandlers.ts`, `verifiedState.ts`, `toolCatalog.ts`, `toolExecutor.ts`, `kfcGenUi.ts`, `kfcGenUiSelector.ts`, and the Flutter menu picker; task 50 owns the live scenario runner. Other tasks expose narrow seams and hand off clean commits; they do not edit another task's owned file.

## Handoff gate

This task is complete only when:

1. this manifest is the first commit on the fresh-main canonical branch;
2. the branch is pushed and one draft PR links the canonical Wayfinder map;
3. every donor remains preserved;
4. the three newly unblocked implementation tasks use isolated worktrees and this ownership table;
5. no production migration code is included in the manifest commit.
