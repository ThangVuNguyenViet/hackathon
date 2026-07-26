# KFC Recommendation Decision Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pure, deterministic recommendation core that enumerates
all potential actions, records hard-eligibility evidence, ranks the four
placements with the accepted serving formulas, applies a provider-neutral
Sanity policy snapshot, and returns a contract-valid decision plus protected
technical evidence.

**Architecture:** The checked-in recommendation JSON Schema remains the
transport authority. A pure TypeScript decision engine consumes already
validated request/context objects and repository snapshots. Existing generated
KFC fixtures provide catalog, modifier, store, and availability facts; new
small app-owned fixtures provide normalized promotion/ranking facts and a
versioned Sanity-equivalent snapshot. Repositories isolate those sources so a
later HTTP/D1 slice can replace fixtures without changing eligibility,
rankers, or merchandising resolution.

**Tech Stack:** TypeScript 5, Zod 3, Vitest, Node Web Crypto, existing generated
KFC fixtures, official `@sanity/client` 7.25.0.

## Global constraints

- Work on `codex/kfc-recommendation-poc-implementation`.
- The transport/domain contracts from commits
  `29698f68..2f2f68f4` are authoritative and must remain compatible.
- Clients provide context, never candidates.
- Enumerate every potential action before eligibility. Rankers receive only
  eligible candidates and pre-decision features.
- Sanity may exclude, suppress, replace, boost, or pin, but never resurrect an
  ineligible action.
- Serving is deterministic. Ties use canonical action ID ascending.
- Normal request mode serves only:
  `contextual-popularity-v1`, `for-you-affinity-v1`,
  `incremental-value-v1`, and `smart-cross-blend-v1`.
- Do not add learned-model inference in this plan. Shadow adapters are a later
  slice.
- Do not add HTTP routes, D1 persistence, agent tools/prompts, GenUI, Flutter,
  or scenario runners in this plan.
- Do not preserve or mention a recommendation compatibility path.
- Do not parse customer prose for identity, history, dietary evidence, stage,
  budget, or policy applicability. Inputs are typed authoritative facts.
- Reuse `loadBundledGeneratedFixtures`, the generated fixture schemas, and
  `digestCommerceAction`; do not copy their parsers or canonical digest logic.
- Existing simulator benchmark code remains qualification evidence. Do not
  import Python, Pandas, TensorFlow, LightGBM, or simulator modules into the
  backend decision engine.
- Ranking counts and normalized promotion facts in this plan are explicitly
  POC fixtures. Their provenance must say simulated/normalized fixture; no
  output or test may present them as real KFC popularity, conversion, or lift.
- Strict TDD: first observe a behavioral failure for the task, then implement
  the minimum and rerun focused/full checks.
- Tests use real checked-in fixtures and real parsers. Do not assert on mocks,
  source text, or exact implementation call sequences.

---

### Task 1: Add versioned recommendation fact snapshots and repositories

**Files:**

- Create:
  `services/kfc-agent-backend/fixtures/recommendations/ranking-statistics-v1.json`
- Create:
  `services/kfc-agent-backend/fixtures/recommendations/promotion-snapshot-v1.json`
- Create:
  `services/kfc-agent-backend/src/recommendations/snapshots/types.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/snapshots/schemas.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/snapshots/repositories.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/snapshots/bundled-repositories.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/snapshot-repositories.test.ts`

**Interfaces:**

`CommerceFactsRepository.load()` returns the existing parsed generated fixtures:

```ts
interface CommerceFactsSnapshot {
  menuItems: GeneratedMenuItem[];
  menuModifiers: GeneratedMenuModifier[];
  stores: GeneratedStore[];
  storeAvailability: GeneratedStoreAvailability[];
}
```

It must call `loadBundledGeneratedFixtures()` and select those four arrays.

`RankingStatisticsRepository.load()` returns a strict snapshot:

```ts
interface RankingStatisticsSnapshot {
  schemaVersion: 'recommendation-ranking-statistics-v1';
  snapshotId: string;
  sourceRevision: string;
  observedAt: string;
  effectiveAt: string;
  expiresAt: string;
  complete: boolean;
  commerceEnvironment: string;
  priorStrength: number; // > 0
  normalization: {
    exactItemAffinity: { min: number; max: number };
    categoryAffinity: { min: number; max: number };
    smartPopularityLog: { mean: number; standardDeviation: number };
    discountRatio: { mean: number; standardDeviation: number };
  };
  productStatistics: Array<{
    sellableItemId: string;
    globalOrderCount: number;
    storeOrderCounts: Record<string, number>;
    storeDaypartOrderCounts: Record<string, number>;
    storeCalendarDayTypeDaypartOrderCounts: Record<string, number>;
  }>;
  provenance: { source: string; reference: string };
}
```

Keys are exact:

```text
storeDaypart: <storeId>:<daypart>
storeCalendarDayTypeDaypart: <storeId>:<weekday|weekend>:<daypart>
daypart: breakfast | lunch | afternoon | dinner | late_night
```

`PromotionFactsRepository.load()` returns:

```ts
interface PromotionFactsSnapshot {
  schemaVersion: 'recommendation-promotion-facts-v1';
  snapshotId: string;
  sourceRevision: string;
  observedAt: string;
  effectiveAt: string;
  expiresAt: string;
  complete: boolean;
  commerceEnvironment: string;
  promotions: Array<{
    promotionId: string;
    sellableItemId: string;
    startsAt: string;
    endsAt: string;
    originalPriceVnd: number;
    promotionalPriceVnd: number;
    includedStoreIds: string[];
    excludedStoreIds: string[];
    fulfilmentModes: Array<'pickup' | 'delivery'>;
  }>;
  provenance: { source: string; reference: string };
}
```

All snapshot objects and nested objects are strict. Instants reuse
`instantSchema`; IDs and money use existing schemas. Arrays reject duplicate
IDs/revisions where applicable.

The ranking fixture uses:

```text
snapshotId: ranking-statistics-poc-001
sourceRevision: simulator-fixture-statistics-001
effectiveAt: 2026-01-01T00:00:00Z
expiresAt: 2027-01-01T00:00:00Z
commerceEnvironment: kfc-vietnam-demo
priorStrength: 20
exactItemAffinity min/max: 0/5
categoryAffinity min/max: 0/12
smartPopularityLog mean/std: 4.5/1.2
discountRatio mean/std: 0.05/0.1
```

It contains rows for these real items:

| Item | Global | KFCVN0002 | Lunch | Weekday lunch |
|---|---:|---:|---:|---:|
| 20751 | 120 | 50 | 24 | 18 |
| 20732 | 100 | 44 | 20 | 15 |
| 20748 | 88 | 36 | 16 | 12 |
| 41127 | 72 | 26 | 14 | 10 |
| 20687 | 68 | 24 | 12 | 9 |
| 41035 | 90 | 34 | 18 | 13 |
| 41042 | 64 | 22 | 11 | 8 |
| 41052 | 58 | 20 | 10 | 7 |
| 41072 | 52 | 18 | 9 | 6 |

Use keys `KFCVN0002:lunch` and `KFCVN0002:weekday:lunch`.
`observedAt` is `2026-07-26T00:00:00Z`. Missing candidates receive zero counts;
do not invent rows at runtime. Provenance is
`{source: "synthetic-simulator-fixture", reference:
"ranking-statistics-poc-001"}`.

The promotion fixture has two active facts at decision time
`2026-07-27T09:00:00Z`:

```text
20732: 239000 -> 189000, all stores, pickup+delivery
20748: 404000 -> 269000, all stores, pickup+delivery
```

and one expired fact for `41172`, ending `2026-06-01T00:00:00Z`.
Promotion provenance is
`{source: "checked-in-normalized-poc-fixture", reference:
"promotion-facts-poc-001"}`.

- [ ] **Step 1: Write failing repository tests**

Prove real commerce fixture counts are 120 menu items, 58 modifier roots, 265
stores, and 265 availability rows. Prove the new fixtures fail to load because
their modules/files do not exist yet.

- [ ] **Step 2: Observe RED**

```bash
cd services/kfc-agent-backend
npx vitest run test/recommendations/snapshot-repositories.test.ts
```

Expected: missing snapshot repository module or fixture, not a syntax failure.

- [ ] **Step 3: Implement strict schemas, ports, adapters, and fixtures**

The bundled adapters read checked-in JSON imports and parse on every `load()`;
they do not cache mutable objects. Return readonly-compatible parsed values.

- [ ] **Step 4: Verify**

```bash
npx vitest run test/recommendations/snapshot-repositories.test.ts
npm run check
npm test
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/fixtures/recommendations \
  services/kfc-agent-backend/src/recommendations/snapshots \
  services/kfc-agent-backend/test/recommendations/snapshot-repositories.test.ts
git commit -m "feat(kfc): add recommendation fact repositories"
```

---

### Task 2: Enumerate potential actions and record hard eligibility

**Files:**

- Create:
  `services/kfc-agent-backend/src/recommendations/eligibility/types.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/eligibility/enumerate-candidates.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/eligibility/evaluate-eligibility.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/eligibility.test.ts`

**Internal input:**

```ts
interface RecommendationDecisionContext {
  request: RecommendationDecisionRequest;
  storeTimezone: string;
  verifiedCohorts: string[];
  flow: {
    stage:
      | 'starter_ready'
      | 'modifier_ready'
      | 'smart_cross_sell_ready'
      | 'complete';
    attemptedPlacements: Placement[];
    previouslyShownActionIds: string[];
    rejectedActionIds: string[];
  };
  parentCartLineId: string | null;
  remainingBudgetVnd: number | null;
  verifiedDietaryEvidence: {
    evidenceId: string;
    excludedSellableItemIds: string[];
  } | null;
  customerHistory: {
    verifiedCustomerRef: string;
    completedOrders: Array<{
      orderId: string;
      completedAt: string;
      lines: Array<{
        sellableItemId: string;
        categoryId: string;
        quantity: number;
      }>;
    }>;
  } | null;
}
```

`customerHistory` is accepted only when its `verifiedCustomerRef` equals
`request.verifiedCustomerRef`; otherwise starter history is unavailable.
Only completed orders strictly before `decisionTime` are visible.

**Potential candidates:**

```ts
interface PotentialRecommendationCandidate {
  action: RecommendationAction;
  targetId: string;
  sellableItemId: string;
  categoryId: string;
  name: string;
  imageUrl: string | null;
  basePriceVnd: number;
  activeDiscountRatio: number;
  promotionId: string | null;
  parentCartLineId: string | null;
  modifierGroupPath: string[];
}
```

- Product placements enumerate every generated menu item as one `add_product`
  action, including items later found unavailable/ineligible.
- Modifier Upsell finds the authoritative parent cart line and recursively
  enumerates every modifier option under its sellable item. Action IDs are:
  `modifier:<lineId>:<groupId...>:<optionId>`.
- Product action IDs are `product:<sellableItemId>`.
- Product `targetId` is the sellable item ID. Modifier `targetId` is the
  modifier option ID; merchandising always resolves this explicit field.
- Modifier `priceImpact` is its fixture `priceDeltaVnd`; product price impact
  is its current menu price.
- Active discount is derived only from a promotion fact applicable at
  `decisionTime`, store, and fulfilment. Expired facts contribute zero.
- Duplicate modifier IDs at different group paths remain distinct actions.

**Eligibility output:**

```ts
type EligibilityReasonCode =
  | 'eligible'
  | 'placement_already_attempted'
  | 'placement_not_yet_eligible'
  | 'verified_history_required'
  | 'zero_history_required'
  | 'parent_cart_line_required'
  | 'catalog_unavailable'
  | 'store_unavailable'
  | 'non_sellable_product'
  | 'already_in_cart'
  | 'previously_shown'
  | 'previously_rejected'
  | 'verified_dietary_exclusion'
  | 'modifier_parent_mismatch'
  | 'modifier_group_at_capacity'
  | 'no_positive_price_modifier';

interface EligibilityDecision {
  policyVersion: 'kfc-recommendation-policy-v1';
  actionId: string;
  eligible: boolean;
  reasonCodes: EligibilityReasonCode[];
  evidenceBindings: string[];
  digest: string;
}
```

Every potential candidate has exactly one decision. Eligible decisions use
`['eligible']`; ineligible decisions contain every applicable bounded reason in
the enum order above. Digest
`{policyVersion, actionId, eligible, reasonCodes, evidenceBindings}` through
`digestCommerceAction`.

Hard rules:

- An attempted placement is ineligible.
- `local_favorite` requires `starter_ready` and no verified completed order.
- `for_you` requires `starter_ready`, a matching verified ref, and at least one
  completed order before the decision.
- `modifier_upsell` requires `modifier_ready` and a real parent line.
- `smart_cross_sell` requires `smart_cross_sell_ready`.
- Generated item `available` must be true, price must be positive, and the item
  must not be excluded or timeslot-blocked for store/fulfilment.
- Product candidates already in cart, previously shown, previously rejected,
  or present in verified dietary exclusions are ineligible.
- A modifier candidate must come from the parent line's item/path, have
  positive price delta, and not exceed the fixture group's max after current
  cart modifier quantities at the same path.
- All evidence is typed. No name/description/customer text matching.

- [ ] **Step 1: Write failing enumeration and eligibility tests**

At minimum prove:

1. Local Favorite enumerates all 120 products before filtering.
2. KFCVN0002 pickup excludes a real blocked item but keeps `20751`.
3. zero-price giveaway/category entries are recorded ineligible rather than
   deleted before enumeration.
4. cart/shown/rejected/dietary exclusions each produce their exact code.
5. For You rejects missing/mismatched/zero history and accepts matching
   pre-decision completed history.
6. Modifier Upsell recursively enumerates `20752`; zero-price options remain
   recorded while positive `41091`/`41102` paths can be eligible.
7. group capacity and parent mismatch are recorded.
8. every decision digest changes when one evidence binding changes.

- [ ] **Step 2: Observe RED**

```bash
npx vitest run test/recommendations/eligibility.test.ts
```

- [ ] **Step 3: Implement candidate enumeration and eligibility**

Use real generated fixture types. Do not route by category/name keywords.
Sort candidates by action ID before producing decisions.

- [ ] **Step 4: Verify**

```bash
npx vitest run test/recommendations/eligibility.test.ts
npm run check
npm test
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/src/recommendations/eligibility \
  services/kfc-agent-backend/test/recommendations/eligibility.test.ts
git commit -m "feat(kfc): add recommendation eligibility evidence"
```

---

### Task 3: Implement the four deterministic serving rankers

**Files:**

- Create:
  `services/kfc-agent-backend/src/recommendations/ranking/types.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/ranking/contextual-popularity.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/ranking/for-you-affinity.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/ranking/incremental-value.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/ranking/smart-cross-blend.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/ranking/ranker-repository.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/deterministic-rankers.test.ts`

**Shared output:**

```ts
interface RankedCandidate {
  candidate: PotentialRecommendationCandidate;
  score: number;
  reasonCodes: CustomerReasonCode[];
  featureSummary: Record<string, number | string | boolean | null>;
}

interface PlacementRanker {
  version: string;
  rank(input: RankerInput): RankedCandidate[];
}
```

Rankers throw if any supplied candidate lacks an eligible decision. The
repository maps the four exact placements to the four exact serving versions.

**Contextual Popularity:**

Use the first present segment in this order:

1. `<storeId>:<weekday|weekend>:<daypart>`
2. `<storeId>:<daypart>`
3. `<storeId>`
4. global

The Bayesian score for a segment is:

```text
(segmentItemCount + priorStrength × globalShare)
/ (segmentTotal + priorStrength)
```

where `globalShare = globalItemCount / globalTotal`. If the global total is
zero, global share is zero. Presence means the fixture contains that key; a
present zero is not treated as missing. Reason is `popular_here`.

Daypart boundaries in store-local time are exact:

```text
breakfast 05:00..<10:00
lunch 10:00..<14:00
afternoon 14:00..<17:00
dinner 17:00..<22:00
late_night otherwise
```

For the POC fixture, context supplies `storeTimezone: 'Asia/Ho_Chi_Minh'`.
Use `Intl.DateTimeFormat`; do not apply a fixed UTC offset manually.

**For You:**

For each completed line before `decisionTime`:

```text
weight = quantity × 2 ^ (-ageDays / 90)
```

Exact-item and category totals are normalized with the fixed min/max snapshot,
clamped to `[0,1]`, then:

```text
0.55 × exact + 0.25 × category + 0.20 × contextualPopularity
```

Reason codes:

- exact total > 0: `ordered_before`
- otherwise category total > 0: `matches_your_history`
- always include `popular_here` only in technical feature summary, not as a
  second customer reason.

**Modifier Upsell:**

```text
score = log1p(priceImpact.amount)
```

Reason: `completes_your_item`.

**Smart Cross-sell:**

```text
popularityRaw = log1p(2 × storeItemOrderCount + globalItemOrderCount)
popularityZ = (popularityRaw - fixedMean) / fixedStd
discountZ = (activeDiscountRatio - fixedMean) / fixedStd
score = 0.5 × popularityZ + 0.5 × discountZ
```

Reason is `active_offer` when discount ratio is positive, otherwise
`completes_your_meal`.

The Smart Cross-sell ranker returns the complete sorted eligible ranking.
Export a separate pure `composeSmartCrossSellSlate` and apply it only after
merchandising. Slate composer:

1. sort score descending, action ID ascending;
2. unique sellable item IDs;
3. at most two items per category;
4. choose three by default;
5. add a fourth only when its score is positive, its category is not already
   present in the first three, and its price fits `remainingBudgetVnd`;
6. every selected item must fit the running remaining budget when a budget is
   present;
7. return empty when fewer than three products can be composed.

- [ ] **Step 1: Write failing formula and slate tests**

Use the Task 1 fixture plus small inline eligible candidates to prove:

- all back-off levels and Bayesian smoothing;
- weekend/weekday and all daypart boundaries;
- 90-day half-life and future-order exclusion;
- fixed normalization/clamping and exact 0.55/0.25/0.20 blend;
- modifier price ordering and action-ID tie break;
- Smart blend z-scores;
- exactly three default, optional diverse positive fourth, max two/category,
  budget enforcement, and empty if fewer than three.

- [ ] **Step 2: Observe RED**

```bash
npx vitest run test/recommendations/deterministic-rankers.test.ts
```

- [ ] **Step 3: Implement rankers and repository**

Keep all rankers pure. Do not load files, call repositories, read current time,
or mutate candidates inside ranking code.

- [ ] **Step 4: Verify**

```bash
npx vitest run test/recommendations/deterministic-rankers.test.ts
npm run check
npm test
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/src/recommendations/ranking \
  services/kfc-agent-backend/test/recommendations/deterministic-rankers.test.ts
git commit -m "feat(kfc): add deterministic recommendation rankers"
```

---

### Task 4: Add provider-neutral Sanity policy snapshots and resolution

**Files:**

- Create:
  `services/kfc-agent-backend/fixtures/recommendations/sanity-policy-snapshot-v1.json`
- Create:
  `services/kfc-agent-backend/src/recommendations/merchandising/policy.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/merchandising/repository.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/merchandising/local-policy-repository.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/merchandising/sanity-policy-repository.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/merchandising/resolve-policies.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/merchandising-policy.test.ts`
- Modify: `services/kfc-agent-backend/package.json`
- Modify: `services/kfc-agent-backend/package-lock.json`

**Dependency:**

Pin official `@sanity/client` exactly `7.25.0` (Node >=20). The adapter accepts
an injected `SanityClient`; it does not read environment variables or create a
global client.

**Policy snapshot:**

```ts
interface MerchandisingPolicySnapshot {
  schemaVersion: 'kfc-recommendation-policy-snapshot-v1';
  snapshotId: string;
  sourceRevision: string;
  publishedAt: string;
  complete: boolean;
  commerceEnvironment: string;
  policies: RecommendationPolicy[];
}
```

Every strict `RecommendationPolicy` contains:

```text
schemaVersion: kfc-recommendation-policy-v1
policyId, name, description, campaignId, authoredReason
enabled, priority, placement, action
targetIds (ordered, unique)
environment
includedStoreIds, excludedStoreIds
fulfilmentModes
minimumBasketSubtotalVnd|null, maximumBasketSubtotalVnd|null
requiredCartProductIds, excludedCartProductIds
requiredCartCategoryIds, excludedCartCategoryIds
verifiedCohorts
startsAt, endsAt|null
reasonCode (customer reason enum)
approvedText: {vi, en}
boostWeight|null
pinPosition|null
```

Text bounds are exact: name/campaign ID 1..120 characters, description and
authored reason 1..500, each approved localized string 1..240. Constraint
arrays contain at most 100 unique IDs; `targetIds` use the smaller
action-specific limits below.

Action-specific validation:

- `exclude_target`: 1..4 target IDs; no boost/pin.
- `boost_target`: 1..4 targets; `boostWeight` in `[0,1]`; no pin.
- `pin_target`: 1..4 targets; `pinPosition` integer 1..4; no boost.
- `replace_slate`: 1..4 targets; no boost/pin.
- `suppress_placement`: no targets; no boost/pin.

All other arrays are unique. Time is canonical UTC. Min subtotal must not
exceed max.

The fixture includes at least:

1. Local Favorite boost for `20732`, priority 20.
2. For You replacement with ordered `20751`, priority 40.
3. Smart Cross-sell exclusion for `20712`, priority 10.
4. Smart Cross-sell suppression at `KFCVN0036`, priority 100.
5. Modifier pin for option target `41091`, priority 15, position 1.

All are active `2026-01-01` through `2027-01-01` in
`kfc-vietnam-demo`, include approved VI/EN text, and use bounded existing
customer reason codes.

**Repository:**

```ts
interface MerchandisingPolicyRepository {
  loadPublishedSnapshot(): Promise<{
    snapshot: MerchandisingPolicySnapshot;
    binding: {
      snapshotId: string;
      digest: string;
      contributingRevisions: string[];
    };
  }>;
}
```

Local repository parses the fixture and digests the sorted canonical snapshot.
The Sanity adapter performs one published-perspective GROQ query for all
`recommendationPolicy` documents, projects app-owned fields plus `_id`/`_rev`,
parses the complete array atomically, sorts by policy ID, derives
`contributingRevisions` from `_rev`, and computes the same binding. Do not add
retry/outage behavior.

The local and live snapshots set `complete: true` only after the entire array
parses successfully. The fixture uses `snapshotId: sanity-snapshot-001` and
`sourceRevision: sanity-policies-revision-001`.

**Applicability:**

A policy applies only when enabled and all typed constraints match. Scope
specificity is the number of non-empty/non-null constraint fields among:

```text
includedStoreIds, excludedStoreIds, fulfilmentModes,
minimumBasketSubtotalVnd, maximumBasketSubtotalVnd,
requiredCartProductIds, excludedCartProductIds,
requiredCartCategoryIds, excludedCartCategoryIds, verifiedCohorts
```

Sort applicable policies by priority descending, specificity descending,
`startsAt` descending, policy ID ascending.

**Resolution:**

Input contains ranked eligible candidates only plus typed request/store/cart/
cohort facts. Output contains:

```ts
interface MerchandisingResolution {
  suppressed: boolean;
  replacement: RankedCandidate[] | null;
  rankedCandidates: RankedCandidate[];
  effects: MerchandisingEffect[];
  reasonCodes: CustomerReasonCode[];
}
```

Order:

1. union every applicable exclusion;
2. choose the first applicable `suppress_placement`, otherwise the first valid
   `replace_slate` whose entire target list resolves from eligible candidates
   and satisfies placement output size;
3. apply only the strongest boost per target (`score + boostWeight`);
4. apply pins in policy order, then deterministic score/action order;
5. never add a target absent from the eligible input.

A replacement policy with any missing/ineligible target is skipped, not
partially applied. `suppress_placement` wins over replacement regardless of
relative action ordering after applicability sort.

- [ ] **Step 1: Install and write failing policy tests**

```bash
npm install --save-exact @sanity/client@7.25.0
```

Tests cover strict fixture parsing, action-specific fields, every typed
applicability constraint, the four sort keys, exclusions, suppression,
invalid/valid replacement, strongest boost, pins, and no resurrection.
For the Sanity adapter, use a tiny fake implementing only the injected client's
`fetch` call; assert parsed behavior/result, not an exact GROQ string.

- [ ] **Step 2: Observe RED**

```bash
npx vitest run test/recommendations/merchandising-policy.test.ts
```

- [ ] **Step 3: Implement schema, repositories, fixture, and resolver**

The official adapter is a commodity boundary only. All validation, digesting,
applicability, and resolution stay provider-neutral.

- [ ] **Step 4: Verify**

```bash
npx vitest run test/recommendations/merchandising-policy.test.ts
npm run check
npm test
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/fixtures/recommendations/sanity-policy-snapshot-v1.json \
  services/kfc-agent-backend/src/recommendations/merchandising \
  services/kfc-agent-backend/test/recommendations/merchandising-policy.test.ts \
  services/kfc-agent-backend/package.json \
  services/kfc-agent-backend/package-lock.json
git commit -m "feat(kfc): add Sanity merchandising resolution"
```

---

### Task 5: Compose the pure recommendation decision engine

**Files:**

- Create:
  `services/kfc-agent-backend/src/recommendations/application/decision-engine.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/application/types.ts`
- Create:
  `services/kfc-agent-backend/src/recommendations/application/create-bundled-engine.ts`
- Create:
  `services/kfc-agent-backend/test/recommendations/decision-engine.test.ts`

**Interface:**

```ts
interface RecommendationDecisionEngine {
  decide(
    context: RecommendationDecisionContext,
  ): Promise<{
    response: RecommendationDecisionResponse;
    technical: {
      potentialCandidates: PotentialRecommendationCandidate[];
      eligibilityDecisions: EligibilityDecision[];
      eligiblePrePolicyRanking: RankedCandidate[];
      merchandisingResolution: MerchandisingResolution;
      emptyReason:
        | null
        | 'no_eligible_candidates'
        | 'placement_already_attempted'
        | 'placement_not_yet_eligible'
        | 'verified_history_required'
        | 'parent_cart_line_required'
        | 'no_positive_price_modifier'
        | 'merchandising_suppressed'
        | 'invalid_context';
    };
  }>;
}
```

`createBundledRecommendationDecisionEngine()` wires the fixture repositories,
ranker repository, local policy repository, eligibility, and engine. It is for
tests/demo only; core engine depends only on ports.

**Decision order:**

1. Reject authoritative context as `invalid_context` when any request commerce
   binding is incomplete, expired at decision time, or has an environment
   different from ranking/promotion/Sanity snapshots; also reject an
   incomplete ranking, promotion, or Sanity snapshot. Ranking and promotion
   snapshots must satisfy `effectiveAt <= decisionTime < expiresAt`.
2. Enumerate all potential actions.
3. Produce one Eligibility Decision per potential action.
4. If none eligible, return `empty` with null offer and technical empty reason.
5. Rank eligible candidates with the placement's serving ranker.
6. Resolve merchandising.
7. Suppression returns `suppressed`, source `suppressed`, null offer.
8. A valid replacement returns source `merchandising_replacement`; otherwise
   source is `ranked`.
9. Shape the placement:
   - Local Favorite/For You: first one product.
   - Modifier Upsell: first one modifier.
   - Smart Cross-sell: run `composeSmartCrossSellSlate` on the
     post-merchandising complete ranking to produce three/four products.
   - If post-policy shape cannot meet the contract, return `empty`.
10. Construct customer display facts only from authoritative candidate facts.

Deterministic IDs:

```text
recommendationId = recommendation:<first 24 hex of digest(requestId + final actions)>
traceRef = trace:<first 24 hex of digest(requestId + technical evidence)>
```

`versionBindings` use request commerce binding snapshot IDs, the exact policy
version, the Sanity repository binding, placement feature/ranker versions,
`shadowModel: null`, `calibration: null`, request experiment profile ID, and
`loggingPolicy: recommendation-logging-policy-v1`.

Counts:

```text
potential = enumerated candidates
eligible/ineligible = Eligibility Decisions
scored = eligible pre-policy ranked candidates
displayed = final action count
complete = true only when commerce, ranking, promotion, and Sanity snapshots are complete
```

Customer reason codes come from selected ranked candidates, or
`merchandising_selection` for a replacement. Effects are the exact policies
that materially changed the result.
Reason codes are de-duplicated in first-selected-action order.

- [ ] **Step 1: Write failing end-to-end pure-engine tests**

Cover:

1. anonymous zero-history Local Favorite;
2. verified returning For You with a 90-day-decayed exact-item winner;
3. Modifier Upsell on `20752` choosing the highest positive-price compatible
   action with deterministic tie break;
4. Smart Cross-sell producing three, never more than four, and max two/category
   after exclusions, boosts, and pins;
5. attempted/wrong-stage/empty decisions;
6. Sanity exclusion, boost, pin, replacement, and KFCVN0036 suppression;
7. incomplete/mixed/expired snapshot invalid context;
8. no policy resurrects unavailable/cart/dietary candidates;
9. identical canonical input returns byte-equivalent response/technical output;
10. every response parses through
    `parseRecommendationDecisionResponse`.

- [ ] **Step 2: Observe RED**

```bash
npx vitest run test/recommendations/decision-engine.test.ts
```

- [ ] **Step 3: Implement engine and bundled wiring**

Keep response creation separate from eligibility/ranking/policy modules. Do not
persist, perform HTTP, mutate the cart, or invoke an LLM/model.

- [ ] **Step 4: Verify**

```bash
npx vitest run test/recommendations/decision-engine.test.ts
npm run check
npm test
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add \
  services/kfc-agent-backend/src/recommendations/application \
  services/kfc-agent-backend/test/recommendations/decision-engine.test.ts
git commit -m "feat(kfc): compose recommendation decision engine"
```

---

## Plan completion gate

This plan is complete only when:

- real KFC generated fixtures feed catalog/modifier/store/availability facts;
- every potential action receives durable-ready eligibility evidence and digest;
- only eligible candidates reach the rankers;
- all four exact serving formulas and Smart Cross-sell slate constraints pass;
- official Sanity client access is isolated behind the provider-neutral
  repository and local fixtures exercise the same strict snapshot;
- Sanity cannot resurrect an ineligible candidate;
- the pure engine returns contract-valid deterministic customer responses plus
  protected technical evidence for all four placements;
- there is still no HTTP, D1, learned inference, agent, GenUI, Flutter, or
  scenario implementation; and
- backend formatting, lint, typecheck, all tests, and `git diff --check` pass.

After this plan, write the next execution plan for D1 state/events, idempotent
HTTP endpoints, and the protected inspection envelope.
