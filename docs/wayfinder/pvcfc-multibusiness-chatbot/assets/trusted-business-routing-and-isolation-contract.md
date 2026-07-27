# Trusted Business Routing And Isolation Contract

## Decision

A request enters the Shared Assistant Runtime only after an authenticated ingress binding resolves an immutable **Resolved Business Context**. That context, not a request field or model decision, selects the Business Pack, Provider/Adapter bindings, credentials, storage namespace, cache namespace, and observability scope for the entire run.

KFC Vietnam and PVCFC may share processes and physical infrastructure, but every logical key and authorization decision must include a server-derived Business boundary. A raw `sessionId`, customer ID, channel thread ID, checkpoint thread, cache key, dataset/scenario ID, or Provider entity ID is never globally unique by itself.

The safe default is fail closed: if a binding is unknown, ambiguous, disabled, mismatched, expired, or missing required configuration, the runtime performs no model call, state hydration, Provider call, cache read, or customer-facing delivery.

## Current-state findings

The KFC code already has a valuable fail-closed personalized-access contract:

- `CustomerAccessContext` is explicitly trusted runtime authority and carries authentication evidence, subject binding, session reference, account-link state, and scopes (`services/kfc-agent-backend/src/domain/types.ts:26-39`).
- `authorizeCustomerAccess` verifies authentication, evidence expiry, KFC subject binding, exact session/customer equality, external-channel account linking, and scope before private access (`services/kfc-agent-backend/src/security/customerAccessContext.ts:58-130`).
- An absent context becomes unauthenticated, unverified, and scope-empty rather than permissive (`services/kfc-agent-backend/src/security/customerAccessContext.ts:33-55`).

It is not yet safe as a multi-Business boundary:

- Business identity is hard-coded as `tenantScope: "kfc-vietnam"`, the subject is named `kfcSubjectRef`, and the first-party surface defaults to `kfc-app-chat` (`services/kfc-agent-backend/src/security/customerAccessContext.ts:33-55`, `services/kfc-agent-backend/src/api/routeCommerceRuntime.ts:361-384`).
- Channel session IDs are derived only from channel and external thread, while first-party events can use the external thread directly (`services/kfc-agent-backend/src/session/sessionContext.ts:6-13`).
- LangGraph uses raw `sessionId` as `thread_id` and only `runId` in `checkpoint_ns` (`services/kfc-agent-backend/src/session/sessionContext.ts:15-23`). Both D1 and PostgreSQL checkpoint lookup therefore trust those unscoped values.
- Persistence contracts and in-memory maps index events, turns, controls, deliveries, runs, and irreversible operations by session/run/request identifiers without a Business key (`services/kfc-agent-backend/src/persistence/contracts.ts:18-31`, `services/kfc-agent-backend/src/persistence/contracts.ts:57-84`, `services/kfc-agent-backend/src/persistence/contracts.ts:146-168`, `services/kfc-agent-backend/src/persistence/memoryStore.ts:49-70`). Resetting a session removes all matching records by raw session ID (`services/kfc-agent-backend/src/persistence/memoryStore.ts:74-101`).
- Environment configuration has one global database, model configuration, LangSmith project, channel credential set, and KFC Provider credential set (`services/kfc-agent-backend/src/config/env.ts:3-60`).
- The D1 checkpoint primary lookup is `thread_id + checkpoint_ns + checkpoint_id`, with no independent Business column or validator (`services/kfc-agent-backend/src/persistence/d1CheckpointSaver.ts:41-73`, `services/kfc-agent-backend/src/persistence/d1CheckpointSaver.ts:108-130`).

These are migration risks, not evidence of an existing exploit. The implementation plan must add Business scope before registering a second Pack.

## Trust hierarchy

Business identity is resolved from an authenticated server-side binding in this order:

1. **Deployment/host binding** — a first-party hostname, service route, app client, or deployment is statically bound to one Business.
2. **Verified channel asset binding** — a Messenger page/app, Zalo OA/app, or equivalent channel asset is authenticated with the credentials belonging to one configured Business binding.
3. **Signed internal invocation** — workers, evaluators, operator tools, and scheduled jobs use a signed service principal authorized for one Business/environment and purpose.
4. **Explicit development/test binding** — a local-only harness selects a configured development binding outside customer payloads and is visibly non-production.

The following are never authority:

- message text, prompt instructions, model output, tool arguments, or retrieved web content;
- an arbitrary `businessId`, tenant, Pack ID, Provider ID, scenario ID, or namespace in request JSON;
- an unverified `Host`, page/OA identifier, callback parameter, customer ID, or external thread ID;
- a database record found by an unscoped ID;
- a fallback to the only currently registered Pack.

A public endpoint may accept a Business hint only to reject a mismatch or locate the binding record to authenticate. The authenticated binding remains the authority.

## Core contracts

### 1. Ingress binding

```text
IngressBinding
  bindingId
  businessId
  environmentId
  packRef
  channelKind
  authenticatedAssetRef        # host/app/page/OA/service principal
  credentialSetRef             # opaque secret-manager reference
  providerBindingSetRef
  configurationRevision
  status: enabled | disabled
  allowedOrigins / callback audience
```

The registry is operator-controlled configuration. `bindingId` is immutable and globally unique. Changing its Business requires creating a new binding, not editing an active one in place. Credentials are referenced, not embedded in Pack descriptors, requests, state, traces, or model context.

Ingress authentication happens before normalization into a customer event:

1. identify a candidate binding from route/host/asset metadata;
2. load only that binding's verification material;
3. verify signature/token, audience, origin, timestamp, and replay/idempotency requirements;
4. verify the authenticated asset matches the binding;
5. issue a Resolved Business Context;
6. derive internal scoped identities;
7. only then read state or invoke the Pack/runtime.

Channel multiplexers may share one public process, but they must not try credentials from every Business and accept whichever succeeds. Candidate selection must be deterministic and bounded by non-secret route/asset metadata, and failure must not reveal other configured Businesses.

### 2. Resolved Business Context

```text
ResolvedBusinessContext
  businessId
  environmentId
  packId / packVersion
  bindingId / configurationRevision
  channelKind / authenticatedAssetRef
  businessSessionRef
  surfaceSubjectRef
  optional businessCustomerSubjectRef
  authentication evidence / expiry
  account-link and subject-binding state
  authorized capability scopes
  providerBindingSetRef
  storageNamespace
  cacheNamespace
  observabilityScope
  issuedAt / expiresAt
  integrity token or in-process trusted marker
```

Properties:

- Created by trusted ingress or an authorized internal caller; never deserialized from public request JSON as authority.
- Immutable for a run. A run cannot switch Business, environment, Pack, or Provider binding set.
- Passed explicitly through runtime phases; not recovered from ambient mutable globals.
- Checked against the session snapshot, Pack descriptor, Provider binding, confirmation, capability result, and outbound channel binding.
- Reduced before model use: the model may receive allowed Business terminology and authorized capability availability, but not secret references, raw auth evidence, or a mutable identity object.
- Expiry is checked before private hydration and again before consequential capability execution.

### 3. Customer access context

Business routing and customer authorization are separate decisions.

```text
BusinessCustomerAccessContext
  businessId / environmentId / bindingId
  businessSessionRef
  surfaceSubjectRef
  optional businessCustomerSubjectRef
  authentication and subject-binding evidence
  channel account-link state
  namespaced authorized scopes
```

A valid Business binding permits public Business behavior; it does not grant access to a customer's private records. Private capability authorization additionally requires:

- current verified authentication evidence for that Business and environment;
- a verified binding from surface subject to Business customer subject where applicable;
- exact session and subject match;
- the capability's required namespaced scope;
- Pack and Provider binding compatibility;
- synthetic scenario authority when a PVCFC demo capability is synthetic.

Scopes are qualified by Business capability semantics, for example `kfc-vietnam:order.read` or `pvcfc:synthetic-order.read`; a generic `order:read` must not authorize another Pack by coincidence. Public knowledge scopes may be implicit only when the Pack declares the capability public and the evidence audience is public.

### 4. Scoped identities and keys

All internal keys derive from a canonical scope tuple:

```text
BusinessScope = businessId / environmentId / bindingId
SessionKey   = BusinessScope / channelKind / stable external-thread digest
RunKey       = SessionKey / runId
StateKey     = SessionKey / packId / domain-state schema lineage
CheckpointKey = BusinessScope / packId / session / run namespace
CacheKey     = BusinessScope / packVersion / providerBinding / capability / authority / input digest
```

Use opaque internal IDs or composite database keys. Do not rely on string prefixes alone as the only control; storage APIs require a `BusinessScope` parameter and verify stored scope on every read/write.

The following must be Business-scoped:

- transcripts, events, profiles, customer runs, agent runs, pending turns, session controls, handoffs, feedback, and dashboard projections;
- LangGraph threads, checkpoint namespaces, pending writes, pause records, and confirmation resumes;
- idempotency keys, webhook deliveries, external-event indexes, replay windows, irreversible reservations, receipts, and reconciliation jobs;
- knowledge indexes, embeddings/vector collections, retrieval caches, catalog observations, Provider response caches, and model semantic caches;
- scenario instances, dataset identities, fixture corpora, generated entities, and synthetic customer records;
- media allowlists, uploaded files, signed URLs, and object-storage paths;
- rate limits, quotas, circuit breakers, feature flags, and rollout cohorts;
- traces, logs, metrics, alerts, dashboards, exports, and evaluation artifacts.

Global cache entries are permitted only for truly public, Business-independent runtime artifacts such as a model tokenizer. Business public-web content is still Business-scoped because its authority and claims belong to one Pack.

### 5. Configuration and credentials

```text
BusinessDeploymentConfig
  businessId / environmentId
  active packRef
  ingress bindings
  provider binding set
  model policy and allowed deployments
  storage/cache/observability namespace policy
  feature/rollout policy
  public base URLs and media policy
  secret references
  revision / activation time
```

Rules:

- Configuration is schema-validated at startup/activation and immutable by revision.
- Pack requirements are matched against configured Provider ports before traffic is enabled.
- Credentials are loaded by opaque reference for the active Business/environment/Provider binding and are never returned to the Pack, model, trace, or client response.
- Adapters receive a scoped credential handle, not the entire process environment.
- Production and sandbox use distinct credential, Provider, state, cache, evidence, and scenario namespaces.
- Missing PVCFC configuration cannot fall back to KFC credentials, Providers, fixtures, URLs, or channel accounts.
- Shared model credentials may be used only through a runtime service with per-Business policy, quotas, redaction, and attribution; they do not weaken data isolation.
- Secret rotation creates a new credential/configuration revision while allowing bounded in-flight runs to finish under their recorded revision when safe.

The current flat environment schema is acceptable for a single KFC deployment but must become runtime-global configuration plus a validated registry of Business deployment configurations before multi-Business activation (`services/kfc-agent-backend/src/config/env.ts:3-60`).

### 6. Provider/Adapter binding isolation

The runtime resolves a capability in this sequence:

```text
Resolved Business Context
  -> matching Business Pack capability declaration
  -> matching environment-specific Provider binding
  -> matching Adapter implementation
  -> scoped credential/configuration handle
```

Every result repeats `businessId`, environment, Provider binding, Adapter, configuration revision, authority kind, and evidence identity. The runtime rejects a result whose scope differs from the call. Adapters cannot select Business based on input payload, use cross-Business fallback pools, or return unscoped cache entries.

A circuit breaker or Provider outage is keyed by Business/environment/Provider binding. PVCFC synthetic Providers are never fallback implementations for a failing authoritative Provider; they are separate declared bindings with synthetic authority and scenario scope.

Issue 05 defines the full Provider/Adapter and provenance schemas.

### 7. Persistence and checkpoint isolation

Storage interfaces change from methods such as `listEvents(sessionId)` to methods requiring a trusted scope plus an internal ID, for example `listEvents(scope, sessionRef)`. The repository may use shared physical tables, but rows and unique constraints include Business/environment scope.

Required controls:

- composite primary/unique keys include Business scope for sessions, external events, runs, confirmations, irreversible operations, and checkpoints;
- every foreign key remains within the same Business/environment;
- repository/store objects are constructed with a fixed scope or require it on every operation;
- database row-level security or equivalent repository assertions provide defense in depth where supported;
- reset/delete/export operations require scoped authorization and cannot act on raw session ID alone;
- checkpoints store Business, environment, Pack/version, and configuration revision in both key and validated metadata;
- hydration rejects snapshot/context mismatch before deserializing Pack state;
- backups, retention jobs, migrations, and analytics exports preserve the scope fields;
- tests deliberately reuse identical external session/customer/request IDs across KFC and PVCFC and prove no collision.

For LangGraph, `thread_id` should be an opaque scoped session key and `checkpoint_ns` should include Pack/version plus a scoped run identity. A run ID alone is insufficient (`services/kfc-agent-backend/src/session/sessionContext.ts:15-23`).

### 8. Cache and retrieval isolation

A cache lookup includes:

- Business/environment and Pack version;
- Provider binding and configuration revision;
- capability/content taxonomy and locale;
- authority class (`public_crawl`, `provider_runtime`, `synthetic`, and so on);
- customer/scenario scope for any non-public data;
- canonical normalized input digest;
- source revision/hash and expiry policy where applicable.

The cache value repeats and validates the scope and authority metadata. A cache miss may call only the already resolved binding. It cannot search another Business's cache or downgrade authority.

PVCFC public-corpus indexes use corpus ID plus artifact/content hashes and never share a collection with KFC content merely because both are public. Customer and synthetic scenario caches are private and require authorized subject/scenario scope.

### 9. Observability, operator, and evaluation isolation

Every event, span, log, metric, dashboard record, and evaluation artifact includes the trusted Business scope and Pack/configuration revision. The runtime adds these attributes; model/Pack fields cannot override them.

Operator access is authorized by Business and environment:

- a KFC operator cannot view or act on PVCFC sessions without an explicit cross-Business role;
- production and sandbox views are separate by default;
- search/export APIs require scope filters server-side, not UI-only filtering;
- handoff actions, AI pause/resume, transcript access, replay, and deletion are audited with actor and scope;
- customer PII, authentication evidence, credentials, Provider payloads, and synthetic limitations follow Pack/provider redaction classifications;
- traces use Business-scoped projects or mandatory immutable scope attributes plus access controls; a single unfiltered global LangSmith project is not an isolation boundary;
- cardinality-safe metrics may aggregate across Businesses only after sensitive labels/payloads are removed and authorization policy permits it.

Evaluation datasets and scenario IDs are Pack-owned. Identical case/session IDs across KFC and PVCFC must remain separate. Production evidence cannot be copied into synthetic tests without an authorized redaction/export process.

### 10. Outbound delivery binding

The runtime delivers only through the channel Adapter associated with the original authenticated binding. Before delivery it checks:

- output Business/session/run matches the active context;
- recipient surface subject matches the authorized session binding;
- channel asset and credentials match `bindingId`;
- response profile/media/action capabilities match that binding;
- run generation is current or carries a valid committed-outcome receipt;
- delivery idempotency key is Business-scoped.

A response generated under KFC context can never be sent through a PVCFC page/OA/app, even if the external user/thread identifier is identical.

## Deployment model

### Recommended production topology

One runtime service may host multiple Packs with:

- an immutable Business binding registry;
- scoped Pack and Adapter registries;
- per-Business/environment configuration and secret references;
- shared databases/caches only through scope-enforcing repositories and composite keys;
- explicit per-Business operational access controls;
- startup and health checks for every enabled binding.

Physical separation remains a supported stronger isolation option. KFC and PVCFC can run in separate processes/accounts/databases while implementing the same contracts. Application behavior must not depend on co-location, and no Pack may communicate through process-global mutable state.

Rollout should first add scope to KFC-only data and prove no behavioral change, then register PVCFC in a disabled/non-customer environment, then run collision/isolation tests before enabling any shared deployment.

### Practical local development

A checked-in non-secret development manifest declares explicit bindings such as:

```text
kfc-local        -> kfc-vietnam / sandbox / KFC fixture or sandbox Providers
pvcfc-local      -> pvcfc / sandbox / public crawl + explicitly synthetic Providers
```

Secrets remain in environment-specific secret stores or developer env files outside version control. Developers select a binding through distinct local hostnames, ports, or a trusted dev launcher that injects an internal signed context. A raw public `businessId` header is allowed only in a test harness that is impossible to enable in production and visibly marks the context as development.

Local stores still use full production-shaped scoped keys. Tests must not rely on separate in-memory store instances as the only isolation proof. There is no implicit default Business: startup may choose an explicit single-Business dev profile, but an unbound request fails.

## Required failure behavior

| Condition | Required behavior |
|---|---|
| Unknown or disabled binding | Reject before state/model access |
| Signature/token valid for a different channel asset | Reject; do not try another Business's credentials |
| Request Business hint differs from binding | Reject and audit mismatch |
| Session/checkpoint scope differs from resolved context | Reject as isolation-integrity failure |
| Pack or Provider binding missing/incompatible | Capability unavailable or deployment unhealthy; never cross-bind |
| Customer auth absent/expired | Permit only declared public capabilities; clear/withhold private state |
| Scope missing | Deny the private capability without leaking whether a record exists |
| Cached/evidence result has mismatched scope or authority | Treat as invalid, audit, and do not answer from it |
| Outbound channel differs from ingress binding | Suppress delivery and raise isolation alert |
| Consequential run loses auth/config freshness | Pause/revalidate or reconcile according to capability policy |

## Isolation verification contract

Before a second Business is enabled, automated tests must prove:

1. Identical external thread, customer, session, run, event, request, and scenario IDs produce distinct scoped records.
2. KFC and PVCFC cannot read, reset, export, checkpoint, resume, cache-hit, deliver, or observe each other's records.
3. Request text and payload attempts to switch Business do not affect Pack/provider selection.
4. Channel credentials and webhook signatures authenticate only their configured binding.
5. A valid customer token for one Business grants no scope in the other.
6. Provider, credential, configuration, and circuit-breaker selection stays within Business/environment.
7. Cache/evidence scope tampering is rejected.
8. Confirmation and irreversible-operation receipts cannot replay across Businesses, environments, sessions, or Pack revisions.
9. Dashboard/search/export and operator actions enforce server-side Business authorization.
10. Local/test shortcuts cannot start in production configuration.
11. KFC's existing customer-visible and safety contracts remain green after scope is added.
12. PVCFC public and synthetic evidence remains visibly distinct and cannot appear as KFC or authoritative PVCFC private state.

## Migration constraints

1. Add `BusinessScope` and resolved binding context while KFC remains the only enabled Pack.
2. Replace raw session/checkpoint/store/cache/idempotency keys with scoped internal keys and migrate KFC rows under `kfc-vietnam` plus the correct environment/binding.
3. Generalize `CustomerAccessContext` names while preserving KFC's current fail-closed checks and customer-visible behavior.
4. Split global configuration into runtime-global and Business deployment configuration; keep current KFC values as the KFC binding.
5. Scope traces, dashboards, exports, fixtures, scenario instances, and evaluation artifacts.
6. Add adversarial collision and cross-binding tests using identical external identifiers.
7. Register PVCFC only after all storage, checkpoint, cache, Provider, and delivery paths require trusted scope.
8. Keep PVCFC private capabilities synthetic and scenario-scoped until authoritative Provider bindings exist.

## Decisions left to later tickets

- Issue 05 owns the exact Adapter result, provenance, freshness, replacement, and fixture schemas.
- Issue 06 owns PVCFC capability scopes, private/synthetic workflows, consent, and escalation semantics.
- Issue 07 owns detailed channel presentation, citation, component, action, media, and localization rules.
- Issue 08 owns executable multi-Business isolation oracles and KFC behavior-compatible migration gates.
- Issue 09 owns concrete schema migrations, modules, rollout slices, infrastructure choices, and rollback procedure.
