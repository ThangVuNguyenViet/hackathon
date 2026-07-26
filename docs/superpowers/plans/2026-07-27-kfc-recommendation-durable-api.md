# KFC Recommendation Durable State and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist recommendation flow state, decisions, and events in D1; expose
idempotent decision/impression/outcome APIs; and add a protected inspection
envelope that explains each result without exposing customer prose or private
reasoning.

**Architecture:** The existing recommendation JSON Schema remains the transport
authority. A pure state machine extends the KFC pack-owned verified state, while
MemoryStore and D1Store implement one recommendation persistence port with
atomic idempotency, pack-state compare-and-swap, decision/event commits, and
replay. A recommendation application service assembles server-owned context,
calls the already-approved deterministic engine, commits the result, and feeds
thin Fastify and Worker route adapters. Protected admin reads project the
durable state, latest decision, correlations, and technical evidence; normal
clients receive only the canonical customer response.

**Tech Stack:** TypeScript 5, Zod 3, JSON Schema 2020-12, Pydantic 2,
Fastify 5, Cloudflare D1/SQLite, Vitest, existing KFC pack-state envelopes and
recommendation decision engine.

## Global Constraints

- Work on `codex/kfc-recommendation-poc-implementation`.
- The canonical contracts and pure decision engine through commit `8f771de4`
  are authoritative; extend them without adding a compatibility path.
- Keep semantic routing and customer-language interpretation in the LangChain
  `createAgent` loop. This plan adds no agent tool, prompt, GenUI, Flutter,
  scenario runner, or learned-model inference.
- Clients provide canonical requests and rendered/outcome facts, never
  candidates, eligibility evidence, history, cohorts, dietary evidence, stage,
  policy applicability, version bindings, `recordedAt`, or technical evidence.
- `verifiedCustomerRef` is effective only when the server-owned customer
  history repository resolves it as linked. An unknown or unlinked value
  behaves as no verified history.
- Normal decision responses contain only
  `RecommendationDecisionResponse`. Complete ranking, eligibility, policy, and
  state evidence is available only from `/admin/` routes protected by the
  existing demo-admin authorization.
- All three public recommendation endpoints are idempotent. A matching replay
  returns the stored result without a second state transition or event; reuse
  of an idempotency key, request ID, or event ID with a different canonical
  fingerprint returns `409`.
- D1 decision/event commits and KFC pack-state updates are atomic. Do not use
  dashboard events, transcript scans, process-local caches, or event replay as
  the write fence.
- `recommendation_events` is append-only audit/analytics history.
  `pack_state_projections` remains the current-state authority.
- Store state and payload JSON only after strict parsing. Reads parse stored
  JSON through the same strict schemas and fail closed.
- Use server-injected clocks; persisted `recordedAt` is never accepted from
  public JSON.
- Initial POC store timezone is server-owned
  `Asia/Ho_Chi_Minh`. Remaining budget, cohorts, and dietary evidence enter
  through an injected server context port; defaults are `null`, `[]`, and
  `null`, never client fields.
- A public Modifier Upsell decision resolves its parent only from a trusted
  internal override or from the pending starter action that was durably
  recorded as a successful cart mutation. Ambiguous cart lines return an
  ineligible/empty result; never choose a parent from customer prose.
- State transitions follow the accepted stage table. `selected` does not claim
  cart success. Starter advances to Modifier Upsell only on
  `cart_mutation_succeeded`; Modifier and Smart stages close on selection,
  dismissal, ignored, or superseded outcome.
- An impression is accepted only after exact rendered action IDs/positions,
  action digest, assistant turn, attachment, and decision cart revision match
  the stored recommendation.
- Outcome action IDs must belong to the stored recommendation. Attachment-level
  dismissal rejects every displayed action; `ignored` closes the proactive
  stage but is not stored as an explicit rejection.
- Tests remain small and direct. Use real contract parsers, real checked-in KFC
  fixtures, MemoryStore, and SQLite-backed D1; do not assert source text,
  internal call sequences, or mocks of the behavior under test.
- Do not add retry, lease-expiry recovery, performance enforcement, or outage
  modes in this POC slice. Atomic idempotency, replay, and concurrent state CAS
  are required.

---

### Task 1: Add canonical state and event-ingress contracts

**Files:**

- Modify:
  `contracts/recommendations/v1/kfc-recommendation.schema.json`
- Create:
  `contracts/recommendations/v1/examples/valid-recommendation-state.json`
- Create:
  `contracts/recommendations/v1/examples/valid-impression-request.json`
- Create:
  `contracts/recommendations/v1/examples/valid-outcome-request.json`
- Modify:
  `contracts/recommendations/v1/examples/invalid-contract-values.json`
- Modify:
  `services/kfc-agent-backend/src/recommendations/domain/schemas.ts`
- Modify:
  `services/kfc-agent-backend/src/recommendations/domain/contracts.ts`
- Modify:
  `services/kfc-agent-backend/test/recommendations/json-schema-contract.test.ts`
- Modify:
  `services/kfc-agent-backend/test/recommendations/domain-contract.test.ts`
- Modify:
  `services/kfc-recommendation-simulator/src/kfc_recommendation_simulator/recommendation_contracts.py`
- Modify:
  `services/kfc-recommendation-simulator/tests/test_recommendation_contracts.py`

**Interfaces:**

The JSON Schema adds three addressable definitions and includes them in the
top-level `oneOf`:

```ts
interface RecommendationState {
  schemaVersion: 'kfc-recommendation-state-v1';
  revision: number; // non-negative integer
  orderFlowId: string;
  stage:
    | 'starter_eligible'
    | 'starter_resolved'
    | 'modifier_eligible'
    | 'modifier_pending'
    | 'modifier_resolved'
    | 'smart_cross_sell_eligible'
    | 'smart_cross_sell_pending'
    | 'complete';
  attemptedPlacements: Placement[]; // unique
  shownActionIds: string[]; // unique
  rejectedActionIds: string[]; // unique
  pendingRecommendation: {
    recommendationId: string;
    requestId: string;
    placement: Placement;
    actionIds: string[]; // 1..4, unique
    cartRevision: string;
    traceRef: string;
    decidedAt: string;
  } | null;
  recordedOutcomeEventIds: string[]; // unique
  nextEligiblePlacement:
    | 'starter'
    | 'modifier_upsell'
    | 'smart_cross_sell'
    | null;
}

interface RecommendationImpressionRequest {
  schemaVersion: 'kfc-recommendation-event-v1';
  eventId: string;
  occurredAt: string;
  assistantTurnId: string;
  attachmentId: string;
  renderedActions: Array<{
    actionId: string;
    position: number; // 1..4
  }>; // 1..4, action IDs and positions unique
  cartRevision: string;
  actionDigest: string; // lowercase SHA-256
}

interface RecommendationOutcomeRequest {
  schemaVersion: 'kfc-recommendation-event-v1';
  eventId: string;
  eventType:
    | 'selected'
    | 'explicitly_dismissed'
    | 'ignored'
    | 'superseded'
    | 'cart_mutation_succeeded'
    | 'cart_mutation_failed'
    | 'checkout_completed'
    | 'order_abandoned'
    | 'order_cancelled';
  occurredAt: string;
  actor: 'customer' | 'agent' | 'system' | 'client';
  actionId: string | null;
  cartRevision: string | null;
  payload: Record<string, JsonValue>;
}
```

All objects and nested objects are strict. IDs reuse existing opaque/action
schemas, Instants reuse the shared canonical UTC schema, JSON values remain
finite, and state arrays reject duplicates. Outcome refinements are exact:

- `starter_eligible` requires next `starter` and no pending recommendation;
- `starter_resolved` requires next `null` and allows only a pending starter;
- `modifier_eligible` requires next `modifier_upsell` and allows the pending
  starter whose successful mutation unlocked it;
- `modifier_pending` requires next `null` and a pending Modifier Upsell;
- `modifier_resolved` requires next `smart_cross_sell` and no pending
  recommendation;
- `smart_cross_sell_eligible` requires next `smart_cross_sell` and no pending
  recommendation;
- `smart_cross_sell_pending` requires next `null` and a pending Smart
  Cross-sell;
- `complete` requires next `null` and no pending recommendation;
- every pending recommendation placement must already occur in
  `attemptedPlacements`;
- `selected`, `cart_mutation_succeeded`, and `cart_mutation_failed` require
  non-null `actionId`;
- `explicitly_dismissed`, `ignored`, and `superseded` allow null action ID;
- checkout/order terminal outcomes require null action ID;
- only mutation outcomes may carry a cart revision different from the
  decision revision; the application service enforces that stored relationship.

- [ ] **Step 1: Add failing shared-contract corpus tests**

Add the three valid examples, addressability checks, strict unknown-field
negatives, duplicate arrays/positions/action IDs, invalid state
stage/next-placement combinations, invalid action digest, and every outcome
action-ID refinement to the existing JSON Schema, Zod, and Pydantic suites.

- [ ] **Step 2: Observe RED**

```bash
cd services/kfc-agent-backend
npx vitest run \
  test/recommendations/json-schema-contract.test.ts \
  test/recommendations/domain-contract.test.ts

cd ../kfc-recommendation-simulator
uv run python -m unittest tests.test_recommendation_contracts -v
```

Expected: the new definitions/parsers are absent.

- [ ] **Step 3: Implement all three projections**

Export:

```ts
parseRecommendationState(value: unknown): RecommendationState
parseRecommendationImpressionRequest(
  value: unknown,
): RecommendationImpressionRequest
parseRecommendationOutcomeRequest(
  value: unknown,
): RecommendationOutcomeRequest
```

Add matching frozen Pydantic models and preserve JSON-integer/non-finite parity.
Do not redefine existing decision or persisted-event fields.

- [ ] **Step 4: Verify**

```bash
cd services/kfc-agent-backend
npx vitest run \
  test/recommendations/json-schema-contract.test.ts \
  test/recommendations/domain-contract.test.ts
npm run check

cd ../kfc-recommendation-simulator
uvx ruff check src tests
uv run python -m compileall -q src tests
uv run python -m unittest tests.test_recommendation_contracts -v
```

- [ ] **Step 5: Commit**

```bash
git add \
  contracts/recommendations/v1 \
  services/kfc-agent-backend/src/recommendations/domain \
  services/kfc-agent-backend/test/recommendations \
  services/kfc-recommendation-simulator/src/kfc_recommendation_simulator/recommendation_contracts.py \
  services/kfc-recommendation-simulator/tests/test_recommendation_contracts.py
git commit -m "feat(kfc): add recommendation state and event ingress contracts"
```

---

### Task 2: Implement the pure durable recommendation state machine

**Files:**

- Create:
  `services/kfc-agent-backend/src/recommendations/state/state-machine.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/state/types.ts`
- Modify:
  `services/kfc-agent-backend/src/agent/agentState.ts`
- Modify:
  `services/kfc-agent-backend/src/agent/agentTurn.ts`
- Modify:
  `services/kfc-agent-backend/src/agent/verifiedState.ts`
- Modify:
  `services/kfc-agent-backend/src/businessPacks/kfcVietnam/kfcVerifiedStateSchema.ts`
- Modify:
  `services/kfc-agent-backend/test/agent/verified-state-projection.test.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/state-machine.test.ts`

**Interfaces:**

```ts
type RecommendationRequestKind = 'proactive' | 'customer_requested';

function initialRecommendationState(
  orderFlowId: string,
): RecommendationState;

function flowForDecision(
  state: RecommendationState,
  placement: Placement,
  requestKind: RecommendationRequestKind,
): RecommendationDecisionContext['flow'];

function applyRecommendationDecision(
  state: RecommendationState,
  response: RecommendationDecisionResponse,
  decisionTime: string,
): RecommendationState;

function applyRecommendationImpression(
  state: RecommendationState,
  event: RecommendationEvent,
): RecommendationState;

function applyRecommendationOutcome(
  state: RecommendationState,
  event: RecommendationEvent,
  displayedActionIds: readonly string[],
): RecommendationState;
```

Rules:

- a new order-flow ID starts at revision `0`, `starter_eligible`, and
  `nextEligiblePlacement: 'starter'`;
- every material transition increments revision exactly once;
- a proactive placement already attempted is never reopened;
- customer-requested decisions after `complete` use engine flow `complete`,
  exclude shown/rejected actions, and leave proactive stage/next placement
  unchanged;
- a valid starter decision moves to `starter_resolved`; its recommended action
  remains pending until dismissal/ignore or cart mutation;
- starter `cart_mutation_succeeded` moves to `modifier_eligible`;
- a recommended modifier moves to `modifier_pending`; empty/suppressed moves
  through resolved to `smart_cross_sell_eligible`;
- selected/dismissed/ignored/superseded modifier moves to
  `smart_cross_sell_eligible`;
- a recommended Smart result moves to `smart_cross_sell_pending`;
  empty/suppressed or selected/dismissed/ignored/superseded moves to `complete`;
- attachment-level dismissal adds every displayed action ID to
  `rejectedActionIds`; ignored adds none;
- impressions add rendered actions to `shownActionIds`;
- duplicate outcome event IDs return byte-equivalent state without increment;
- state functions never inspect customer prose or current time.

Extend `AgentState` and `VerifiedStateSnapshot` with optional
`recommendationState`, and add the strict schema to
`kfcVerifiedStateSnapshotSchema`. Keep KFC pack state schema version `1`; this
is an additive optional field within the existing pack-owned schema.

- [ ] **Step 1: Write failing direct transition and projection tests**

Use one small test per transition, duplicate, wrong-stage, customer-requested,
shown/rejected, and revision rule. Add a pack-envelope round trip proving the
new field persists and old envelopes without it still parse.

- [ ] **Step 2: Observe RED**

```bash
cd services/kfc-agent-backend
npx vitest run \
  test/recommendations/state-machine.test.ts \
  test/agent/verified-state-projection.test.ts
```

- [ ] **Step 3: Implement the pure state machine and projection**

Use `parseRecommendationState` at every public persistence boundary. Return new
objects; never mutate the input state or its arrays.

- [ ] **Step 4: Verify**

```bash
npx vitest run \
  test/recommendations/state-machine.test.ts \
  test/agent/verified-state-projection.test.ts
npm run check
npm test
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/src/recommendations/state \
  services/kfc-agent-backend/src/agent \
  services/kfc-agent-backend/src/businessPacks/kfcVietnam/kfcVerifiedStateSchema.ts \
  services/kfc-agent-backend/test/recommendations/state-machine.test.ts \
  services/kfc-agent-backend/test/agent/verified-state-projection.test.ts
git commit -m "feat(kfc): add durable recommendation state machine"
```

---

### Task 3: Add D1 migrations, demo history, and atomic recommendation persistence

**Files:**

- Create:
  `services/kfc-agent-backend/migrations/0024_recommendation_events.sql`
- Create:
  `services/kfc-agent-backend/migrations/0025_recommendation_demo_customer_history.sql`
- Create:
  `services/kfc-agent-backend/src/recommendations/persistence/types.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/persistence/repository.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/history/repository.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/history/stored-demo-history-repository.ts`
- Modify:
  `services/kfc-agent-backend/src/persistence/contracts.ts`
- Modify:
  `services/kfc-agent-backend/src/persistence/memoryStore.ts`
- Create:
  `services/kfc-agent-backend/src/persistence/d1StoreRecommendationOperations.ts`
- Modify:
  `services/kfc-agent-backend/src/persistence/d1StoreAgentOperations.ts`
- Modify:
  `services/kfc-agent-backend/src/persistence/d1StoreSupport.ts`
- Create:
  `services/kfc-agent-backend/test/persistence/d1-migration-0024.test.ts`
- Create:
  `services/kfc-agent-backend/test/persistence/d1-migration-0025.test.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/repository-contract.test.ts`

**Migration contract:**

`0024_recommendation_events.sql` creates:

```sql
recommendation_request_reservations (
  session_id, idempotency_key, request_id, request_fingerprint,
  status, owner_token, response_json, technical_json,
  recommendation_id, created_at, completed_at,
  PRIMARY KEY (session_id, idempotency_key),
  UNIQUE (request_id)
)

recommendation_decisions (
  recommendation_id PRIMARY KEY, request_id UNIQUE, order_flow_id, session_id,
  placement, response_json, technical_json, action_digest,
  request_fingerprint, state_revision_before, state_revision_after, recorded_at
)

recommendation_events (
  event_id PRIMARY KEY, event_fingerprint, schema_version, event_type,
  recommendation_id, request_id, order_flow_id, session_id, placement,
  occurred_at, recorded_at, actor, action_id, cart_revision,
  version_bindings_json, payload_json
)
```

Add the accepted indexes on order flow, recommendation, and session, each
ordered by `(occurred_at, event_id)`. Add strict checks for schema versions,
finite JSON via application parsing, reservation status, lowercase digests,
and state revision monotonicity. `0025` creates the accepted mock-only customer
history table exactly and no production identity table.

**Persistence port:**

```ts
interface RecommendationDecisionRecord {
  request: RecommendationDecisionRequest;
  response: RecommendationDecisionResponse;
  technical: RecommendationDecisionTechnicalEvidence;
  requestFingerprint: string;
  actionDigest: string;
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  recordedAt: string;
}

interface RecommendationPersistence {
  reserveRecommendationDecision(input: {
    sessionId: string;
    idempotencyKey: string;
    requestId: string;
    requestFingerprint: string;
    ownerToken: string;
    createdAt: string;
  }): Promise<
    | { status: 'reserved' }
    | { status: 'replay'; record: RecommendationDecisionRecord }
    | { status: 'pending' }
    | { status: 'conflict' }
  >;

  commitRecommendationDecision(input: {
    ownerToken: string;
    expectedPackStateDigest: string | null;
    nextPackState: PackStateEnvelope;
    record: RecommendationDecisionRecord;
    events: readonly RecommendationEvent[];
  }): Promise<
    | { status: 'committed' | 'replay'; record: RecommendationDecisionRecord }
    | { status: 'stale' }
  >;

  appendRecommendationEvent(input: {
    eventFingerprint: string;
    event: RecommendationEvent;
    expectedPackStateDigest: string;
    nextPackState: PackStateEnvelope;
  }): Promise<
    | { status: 'recorded' | 'replay'; event: RecommendationEvent }
    | { status: 'conflict' | 'stale' }
  >;

  getRecommendationDecision(
    recommendationId: string,
  ): Promise<RecommendationDecisionRecord | undefined>;
  getRecommendationDecisionByRequest(
    requestId: string,
  ): Promise<RecommendationDecisionRecord | undefined>;
  listRecommendationEvents(input: {
    orderFlowId?: string;
    recommendationId?: string;
    sessionId?: string;
  }): Promise<RecommendationEvent[]>;
  latestRecommendationDecisionForOrderFlow(
    orderFlowId: string,
  ): Promise<RecommendationDecisionRecord | undefined>;
  getRecommendationDemoCustomerHistory(
    verifiedCustomerRef: string,
  ): Promise<RecommendationDemoCustomerHistoryRecord | undefined>;
}
```

`RecommendationDecisionRecord` stores strictly parsed request, response,
technical evidence, action digest, canonical fingerprints, state revisions,
and `recordedAt`. It never stores raw customer prose.

Memory and D1 implementations atomically update the KFC
`pack_state_projections` envelope together with decision/events. D1 uses one
`db.batch` transaction with:

1. an exact expected-envelope digest predicate;
2. decision/event inserts conditional on that successful new envelope and
   owned reservation;
3. reservation completion last; and
4. post-batch reads to distinguish committed/replay/stale.

Do not implement this as `putPackState()` followed by independent inserts.

**Demo customer history:**

```ts
interface RecommendationDemoCustomerHistoryRecord {
  verifiedCustomerRef: string;
  fixtureLabel: string;
  linked: boolean;
  completedOrders: NonNullable<
    RecommendationDecisionContext['customerHistory']
  >['completedOrders'];
  favoriteSellableItemIds: string[];
  updatedAt: string;
}

interface CustomerHistoryRepository {
  load(
    verifiedCustomerRef: string,
  ): Promise<RecommendationDemoCustomerHistoryRecord | null>;
}
```

Seed:

- `demo-returning-linked`: linked, clearly labelled synthetic POC returning
  customer, completed real-item orders including `20751`;
- `demo-linked-zero-history`: linked, no completed orders;
- `demo-anonymous-unlinked`: unlinked, no completed orders.

All fixture labels and repository docs say mock/synthetic POC. Unknown and
unlinked refs produce `customerHistory: null`.

`MemoryStore` and `D1Store` implement both `ConversationStore` and
`RecommendationPersistence`; there is no second state repository.
`StoredDemoCustomerHistoryRepository` is the application-facing
`CustomerHistoryRepository` adapter over
`getRecommendationDemoCustomerHistory()`. MemoryStore seeds its private map;
D1Store initializes the three rows with `INSERT OR IGNORE`.

- [ ] **Step 1: Write failing migration and shared repository contract tests**

Run the same idempotency, changed-fingerprint conflict, pending duplicate,
request-ID conflict, atomic state/decision/event commit, stale CAS, event
replay/conflict, chronological list, strict read parsing, and seeded-history
cases against MemoryStore and SQLite D1.

- [ ] **Step 2: Observe RED**

```bash
npx vitest run \
  test/persistence/d1-migration-0024.test.ts \
  test/persistence/d1-migration-0025.test.ts \
  test/recommendations/repository-contract.test.ts
```

- [ ] **Step 3: Implement migrations and both stores**

Insert `D1StoreRecommendationOperations` into the existing inheritance chain
between conversation operations and agent operations. Keep generic
conversation methods stable.

- [ ] **Step 4: Verify**

```bash
npx vitest run \
  test/persistence/d1-migration-0024.test.ts \
  test/persistence/d1-migration-0025.test.ts \
  test/recommendations/repository-contract.test.ts \
  test/persistence/storage-boundary.test.ts
npm run check
npm test
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/migrations/0024_recommendation_events.sql \
  services/kfc-agent-backend/migrations/0025_recommendation_demo_customer_history.sql \
  services/kfc-agent-backend/src/recommendations/persistence \
  services/kfc-agent-backend/src/recommendations/history \
  services/kfc-agent-backend/src/persistence \
  services/kfc-agent-backend/test/persistence \
  services/kfc-agent-backend/test/recommendations/repository-contract.test.ts
git commit -m "feat(kfc): add durable recommendation persistence"
```

---

### Task 4: Compose the stateful recommendation application service

**Files:**

- Create:
  `services/kfc-agent-backend/src/recommendations/application/service-types.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/application/recommendation-service.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/application/context-factory.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/application/inspection-service.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/recommendation-service.test.ts`

**Interfaces:**

```ts
interface RecommendationApplicationService {
  decide(input: {
    request: RecommendationDecisionRequest;
    requestKind?: 'proactive' | 'customer_requested';
    trusted?: {
      parentCartLineId?: string | null;
      remainingBudgetVnd?: number | null;
      verifiedCohorts?: string[];
      verifiedDietaryEvidence?: {
        evidenceId: string;
        excludedSellableItemIds: string[];
      } | null;
    };
  }): Promise<
    | { status: 'decided' | 'replay'; response: RecommendationDecisionResponse }
    | { status: 'pending' | 'idempotency_conflict' | 'state_conflict' }
  >;

  recordImpression(
    recommendationId: string,
    request: RecommendationImpressionRequest,
  ): Promise<EventApplicationResult>;

  recordOutcome(
    recommendationId: string,
    request: RecommendationOutcomeRequest,
  ): Promise<EventApplicationResult>;
}

type EventApplicationResult =
  | {
      status: 'recorded' | 'replay';
      event: RecommendationEvent;
    }
  | {
      status:
        | 'not_found'
        | 'idempotency_conflict'
        | 'state_conflict'
        | 'stale_recommendation'
        | 'cart_revision_conflict'
        | 'render_binding_conflict';
    };
```

The application service:

1. strictly parses input;
2. canonicalizes and fingerprints it through the existing SHA-256 helper;
3. reserves idempotency before engine work;
4. loads and validates the KFC pack envelope;
5. initializes or reads `RecommendationState`;
6. loads linked demo history and server context;
7. resolves trusted Modifier parent from the internal override or from the
   pending starter decision plus current cart;
8. calls the pure engine;
9. applies the pure state transition;
10. creates server-authored `decision_requested` and `decision_completed`
    events with a server clock;
11. atomically commits state, decision, and events; and
12. returns only the customer response.

Decision event IDs are deterministic and replay-stable:

```text
recommendation-event:<first 24 hex of
  digest(requestId + ":" + eventType)>
```

Both decision events bind the final response version bindings; the requested
event payload contains only the canonical request fingerprint and cart
revision, while the completed event payload contains status, source, counts,
action digest, and trace reference.

If the atomic state CAS is stale, return `state_conflict`; do not hide an
automatic retry loop in this POC.

Event handling:

- impression requires a recommended stored response, exact displayed actions
  and positions, exact action digest, matching decision cart revision, and
  nonblank assistant-turn/attachment IDs;
- outcome validates action membership and event-specific nullability;
- event fingerprint conflicts return `idempotency_conflict`;
- replay does not increment state or duplicate events;
- persisted events copy request/recommendation/order-flow/session/placement and
  version bindings from the stored decision, set `recordedAt` from the clock,
  and place ingress-only facts in bounded payload fields;
- state and event are committed atomically.

`RecommendationInspectionService` returns protected projections:

```ts
interface RecommendationInspectionService {
  recommendation(
    recommendationId: string,
  ): Promise<RecommendationInspectionEnvelope | null>;
  orderFlow(
    orderFlowId: string,
  ): Promise<RecommendationOrderFlowInspectionEnvelope | null>;
  session(
    sessionId: string,
  ): Promise<RecommendationSessionInspectionEnvelope>;
}

interface RecommendationInspectionEnvelope {
  schemaVersion: 'kfc-recommendation-inspection-v1';
  recommendation: {
    response: RecommendationDecisionResponse;
    actionDigest: string;
    requestFingerprint: string;
    recordedAt: string;
  };
  technical: RecommendationDecisionTechnicalEvidence;
  state: RecommendationState;
  events: RecommendationEvent[];
  correlations: {
    sessionId: string;
    orderFlowId: string;
    requestId: string;
    recommendationId: string;
    traceRef: string;
  };
}

interface RecommendationOrderFlowInspectionEnvelope {
  schemaVersion: 'kfc-recommendation-order-flow-inspection-v1';
  state: RecommendationState;
  latestDecision: {
    recommendationId: string;
    requestId: string;
    placement: Placement;
    status: RecommendationDecisionResponse['status'];
    traceRef: string;
    recordedAt: string;
  } | null;
  pendingAction: RecommendationState['pendingRecommendation'];
  correlations: {
    sessionId: string;
    orderFlowId: string;
    recommendationId: string | null;
    requestId: string | null;
    traceRef: string | null;
  };
  eventCounts: Partial<Record<RecommendationEvent['eventType'], number>>;
}

type RecommendationSessionInspectionEnvelope =
  RecommendationOrderFlowInspectionEnvelope | {
    schemaVersion: 'kfc-recommendation-order-flow-inspection-v1';
    state: null;
    latestDecision: null;
    pendingAction: null;
    correlations: {
      sessionId: string;
      orderFlowId: null;
      recommendationId: null;
      requestId: null;
      traceRef: null;
    };
    eventCounts: {};
  };
```

The order-flow state envelope contains current state, latest decision summary,
pending recommendation, correlations, and event counts. It does not include
raw customer history, prose, credentials, payment/contact data, or hidden model
reasoning.

- [ ] **Step 1: Write failing application-service tests**

Cover anonymous Local Favorite, linked returning For You, starter mutation to
Modifier, Modifier dismissal to Smart, Smart completion, explicit
customer-requested decision after completion without reopening stages,
once-only attempts, decision replay/conflict, event replay/conflict,
wrong-cart/stale/render mismatch rejection, no client-authored recorded time,
and protected projection redaction.

- [ ] **Step 2: Observe RED**

```bash
npx vitest run test/recommendations/recommendation-service.test.ts
```

- [ ] **Step 3: Implement service, context factory, and inspection projection**

Use `createBundledRecommendationDecisionEngine()` only in the POC wiring
factory. The service itself receives the decision engine, persistence,
history, context source, pack reference/parser, and clock as ports.

- [ ] **Step 4: Verify**

```bash
npx vitest run \
  test/recommendations/recommendation-service.test.ts \
  test/recommendations/decision-engine.test.ts \
  test/recommendations/state-machine.test.ts \
  test/recommendations/repository-contract.test.ts
npm run check
npm test
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/src/recommendations/application \
  services/kfc-agent-backend/test/recommendations/recommendation-service.test.ts
git commit -m "feat(kfc): add stateful recommendation service"
```

---

### Task 5: Expose Fastify and Worker recommendation APIs

**Files:**

- Create:
  `services/kfc-agent-backend/src/api/routeRecommendationHandlers.ts`
- Modify:
  `services/kfc-agent-backend/src/api/routeHandlerContracts.ts`
- Modify:
  `services/kfc-agent-backend/src/api/routeHandlerContext.ts`
- Modify:
  `services/kfc-agent-backend/src/api/routeHandlers.ts`
- Modify:
  `services/kfc-agent-backend/src/api/routes.ts`
- Modify:
  `services/kfc-agent-backend/src/api/serverOptions.ts`
- Modify:
  `services/kfc-agent-backend/src/workerRouteOptions.ts`
- Modify:
  `services/kfc-agent-backend/src/worker.ts`
- Create:
  `services/kfc-agent-backend/test/api/recommendation-routes.test.ts`
- Create:
  `services/kfc-agent-backend/test/worker/recommendation-route-parity.test.ts`

**Routes and responses:**

```text
POST /v1/recommendations/decide
  200 canonical RecommendationDecisionResponse
  400 invalid_recommendation_request
  409 recommendation_idempotency_conflict | recommendation_state_conflict
  425 recommendation_request_pending

POST /v1/recommendations/:recommendationId/impressions
POST /v1/recommendations/:recommendationId/outcomes
  201 { event, deduplicated: false }
  200 { event, deduplicated: true }
  400 invalid_recommendation_impression|outcome
  404 recommendation_not_found
  409 recommendation_event_conflict | stale_recommendation |
      recommendation_cart_revision_conflict |
      recommendation_render_binding_conflict

GET /admin/recommendations/:recommendationId/inspection
GET /admin/recommendations/order-flows/:orderFlowId/state
  existing demo-admin authorization required
```

Add this factory to `RouteOptions`:

```ts
interface RecommendationRouteServicesFactory {
  create(
    store: ConversationStore & RecommendationPersistence,
  ): {
    application: RecommendationApplicationService;
    inspection: RecommendationInspectionService;
  };
}

recommendations?: RecommendationRouteServicesFactory;
```

`createRouteHandlers()` resolves the existing store first, then calls this
factory exactly once. Unconfigured recommendation routes return `503
recommendation_service_not_configured`, never a fake response.

Node demo wiring supplies the bundled factory; its default MemoryStore already
contains the clearly labelled demo history. Worker wiring supplies the same
factory against the existing D1Store/DB and server timezone. Do not create a
second D1 connection or state store.

Fastify and Worker must map the same handler results byte-for-byte. The Worker
must apply the existing demo-admin header check to both new `/admin/` reads.
Public routes do not expose technical evidence or accept an admin-output flag.

- [ ] **Step 1: Write failing Fastify and Worker route-parity tests**

Use real MemoryStore/SQLite D1 services. Cover every status mapping, decision
replay byte equality, event dedupe, unconfigured `503`, admin `401/503/200`,
and absence of `technical`, `customerHistory`, and eligibility arrays from the
public response.

- [ ] **Step 2: Observe RED**

```bash
npx vitest run \
  test/api/recommendation-routes.test.ts \
  test/worker/recommendation-route-parity.test.ts
```

- [ ] **Step 3: Implement handlers and both transport adapters**

Keep route parsing/error mapping in `routeRecommendationHandlers.ts`.
Do not put recommendation state logic in Fastify or `worker.ts`.

- [ ] **Step 4: Verify**

```bash
npx vitest run \
  test/api/recommendation-routes.test.ts \
  test/worker/recommendation-route-parity.test.ts
npm run check
npm test
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/src/api \
  services/kfc-agent-backend/src/worker.ts \
  services/kfc-agent-backend/src/workerRouteOptions.ts \
  services/kfc-agent-backend/test/api/recommendation-routes.test.ts \
  services/kfc-agent-backend/test/worker/recommendation-route-parity.test.ts
git commit -m "feat(kfc): expose durable recommendation APIs"
```

---

### Task 6: Extend the protected KFC proof envelope

**Files:**

- Modify:
  `services/kfc-agent-backend/src/api/routeSystemHandlers.ts`
- Modify:
  `services/kfc-agent-backend/src/api/routeHandlerContracts.ts`
- Create:
  `services/kfc-agent-backend/test/api/recommendation-proof-envelope.test.ts`

**Behavior:**

When recommendation services are configured,
`GET /admin/proof/kfc/sessions/:sessionId/envelope` adds:

```ts
recommendations: {
  state: RecommendationState | null;
  latestDecision: {
    recommendationId: string;
    requestId: string;
    placement: Placement;
    status: RecommendationDecisionResponse['status'];
    traceRef: string;
    recordedAt: string;
  } | null;
  pendingAction: RecommendationState['pendingRecommendation'];
  correlations: {
    orderFlowId: string | null;
    recommendationId: string | null;
    requestId: string | null;
    traceRef: string | null;
  };
  eventCounts: Partial<Record<RecommendationEvent['eventType'], number>>;
}
```

This is a protected state/evidence view, not a dashboard implementation. Full
technical ranking remains at the recommendation-specific inspection route;
full append-only history remains available through D1
`recommendation_events`. If no recommendation flow exists, return the explicit
null/zero projection and do not mark the overall KFC proof incomplete.

- [ ] **Step 1: Write failing proof-envelope tests**

Prove the envelope after each flagship transition, its correlation to the
stored decision/events, empty-state behavior, admin authorization via the
registered route, and redaction of customer history/prose/private data.

- [ ] **Step 2: Observe RED**

```bash
npx vitest run test/api/recommendation-proof-envelope.test.ts
```

- [ ] **Step 3: Add the protected projection**

Delegate to `RecommendationInspectionService`; do not query D1 or parse state
inside the route handler.

- [ ] **Step 4: Verify all Phase 3 gates**

```bash
cd services/kfc-agent-backend
npx vitest run \
  test/recommendations/state-machine.test.ts \
  test/recommendations/repository-contract.test.ts \
  test/recommendations/recommendation-service.test.ts \
  test/api/recommendation-routes.test.ts \
  test/worker/recommendation-route-parity.test.ts \
  test/api/recommendation-proof-envelope.test.ts
npm run check
npm test
git diff --check

cd ../kfc-recommendation-simulator
uvx ruff check src tests
uv run python -m compileall -q src tests
uv run python -m unittest discover -s tests -v
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/src/api/routeSystemHandlers.ts \
  services/kfc-agent-backend/src/api/routeHandlerContracts.ts \
  services/kfc-agent-backend/test/api/recommendation-proof-envelope.test.ts
git commit -m "feat(kfc): expose protected recommendation state"
```

---

## Plan Completion Gate

This plan is complete only when:

- the shared JSON Schema, Zod, and Pydantic projections accept the same strict
  state/impression/outcome corpus;
- KFC pack state durably carries one strict recommendation state;
- all accepted proactive stage transitions and once-only rules pass direct
  pure tests;
- MemoryStore and SQLite D1 pass the same idempotency, replay, event, state-CAS,
  and seeded-history contract;
- decision/event writes and pack-state changes are atomic;
- public Fastify and Worker routes are behaviorally identical and never expose
  technical evidence;
- protected routes require the existing demo-admin authorization and show
  state, latest decision, pending action, correlations, and technical evidence;
- no candidate, history, stage, `recordedAt`, policy fact, or technical result
  is client-authored;
- all backend checks/tests, simulator checks/tests, and `git diff --check`
  pass; and
- there is still no agent tool/prompt, GenUI/Flutter, ML shadow inference,
  LangSmith span, or scenario harness implementation.

After this plan, write the separate ML shadow-package plan. Agent/tool/GenUI
integration remains after the ML package so the protected evidence path can
show baseline and shadow together without changing customer serving.
