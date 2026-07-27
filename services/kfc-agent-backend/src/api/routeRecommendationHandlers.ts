import { z } from 'zod';
import type { EventApplicationResult } from '../recommendations/application/service-types.js';
import type {
  RecommendationDecisionRequest,
  RecommendationImpressionRequest,
  RecommendationOutcomeRequest,
} from '../recommendations/domain/contracts.js';
import {
  parseRecommendationDecisionRequest,
  parseRecommendationImpressionRequest,
  parseRecommendationOutcomeRequest,
} from '../recommendations/domain/schemas.js';
import type { RouteHandlerContext } from './routeHandlerContext.js';
import type { HandlerResponse } from './routeHandlerContracts.js';

export const recommendationJsonResponse = <T>(
  response: Omit<HandlerResponse<T>, 'contentType' | 'headers'>,
): HandlerResponse<T> => ({
  ...response,
  contentType: 'application/json; charset=utf-8',
  headers: { 'cache-control': 'no-store, no-cache, max-age=0' },
});

const notConfigured = (): HandlerResponse =>
  recommendationJsonResponse({
    status: 503,
    body: { errorCode: 'recommendation_service_not_configured' },
  });

const recommendationIdSchema = z.string().trim().min(1);

export function invalidRecommendationJsonResponse(
  method: string,
  pathname: string,
): HandlerResponse | undefined {
  if (method !== 'POST') return undefined;
  if (pathname === '/v1/recommendations/decide') {
    return recommendationJsonResponse({
      status: 400,
      body: { errorCode: 'invalid_recommendation_request' },
    });
  }
  if (/^\/v1\/recommendations\/[^/]+\/impressions$/u.test(pathname)) {
    return recommendationJsonResponse({
      status: 400,
      body: { errorCode: 'invalid_recommendation_impression' },
    });
  }
  if (/^\/v1\/recommendations\/[^/]+\/outcomes$/u.test(pathname)) {
    return recommendationJsonResponse({
      status: 400,
      body: { errorCode: 'invalid_recommendation_outcome' },
    });
  }
  return undefined;
}

function eventResponse(result: EventApplicationResult): HandlerResponse {
  switch (result.status) {
    case 'recorded':
      return recommendationJsonResponse({
        status: 201,
        body: { event: result.event, deduplicated: false },
      });
    case 'replay':
      return recommendationJsonResponse({
        status: 200,
        body: { event: result.event, deduplicated: true },
      });
    case 'not_found':
      return recommendationJsonResponse({
        status: 404,
        body: { errorCode: 'recommendation_not_found' },
      });
    case 'idempotency_conflict':
    case 'state_conflict':
      return recommendationJsonResponse({
        status: 409,
        body: { errorCode: 'recommendation_event_conflict' },
      });
    case 'stale_recommendation':
      return recommendationJsonResponse({
        status: 409,
        body: { errorCode: 'stale_recommendation' },
      });
    case 'cart_revision_conflict':
      return recommendationJsonResponse({
        status: 409,
        body: { errorCode: 'recommendation_cart_revision_conflict' },
      });
    case 'render_binding_conflict':
      return recommendationJsonResponse({
        status: 409,
        body: { errorCode: 'recommendation_render_binding_conflict' },
      });
  }
}

export function createRecommendationRouteHandlers(
  context: RouteHandlerContext,
) {
  return {
    async recommendationDecide(body: unknown): Promise<HandlerResponse> {
      if (!context.recommendations) return notConfigured();
      let request: RecommendationDecisionRequest;
      try {
        request = parseRecommendationDecisionRequest(body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return recommendationJsonResponse({
            status: 400,
            body: { errorCode: 'invalid_recommendation_request' },
          });
        }
        throw error;
      }
      const result = await context.recommendations.application.decide({
        request,
      });
      switch (result.status) {
        case 'decided':
        case 'replay':
          return recommendationJsonResponse({
            status: 200,
            body: result.response,
          });
        case 'pending':
          return recommendationJsonResponse({
            status: 425,
            body: { errorCode: 'recommendation_request_pending' },
          });
        case 'idempotency_conflict':
          return recommendationJsonResponse({
            status: 409,
            body: { errorCode: 'recommendation_idempotency_conflict' },
          });
        case 'state_conflict':
          return recommendationJsonResponse({
            status: 409,
            body: { errorCode: 'recommendation_state_conflict' },
          });
      }
    },

    async recommendationImpression(
      recommendationId: string,
      body: unknown,
    ): Promise<HandlerResponse> {
      if (!context.recommendations) return notConfigured();
      let parsedRecommendationId: string;
      let request: RecommendationImpressionRequest;
      try {
        parsedRecommendationId = recommendationIdSchema.parse(recommendationId);
        request = parseRecommendationImpressionRequest(body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return recommendationJsonResponse({
            status: 400,
            body: { errorCode: 'invalid_recommendation_impression' },
          });
        }
        throw error;
      }
      return eventResponse(
        await context.recommendations.application.recordImpression(
          parsedRecommendationId,
          request,
        ),
      );
    },

    async recommendationOutcome(
      recommendationId: string,
      body: unknown,
    ): Promise<HandlerResponse> {
      if (!context.recommendations) return notConfigured();
      let parsedRecommendationId: string;
      let request: RecommendationOutcomeRequest;
      try {
        parsedRecommendationId = recommendationIdSchema.parse(recommendationId);
        request = parseRecommendationOutcomeRequest(body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return recommendationJsonResponse({
            status: 400,
            body: { errorCode: 'invalid_recommendation_outcome' },
          });
        }
        throw error;
      }
      void parsedRecommendationId;
      void request;
      return recommendationJsonResponse({
        status: 403,
        body: { errorCode: 'untrusted_recommendation_outcome' },
      });
    },

    async recommendationInspection(
      recommendationId: string,
    ): Promise<HandlerResponse> {
      if (!context.recommendations) return notConfigured();
      const result =
        await context.recommendations.inspection.recommendation(
          recommendationId,
        );
      return result
        ? recommendationJsonResponse({ status: 200, body: result })
        : recommendationJsonResponse({
            status: 404,
            body: { errorCode: 'recommendation_not_found' },
          });
    },

    async recommendationOrderFlowState(
      orderFlowId: string,
    ): Promise<HandlerResponse> {
      if (!context.recommendations) return notConfigured();
      const result =
        await context.recommendations.inspection.orderFlow(orderFlowId);
      return result
        ? recommendationJsonResponse({ status: 200, body: result })
        : recommendationJsonResponse({
            status: 404,
            body: { errorCode: 'recommendation_not_found' },
          });
    },
  };
}
