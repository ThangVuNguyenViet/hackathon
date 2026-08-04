import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { AutomaticRecommendationHttpRuntime } from '../../src/recommendations/serving/http-runtime.js';
import { createUnavailableAutomaticRecommendationHttpRuntime } from '../../src/recommendations/serving/http-runtime.js';

const request = {
  schemaVersion: 'kfc-automatic-recommendation-v1',
  requestId: 'request-1',
  storeId: 'store-1',
  fulfilmentMode: 'pickup',
  locale: 'vi-VN',
  orderingJourneyRef: 'journey-1',
  opportunityRef: 'opportunity-1',
  cart: {
    cartId: 'cart-1',
    revision: 'cart-revision-1',
    subtotal: { amount: 0, currency: 'VND' },
    lines: [],
  },
};

function runtime(): AutomaticRecommendationHttpRuntime {
  return {
    decide: vi.fn(async () => ({ status: 'empty' })),
    recordImpression: vi.fn(async () => undefined),
    recordOutcome: vi.fn(async () => undefined),
    readiness: vi.fn(async () => ({ ok: true })),
    close: vi.fn(async () => undefined),
  };
}

describe('automatic recommendation HTTP routes', () => {
  it('routes all four decisions through the process-lifetime runtime', async () => {
    const automaticRecommendations = runtime();
    const server = buildServer({ automaticRecommendations });
    for (const [path, type] of [
      ['/v1/recommendations/local-favorites', 'local_favorite'],
      ['/v1/recommendations/for-you', 'for_you'],
      ['/v1/recommendations/modifier-upsells', 'modifier_upsell'],
      ['/v1/recommendations/smart-cross-sells', 'smart_cross_sell'],
    ] as const) {
      const response = await server.inject({
        method: 'POST',
        url: path,
        payload: request,
      });
      expect(response.statusCode).toBe(200);
      expect(automaticRecommendations.decide).toHaveBeenLastCalledWith(
        type,
        request,
      );
    }
    await server.close();
    expect(automaticRecommendations.close).toHaveBeenCalledOnce();
  });

  it('durably records typed impression and outcome events before returning 204', async () => {
    const automaticRecommendations = runtime();
    const server = buildServer({ automaticRecommendations });
    const common = {
      schemaVersion: 'kfc-automatic-recommendation-event-v1',
      eventId: 'event-1',
      channel: 'kiosk',
      occurredAt: '2026-08-05T00:00:00.000Z',
      orderingJourneyRef: 'journey-1',
      opportunityRef: 'opportunity-1',
      cartRevision: 'cart-revision-1',
    };
    const impression = {
      ...common,
      renderedActions: [{ actionId: 'action-1', renderedPosition: 1 }],
    };
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/v1/recommendations/recommendation-1/impressions',
          payload: impression,
        })
      ).statusCode,
    ).toBe(204);
    expect(automaticRecommendations.recordImpression).toHaveBeenCalledWith(
      'recommendation-1',
      impression,
    );
    const outcome = {
      ...common,
      eventId: 'event-2',
      eventType: 'selected',
      actionId: 'action-1',
      renderedPosition: 1,
    };
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/v1/recommendations/recommendation-1/outcomes',
          payload: outcome,
        })
      ).statusCode,
    ).toBe(204);
    expect(automaticRecommendations.recordOutcome).toHaveBeenCalledWith(
      'recommendation-1',
      outcome,
    );
    await server.close();
  });

  it('fails closed with a typed 503 when the runtime is absent or fails', async () => {
    const absent = buildServer();
    expect(
      (
        await absent.inject({
          method: 'POST',
          url: '/v1/recommendations/local-favorites',
          payload: request,
        })
      ).json(),
    ).toMatchObject({
      status: 503,
      code: 'recommendation_infrastructure_unavailable',
    });
    await absent.close();
    const automaticRecommendations = runtime();
    vi.mocked(automaticRecommendations.decide).mockRejectedValueOnce(
      new Error('scorer unavailable'),
    );
    const failing = buildServer({ automaticRecommendations });
    expect(
      (
        await failing.inject({
          method: 'POST',
          url: '/v1/recommendations/local-favorites',
          payload: request,
        })
      ).statusCode,
    ).toBe(503);
    await failing.close();
  });

  it('exposes the process-owned unavailable provider in readiness without accepting traffic', async () => {
    const server = buildServer({
      automaticRecommendations:
        createUnavailableAutomaticRecommendationHttpRuntime(
          'trusted ports unavailable',
        ),
    });
    const readiness = await server.inject({ method: 'GET', url: '/ready' });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({
      checks: {
        automaticRecommendations: {
          ok: false,
          message: 'trusted ports unavailable',
        },
      },
    });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/v1/recommendations/local-favorites',
          payload: request,
        })
      ).statusCode,
    ).toBe(503);
    await server.close();
  });
});
