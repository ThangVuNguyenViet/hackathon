# KFC Fixture-Backed AI Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the phrase-matched KFC agent with an AI-led orchestration path where every business fact is verified by fixture-backed tools, and produce two final live-session videos: Messenger chat and monitor dashboard.

**Architecture:** Add `OrderingDataService` as the only runtime reader of generated fixtures. Expand typed clients around that service, introduce an AI tool planner, replace hardcoded graph branches with a validated tool-execution loop, and make scenario replay assert production tool evidence instead of injected events.

**Tech Stack:** Node.js 22+, TypeScript, Fastify, Vitest, Zod, OpenAI Responses API via `fetch`, existing generated JSON fixtures, existing Flutter monitor dashboard.

## Global Constraints

- Production behavior and live AI scenario replay are the same thing.
- The model decides intent, extracted entities, missing information, tool plan, next action, and customer-facing wording.
- The backend verifies tool names and arguments, fixture-backed facts, irreversible-action safety gates, source/provenance on business claims, and required tool evidence for scenario success.
- Deterministic behavior is allowed only at dependency or test seams: unit tests with mocked model output, fake OMS order IDs, fake payment provider state, fake channel send status, and stable clocks/IDs in test harnesses.
- Deterministic behavior is not allowed for normal business decisions: no hardcoded voucher success such as `KFC50`, no hardcoded cart contents, no hardcoded store assignment such as `store_mock_nearest`, no fixed delivery fee or ETA unless returned by a fulfillment tool, no scenario-specific event injection in production/live replay, and no exact response text assertions for live AI replay.
- Graph nodes, mock clients, and tools do not read raw JSON or CSV directly. They call typed clients, and fixture-backed clients call `OrderingDataService`.
- No order placement without explicit confirmation.
- No payment success without `PaymentClient` output.
- No promotion, discount, or voucher claim without `PromotionClient` output.
- No live reusable promo code claim unless the fixture marks `actualCodeExposed=true` and provides a non-empty public code, or the code is explicitly marked mock-only in test mode.
- No allergen certainty beyond public allergen/content evidence.
- No order preview or order placement when `FulfillmentClient` reports unavailable items, blocked timeslots, missing disposition, or missing store.
- No real external order/payment/customer action in mock mode.
- Final proof requires two videos from the same real live AI run: one Messenger chat video and one monitor dashboard video.

---

## File Structure

Create focused files rather than growing `buildGraph.ts` and `createMockClients.ts` further:

- `services/kfc-agent-backend/src/ordering/types.ts`: fixture-backed domain DTOs, tool DTOs, provenance, fulfillment, promotion, content, invoice, and tool-trace types.
- `services/kfc-agent-backend/src/ordering/orderingDataService.ts`: all generated fixture queries.
- `services/kfc-agent-backend/src/ordering/toolCatalog.ts`: tool-name union, Zod argument schemas, and tool metadata exposed to the AI planner.
- `services/kfc-agent-backend/src/ordering/toolExecutor.ts`: validates and executes tool calls against `ExternalClients`.
- `services/kfc-agent-backend/src/ordering/safetyGates.ts`: backend-owned irreversible-action and unsupported-claim gates.
- `services/kfc-agent-backend/src/llm/toolPlanner.ts`: planner interface, test planner, and OpenAI Responses API planner.
- `services/kfc-agent-backend/src/graph/buildGraph.ts`: replace phrase-matched flow with AI tool loop.
- `services/kfc-agent-backend/src/graph/state.ts`: expand state with entities, fulfillment, promotion, content evidence, payment, invoice, and tool trace.
- `services/kfc-agent-backend/src/clients/interfaces.ts`: expand client contracts.
- `services/kfc-agent-backend/src/mock/createMockClients.ts`: delegate fixture-backed business behavior to `OrderingDataService`.
- `services/kfc-agent-backend/src/scenarios/runner.ts`: remove `applyScenarioEvent` and require production tool traces.
- `services/kfc-agent-backend/src/api/routes.ts`: pass the tool planner into chat/webhook graph execution.
- `services/kfc-agent-backend/src/llm/responseComposer.ts`: stop labeling fallback business output as deterministic production truth; include verified tool evidence.
- `services/kfc-agent-backend/test/ordering/*.test.ts`: data service, tool executor, and safety-gate tests.
- `services/kfc-agent-backend/test/graph/*.test.ts`: graph tests with mocked planner plans.
- `services/kfc-agent-backend/test/scenarios/*.test.ts`: production replay evidence tests.
- `services/kfc-agent-backend/scripts/run-live-ai-replay.ts`: optional CLI to run production AI replay against the same graph.
- `artifacts/kfc-fixture-backed-proof/README.md`: proof checklist and expected video artifact names.

---

### Task 1: Add Ordering Domain Types And Graph State

**Files:**
- Create: `services/kfc-agent-backend/src/ordering/types.ts`
- Modify: `services/kfc-agent-backend/src/graph/state.ts`
- Test: `services/kfc-agent-backend/test/domain/contracts.test.ts`

**Interfaces:**
- Produces: `SourceProvenance`, `ToolTraceEntry`, `FulfillmentState`, `PromotionContext`, `ContentEvidence`, `SelectedModifier`, `ToolCallRequest`, `ToolCallResult`
- Consumes: existing `Cart`, `Order`, `Address`, `ToolResult` from `src/domain/types.ts`

- [ ] **Step 1: Write the failing type contract test**

Modify `services/kfc-agent-backend/test/domain/contracts.test.ts` by adding this test:

```ts
import type {
  ContentEvidence,
  FulfillmentState,
  PromotionContext,
  ToolTraceEntry,
} from '../../src/ordering/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';

it('models fixture-backed evidence in graph state', () => {
  const fulfillment: FulfillmentState = {
    method: 'delivery',
    disposition: 'delivery',
    storeId: 'KFCVN0002',
    storeName: 'KFC BIG C ĐỒNG NAI',
    feeVnd: 18000,
    etaMinutes: 25,
    availability: {
      ok: true,
      checkedItemIds: ['20751'],
      unavailableItemIds: [],
      blockedTimeslotItemIds: [],
      source: {
        fixtureMode: 'public_crawl_seed',
        sourceFile: 'fixtures/generated/store-availability.json',
        sourceApi: 'https://api.kfcvietnam.com.vn/stores',
      },
    },
  };

  const promotionContext: PromotionContext = {
    matchedOfferIds: ['big-order-2026-march-kfc-voucher-30k-min-120k'],
    validation: {
      ok: false,
      reason: 'public_code_not_exposed',
      publicCode: '',
      discountVnd: 0,
      source: {
        fixtureMode: 'public_crawl_seed',
        sourceFile: 'fixtures/generated/promotion-voucher-offers.json',
        sourceUrl: 'https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc',
      },
    },
    caveats: ['Public crawl exposes offer rules but no reusable public code.'],
  };

  const contentEvidence: ContentEvidence = {
    kind: 'allergen',
    title: 'Bảng Thành Phần Dị Ứng',
    snippet: 'Public allergen evidence only; do not claim medical certainty.',
    sourceUrl: 'https://www.kfcvietnam.com.vn/allergen-chart',
    sourceFile: 'fixtures/generated/content-pages.json',
  };

  const trace: ToolTraceEntry = {
    toolName: 'searchPromotions',
    arguments: { query: 'voucher' },
    ok: true,
    resultSummary: '1 offer matched',
    provenance: [promotionContext.validation.source],
  };

  const state: AgentGraphState = {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'web_mock',
    latestUserMessage: 'Có mã giảm giá nào không?',
    intent: 'voucher',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    entities: { voucherText: 'mã giảm giá' },
    fulfillment,
    promotionContext,
    contentEvidence: [contentEvidence],
    toolTrace: [trace],
  };

  expect(state.fulfillment?.storeId).toBe('KFCVN0002');
  expect(state.promotionContext?.validation.reason).toBe('public_code_not_exposed');
  expect(state.contentEvidence?.[0]?.kind).toBe('allergen');
  expect(state.toolTrace?.[0]?.toolName).toBe('searchPromotions');
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/domain/contracts.test.ts
```

Expected: TypeScript/Vitest fails because `src/ordering/types.ts` does not exist and `AgentGraphState` does not include the new fields.

- [ ] **Step 3: Create ordering types**

Create `services/kfc-agent-backend/src/ordering/types.ts`:

```ts
import type { Address, Cart, MenuItem, Order } from '../domain/types.js';

export type FixtureMode = 'public_crawl_seed' | 'mock_external_state' | 'test_only';
export type Disposition = 'pickup' | 'delivery';
export type FulfillmentMethod = 'pickup' | 'delivery';
export type ContentKind = 'promotion' | 'news' | 'allergen' | 'policy';

export interface SourceProvenance {
  fixtureMode: FixtureMode;
  sourceFile: string;
  sourceUrl?: string;
  sourceApi?: string;
}

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  modifierId: string;
  modifierName: string;
  quantity: number;
  priceDeltaVnd: number;
}

export interface CartMutationInput {
  itemCode: string;
  quantity: number;
  modifiers?: SelectedModifier[];
}

export interface ItemAvailabilityResult {
  ok: boolean;
  checkedItemIds: string[];
  unavailableItemIds: string[];
  blockedTimeslotItemIds: string[];
  source: SourceProvenance;
}

export interface FulfillmentState {
  method: FulfillmentMethod;
  disposition: Disposition;
  storeId: string;
  storeName: string;
  feeVnd: number;
  etaMinutes: number;
  availability: ItemAvailabilityResult;
}

export interface PromotionValidationResult {
  ok: boolean;
  reason: 'validated' | 'not_found' | 'minimum_not_met' | 'expired' | 'public_code_not_exposed' | 'not_redeemable_publicly';
  publicCode: string;
  discountVnd: number;
  source: SourceProvenance;
}

export interface PromotionContext {
  matchedOfferIds: string[];
  validation?: PromotionValidationResult;
  caveats: string[];
}

export interface ContentEvidence {
  kind: ContentKind;
  title: string;
  snippet: string;
  sourceUrl: string;
  sourceFile: string;
}

export interface CustomerContext {
  savedAddresses: Address[];
  recentOrders: Order[];
  favorites: MenuItem[];
  loyaltyPoints?: number;
}

export interface PaymentAttempt {
  method: 'momo' | 'card' | 'cod';
  status: 'pending' | 'paid' | 'failed';
  paymentUrl?: string;
}

export interface InvoiceRequest {
  companyName: string;
  taxCode: string;
  email: string;
}

export interface HandoffState {
  escalationId: string;
  reasons: string[];
}

export type ToolName =
  | 'searchMenu'
  | 'getItemDetails'
  | 'getModifierOptions'
  | 'updateCart'
  | 'previewCart'
  | 'recommendAddOns'
  | 'findStores'
  | 'checkStoreAvailability'
  | 'quoteFulfillment'
  | 'searchPromotions'
  | 'explainPromotion'
  | 'validateVoucher'
  | 'searchContentPolicy'
  | 'answerAllergenQuestion'
  | 'previewOrder'
  | 'placeOrder'
  | 'getOrderStatus'
  | 'createPaymentLink'
  | 'checkPaymentStatus'
  | 'collectInvoice'
  | 'handoff';

export interface ToolCallRequest {
  toolName: ToolName;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolName: ToolName;
  ok: boolean;
  value?: unknown;
  errorCode?: string;
  message: string;
  provenance: SourceProvenance[];
}

export interface ToolTraceEntry {
  toolName: ToolName;
  arguments: Record<string, unknown>;
  ok: boolean;
  resultSummary: string;
  provenance: SourceProvenance[];
}

export interface AgentEntities {
  itemText?: string;
  itemCodes?: string[];
  quantities?: Record<string, number>;
  addressText?: string;
  fulfillmentMethod?: FulfillmentMethod;
  voucherText?: string;
  paymentMethod?: 'momo' | 'card' | 'cod';
  orderId?: string;
  invoice?: Partial<InvoiceRequest>;
}

export interface CartWithModifiers extends Cart {
  selectedModifiers?: Record<string, SelectedModifier[]>;
}
```

- [ ] **Step 4: Extend graph state**

Modify `services/kfc-agent-backend/src/graph/state.ts`:

```ts
import type { Address, Cart, Channel, Intent, Order } from '../domain/types.js';
import type {
  AgentEntities,
  ContentEvidence,
  CustomerContext,
  FulfillmentState,
  HandoffState,
  InvoiceRequest,
  PaymentAttempt,
  PromotionContext,
  SelectedModifier,
  ToolTraceEntry,
} from '../ordering/types.js';

export interface RetrievedEvidence {
  eventId: string;
  timestamp: string;
  sourceType: string;
  confidence: number;
  payload: Record<string, unknown>;
}

export interface AgentGraphState {
  sessionId: string;
  customerId: string;
  channel: Channel;
  latestUserMessage: string;
  intent: Intent;
  cart?: Cart;
  address?: Address;
  orderPreview?: Order;
  order?: Order;
  userConfirmedOrder: boolean;
  escalationReasons: string[];
  retrievedEvidence: RetrievedEvidence[];
  entities?: AgentEntities;
  selectedModifiers?: Record<string, SelectedModifier[]>;
  fulfillment?: FulfillmentState;
  promotionContext?: PromotionContext;
  contentEvidence?: ContentEvidence[];
  customerContext?: CustomerContext;
  paymentAttempt?: PaymentAttempt;
  invoiceRequest?: InvoiceRequest;
  handoff?: HandoffState;
  toolTrace?: ToolTraceEntry[];
}
```

- [ ] **Step 5: Run the contract test**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/domain/contracts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/kfc-agent-backend/src/ordering/types.ts services/kfc-agent-backend/src/graph/state.ts services/kfc-agent-backend/test/domain/contracts.test.ts
git commit -m "feat: add KFC ordering evidence state types"
```

---

### Task 2: Implement OrderingDataService Over All Generated Fixtures

**Files:**
- Create: `services/kfc-agent-backend/src/ordering/orderingDataService.ts`
- Create: `services/kfc-agent-backend/test/ordering/ordering-data-service.test.ts`

**Interfaces:**
- Consumes: `GeneratedFixtures`, `GeneratedMenuItem`, `GeneratedMenuModifier`, `GeneratedStore`, `GeneratedStoreAvailability`, `GeneratedPromotionVoucherOffer`, `GeneratedContentPage`
- Produces: `OrderingDataService` with `searchMenu`, `getMenuItem`, `getModifierTree`, `recommendAddOns`, `searchStores`, `getStoreAvailability`, `checkItemsAvailable`, `searchPromotionOffers`, `explainPromotion`, `validateVoucherInput`, `searchContent`, `getAllergenEvidence`

- [ ] **Step 1: Write failing service tests**

Create `services/kfc-agent-backend/test/ordering/ordering-data-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';

describe('OrderingDataService', () => {
  async function service() {
    return new OrderingDataService(await loadGeneratedFixtures(process.cwd()));
  }

  it('searches menu and returns provenance-backed Vietnamese items', async () => {
    const data = await service();
    const results = data.searchMenu('Combo Hợp Gu 99K');
    expect(results[0]).toMatchObject({
      code: '20751',
      name: 'Combo Hợp Gu 99K',
      provenance: expect.objectContaining({ fixtureMode: 'public_crawl_seed' }),
    });
  });

  it('returns modifier tree for customizable products', async () => {
    const data = await service();
    const tree = data.getModifierTree('20751');
    expect(tree?.modifierGroups.length).toBeGreaterThan(0);
    expect(JSON.stringify(tree)).toContain('Pepsi');
  });

  it('searches stores and checks store availability by disposition', async () => {
    const data = await service();
    const stores = data.searchStores({ city: 'ĐỒNG NAI', query: 'Biên Hòa' });
    expect(stores[0]?.storeId).toMatch(/^KFCVN/);

    const availability = data.checkItemsAvailable({
      storeId: 'KFCVN0002',
      disposition: 'pickup',
      itemIds: ['20751'],
    });
    expect(availability.checkedItemIds).toEqual(['20751']);
    expect(availability.source.sourceFile).toContain('store-availability');
  });

  it('searches public promotions but does not expose reusable public codes', async () => {
    const data = await service();
    const offers = data.searchPromotionOffers({ query: 'voucher KFC giảm 30.000' });
    expect(offers.some((offer) => offer.offerId.includes('voucher'))).toBe(true);

    const validation = data.validateVoucherInput({
      inputCodeOrText: 'KFC50',
      subtotalVnd: 250000,
    });
    expect(validation.ok).toBe(false);
    expect(validation.reason).toBe('public_code_not_exposed');
    expect(validation.publicCode).toBe('');
  });

  it('returns allergen/content evidence without medical certainty', async () => {
    const data = await service();
    const evidence = data.getAllergenEvidence('gà phô mai');
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]?.kind).toBe('allergen');
    expect(evidence[0]?.sourceUrl).toContain('allergen-chart');
  });
});
```

- [ ] **Step 2: Run service tests to verify they fail**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/ordering/ordering-data-service.test.ts
```

Expected: FAIL because `OrderingDataService` is missing.

- [ ] **Step 3: Implement `OrderingDataService`**

Create `services/kfc-agent-backend/src/ordering/orderingDataService.ts`:

```ts
import type {
  GeneratedContentPage,
  GeneratedFixtures,
  GeneratedMenuItem,
  GeneratedMenuModifier,
  GeneratedPromotionVoucherOffer,
  GeneratedStore,
  GeneratedStoreAvailability,
} from '../fixtures/schema.js';
import type {
  ContentEvidence,
  Disposition,
  ItemAvailabilityResult,
  PromotionValidationResult,
  SourceProvenance,
} from './types.js';

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokens(value: string): string[] {
  return normalizeSearchText(value).match(/[a-z0-9]+/g) ?? [];
}

function includesAll(haystack: string, query: string): boolean {
  const haystackText = normalizeSearchText(haystack);
  const queryTokens = tokens(query).filter((token) => token.length > 1);
  return queryTokens.length > 0 && queryTokens.every((token) => haystackText.includes(token));
}

function menuProvenance(item: GeneratedMenuItem): SourceProvenance {
  return {
    fixtureMode: item.provenance.fixtureMode,
    sourceFile: item.provenance.sourceFile,
    sourceApi: item.provenance.sourceApi,
  };
}

function storeProvenance(store: GeneratedStore): SourceProvenance {
  return {
    fixtureMode: store.provenance.fixtureMode,
    sourceFile: store.provenance.sourceFile,
  };
}

function availabilityProvenance(store: GeneratedStoreAvailability): SourceProvenance {
  return {
    fixtureMode: store.provenance.fixtureMode,
    sourceFile: store.provenance.sourceFile,
    sourceApi: store.provenance.sourceApi,
  };
}

function offerProvenance(offer: GeneratedPromotionVoucherOffer): SourceProvenance {
  return {
    fixtureMode: 'public_crawl_seed',
    sourceFile: offer.sourceFile,
    sourceUrl: offer.sourceUrl,
  };
}

function contentKind(page: GeneratedContentPage): ContentEvidence['kind'] {
  if (page.kind === 'allergen') return 'allergen';
  if (page.kind === 'promotion') return 'promotion';
  if (page.kind === 'news') return 'news';
  return 'policy';
}

export interface StoreSearchInput {
  query?: string;
  city?: string;
  district?: string;
}

export interface AvailabilityInput {
  storeId: string;
  disposition: Disposition;
  itemIds: string[];
}

export interface PromotionSearchInput {
  query: string;
  subtotalVnd?: number;
  channel?: string;
}

export interface VoucherValidationInput {
  inputCodeOrText: string;
  subtotalVnd: number;
}

export class OrderingDataService {
  private readonly menuByCode: Map<string, GeneratedMenuItem>;
  private readonly menuByItemId: Map<string, GeneratedMenuItem>;
  private readonly modifierByItemId: Map<string, GeneratedMenuModifier>;
  private readonly storesById: Map<string, GeneratedStore>;
  private readonly availabilityByStoreId: Map<string, GeneratedStoreAvailability>;
  private readonly offersById: Map<string, GeneratedPromotionVoucherOffer>;

  constructor(private readonly fixtures: GeneratedFixtures) {
    this.menuByCode = new Map(fixtures.menuItems.map((item) => [item.code, item]));
    this.menuByItemId = new Map(fixtures.menuItems.map((item) => [item.itemId, item]));
    this.modifierByItemId = new Map(fixtures.menuModifiers.map((modifier) => [modifier.itemId, modifier]));
    this.storesById = new Map(fixtures.stores.map((store) => [store.storeId, store]));
    this.availabilityByStoreId = new Map(fixtures.storeAvailability.map((availability) => [availability.storeId, availability]));
    this.offersById = new Map(fixtures.promotionVoucherOffers.map((offer) => [offer.offerId, offer]));
  }

  searchMenu(query: string): Array<GeneratedMenuItem & { provenance: SourceProvenance }> {
    return this.fixtures.menuItems
      .filter((item) => includesAll(`${item.name} ${item.description} ${item.category} ${item.productCode}`, query))
      .map((item) => ({ ...item, provenance: menuProvenance(item) }))
      .slice(0, 10);
  }

  getMenuItem(itemIdOrCode: string): (GeneratedMenuItem & { provenance: SourceProvenance }) | undefined {
    const item = this.menuByCode.get(itemIdOrCode) ?? this.menuByItemId.get(itemIdOrCode);
    return item ? { ...item, provenance: menuProvenance(item) } : undefined;
  }

  getModifierTree(itemIdOrCode: string): GeneratedMenuModifier | undefined {
    const item = this.getMenuItem(itemIdOrCode);
    return item ? this.modifierByItemId.get(item.itemId) : undefined;
  }

  recommendAddOns(): Array<GeneratedMenuItem & { provenance: SourceProvenance }> {
    return this.fixtures.menuItems
      .filter((item) => ['Thức Ăn Nhẹ', 'Thức Uống & Tráng Miệng', 'Upsell_2'].includes(item.category))
      .slice(0, 6)
      .map((item) => ({ ...item, provenance: menuProvenance(item) }));
  }

  searchStores(input: StoreSearchInput): Array<GeneratedStore & { provenance: SourceProvenance }> {
    const query = [input.query, input.city, input.district].filter(Boolean).join(' ');
    const matched = this.fixtures.stores.filter((store) =>
      query.length === 0 ? true : includesAll(`${store.name} ${store.address} ${store.city}`, query),
    );
    return (matched.length > 0 ? matched : this.fixtures.stores)
      .slice(0, 10)
      .map((store) => ({ ...store, provenance: storeProvenance(store) }));
  }

  getStoreAvailability(storeId: string, disposition: Disposition): GeneratedStoreAvailability[Disposition] | undefined {
    return this.availabilityByStoreId.get(storeId)?.[disposition];
  }

  checkItemsAvailable(input: AvailabilityInput): ItemAvailabilityResult {
    const availability = this.availabilityByStoreId.get(input.storeId);
    const source = availability
      ? availabilityProvenance(availability)
      : { fixtureMode: 'public_crawl_seed' as const, sourceFile: 'fixtures/generated/store-availability.json' };
    const disposition = availability?.[input.disposition];
    const excluded = new Set(disposition?.excludedItemIds ?? []);
    const blockedTimeslotItems = new Set((disposition?.timeslotExclusions ?? []).map((rule) => rule.itemId));
    return {
      ok: input.itemIds.every((itemId) => !excluded.has(itemId) && !blockedTimeslotItems.has(itemId)),
      checkedItemIds: input.itemIds,
      unavailableItemIds: input.itemIds.filter((itemId) => excluded.has(itemId)),
      blockedTimeslotItemIds: input.itemIds.filter((itemId) => blockedTimeslotItems.has(itemId)),
      source,
    };
  }

  searchPromotionOffers(input: PromotionSearchInput): GeneratedPromotionVoucherOffer[] {
    const query = input.query;
    return this.fixtures.promotionVoucherOffers
      .filter((offer) =>
        includesAll(
          `${offer.campaign} ${offer.offerName} ${offer.offerType} ${offer.partnerBrand} ${offer.appliesTo} ${offer.evidenceText}`,
          query,
        ),
      )
      .slice(0, 10);
  }

  explainPromotion(offerId: string): GeneratedPromotionVoucherOffer | undefined {
    return this.offersById.get(offerId);
  }

  validateVoucherInput(input: VoucherValidationInput): PromotionValidationResult {
    const matchingPublicCode = this.fixtures.promotionVoucherOffers.find(
      (offer) => offer.actualCodeExposed && offer.publicCode && normalizeSearchText(offer.publicCode) === normalizeSearchText(input.inputCodeOrText),
    );
    if (!matchingPublicCode) {
      const publicOffer = this.fixtures.promotionVoucherOffers.find((offer) => /voucher|mã|code/i.test(offer.evidenceText));
      return {
        ok: false,
        reason: 'public_code_not_exposed',
        publicCode: '',
        discountVnd: 0,
        source: publicOffer ? offerProvenance(publicOffer) : { fixtureMode: 'public_crawl_seed', sourceFile: 'fixtures/generated/promotion-voucher-offers.json' },
      };
    }

    const minimum = typeof matchingPublicCode.minimumOrderVnd === 'number' ? matchingPublicCode.minimumOrderVnd : 0;
    if (input.subtotalVnd < minimum) {
      return {
        ok: false,
        reason: 'minimum_not_met',
        publicCode: matchingPublicCode.publicCode,
        discountVnd: 0,
        source: offerProvenance(matchingPublicCode),
      };
    }

    return {
      ok: true,
      reason: 'validated',
      publicCode: matchingPublicCode.publicCode,
      discountVnd: typeof matchingPublicCode.discountAmountVnd === 'number' ? matchingPublicCode.discountAmountVnd : 0,
      source: offerProvenance(matchingPublicCode),
    };
  }

  searchContent(kind: ContentEvidence['kind'] | 'all', query: string): ContentEvidence[] {
    return this.fixtures.contentPages
      .filter((page) => (kind === 'all' || contentKind(page) === kind) && includesAll(`${page.title} ${page.markdown}`, query))
      .slice(0, 5)
      .map((page) => ({
        kind: contentKind(page),
        title: page.title,
        snippet: page.markdown.slice(0, 600),
        sourceUrl: page.sourceUrl,
        sourceFile: page.provenance.sourceFile,
      }));
  }

  getAllergenEvidence(query: string): ContentEvidence[] {
    const results = this.searchContent('allergen', query);
    if (results.length > 0) return results;
    return this.fixtures.contentPages
      .filter((page) => page.kind === 'allergen')
      .slice(0, 1)
      .map((page) => ({
        kind: 'allergen',
        title: page.title,
        snippet: page.markdown.slice(0, 600),
        sourceUrl: page.sourceUrl,
        sourceFile: page.provenance.sourceFile,
      }));
  }
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/ordering/ordering-data-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```bash
cd services/kfc-agent-backend
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/kfc-agent-backend/src/ordering/orderingDataService.ts services/kfc-agent-backend/test/ordering/ordering-data-service.test.ts
git commit -m "feat: add KFC ordering data service"
```

---

### Task 3: Expand Client Interfaces And Fixture-Backed Mock Clients

**Files:**
- Modify: `services/kfc-agent-backend/src/clients/interfaces.ts`
- Modify: `services/kfc-agent-backend/src/mock/createMockClients.ts`
- Modify: `services/kfc-agent-backend/test/fixtures/testFixtures.ts`
- Modify: `services/kfc-agent-backend/test/mock/mock-clients.test.ts`

**Interfaces:**
- Consumes: `OrderingDataService`, `SelectedModifier`, `FulfillmentState`, `ContentEvidence`, `PromotionValidationResult`
- Produces: expanded `ExternalClients` with `content`, `fulfillment`, `invoice`, and fixture-backed methods on existing clients

- [ ] **Step 1: Write failing mock-client tests**

Append to `services/kfc-agent-backend/test/mock/mock-clients.test.ts`:

```ts
it('returns modifier options from generated fixture data', async () => {
  const clients = createMockClients(fixtures);
  const details = await clients.menu.getModifierOptions('20751');
  expect(details.ok).toBe(true);
  expect(details.value?.modifierGroups.length).toBeGreaterThan(0);
});

it('uses fixture-backed promotion validation instead of hardcoded KFC50 success', async () => {
  const clients = createMockClients(fixtures);
  const cart = (await clients.cart.createCart('session_1')).value!;
  const updated = (await clients.cart.updateCart(cart, '20751', 3)).value!;
  const validation = await clients.promotion.validateVoucher(updated, 'KFC50');
  expect(validation.ok).toBe(false);
  expect(validation.errorCode).toBe('public_code_not_exposed');
});

it('quotes fulfillment from fixture store and availability data', async () => {
  const clients = createMockClients(fixtures);
  const quote = await clients.fulfillment.quoteFulfillment({
    address: { label: 'Home', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'ĐỒNG NAI' },
    method: 'delivery',
    itemCodes: ['20751'],
  });
  expect(quote.ok).toBe(true);
  expect(quote.value?.storeId).toMatch(/^KFCVN/);
  expect(quote.value?.availability.checkedItemIds).toEqual(['20751']);
});

it('answers allergen questions from content fixtures', async () => {
  const clients = createMockClients(fixtures);
  const evidence = await clients.content.answerAllergenQuestion('phô mai');
  expect(evidence.ok).toBe(true);
  expect(evidence.value?.[0]?.kind).toBe('allergen');
});
```

- [ ] **Step 2: Run mock-client tests to verify they fail**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/mock/mock-clients.test.ts
```

Expected: FAIL because the new client methods do not exist.

- [ ] **Step 3: Expand client interfaces**

Modify `services/kfc-agent-backend/src/clients/interfaces.ts` to include these additions:

```ts
import type { Address, Cart, MenuItem, Order, ToolResult } from '../domain/types.js';
import type {
  ContentEvidence,
  FulfillmentMethod,
  FulfillmentState,
  InvoiceRequest,
  PromotionValidationResult,
  SelectedModifier,
} from '../ordering/types.js';
import type { GeneratedMenuModifier, GeneratedPromotionVoucherOffer } from '../fixtures/schema.js';

export interface MenuClient {
  searchMenu(query: string): Promise<ToolResult<MenuItem[]>>;
  getItemDetails(code: string): Promise<ToolResult<MenuItem>>;
  getModifierOptions(code: string): Promise<ToolResult<GeneratedMenuModifier>>;
}

export interface CartClient {
  createCart(sessionId: string): Promise<ToolResult<Cart>>;
  updateCart(cart: Cart, itemCode: string, quantity: number, modifiers?: SelectedModifier[]): Promise<ToolResult<Cart>>;
  previewCart(cart: Cart): Promise<ToolResult<Cart>>;
}

export interface RecommendationClient {
  recommendAddOns(cart: Cart): Promise<ToolResult<MenuItem[]>>;
}

export interface PromotionClient {
  searchPromotions(query: string): Promise<ToolResult<GeneratedPromotionVoucherOffer[]>>;
  explainPromotion(offerId: string): Promise<ToolResult<GeneratedPromotionVoucherOffer>>;
  validateVoucher(cart: Cart, voucherCode: string): Promise<ToolResult<Cart>>;
  validateVoucherInput(cart: Cart, inputCodeOrText: string): Promise<ToolResult<PromotionValidationResult>>;
}

export interface InventoryClient {
  checkInventory(storeId: string, itemCodes: string[], disposition?: 'pickup' | 'delivery'): Promise<ToolResult<Record<string, boolean>>>;
}

export interface StoreLocatorClient {
  assignStore(address: Address, itemCodes: string[]): Promise<ToolResult<{ storeId: string; etaMinutes: number }>>;
  findStores(input: { query?: string; city?: string; district?: string }): Promise<ToolResult<Array<{ storeId: string; name: string; address: string; city: string }>>>;
}

export interface FulfillmentClient {
  quoteFulfillment(input: {
    address: Address;
    method: FulfillmentMethod;
    itemCodes: string[];
  }): Promise<ToolResult<FulfillmentState>>;
}

export interface ContentClient {
  searchContent(kind: 'promotion' | 'news' | 'allergen' | 'policy' | 'all', query: string): Promise<ToolResult<ContentEvidence[]>>;
  answerAllergenQuestion(query: string): Promise<ToolResult<ContentEvidence[]>>;
}

export interface InvoiceClient {
  collectInvoice(input: Partial<InvoiceRequest>): Promise<ToolResult<InvoiceRequest>>;
}
```

Also add `fulfillment`, `content`, and `invoice` to `ExternalClients`.

- [ ] **Step 4: Update mock clients to use OrderingDataService**

Modify `services/kfc-agent-backend/src/mock/createMockClients.ts`:

```ts
import { OrderingDataService } from '../ordering/orderingDataService.js';
```

Inside `createMockClients`, create:

```ts
const data = new OrderingDataService(fixtures);
```

Replace menu search/details with service-backed calls:

```ts
menu: {
  async searchMenu(query) {
    return ok(data.searchMenu(query).map(toMenuItem));
  },
  async getItemDetails(code) {
    const item = data.getMenuItem(code);
    return item ? ok(toMenuItem(item)) : fail('item_not_found', `No menu item found for ${code}`);
  },
  async getModifierOptions(code) {
    const tree = data.getModifierTree(code);
    return tree ? ok(tree) : fail('modifiers_not_found', `No modifier tree found for ${code}`);
  },
},
```

Replace promotion validation:

```ts
promotion: {
  async searchPromotions(query) {
    return ok(data.searchPromotionOffers({ query }));
  },
  async explainPromotion(offerId) {
    const offer = data.explainPromotion(offerId);
    return offer ? ok(offer) : fail('promotion_not_found', `No promotion found for ${offerId}`);
  },
  async validateVoucher(cart, voucherCode) {
    const validation = data.validateVoucherInput({ inputCodeOrText: voucherCode, subtotalVnd: cart.subtotalVnd });
    if (!validation.ok) return fail(validation.reason, 'Voucher could not be validated from public fixture data');
    return ok({ ...priceCart(cart.items, voucherCode, cart.deliveryFeeVnd), id: cart.id }, 'voucher_applied');
  },
  async validateVoucherInput(cart, inputCodeOrText) {
    return ok(data.validateVoucherInput({ inputCodeOrText, subtotalVnd: cart.subtotalVnd }));
  },
},
```

Add fulfillment/content/invoice clients:

```ts
fulfillment: {
  async quoteFulfillment(input) {
    const store = data.searchStores({ query: `${input.address.line1} ${input.address.district} ${input.address.city}` })[0];
    if (!store) return fail('store_not_found', 'No store matched the requested fulfillment address');
    const availability = data.checkItemsAvailable({
      storeId: store.storeId,
      disposition: input.method === 'pickup' ? 'pickup' : 'delivery',
      itemIds: input.itemCodes,
    });
    if (!availability.ok) return fail('items_unavailable', 'One or more items are unavailable for this store/disposition');
    return ok({
      method: input.method,
      disposition: input.method === 'pickup' ? 'pickup' : 'delivery',
      storeId: store.storeId,
      storeName: store.name,
      feeVnd: input.method === 'delivery' ? 18000 : 0,
      etaMinutes: input.method === 'delivery' ? 25 : 15,
      availability,
    });
  },
},
content: {
  async searchContent(kind, query) {
    return ok(data.searchContent(kind, query));
  },
  async answerAllergenQuestion(query) {
    return ok(data.getAllergenEvidence(query));
  },
},
invoice: {
  async collectInvoice(input) {
    if (!input.companyName || !input.taxCode || !input.email) {
      return fail('invoice_fields_missing', 'Company name, tax code, and email are required for invoice requests');
    }
    return ok({ companyName: input.companyName, taxCode: input.taxCode, email: input.email });
  },
},
```

Keep OMS/payment/channel as mock external side effects, but ensure they consume verified cart/order state.

- [ ] **Step 5: Run mock-client tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/mock/mock-clients.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
cd services/kfc-agent-backend
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/kfc-agent-backend/src/clients/interfaces.ts services/kfc-agent-backend/src/mock/createMockClients.ts services/kfc-agent-backend/test/fixtures/testFixtures.ts services/kfc-agent-backend/test/mock/mock-clients.test.ts
git commit -m "feat: back mock clients with KFC fixtures"
```

---

### Task 4: Add Tool Catalog, Executor, And Safety Gates

**Files:**
- Create: `services/kfc-agent-backend/src/ordering/toolCatalog.ts`
- Create: `services/kfc-agent-backend/src/ordering/toolExecutor.ts`
- Create: `services/kfc-agent-backend/src/ordering/safetyGates.ts`
- Create: `services/kfc-agent-backend/test/ordering/tool-executor.test.ts`
- Create: `services/kfc-agent-backend/test/ordering/safety-gates.test.ts`

**Interfaces:**
- Consumes: `ExternalClients`, `AgentGraphState`, `ToolCallRequest`
- Produces: `executeToolCall(clients, state, request)`, `applySafetyGates(state, plannedCalls)`

- [ ] **Step 1: Write failing tool executor tests**

Create `services/kfc-agent-backend/test/ordering/tool-executor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const clients = createMockClients(createTestFixtures());

describe('tool executor', () => {
  it('validates and executes menu search', async () => {
    const result = await executeToolCall(clients, { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.value)).toContain('Combo Hợp Gu 99K');
  });

  it('rejects invalid tool arguments before client execution', async () => {
    const result = await executeToolCall(clients, { toolName: 'searchMenu', arguments: { q: 'wrong' } });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_tool_arguments');
  });

  it('executes promotion search without inventing public codes', async () => {
    const result = await executeToolCall(clients, { toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ ok: false, reason: 'public_code_not_exposed', publicCode: '' });
  });
});
```

- [ ] **Step 2: Write failing safety-gate tests**

Create `services/kfc-agent-backend/test/ordering/safety-gates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AgentGraphState } from '../../src/graph/state.js';
import { applySafetyGates } from '../../src/ordering/safetyGates.js';

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'web_mock',
    latestUserMessage: 'xác nhận đơn',
    intent: 'ordering',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

describe('safety gates', () => {
  it('blocks placeOrder without explicit confirmation', () => {
    const result = applySafetyGates(state(), [{ toolName: 'placeOrder', arguments: {} }]);
    expect(result.allowedCalls).toHaveLength(0);
    expect(result.blockedReasons).toContain('order_confirmation_required');
  });

  it('blocks promo claim when no promotion tool evidence exists', () => {
    const result = applySafetyGates(state(), [{ toolName: 'previewOrder', arguments: {} }], {
      responseClaims: ['promotion'],
    });
    expect(result.blockedReasons).toContain('promotion_evidence_required');
  });

  it('allows placeOrder after confirmation and valid fulfillment', () => {
    const result = applySafetyGates(
      state({
        userConfirmedOrder: true,
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'KFCVN0002',
          storeName: 'KFC BIG C ĐỒNG NAI',
          feeVnd: 18000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['20751'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: { fixtureMode: 'public_crawl_seed', sourceFile: 'fixtures/generated/store-availability.json' },
          },
        },
      }),
      [{ toolName: 'placeOrder', arguments: {} }],
    );
    expect(result.blockedReasons).toEqual([]);
    expect(result.allowedCalls[0]?.toolName).toBe('placeOrder');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/ordering/tool-executor.test.ts test/ordering/safety-gates.test.ts
```

Expected: FAIL because the tool catalog, executor, and gates do not exist.

- [ ] **Step 4: Implement tool catalog**

Create `services/kfc-agent-backend/src/ordering/toolCatalog.ts`:

```ts
import { z } from 'zod';
import type { ToolName } from './types.js';

export const toolArgumentSchemas = {
  searchMenu: z.object({ query: z.string().min(1) }),
  getItemDetails: z.object({ code: z.string().min(1) }),
  getModifierOptions: z.object({ code: z.string().min(1) }),
  updateCart: z.object({ itemCode: z.string().min(1), quantity: z.number().int().nonnegative() }),
  previewCart: z.object({}),
  recommendAddOns: z.object({}),
  findStores: z.object({ query: z.string().optional(), city: z.string().optional(), district: z.string().optional() }),
  checkStoreAvailability: z.object({
    storeId: z.string().min(1),
    itemCodes: z.array(z.string().min(1)),
    disposition: z.enum(['pickup', 'delivery']).optional(),
  }),
  quoteFulfillment: z.object({
    address: z.object({ label: z.string(), line1: z.string(), district: z.string(), city: z.string() }),
    method: z.enum(['pickup', 'delivery']),
    itemCodes: z.array(z.string().min(1)),
  }),
  searchPromotions: z.object({ query: z.string().min(1) }),
  explainPromotion: z.object({ offerId: z.string().min(1) }),
  validateVoucher: z.object({ voucherText: z.string().min(1), subtotalVnd: z.number().int().nonnegative() }),
  searchContentPolicy: z.object({ kind: z.enum(['promotion', 'news', 'allergen', 'policy', 'all']), query: z.string().min(1) }),
  answerAllergenQuestion: z.object({ query: z.string().min(1) }),
  previewOrder: z.object({}),
  placeOrder: z.object({}),
  getOrderStatus: z.object({ orderId: z.string().min(1) }),
  createPaymentLink: z.object({ method: z.enum(['momo', 'card', 'cod']) }),
  checkPaymentStatus: z.object({ orderId: z.string().min(1) }),
  collectInvoice: z.object({ companyName: z.string().optional(), taxCode: z.string().optional(), email: z.string().email().optional() }),
  handoff: z.object({ reasons: z.array(z.string().min(1)) }),
} satisfies Record<ToolName, z.ZodTypeAny>;

export const toolNames = Object.keys(toolArgumentSchemas) as ToolName[];

export function parseToolArguments(toolName: ToolName, args: Record<string, unknown>) {
  return toolArgumentSchemas[toolName].safeParse(args);
}
```

- [ ] **Step 5: Implement tool executor**

Create `services/kfc-agent-backend/src/ordering/toolExecutor.ts`:

```ts
import type { ExternalClients } from '../clients/interfaces.js';
import type { Cart } from '../domain/types.js';
import { parseToolArguments } from './toolCatalog.js';
import type { SourceProvenance, ToolCallRequest, ToolCallResult } from './types.js';

const emptyProvenance: SourceProvenance[] = [];

function result(request: ToolCallRequest, ok: boolean, value: unknown, message: string, errorCode?: string): ToolCallResult {
  return { toolName: request.toolName, ok, value, message, errorCode, provenance: emptyProvenance };
}

export async function executeToolCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: { cart?: Cart } = {},
): Promise<ToolCallResult> {
  const parsed = parseToolArguments(request.toolName, request.arguments);
  if (!parsed.success) return result(request, false, undefined, parsed.error.message, 'invalid_tool_arguments');
  const args = parsed.data as Record<string, unknown>;

  switch (request.toolName) {
    case 'searchMenu':
      return result(request, true, (await clients.menu.searchMenu(args.query as string)).value ?? [], 'ok');
    case 'getItemDetails':
      return result(request, true, (await clients.menu.getItemDetails(args.code as string)).value, 'ok');
    case 'getModifierOptions':
      return result(request, true, (await clients.menu.getModifierOptions(args.code as string)).value, 'ok');
    case 'updateCart':
      if (!context.cart) return result(request, false, undefined, 'Cart is required before updateCart', 'cart_required');
      return result(
        request,
        true,
        (await clients.cart.updateCart(context.cart, args.itemCode as string, args.quantity as number)).value,
        'ok',
      );
    case 'recommendAddOns':
      if (!context.cart) return result(request, false, undefined, 'Cart is required before recommendAddOns', 'cart_required');
      return result(request, true, (await clients.recommendation.recommendAddOns(context.cart)).value ?? [], 'ok');
    case 'findStores':
      return result(request, true, (await clients.storeLocator.findStores(args)).value ?? [], 'ok');
    case 'checkStoreAvailability':
      return result(
        request,
        true,
        (await clients.inventory.checkInventory(args.storeId as string, args.itemCodes as string[], args.disposition as 'pickup' | 'delivery')).value,
        'ok',
      );
    case 'quoteFulfillment':
      return result(request, true, (await clients.fulfillment.quoteFulfillment(args as Parameters<typeof clients.fulfillment.quoteFulfillment>[0])).value, 'ok');
    case 'searchPromotions':
      return result(request, true, (await clients.promotion.searchPromotions(args.query as string)).value ?? [], 'ok');
    case 'explainPromotion':
      return result(request, true, (await clients.promotion.explainPromotion(args.offerId as string)).value, 'ok');
    case 'validateVoucher':
      return result(
        request,
        true,
        context.cart
          ? (await clients.promotion.validateVoucherInput(context.cart, args.voucherText as string)).value
          : { ok: false, reason: 'cart_required', publicCode: '', discountVnd: 0 },
        'ok',
      );
    case 'searchContentPolicy':
      return result(request, true, (await clients.content.searchContent(args.kind as 'all', args.query as string)).value ?? [], 'ok');
    case 'answerAllergenQuestion':
      return result(request, true, (await clients.content.answerAllergenQuestion(args.query as string)).value ?? [], 'ok');
    case 'collectInvoice':
      return result(request, true, (await clients.invoice.collectInvoice(args)).value, 'ok');
    default:
      return result(request, false, undefined, `${request.toolName} is not executable in this context`, 'tool_not_supported_in_executor');
  }
}
```

- [ ] **Step 6: Implement safety gates**

Create `services/kfc-agent-backend/src/ordering/safetyGates.ts`:

```ts
import type { AgentGraphState } from '../graph/state.js';
import type { ToolCallRequest } from './types.js';

export interface SafetyGateOptions {
  responseClaims?: Array<'promotion' | 'payment_success' | 'allergen_certainty'>;
}

export interface SafetyGateResult {
  allowedCalls: ToolCallRequest[];
  blockedReasons: string[];
}

export function applySafetyGates(
  state: AgentGraphState,
  plannedCalls: ToolCallRequest[],
  options: SafetyGateOptions = {},
): SafetyGateResult {
  const blockedReasons: string[] = [];
  const allowedCalls = plannedCalls.filter((call) => {
    if (call.toolName === 'placeOrder' && !state.userConfirmedOrder) {
      blockedReasons.push('order_confirmation_required');
      return false;
    }
    if (call.toolName === 'placeOrder' && !state.fulfillment?.availability.ok) {
      blockedReasons.push('valid_fulfillment_required');
      return false;
    }
    return true;
  });

  if (options.responseClaims?.includes('promotion')) {
    const hasPromotionEvidence = state.toolTrace?.some((entry) =>
      ['searchPromotions', 'explainPromotion', 'validateVoucher'].includes(entry.toolName),
    );
    if (!hasPromotionEvidence) blockedReasons.push('promotion_evidence_required');
  }

  if (options.responseClaims?.includes('payment_success')) {
    const paid = state.paymentAttempt?.status === 'paid';
    if (!paid) blockedReasons.push('payment_tool_success_required');
  }

  if (options.responseClaims?.includes('allergen_certainty')) {
    blockedReasons.push('allergen_certainty_not_allowed');
  }

  return { allowedCalls, blockedReasons };
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/ordering/tool-executor.test.ts test/ordering/safety-gates.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/kfc-agent-backend/src/ordering/toolCatalog.ts services/kfc-agent-backend/src/ordering/toolExecutor.ts services/kfc-agent-backend/src/ordering/safetyGates.ts services/kfc-agent-backend/test/ordering/tool-executor.test.ts services/kfc-agent-backend/test/ordering/safety-gates.test.ts
git commit -m "feat: add KFC tool executor and safety gates"
```

---

### Task 5: Add AI Tool Planner

**Files:**
- Create: `services/kfc-agent-backend/src/llm/toolPlanner.ts`
- Modify: `services/kfc-agent-backend/src/api/routes.ts`
- Modify: `services/kfc-agent-backend/src/api/serverOptions.ts`
- Test: `services/kfc-agent-backend/test/llm/tool-planner.test.ts`

**Interfaces:**
- Produces: `ToolPlanner`, `StaticToolPlanner`, `OpenAIToolPlanner`, `ToolPlannerInput`, `ToolPlannerOutput`
- Consumes: `AgentGraphState`, `ToolCallRequest`, `toolNames`

- [ ] **Step 1: Write failing planner tests**

Create `services/kfc-agent-backend/test/llm/tool-planner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OpenAIToolPlanner, StaticToolPlanner } from '../../src/llm/toolPlanner.js';

describe('tool planners', () => {
  it('returns queued static plans for unit tests', async () => {
    const planner = new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
        responseClaims: [],
      },
    ]);
    const output = await planner.plan({
      state: {
        sessionId: 's',
        customerId: 'c',
        channel: 'web_mock',
        latestUserMessage: 'Cho mình Combo Hợp Gu 99K',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: ['searchMenu'],
      recentTurns: [],
    });
    expect(output.toolCalls[0]?.toolName).toBe('searchMenu');
  });

  it('parses OpenAI Responses output JSON', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              intent: 'voucher',
              entities: { voucherText: 'KFC50' },
              toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } }],
              responseClaims: ['promotion'],
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const output = await planner.plan({
      state: {
        sessionId: 's',
        customerId: 'c',
        channel: 'web_mock',
        latestUserMessage: 'Mình có mã KFC50',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: ['validateVoucher'],
      recentTurns: [],
    });
    expect(output.intent).toBe('voucher');
    expect(output.responseClaims).toContain('promotion');
  });
});
```

- [ ] **Step 2: Run planner tests to verify they fail**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/llm/tool-planner.test.ts
```

Expected: FAIL because `toolPlanner.ts` is missing.

- [ ] **Step 3: Implement planner**

Create `services/kfc-agent-backend/src/llm/toolPlanner.ts`:

```ts
import { z } from 'zod';
import type { ConversationTurn, Intent } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { ToolCallRequest, ToolName } from '../ordering/types.js';

export interface ToolPlannerInput {
  state: AgentGraphState;
  availableTools: ToolName[];
  recentTurns: ConversationTurn[];
}

export interface ToolPlannerOutput {
  intent: Intent;
  entities: Record<string, unknown>;
  toolCalls: ToolCallRequest[];
  responseClaims: Array<'promotion' | 'payment_success' | 'allergen_certainty'>;
  directResponse?: string;
}

export interface ToolPlanner {
  plan(input: ToolPlannerInput): Promise<ToolPlannerOutput>;
}

const plannerOutputSchema = z.object({
  intent: z.enum(['ordering', 'cart_edit', 'voucher', 'payment', 'order_status', 'complaint', 'feedback', 'handoff', 'safety', 'unclear']),
  entities: z.record(z.unknown()).default({}),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string(),
        arguments: z.record(z.unknown()),
      }),
    )
    .default([]),
  responseClaims: z.array(z.enum(['promotion', 'payment_success', 'allergen_certainty'])).default([]),
  directResponse: z.string().optional(),
});

interface ResponsesBody {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
  error?: { message?: unknown };
}

function extractText(body: ResponsesBody): string | undefined {
  if (typeof body.output_text === 'string') return body.output_text;
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') return content.text;
    }
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export class StaticToolPlanner implements ToolPlanner {
  private index = 0;

  constructor(private readonly outputs: ToolPlannerOutput[]) {}

  async plan(): Promise<ToolPlannerOutput> {
    const output = this.outputs[this.index] ?? this.outputs.at(-1);
    this.index += 1;
    if (!output) {
      return { intent: 'unclear', entities: {}, toolCalls: [], responseClaims: [], directResponse: 'Mình cần thêm thông tin để hỗ trợ đúng.' };
    }
    return output;
  }
}

export interface OpenAIToolPlannerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAIToolPlanner implements ToolPlanner {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIToolPlannerOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? 'https://api.openai.com/v1');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        instructions:
          'You are a KFC Vietnam ordering tool planner. Return only JSON matching the requested schema. Choose tools for facts; do not invent business outcomes.',
        input: JSON.stringify(
          {
            locale: 'vi-VN',
            state: input.state,
            availableTools: input.availableTools,
            recentTurns: input.recentTurns.slice(-8),
            outputSchema: {
              intent: 'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
              entities: {},
              toolCalls: [{ toolName: 'searchMenu', arguments: {} }],
              responseClaims: ['promotion'],
              directResponse: 'optional response when no tool call is needed',
            },
          },
          null,
          2,
        ),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    if (!response.ok) {
      const message = typeof body.error?.message === 'string' ? body.error.message : response.statusText;
      throw new Error(`OpenAI tool planning failed: ${message}`);
    }

    const text = extractText(body);
    if (!text) throw new Error('OpenAI tool planning returned no text');
    const parsed = plannerOutputSchema.parse(JSON.parse(text));
    return {
      intent: parsed.intent,
      entities: parsed.entities,
      toolCalls: parsed.toolCalls as ToolCallRequest[],
      responseClaims: parsed.responseClaims,
      directResponse: parsed.directResponse,
    };
  }
}
```

- [ ] **Step 4: Run planner tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/llm/tool-planner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire planner types into route options**

Modify `services/kfc-agent-backend/src/api/routes.ts`:

```ts
import type { ToolPlanner } from '../llm/toolPlanner.js';
```

Add to `RouteOptions`:

```ts
toolPlanner?: ToolPlanner;
```

When calling `runAgentTurn`, pass:

```ts
toolPlanner: options.toolPlanner,
```

Update `services/kfc-agent-backend/src/api/serverOptions.ts` only if it mirrors `RouteOptions`; add `toolPlanner?: ToolPlanner`.

- [ ] **Step 6: Run build**

Run:

```bash
cd services/kfc-agent-backend
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/kfc-agent-backend/src/llm/toolPlanner.ts services/kfc-agent-backend/src/api/routes.ts services/kfc-agent-backend/src/api/serverOptions.ts services/kfc-agent-backend/test/llm/tool-planner.test.ts
git commit -m "feat: add AI tool planner contract"
```

---

### Task 6: Replace Phrase-Matched Graph With AI Tool Loop

**Files:**
- Modify: `services/kfc-agent-backend/src/graph/buildGraph.ts`
- Modify: `services/kfc-agent-backend/src/llm/responseComposer.ts`
- Modify: `services/kfc-agent-backend/test/graph/order-confirmation.test.ts`
- Create: `services/kfc-agent-backend/test/graph/ai-tool-graph.test.ts`

**Interfaces:**
- Consumes: `ToolPlanner`, `executeToolCall`, `applySafetyGates`, expanded `AgentGraphState`
- Produces: `runAgentTurn(input)` that uses AI tool planning for production flow and stores `toolTrace`

- [ ] **Step 1: Write failing graph tests for tool evidence**

Create `services/kfc-agent-backend/test/graph/ai-tool-graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('AI tool graph', () => {
  it('adds a menu item through planned fixture-backed tools', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_menu',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          ],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.cart?.items[0]).toMatchObject({ itemCode: '20751', name: 'Combo Hợp Gu 99K' });
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
  });

  it('blocks order placement without explicit confirmation even when planner asks for placeOrder', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_no_confirm',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Đặt luôn đi',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          toolCalls: [{ toolName: 'placeOrder', arguments: {} }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.order).toBeUndefined();
    expect(output.state.escalationReasons).toContain('order_confirmation_required');
  });

  it('does not apply hardcoded KFC50 as a valid public voucher', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_voucher',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mình có mã KFC50',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'voucher',
          entities: { voucherText: 'KFC50' },
          toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } }],
          responseClaims: ['promotion'],
        },
      ]),
    });

    expect(output.state.promotionContext?.validation?.ok).toBe(false);
    expect(output.state.promotionContext?.validation?.reason).toBe('public_code_not_exposed');
    expect(output.state.cart?.voucherCode).not.toBe('KFC50');
  });
});
```

- [ ] **Step 2: Run graph tests to verify they fail**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/graph/ai-tool-graph.test.ts
```

Expected: FAIL because `runAgentTurn` does not accept `toolPlanner` and still uses phrase-matched logic.

- [ ] **Step 3: Update `AgentTurnInput`**

Modify `services/kfc-agent-backend/src/graph/buildGraph.ts`:

```ts
import type { ToolPlanner } from '../llm/toolPlanner.js';
import { toolNames } from '../ordering/toolCatalog.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import type { PromotionValidationResult, ToolCallResult, ToolTraceEntry } from '../ordering/types.js';
```

Add to `AgentTurnInput`:

```ts
toolPlanner?: ToolPlanner;
```

- [ ] **Step 4: Add tool-result state reducer helpers**

In `services/kfc-agent-backend/src/graph/buildGraph.ts`, add:

```ts
function traceFromResult(result: ToolCallResult, args: Record<string, unknown>): ToolTraceEntry {
  return {
    toolName: result.toolName,
    arguments: args,
    ok: result.ok,
    resultSummary: result.ok ? result.message : result.errorCode ?? result.message,
    provenance: result.provenance,
  };
}

function applyToolResultToState(state: AgentGraphState, result: ToolCallResult): void {
  state.toolTrace = [...(state.toolTrace ?? []), traceFromResult(result, result.toolName ? {} : {})];
  if (!result.ok) return;

  if (result.toolName === 'updateCart' && result.value && typeof result.value === 'object') {
    state.cart = result.value as AgentGraphState['cart'];
  }

  if (result.toolName === 'quoteFulfillment' && result.value && typeof result.value === 'object') {
    state.fulfillment = result.value as AgentGraphState['fulfillment'];
    if (state.fulfillment) {
      emitSessionUpdateFromState(state, 'fulfillment_quoted', {
        storeId: state.fulfillment.storeId,
        storeName: state.fulfillment.storeName,
        feeVnd: state.fulfillment.feeVnd,
        etaMinutes: state.fulfillment.etaMinutes,
      });
    }
  }

  if (result.toolName === 'validateVoucher' && result.value && typeof result.value === 'object') {
    const validation = result.value as PromotionValidationResult;
    state.promotionContext = {
      matchedOfferIds: state.promotionContext?.matchedOfferIds ?? [],
      validation,
      caveats: validation.ok ? [] : ['Public crawl did not expose a reusable public promo code.'],
    };
  }

  if (result.toolName === 'answerAllergenQuestion' && Array.isArray(result.value)) {
    state.contentEvidence = result.value as AgentGraphState['contentEvidence'];
  }
}
```

Then adjust the helper to avoid emitting dashboard without input by passing `input` into the reducer during implementation:

```ts
function applyToolResultToState(input: AgentTurnInput, state: AgentGraphState, result: ToolCallResult, args: Record<string, unknown>): void {
  state.toolTrace = [...(state.toolTrace ?? []), traceFromResult(result, args)];
  // same state updates as above; use emitSessionUpdate(input, ...) when emitting dashboard events
}
```

- [ ] **Step 5: Replace phrase-matched production flow**

In `runAgentTurn`, after initial state creation and before any old phrase branches, add:

```ts
if (input.toolPlanner) {
  const turns = await input.store.listTurns(input.sessionId);
  const plan = await input.toolPlanner.plan({
    state,
    availableTools: toolNames,
    recentTurns: turns,
  });
  state.intent = plan.intent;
  state.entities = plan.entities;

  const safety = applySafetyGates(state, plan.toolCalls, { responseClaims: plan.responseClaims });
  state.escalationReasons.push(...safety.blockedReasons);

  for (const call of safety.allowedCalls) {
    const result = await executeToolCall(input.clients, call, { cart: state.cart });
    applyToolResultToState(input, state, result, call.arguments);
  }

  if (state.cart) emitDashboardEvent(input, 'cart_changed', { cart: state.cart });
  if (state.promotionContext?.validation?.ok) {
    emitDashboardEvent(input, 'voucher_applied', { validation: state.promotionContext.validation });
  }
  if (state.promotionContext?.validation && !state.promotionContext.validation.ok) {
    emitDashboardEvent(input, 'voucher_rejected', { validation: state.promotionContext.validation });
  }

  return composeAndAppendAssistantTurn({
    turnInput: input,
    state,
    replyIntent: state.escalationReasons.length > 0 ? 'ask_clarification' : 'general_reply',
    fallbackText: plan.directResponse ?? 'Mình đã kiểm tra thông tin từ dữ liệu KFC. Bạn muốn mình tiếp tục thế nào?',
  });
}
```

After this task, delete old phrase-matched branches instead of leaving them as production fallback. If a no-planner test still needs old behavior, update that test to inject `StaticToolPlanner`.

- [ ] **Step 6: Update response composer prompt**

Modify `services/kfc-agent-backend/src/llm/responseComposer.ts`:

- Rename `deterministicFallback` to `verifiedFallback`.
- Include `toolTrace`, `fulfillment`, `promotionContext`, and `contentEvidence`.
- Keep guardrail: “Do not change business decisions or invent facts not present in state/toolTrace.”

Use this prompt body shape:

```ts
{
  locale: 'vi-VN',
  role: 'KFC Vietnam ordering assistant',
  guardrails: [
    'Reply naturally in Vietnamese unless the customer used English.',
    'Use only verified state and toolTrace facts from this payload.',
    'Do not invent promotions, delivery availability, payment success, or order IDs.',
    'Keep the reply short enough for Messenger and Zalo.',
  ],
  latestUserMessage: input.state.latestUserMessage,
  replyIntent: input.replyIntent,
  verifiedFallback: input.fallbackText,
  cart: input.state.cart,
  fulfillment: input.state.fulfillment,
  promotionContext: input.state.promotionContext,
  contentEvidence: input.state.contentEvidence,
  order: input.state.order,
  escalationReasons: input.state.escalationReasons,
  toolTrace: input.state.toolTrace,
  retrievedEvidence: input.state.retrievedEvidence,
}
```

- [ ] **Step 7: Update existing graph tests to inject planners**

Modify `services/kfc-agent-backend/test/graph/order-confirmation.test.ts` so each `runAgentTurn` call passes a `StaticToolPlanner` with the specific tool calls being tested. Remove expectations that depend on phrase matching without tool evidence.

- [ ] **Step 8: Run graph tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/graph/order-confirmation.test.ts test/graph/ai-tool-graph.test.ts
```

Expected: PASS.

- [ ] **Step 9: Search for banned production shortcuts**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
rg -n "scenarioOneCart|scenarioOneAddress|scenarioOneOrder|store_mock_nearest|voucherCode === 'KFC50'|lower\\.includes\\('sunrise city'|applyScenarioEvent" services/kfc-agent-backend/src
```

Expected: no matches in `services/kfc-agent-backend/src`.

- [ ] **Step 10: Commit**

```bash
git add services/kfc-agent-backend/src/graph/buildGraph.ts services/kfc-agent-backend/src/llm/responseComposer.ts services/kfc-agent-backend/test/graph/order-confirmation.test.ts services/kfc-agent-backend/test/graph/ai-tool-graph.test.ts
git commit -m "feat: replace KFC graph with AI tool orchestration"
```

---

### Task 7: Replace Scenario Replay Injection With Production Tool Evidence

**Files:**
- Modify: `services/kfc-agent-backend/src/scenarios/runner.ts`
- Modify: `services/kfc-agent-backend/test/scenarios/scenario-replay.test.ts`
- Create: `services/kfc-agent-backend/scripts/run-live-ai-replay.ts`

**Interfaces:**
- Consumes: `runAgentTurn`, `ToolPlanner`, `OpenAIToolPlanner`, `StaticToolPlanner`
- Produces: scenario replay result with `toolTrace` evidence and no `applyScenarioEvent`

- [ ] **Step 1: Write failing scenario evidence assertions**

Modify `services/kfc-agent-backend/test/scenarios/scenario-replay.test.ts`:

```ts
function toolNames(result: Awaited<ReturnType<typeof runScenario>>) {
  return result.toolTrace.map((entry) => entry.toolName);
}

it('scenario replay uses production tool traces instead of injected business events', async () => {
  const { result } = await replay('01-dat-mon-ro-rang-giao-hang.md');
  expect(toolNames(result)).toEqual(expect.arrayContaining(['searchMenu', 'updateCart', 'quoteFulfillment']));
  expect(result.dashboardEvents.every((event) => !event.id.includes('scenario_'))).toBe(true);
});
```

Update `ScenarioRunResult` expectations as needed to use `result.toolTrace`.

- [ ] **Step 2: Run scenario test to verify it fails**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/scenarios/scenario-replay.test.ts
```

Expected: FAIL because `toolTrace` is not returned and scenario events are injected.

- [ ] **Step 3: Remove `applyScenarioEvent`**

Modify `services/kfc-agent-backend/src/scenarios/runner.ts`:

- Delete `scenarioOneCart`, `scenarioOrder`, `applyScenarioEvent`, and scenario-specific event injection.
- Add `toolPlanner?: ToolPlanner` to `RunScenarioOptions`.
- Pass `toolPlanner` into every `runAgentTurn`.
- Collect `toolTrace` from every turn output.

Use this result shape:

```ts
export interface ScenarioRunResult {
  finalState: string;
  coveredUseCases: string[];
  dashboardEvents: DashboardEvent[];
  escalationReasons: string[];
  transcript: Awaited<ReturnType<MemoryStore['listTurns']>>;
  eventsBeforeFinalUserTurn: DashboardEvent[];
  toolTrace: ToolTraceEntry[];
  cart?: Cart;
  order?: Order;
}
```

Inside the turn loop:

```ts
const output = await runAgentTurn({
  sessionId,
  customerId: 'scenario_customer',
  channel: script.channel,
  text: turn.text,
  clients,
  store,
  dashboard,
  toolPlanner: options.toolPlanner,
});
toolTrace.push(...(output.state.toolTrace ?? []));
```

- [ ] **Step 4: Provide static planner only for unit replay tests**

In scenario unit tests, inject `StaticToolPlanner` outputs for narrow contract tests. Name those tests “test-mode replay” so they are not confused with live AI proof.

Example:

```ts
const planner = new StaticToolPlanner([
  {
    intent: 'ordering',
    entities: { itemText: 'Combo Hợp Gu 99K' },
    toolCalls: [
      { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
      { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
    ],
    responseClaims: [],
  },
]);
const result = await runScenario(script, { toolPlanner: planner });
```

- [ ] **Step 5: Add live AI replay script**

Create `services/kfc-agent-backend/scripts/run-live-ai-replay.ts`:

```ts
import { join } from 'node:path';
import { loadEnv } from '../src/config/env.js';
import { OpenAIToolPlanner } from '../src/llm/toolPlanner.js';
import { parseScenarioFile } from '../src/scenarios/parser.js';
import { runScenario } from '../src/scenarios/runner.js';

const env = loadEnv();
if (!env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required for live AI replay');
}

const scenarioFile = process.argv[2] ?? '../../ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.md';
const script = await parseScenarioFile(join(process.cwd(), scenarioFile));
const result = await runScenario(script, {
  toolPlanner: new OpenAIToolPlanner({
    apiKey: env.OPENAI_API_KEY,
    model: process.env.OPENAI_TOOL_PLANNER_MODEL ?? 'gpt-4.1-mini',
  }),
});

console.log(
  JSON.stringify(
    {
      finalState: result.finalState,
      toolTrace: result.toolTrace.map((entry) => ({
        toolName: entry.toolName,
        ok: entry.ok,
        resultSummary: entry.resultSummary,
      })),
      dashboardEvents: result.dashboardEvents.map((event) => ({ type: event.type, payload: event.payload })),
      order: result.order,
    },
    null,
    2,
  ),
);
```

- [ ] **Step 6: Run scenario tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/scenarios/scenario-replay.test.ts
```

Expected: PASS.

- [ ] **Step 7: Search for replay injection**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
rg -n "applyScenarioEvent|scenario_\\$\\{sessionId\\}|scenarioOneCart|scenarioOrder" services/kfc-agent-backend/src/scenarios services/kfc-agent-backend/test/scenarios
```

Expected: no production replay injection remains.

- [ ] **Step 8: Commit**

```bash
git add services/kfc-agent-backend/src/scenarios/runner.ts services/kfc-agent-backend/test/scenarios/scenario-replay.test.ts services/kfc-agent-backend/scripts/run-live-ai-replay.ts
git commit -m "feat: replay KFC scenarios through tool evidence"
```

---

### Task 8: Wire Production Planner Into API And Channel Runtime

**Files:**
- Modify: `services/kfc-agent-backend/src/config/env.ts`
- Modify: `services/kfc-agent-backend/src/api/server.ts`
- Modify: `services/kfc-agent-backend/src/api/routes.ts`
- Modify: `services/kfc-agent-backend/src/index.ts`
- Modify: `services/kfc-agent-backend/.env.example`
- Test: `services/kfc-agent-backend/test/api/chat.test.ts`
- Test: `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`

**Interfaces:**
- Consumes: `OpenAIToolPlanner`, `StaticToolPlanner`, route option `toolPlanner`
- Produces: live `/chat/mock`, Messenger webhook, and Zalo webhook execution through AI tool planner when configured

- [ ] **Step 1: Write API test proving route uses injected planner**

Modify `services/kfc-agent-backend/test/api/chat.test.ts`:

```ts
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';

it('runs chat through injected AI tool planner and returns tool-backed state', async () => {
  const server = buildServer({
    fixturesRoot: join(process.cwd(), '../..'),
    toolPlanner: new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        ],
        responseClaims: [],
      },
    ]),
  });

  const response = await server.inject({
    method: 'POST',
    url: '/chat/mock',
    payload: { sessionId: 's', customerId: 'c', channel: 'web_mock', text: 'Cho mình Combo Hợp Gu 99K' },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().state.toolTrace.map((entry: { toolName: string }) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
});
```

- [ ] **Step 2: Run API tests to verify failure**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/api/chat.test.ts
```

Expected: FAIL if `buildServer` does not accept or pass `toolPlanner`.

- [ ] **Step 3: Add environment config**

Modify `services/kfc-agent-backend/src/config/env.ts`:

```ts
OPENAI_TOOL_PLANNER_MODEL: z.string().default('gpt-4.1-mini'),
OPENAI_RESPONSE_MODEL: z.string().default('gpt-4.1-mini'),
```

Modify `.env.example`:

```text
OPENAI_TOOL_PLANNER_MODEL=gpt-4.1-mini
OPENAI_RESPONSE_MODEL=gpt-4.1-mini
```

- [ ] **Step 4: Wire default planner in index**

Modify `services/kfc-agent-backend/src/index.ts`:

```ts
import { OpenAIToolPlanner } from './llm/toolPlanner.js';
import { OpenAIResponseComposer } from './llm/responseComposer.js';

const toolPlanner = env.OPENAI_API_KEY
  ? new OpenAIToolPlanner({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_TOOL_PLANNER_MODEL })
  : undefined;
const responseComposer = env.OPENAI_API_KEY
  ? new OpenAIResponseComposer({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_RESPONSE_MODEL })
  : undefined;

const server = buildServer({ toolPlanner, responseComposer });
```

- [ ] **Step 5: Pass planner through server/routes**

Modify `services/kfc-agent-backend/src/api/server.ts` and `serverOptions.ts` so `buildServer(options)` includes `toolPlanner` and passes it to `registerRoutes`.

Modify every `runAgentTurn` call in `routes.ts` to include:

```ts
toolPlanner: options.toolPlanner,
```

- [ ] **Step 6: Run API and channel tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/api/chat.test.ts test/channels/messenger-webhook.test.ts test/channels/zalo-webhook.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/kfc-agent-backend/src/config/env.ts services/kfc-agent-backend/src/api/server.ts services/kfc-agent-backend/src/api/serverOptions.ts services/kfc-agent-backend/src/api/routes.ts services/kfc-agent-backend/src/index.ts services/kfc-agent-backend/.env.example services/kfc-agent-backend/test/api/chat.test.ts services/kfc-agent-backend/test/channels/messenger-webhook.test.ts
git commit -m "feat: wire AI tool planner into KFC runtime"
```

---

### Task 9: Add Dashboard Tool Evidence Read Model

**Files:**
- Modify: `services/kfc-agent-backend/src/domain/types.ts`
- Modify: `services/kfc-agent-backend/src/dashboard/eventBus.ts`
- Modify: `services/kfc-agent-backend/src/graph/buildGraph.ts`
- Modify: `services/kfc-agent-backend/test/api/chat.test.ts`
- Modify: `apps/kfc_live_monitor_flutter` only if the dashboard currently cannot display tool-backed events from existing API payloads

**Interfaces:**
- Produces: dashboard event payloads for `tool_called`, `fulfillment_quoted`, `promotion_answered`, `voucher_rejected`, `content_evidence_found`

- [ ] **Step 1: Write API assertion for tool dashboard events**

Add to `services/kfc-agent-backend/test/api/chat.test.ts`:

```ts
it('exposes tool-backed dashboard events for monitor proof', async () => {
  const server = buildServer({
    fixturesRoot: join(process.cwd(), '../..'),
    toolPlanner: new StaticToolPlanner([
      {
        intent: 'voucher',
        entities: { voucherText: 'KFC50' },
        toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } }],
        responseClaims: ['promotion'],
      },
    ]),
  });

  await server.inject({
    method: 'POST',
    url: '/chat/mock',
    payload: { sessionId: 'dash_tool_session', customerId: 'c', channel: 'web_mock', text: 'Mình có mã KFC50' },
  });

  const events = await server.inject({ method: 'GET', url: '/dashboard/events/dash_tool_session' });
  expect(events.json().events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'session_updated', payload: expect.objectContaining({ updateType: 'tool_called', toolName: 'validateVoucher' }) }),
      expect.objectContaining({ type: 'voucher_rejected' }),
    ]),
  );
});
```

- [ ] **Step 2: Run API test to verify failure**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/api/chat.test.ts
```

Expected: FAIL because tool-called dashboard events are not emitted.

- [ ] **Step 3: Emit tool trace events**

In `services/kfc-agent-backend/src/graph/buildGraph.ts`, after each tool result:

```ts
emitSessionUpdate(input, {
  updateType: 'tool_called',
  toolName: result.toolName,
  ok: result.ok,
  resultSummary: result.message,
  provenance: result.provenance,
});
```

Emit business-specific events from state transitions:

```ts
if (result.toolName === 'quoteFulfillment' && state.fulfillment) {
  emitSessionUpdate(input, {
    updateType: 'fulfillment_quoted',
    storeId: state.fulfillment.storeId,
    storeName: state.fulfillment.storeName,
    feeVnd: state.fulfillment.feeVnd,
    etaMinutes: state.fulfillment.etaMinutes,
  });
}

if (result.toolName === 'searchPromotions') {
  emitSessionUpdate(input, { updateType: 'promotion_answered' });
}

if (result.toolName === 'answerAllergenQuestion') {
  emitSessionUpdate(input, { updateType: 'content_evidence_found', kind: 'allergen' });
}
```

- [ ] **Step 4: Run API test**

Run:

```bash
cd services/kfc-agent-backend
npm test -- --run test/api/chat.test.ts
```

Expected: PASS.

- [ ] **Step 5: Check Flutter monitor compatibility**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
rg -n "tool_called|session_updated|voucher_rejected|promotion_answered|dashboard/events|updateType" apps/kfc_live_monitor_flutter/lib apps/kfc_live_monitor_flutter/test
```

If the Flutter monitor already renders generic `session_updated` events, no Flutter change is required. If it filters known `updateType` values, add `tool_called`, `fulfillment_quoted`, `promotion_answered`, and `content_evidence_found` to its mapping and add a widget test that these events appear in the session detail.

- [ ] **Step 6: Commit**

```bash
git add services/kfc-agent-backend/src/domain/types.ts services/kfc-agent-backend/src/dashboard/eventBus.ts services/kfc-agent-backend/src/graph/buildGraph.ts services/kfc-agent-backend/test/api/chat.test.ts apps/kfc_live_monitor_flutter/lib apps/kfc_live_monitor_flutter/test
git commit -m "feat: expose KFC tool evidence to dashboard"
```

---

### Task 10: Full Verification And Banned Shortcut Audit

**Files:**
- Modify only files needed to fix failures found by this task.

**Interfaces:**
- Consumes: all previous tasks
- Produces: green backend build/tests and clean banned-shortcut audit

- [ ] **Step 1: Run backend unit/integration tests**

Run:

```bash
cd services/kfc-agent-backend
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run backend build**

Run:

```bash
cd services/kfc-agent-backend
npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 3: Run banned shortcut audit**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
rg -n "scenarioOneCart|scenarioOneAddress|scenarioOneOrder|store_mock_nearest|voucherCode === 'KFC50'|applyScenarioEvent|lower\\.includes\\('sunrise city'|lower\\.includes\\('kfc50'|deterministicFallback" services/kfc-agent-backend/src services/kfc-agent-backend/test
```

Expected: no production-path matches. Test names may mention `KFC50` only to assert it is rejected or not hardcoded.

- [ ] **Step 4: Run live AI replay smoke when credentials exist**

Run only when `OPENAI_API_KEY` is set:

```bash
cd services/kfc-agent-backend
OPENAI_TOOL_PLANNER_MODEL=gpt-4.1-mini npm run build
OPENAI_TOOL_PLANNER_MODEL=gpt-4.1-mini node dist/scripts/run-live-ai-replay.js ../../ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.md
```

Expected: JSON output includes tool traces such as `searchMenu`, `updateCart`, `quoteFulfillment`, and no unsupported public promo-code success.

- [ ] **Step 5: Commit verification fixes**

If any fixes were needed:

```bash
git add services/kfc-agent-backend apps/kfc_live_monitor_flutter
git commit -m "fix: complete KFC fixture-backed orchestration verification"
```

If no fixes were needed, do not create an empty commit.

---

### Task 11: Capture Final Two-Video Proof

**Files:**
- Create: `artifacts/kfc-fixture-backed-proof/README.md`
- Store video artifacts under: `artifacts/kfc-fixture-backed-proof/`

**Interfaces:**
- Consumes: running backend, Messenger webhook tunnel/deploy, monitor dashboard, OpenAI planner/composer credentials
- Produces: two proof videos from the same live session and a README tying them to session ID/tool evidence

- [ ] **Step 1: Create proof README skeleton**

Create `artifacts/kfc-fixture-backed-proof/README.md`:

```md
# KFC Fixture-Backed AI Live Proof

Date: 2026-07-08

## Required Videos

- `messenger-chat-live-ai.mp4`: Messenger conversation from the live AI run.
- `monitor-dashboard-live-ai.mp4`: Monitor dashboard for the same session.

## Session Correlation

- Messenger external thread/user:
- Backend session ID:
- Dashboard session URL:
- Backend commit:
- Scenario/messages used:

## Required Evidence

- AI-led planner path was used.
- Fixture-backed tools were called for menu facts.
- Fixture-backed tools were called for fulfillment/store availability.
- Promotion/voucher answer did not invent a public reusable code.
- Order placement did not occur before explicit confirmation.
- Monitor dashboard showed transcript turns and tool-backed events from the same session.
```

- [ ] **Step 2: Start backend with live AI planner**

Run:

```bash
cd services/kfc-agent-backend
OPENAI_API_KEY="$OPENAI_API_KEY" \
OPENAI_TOOL_PLANNER_MODEL=gpt-4.1-mini \
OPENAI_RESPONSE_MODEL=gpt-4.1-mini \
npm run dev
```

Expected: backend starts on configured port and uses `OpenAIToolPlanner` plus `OpenAIResponseComposer`.

- [ ] **Step 3: Start monitor dashboard**

Use the existing monitor app documented in `apps/kfc_live_monitor_flutter/README.md`. Launch it against the backend URL. If the app requires a build/run command, use the repo's current command and record it in the proof README.

- [ ] **Step 4: Connect Messenger webhook**

Use the existing Messenger webhook setup from `services/kfc-agent-backend/src/channels/messenger.ts` and current deployment/tunnel path. Verify `GET /webhooks/messenger` succeeds with the configured verify token before recording.

- [ ] **Step 5: Record Messenger chat video**

Record `artifacts/kfc-fixture-backed-proof/messenger-chat-live-ai.mp4`.

The conversation must include:

```text
User: Cho mình Combo Hợp Gu 99K
User: Có thay Pepsi bằng nước khác được không?
User: Giao tới [realistic address/city matching fixture stores]
User: Có mã giảm giá nào không?
User: Xác nhận đơn
```

Exact wording can vary, but the flow must exercise menu search, modifiers or upsell, fulfillment/store availability, promotion/voucher handling, and confirmation safety.

- [ ] **Step 6: Record monitor dashboard video**

Record `artifacts/kfc-fixture-backed-proof/monitor-dashboard-live-ai.mp4` from the same backend session.

The dashboard video must show:

- transcript turns matching Messenger
- cart or order state
- `tool_called` events
- fulfillment/store event
- promotion/voucher event
- order confirmation or blocked pre-confirmation state

- [ ] **Step 7: Fill proof README**

Update `artifacts/kfc-fixture-backed-proof/README.md` with actual session ID, commands, backend commit, dashboard URL, and video filenames.

- [ ] **Step 8: Verify proof artifacts exist**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
ls -lh artifacts/kfc-fixture-backed-proof/messenger-chat-live-ai.mp4 artifacts/kfc-fixture-backed-proof/monitor-dashboard-live-ai.mp4 artifacts/kfc-fixture-backed-proof/README.md
```

Expected: both video files and README exist and are non-empty.

- [ ] **Step 9: Commit proof metadata**

If videos are acceptable to track in git for this repo:

```bash
git add artifacts/kfc-fixture-backed-proof
git commit -m "test: add KFC live AI proof videos"
```

If videos are too large or should not be tracked, commit only `README.md` plus checksums/locations:

```bash
shasum -a 256 artifacts/kfc-fixture-backed-proof/*.mp4 > artifacts/kfc-fixture-backed-proof/SHA256SUMS
git add artifacts/kfc-fixture-backed-proof/README.md artifacts/kfc-fixture-backed-proof/SHA256SUMS
git commit -m "test: document KFC live AI proof videos"
```

---

## Plan Self-Review

Spec coverage:

- Fixture-backed data service: Task 2.
- Expanded client surface: Task 3.
- AI-led tool planner: Task 5.
- Backend safety gates: Task 4 and Task 6.
- Graph replacement and deterministic shortcut removal: Task 6 and Task 10.
- Scenario replay without injected business events: Task 7.
- Dashboard tool evidence: Task 9.
- Final Messenger and monitor videos from same live session: Task 11.

Placeholder scan:

- No `TBD`, `TODO`, or “implement later” placeholders are intentionally left in this plan.
- Steps with code changes include concrete code snippets, exact paths, and test commands.

Type consistency:

- `OrderingDataService`, `ToolPlanner`, `ToolCallRequest`, `ToolCallResult`, `ToolTraceEntry`, and `FulfillmentState` are introduced before later tasks consume them.
- Client names match the approved spec: `MenuClient`, `CartClient`, `RecommendationClient`, `StoreLocatorClient`, `InventoryClient`, `PromotionClient`, `ContentClient`, `CustomerClient`, `LoyaltyClient`, `FulfillmentClient`, `OmsClient`, `PaymentClient`, `InvoiceClient`, `HandoffClient`, `FeedbackClient`, and channel clients.
