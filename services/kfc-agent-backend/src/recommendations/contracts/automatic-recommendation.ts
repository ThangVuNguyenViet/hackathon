import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  parseAutomaticRecommendationImpression,
  parseAutomaticRecommendationInspection,
  parseAutomaticRecommendationOutcome,
  parseAutomaticRecommendationProblem,
  parseAutomaticRecommendationResponse,
} from './automatic-recommendation-response.js';

export const AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST =
  '30fb774b804b4868abd78e30e489aa9fe835d3b959b38ae389c127949ac8e678';

export const automaticRecommendationOperations = {
  local_favorite: '/v1/recommendations/local-favorites',
  for_you: '/v1/recommendations/for-you',
  modifier_upsell: '/v1/recommendations/modifier-upsells',
  smart_cross_sell: '/v1/recommendations/smart-cross-sells',
} as const;

export type AutomaticRecommendationType =
  keyof typeof automaticRecommendationOperations;

const opaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);

const moneySchema = z
  .object({
    amount: z.number().int().nonnegative(),
    currency: z.literal('VND'),
  })
  .strict();

const modifierSchema = z
  .object({
    groupPath: z.array(opaqueIdSchema).min(1),
    optionId: opaqueIdSchema,
    quantity: z.number().int().positive(),
    priceImpact: moneySchema,
  })
  .strict();

const cartLineSchema = z
  .object({
    lineId: opaqueIdSchema,
    sellableItemId: opaqueIdSchema,
    quantity: z.number().int().positive(),
    unitPrice: moneySchema,
    modifiers: z.array(modifierSchema),
  })
  .strict();

const cartSchema = z
  .object({
    cartId: opaqueIdSchema,
    revision: opaqueIdSchema,
    subtotal: moneySchema,
    lines: z.array(cartLineSchema),
  })
  .strict();

const nonEmptyCartSchema = cartSchema.refine((cart) => cart.lines.length > 0, {
  path: ['lines'],
  message: 'Smart Cross-sell requires a non-empty current cart',
});

const commonRequestShape = {
  schemaVersion: z.literal('kfc-automatic-recommendation-v1'),
  requestId: opaqueIdSchema,
  storeId: opaqueIdSchema,
  fulfilmentMode: z.enum(['pickup', 'delivery']),
  locale: z.string().trim().min(2).max(35),
  orderingJourneyRef: opaqueIdSchema,
  opportunityRef: opaqueIdSchema,
} as const;

const localFavoriteRequestSchema = z
  .object({
    ...commonRequestShape,
    cart: cartSchema,
  })
  .strict();

const forYouRequestSchema = z
  .object({
    ...commonRequestShape,
    cart: cartSchema,
    verifiedCustomerRef: opaqueIdSchema,
  })
  .strict();

const modifierUpsellRequestSchema = z
  .object({
    ...commonRequestShape,
    cart: cartSchema,
    parentCartLineId: opaqueIdSchema,
  })
  .strict();

const smartCrossSellRequestSchema = z
  .object({
    ...commonRequestShape,
    cart: nonEmptyCartSchema,
  })
  .strict();

const automaticRecommendationRequestSchemas = {
  local_favorite: localFavoriteRequestSchema,
  for_you: forYouRequestSchema,
  modifier_upsell: modifierUpsellRequestSchema,
  smart_cross_sell: smartCrossSellRequestSchema,
} as const;

export type AutomaticRecommendationRequest =
  | z.infer<typeof localFavoriteRequestSchema>
  | z.infer<typeof forYouRequestSchema>
  | z.infer<typeof modifierUpsellRequestSchema>
  | z.infer<typeof smartCrossSellRequestSchema>;

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON rejects non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isJsonRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  throw new TypeError('Canonical JSON supports JSON values only');
}

export function automaticRecommendationIdentityDigest({
  operationPath,
  identityType,
  payload,
}: {
  operationPath: string;
  identityType: string;
  payload: unknown;
}): string {
  return createHash('sha256')
    .update(operationPath)
    .update('\0')
    .update(identityType)
    .update('\0')
    .update(canonicalJson(payload))
    .digest('hex');
}

export function parseAutomaticRecommendationRequest(
  type: AutomaticRecommendationType,
  value: unknown,
): AutomaticRecommendationRequest {
  return automaticRecommendationRequestSchemas[type].parse(value);
}

export function validateAutomaticRecommendationBinding(
  type: AutomaticRecommendationType,
  requestValue: unknown,
  responseValue: unknown,
) {
  const request = parseAutomaticRecommendationRequest(type, requestValue);
  const response = parseAutomaticRecommendationResponse(responseValue);
  if (request.requestId !== response.requestId) {
    throw new Error('Recommendation response request identity does not match');
  }
  if (response.recommendationType !== type) {
    throw new Error('Recommendation response type does not match the request');
  }
  if (type === 'modifier_upsell') {
    const parentCartLineId =
      modifierUpsellRequestSchema.parse(requestValue).parentCartLineId;
    if (
      response.proposals.some(
        ({ action }) =>
          action.type !== 'apply_modifier' ||
          action.parentCartLineId !== parentCartLineId,
      )
    ) {
      throw new Error('Modifier actions must target the requested parent line');
    }
  }
  return response;
}

export {
  parseAutomaticRecommendationImpression,
  parseAutomaticRecommendationInspection,
  parseAutomaticRecommendationOutcome,
  parseAutomaticRecommendationProblem,
  parseAutomaticRecommendationResponse,
  type AutomaticRecommendationResponse,
} from './automatic-recommendation-response.js';
export {
  parseAutomaticScorerRequest,
  parseAutomaticScorerResponse,
  reconcileAutomaticScorerResponse,
} from './automatic-scorer.js';
