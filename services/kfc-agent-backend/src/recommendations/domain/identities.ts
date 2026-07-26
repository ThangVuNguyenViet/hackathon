import { z } from 'zod';

declare const opaqueIdBrand: unique symbol;

type OpaqueId<Kind extends string> = string & {
  readonly [opaqueIdBrand]: Kind;
};

export type CommerceEnvironmentId = OpaqueId<'CommerceEnvironmentId'>;
export type ProductFamilyId = OpaqueId<'ProductFamilyId'>;
export type SellableItemId = OpaqueId<'SellableItemId'>;
export type ExternalItemAlias = OpaqueId<'ExternalItemAlias'>;
export type CartLineId = OpaqueId<'CartLineId'>;
export type ModifierOptionId = OpaqueId<'ModifierOptionId'>;
export type OrderingJourneyId = OpaqueId<'OrderingJourneyId'>;
export type RecommendationId = OpaqueId<'RecommendationId'>;
export type RecommendationRequestId = OpaqueId<'RecommendationRequestId'>;
export type RecommendationEventId = OpaqueId<'RecommendationEventId'>;
export type SanityPolicyId = OpaqueId<'SanityPolicyId'>;
export type ModelArtifactId = OpaqueId<'ModelArtifactId'>;

export const opaqueIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u);

const brandOpaqueId = <Kind extends string>() =>
  opaqueIdSchema as unknown as z.ZodType<OpaqueId<Kind>, z.ZodTypeDef, string>;

export const commerceEnvironmentIdSchema =
  brandOpaqueId<'CommerceEnvironmentId'>();
export const productFamilyIdSchema = brandOpaqueId<'ProductFamilyId'>();
export const sellableItemIdSchema = brandOpaqueId<'SellableItemId'>();
export const externalItemAliasSchema = brandOpaqueId<'ExternalItemAlias'>();
export const cartLineIdSchema = brandOpaqueId<'CartLineId'>();
export const modifierOptionIdSchema = brandOpaqueId<'ModifierOptionId'>();
export const orderingJourneyIdSchema = brandOpaqueId<'OrderingJourneyId'>();
export const recommendationIdSchema = brandOpaqueId<'RecommendationId'>();
export const recommendationRequestIdSchema =
  brandOpaqueId<'RecommendationRequestId'>();
export const recommendationEventIdSchema =
  brandOpaqueId<'RecommendationEventId'>();
export const sanityPolicyIdSchema = brandOpaqueId<'SanityPolicyId'>();
export const modelArtifactIdSchema = brandOpaqueId<'ModelArtifactId'>();
