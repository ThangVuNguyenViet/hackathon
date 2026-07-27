import { describe, expect, it } from 'vitest';
import type { AgentState } from '../../src/agent/agentState.js';
import type { RecommendationDecisionResponse } from '../../src/recommendations/domain/contracts.js';
import { parseRecommendationDecisionResponse } from '../../src/recommendations/domain/schemas.js';
import type { RecommendationPresentation } from '../../src/recommendations/application/service-types.js';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';

const versions = {
  catalog: 'catalog-v1',
  modifierGraph: 'modifier-v1',
  store: 'store-v1',
  availability: 'availability-v1',
  promotion: 'promotion-v1',
  eligibilityPolicy: 'eligibility-v1',
  sanitySnapshot: {
    snapshotId: 'sanity-v1',
    digest: 'a'.repeat(64),
    contributingRevisions: ['sanity-revision-v1'],
  },
  featureSchema: 'feature-v1',
  servingRanker: 'ranker-v1',
  shadowModel: null,
  calibration: null,
  experiment: 'experiment-v1',
  loggingPolicy: 'logging-v1',
} as const;

function response(): RecommendationDecisionResponse {
  return parseRecommendationDecisionResponse({
    schemaVersion: 'kfc-recommendation-v1',
    recommendationId: 'recommendation-starter-1',
    requestId: 'recommendation-request-starter-1',
    orderFlowId: 'order-flow-1',
    placement: 'local_favorite',
    status: 'recommended',
    decisionSource: 'ranked',
    primaryOffer: {
      actions: [
        {
          type: 'add_product',
          actionId: 'recommendation-action-1',
          sellableItemId: 'item-secret-server-target',
          quantity: 1,
          priceImpact: { amount: 49_000, currency: 'VND' },
          cartRevision: 'cart-revision-1',
        },
      ],
    },
    displayFacts: [
      {
        actionId: 'recommendation-action-1',
        name: '1 Miếng Gà Giòn Cay',
        imageUrl: 'https://static.kfcvietnam.com.vn/item-1.webp',
        priceImpact: { amount: 49_000, currency: 'VND' },
      },
    ],
    reasonCodes: ['popular_here'],
    merchandisingEffects: [],
    versionBindings: versions,
    counts: {
      potential: 1,
      eligible: 1,
      ineligible: 0,
      scored: 1,
      displayed: 1,
      complete: true,
    },
    traceRef: 'trace-starter-1',
  });
}

function presentation(): RecommendationPresentation {
  return {
    response: response(),
    binding: {
      recommendationId: 'recommendation-starter-1',
      assistantTurnId: 'recommendation-turn-1',
      attachmentId: 'recommendation-attachment-1',
      renderedActions: [
        { actionId: 'recommendation-action-1', position: 1 },
      ],
      actionDigest: 'b'.repeat(64),
      decisionDigest: 'c'.repeat(64),
      versionBindingDigest: 'd'.repeat(64),
      sessionId: 'kfc:customer-1',
      customerId: 'customer-1',
      cartRevision: 'cart-revision-1',
    },
  };
}

function state(): AgentState {
  return {
    sessionId: 'kfc:customer-1',
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage: 'Cho tôi xem món ngon',
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

describe('recommendationOffer GenUI selection', () => {
  it('renders only verified display facts with dynamic ID-only actions', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state(),
      turnToolNames: ['recommendStarter'],
      recommendationPresentation: presentation(),
      issuedAt: new Date('2026-07-27T09:00:00Z'),
    });

    expect(attachment).toMatchObject({
      id: 'recommendation-attachment-1',
      lifecycleStage: 'recommendation',
      widgetKind: 'recommendationOffer',
      status: 'active',
      data: {
        recommendationId: 'recommendation-starter-1',
        orderFlowId: 'order-flow-1',
        placement: 'local_favorite',
        decisionSource: 'ranked',
        cartRevision: 'cart-revision-1',
        actionDigest: 'b'.repeat(64),
        decisionDigest: 'c'.repeat(64),
        versionBindingDigest: 'd'.repeat(64),
        offers: [
          {
            recommendationActionId: 'recommendation-action-1',
            kind: 'product',
            name: '1 Miếng Gà Giòn Cay',
            imageUrl: 'https://static.kfcvietnam.com.vn/item-1.webp',
            price: { amount: 49_000, currency: 'VND' },
            priceImpact: { amount: 49_000, currency: 'VND' },
          },
        ],
      },
      actions: [
        {
          id: 'recommendation_select:recommendation-action-1',
          label: 'Thêm vào đơn',
          intent: 'primary',
        },
        {
          id: 'recommendation_dismiss',
          label: 'Không, cảm ơn',
          intent: 'secondary',
        },
      ],
      authority: {
        actionLifecycle: 'one_shot',
        sessionId: 'kfc:customer-1',
        customerId: 'customer-1',
      },
    });
    expect(JSON.stringify(attachment)).not.toContain(
      'item-secret-server-target',
    );
    expect(attachment?.actions.every((action) => !action.payload)).toBe(true);
  });

  it('fails closed when the server-only presentation binding is for another customer', () => {
    expect(
      selectKfcGenUiAttachment({
        state: state(),
        turnToolNames: ['recommendStarter'],
        recommendationPresentation: {
          ...presentation(),
          binding: {
            ...presentation().binding,
            customerId: 'another-customer',
          },
        },
      }),
    ).toBeUndefined();
  });
});
