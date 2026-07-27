# Shared Assistant Runtime And Business Pack Contract

## Decision

The codebase must use a **kernel-and-pack** boundary, not a universal customer-service domain model.

- The **Shared Assistant Runtime** owns Business-independent execution mechanics: trusted Business-context enforcement, conversation/run lifecycle, capability dispatch, evidence validation, generic safety phases, confirmations and irreversible-action protection, persistence/checkpoint envelopes, channel capability enforcement, observability, and evaluation-harness mechanics.
- A **Business Pack** owns one Business's domain language and behavior: intents, capability definitions, domain state and reducers, policies, prompts/planning schema, customer claims, localization, presentation projections, Provider requirements, fixture declarations, and executable quality inventory.
- A deployment binds a Business Pack's declared Provider ports to concrete Adapters and credentials. Provider instances and secrets are environment configuration, not source-controlled Pack content.
- The runtime treats Pack domain state and capability payloads as schema-validated opaque values. It must not accumulate a global union of KFC carts/orders and PVCFC agronomy, sales, complaints, visits, investor documents, or synthetic workflows.

This preserves the useful seams already present in KFC while removing KFC identity and commerce assumptions from shared-looking types. The current implementation demonstrates reusable turn injection and output seams, but `AgentTurnInput`, `AgentTurnOutput`, `AgentGraphState`, `ExternalClients`, the tool catalog, and presentation types still directly import KFC-specific concepts (`services/kfc-agent-backend/src/graph/agentTurnState.ts:45-106`, `services/kfc-agent-backend/src/graph/state.ts:26-77`, `services/kfc-agent-backend/src/clients/interfaces.ts:62-217`, `services/kfc-agent-backend/src/ordering/types.ts:278-377`, `services/kfc-agent-backend/src/presentation/channelPresentation.ts:1-44`).

## Architectural rules

1. **Resolve the Business before model execution.** The runtime receives a trusted, server-originated Business routing context and a matching Pack handle. User text, request JSON, public-site content, or model output cannot choose or replace it. Issue 04 defines the exact routing, identity, namespace, and credential rules.
2. **One session and run belong to exactly one Business and Pack major version.** State, evidence, checkpoints, caches, confirmation bindings, Provider bindings, and observability records are namespaced accordingly. A mismatch fails closed before hydration or model execution.
3. **Share execution protocols, not domain nouns.** Conversation turns, capability calls, evidence, events, checkpoints, policy decisions, and presentation envelopes are shared protocols. `Cart`, `Order`, fertilizer products, agronomy advice, complaints, factory visits, and investor reports remain Pack types.
4. **A Pack declares capabilities; an Adapter implements them.** Packs define stable Business capability semantics and policies. Adapters translate those calls to a specific Provider. Provider schemas, transport errors, and credentials do not leak into planning, state, or presentation.
5. **No claim or durable state without evidence.** Successful capability results carry typed evidence and produce Pack-defined state events. Planner candidates and model prose remain turn-local and cannot become durable facts.
6. **Safety is layered.** The runtime enforces non-bypassable generic invariants; each Pack adds domain-specific authorization, confirmation, transition, and claim rules. A Pack may strengthen shared safeguards but cannot disable them.
7. **Presentation is projected from verified state.** The runtime enforces channel capabilities and transport restrictions. Packs own localized text, brand assets, components, actions, and the mapping from verified domain state to presentation.
8. **Quality contracts are Pack-owned and runtime-executed.** The runtime supplies deterministic capture and conjunctive evaluation mechanics; each Pack supplies its scenario inventory, expected capability calls, state transitions, claims, evidence, and presentation oracles.

## Responsibility matrix

| Concern | Shared Assistant Runtime | Business Pack | Concrete Provider/Adapter or deployment |
|---|---|---|---|
| Business selection | Accept and enforce a trusted resolved context; reject mismatch | Declare immutable Business and Pack identity | Bind channel/tenant to Business; supply trusted context |
| Conversation lifecycle | Ingest, deduplicate, sequence, interrupt, checkpoint, resume, deliver | Define domain interpretation and response behavior | Channel Adapter transports messages/media |
| Domain language | No shared product/transaction intent union | Intents, entities, capability names, domain schemas, terminology | Translate Provider vocabulary only |
| Planning/composition | Run bounded planner/tool/composer phases and validate outputs | Planner schema, tool descriptions, prompts, deterministic response rules | No planning responsibility |
| Capabilities | Validate declaration, authorization, side-effect class, evidence, result, and timeout | Define typed Business capability contracts and policies | Implement a declared port against a Provider |
| Safety | Scope checks, fail-closed defaults, confirmation protocol, replay/idempotency, stale-run guards, evidence/claim gate | Domain preconditions, legal transitions, consent rules, escalation criteria, claim restrictions | Return truthful status, revisions, receipts, and errors |
| State | Durable envelope, append-only events, snapshots, schema/version metadata, atomic writes | Opaque domain state schema, event reducer, invalidation rules, migrations | Provider remains authority for external state |
| Evidence | Common envelope, retention/reference rules, validation, indexing, trace linkage | Required evidence by capability/claim and domain interpretation | Produce source-specific evidence through Adapter |
| Knowledge | Retrieval orchestration and evidence handling | Taxonomy, authority policy, freshness rules, language fallback, citation policy | Search/fetch fixture or live knowledge source |
| Presentation | Channel capability model, secure delivery, action normalization envelope | Text, localization, branding, components, action meanings, projection | Channel-specific transport and media delivery |
| Persistence | Business/session namespaces, transcript/run/checkpoint/event storage | Domain codec/reducer and Pack migrations | Environment-specific database configuration |
| Observability | Neutral run/capability/policy/evidence events with Business scope | Domain labels and customer-safe progress mappings | Provider latency/error/revision details |
| Evaluation | Harness, artifact capture, deterministic/conjunctive scoring support | Scenario ledger, hard oracles, datasets, fixtures, acceptance thresholds | Test/live Provider bindings and provenance |
| Secrets/configuration | Validate scoped bindings; never expose secrets to model/Pack prompts | Declare required configuration and Provider ports | Supply environment, credentials, endpoints, and Adapter instances |

## Stable contracts

The following are logical contracts. Exact module names can change during implementation, but their ownership and invariants are required.

### 1. Resolved Business context

```text
ResolvedBusinessContext
  businessId
  businessRoutingRevision
  environmentId
  channelBinding
  sessionSubject
  optional authenticated businessSubject
  authentication evidence and expiry
  authorized capability scopes
  configuration/credential namespace references
```

The runtime obtains this context before loading conversation state. The Pack can inspect authorized scopes through a read-only policy input, but cannot manufacture or mutate trusted identity. KFC already treats `CustomerAccessContext` as server authority and fails closed when authentication, subject binding, session equality, account linking, expiry, or scope checks fail (`services/kfc-agent-backend/src/domain/types.ts:7-39`, `services/kfc-agent-backend/src/security/customerAccessContext.ts:33-130`). Issue 04 generalizes the exact fields and isolation model.

### 2. Business Pack descriptor

```text
BusinessPackDescriptor
  businessId
  packId
  packVersion
  domainStateSchemaVersion
  supportedLocales
  supportedChannelProfiles
  capabilityRegistry
  domainStateContract
  conversationContract
  policyContract
  evidencePolicy
  presentationContract
  qualityContract
  requiredProviderPorts
```

The registry resolves by trusted `businessId` and an operator-configured Pack version, never from a prompt. Descriptor loading validates that required Provider ports and configuration exist. Missing or incompatible bindings disable affected capabilities or fail startup according to the Pack declaration; they must not silently bind another Business's Provider.

Pack upgrades need explicit compatibility metadata. A session may be migrated only through the Pack's versioned state migration; otherwise it remains pinned to a compatible Pack version or is restarted through an explicit operator policy. The runtime never guesses how to migrate opaque domain state.

### 3. Business-neutral turn envelope

```text
AssistantTurnInput
  resolvedBusinessContext
  packHandle
  sessionId / runId / generation
  channelContext and channel capabilities
  customer message or normalized structured action
  transcript references
  deadline and cancellation guard

AssistantTurnOutput
  canonical customer-safe text
  presentation envelope
  domain state revision
  evidence references
  capability trace references
  completion, suppression, or typed pause
```

Current `AgentTurnInput` already injects clients, store, dashboard, planner/composer, run guard, tracer, checkpointer, and trusted confirmation authority; output separates text, presentation, state, pause, and attachment (`services/kfc-agent-backend/src/graph/agentTurnState.ts:45-106`). Extraction must replace KFC-specific `Channel`, `ExternalClients`, `ReplyIntent`, confirmation kind, state, and GenUI types with Pack-neutral handles or Pack-parameterized values rather than widening their unions for PVCFC.

### 4. Conversation contract

Each Pack supplies:

- a domain intent/entity schema;
- normalized structured actions and their customer meaning;
- a bounded planner input projection from trusted context, transcript, and verified state;
- capability definitions exposed to planning for the current authorized turn;
- deterministic routes and response rules where model planning is unnecessary or unsafe;
- a composer contract and customer-claim validator;
- domain-specific clarification, unsupported-capability, and escalation behavior.

The runtime supplies phase ordering, deadlines, retries permitted by side-effect class, context-size controls, tracing, stale-run checks, pause/resume, and output validation. The model receives only the Pack selected by trusted routing. No shared `Intent` or `TOOL_NAMES` union should contain every Business (`services/kfc-agent-backend/src/domain/types.ts:41-51`, `services/kfc-agent-backend/src/ordering/types.ts:278-347`).

### 5. Capability registry and invocation

A Pack capability definition includes:

```text
CapabilityDefinition<Input, Output>
  capabilityId                  # scoped to Pack, stable within its major version
  inputSchema / outputSchema
  mode: read | reversible_write | irreversible_write
  requiredScopes
  requiredEvidenceClasses
  confirmationPolicy
  retry/idempotency policy
  timeout and uncertainty policy
  state events produced on success
  customer claims permitted by each result status
  required Provider port
```

The runtime capability dispatcher performs, in order:

1. resolve the declaration from the active Pack;
2. validate input and trusted authorization;
3. evaluate Pack preconditions and shared safety invariants;
4. bind and verify confirmation where required;
5. reserve an irreversible attempt before crossing the boundary;
6. invoke the Business-scoped Adapter;
7. validate typed result, status, provenance/evidence, and revision/receipt;
8. append capability trace and Pack state events atomically;
9. project only claims and actions allowed by verified result status.

A result distinguishes at least `succeeded`, `rejected`, `failed`, and `outcome_uncertain`. A transport timeout after an irreversible attempt cannot be converted into failure-and-retry without reconciliation. KFC's atomic reservation/replay and revision-bound order confirmation are the compatibility baseline (`services/kfc-agent-backend/src/clients/interfaces.ts:29-49`, `services/kfc-agent-backend/src/graph/commerceExecution.ts:164-238`).

The current `ExternalClients` collection is useful evidence that explicit ports work, but its fixed menu/cart/promotion/membership/OMS/payment surface is KFC-owned and must become the KFC Pack's required-port set rather than the shared interface (`services/kfc-agent-backend/src/clients/interfaces.ts:62-217`). Provider/Adapter result and provenance details are finalized by issue 05.

### 6. Evidence envelope

Every capability result and every mutable customer-facing claim references a shared evidence envelope with:

- Business, Pack, environment, session, run, and capability identity;
- authority kind and Provider/Adapter identity;
- source URL/API/artifact where applicable;
- corpus/dataset/scenario/version and content hash where applicable;
- observation/retrieval time, effective/publication time, and expiry/freshness;
- external revision, receipt, or entity reference;
- authorization/audience classification;
- status, limitations, and trace linkage.

The runtime validates envelope completeness against the capability declaration and stores evidence references with state events and responses. The Pack decides what evidence is sufficient to support a domain claim. Current `ToolResult`, `SourceProvenance`, `ContentEvidence`, and `ToolTraceEntry` provide a useful starting shape, but their fixture-mode union and content kinds are KFC-specific and incomplete for PVCFC corpus identity, dates, authority, document relationships, and synthetic capability limitations (`services/kfc-agent-backend/src/domain/types.ts:275-286`, `services/kfc-agent-backend/src/ordering/types.ts:20-36`, `services/kfc-agent-backend/src/ordering/types.ts:237-250`, `services/kfc-agent-backend/src/ordering/types.ts:349-377`).

Issue 02's PVCFC corpus requires immutable artifact hashes, source/content hashes, canonical/requested URLs, dates, language, version relationships, and an explicit public-only authority boundary (`docs/wayfinder/pvcfc-multibusiness-chatbot/assets/pvcfc-public-knowledge-and-crawl-fixture-inventory.md`). Issue 05 defines the final Provider/Adapter and fixture schemas.

### 7. State, event, and persistence contract

The durable record is a shared envelope plus Pack-owned state:

```text
ConversationSnapshot
  namespace: businessId / environmentId / sessionId
  packId / packVersion / domainStateSchemaVersion
  transcript cursor
  run generation and delivery state
  pending confirmation/irreversible-attempt receipts
  evidence index and capability trace references
  domainState: opaque validated Pack value
  last event revision / checkpoint reference
```

- The runtime owns namespace isolation, atomic append/checkpoint, replay, concurrency, retention hooks, and snapshot integrity.
- The Pack owns domain event schemas, the pure reducer, initial state, invalidation rules, serialization validation, and version migrations.
- Capability results produce events; the runtime does not permit direct arbitrary Pack mutation of persisted state.
- Model candidates, unverified retrievals, and planner-only context are excluded from durable Pack state.
- Rehydration rechecks trusted Business context and authorized personalized scopes before exposing private state.

KFC already centralizes successful tool-result application, reconstructs snapshots from events, persists verified snapshots, and keeps planner menu evidence turn-local (`services/kfc-agent-backend/src/graph/verifiedState.ts:171-184`, `services/kfc-agent-backend/src/graph/verifiedState.ts:278-335`, `services/kfc-agent-backend/src/graph/state.ts:61-67`). Its current `VerifiedStateSnapshot` is a KFC field list and must become the KFC Pack state contract, not the runtime snapshot schema (`services/kfc-agent-backend/src/graph/agentTurnState.ts:154-177`).

### 8. Safety and policy contract

The runtime enforces non-optional invariants:

- trusted Business and access context before hydration;
- schema validation at all Pack and Adapter boundaries;
- scope authorization before private reads/writes;
- no durable claim without evidence;
- no irreversible action without a fresh confirmation binding and reserved attempt;
- no automatic retry of uncertain irreversible outcomes;
- no stale/superseded run effects after the protected boundary rules apply;
- atomic trace/evidence/state receipts for consequential calls;
- channel actions cannot exceed channel or authorization capabilities;
- Packs and Adapters cannot access another Business's namespace or credentials.

The Pack defines domain policy:

- legal state transitions and invalidation rules;
- which actions are reversible or irreversible, subject to runtime minimums;
- what customer utterance constitutes intent or consent;
- confirmation payload fields and freshness requirements;
- evidence needed for each claim;
- when to clarify, refuse, reconcile, or escalate;
- domain-specific safety constraints such as KFC availability/order gates or PVCFC agronomy caveats and synthetic-capability disclosure.

KFC's current safeguards—verified item evidence, fulfillment prerequisites, explicit order confirmation, evidence-backed claims, bounded handoff, run-generation guards, and downstream-proof invalidation—must remain KFC Pack policy executed through these shared phases (`services/kfc-agent-backend/src/ordering/safetyGates.ts:18-42`, `services/kfc-agent-backend/src/ordering/safetyGates.ts:72-88`, `services/kfc-agent-backend/src/ordering/safetyGates.ts:128-241`, `services/kfc-agent-backend/src/agentRuns/coordinator.ts:27-166`, `services/kfc-agent-backend/src/graph/verifiedState.ts:144-169`).

### 9. Presentation contract

The shared presentation envelope supports canonical text plus optional typed components, media, and actions. The runtime owns:

- channel capability negotiation;
- prohibition of unsupported component/media combinations;
- secure media and action transport hooks;
- canonical action normalization envelope;
- evidence/action reference validation;
- delivery status, suppression, and replay semantics.

The Pack owns:

- localized customer language and fallback phrases;
- component kinds and data schemas;
- brand assets and allowlisted media policy requirements;
- mapping from verified domain state to text/components/actions;
- action meanings and their capability/confirmation bindings;
- Business-specific lifecycle and progress language.

Current channel capabilities correctly distinguish structured companion from standalone text/media and reject GenUI on social output, while `KfcGenUiAttachment`, KFC channel names, media assumptions, and Vietnamese KFC actions remain Pack-specific (`services/kfc-agent-backend/src/presentation/channelPresentation.ts:6-26`, `services/kfc-agent-backend/src/presentation/channelPresentation.ts:46-98`, `services/kfc-agent-backend/src/genui/kfcGenUi.ts:1-115`). Issue 07 defines the detailed component and localization contract.

### 10. Run coordination, observability, and evaluation

The runtime owns interruption generations, deduplication, debouncing/coalescing, protected phases, deadlines, pause/resume, committed-outcome receipts, customer-safe progress mechanics, trace correlation, and checkpoint readability. KFC's coordinator already demonstrates that newer turns may supersede work only before irreversible boundaries (`services/kfc-agent-backend/src/agentRuns/coordinator.ts:27-166`).

Every runtime record and metric includes `businessId`, environment, Pack/version, session/run, channel, capability, Adapter/Provider, authority kind, and evidence/receipt references where applicable. Domain payloads are redacted or summarized according to Pack declarations; credentials never enter traces.

The evaluation harness records capability calls, state events, claims, presentation, evidence, persistence, and latency in a Business-neutral execution record. Each Pack supplies its own scenario definitions and evaluators. The acceptance result remains conjunctive: a fluent response cannot compensate for a wrong call, state transition, unsupported claim, missing provenance, invalid presentation, or unreadable checkpoint. KFC already enforces this shape (`services/kfc-agent-backend/src/evaluation/liveQualityContracts.ts:20-155`, `services/kfc-agent-backend/src/evaluation/liveQualityEvaluators.ts:174-537`). Issue 08 finalizes the multi-Business quality and migration contract.

## Ownership tests

Use these questions when deciding where new code belongs:

1. Would the code still exist if the only Packs were a restaurant and a fertilizer company? If yes, it is probably runtime machinery.
2. Does it name a product, transaction, intent, policy, customer claim, component, or state meaningful to only one Business? If yes, it belongs in that Pack.
3. Does it translate a specific external schema, protocol, error, credential, or revision into a declared capability? If yes, it belongs in an Adapter.
4. Does it choose concrete endpoints, credentials, environment, or Pack versions? If yes, it belongs in deployment configuration.
5. Does it protect identity isolation, evidence integrity, confirmation, replay, concurrency, persistence, or channel safety for every Business? If yes, the runtime must enforce it and Packs cannot bypass it.

## Forbidden coupling

The implementation specification must reject these patterns:

- a shared `Intent`, `ToolName`, `ExternalClients`, or `AgentGraphState` union widened every time a Pack is added;
- a universal commerce/customer-service state machine with optional fields for unrelated domains;
- `if (businessId === ...)` branches throughout runtime execution;
- Pack code reading another Pack's state, fixtures, credentials, adapters, caches, or evidence;
- Provider Adapters returning final customer prose or mutating conversation state directly;
- Pack prompts selecting Business identity or constructing trusted access scopes;
- persisting planner candidates as verified facts;
- treating a public crawl, synthetic scenario, sandbox, and production Provider as interchangeable authority;
- falling back from a failed real capability to fabricated success;
- generic runtime components that import KFC-specific menu, cart, VND, order, GenUI, image-host, scenario, or dataset types.

## KFC extraction shape

The first migration should preserve KFC behavior by wrapping existing semantics rather than redesigning them:

1. Register a `kfc-vietnam` Pack descriptor while retaining the existing KFC scenario inventory and observable behavior.
2. Move the current KFC intent/entities, tool catalog, `ExternalClients` port set, domain state, reducers, safety rules, customer language, GenUI selectors, fixtures, and evaluators behind that Pack.
3. Parameterize the turn engine over Pack contracts while preserving current ordering and interruption phases.
4. Convert the existing trusted KFC context into the resolved Business/access context without accepting new request-controlled authority.
5. Store current KFC verified state as opaque KFC Pack state inside the shared snapshot envelope.
6. Keep existing Adapter/provider calls and confirmation/replay behavior, adding evidence-envelope fields without weakening gates.
7. Run the unchanged KFC 46-turn dual-mode inventory and GenUI proof as a blocking equivalence check throughout extraction.
8. Add the PVCFC Pack only after the runtime no longer imports KFC domain contracts.

This is behavior-compatible extraction, not a request to rename every current type at once. Issue 08 determines the exact migration and acceptance sequence.

## PVCFC consequence

The PVCFC Pack can then define domains unlike KFC commerce without changing the runtime: public corporate/product knowledge, agronomy, dated price guidance, distribution/contact, public forms, digital services, investor documents, sustainability, news/legal content, and explicitly synthetic private workflows. Its knowledge capability can require the dated, hashed public-corpus evidence from issue 02, while private sales/order/complaint/visit capabilities can require synthetic scenario authority and visible limitations. It does not inherit carts, KFC order confirmation bindings, VND menu schemas, payment widgets, or KFC acceptance cases unless PVCFC issue 06 independently defines analogous semantics.

## Decisions deferred to dependent tickets

- **Issue 04:** exact trusted routing inputs, subject bindings, namespace construction, credential/configuration isolation, caches, observability access, and local-development topology.
- **Issue 05:** final Provider/Adapter interfaces, evidence/provenance schema, freshness and authority ranking, fixture manifests, errors, uncertainty, and replacement semantics.
- **Issue 06:** exact PVCFC intents, domain state, capabilities, synthetic workflows, consent, escalation, and fail-closed behavior.
- **Issue 07:** final cross-channel presentation envelope, component/action registry, localization, branding, citations, and secure media rules.
- **Issue 08:** executable multi-Business quality schema, unchanged/evolved KFC migration oracle, PVCFC scenario ledger, and regression gates.
- **Issue 09:** concrete module/file ownership, ordered implementation slices, rollout, and rollback plan.
