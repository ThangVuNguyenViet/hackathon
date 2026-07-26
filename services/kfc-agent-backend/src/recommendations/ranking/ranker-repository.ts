import type { Placement } from '../domain/contracts.js';
import { ContextualPopularityRanker } from './contextual-popularity.js';
import { ForYouAffinityRanker } from './for-you-affinity.js';
import { IncrementalValueRanker } from './incremental-value.js';
import { SmartCrossBlendRanker } from './smart-cross-blend.js';
import type { PlacementRanker, PlacementRankerRepository } from './types.js';

export class RankerRepository implements PlacementRankerRepository {
  private readonly rankers: Record<Placement, PlacementRanker> = {
    local_favorite: new ContextualPopularityRanker(),
    for_you: new ForYouAffinityRanker(),
    modifier_upsell: new IncrementalValueRanker(),
    smart_cross_sell: new SmartCrossBlendRanker(),
  };

  forPlacement(placement: Placement): PlacementRanker {
    return this.rankers[placement];
  }
}
