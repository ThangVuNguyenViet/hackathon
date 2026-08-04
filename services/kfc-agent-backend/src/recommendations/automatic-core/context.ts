import { parseAutomaticRecommendationRequest } from '../contracts/automatic-recommendation.js';
import type {
  AutomaticRecommendationContextPorts,
  AutomaticRecommendationContextResolution,
  AutomaticRecommendationRequest,
  AutomaticRecommendationType,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasEmptyCart(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.cart)) {
    return false;
  }
  return Array.isArray(value.cart.lines) && value.cart.lines.length === 0;
}

function readRequiredString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== 'string') {
    throw new TypeError(`Expected trusted request field ${key}`);
  }
  return value[key];
}

export async function resolveAutomaticRecommendationContext({
  recommendationType,
  request: requestValue,
  ports,
}: {
  recommendationType: AutomaticRecommendationType;
  request: unknown;
  ports: AutomaticRecommendationContextPorts;
}): Promise<AutomaticRecommendationContextResolution> {
  const smartCrossSellHasEmptyCart =
    recommendationType === 'smart_cross_sell' && hasEmptyCart(requestValue);
  const request = parseAutomaticRecommendationRequest(
    smartCrossSellHasEmptyCart ? 'local_favorite' : recommendationType,
    requestValue,
  ) as AutomaticRecommendationRequest;
  const catalog = await ports.catalog.readSnapshot({
    storeId: request.storeId,
    fulfilmentMode: request.fulfilmentMode,
    locale: request.locale,
  });
  const commonEvidence = {
    cartRevision: request.cart.revision,
    catalogRevision: catalog.catalogRevision,
  };

  if (smartCrossSellHasEmptyCart) {
    return { kind: 'empty', reason: 'empty_cart', ...commonEvidence };
  }

  if ((await ports.exposure.readState(recommendationType)) === 'paused') {
    return {
      kind: 'paused',
      reason: 'recommendation_serving_paused',
      ...commonEvidence,
    };
  }

  let history = null;
  if (recommendationType === 'for_you') {
    history = await ports.history.readCompletedHistory(
      readRequiredString(requestValue, 'verifiedCustomerRef'),
    );
    if (history === null || history.completedOrderCount === 0) {
      return {
        kind: 'empty',
        reason: 'insufficient_history',
        ...commonEvidence,
      };
    }
  }

  let parentCartLine = null;
  if (recommendationType === 'modifier_upsell') {
    const parentCartLineId = readRequiredString(
      requestValue,
      'parentCartLineId',
    );
    parentCartLine =
      request.cart.lines.find(({ lineId }) => lineId === parentCartLineId) ??
      null;
    if (parentCartLine === null) {
      return {
        kind: 'empty',
        reason: 'parent_cart_line_not_found',
        ...commonEvidence,
      };
    }
  }

  return {
    kind: 'ready',
    context: {
      recommendationType,
      request,
      decisionTime: ports.clock.now().toISOString(),
      catalog,
      history,
      parentCartLine,
    },
  };
}
