import { z } from 'zod';
import {
  commerceEnvironmentIdSchema,
  opaqueIdSchema,
  sellableItemIdSchema,
} from '../domain/identities.js';
import {
  fulfilmentModeSchema,
  instantSchema,
  moneySchema,
} from '../domain/schemas.js';

const nonNegativeIntegerSchema = moneySchema.shape.amount;
const positiveNumberSchema = z.number().positive();
const nonEmptyStringSchema = z.string().min(1);
const occursBefore = (earlier: string, later: string): boolean => {
  const earlierEpoch = Date.parse(earlier);
  const laterEpoch = Date.parse(later);
  return (
    Number.isFinite(earlierEpoch) &&
    Number.isFinite(laterEpoch) &&
    earlierEpoch < laterEpoch
  );
};
const daypartSchema = z.enum([
  'breakfast',
  'lunch',
  'afternoon',
  'dinner',
  'late_night',
]);
const storeDaypartKeySchema = z.string().superRefine((key, context) => {
  const [storeId, daypart, ...remainder] = key.split(':');
  if (
    !storeId ||
    remainder.length > 0 ||
    !commerceEnvironmentIdSchema.safeParse(storeId).success ||
    !daypartSchema.safeParse(daypart).success
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid store:daypart key',
    });
  }
});
const storeCalendarDayTypeDaypartKeySchema = z
  .string()
  .superRefine((key, context) => {
    const [storeId, dayType, daypart, ...remainder] = key.split(':');
    if (
      !storeId ||
      remainder.length > 0 ||
      !commerceEnvironmentIdSchema.safeParse(storeId).success ||
      !z.enum(['weekday', 'weekend']).safeParse(dayType).success ||
      !daypartSchema.safeParse(daypart).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid store:calendar-day-type:daypart key',
      });
    }
  });

const snapshotProvenanceSchema = z
  .object({ source: nonEmptyStringSchema, reference: nonEmptyStringSchema })
  .strict();

const rankingProductStatisticsSchema = z
  .object({
    sellableItemId: sellableItemIdSchema,
    globalOrderCount: nonNegativeIntegerSchema,
    storeOrderCounts: z.record(
      commerceEnvironmentIdSchema,
      nonNegativeIntegerSchema,
    ),
    storeDaypartOrderCounts: z.record(
      storeDaypartKeySchema,
      nonNegativeIntegerSchema,
    ),
    storeCalendarDayTypeDaypartOrderCounts: z.record(
      storeCalendarDayTypeDaypartKeySchema,
      nonNegativeIntegerSchema,
    ),
  })
  .strict();

export const rankingStatisticsSnapshotSchema = z
  .object({
    schemaVersion: z.literal('recommendation-ranking-statistics-v1'),
    snapshotId: opaqueIdSchema,
    sourceRevision: nonEmptyStringSchema,
    observedAt: instantSchema,
    effectiveAt: instantSchema,
    expiresAt: instantSchema,
    complete: z.boolean(),
    commerceEnvironment: commerceEnvironmentIdSchema,
    priorStrength: positiveNumberSchema,
    normalization: z
      .object({
        exactItemAffinity: z
          .object({ min: z.number(), max: z.number() })
          .strict(),
        categoryAffinity: z
          .object({ min: z.number(), max: z.number() })
          .strict(),
        smartPopularityLog: z
          .object({ mean: z.number(), standardDeviation: positiveNumberSchema })
          .strict(),
        discountRatio: z
          .object({ mean: z.number(), standardDeviation: positiveNumberSchema })
          .strict(),
      })
      .strict(),
    productStatistics: z
      .array(rankingProductStatisticsSchema)
      .refine(
        (statistics) =>
          new Set(statistics.map((statistic) => statistic.sellableItemId))
            .size === statistics.length,
        'Product statistics sellable item IDs must be unique',
      ),
    provenance: snapshotProvenanceSchema,
  })
  .strict()
  .refine(
    (snapshot) => occursBefore(snapshot.effectiveAt, snapshot.expiresAt),
    'Snapshot must expire after it becomes effective',
  );

const promotionFactSchema = z
  .object({
    promotionId: opaqueIdSchema,
    sellableItemId: sellableItemIdSchema,
    startsAt: instantSchema,
    endsAt: instantSchema,
    originalPriceVnd: nonNegativeIntegerSchema,
    promotionalPriceVnd: nonNegativeIntegerSchema,
    includedStoreIds: z
      .array(commerceEnvironmentIdSchema)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Included store IDs must be unique',
      ),
    excludedStoreIds: z
      .array(commerceEnvironmentIdSchema)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Excluded store IDs must be unique',
      ),
    fulfilmentModes: z
      .array(fulfilmentModeSchema)
      .min(1)
      .refine(
        (modes) => new Set(modes).size === modes.length,
        'Fulfilment modes must be unique',
      ),
  })
  .strict()
  .refine(
    (promotion) => occursBefore(promotion.startsAt, promotion.endsAt),
    'Promotion must end after it starts',
  )
  .refine(
    (promotion) =>
      !promotion.includedStoreIds.some((storeId) =>
        promotion.excludedStoreIds.includes(storeId),
      ),
    'Included and excluded store IDs must not overlap',
  );

export const promotionFactsSnapshotSchema = z
  .object({
    schemaVersion: z.literal('recommendation-promotion-facts-v1'),
    snapshotId: opaqueIdSchema,
    sourceRevision: nonEmptyStringSchema,
    observedAt: instantSchema,
    effectiveAt: instantSchema,
    expiresAt: instantSchema,
    complete: z.boolean(),
    commerceEnvironment: commerceEnvironmentIdSchema,
    promotions: z
      .array(promotionFactSchema)
      .refine(
        (promotions) =>
          new Set(promotions.map((promotion) => promotion.promotionId)).size ===
          promotions.length,
        'Promotion IDs must be unique',
      ),
    provenance: snapshotProvenanceSchema,
  })
  .strict()
  .refine(
    (snapshot) => occursBefore(snapshot.effectiveAt, snapshot.expiresAt),
    'Snapshot must expire after it becomes effective',
  );
