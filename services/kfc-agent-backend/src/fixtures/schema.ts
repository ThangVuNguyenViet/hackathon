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
  searchAliases?: string[];
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
    searchAliases: z.array(z.string().min(1)).optional(),
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
  orderingMetadata: z.object({
    searchAliases: z.array(z.string().min(1)).default([]),
    unitComposition: z.object({
      friedChickenPieces: z.number().int().nonnegative().optional(),
      standardPepsi: z.number().int().nonnegative().optional(),
    }).optional(),
    componentSearchAliases: z.object({
      friedChickenPieces: z.array(z.string().min(1)).optional(),
      standardPepsi: z.array(z.string().min(1)).optional(),
    }).optional(),
    provenance: z.object({
      sourceFile: z.string(),
      fixtureMode: z.literal('demo_mock_seed'),
    }),
  }).optional(),
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
    fixtureMode: z.enum(['public_crawl_seed', 'current_api']),
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

export const generatedFulfillmentQuoteSchema = z.object({
  storeId: z.string(),
  method: z.enum(['delivery', 'pickup']),
  feeVnd: z.number().int().nonnegative(),
  etaMinutes: z.number().int().positive(),
  provenance: z.object({
    sourceFile: z.string(),
    sourceApi: z.string(),
    fixtureMode: z.literal('demo_mock_seed'),
  }),
});

export const generatedFulfillmentServiceAreaSchema = z.object({
  serviceAreaId: z.string(),
  storeId: z.string(),
  method: z.enum(['delivery', 'pickup']),
  canonicalDistrict: z.string().min(1),
  canonicalCity: z.string().min(1),
  districts: z.array(z.string()).min(1),
  cities: z.array(z.string()).min(1),
  provenance: z.object({
    sourceFile: z.string(),
    sourceApi: z.string(),
    fixtureMode: z.literal('demo_mock_seed'),
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
  imageUrl: z.string().url().optional(),
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

export const generatedPaymentMethodSchema = z.object({
  methodId: z.string(),
  displayName: z.string(),
  category: z.enum(['cash_on_delivery', 'bank_atm', 'card', 'digital_wallet']),
  supported: z.boolean(),
  supportStatus: z.enum(['listed_supported', 'not_listed_in_policy', 'separate_channel_only']),
  paymentSurface: z.string(),
  evidenceText: z.string(),
  sourceUrl: z.string().url(),
  sourceFile: z.string(),
  notes: z.string(),
  provenance: z.object({
    sourceFile: z.string(),
    sourceUrl: z.string().url(),
    fixtureMode: z.literal('public_crawl_seed'),
  }),
});

export const generatedMembershipProvenanceSchema = z.object({
  sourceFile: z.string(),
  sourceUrl: z.string().url(),
  capturedAt: z.string(),
  fixtureMode: z.enum(['authenticated_chrome_seed', 'demo_mock_seed']),
});

export const generatedMembershipPageSchema = z.object({
  id: z.string(),
  kind: z.enum(['home', 'wallet', 'voucher_detail', 'benefits', 'point_history', 'profile', 'usage_guide', 'program_policy']),
  title: z.string(),
  sourceUrl: z.string().url(),
  statusCode: z.number().int().nullable(),
  text: z.string(),
  markdown: z.string(),
  controls: z.array(z.string()),
  links: z.array(z.string()),
  assets: z.array(
    z.object({
      type: z.enum(['image', 'script', 'style']),
      url: z.string(),
      alt: z.string().optional(),
    }),
  ),
  provenance: generatedMembershipProvenanceSchema,
});

export const generatedMembershipRewardOfferSchema = z.object({
  rewardId: z.string(),
  name: z.string(),
  brand: z.string(),
  offerType: z.enum(['amount_off', 'free_item', 'fixed_price_combo', 'gift']),
  pointsCost: z.number().int().nonnegative().nullable(),
  minimumOrderVnd: z.number().int().nonnegative().nullable(),
  discountAmountVnd: z.number().int().nonnegative().nullable(),
  discountPercent: z.number().int().nonnegative().nullable(),
  priceVnd: z.number().int().nonnegative().nullable(),
  channels: z.array(z.string()),
  usageSurface: z.array(z.string()),
  eligibilityText: z.string(),
  evidenceText: z.string(),
  imageUrl: z.string().url().or(z.literal('')),
  requiresLogin: z.boolean(),
  sourceUrl: z.string().url(),
  sourceFile: z.string(),
  provenance: generatedMembershipProvenanceSchema,
});

export const generatedMembershipWalletVoucherSchema = z.object({
  voucherId: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['active', 'expired', 'used', 'unknown']),
  remainingValidityText: z.string(),
  discountAmountVnd: z.number().int().nonnegative().nullable(),
  discountPercent: z.number().int().nonnegative().nullable(),
  priceVnd: z.number().int().nonnegative().nullable(),
  channels: z.array(z.string()),
  usageSurface: z.array(z.string()),
  evidenceText: z.string(),
  imageUrl: z.string().url().or(z.literal('')),
  sourceUrl: z.string().url(),
  sourceFile: z.string(),
  provenance: generatedMembershipProvenanceSchema,
});

export const generatedMembershipProfileSnapshotSchema = z.object({
  snapshotId: z.string(),
  tier: z.string(),
  points: z.number().int().nonnegative(),
  hasPhoneOnFile: z.boolean(),
  hasGoogleConnection: z.boolean(),
  redactedFields: z.array(z.string()),
  evidenceText: z.string(),
  sourceUrl: z.string().url(),
  sourceFile: z.string(),
  provenance: generatedMembershipProvenanceSchema,
});

export const generatedMembershipPointHistorySnapshotSchema = z.object({
  snapshotId: z.string(),
  filterWindowDays: z.number().int().positive(),
  filterTabs: z.array(z.string()),
  transactions: z.array(
    z.object({
      transactionId: z.string(),
      type: z.enum(['earn', 'spend', 'unknown']),
      points: z.number().int(),
      description: z.string(),
      occurredAt: z.string().nullable(),
    }),
  ),
  emptyStateText: z.string(),
  sourceUrl: z.string().url(),
  sourceFile: z.string(),
  provenance: generatedMembershipProvenanceSchema,
});

export const generatedMembershipToolDefinitionSchema = z.object({
  toolName: z.string(),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UNKNOWN']),
  host: z.string().url(),
  endpointPath: z.string(),
  category: z.enum(['auth', 'profile', 'wallet', 'reward', 'points', 'content']),
  sideEffect: z.enum(['read', 'account_mutation', 'voucher_acquisition', 'reward_redemption']),
  requiresAuthenticatedMembership: z.boolean(),
  requiresUserConfirmation: z.boolean(),
  fixtureBacked: z.boolean(),
  fixtureFile: z.string(),
  evidenceText: z.string(),
  notes: z.string(),
  provenance: generatedMembershipProvenanceSchema,
});

export const generatedFixturesSchema = z.object({
  menuItems: z.array(generatedMenuItemSchema),
  menuModifiers: z.array(generatedMenuModifierSchema),
  stores: z.array(generatedStoreSchema),
  storeAvailability: z.array(generatedStoreAvailabilitySchema),
  fulfillmentServiceAreas: z.array(generatedFulfillmentServiceAreaSchema),
  fulfillmentQuotes: z.array(generatedFulfillmentQuoteSchema),
  promotions: z.array(generatedContentPageSchema),
  promotionVoucherOffers: z.array(generatedPromotionVoucherOfferSchema),
  paymentMethods: z.array(generatedPaymentMethodSchema),
  contentPages: z.array(generatedContentPageSchema),
  membershipPages: z.array(generatedMembershipPageSchema),
  membershipRewardOffers: z.array(generatedMembershipRewardOfferSchema),
  membershipWalletVouchers: z.array(generatedMembershipWalletVoucherSchema),
  membershipProfileSnapshots: z.array(generatedMembershipProfileSnapshotSchema),
  membershipPointHistorySnapshots: z.array(generatedMembershipPointHistorySnapshotSchema),
  membershipToolDefinitions: z.array(generatedMembershipToolDefinitionSchema),
});

export type GeneratedMenuItem = z.infer<typeof generatedMenuItemSchema> & MenuItem;
export type GeneratedMenuModifier = z.infer<typeof generatedMenuModifierSchema>;
export type GeneratedStore = z.infer<typeof generatedStoreSchema>;
export type GeneratedStoreAvailability = z.infer<typeof generatedStoreAvailabilitySchema>;
export type GeneratedFulfillmentServiceArea = z.infer<typeof generatedFulfillmentServiceAreaSchema>;
export type GeneratedFulfillmentQuote = z.infer<typeof generatedFulfillmentQuoteSchema>;
export type GeneratedContentPage = z.infer<typeof generatedContentPageSchema>;
export type GeneratedPromotionVoucherOffer = z.infer<typeof generatedPromotionVoucherOfferSchema>;
export type GeneratedPaymentMethod = z.infer<typeof generatedPaymentMethodSchema>;
export type GeneratedMembershipPage = z.infer<typeof generatedMembershipPageSchema>;
export type GeneratedMembershipRewardOffer = z.infer<typeof generatedMembershipRewardOfferSchema>;
export type GeneratedMembershipWalletVoucher = z.infer<typeof generatedMembershipWalletVoucherSchema>;
export type GeneratedMembershipProfileSnapshot = z.infer<typeof generatedMembershipProfileSnapshotSchema>;
export type GeneratedMembershipPointHistorySnapshot = z.infer<typeof generatedMembershipPointHistorySnapshotSchema>;
export type GeneratedMembershipToolDefinition = z.infer<typeof generatedMembershipToolDefinitionSchema>;
export type GeneratedFixtures = z.infer<typeof generatedFixturesSchema>;
