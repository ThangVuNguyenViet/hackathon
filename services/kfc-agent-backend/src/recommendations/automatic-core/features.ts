import {
  AUTOMATIC_FEATURE_SCHEMA_VERSION,
  parseAutomaticRecommendationFeatureVector,
} from '../contracts/automatic-features.js';
import type {
  AutomaticCatalogItemSnapshot,
  AutomaticEligibilityDecision,
  AutomaticRecommendationCandidate,
  AutomaticRecommendationContext,
  AutomaticRecommendationFeatureRow,
} from './types.js';

export {
  AUTOMATIC_FEATURE_KEYS,
  AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  AUTOMATIC_FEATURE_SCHEMA_VERSION,
  automaticFeatureVectorSchema,
  parseAutomaticRecommendationFeatureVector,
} from '../contracts/automatic-features.js';

function localHour(instant: string, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  })
    .formatToParts(new Date(instant))
    .find(({ type }) => type === 'hour')?.value;
  if (hour === undefined) {
    throw new Error('Trusted catalog time zone did not resolve a local hour');
  }
  return Number.parseInt(hour, 10);
}

function daypart(hour: number) {
  if (hour >= 5 && hour < 10) return 'breakfast' as const;
  if (hour >= 10 && hour < 14) return 'lunch' as const;
  if (hour >= 14 && hour < 17) return 'afternoon' as const;
  if (hour >= 17 && hour < 22) return 'dinner' as const;
  return 'late_night' as const;
}

function candidateItem(
  context: AutomaticRecommendationContext,
  candidate: AutomaticRecommendationCandidate,
): AutomaticCatalogItemSnapshot {
  const sellableItemId =
    candidate.action.type === 'add_product'
      ? candidate.action.sellableItemId
      : candidate.action.parentSellableItemId;
  const item = context.catalog.items.find(
    (catalogItem) => catalogItem.sellableItemId === sellableItemId,
  );
  if (item === undefined) {
    throw new Error('Eligible candidate is absent from trusted catalog');
  }
  return item;
}

function historyRecencyDays(context: AutomaticRecommendationContext) {
  const lastCompletedOrderAt = context.history?.lastCompletedOrderAt;
  if (lastCompletedOrderAt === null || lastCompletedOrderAt === undefined) {
    return null;
  }
  const elapsed =
    new Date(context.decisionTime).getTime() -
    new Date(lastCompletedOrderAt).getTime();
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

function cartCategoryFacts(context: AutomaticRecommendationContext) {
  const categories = context.order.cart.lines.map(
    ({ sellableItemId }) =>
      context.catalog.items.find(
        (item) => item.sellableItemId === sellableItemId,
      )?.categoryId ?? '__unknown__',
  );
  return {
    categories,
    distinctCount: new Set(categories).size,
  };
}

function buildFeatureVector(
  context: AutomaticRecommendationContext,
  candidate: AutomaticRecommendationCandidate,
) {
  const item = candidateItem(context, candidate);
  const action = candidate.action;
  const hour = localHour(context.decisionTime, context.catalog.timeZone);
  const cartCategories = cartCategoryFacts(context);
  const modifierGroup =
    action.type === 'apply_modifier'
      ? item.modifierGroups.find(
          ({ groupPath }) => groupPath.join('/') === action.groupPath.join('/'),
        )
      : undefined;
  const priorItemOrderCount =
    context.history?.itemOrderCounts[item.sellableItemId] ?? 0;
  const isSmart = context.recommendationType === 'smart_cross_sell';
  const isModifier = context.recommendationType === 'modifier_upsell';
  return parseAutomaticRecommendationFeatureVector({
    featureSchemaVersion: AUTOMATIC_FEATURE_SCHEMA_VERSION,
    recommendationType: context.recommendationType,
    storeId: context.order.storeId,
    fulfilmentMode: context.order.fulfilmentMode,
    locale: context.order.locale,
    localHour: hour,
    daypart: daypart(hour),
    catalogRevision: context.catalog.catalogRevision,
    cartSubtotalVnd: context.order.cart.subtotal.amount,
    cartLineCount: context.order.cart.lines.length,
    cartDistinctCategoryCount: cartCategories.distinctCount,
    candidateSellableItemId: item.sellableItemId,
    candidateModifierOptionId:
      action.type === 'apply_modifier' ? action.optionId : null,
    candidateCategoryId: candidate.categoryId,
    candidatePriceImpactVnd: action.priceImpactVnd,
    candidateUnitPriceVnd: item.unitPriceVnd,
    candidateDiscountAmountVnd: item.discountAmountVnd,
    candidateDiscountActive: item.discountAmountVnd > 0,
    promotionActive: item.promotionActive,
    completedOrderCount: context.history?.completedOrderCount ?? 0,
    priorItemOrderCount,
    priorCategoryOrderCount:
      context.history?.categoryOrderCounts[candidate.categoryId] ?? 0,
    historyRecencyDays:
      context.recommendationType === 'for_you'
        ? historyRecencyDays(context)
        : null,
    localDemandCount:
      context.recommendationType === 'local_favorite'
        ? item.localDemandCount
        : null,
    modifierParentCartLineId:
      action.type === 'apply_modifier' ? action.parentCartLineId : null,
    modifierParentSellableItemId:
      action.type === 'apply_modifier' ? action.parentSellableItemId : null,
    modifierGroupPath:
      action.type === 'apply_modifier' ? action.groupPath.join('/') : null,
    modifierSelectionMode: isModifier
      ? (modifierGroup?.selectionMode ?? null)
      : null,
    modifierOptionAvailable: isModifier ? candidate.available : null,
    modifierOptionSafe: isModifier ? candidate.safe : null,
    modifierPriceRatio: isModifier
      ? action.priceImpactVnd / (context.parentCartLine?.unitPrice.amount ?? 0)
      : null,
    remainingBudgetVnd:
      isModifier || isSmart ? context.order.remainingBudgetVnd : null,
    basketAssociationCount: isSmart ? item.basketAssociationCount : null,
    basketComplementarityScore: isSmart
      ? item.basketComplementarityScore
      : null,
    basketRedundancyCount: isSmart
      ? cartCategories.categories.filter(
          (categoryId) => categoryId === candidate.categoryId,
        ).length
      : null,
    basketCategoryDiversityCount: isSmart ? cartCategories.distinctCount : null,
  });
}

export function buildAutomaticRecommendationFeatureRows(
  context: AutomaticRecommendationContext,
  decisions: readonly AutomaticEligibilityDecision[],
): AutomaticRecommendationFeatureRow[] {
  return decisions
    .filter(({ status }) => status === 'eligible')
    .map(({ candidate }) => ({
      candidateId: candidate.candidateId,
      eligibility: 'eligible' as const,
      priceImpactVnd: candidate.action.priceImpactVnd,
      features: buildFeatureVector(context, candidate),
    }));
}
