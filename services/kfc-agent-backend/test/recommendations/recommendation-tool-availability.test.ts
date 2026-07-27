import { describe, expect, it } from 'vitest';
import {
  availableRecommendationToolNames,
  RECOMMENDATION_TOOL_NAMES,
} from '../../src/recommendations/application/tool-availability.js';
import { parseRecommendationState } from '../../src/recommendations/domain/schemas.js';
import { initialRecommendationState } from '../../src/recommendations/state/state-machine.js';

function stateAt(
  stage:
    | 'starter_resolved'
    | 'modifier_eligible'
    | 'smart_cross_sell_eligible'
    | 'complete',
) {
  const base = initialRecommendationState('order-flow-001');
  switch (stage) {
    case 'starter_resolved':
      return parseRecommendationState({
        ...base,
        revision: 1,
        stage,
        attemptedPlacements: ['local_favorite'],
        nextEligiblePlacement: null,
      });
    case 'modifier_eligible':
      return parseRecommendationState({
        ...base,
        revision: 2,
        stage,
        attemptedPlacements: ['local_favorite'],
        nextEligiblePlacement: 'modifier_upsell',
      });
    case 'smart_cross_sell_eligible':
      return parseRecommendationState({
        ...base,
        revision: 3,
        stage,
        attemptedPlacements: ['local_favorite', 'modifier_upsell'],
        nextEligiblePlacement: 'smart_cross_sell',
      });
    case 'complete':
      return parseRecommendationState({
        ...base,
        revision: 4,
        stage,
        attemptedPlacements: [
          'local_favorite',
          'modifier_upsell',
          'smart_cross_sell',
        ],
        nextEligiblePlacement: null,
      });
  }
}

describe('recommendation tool availability', () => {
  it('publishes only the proactive tool allowed by durable placement state', () => {
    expect(availableRecommendationToolNames(undefined)).toEqual([
      'recommendStarter',
    ]);
    expect(
      availableRecommendationToolNames(
        initialRecommendationState('order-flow-001'),
      ),
    ).toEqual(['recommendStarter']);
    expect(
      availableRecommendationToolNames(stateAt('starter_resolved')),
    ).toEqual([]);
    expect(
      availableRecommendationToolNames(stateAt('modifier_eligible')),
    ).toEqual(['recommendModifierUpsell']);
    expect(
      availableRecommendationToolNames(stateAt('smart_cross_sell_eligible')),
    ).toEqual(['recommendSmartCrossSell']);
  });

  it('keeps explicit customer-requested recommendation tools available after the proactive flow completes', () => {
    expect(availableRecommendationToolNames(stateAt('complete'))).toEqual(
      RECOMMENDATION_TOOL_NAMES,
    );
  });
});
