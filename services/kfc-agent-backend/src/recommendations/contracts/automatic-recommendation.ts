import { z } from 'zod';

export const AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST =
  '34c389f3ff5954a790be171778214028e1097c52b9b43f044416279b77b91034';

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

export function parseAutomaticRecommendationRequest(
  type: AutomaticRecommendationType,
  value: unknown,
): AutomaticRecommendationRequest {
  return automaticRecommendationRequestSchemas[type].parse(value);
}

export {
  parseAutomaticRecommendationImpression,
  parseAutomaticRecommendationInspection,
  parseAutomaticRecommendationOutcome,
  parseAutomaticRecommendationProblem,
  parseAutomaticRecommendationResponse,
} from './automatic-recommendation-response.js';
export {
  parseAutomaticScorerRequest,
  parseAutomaticScorerResponse,
} from './automatic-scorer.js';
