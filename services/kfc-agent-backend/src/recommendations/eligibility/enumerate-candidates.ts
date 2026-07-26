import type {
  GeneratedMenuItem,
  GeneratedModifierGroup,
  GeneratedModifierOption,
} from '../../fixtures/schema.js';
import type { RecommendationAction } from '../domain/contracts.js';
import type {
  CandidateEnumerationInput,
  PotentialRecommendationCandidate,
} from './types.js';

type ModifierPathOption = {
  groupPath: string[];
  option: GeneratedModifierOption;
};

function compareCanonicalInstants(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.slice(0, -1).split('.');
  const [rightWhole, rightFraction = ''] = right.slice(0, -1).split('.');
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;

  const precision = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(precision, '0');
  const normalizedRight = rightFraction.padEnd(precision, '0');
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

const isActivePromotion = (
  promotion: CandidateEnumerationInput['promotionFacts']['promotions'][number],
  input: CandidateEnumerationInput,
  itemId: string,
): boolean =>
  promotion.sellableItemId === itemId &&
  compareCanonicalInstants(
    promotion.startsAt,
    input.context.request.decisionTime,
  ) <= 0 &&
  compareCanonicalInstants(
    input.context.request.decisionTime,
    promotion.endsAt,
  ) < 0 &&
  (promotion.includedStoreIds.length === 0 ||
    promotion.includedStoreIds.some(
      (storeId) => storeId === input.context.request.storeId,
    )) &&
  !promotion.excludedStoreIds.some(
    (storeId) => storeId === input.context.request.storeId,
  ) &&
  promotion.fulfilmentModes.includes(input.context.request.fulfilmentMode);

const activePromotionFor = (input: CandidateEnumerationInput, itemId: string) =>
  input.promotionFacts.promotions.find((promotion) =>
    isActivePromotion(promotion, input, itemId),
  ) ?? null;

const discountRatio = (
  originalPriceVnd: number,
  promotionalPriceVnd: number,
) =>
  originalPriceVnd > 0
    ? (originalPriceVnd - promotionalPriceVnd) / originalPriceVnd
    : 0;

const asAction = (action: unknown): RecommendationAction =>
  action as RecommendationAction;

function enumerateModifierOptions(
  groups: readonly GeneratedModifierGroup[],
  parentPath: readonly string[] = [],
): ModifierPathOption[] {
  return groups.flatMap((group) => {
    const groupPath = [...parentPath, group.groupId];
    return group.options.flatMap((option) => [
      { groupPath, option },
      ...enumerateModifierOptions(option.modifierGroups, groupPath),
    ]);
  });
}

function enumerateProducts(
  input: CandidateEnumerationInput,
): PotentialRecommendationCandidate[] {
  return input.commerceFacts.menuItems.map((item) => {
    const promotion = activePromotionFor(input, item.itemId);
    return {
      action: asAction({
        type: 'add_product',
        actionId: `product:${item.itemId}`,
        sellableItemId: item.itemId,
        quantity: 1,
        priceImpact: { amount: item.priceVnd, currency: 'VND' },
        cartRevision: input.context.request.cartRevision,
      }),
      targetId: item.itemId,
      sellableItemId: item.itemId,
      categoryId: item.categoryId,
      name: item.name,
      imageUrl: item.imageUrl || null,
      basePriceVnd: item.priceVnd,
      activeDiscountRatio: promotion
        ? discountRatio(
            promotion.originalPriceVnd,
            promotion.promotionalPriceVnd,
          )
        : 0,
      promotionId: promotion?.promotionId ?? null,
      parentCartLineId: null,
      modifierGroupPath: [],
    };
  });
}

function menuItemFor(
  items: readonly GeneratedMenuItem[],
  sellableItemId: string,
): GeneratedMenuItem | null {
  return items.find((item) => item.itemId === sellableItemId) ?? null;
}

function enumerateModifiers(
  input: CandidateEnumerationInput,
): PotentialRecommendationCandidate[] {
  const lineId = input.context.parentCartLineId;
  if (!lineId) return [];

  const parentLine = input.context.request.cart.lines.find(
    (line) => line.lineId === lineId,
  );
  if (!parentLine) return [];

  const modifierRoot = input.commerceFacts.menuModifiers.find(
    (modifier) => modifier.itemId === parentLine.sellableItemId,
  );
  const item = menuItemFor(
    input.commerceFacts.menuItems,
    parentLine.sellableItemId,
  );
  if (!modifierRoot || !item) return [];

  return enumerateModifierOptions(modifierRoot.modifierGroups).map(
    ({ groupPath, option }) => ({
      action: asAction({
        type: 'apply_modifier',
        actionId: `modifier:${parentLine.lineId}:${groupPath.join(':')}:${option.modifierId}`,
        parentCartLineId: parentLine.lineId,
        parentSellableItemId: parentLine.sellableItemId,
        optionId: option.modifierId,
        groupPath,
        quantity: 1,
        priceImpact: { amount: option.priceDeltaVnd, currency: 'VND' },
        cartRevision: input.context.request.cartRevision,
      }),
      targetId: option.modifierId,
      sellableItemId: parentLine.sellableItemId,
      categoryId: item.categoryId,
      name: option.name,
      imageUrl: null,
      basePriceVnd: option.priceDeltaVnd,
      activeDiscountRatio: 0,
      promotionId: null,
      parentCartLineId: parentLine.lineId,
      modifierGroupPath: groupPath,
    }),
  );
}

export function enumeratePotentialCandidates(
  input: CandidateEnumerationInput,
): PotentialRecommendationCandidate[] {
  const candidates =
    input.context.request.placement === 'modifier_upsell'
      ? enumerateModifiers(input)
      : enumerateProducts(input);
  return candidates.sort((left, right) =>
    left.action.actionId.localeCompare(right.action.actionId),
  );
}
