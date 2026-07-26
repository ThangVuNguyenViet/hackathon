import type { z } from 'zod';
import type {
  addProductActionSchema,
  applyModifierActionSchema,
  cartLineSchema,
  cartSnapshotSchema,
  commerceSnapshotBindingsSchema,
  customerReasonCodeSchema,
  decisionSourceSchema,
  decisionStatusSchema,
  displayFactSchema,
  eventActorSchema,
  eventTypeSchema,
  experimentProfileSchema,
  fulfilmentModeSchema,
  instantSchema,
  jsonValueSchema,
  merchandisingActionSchema,
  merchandisingEffectSchema,
  modifierSelectionSchema,
  moneySchema,
  placementSchema,
  primaryOfferSchema,
  recommendationActionSchema,
  recommendationCountsSchema,
  recommendationDecisionRequestSchema,
  recommendationDecisionResponseSchema,
  recommendationEventSchema,
  replaceCartLineActionSchema,
  sha256Schema,
  snapshotBindingSchema,
  snapshotProvenanceSchema,
  versionBindingsSchema,
} from './schemas.js';

export type Money = z.infer<typeof moneySchema>;
export type Instant = z.infer<typeof instantSchema>;
export type Sha256 = z.infer<typeof sha256Schema>;
export type SnapshotProvenance = z.infer<typeof snapshotProvenanceSchema>;
export type SnapshotBinding = z.infer<typeof snapshotBindingSchema>;
export type CommerceSnapshotBindings = z.infer<
  typeof commerceSnapshotBindingsSchema
>;
export type ModifierSelection = z.infer<typeof modifierSelectionSchema>;
export type CartLine = z.infer<typeof cartLineSchema>;
export type CartSnapshot = z.infer<typeof cartSnapshotSchema>;
export type ExperimentProfile = z.infer<typeof experimentProfileSchema>;
export type FulfilmentMode = z.infer<typeof fulfilmentModeSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;
export type DecisionSource = z.infer<typeof decisionSourceSchema>;
export type AddProductAction = z.infer<typeof addProductActionSchema>;
export type ApplyModifierAction = z.infer<typeof applyModifierActionSchema>;
export type ReplaceCartLineAction = z.infer<typeof replaceCartLineActionSchema>;
export type RecommendationAction = z.infer<typeof recommendationActionSchema>;
export type PrimaryOffer = z.infer<typeof primaryOfferSchema>;
export type DisplayFact = z.infer<typeof displayFactSchema>;
export type CustomerReasonCode = z.infer<typeof customerReasonCodeSchema>;
export type MerchandisingAction = z.infer<typeof merchandisingActionSchema>;
export type MerchandisingEffect = z.infer<typeof merchandisingEffectSchema>;
export type VersionBindings = z.infer<typeof versionBindingsSchema>;
export type RecommendationCounts = z.infer<typeof recommendationCountsSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type EventActor = z.infer<typeof eventActorSchema>;
export type JsonValue = z.infer<typeof jsonValueSchema>;
export type RecommendationDecisionRequest = z.infer<
  typeof recommendationDecisionRequestSchema
>;
export type RecommendationDecisionResponse = z.infer<
  typeof recommendationDecisionResponseSchema
>;
export type RecommendationEvent = z.infer<typeof recommendationEventSchema>;
