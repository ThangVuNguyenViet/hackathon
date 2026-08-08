import { createHash } from 'node:crypto';
import { z } from 'zod';

export const AUTOMATIC_FEATURE_SCHEMA_VERSION = 'automatic-feature-v1';

const FEATURE_CONTRACT_FIELDS = [
  { name: 'featureSchemaVersion', arrowType: 'string', nullable: false },
  { name: 'recommendationType', arrowType: 'string', nullable: false },
  { name: 'storeId', arrowType: 'string', nullable: false },
  { name: 'fulfilmentMode', arrowType: 'string', nullable: false },
  { name: 'locale', arrowType: 'string', nullable: false },
  { name: 'localHour', arrowType: 'int8', nullable: false },
  { name: 'daypart', arrowType: 'string', nullable: false },
  { name: 'catalogRevision', arrowType: 'string', nullable: false },
  { name: 'cartSubtotalVnd', arrowType: 'int64', nullable: false },
  { name: 'cartLineCount', arrowType: 'int16', nullable: false },
  {
    name: 'cartDistinctCategoryCount',
    arrowType: 'int16',
    nullable: false,
  },
  {
    name: 'candidateSellableItemId',
    arrowType: 'string',
    nullable: false,
  },
  {
    name: 'candidateModifierOptionId',
    arrowType: 'string',
    nullable: true,
  },
  { name: 'candidateCategoryId', arrowType: 'string', nullable: false },
  { name: 'candidatePriceImpactVnd', arrowType: 'int64', nullable: false },
  { name: 'candidateUnitPriceVnd', arrowType: 'int64', nullable: false },
  {
    name: 'candidateDiscountAmountVnd',
    arrowType: 'int64',
    nullable: false,
  },
  {
    name: 'candidateDiscountActive',
    arrowType: 'bool',
    nullable: false,
  },
  { name: 'promotionActive', arrowType: 'bool', nullable: false },
  { name: 'completedOrderCount', arrowType: 'int32', nullable: false },
  { name: 'priorItemOrderCount', arrowType: 'int32', nullable: false },
  { name: 'priorCategoryOrderCount', arrowType: 'int32', nullable: false },
  { name: 'historyRecencyDays', arrowType: 'double', nullable: true },
  { name: 'localDemandCount', arrowType: 'int32', nullable: true },
  {
    name: 'modifierParentCartLineId',
    arrowType: 'string',
    nullable: true,
  },
  {
    name: 'modifierParentSellableItemId',
    arrowType: 'string',
    nullable: true,
  },
  { name: 'modifierGroupPath', arrowType: 'string', nullable: true },
  { name: 'modifierSelectionMode', arrowType: 'string', nullable: true },
  { name: 'modifierOptionAvailable', arrowType: 'bool', nullable: true },
  { name: 'modifierOptionSafe', arrowType: 'bool', nullable: true },
  { name: 'modifierPriceRatio', arrowType: 'double', nullable: true },
  { name: 'remainingBudgetVnd', arrowType: 'int64', nullable: true },
  { name: 'basketAssociationCount', arrowType: 'int32', nullable: true },
  {
    name: 'basketComplementarityScore',
    arrowType: 'double',
    nullable: true,
  },
  { name: 'basketRedundancyCount', arrowType: 'int32', nullable: true },
  {
    name: 'basketCategoryDiversityCount',
    arrowType: 'int32',
    nullable: true,
  },
] as const;

const FEATURE_CONTRACT = {
  schemaVersion: 'automatic-feature-v1',
  fields: FEATURE_CONTRACT_FIELDS,
  categoricalFields: [
    'storeId',
    'fulfilmentMode',
    'locale',
    'daypart',
    'catalogRevision',
    'candidateSellableItemId',
    'candidateModifierOptionId',
    'candidateCategoryId',
    'modifierParentSellableItemId',
    'modifierGroupPath',
    'modifierSelectionMode',
  ],
  numericFields: [
    'localHour',
    'cartSubtotalVnd',
    'cartLineCount',
    'cartDistinctCategoryCount',
    'candidatePriceImpactVnd',
    'candidateUnitPriceVnd',
    'candidateDiscountAmountVnd',
    'candidateDiscountActive',
    'promotionActive',
    'completedOrderCount',
    'priorItemOrderCount',
    'priorCategoryOrderCount',
    'historyRecencyDays',
    'localDemandCount',
    'modifierOptionAvailable',
    'modifierOptionSafe',
    'modifierPriceRatio',
    'remainingBudgetVnd',
    'basketAssociationCount',
    'basketComplementarityScore',
    'basketRedundancyCount',
    'basketCategoryDiversityCount',
  ],
  numericScales: {
    localHour: 23.0,
    cartSubtotalVnd: 250_000.0,
    cartLineCount: 10.0,
    cartDistinctCategoryCount: 10.0,
    candidatePriceImpactVnd: 250_000.0,
    candidateUnitPriceVnd: 250_000.0,
    candidateDiscountAmountVnd: 250_000.0,
    completedOrderCount: 30.0,
    priorItemOrderCount: 30.0,
    priorCategoryOrderCount: 30.0,
    historyRecencyDays: 365.0,
    localDemandCount: 640.0,
    remainingBudgetVnd: 250_000.0,
    basketAssociationCount: 255.0,
    basketRedundancyCount: 10.0,
    basketCategoryDiversityCount: 10.0,
  },
  unknownCategory: '__UNKNOWN__',
  nullCategory: '__NULL__',
} as const;

export const AUTOMATIC_FEATURE_KEYS = Object.freeze(
  FEATURE_CONTRACT_FIELDS.map(({ name }) => name),
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

function canonicalFeatureContractJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalFeatureContractJson).join(',')}]`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Feature contract contains a non-finite number');
    }
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalFeatureContractJson(record[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const FEATURE_SCHEMA_DESCRIPTOR =
  canonicalFeatureContractJson(FEATURE_CONTRACT);

export const AUTOMATIC_FEATURE_SCHEMA_DIGEST = createHash('sha256')
  .update(FEATURE_SCHEMA_DESCRIPTOR)
  .digest('hex');

export function parseAutomaticRecommendationFeatureVector(value: unknown) {
  return automaticFeatureVectorSchema.parse(value);
}
