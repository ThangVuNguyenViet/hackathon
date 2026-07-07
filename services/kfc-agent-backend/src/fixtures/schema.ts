import { z } from 'zod';
import type { MenuItem } from '../domain/types.js';

export interface GeneratedModifierOption {
  modifierId: string;
  name: string;
  priceDeltaVnd: number;
  default: boolean;
  quantity: number | '';
  posItemId: string;
  imageName: string;
  modifierGroups: GeneratedModifierGroup[];
}

export interface GeneratedModifierGroup {
  groupId: string;
  name: string;
  min: number | '';
  max: number | '';
  depth: number;
  options: GeneratedModifierOption[];
}

export const generatedModifierOptionSchema: z.ZodType<GeneratedModifierOption> = z.lazy(() =>
  z.object({
    modifierId: z.string(),
    name: z.string(),
    priceDeltaVnd: z.number(),
    default: z.boolean(),
    quantity: z.number().or(z.literal('')),
    posItemId: z.string(),
    imageName: z.string(),
    modifierGroups: z.array(generatedModifierGroupSchema),
  }),
);

export const generatedModifierGroupSchema: z.ZodType<GeneratedModifierGroup> = z.lazy(() =>
  z.object({
    groupId: z.string(),
    name: z.string(),
    min: z.number().or(z.literal('')),
    max: z.number().or(z.literal('')),
    depth: z.number().int().nonnegative(),
    options: z.array(generatedModifierOptionSchema),
  }),
);

export const generatedMenuItemSchema = z.object({
  code: z.string(),
  itemId: z.string(),
  posItemId: z.string(),
  productCode: z.string(),
  category: z.string(),
  categoryId: z.string(),
  categoryUrl: z.string(),
  name: z.string(),
  description: z.string(),
  priceVnd: z.number().int().nonnegative(),
  originalPriceVnd: z.number().int().nonnegative().nullable(),
  imageUrl: z.string().url(),
  available: z.boolean(),
  productUrlSlug: z.string(),
  builderUrl: z.string().url().or(z.literal('')),
  isCustomize: z.boolean(),
  isQuickCombo: z.boolean(),
  provenance: z.object({
    sourceFile: z.string(),
    sourceApi: z.string().url(),
    okfConceptId: z.string(),
    fixtureMode: z.literal('public_crawl_seed'),
  }),
});

export const generatedMenuModifierSchema = z.object({
  itemCode: z.string(),
  itemId: z.string(),
  productCode: z.string(),
  name: z.string(),
  modifierGroups: z.array(generatedModifierGroupSchema),
  provenance: z.object({
    sourceFile: z.string(),
    fixtureMode: z.literal('public_crawl_seed'),
  }),
});

export const generatedStoreSchema = z.object({
  storeId: z.string(),
  storeKey: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  postalCode: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  geoHash: z.string(),
  activeAggregators: z.array(z.string()),
  provenance: z.object({
    sourceFile: z.string(),
    fixtureMode: z.literal('public_crawl_seed'),
  }),
});

export const generatedTimeslotExclusionSchema = z.object({
  itemId: z.string(),
  repeatDays: z.array(z.string()),
  isTimeslotItem: z.boolean(),
});

export const generatedDispositionAvailabilitySchema = z.object({
  excludedItemIds: z.array(z.string()),
  timeslotExclusions: z.array(generatedTimeslotExclusionSchema),
});

export const generatedStoreAvailabilitySchema = z.object({
  storeId: z.string(),
  storeName: z.string(),
  pickup: generatedDispositionAvailabilitySchema,
  delivery: generatedDispositionAvailabilitySchema,
  provenance: z.object({
    sourceFile: z.string(),
    sourceApi: z.string(),
    fixtureMode: z.literal('public_crawl_seed'),
  }),
});

export const generatedContentPageSchema = z.object({
  id: z.string(),
  kind: z.enum(['promotion', 'news', 'allergen']),
  title: z.string(),
  sourceUrl: z.string(),
  statusCode: z.number().int().nullable(),
  markdown: z.string(),
  links: z.array(z.string()),
  provenance: z.object({
    sourceFile: z.string(),
    fixtureMode: z.literal('public_crawl_seed'),
  }),
});

export const generatedPromotionVoucherOfferSchema = z.object({
  offerId: z.string(),
  campaign: z.string(),
  campaignType: z.string(),
  offerType: z.string(),
  offerName: z.string(),
  discountPercent: z.number().int().nonnegative().or(z.literal('')),
  discountAmountVnd: z.number().int().nonnegative().or(z.literal('')),
  priceVnd: z.number().int().nonnegative().or(z.literal('')),
  minimumOrderVnd: z.number().int().nonnegative().or(z.literal('')),
  maximumDiscountVnd: z.number().int().nonnegative().or(z.literal('')),
  giftQuantity: z.string(),
  partnerBrand: z.string(),
  appliesTo: z.string(),
  channel: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  actualCodeExposed: z.boolean(),
  publicCode: z.string(),
  requiresLogin: z.boolean(),
  requiresPartnerApi: z.boolean(),
  redemptionSurface: z.string(),
  evidenceText: z.string(),
  sourceUrl: z.string().url(),
  sourceFile: z.string(),
  notes: z.string(),
});

export const generatedFixturesSchema = z.object({
  menuItems: z.array(generatedMenuItemSchema),
  menuModifiers: z.array(generatedMenuModifierSchema),
  stores: z.array(generatedStoreSchema),
  storeAvailability: z.array(generatedStoreAvailabilitySchema),
  promotions: z.array(generatedContentPageSchema),
  promotionVoucherOffers: z.array(generatedPromotionVoucherOfferSchema),
  contentPages: z.array(generatedContentPageSchema),
});

export type GeneratedMenuItem = z.infer<typeof generatedMenuItemSchema> & MenuItem;
export type GeneratedMenuModifier = z.infer<typeof generatedMenuModifierSchema>;
export type GeneratedStore = z.infer<typeof generatedStoreSchema>;
export type GeneratedStoreAvailability = z.infer<typeof generatedStoreAvailabilitySchema>;
export type GeneratedContentPage = z.infer<typeof generatedContentPageSchema>;
export type GeneratedPromotionVoucherOffer = z.infer<typeof generatedPromotionVoucherOfferSchema>;
export type GeneratedFixtures = z.infer<typeof generatedFixturesSchema>;
