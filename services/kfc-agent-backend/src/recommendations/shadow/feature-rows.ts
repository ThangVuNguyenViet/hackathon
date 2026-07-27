import type {
  PotentialRecommendationCandidate,
  RecommendationDecisionContext,
} from '../eligibility/types.js';
import type {
  CommerceFactsSnapshot,
  PromotionFactsSnapshot,
  RankingStatisticsSnapshot,
} from '../snapshots/types.js';
import type {
  ModifierUpsellShadowFeatureRow,
  RecommendationShadowFeatureRow,
  SmartCrossSellShadowFeatureRow,
} from './contracts.js';

const missingCategory = '__missing__';

function countForKey(counts: object, key: string): number {
  const match = Object.entries(counts).find(([entryKey]) => entryKey === key);
  return typeof match?.[1] === 'number' ? match[1] : 0;
}

function localTimeFeatures(
  instant: string,
  timeZone: string,
): { hour: number; dayOfWeek: number; timeWindow: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const weekdays: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const year = value('year');
  const month = value('month');
  const weekday = value('weekday');
  const hour = Number(value('hour'));
  if (
    !year ||
    !month ||
    !weekday ||
    weekdays[weekday] === undefined ||
    !Number.isInteger(hour)
  ) {
    throw new Error('shadow_time_feature_projection_failed');
  }
  return {
    hour,
    dayOfWeek: weekdays[weekday],
    timeWindow: `${year}-${month}`,
  };
}

function customerCounts(
  context: RecommendationDecisionContext,
  candidate: PotentialRecommendationCandidate,
): { orders: number; item: number; category: number } {
  const orders = context.customerHistory?.completedOrders ?? [];
  let item = 0;
  let category = 0;
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.sellableItemId === candidate.targetId) item += line.quantity;
      if (line.categoryId === candidate.categoryId) category += line.quantity;
    }
  }
  return { orders: orders.length, item, category };
}

function discountVnd(
  candidate: PotentialRecommendationCandidate,
  promotionFacts: PromotionFactsSnapshot,
): number {
  const promotion = candidate.promotionId
    ? promotionFacts.promotions.find(
        (entry) => entry.promotionId === candidate.promotionId,
      )
    : undefined;
  return promotion
    ? Math.max(0, promotion.originalPriceVnd - promotion.promotionalPriceVnd)
    : 0;
}

function productCode(
  candidate: PotentialRecommendationCandidate,
  commerceFacts: CommerceFactsSnapshot,
): string {
  if (candidate.action.type === 'apply_modifier') {
    return candidate.targetId;
  }
  return (
    commerceFacts.menuItems.find(
      (item) => item.itemId === candidate.sellableItemId,
    )?.productCode ?? missingCategory
  );
}

function category(
  candidate: PotentialRecommendationCandidate,
  commerceFacts: CommerceFactsSnapshot,
): string {
  return (
    commerceFacts.menuItems.find(
      (item) => item.itemId === candidate.sellableItemId,
    )?.category ?? candidate.categoryId
  );
}

export function buildRecommendationShadowFeatureRows(input: {
  context: RecommendationDecisionContext;
  candidates: readonly PotentialRecommendationCandidate[];
  commerceFacts: CommerceFactsSnapshot;
  promotionFacts: PromotionFactsSnapshot;
  rankingStatistics: RankingStatisticsSnapshot;
}): RecommendationShadowFeatureRow[] {
  const { context } = input;
  const time = localTimeFeatures(
    context.request.decisionTime,
    context.storeTimezone,
  );
  const cartAnchor =
    context.request.cart.lines.at(-1)?.sellableItemId ?? 'empty-cart';
  const cartSubtotalVnd = context.request.cart.subtotal.amount;
  const remainingBudgetVnd = context.remainingBudgetVnd ?? 0;
  const budgetVnd =
    context.remainingBudgetVnd === null
      ? 0
      : cartSubtotalVnd + context.remainingBudgetVnd;

  return input.candidates.map((candidate) => {
    const statistics = input.rankingStatistics.productStatistics.find(
      (entry) => entry.sellableItemId === candidate.targetId,
    );
    const history = customerCounts(context, candidate);
    const common = {
      eligible: true as const,
      action_id: candidate.action.actionId,
      candidate_id: candidate.action.actionId,
      product_code: productCode(candidate, input.commerceFacts),
      feature_cart_anchor: cartAnchor,
      feature_store_id: context.request.storeId,
      feature_mission: missingCategory,
      feature_time_window: time.timeWindow,
      feature_price_delta_vnd: candidate.action.priceImpact.amount,
      feature_discount_vnd: discountVnd(candidate, input.promotionFacts),
      feature_discount_ratio: candidate.activeDiscountRatio,
      feature_basket_association_score: 0,
      feature_party_size: 0,
      feature_budget_vnd: budgetVnd,
      feature_cart_subtotal_vnd: cartSubtotalVnd,
      feature_customer_order_count: history.orders,
      feature_customer_item_order_count: history.item,
      feature_customer_category_order_count: history.category,
      feature_store_item_order_count: statistics
        ? countForKey(statistics.storeOrderCounts, context.request.storeId)
        : 0,
      feature_global_item_order_count: statistics?.globalOrderCount ?? 0,
      feature_store_local_hour: time.hour,
      feature_store_local_day_of_week: time.dayOfWeek,
    };
    if (context.request.placement === 'smart_cross_sell') {
      return {
        ...common,
        placement: 'smart_cross_sell',
        feature_schema: 'smart-cross-sell-feature-schema-v1',
        category: category(candidate, input.commerceFacts),
      } satisfies SmartCrossSellShadowFeatureRow;
    }
    if (context.request.placement !== 'modifier_upsell') {
      throw new Error('shadow_placement_not_supported');
    }
    return {
      ...common,
      placement: 'modifier_upsell',
      feature_schema: 'modifier-upsell-feature-schema-v1',
      modifier_path: [...candidate.modifierGroupPath, candidate.targetId].join(
        '/',
      ),
      feature_remaining_budget_vnd: remainingBudgetVnd,
      feature_price_to_remaining_budget_ratio:
        candidate.action.priceImpact.amount / Math.max(remainingBudgetVnd, 1),
    } satisfies ModifierUpsellShadowFeatureRow;
  });
}
