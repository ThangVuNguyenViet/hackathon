import {
  automaticRecommendationIdentityDigest,
  parseAutomaticRecommendationRequest,
} from '../contracts/automatic-recommendation.js';
import { AutomaticRecommendationBindingError } from './errors.js';
import {
  catalogSnapshotSchema,
  completedHistorySnapshotSchema,
  decisionTimeSchema,
  exposureStateSchema,
  trustedOrderContextSnapshotSchema,
} from './snapshots.js';
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

function bindingDigest(identityType: string, payload: unknown): string {
  return automaticRecommendationIdentityDigest({
    operationPath: '/internal/trusted-order-context',
    identityType,
    payload,
  });
}

function requireBinding(
  binding: string,
  submitted: unknown,
  trusted: unknown,
): void {
  if (
    bindingDigest(`submitted:${binding}`, submitted) !==
    bindingDigest(`submitted:${binding}`, trusted)
  ) {
    throw new AutomaticRecommendationBindingError(binding);
  }
}

function parseTrustedSnapshot<T>(
  parser: { parse(value: unknown): T },
  value: unknown,
  name: string,
): T {
  try {
    return parser.parse(value);
  } catch (cause) {
    throw new TypeError(`Trusted ${name} snapshot is invalid`, { cause });
  }
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
  const orderValue = await ports.orderContext.readSnapshot({
    orderingJourneyRef: request.orderingJourneyRef,
    opportunityRef: request.opportunityRef,
  });
  if (orderValue === null) {
    throw new AutomaticRecommendationBindingError('order context');
  }
  const order = parseTrustedSnapshot(
    trustedOrderContextSnapshotSchema,
    orderValue,
    'order context',
  );
  requireBinding(
    'ordering journey',
    request.orderingJourneyRef,
    order.orderingJourneyRef,
  );
  requireBinding('opportunity', request.opportunityRef, order.opportunityRef);
  requireBinding('store', request.storeId, order.storeId);
  requireBinding('fulfilment', request.fulfilmentMode, order.fulfilmentMode);
  requireBinding('locale', request.locale, order.locale);
  requireBinding('cart', request.cart, order.cart);
  if (recommendationType === 'for_you') {
    requireBinding(
      'verified customer',
      readRequiredString(requestValue, 'verifiedCustomerRef'),
      order.verifiedCustomerRef,
    );
  }
  if (recommendationType === 'modifier_upsell') {
    requireBinding(
      'modifier parent',
      readRequiredString(requestValue, 'parentCartLineId'),
      order.parentCartLineId,
    );
  }
  const catalog = parseTrustedSnapshot(
    catalogSnapshotSchema,
    await ports.catalog.readSnapshot({
      storeId: order.storeId,
      fulfilmentMode: order.fulfilmentMode,
      locale: order.locale,
    }),
    'catalog',
  );
  const decisionTime = parseTrustedSnapshot(
    decisionTimeSchema,
    ports.clock.now(),
    'decision clock',
  ).toISOString();
  const commonEvidence = {
    decisionTime,
    cartRevision: order.cart.revision,
    catalogRevision: catalog.catalogRevision,
  };

  if (
    recommendationType === 'smart_cross_sell' &&
    order.cart.lines.length === 0
  ) {
    return { kind: 'empty', reason: 'empty_cart', ...commonEvidence };
  }

  const exposure = parseTrustedSnapshot(
    exposureStateSchema,
    await ports.exposure.readState(recommendationType),
    'exposure',
  );
  if (exposure === 'paused') {
    return {
      kind: 'paused',
      reason: 'recommendation_serving_paused',
      ...commonEvidence,
    };
  }

  let history = null;
  if (recommendationType === 'for_you') {
    const historyValue = await ports.history.readCompletedHistory(
      order.verifiedCustomerRef ?? '',
    );
    history =
      historyValue === null
        ? null
        : parseTrustedSnapshot(
            completedHistorySnapshotSchema,
            historyValue,
            'completed history',
          );
    if (
      history !== null &&
      history.verifiedCustomerRef !== order.verifiedCustomerRef
    ) {
      throw new TypeError(
        'Trusted completed history snapshot has the wrong customer binding',
      );
    }
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
    const parentCartLineId = order.parentCartLineId;
    parentCartLine =
      order.cart.lines.find(({ lineId }) => lineId === parentCartLineId) ??
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
      order,
      decisionTime,
      catalog,
      history,
      parentCartLine,
    },
  };
}
