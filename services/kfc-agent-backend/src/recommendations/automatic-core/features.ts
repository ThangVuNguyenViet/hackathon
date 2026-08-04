import { createHash } from 'node:crypto';
import type {
  AutomaticEligibilityDecision,
  AutomaticFeatureValue,
  AutomaticRecommendationCandidate,
  AutomaticRecommendationContext,
  AutomaticRecommendationFeatureRow,
} from './types.js';

export const AUTOMATIC_FEATURE_SCHEMA_VERSION = 'automatic-feature-v1';

const FEATURE_SCHEMA_DESCRIPTOR = [
  'featureSchemaVersion:string',
  'recommendationType:string',
  'fulfilmentMode:string',
  'localHour:number',
  'cartSubtotalVnd:number',
  'cartLineCount:number',
  'candidateCategoryId:string',
  'priceImpactVnd:number',
  'promotionActive:boolean',
  'completedOrderCount:number',
  'priorItemOrderCount:number',
  'priorCategoryOrderCount:number',
  'modifierParentSellableItemId:string?',
  'modifierGroupPath:string?',
  'modifierPriceRatio:number?',
].join('\n');

export const AUTOMATIC_FEATURE_SCHEMA_DIGEST = createHash('sha256')
  .update(FEATURE_SCHEMA_DESCRIPTOR)
  .digest('hex');

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

function priceImpactVnd(candidate: AutomaticRecommendationCandidate): number {
  return candidate.action.priceImpactVnd;
}

function historyFeatures(
  context: AutomaticRecommendationContext,
  candidate: AutomaticRecommendationCandidate,
): Record<string, AutomaticFeatureValue> {
  const history = context.history;
  const sellableItemId =
    candidate.action.type === 'add_product'
      ? candidate.action.sellableItemId
      : candidate.action.parentSellableItemId;
  return {
    completedOrderCount: history?.completedOrderCount ?? 0,
    priorItemOrderCount: history?.itemOrderCounts[sellableItemId] ?? 0,
    priorCategoryOrderCount:
      history?.categoryOrderCounts[candidate.categoryId] ?? 0,
  };
}

function modifierFeatures(
  context: AutomaticRecommendationContext,
  candidate: AutomaticRecommendationCandidate,
): Record<string, AutomaticFeatureValue> {
  if (candidate.action.type !== 'apply_modifier') {
    return {};
  }
  const parentUnitPrice = context.parentCartLine?.unitPrice.amount;
  if (parentUnitPrice === undefined || parentUnitPrice === 0) {
    throw new Error('Modifier features require a priced exact parent line');
  }
  return {
    modifierParentSellableItemId: candidate.action.parentSellableItemId,
    modifierGroupPath: candidate.action.groupPath.join('/'),
    modifierPriceRatio: candidate.action.priceImpactVnd / parentUnitPrice,
  };
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
      priceImpactVnd: priceImpactVnd(candidate),
      features: {
        featureSchemaVersion: AUTOMATIC_FEATURE_SCHEMA_VERSION,
        recommendationType: context.recommendationType,
        fulfilmentMode: context.request.fulfilmentMode,
        localHour: localHour(context.decisionTime, context.catalog.timeZone),
        cartSubtotalVnd: context.request.cart.subtotal.amount,
        cartLineCount: context.request.cart.lines.length,
        candidateCategoryId: candidate.categoryId,
        priceImpactVnd: priceImpactVnd(candidate),
        promotionActive: candidate.promotionActive,
        ...historyFeatures(context, candidate),
        ...modifierFeatures(context, candidate),
      },
    }));
}
