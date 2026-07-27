import type { ToolName } from '../../ordering/types.js';
import type { RecommendationState } from '../domain/contracts.js';

export const RECOMMENDATION_TOOL_NAMES = [
  'recommendStarter',
  'recommendModifierUpsell',
  'recommendSmartCrossSell',
] as const satisfies readonly ToolName[];

export type RecommendationToolName = (typeof RECOMMENDATION_TOOL_NAMES)[number];

export function isRecommendationToolName(
  toolName: ToolName,
): toolName is RecommendationToolName {
  return RECOMMENDATION_TOOL_NAMES.includes(toolName as RecommendationToolName);
}

export function availableRecommendationToolNames(
  state: RecommendationState | undefined,
): RecommendationToolName[] {
  if (!state || state.nextEligiblePlacement === 'starter') {
    return ['recommendStarter'];
  }
  if (state.nextEligiblePlacement === 'modifier_upsell') {
    return ['recommendModifierUpsell'];
  }
  if (state.nextEligiblePlacement === 'smart_cross_sell') {
    return ['recommendSmartCrossSell'];
  }
  return state.stage === 'complete' ? [...RECOMMENDATION_TOOL_NAMES] : [];
}
