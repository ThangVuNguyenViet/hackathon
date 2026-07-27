# KFC Recommendation Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the accepted recommendation POC provenance and add one
versioned recommendation contract that JSON Schema, TypeScript/Zod, and
Python/Pydantic validate consistently.

**Architecture:** A checked-in JSON Schema is the cross-language transport
authority. TypeScript and Python expose focused domain projections that parse
the same example corpus and add cross-field invariants that JSON Schema cannot
express portably. This plan adds contracts only; it does not add routes,
ranking, state transitions, Sanity access, model serving, or agent tools.

**Tech Stack:** JSON Schema 2020-12, TypeScript 5, Zod 3, Vitest, Python 3.11,
Pydantic 2, `jsonschema`, Node `crypto`.

## Global Constraints

- Work on branch `codex/kfc-recommendation-poc-implementation`, based on
  specification commit `b9b193549a29374bb258f543a0661d2626c82bd9`.
- Canonical API version is exactly `kfc-recommendation-v1`.
- Canonical state version is exactly `kfc-recommendation-state-v1`.
- Canonical event version is exactly `kfc-recommendation-event-v1`.
- Canonical policy version is exactly `kfc-recommendation-policy-v1`.
- Currency is exactly `VND`; money amount is a non-negative integer.
- Supported placements are exactly `local_favorite`, `for_you`,
  `modifier_upsell`, and `smart_cross_sell`.
- Supported decision statuses are exactly `recommended`, `empty`,
  `suppressed`, `invalid_context`, and `ineligible_context`.
- Supported decision sources are exactly `ranked`,
  `merchandising_replacement`, `fallback`, and `suppressed`.
- Supported actions are exactly `add_product`, `apply_modifier`, and
  `replace_cart_line`.
- Clients provide context, never authoritative candidates. Every transport
  object is strict and rejects unknown properties.
- Every snapshot binding includes snapshot ID, SHA-256 digest, source revision,
  observed/effective/expiry times, completeness, commerce environment, and
  provenance.
- A decision request must reject mixed Commerce Environments across snapshot
  bindings.
- No production module or contract preserves the removed generic add-on tool.
- Do not change LangChain `createAgent`, existing commerce behavior, D1,
  Sanity, GenUI, Flutter, or model runtime in this plan.
- Follow strict TDD: write one behavioral test, run it and observe the expected
  failure, implement the minimum, then rerun it.
- Unit tests exercise real parsers and real files. Do not assert on mocks or
  grep source text.
- Use the existing package commands. Do not invoke test commands from
  application code.

---

### Task 1: Freeze implementation provenance

**Files:**

- Create:
  `docs/wayfinder/kfc-product-recommendation-poc/implementation-provenance.json`
- Create:
  `services/kfc-agent-backend/test/recommendations/implementation-provenance.test.ts`

**Interfaces:**

- Consumes: the six immutable fixture files and two completed benchmark result
  digests listed below.
- Produces: a checked-in provenance manifest whose fixture hashes are verified
  against actual file bytes.

The manifest values are exact:

```json
{
  "schemaVersion": "kfc-recommendation-provenance-v1",
  "specificationCommit": "b9b193549a29374bb258f543a0661d2626c82bd9",
  "implementationBaseCommit": "4246c6b2635a8f03931a7f275407ecc4a4d2ef1b",
  "simulatorSourceCommit": "58cef2d1e9cece6075e1035158eb2674e530f9b7",
  "fixtures": {
    "services/kfc-agent-backend/fixtures/generated/menu-items.json": "e4fac7cc554d0cc06fa3d2efa8130f3f459d6b0883452f6418077202af81fcee",
    "services/kfc-agent-backend/fixtures/generated/menu-modifiers.json": "171d267b2d15a765274c2e4ebbe167c1e6d1e69d0dffce1c265f2d3f8b7041a6",
    "services/kfc-agent-backend/fixtures/generated/stores.json": "5f0d28bc5421e2662d447239273dda99213e4969862a55faaf090e975654fecc",
    "services/kfc-agent-backend/fixtures/generated/store-availability.json": "66e63a9bccc3362541f7397497beb3e4fcb4a71d466f60b77508de8dccf9df96",
    "services/kfc-agent-backend/fixtures/generated/promotions.json": "ee6785b626ccb6a6e64144a4c6c3b25dede01aa90f9adc4dfb7e76c23b272335",
    "services/kfc-recommendation-simulator/worlds/sanity-policies.json": "6a255b23ee012d9a2fdc25c3c90c819d2a6357373b5393082551feccba8e5489"
  },
  "qualifications": {
    "smartCrossSell": {
      "contentDigest": "e76c7641d48a9f47f0da084ca77f30ceb8df6c31c2ebee65eef15d52c80cda80",
      "featureSchema": "smart-cross-sell-feature-schema-v1",
      "selectedRanker": "blend",
      "promotionDecision": "retain_baseline"
    },
    "modifierUpsell": {
      "contentDigest": "75f1d02a4e230e901eb222b26268b255f46842483ad77f04e2192ea74d81de26",
      "featureSchema": "modifier-upsell-feature-schema-v1",
      "selectedRanker": "incremental_value",
      "promotionDecision": "retain_baseline"
    }
  }
}
```

- [ ] **Step 1: Write the failing provenance test**

Create a Vitest test that:

1. resolves repository root from `import.meta.url`;
2. reads `implementation-provenance.json`;
3. asserts the manifest equals the literal version and commit values above;
4. reads every path in `fixtures`;
5. computes SHA-256 with `createHash('sha256')`; and
6. asserts the computed digest equals the manifest value.

The expectation must use the literal values above rather than rebuilding an
expected manifest from production helpers.

```ts
it('binds the implementation to the accepted fixtures and qualification results', async () => {
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));

  expect(provenance.schemaVersion).toBe(
    'kfc-recommendation-provenance-v1',
  );
  expect(provenance.specificationCommit).toBe(
    'b9b193549a29374bb258f543a0661d2626c82bd9',
  );
  expect(provenance.qualifications.smartCrossSell.contentDigest).toBe(
    'e76c7641d48a9f47f0da084ca77f30ceb8df6c31c2ebee65eef15d52c80cda80',
  );
  expect(provenance.qualifications.modifierUpsell.contentDigest).toBe(
    '75f1d02a4e230e901eb222b26268b255f46842483ad77f04e2192ea74d81de26',
  );

  for (const [relativePath, expectedDigest] of Object.entries(
    provenance.fixtures as Record<string, string>,
  )) {
    const bytes = await readFile(resolve(repoRoot, relativePath));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      expectedDigest,
    );
  }
});
```

- [ ] **Step 2: Run the test and observe the expected failure**

Run:

```bash
cd services/kfc-agent-backend
npx vitest run test/recommendations/implementation-provenance.test.ts
```

Expected: FAIL with `ENOENT` for
`implementation-provenance.json`. A syntax/import error is not the expected
failure and must be fixed before continuing.

- [ ] **Step 3: Add the exact provenance manifest**

Create the JSON file with the exact object above. Do not add timestamps,
machine paths, generated artifact paths, or credentials.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run test/recommendations/implementation-provenance.test.ts
```

Expected: 1 test passes.

- [ ] **Step 5: Run backend static checks**

Run:

```bash
npm run check
```

Expected: formatting, lint, and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add \
  docs/wayfinder/kfc-product-recommendation-poc/implementation-provenance.json \
  services/kfc-agent-backend/test/recommendations/implementation-provenance.test.ts
git commit -m "test(kfc): freeze recommendation provenance"
```

---

### Task 2: Add the JSON Schema transport authority and example corpus

**Files:**

- Create:
  `contracts/recommendations/v1/kfc-recommendation.schema.json`
- Create:
  `contracts/recommendations/v1/examples/valid-decision-request.json`
- Create:
  `contracts/recommendations/v1/examples/valid-decision-response.json`
- Create:
  `contracts/recommendations/v1/examples/valid-recommendation-event.json`
- Create:
  `contracts/recommendations/v1/examples/invalid-contract-values.json`
- Create:
  `services/kfc-agent-backend/test/recommendations/json-schema-contract.test.ts`
- Modify: `services/kfc-agent-backend/package.json`
- Modify: `services/kfc-agent-backend/package-lock.json`

**Interfaces:**

- Consumes: version strings and enumerations from Global Constraints.
- Produces: JSON Schema ID
  `https://kfc.local/contracts/recommendations/v1/kfc-recommendation.schema.json`
  with addressable `$defs` named `RecommendationDecisionRequest`,
  `RecommendationDecisionResponse`, and `RecommendationEvent`.

Add direct runtime dependencies `"ajv": "8.20.0"` and
`"ajv-formats": "3.0.1"` because the application will later register the same
schemas at Fastify route boundaries. Do not import undeclared transitive
dependencies.

The root schema uses:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://kfc.local/contracts/recommendations/v1/kfc-recommendation.schema.json",
  "title": "KFC Recommendation v1",
  "oneOf": [
    {"$ref": "#/$defs/RecommendationDecisionRequest"},
    {"$ref": "#/$defs/RecommendationDecisionResponse"},
    {"$ref": "#/$defs/RecommendationEvent"}
  ],
  "$defs": {}
}
```

Every object definition sets `"additionalProperties": false`.

Required reusable definitions and exact fields:

```text
OpaqueId:
  string, pattern ^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$

Sha256:
  string, pattern ^[a-f0-9]{64}$

Instant:
  string, format date-time

Money:
  amount: integer >= 0
  currency: const VND

SnapshotProvenance:
  source: non-empty string
  reference: non-empty string

SnapshotBinding:
  snapshotId: OpaqueId
  digest: Sha256
  sourceRevision: non-empty string
  observedAt: Instant
  effectiveAt: Instant
  expiresAt: Instant
  complete: boolean
  commerceEnvironment: OpaqueId
  provenance: SnapshotProvenance

CommerceSnapshotBindings:
  catalog, modifierGraph, store, availability, promotion: SnapshotBinding

ModifierSelection:
  groupPath: non-empty array of OpaqueId
  optionId: OpaqueId
  quantity: integer >= 1
  priceImpact: Money

CartLine:
  lineId: OpaqueId
  sellableItemId: OpaqueId
  quantity: integer >= 1
  unitPrice: Money
  modifiers: array of ModifierSelection

CartSnapshot:
  cartId: OpaqueId
  revision: OpaqueId
  subtotal: Money
  lines: array of CartLine

ExperimentProfile:
  profileId: OpaqueId
  outputMode: baseline | learned_technical
```

`RecommendationDecisionRequest` requires exactly:

```text
schemaVersion: const kfc-recommendation-v1
requestId: OpaqueId
idempotencyKey: OpaqueId
orderFlowId: OpaqueId
sessionId: OpaqueId
placement: placement enum
verifiedCustomerRef: OpaqueId | null
storeId: OpaqueId
fulfilmentMode: pickup | delivery
decisionTime: Instant
cart: CartSnapshot
cartRevision: OpaqueId
commerceSnapshotBindings: CommerceSnapshotBindings
eligibilityPolicyVersion: const kfc-recommendation-policy-v1
experimentProfile: ExperimentProfile
```

Action definitions require:

```text
AddProductAction:
  type: const add_product
  actionId, sellableItemId: OpaqueId
  quantity: integer >= 1
  priceImpact: Money
  cartRevision: OpaqueId

ApplyModifierAction:
  type: const apply_modifier
  actionId, parentCartLineId, parentSellableItemId, optionId: OpaqueId
  groupPath: non-empty array of OpaqueId
  quantity: integer >= 1
  priceImpact: Money
  cartRevision: OpaqueId

ReplaceCartLineAction:
  type: const replace_cart_line
  actionId, replacedCartLineId: OpaqueId
  replacement: AddProductAction
  priceImpact: Money
  cartRevision: OpaqueId
```

`RecommendationDecisionResponse` requires exactly:

```text
schemaVersion: const kfc-recommendation-v1
recommendationId, requestId, orderFlowId: OpaqueId
placement: placement enum
status: status enum
decisionSource: source enum
primaryOffer:
  null or object with actions: array 1..4 of RecommendationAction
displayFacts:
  array of strict objects {actionId, name, imageUrl|null, priceImpact}
reasonCodes:
  array of customer reason enum
merchandisingEffects:
  array of strict objects {policyId, action, targetActionId|null, detail}
versionBindings:
  strict object with catalog, modifierGraph, store, availability, promotion,
  eligibilityPolicy, sanitySnapshot, featureSchema, servingRanker,
  shadowModel|null, calibration|null, experiment, loggingPolicy
counts:
  strict object with potential, eligible, ineligible, scored, displayed
  non-negative integers and complete boolean
traceRef: OpaqueId
```

Customer reason enum:

```text
popular_here
ordered_before
matches_your_history
completes_your_item
completes_your_meal
active_offer
merchandising_selection
```

Merchandising action enum:

```text
exclude_target
boost_target
pin_target
replace_slate
suppress_placement
```

`RecommendationEvent` requires exactly:

```text
schemaVersion: const kfc-recommendation-event-v1
eventId: OpaqueId
eventType: decision_requested | decision_completed |
  candidate_eligibility_summary | impression_rendered | selected |
  explicitly_dismissed | ignored | superseded | cart_mutation_succeeded |
  cart_mutation_failed | checkout_completed | order_abandoned |
  order_cancelled
recommendationId: OpaqueId | null
requestId, orderFlowId, sessionId: OpaqueId
placement: placement enum
occurredAt, recordedAt: Instant
actor: customer | agent | system | client
actionId: OpaqueId | null
cartRevision: OpaqueId | null
versionBindings: the response VersionBindings object
payload: object with arbitrary JSON values
```

- [ ] **Step 1: Install declared schema dependencies**

Run:

```bash
cd services/kfc-agent-backend
npm install --save-exact ajv@8.20.0 ajv-formats@3.0.1
```

Expected: `package.json` and `package-lock.json` declare Ajv 8.20.0 and
Ajv Formats 3.0.1.

- [ ] **Step 2: Create examples before the schema**

Create the three valid example files with these identities:

```text
requestId: rec-request-001
idempotencyKey: rec-idempotency-001
orderFlowId: order-flow-001
sessionId: session-001
verifiedCustomerRef: customer-returning-001
storeId: store-001
cartId: cart-001
cart revision and cartRevision: cart-revision-001
commerceEnvironment on every binding: kfc-vietnam-demo
placement: for_you
response recommendationId: recommendation-001
response status: recommended
response decisionSource: ranked
response action: add_product / action-product-001 / item-001 / quantity 1
event: event-impression-001 / impression_rendered / actor client
```

All five snapshot bindings use distinct IDs and 64-character lowercase
hexadecimal digests, observed/effective/expiry instants in ascending order,
`complete: true`, and provenance `{source: "checked-in-fixture",
reference: "fixture-revision-001"}`.

Use money `{ "amount": 89000, "currency": "VND" }` for the cart subtotal
and `{ "amount": 45000, "currency": "VND" }` for the recommended item.

Create `invalid-contract-values.json` as an array:

```json
[
  {
    "name": "client candidates are forbidden",
    "definition": "RecommendationDecisionRequest",
    "source": "valid-decision-request.json",
    "patch": {"candidates": []}
  },
  {
    "name": "fractional VND is forbidden",
    "definition": "RecommendationDecisionRequest",
    "source": "valid-decision-request.json",
    "patch": {"cart.subtotal.amount": 89000.5}
  },
  {
    "name": "unknown placement is forbidden",
    "definition": "RecommendationDecisionRequest",
    "source": "valid-decision-request.json",
    "patch": {"placement": "single_upsell"}
  },
  {
    "name": "more than four actions are forbidden",
    "definition": "RecommendationDecisionResponse",
    "source": "valid-decision-response.json",
    "patch": {
      "primaryOffer.actions": [
        "copy:0",
        "copy:0",
        "copy:0",
        "copy:0",
        "copy:0"
      ]
    }
  }
]
```

The test owns a small path-patch helper and expands `"copy:0"` by cloning the
first valid action and assigning unique action IDs. This is test-only code.

- [ ] **Step 3: Write the failing JSON Schema test**

The test loads Ajv 2020:

```ts
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
```

Compile the root schema and retrieve:

```ts
const requestValidator = ajv.getSchema(
  `${schema.$id}#/$defs/RecommendationDecisionRequest`,
);
const responseValidator = ajv.getSchema(
  `${schema.$id}#/$defs/RecommendationDecisionResponse`,
);
const eventValidator = ajv.getSchema(
  `${schema.$id}#/$defs/RecommendationEvent`,
);
```

Tests:

```ts
it.each([
  ['RecommendationDecisionRequest', validRequest],
  ['RecommendationDecisionResponse', validResponse],
  ['RecommendationEvent', validEvent],
])('accepts the canonical %s example', (_name, value) => {
  expect(validatorFor(_name)(value)).toBe(true);
});

it.each(invalidCases)('rejects $name', (invalidCase) => {
  const value = applyPatch(loadSource(invalidCase.source), invalidCase.patch);
  expect(validatorFor(invalidCase.definition)(value)).toBe(false);
});
```

- [ ] **Step 4: Run the test and observe the expected failure**

Run:

```bash
npx vitest run test/recommendations/json-schema-contract.test.ts
```

Expected: FAIL with `ENOENT` for
`contracts/recommendations/v1/kfc-recommendation.schema.json`.

- [ ] **Step 5: Implement the complete JSON Schema**

Add every definition and field specified in this task. Use `oneOf` with
discriminator constants for recommendation actions. Use `$ref` rather than
copying shared definitions. Set `minItems`, `maxItems`, patterns, formats, and
required arrays explicitly.

- [ ] **Step 6: Run the focused test**

Run:

```bash
npx vitest run test/recommendations/json-schema-contract.test.ts
```

Expected: all valid and invalid cases pass.

- [ ] **Step 7: Run backend checks**

Run:

```bash
npm run check
npm test
```

Expected: static checks and the complete backend suite pass.

- [ ] **Step 8: Commit**

```bash
git add \
  contracts/recommendations/v1 \
  services/kfc-agent-backend/package.json \
  services/kfc-agent-backend/package-lock.json \
  services/kfc-agent-backend/test/recommendations/json-schema-contract.test.ts
git commit -m "feat(kfc): add recommendation transport schema"
```

---

### Task 3: Add the TypeScript/Zod domain projection

**Files:**

- Create:
  `services/kfc-agent-backend/src/recommendations/domain/versions.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/domain/identities.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/domain/contracts.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/domain/schemas.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/domain-contract.test.ts`

**Interfaces:**

- Consumes: the JSON Schema examples from Task 2.
- Produces:
  `parseRecommendationDecisionRequest(value: unknown):
  RecommendationDecisionRequest`,
  `parseRecommendationDecisionResponse(value: unknown):
  RecommendationDecisionResponse`, and
  `parseRecommendationEvent(value: unknown): RecommendationEvent`.

`versions.ts` exports the four exact constants from Global Constraints.

`identities.ts` exports branded string types and Zod schemas for:

```text
CommerceEnvironmentId
ProductFamilyId
SellableItemId
ExternalItemAlias
CartLineId
ModifierOptionId
OrderingJourneyId
RecommendationId
RecommendationRequestId
RecommendationEventId
SanityPolicyId
ModelArtifactId
```

Use one reusable opaque-ID schema with the exact pattern from Task 2. Branding
is compile-time only; JSON remains a string.

`contracts.ts` exports inferred types for every shared schema and the three
top-level contracts. It does not repeat independent interface declarations.

`schemas.ts` mirrors Task 2 with strict Zod objects and adds these refinements:

1. `cart.revision === cartRevision`;
2. every Snapshot Binding has the same `commerceEnvironment`;
3. `effectiveAt <= decisionTime < expiresAt`;
4. `observedAt <= decisionTime`;
5. `status === recommended` requires non-null `primaryOffer`;
6. every other status requires `primaryOffer === null`;
7. `counts.eligible + counts.ineligible === counts.potential`;
8. `counts.displayed` equals the number of actions in `primaryOffer`, or zero;
9. every `displayFacts.actionId` belongs to the authoritative offer;
10. `modifier_upsell` offers contain exactly one `apply_modifier`;
11. `local_favorite` and `for_you` offers contain exactly one `add_product`;
12. `smart_cross_sell` offers contain three or four `add_product` actions.

- [ ] **Step 1: Write the failing TypeScript projection tests**

Tests parse the valid examples and hand-mutate copies to prove each cross-field
rule. At minimum:

```ts
it('parses the canonical decision request', () => {
  const parsed = parseRecommendationDecisionRequest(validRequest);
  expect(parsed.requestId).toBe('rec-request-001');
  expect(parsed.commerceSnapshotBindings.catalog.complete).toBe(true);
});

it('rejects mixed Commerce Environments', () => {
  const value = structuredClone(validRequest);
  value.commerceSnapshotBindings.availability.commerceEnvironment =
    'other-environment';
  expect(() => parseRecommendationDecisionRequest(value)).toThrow();
});

it('rejects a cart revision that is not the request revision', () => {
  const value = structuredClone(validRequest);
  value.cart.revision = 'cart-revision-other';
  expect(() => parseRecommendationDecisionRequest(value)).toThrow();
});

it('requires exactly one product for For You', () => {
  const value = structuredClone(validResponse);
  value.primaryOffer.actions.push({
    ...structuredClone(value.primaryOffer.actions[0]),
    actionId: 'action-product-002',
  });
  expect(() => parseRecommendationDecisionResponse(value)).toThrow();
});
```

Add separate tests for an empty response with `primaryOffer: null`, a
Modifier Upsell response with one modifier action, and a Smart Cross-sell
response with three product actions.

- [ ] **Step 2: Run the test and observe the expected failure**

Run:

```bash
npx vitest run test/recommendations/domain-contract.test.ts
```

Expected: FAIL because
`src/recommendations/domain/schemas.ts` does not exist.

- [ ] **Step 3: Implement versions, identities, schemas, and inferred types**

Use `z.discriminatedUnion('type', ...)` for actions. Use one refinement per
observable error group so tests can identify the violated contract. Do not add
routes, repositories, service objects, or compatibility wrappers.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run test/recommendations/domain-contract.test.ts
```

Expected: all projection and invariant tests pass.

- [ ] **Step 5: Run backend checks**

Run:

```bash
npm run check
npm test
```

Expected: static checks and the complete backend suite pass.

- [ ] **Step 6: Commit**

```bash
git add \
  services/kfc-agent-backend/src/recommendations/domain \
  services/kfc-agent-backend/test/recommendations/domain-contract.test.ts
git commit -m "feat(kfc): add recommendation domain contracts"
```

---

### Task 4: Add the Python/Pydantic domain projection

**Files:**

- Create:
  `services/kfc-recommendation-simulator/src/kfc_recommendation_simulator/recommendation_contracts.py`
- Create:
  `services/kfc-recommendation-simulator/tests/test_recommendation_contracts.py`
- Modify: `services/kfc-recommendation-simulator/README.md`

**Interfaces:**

- Consumes: the same JSON Schema examples from Task 2.
- Produces:
  `RecommendationDecisionRequest.model_validate(value)`,
  `RecommendationDecisionResponse.model_validate(value)`, and
  `RecommendationEvent.model_validate(value)`.

Every Pydantic model uses:

```python
model_config = ConfigDict(extra="forbid", frozen=True)
```

Use `Annotated[str, StringConstraints(pattern=...)]` for opaque IDs and SHA-256,
timezone-aware `datetime` for instants, `Literal` for versions/enums,
`NonNegativeInt` for money and counts, and discriminated unions for actions.
Field aliases preserve the JSON camelCase names.

Pydantic validators implement the same 12 cross-field rules from Task 3.
Datetime comparisons operate on parsed aware datetimes.

- [ ] **Step 1: Write the failing Python projection tests**

Resolve repository root from `Path(__file__)`, load the three shared examples,
and prove:

```python
def test_parses_canonical_decision_request() -> None:
    parsed = RecommendationDecisionRequest.model_validate(valid_request())
    assert parsed.request_id == "rec-request-001"
    assert parsed.commerce_snapshot_bindings.catalog.complete is True


def test_rejects_mixed_commerce_environments() -> None:
    value = valid_request()
    value["commerceSnapshotBindings"]["availability"][
        "commerceEnvironment"
    ] = "other-environment"
    with pytest.raises(ValidationError):
        RecommendationDecisionRequest.model_validate(value)


def test_rejects_mismatched_cart_revision() -> None:
    value = valid_request()
    value["cart"]["revision"] = "cart-revision-other"
    with pytest.raises(ValidationError):
        RecommendationDecisionRequest.model_validate(value)
```

Use `unittest.TestCase` instead of pytest because the package’s normal suite is
`unittest discover`; express the same assertions with
`self.assertRaises(ValidationError)`. Do not add pytest.

Add the same empty, Modifier Upsell, and three-item Smart Cross-sell response
cases as the TypeScript suite.

- [ ] **Step 2: Run the test and observe the expected failure**

Run:

```bash
cd services/kfc-recommendation-simulator
uv run python -m unittest tests.test_recommendation_contracts -v
```

Expected: FAIL because
`kfc_recommendation_simulator.recommendation_contracts` does not exist.

- [ ] **Step 3: Implement the Pydantic models and validators**

Keep this module independent of simulator oracle/evaluation models. It may
import only standard library and Pydantic. Do not import Pandas, TensorFlow,
rankers, simulator state, or benchmark code.

- [ ] **Step 4: Run the focused test**

Run:

```bash
uv run python -m unittest tests.test_recommendation_contracts -v
```

Expected: all projection and invariant tests pass.

- [ ] **Step 5: Document the shared authority**

Add a short README section:

```markdown
## Platform contract

`../../contracts/recommendations/v1/kfc-recommendation.schema.json` is the
cross-language transport authority. The Python Pydantic projection validates
the same checked-in examples as the TypeScript/Zod projection and adds the same
cross-field invariants. Model code receives only already-eligible
request-candidate rows; it does not own API, eligibility, merchandising, state,
or basket effects.
```

- [ ] **Step 6: Run simulator checks**

Run:

```bash
uvx ruff check src tests
uv run python -m compileall -q src tests
uv run python -m unittest discover -s tests -v
```

Expected: Ruff, compileall, and the complete simulator suite pass.

- [ ] **Step 7: Run final cross-project verification**

Run:

```bash
cd ../kfc-agent-backend
npm run check
npm test
git diff --check
```

Expected: all backend checks, all backend tests, and diff check pass.

- [ ] **Step 8: Commit**

```bash
git add \
  services/kfc-recommendation-simulator/README.md \
  services/kfc-recommendation-simulator/src/kfc_recommendation_simulator/recommendation_contracts.py \
  services/kfc-recommendation-simulator/tests/test_recommendation_contracts.py
git commit -m "feat(kfc): add Python recommendation contracts"
```

---

## Plan completion gate

This plan is complete only when:

- the provenance manifest matches all six real fixture byte digests;
- JSON Schema accepts all three valid examples and rejects every invalid case;
- TypeScript/Zod and Python/Pydantic parse the same valid examples;
- both projections reject mixed environments, stale/invalid time bindings,
  mismatched cart revisions, invalid status/offer combinations, count
  mismatches, and placement/action shape violations;
- no route, state, policy, model, agent, or UI behavior was added;
- `npm run check`, `npm test`, Ruff, compileall, all Python unit tests, and
  `git diff --check` pass; and
- all four task commits are present on
  `codex/kfc-recommendation-poc-implementation`.

After this plan, write separate execution plans for:

1. deterministic eligibility, rankers, and Sanity resolution;
2. D1 state, events, idempotent HTTP API, and protected inspection;
3. MLflow PyFunc packaging, Hugging Face publication, and shadow adapter;
4. LangChain tools, durable tool exposure, prompt policy, and GenUI;
5. Flutter `recommendationOffer`; and
6. HTTP/D1 scenario qualification and acceptance evidence.
