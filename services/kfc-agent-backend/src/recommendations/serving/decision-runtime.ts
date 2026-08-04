import {
  automaticRecommendationIdentityDigest,
  parseAutomaticRecommendationRequest,
} from '../contracts/automatic-recommendation.js';
import { parseAutomaticRecommendationResponse } from '../contracts/automatic-recommendation-response.js';
import {
  parseJsonValue,
  type AutomaticDecisionEvidence,
} from './evidence-contracts.js';
import {
  AutomaticEvidencePersistenceError,
  AutomaticRecommendationIdentityConflictError,
} from './evidence-saga.js';

export function createAutomaticRecommendationServingRuntime({
  engine,
  evidence,
  contractDigest,
  clock = () => new Date(),
  technicalEvidence,
}: {
  engine: {
    decide(
      type: AutomaticDecisionEvidence['recommendationType'],
      request: unknown,
    ): Promise<unknown>;
  };
  evidence: {
    commitClaimedDecision(
      value: AutomaticDecisionEvidence,
      ownerToken: string,
    ): Promise<unknown>;
    claimDecision(input: {
      idempotencyKey: string;
      requestDigest: string;
      cartDigest: string;
      contextDigest: string;
    }): Promise<{
      status: 'acquired' | 'pending' | 'replayed';
      ownerToken: string;
    }>;
    releaseDecisionClaim(input: {
      idempotencyKey: string;
      requestDigest: string;
      ownerToken: string;
    }): Promise<void>;
    readDecision(
      idempotencyKey: string,
    ): Promise<AutomaticDecisionEvidence | null>;
  };
  contractDigest: string;
  clock?: () => Date;
  technicalEvidence: (input: {
    request: ReturnType<typeof parseAutomaticRecommendationRequest>;
    response: ReturnType<typeof parseAutomaticRecommendationResponse>;
  }) => AutomaticDecisionEvidence['technical'];
}) {
  const flights = new Map<
    string,
    {
      requestDigest: string;
      promise: Promise<ReturnType<typeof parseAutomaticRecommendationResponse>>;
    }
  >();
  return {
    async decide(
      recommendationType: AutomaticDecisionEvidence['recommendationType'],
      request: unknown,
    ) {
      const binding = parseAutomaticRecommendationRequest(
        recommendationType,
        request,
      );
      const operationPath = {
        local_favorite: '/v1/recommendations/local-favorites',
        for_you: '/v1/recommendations/for-you',
        modifier_upsell: '/v1/recommendations/modifier-upsells',
        smart_cross_sell: '/v1/recommendations/smart-cross-sells',
      }[recommendationType];
      const requestDigest = automaticRecommendationIdentityDigest({
        operationPath,
        identityType: recommendationType,
        payload: binding,
      });
      const cartDigest = automaticRecommendationIdentityDigest({
        operationPath: `${operationPath}/cart`,
        identityType: 'cart',
        payload: binding.cart,
      });
      const contextDigest = automaticRecommendationIdentityDigest({
        operationPath: `${operationPath}/context`,
        identityType: 'trusted-context-binding',
        payload: {
          storeId: binding.storeId,
          fulfilmentMode: binding.fulfilmentMode,
          locale: binding.locale,
          orderingJourneyRef: binding.orderingJourneyRef,
          opportunityRef: binding.opportunityRef,
          ...('verifiedCustomerRef' in binding
            ? { verifiedCustomerRef: binding.verifiedCustomerRef }
            : {}),
          ...('parentCartLineId' in binding
            ? { parentCartLineId: binding.parentCartLineId }
            : {}),
        },
      });
      const durable = await evidence.readDecision(binding.requestId);
      if (durable !== null) {
        if (
          durable.requestDigest !== requestDigest ||
          durable.cartDigest !== cartDigest ||
          durable.contextDigest !== contextDigest ||
          durable.recommendationType !== recommendationType
        ) {
          throw new AutomaticRecommendationIdentityConflictError();
        }
        return parseAutomaticRecommendationResponse(durable.response);
      }
      const flight = flights.get(binding.requestId);
      if (flight !== undefined) {
        if (flight.requestDigest !== requestDigest) {
          throw new AutomaticRecommendationIdentityConflictError();
        }
        return flight.promise;
      }
      const claim = await evidence.claimDecision({
        idempotencyKey: binding.requestId,
        requestDigest,
        cartDigest,
        contextDigest,
      });
      if (claim.status !== 'acquired') {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const winner = await evidence.readDecision(binding.requestId);
          if (winner !== null) {
            if (
              winner.requestDigest !== requestDigest ||
              winner.cartDigest !== cartDigest ||
              winner.contextDigest !== contextDigest
            )
              throw new AutomaticRecommendationIdentityConflictError();
            return parseAutomaticRecommendationResponse(winner.response);
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new AutomaticEvidencePersistenceError('transaction_failed');
      }
      const promise = (async () => {
        try {
          const response = parseAutomaticRecommendationResponse(
            await engine.decide(recommendationType, binding),
          );
          await evidence.commitClaimedDecision(
            {
              idempotencyKey: binding.requestId,
              recommendationId: response.recommendationId,
              requestId: binding.requestId,
              requestDigest,
              contextDigest,
              orderingJourneyRef: binding.orderingJourneyRef,
              opportunityRef: binding.opportunityRef,
              recommendationType,
              storeId: binding.storeId,
              fulfilmentMode: binding.fulfilmentMode,
              locale: binding.locale,
              cartId: binding.cart.cartId,
              cartRevision: binding.cart.revision,
              cartDigest,
              catalogRevision: response.catalogRevision,
              decisionTime: clock().toISOString(),
              expiresAt: response.expiresAt,
              contractDigest,
              response: parseJsonValue(response),
              technical: technicalEvidence({ request: binding, response }),
            },
            claim.ownerToken,
          );
          return response;
        } catch (error) {
          await evidence
            .releaseDecisionClaim({
              idempotencyKey: binding.requestId,
              requestDigest,
              ownerToken: claim.ownerToken,
            })
            .catch(() => undefined);
          throw error;
        }
      })();
      flights.set(binding.requestId, { requestDigest, promise });
      try {
        return await promise;
      } finally {
        if (flights.get(binding.requestId)?.promise === promise) {
          flights.delete(binding.requestId);
        }
      }
    },
  };
}
