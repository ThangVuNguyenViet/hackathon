import type { RecommendationClient } from '../clients/interfaces.js';
import type { Cart, MenuItem } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import {
  automaticRecommendationIdentityDigest,
  parseAutomaticRecommendationResponse,
} from '../recommendations/contracts/automatic-recommendation.js';
import { createMockAutomaticRecommendationHttpRuntime } from '../recommendations/serving/mock-runtime.js';
import { mockFailure as fail, mockSuccess as ok } from './mockToolResults.js';
import type { MockClientOptions } from './mockClientOptions.js';

function toAutomaticRecommendationCart(cart: Cart) {
  const revision = automaticRecommendationIdentityDigest({
    operationPath: '/v1/recommendations/cart',
    identityType: 'cart_revision',
    payload: cart,
  });
  return {
    cartId: cart.id,
    revision,
    subtotal: { amount: cart.subtotalVnd, currency: 'VND' as const },
    lines: cart.items.map((item, index) => ({
      lineId: `${cart.id}:line:${index + 1}`,
      sellableItemId: item.itemCode,
      quantity: item.quantity,
      unitPrice: { amount: item.unitPriceVnd, currency: 'VND' as const },
      modifiers: (item.modifiers ?? []).map((modifier) => ({
        groupPath: [modifier.groupId],
        optionId: modifier.modifierId,
        quantity: modifier.quantity,
        priceImpact: {
          amount: modifier.priceDeltaVnd,
          currency: 'VND' as const,
        },
      })),
    })),
  };
}

export function createMockRecommendationClient(
  fixtures: GeneratedFixtures,
  options: MockClientOptions,
  menuByCode: ReadonlyMap<string, MenuItem>,
): RecommendationClient {
  const recommendationRuntime =
    options.automaticRecommendations ??
    createMockAutomaticRecommendationHttpRuntime(fixtures);
  const recommendationSessionId = options.sessionId ?? 'fixture-session';

  return {
    async recommendAddOns(cart) {
      const context = (await options.automaticRecommendationContext?.(
        recommendationSessionId,
        cart,
      )) ?? {
        storeId: fixtures.stores[0]?.storeId ?? 'fixture-store',
        fulfilmentMode: 'pickup' as const,
        locale: 'vi-VN',
        orderingJourneyRef: `chat:${recommendationSessionId}:ordering-journey`,
        opportunityRef: `chat:${recommendationSessionId}:automatic-recommendation`,
      };
      const automaticCart = toAutomaticRecommendationCart(cart);
      const request = {
        schemaVersion: 'kfc-automatic-recommendation-v1' as const,
        requestId: `chat:${recommendationSessionId}:smart-cross-sell:${automaticCart.revision}`,
        storeId: context.storeId,
        fulfilmentMode: context.fulfilmentMode,
        locale: context.locale,
        orderingJourneyRef: context.orderingJourneyRef,
        opportunityRef: context.opportunityRef,
        cart: automaticCart,
      };
      try {
        const response = parseAutomaticRecommendationResponse(
          await recommendationRuntime.decide('smart_cross_sell', request),
        );
        const candidateActions = response.proposals.flatMap((proposal) =>
          proposal.action.type === 'add_product'
            ? [
                {
                  actionId: proposal.actionId,
                  itemCode: proposal.action.sellableItemId,
                  renderedPosition: response.proposals.indexOf(proposal) + 1,
                },
              ]
            : [],
        );
        const items = candidateActions.flatMap((candidate) => {
          const item = menuByCode.get(candidate.itemCode);
          return item ? [item] : [];
        });
        if (items.length > 0) {
          await options
            .automaticRecommendationJourney?.(recommendationSessionId)
            .record({
              recommendationId: response.recommendationId,
              requestId: response.requestId,
              recommendationType: response.recommendationType,
              channel: 'chat',
              cartRevision: response.cartRevision,
              catalogRevision: response.catalogRevision,
              orderingJourneyRef: context.orderingJourneyRef,
              opportunityRef: context.opportunityRef,
              expiresAt: response.expiresAt,
              candidateActions,
            });
          await recommendationRuntime.recordImpression(
            response.recommendationId,
            {
              schemaVersion: 'kfc-automatic-recommendation-event-v1',
              eventId: `${response.recommendationId}:impression`,
              channel: 'chat',
              occurredAt: new Date().toISOString(),
              orderingJourneyRef: context.orderingJourneyRef,
              opportunityRef: context.opportunityRef,
              cartRevision: response.cartRevision,
              renderedActions: candidateActions.map(
                ({ actionId, renderedPosition }) => ({
                  actionId,
                  renderedPosition,
                }),
              ),
            },
          );
        }
        return ok(items);
      } catch (error) {
        return fail(
          'recommendation_runtime_unavailable',
          error instanceof Error
            ? error.message
            : 'Fixture recommendation runtime failed',
        );
      }
    },
  };
}
