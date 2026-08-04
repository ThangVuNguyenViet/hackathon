import { createHash } from 'node:crypto';
import { z } from 'zod';

export const AUTOMATIC_FEATURE_SCHEMA_VERSION = 'automatic-feature-v1';

const FEATURE_FIELD_DESCRIPTORS = {
  featureSchemaVersion: 'literal:automatic-feature-v1',
  recommendationType: 'enum:recommendation-type',
  storeId: 'string',
  fulfilmentMode: 'enum:pickup|delivery',
  locale: 'string',
  localHour: 'integer:0..23',
  daypart: 'enum:breakfast|lunch|afternoon|dinner|late_night',
  catalogRevision: 'string',
  cartSubtotalVnd: 'integer:nonnegative',
  cartLineCount: 'integer:nonnegative',
  cartDistinctCategoryCount: 'integer:nonnegative',
  candidateSellableItemId: 'string',
  candidateModifierOptionId: 'nullable:string',
  candidateCategoryId: 'string',
  candidatePriceImpactVnd: 'integer:nonnegative',
  candidateUnitPriceVnd: 'integer:nonnegative',
  candidateDiscountAmountVnd: 'integer:nonnegative',
  candidateDiscountActive: 'boolean',
  promotionActive: 'boolean',
  completedOrderCount: 'integer:nonnegative',
  priorItemOrderCount: 'integer:nonnegative',
  priorCategoryOrderCount: 'integer:nonnegative',
  historyRecencyDays: 'nullable:number:nonnegative',
  localDemandCount: 'nullable:integer:nonnegative',
  modifierParentCartLineId: 'nullable:string',
  modifierParentSellableItemId: 'nullable:string',
  modifierGroupPath: 'nullable:string',
  modifierSelectionMode: 'nullable:enum:single|multiple',
  modifierOptionAvailable: 'nullable:boolean',
  modifierOptionSafe: 'nullable:boolean',
  modifierPriceRatio: 'nullable:number:nonnegative',
  remainingBudgetVnd: 'nullable:integer:nonnegative',
  basketAssociationCount: 'nullable:integer:nonnegative',
  basketComplementarityScore: 'nullable:number:-1..1',
  basketRedundancyCount: 'nullable:integer:nonnegative',
  basketCategoryDiversityCount: 'nullable:integer:nonnegative',
} as const;

export const AUTOMATIC_FEATURE_KEYS = Object.freeze(
  Object.keys(FEATURE_FIELD_DESCRIPTORS),
);

export const automaticFeatureVectorSchema = z
  .object({
    featureSchemaVersion: z.literal(AUTOMATIC_FEATURE_SCHEMA_VERSION),
    recommendationType: z.enum([
      'local_favorite',
      'for_you',
      'modifier_upsell',
      'smart_cross_sell',
    ]),
    storeId: z.string().trim().min(1),
    fulfilmentMode: z.enum(['pickup', 'delivery']),
    locale: z.string().trim().min(2),
    localHour: z.number().int().min(0).max(23),
    daypart: z.enum([
      'breakfast',
      'lunch',
      'afternoon',
      'dinner',
      'late_night',
    ]),
    catalogRevision: z.string().trim().min(1),
    cartSubtotalVnd: z.number().int().nonnegative(),
    cartLineCount: z.number().int().nonnegative(),
    cartDistinctCategoryCount: z.number().int().nonnegative(),
    candidateSellableItemId: z.string().trim().min(1),
    candidateModifierOptionId: z.string().trim().min(1).nullable(),
    candidateCategoryId: z.string().trim().min(1),
    candidatePriceImpactVnd: z.number().int().nonnegative(),
    candidateUnitPriceVnd: z.number().int().nonnegative(),
    candidateDiscountAmountVnd: z.number().int().nonnegative(),
    candidateDiscountActive: z.boolean(),
    promotionActive: z.boolean(),
    completedOrderCount: z.number().int().nonnegative(),
    priorItemOrderCount: z.number().int().nonnegative(),
    priorCategoryOrderCount: z.number().int().nonnegative(),
    historyRecencyDays: z.number().finite().nonnegative().nullable(),
    localDemandCount: z.number().int().nonnegative().nullable(),
    modifierParentCartLineId: z.string().trim().min(1).nullable(),
    modifierParentSellableItemId: z.string().trim().min(1).nullable(),
    modifierGroupPath: z.string().trim().min(1).nullable(),
    modifierSelectionMode: z.enum(['single', 'multiple']).nullable(),
    modifierOptionAvailable: z.boolean().nullable(),
    modifierOptionSafe: z.boolean().nullable(),
    modifierPriceRatio: z.number().finite().nonnegative().nullable(),
    remainingBudgetVnd: z.number().int().nonnegative().nullable(),
    basketAssociationCount: z.number().int().nonnegative().nullable(),
    basketComplementarityScore: z.number().finite().min(-1).max(1).nullable(),
    basketRedundancyCount: z.number().int().nonnegative().nullable(),
    basketCategoryDiversityCount: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((features, context) => {
    const modifierFields = [
      features.modifierParentCartLineId,
      features.modifierParentSellableItemId,
      features.modifierGroupPath,
      features.modifierSelectionMode,
      features.modifierOptionAvailable,
      features.modifierOptionSafe,
      features.modifierPriceRatio,
    ];
    const basketFields = [
      features.basketAssociationCount,
      features.basketComplementarityScore,
      features.basketRedundancyCount,
      features.basketCategoryDiversityCount,
    ];
    const isModifier = features.recommendationType === 'modifier_upsell';
    const isSmart = features.recommendationType === 'smart_cross_sell';
    const invalidApplicability =
      (isModifier
        ? modifierFields.some((value) => value === null) ||
          features.candidateModifierOptionId === null
        : modifierFields.some((value) => value !== null) ||
          features.candidateModifierOptionId !== null) ||
      (!isSmart && basketFields.some((value) => value !== null)) ||
      (!isModifier && !isSmart && features.remainingBudgetVnd !== null) ||
      (features.recommendationType !== 'local_favorite' &&
        features.localDemandCount !== null) ||
      (features.recommendationType !== 'for_you' &&
        features.historyRecencyDays !== null);
    if (invalidApplicability) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Feature fields do not match the recommendation type',
      });
    }
  });

const FEATURE_SCHEMA_DESCRIPTOR = Object.entries(FEATURE_FIELD_DESCRIPTORS)
  .map(([name, descriptor]) => `${name}:${descriptor}`)
  .join('\n');

export const AUTOMATIC_FEATURE_SCHEMA_DIGEST = createHash('sha256')
  .update(FEATURE_SCHEMA_DESCRIPTOR)
  .digest('hex');

export function parseAutomaticRecommendationFeatureVector(value: unknown) {
  return automaticFeatureVectorSchema.parse(value);
}
