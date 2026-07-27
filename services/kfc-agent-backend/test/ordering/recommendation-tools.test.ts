import { describe, expect, it, vi } from 'vitest';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';
import type { RecommendationApplicationService } from '../../src/recommendations/application/service-types.js';
import type { RecommendationDecisionResponse } from '../../src/recommendations/domain/contracts.js';
import { parseRecommendationDecisionResponse } from '../../src/recommendations/domain/schemas.js';
import { initialRecommendationState } from '../../src/recommendations/state/state-machine.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';

const instant = '2026-07-27T09:00:00Z';

function snapshotBinding(name: string, digestCharacter: string) {
  return {
    snapshotId: `${name}-snapshot-001`,
    digest: digestCharacter.repeat(64),
    sourceRevision: `${name}-revision-001`,
    observedAt: '2026-07-27T08:00:00Z',
    effectiveAt: '2026-07-27T08:00:00Z',
    expiresAt: '2026-07-27T10:00:00Z',
    complete: true,
    commerceEnvironment: 'kfc-vietnam-demo',
    provenance: { source: 'test', reference: name },
  };
}

const versionBindings = {
  catalog: 'catalog-snapshot-001',
  modifierGraph: 'modifier-graph-snapshot-001',
  store: 'store-snapshot-001',
  availability: 'availability-snapshot-001',
  promotion: 'promotion-snapshot-001',
  eligibilityPolicy: 'kfc-recommendation-policy-v1',
  sanitySnapshot: {
    snapshotId: 'sanity-snapshot-001',
    digest: 'f'.repeat(64),
    contributingRevisions: ['sanity-revision-001'],
  },
  featureSchema: 'feature-schema-001',
  servingRanker: 'ranker-001',
  shadowModel: null,
  calibration: null,
  experiment: 'experiment-001',
  loggingPolicy: 'logging-policy-001',
};

function response(
  placement: RecommendationDecisionResponse['placement'],
  status: 'recommended' | 'empty' | 'suppressed' = 'recommended',
  orderFlowId = 'order-flow-001',
): RecommendationDecisionResponse {
  const recommended = status === 'recommended';
  const action = {
    type: 'add_product' as const,
    actionId: 'product:20751',
    sellableItemId: '20751',
    quantity: 1,
    priceImpact: { amount: 99_000, currency: 'VND' as const },
    cartRevision: 'cart-revision-001',
  };
  return parseRecommendationDecisionResponse({
    schemaVersion: 'kfc-recommendation-v1',
    recommendationId: `recommendation-${placement}-${status}`,
    requestId: 'request-001',
    orderFlowId,
    placement,
    status,
    decisionSource: status === 'suppressed' ? 'suppressed' : 'ranked',
    primaryOffer: recommended ? { actions: [action] } : null,
    displayFacts: recommended
      ? [
          {
            actionId: action.actionId,
            name: 'Combo Hợp Gu 99K',
            imageUrl: null,
            priceImpact: action.priceImpact,
          },
        ]
      : [],
    reasonCodes: recommended ? ['popular_here'] : [],
    merchandisingEffects: [],
    versionBindings,
    counts: {
      potential: recommended ? 1 : 0,
      eligible: recommended ? 1 : 0,
      ineligible: 0,
      scored: recommended ? 1 : 0,
      displayed: recommended ? 1 : 0,
      complete: true,
    },
    traceRef: 'trace-001',
  });
}

function recommendationContext(input: {
  application: RecommendationApplicationService;
  verifiedCustomer?: {
    ref: string;
    hasPriorCompletedHistory: boolean;
  } | null;
}) {
  return {
    application: input.application,
    verifiedCustomer: input.verifiedCustomer ?? null,
    storeId: 'KFCVN0002',
    fulfilmentMode: 'pickup' as const,
    decisionTime: instant,
    commerceSnapshotBindings: {
      catalog: snapshotBinding('catalog', 'a'),
      modifierGraph: snapshotBinding('modifier-graph', 'b'),
      store: snapshotBinding('store', 'c'),
      availability: snapshotBinding('availability', 'd'),
      promotion: snapshotBinding('promotion', 'e'),
    },
    experimentProfile: {
      profileId: 'experiment-profile-001',
      outputMode: 'baseline' as const,
    },
  };
}

function applicationReturning(
  value: RecommendationDecisionResponse,
): RecommendationApplicationService {
  return {
    hasPriorCompletedHistory: vi.fn(),
    decide: vi.fn(async () => ({ status: 'decided' as const, response: value })),
    recordImpression: vi.fn(),
    recordOutcome: vi.fn(),
  };
}

describe('recommendation ordering tools', () => {
  it('selects For You only for verified completed history and injects all decision context', async () => {
    const application = applicationReturning(response('for_you'));
    const clients = createMockClients(await loadGeneratedFixtures(process.cwd()));
    const result = await executeToolCall(
      clients,
      {
        toolName: 'recommendStarter',
        arguments: { requestKind: 'proactive' },
      },
      {
        externalCallContext: {
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 60_000,
        },
        state: {
          sessionId: 'session-001',
          customerId: 'customer-001',
          channel: 'kfc',
          latestUserMessage: 'Cho tôi món ngon',
          escalationReasons: [],
          retrievedEvidence: [],
          cart: {
            id: 'cart-001',
            items: [],
            subtotalVnd: 0,
            discountVnd: 0,
            deliveryFeeVnd: 0,
            totalVnd: 0,
            voucherCode: null,
          },
          recommendationState: initialRecommendationState('order-flow-001'),
        },
        durableRequestIdentity: 'turn-001',
        recommendation: recommendationContext({
          application,
          verifiedCustomer: {
            ref: 'demo-returning-linked',
            hasPriorCompletedHistory: true,
          },
        }),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: { status: 'recommended' },
    });
    expect(application.decide).toHaveBeenCalledWith({
      requestKind: 'proactive',
      trusted: {},
      request: expect.objectContaining({
        schemaVersion: 'kfc-recommendation-v1',
        sessionId: 'session-001',
        orderFlowId: 'order-flow-001',
        placement: 'for_you',
        verifiedCustomerRef: 'demo-returning-linked',
        storeId: 'KFCVN0002',
        fulfilmentMode: 'pickup',
        decisionTime: instant,
        commerceSnapshotBindings: expect.any(Object),
        eligibilityPolicyVersion: 'kfc-recommendation-policy-v1',
        experimentProfile: {
          profileId: 'experiment-profile-001',
          outputMode: 'baseline',
        },
      }),
    });
  });

  it.each([
    [null, 'local_favorite'],
    [
      { ref: 'demo-linked-zero-history', hasPriorCompletedHistory: false },
      'local_favorite',
    ],
  ] as const)(
    'falls back to Local Favorite for %j',
    async (verifiedCustomer, placement) => {
      const application = applicationReturning(response(placement));
      const clients = createMockClients(
        await loadGeneratedFixtures(process.cwd()),
      );
      await executeToolCall(
        clients,
        {
          toolName: 'recommendStarter',
          arguments: { requestKind: 'proactive' },
        },
        {
          externalCallContext: {
            signal: new AbortController().signal,
            deadlineAt: Date.now() + 60_000,
          },
          sessionId: 'session-001',
          cart: {
            id: 'cart-001',
            items: [],
            subtotalVnd: 0,
            discountVnd: 0,
            deliveryFeeVnd: 0,
            totalVnd: 0,
            voucherCode: null,
          },
          durableRequestIdentity: 'turn-001',
          recommendation: recommendationContext({
            application,
            verifiedCustomer,
          }),
        },
      );
      expect(application.decide).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            placement: 'local_favorite',
            verifiedCustomerRef: verifiedCustomer?.ref ?? null,
          }),
        }),
      );
    },
  );

  it.each(['empty', 'suppressed'] as const)(
    'returns a typed silent result after a %s decision consumes the placement',
    async (status) => {
      const application = applicationReturning(
        response('smart_cross_sell', status, 'order-flow:session-001'),
      );
      const clients = createMockClients(
        await loadGeneratedFixtures(process.cwd()),
      );
      const result = await executeToolCall(
        clients,
        {
          toolName: 'recommendSmartCrossSell',
          arguments: { requestKind: 'proactive' },
        },
        {
          externalCallContext: {
            signal: new AbortController().signal,
            deadlineAt: Date.now() + 60_000,
          },
          sessionId: 'session-001',
          cart: {
            id: 'cart-001',
            items: [],
            subtotalVnd: 0,
            discountVnd: 0,
            deliveryFeeVnd: 0,
            totalVnd: 0,
            voucherCode: null,
          },
          durableRequestIdentity: 'turn-001',
          recommendation: recommendationContext({ application }),
        },
      );

      expect(result).toMatchObject({
        ok: true,
        value: { status: 'silent', recommendation: null },
      });
    },
  );
});
