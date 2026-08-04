import type {
  AutomaticRecommendationCandidate,
  AutomaticRecommendationContext,
} from './types.js';

function discoverProducts(
  context: AutomaticRecommendationContext,
): AutomaticRecommendationCandidate[] {
  return context.catalog.items.map((item) => ({
    candidateId: `product:${item.sellableItemId}`,
    categoryId: item.categoryId,
    name: item.name,
    imageUrl: item.imageUrl,
    sellable: item.sellable,
    safe: item.safe,
    available: item.availableFulfilmentModes.includes(
      context.request.fulfilmentMode,
    ),
    promotionActive: item.promotionActive,
    action: {
      type: 'add_product',
      sellableItemId: item.sellableItemId,
      quantity: 1,
      priceImpactVnd: item.unitPriceVnd,
    },
  }));
}

function discoverModifiers(
  context: AutomaticRecommendationContext,
): AutomaticRecommendationCandidate[] {
  const parentCartLine = context.parentCartLine;
  if (parentCartLine === null) {
    return [];
  }
  const parentItem = context.catalog.items.find(
    ({ sellableItemId }) => sellableItemId === parentCartLine.sellableItemId,
  );
  if (parentItem === undefined) {
    return [];
  }
  return parentItem.modifierGroups.flatMap((group) =>
    group.options.map((option) => ({
      candidateId: `modifier:${parentCartLine.lineId}:${group.groupPath.join('/')}:${option.optionId}`,
      categoryId: parentItem.categoryId,
      name: option.name,
      imageUrl: option.imageUrl,
      sellable: parentItem.sellable,
      safe: parentItem.safe && option.safe,
      available:
        parentItem.availableFulfilmentModes.includes(
          context.request.fulfilmentMode,
        ) && option.available,
      promotionActive: parentItem.promotionActive,
      action: {
        type: 'apply_modifier' as const,
        parentCartLineId: parentCartLine.lineId,
        parentSellableItemId: parentCartLine.sellableItemId,
        groupPath: group.groupPath,
        optionId: option.optionId,
        quantity: 1,
        priceImpactVnd: option.priceImpactVnd,
      },
    })),
  );
}

export function discoverAutomaticRecommendationCandidates(
  context: AutomaticRecommendationContext,
): AutomaticRecommendationCandidate[] {
  return context.recommendationType === 'modifier_upsell'
    ? discoverModifiers(context)
    : discoverProducts(context);
}
