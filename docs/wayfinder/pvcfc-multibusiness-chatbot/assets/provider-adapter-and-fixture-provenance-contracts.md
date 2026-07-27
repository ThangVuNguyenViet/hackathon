# Provider, Adapter, And Fixture Provenance Contracts

## Decision

A Business Pack defines typed **Capability Ports** in Business language. A deployment binds each required port to a concrete **Provider Binding**, and an **Adapter** translates between the stable capability contract and that Provider's schemas, credentials, revisions, and failures.

Every call returns a typed result plus a mandatory evidence envelope. Authority, environment, subject/scenario scope, freshness, Provider/Adapter identity, configuration revision, and fixture/runtime origin remain explicit through planning, state, customer claims, traces, persistence, and evaluation.

Fixtures are not a generic substitute for Providers:

- a PVCFC public crawl fixture is evidence of public first-party content as captured at a stated time;
- a synthetic private-capability fixture is authoritative only for its explicitly synthetic scenario instance;
- a KFC baseline fixture is deterministic test evidence, not a current menu or production transaction;
- a configured sandbox Provider is authoritative within that sandbox environment and must not be mislabeled merely because its data is non-production;
- a failed authoritative call never falls back to fabricated success.

## Why the current seams are useful but insufficient

The KFC implementation already has explicit client ports for menu, cart, recommendations, promotions, membership, inventory, stores, fulfillment, content, invoice, OMS, payment, delivery, customer, loyalty, handoff, feedback, and channel transport (`services/kfc-agent-backend/src/clients/interfaces.ts:62-217`). This is the right replaceability shape, but that fixed collection and its payloads are KFC commerce contracts, not a shared multi-Business Provider interface.

Current successful tool results preserve typed values and a trace with exact arguments, result summaries, and `SourceProvenance`; current content evidence carries source URL/file and optional retrieval, approval, audience, and content hash (`services/kfc-agent-backend/src/ordering/types.ts:237-250`, `services/kfc-agent-backend/src/ordering/types.ts:349-377`). However:

- the fixture-mode union conflates runtime authority, crawl seeds, mocks, and test/demo origin;
- provenance is optional on the generic `ToolResult` and has only file/URL/API locators (`services/kfc-agent-backend/src/domain/types.ts:275-286`);
- failures often collapse transport, HTTP, invalid JSON, schema, rejection, and uncertain commit into `errorCode + message` (`services/kfc-agent-backend/src/clients/kfcCommerceGateway.ts:22-51`);
- some gateway responses are accepted as generic `ToolResult<T>` before operation-specific validation (`services/kfc-agent-backend/src/clients/kfcCommerceGateway.ts:22-44`);
- a plain timeout cannot tell the runtime whether an irreversible Provider operation was never dispatched or committed before the response was lost.

The catalog observation is a strong specialized model: it records environment, source URL, Provider fingerprint, observation/expiry, ETag/Last-Modified, SHA-256, and normalized contents (`services/kfc-agent-backend/src/catalog/catalogObservation.ts:99-127`). Fetching validates URL, HTTP status, JSON/schema, computes a canonical digest, and derives expiry (`services/kfc-agent-backend/src/catalog/catalogObservation.ts:237-289`); revalidation rejects environment/Provider changes and detects referenced-item drift (`services/kfc-agent-backend/src/catalog/catalogObservation.ts:292-313`). The shared evidence contract should generalize these properties without turning every Provider into a catalog.

The lifecycle Provider is a strong synthetic-state model: each instance is bound to environment, scenario-definition version, release, catalog observation/hash, customer, session, logical expiry, revision, and durable state (`services/kfc-agent-backend/src/commerce/lifecycleProvider.ts:20-37`). Mutations carry expected revision, idempotency key, request fingerprint, and trace/run/request identity; events distinguish committed, pre-commit fault, post-commit fault, and control outcomes (`services/kfc-agent-backend/src/commerce/lifecycleProvider.ts:47-90`). These bindings must be retained and extended with Business/Provider/authority identity.

## Ownership

| Concern | Business Pack | Shared Assistant Runtime | Adapter | Provider/deployment |
|---|---|---|---|---|
| Capability semantics | Defines name, schemas, side-effect class, policies, permitted claims | Validates and dispatches declaration | Implements exact port | Supplies external operation/data |
| Provider selection | Declares required port and acceptable authority classes | Uses trusted Business context and configured binding | Cannot switch binding | Operator config selects binding/environment |
| Provider schema | Never imported into Pack domain | Never interprets it | Owns validation and translation | Defines external schema/protocol |
| Credentials | Declares need, never sees secret | Supplies scoped opaque handle | Uses only assigned handle | Secret manager/config owns value |
| Result/evidence | Defines evidence sufficiency and domain meaning | Enforces envelope/status/integrity | Produces normalized result/evidence | Supplies revision, receipt, source, status |
| Errors | Defines user policy by normalized category | Enforces retry/uncertainty rules | Maps Provider-specific failures | Produces transport/domain failures |
| State mutation | Defines events/reducer | Appends validated events atomically | Never mutates conversation state | Remains authority for external state |
| Customer prose | Defines claims/projection | Validates evidence references | Never composes final response | Does not control assistant wording |
| Fixtures | Declares allowed purpose/authority/freshness | Pins manifest/version and prevents fallback | Reads fixture through same port semantics | Corpus/generator/scenario is source |

## 1. Capability Port

A port is Pack-owned and stable within its major version:

```text
CapabilityPort<Input, Output>
  capabilityId
  contractVersion
  inputSchema / outputSchema
  operationMode: read | reversible_write | irreversible_write
  requiredAccessScopes
  acceptedAuthorityKinds
  freshnessPolicy
  evidenceRequirements
  confirmation/idempotency/reconciliation policy
  normalized error policy
  state events and customer claims permitted by status
```

Rules:

- Capability IDs are scoped to a Pack, not a global tool union.
- Input/output semantics are Business concepts. Provider request fields, URLs, headers, raw status codes, and credential material do not appear in Pack planning schemas.
- `operationMode` and uncertainty policy are non-optional. An Adapter cannot downgrade an irreversible operation.
- A capability can accept multiple explicitly configured authority kinds only when the Pack defines different truthful behavior for each. For example, PVCFC product knowledge may accept a dated official public corpus; a real customer-order lookup may not accept public or synthetic authority.
- Optional capabilities are declared unavailable at Pack activation when no acceptable binding exists. They are not discovered through failure after model selection.

## 2. Provider Binding

```text
ProviderBinding
  providerBindingId
  businessId / environmentId
  port capability IDs and versions implemented
  providerKind / providerInstanceRef
  adapterId / adapterVersion
  authorityProfile
  configurationRevision
  credentialSetRef
  endpoint/dataset/corpus/scenario family refs
  health and rollout policy
  status: active | draining | disabled
```

A run pins the binding and configuration revision. Replacement traffic may shift only between compatible bindings declared for the same Business/environment and capability contract. In-flight consequential work, confirmations, cached evidence, and reconciliation jobs remain attached to their original binding unless an explicit migration/reconciliation procedure proves equivalence.

The Adapter receives the resolved binding from the runtime; it cannot choose another Business, environment, endpoint, corpus, or fixture based on model/user input. Binding identity is repeated in every result and evidence record and checked by the runtime.

## 3. Adapter contract

An Adapter:

1. validates the normalized capability request and translates it to Provider input;
2. applies scoped authentication, protocol, timeout, and idempotency metadata;
3. validates HTTP/transport and Provider operation status independently;
4. parses and strictly validates the Provider response;
5. translates Provider entities/status into the Pack contract without fabricating missing facts;
6. maps Provider failures into the shared error taxonomy;
7. emits evidence with Provider revisions, receipts, timestamps, source identity, and limitations;
8. returns no final customer prose and performs no conversation-state mutation.

Adapters must preserve enough raw-reference metadata for audit/reconciliation without exposing secrets or unrestricted sensitive payloads. Unknown Provider enum values or partial responses fail validation or map to an explicit partial/unknown result; they are never coerced into a successful known state.

Each Adapter ships contract tests covering:

- valid request/response translation;
- required fields and unknown enum/status behavior;
- all normalized error classes and retry phases;
- evidence completeness and scope match;
- idempotency and reconciliation for writes;
- redaction of credentials and private Provider payloads;
- Provider version/revision drift;
- public, private, sandbox, and synthetic authority behavior it claims to support.

## 4. Capability call envelope

```text
CapabilityCall<Input>
  callId / traceId / runId
  Business/environment/Pack context
  capabilityId / contractVersion
  providerBindingId / configurationRevision
  subject or synthetic scenario scope
  normalized input
  required authority and freshness
  expected external/domain revisions
  idempotency key and request fingerprint when applicable
  confirmation binding when applicable
  deadline / cancellation and reconciliation policy
```

The runtime creates identity, binding, and policy fields; model output can propose only the normalized Pack input. The Adapter rejects a call whose scope, capability version, or binding is incompatible.

## 5. Capability result

```text
CapabilityResult<Output>
  status
  value only when status permits
  normalized error when not succeeded
  evidence[]                         # mandatory, including failures where possible
  Provider receipt/entity/revision refs
  commitState: not_dispatched | not_committed | committed | unknown
  observedAt / effectiveAt / expiresAt
  retry advice bounded by operation policy
  limitations
```

Required statuses:

- `succeeded` — output is schema-valid and the declared evidence requirements are met;
- `rejected` — Provider authoritatively refused a valid operation or policy precondition;
- `not_found` — scoped authority reports no matching entity, without leaking across subjects;
- `conflict` — expected revision/state/idempotency precondition failed;
- `unavailable` — Provider was unavailable before a consequential commit could occur;
- `invalid_response` — response could not satisfy the Adapter contract;
- `outcome_uncertain` — dispatch may have crossed a commit boundary but the outcome is unknown;
- `unauthorized` / `forbidden` — binding or subject lacks authority;
- `unsupported` — active binding does not implement this declared optional operation.

A successful result without required evidence is invalid. A failed result may still carry evidence such as response status, request/receipt reference, Provider revision, and dispatch phase. `outcome_uncertain` blocks blind retry and customer success/failure claims until reconciliation.

## 6. Normalized error taxonomy

```text
CapabilityError
  category
  stableCode
  phase: validation | before_dispatch | dispatched | after_commit | response_validation
  retryability: never | safe_same_request | after_backoff | reconciliation_only
  providerCode / httpStatus when safe
  customerSafeSummaryKey
  operator detail reference
```

Categories:

- `invalid_input`
- `authentication_required`
- `authorization_denied`
- `not_found`
- `conflict_or_stale_precondition`
- `rate_limited`
- `provider_rejected`
- `provider_unavailable`
- `timeout_before_dispatch`
- `outcome_uncertain_after_dispatch`
- `malformed_or_partial_response`
- `contract_version_mismatch`
- `misconfigured_binding`
- `fixture_or_scenario_expired`
- `authority_or_scope_mismatch`

Raw exceptions are captured in restricted operator traces, not returned to the customer/model as trustworthy facts. The Pack maps normalized categories to clarification, refusal, retry, reconciliation, or handoff behavior.

## 7. Evidence envelope

```text
EvidenceEnvelope
  evidenceId
  businessId / environmentId / packRef
  capabilityId / callId / runId
  providerBindingId / providerKind / providerInstanceRef
  adapterId / adapterVersion / configurationRevision
  authorityKind / audience / subjectScope
  source locator(s)
  entity, document, receipt, corpus, dataset, or scenario references
  observedAt / retrievedAt
  publishedAt / effectiveAt when applicable
  expiresAt / freshness state
  provider revision, ETag, Last-Modified, or canonical content hash
  artifact path/hash and extraction hash when fixture-backed
  outcome / commit state
  limitations and non-authoritative disclosures
  authorization/redaction classification
```

The envelope is immutable and hashable. Conversation state and customer-visible claims reference `evidenceId`; they do not copy an untraceable summary and discard the source.

### Authority is multidimensional, not one numeric rank

`authorityKind` includes at least:

- `authoritative_private_runtime` — configured Provider authority for scoped private state in its environment;
- `authoritative_public_source` — live official public source response;
- `captured_official_public_fixture` — immutable capture of an official public source at a retrieval time;
- `synthetic_scenario_runtime` — authoritative only for a named synthetic scenario instance;
- `baseline_test_fixture` — deterministic parser/compatibility evidence, never runtime truth;
- `untrusted_discovery` — search/index discovery evidence that cannot directly support a customer fact.

Environment is separate from authority. A sandbox Provider can be authoritative for sandbox state. Production is not automatically more factually authoritative for public historical documents, and a synthetic scenario cannot become real authority by running in a production deployment.

Audience and scope are also separate:

- public Business knowledge;
- authenticated Business customer subject;
- synthetic scenario/customer/session;
- operator-only evidence;
- test-only evidence.

The runtime and Pack must compare all dimensions, not a single “real vs mock” boolean.

## 8. Freshness and revalidation

Each capability defines a freshness policy from source semantics:

```text
FreshnessPolicy
  maxAge or source-defined expiry
  immutable-after-publication flag where justified
  stale behavior: reject | revalidate | answer_with_date_and_warning
  consequential revalidation trigger
  revision/hash fields that invalidate evidence
```

Evidence freshness states are `fresh`, `stale_usable_with_disclosure`, `expired_revalidation_required`, or `superseded`. Only the Pack can allow stale public content with a dated disclosure; private state and consequential writes require current authority.

Examples:

- KFC menu/cart/order confirmation pins environment, Provider fingerprint, observation/hash, referenced entities, and Provider revisions; a relevant change invalidates the action (`services/kfc-agent-backend/src/catalog/catalogObservation.ts:292-313`).
- PVCFC product specifications should be revalidated on corpus refresh or source change; agronomy answers retain publication/context and may need stronger caution.
- PVCFC price, promotion, shop, tender, vacancy, and news fixtures are high-churn and must not be presented as current after policy expiry.
- Published reports can be stable historical documents, while their listing metadata may gain newer versions.
- A synthetic scenario instance expires by scenario policy even when its fixture definition is immutable.

Cache age never extends evidence authority. A cached result is usable only if its stored evidence remains valid under the current binding and Pack freshness policy.

## 9. Public crawl fixture contract

The PVCFC public corpus is a `captured_official_public_fixture` source. Its manifest must preserve:

```text
PublicCrawlCorpus
  corpusId / schemaVersion / Business
  capture and generation timestamps
  retrieval tool/version
  authority scope and fixture policy
  raw immutable artifacts
  byte length and full artifact SHA-256
  capture type and dynamic-agent run metadata
  requested/canonical source URLs
  title/language/author/publication date
  extracted-content hash and counts
  errors/blocked routes
  content taxonomy and document/version relationships
  refresh/supersession policy
```

The existing manifest declares corpus `pvcfc-public-web-2026-07-21`, public first-party-only authority, immutable raw artifacts, SHA-256, no synthetic private records, and a new corpus ID/hashes for refresh (`docs/wayfinder/pvcfc-multibusiness-chatbot/assets/pvcfc-crawl/manifest.json:1-32`). Its canonical inventory defines content types, dynamic behavior, failures, duplicates, language relationships, refresh cadence, and public/private capability limitations (`docs/wayfinder/pvcfc-multibusiness-chatbot/assets/pvcfc-public-knowledge-and-crawl-fixture-inventory.md`).

Operational rules:

- Raw artifacts are immutable. Normalized indexes point back to artifact/content hashes.
- Search captures are `untrusted_discovery`; first-party captured content/document bodies support facts.
- A new crawl produces a new corpus version. Promotion to active knowledge is explicit after validation/diff review.
- Old corpora remain addressable for evidence replay and regression tests.
- URL canonicalization does not erase requested URL, redirects, failures, or language/version relationships.
- A listing is authority for listing metadata; a document body is authority for document contents.
- Forms and UI are evidence that public entry points/fields exist, not evidence of private APIs, submission success, records, or workflow access.
- Public knowledge indexes and answers retain corpus ID, source URL, captured/publication dates where available, and content hash.

## 10. Synthetic private-capability fixture contract

Synthetic PVCFC private workflows use `synthetic_scenario_runtime`, never the public crawl corpus.

```text
SyntheticFixtureSet
  fixtureSetId / version / schemaVersion / canonical hash
  Business and Pack compatibility
  generator name/version and deterministic seed policy
  scenario definitions and capability coverage
  explicit synthetic authority and customer-facing limitation
  no-real-person/data attestation
  reset and lifecycle policy
  release provenance and change log

SyntheticScenarioInstance
  unique instanceId
  Business/environment/provider binding
  fixture set and scenario definition version
  releaseId
  synthetic customer/session binding
  createdAt / expiresAt / sealedAt
  logical clock and current revision
  state/event log
  idempotency and request fingerprints
  injected-fault configuration and audit
```

Requirements:

- IDs, names, addresses, orders, complaints, and other records are clearly synthetic and cannot collide with real Provider namespaces.
- No production customer data or copied private record is used as a seed.
- The active scenario instance is assigned by trusted server context, not user/model input.
- Every result states that it is synthetic and includes fixture set, scenario, instance, release, revision, and expiry.
- Mutations are revisioned, idempotent, event-audited, and deterministic under the scenario contract.
- Pre-commit and post-commit faults remain distinguishable; post-commit transport loss yields uncertain/reconciliation behavior rather than replayed success.
- Reset creates a new audited lineage or revision and cannot rewrite historical evidence.
- Synthetic results may demonstrate the assistant workflow but must not be worded as a real PVCFC record, booking, complaint, sale, or order.
- If a future authoritative Provider is configured, synthetic binding is not an automatic fallback. Demo and real capabilities remain explicitly selectable by trusted deployment/scenario policy.

The KFC lifecycle Provider already models many of these lifecycle bindings and fault outcomes, but a PVCFC fixture set must use PVCFC-defined capabilities and state rather than inheriting KFC order/payment/delivery semantics (`services/kfc-agent-backend/src/commerce/lifecycleProvider.ts:20-118`).

## 11. Baseline test fixture contract

A baseline fixture captures one immutable Provider observation for parser, arithmetic, behavior-compatibility, or drift tests.

- It carries Provider/environment identity, capture time, source revision/hash, schema/parser version, and artifact hash.
- Multiple observations remain separate; they are not unioned into an artificial “complete” current source.
- Runtime code cannot silently use a baseline fixture when a configured live Provider fails.
- Tests pin fixture ID/version and verify expected Adapter normalization and evidence.
- Updating a baseline is an explicit reviewed change with old/new diff and quality-contract impact.

KFC catalog observations satisfy much of this shape, including canonical digest and source validators (`services/kfc-agent-backend/src/catalog/catalogObservation.ts:242-289`).

## 12. Provider replacement and versioning

A replacement Adapter/Provider must prove:

1. all declared capability contract versions and schemas pass;
2. normalized statuses/errors and uncertainty behavior are equivalent;
3. evidence completeness, authority, freshness, and subject scope meet Pack policy;
4. idempotency, revisions, receipts, reconciliation, and rate limits are compatible;
5. state/entity identifiers are migrated or deliberately isolated;
6. customer-visible claims and safety oracles remain valid;
7. side-by-side shadowing does not expose private payloads or create mutations;
8. rollback can reconcile any call already dispatched to the new binding.

Version rules:

- Pack capability contract version describes Business semantics.
- Adapter version describes translation behavior.
- Provider API/schema version describes external protocol.
- Binding configuration revision describes endpoint/credential/policy activation.
- Dataset/corpus/fixture/scenario versions describe evidence sources.

These versions are distinct and all appear in evidence. A Provider API version change does not require a Pack contract change if the Adapter preserves semantics; a semantic change does.

## 13. Knowledge Provider requirements

A knowledge port accepts Business taxonomy, query, locale, date/context, and desired authority/freshness. It returns ranked typed knowledge items, not a final unsupported answer. Each item contains:

- stable content/document identity and content type;
- title/snippet or extracted body reference;
- language and verified translation/version relationships;
- canonical/requested URLs;
- publication/effective/capture dates;
- corpus/source/content hashes;
- authority, audience, freshness, and limitations;
- citations suitable for customer presentation.

The Pack's response policy decides whether evidence is sufficient, how to disclose dates/staleness, and when to ask clarification. Vector similarity or search ranking is not authority. Retrieval across Businesses, corpora, private subjects, or synthetic scenarios is forbidden unless a separately authorized cross-source capability explicitly defines it.

## 14. Evidence persistence and customer claims

For each call the runtime persists:

- normalized input fingerprint and capability/binding identity;
- result status and commit state;
- evidence envelopes and external receipt/revision references;
- Adapter diagnostics in restricted storage;
- resulting Pack domain events;
- customer claims and presentation actions linked to supporting evidence IDs.

A claim validator rejects:

- success language for failed/uncertain results;
- “current” language for stale or captured-only evidence unless policy permits disclosure;
- real-PVCFC wording for synthetic records;
- private claims from public evidence;
- facts supported only by discovery/search snippets;
- citations whose Business, subject, environment, binding, or Pack context differs from the run.

Sensitive evidence can be stored by restricted reference rather than copied into transcripts, but replay/evaluation must still prove that the authorized evidence existed.

## 15. Evaluation and acceptance

Provider/Adapter quality is a conjunction, not only schema success:

- request translation and configured binding are correct;
- output or normalized error is correct;
- side-effect/commit phase and retryability are correct;
- authority, scope, freshness, versions, hashes, and limitations are complete;
- state events and claims match the result;
- persistence and evidence references are readable;
- cross-Business/subject/scenario collisions are rejected;
- synthetic and public fixture limitations appear in expected customer/operator surfaces;
- no fixture fallback masks a live Provider failure.

KFC keeps its existing behavior-compatible oracle. PVCFC issue 06 defines its capability scenarios, and issue 08 encodes the shared execution record plus Business-specific hard oracles.

## Required implementation constraints

1. Replace optional generic provenance with mandatory evidence requirements per capability status.
2. Separate authority kind, environment, fixture origin, audience, and subject/scenario scope; do not use one `fixtureMode` or `isMock` flag as policy.
3. Move fixed KFC Provider ports and tool-result mappings into the KFC Business Pack.
4. Keep Adapter input/output validation strict and operation-specific.
5. Add dispatch/commit uncertainty and reconciliation to consequential results.
6. Pin Provider binding/configuration revisions for runs, confirmations, caches, and evidence.
7. Preserve current KFC catalog observation and synthetic lifecycle guarantees during extraction.
8. Load PVCFC public fixtures only by explicit corpus manifest; keep synthetic private fixtures in a separate manifest/provider.
9. Disallow fallback between live, crawl, synthetic, baseline, test, and another Business's binding.
10. Require evidence-linked state and claims at runtime and in evaluation.

## Decisions left to later tickets

- Issue 06 selects the exact PVCFC knowledge and private/synthetic capability ports, state machines, consent, escalation, and customer limitations.
- Issue 07 defines how citations, freshness, synthetic limitations, errors, components, and actions appear across channels.
- Issue 08 defines executable Provider substitutability, provenance, freshness, uncertainty, KFC migration, and PVCFC scenario oracles.
- Issue 09 defines concrete modules, schemas, generators, migrations, rollout, and rollback steps.
