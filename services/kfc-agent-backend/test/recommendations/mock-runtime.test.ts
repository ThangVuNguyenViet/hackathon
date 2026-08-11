import { describe, expect, it, vi } from 'vitest';
import { loadBundledGeneratedFixtures } from '../../src/fixtures/bundledFixtures.js';
import {
  parseAutomaticRecommendationInspection,
  parseAutomaticRecommendationRequest,
  parseAutomaticRecommendationResponse,
  validateAutomaticRecommendationBinding,
  type AutomaticRecommendationType,
} from '../../src/recommendations/contracts/automatic-recommendation.js';
import { createMockAutomaticRecommendationHttpRuntime } from '../../src/recommendations/serving/mock-runtime.js';
import { mockCatalogRevision } from '../../src/mock/mockCatalogRevision.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type { RecommendationJourneyStore } from '../../src/clients/catalogObservationClients.js';

const fixtures = loadBundledGeneratedFixtures();
const now = () => new Date('2026-08-08T10:00:00.000Z');
const runtime = createMockAutomaticRecommendationHttpRuntime(fixtures, {
  clock: now,
});
const item = fixtures.menuItems[0]!;
const cart = {
  cartId: 'cart-mock',
  revision: 'cart-revision-mock',
  subtotal: { amount: item.priceVnd, currency: 'VND' as const },
  lines: [
    {
      lineId: 'cart-mock:line:1',
      sellableItemId: item.code,
      quantity: 1,
      unitPrice: { amount: item.priceVnd, currency: 'VND' as const },
      modifiers: [],
    },
  ],
};

function requestFor(type: AutomaticRecommendationType) {
  return parseAutomaticRecommendationRequest(type, {
    schemaVersion: 'kfc-automatic-recommendation-v1',
    requestId: `test:${type}`,
    storeId: fixtures.stores[0]!.storeId,
    fulfilmentMode: 'pickup',
    locale: 'vi-VN',
    orderingJourneyRef: 'test:journey',
    opportunityRef: 'test:opportunity',
    cart:
      type === 'local_favorite' || type === 'for_you'
        ? { ...cart, lines: [] }
        : cart,
    ...(type === 'for_you' ? { verifiedCustomerRef: 'customer:fixture' } : {}),
    ...(type === 'modifier_upsell'
      ? { parentCartLineId: cart.lines[0]!.lineId }
      : {}),
  });
}

describe('fixture-backed automatic recommendation runtime', () => {
  it('serves all four recommendation contracts from the bundled catalog', async () => {
    for (const type of [
      'local_favorite',
      'for_you',
      'modifier_upsell',
      'smart_cross_sell',
    ] as const) {
      const request = requestFor(type);
      const response = parseAutomaticRecommendationResponse(
        await runtime.decide(type, request),
      );
      expect(
        validateAutomaticRecommendationBinding(type, request, response),
      ).toEqual(response);
      expect(response.requestId).toBe(request.requestId);
      expect(response.catalogRevision).toBe(mockCatalogRevision(fixtures));
      expect(response.counts.displayed).toBe(response.proposals.length);
      expect(response.proposals.length).toBeLessThanOrEqual(
        type === 'modifier_upsell' ? 3 : 4,
      );
    }
  });

  it('persists and inspects typed chat evidence for a recommendation', async () => {
    const request = requestFor('smart_cross_sell');
    const response = parseAutomaticRecommendationResponse(
      await runtime.decide('smart_cross_sell', request),
    );
    expect(response.proposals.length).toBeGreaterThan(0);
    await runtime.recordImpression(response.recommendationId, {
      schemaVersion: 'kfc-automatic-recommendation-event-v1',
      eventId: `${response.recommendationId}:impression`,
      channel: 'chat',
      occurredAt: now().toISOString(),
      orderingJourneyRef: request.orderingJourneyRef,
      opportunityRef: request.opportunityRef,
      cartRevision: request.cart.revision,
      renderedActions: response.proposals.map((proposal, index) => ({
        actionId: proposal.actionId,
        renderedPosition: index + 1,
      })),
    });
    const inspection = parseAutomaticRecommendationInspection(
      await runtime.inspect(response.recommendationId),
    );
    expect(inspection.recommendationId).toBe(response.recommendationId);
    expect(inspection.candidateEvidence).toHaveLength(
      response.proposals.length,
    );
    expect(inspection.persistenceEvidence).toMatchObject({
      mode: 'fixture-in-memory',
      eventCount: 1,
    });
  });
  it('routes the mock chat client through the shared contract runtime', async () => {
    const sharedRuntime = createMockAutomaticRecommendationHttpRuntime(
      fixtures,
      { clock: now },
    );
    const journey: RecommendationJourneyStore = {
      record: vi.fn(async () => undefined),
    };
    const clients = createMockClients(fixtures, {
      sessionId: 'chat-fixture-test',
      automaticRecommendations: sharedRuntime,
      automaticRecommendationContext: () => ({
        storeId: fixtures.stores[0]!.storeId,
        fulfilmentMode: 'pickup',
        locale: 'vi-VN',
        orderingJourneyRef: 'chat-fixture-test:journey',
        opportunityRef: 'chat-fixture-test:recommendation',
      }),
      automaticRecommendationJourney: () => journey,
    });
    const result = await clients.recommendation.recommendAddOns(
      {
        id: 'cart-client',
        items: [
          {
            itemCode: item.code,
            name: item.name,
            quantity: 1,
            unitPriceVnd: item.priceVnd,
          },
        ],
        subtotalVnd: item.priceVnd,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: item.priceVnd,
        voucherCode: null,
      },
      {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 10_000,
      },
    );
    if (!result.ok || !result.value) throw new Error(result.message);
    const recommendedItems = result.value;
    expect(recommendedItems.length).toBeGreaterThan(0);
    expect(journey.record).toHaveBeenCalledOnce();
  });
});
