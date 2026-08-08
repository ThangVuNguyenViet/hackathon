import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const instant = z.string().datetime({ offset: true });
const nonNegativeInteger = z.number().int().nonnegative();
const money = z
  .object({ amount: nonNegativeInteger, currency: z.literal('VND') })
  .strict();
const appliedModifier = z
  .object({
    groupPath: z.array(nonEmptyString).min(1),
    optionId: nonEmptyString,
    quantity: z.number().int().positive(),
    priceImpact: money,
  })
  .strict();
const cartLine = z
  .object({
    lineId: nonEmptyString,
    sellableItemId: nonEmptyString,
    quantity: z.number().int().positive(),
    unitPrice: money,
    modifiers: z.array(appliedModifier),
  })
  .strict();
const cart = z
  .object({
    cartId: nonEmptyString,
    revision: nonEmptyString,
    subtotal: money,
    lines: z.array(cartLine),
  })
  .strict()
  .refine(
    ({ lines }) =>
      new Set(lines.map(({ lineId }) => lineId)).size === lines.length,
    { message: 'Cart line identifiers must be unique' },
  );

export const trustedOrderContextSnapshotSchema = z
  .object({
    orderingJourneyRef: nonEmptyString,
    opportunityRef: nonEmptyString,
    storeId: nonEmptyString,
    fulfilmentMode: z.enum(['pickup', 'delivery']),
    locale: z.string().trim().min(2).max(35),
    cart,
    remainingBudgetVnd: nonNegativeInteger.nullable(),
    parentCartLineId: nonEmptyString.nullable(),
    verifiedCustomerRef: nonEmptyString.nullable(),
  })
  .strict();

const modifierOption = z
  .object({
    optionId: nonEmptyString,
    name: nonEmptyString,
    imageUrl: z.string().url().nullable(),
    priceImpactVnd: nonNegativeInteger,
    available: z.boolean(),
    safe: z.boolean(),
  })
  .strict();
const modifierGroup = z
  .object({
    groupPath: z.array(nonEmptyString).min(1),
    selectionMode: z.enum(['single', 'multiple']),
    options: z.array(modifierOption),
  })
  .strict()
  .refine(
    ({ options }) =>
      new Set(options.map(({ optionId }) => optionId)).size === options.length,
    { message: 'Modifier option identifiers must be unique within a group' },
  );
const catalogItem = z
  .object({
    sellableItemId: nonEmptyString,
    name: nonEmptyString,
    imageUrl: z.string().url().nullable(),
    categoryId: nonEmptyString,
    unitPriceVnd: nonNegativeInteger,
    sellable: z.boolean(),
    safe: z.boolean(),
    availableFulfilmentModes: z.array(z.enum(['pickup', 'delivery'])),
    promotionActive: z.boolean(),
    discountAmountVnd: nonNegativeInteger,
    localDemandCount: nonNegativeInteger.nullable(),
    basketAssociationCount: nonNegativeInteger.nullable(),
    basketComplementarityScore: z.number().finite().min(-1).max(1).nullable(),
    modifierGroups: z.array(modifierGroup),
  })
  .strict()
  .refine(
    ({ discountAmountVnd, unitPriceVnd }) => discountAmountVnd <= unitPriceVnd,
    {
      message: 'Catalog discount cannot exceed unit price',
    },
  )
  .refine(
    ({ modifierGroups }) =>
      new Set(modifierGroups.map(({ groupPath }) => groupPath.join('/')))
        .size === modifierGroups.length,
    { message: 'Modifier group paths must be unique within an item' },
  );

export const catalogSnapshotSchema = z
  .object({
    catalogRevision: nonEmptyString,
    resolvedAt: instant,
    timeZone: nonEmptyString.superRefine((timeZone, context) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format();
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Catalog time zone must be an IANA time zone',
        });
      }
    }),
    items: z.array(catalogItem),
  })
  .strict()
  .refine(
    ({ items }) =>
      new Set(items.map(({ sellableItemId }) => sellableItemId)).size ===
      items.length,
    { message: 'Catalog sellable item identifiers must be unique' },
  );

export const completedHistorySnapshotSchema = z
  .object({
    verifiedCustomerRef: nonEmptyString,
    historyRevision: nonEmptyString,
    completedOrderCount: nonNegativeInteger,
    lastCompletedOrderAt: instant.nullable(),
    itemOrderCounts: z.record(nonNegativeInteger),
    categoryOrderCounts: z.record(nonNegativeInteger),
  })
  .strict();

export const exposureStateSchema = z.enum(['enabled', 'paused']);
export const decisionTimeSchema = z
  .date()
  .refine((value) => Number.isFinite(value.getTime()), {
    message: 'Decision clock must return a valid Date',
  });
