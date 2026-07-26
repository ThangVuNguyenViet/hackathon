import { assertEligibleCandidates } from './contextual-popularity.js';
import type { PlacementRanker, RankedCandidate, RankerInput } from './types.js';

export class IncrementalValueRanker implements PlacementRanker {
  readonly version = 'incremental-value-v1';

  rank(input: RankerInput): RankedCandidate[] {
    assertEligibleCandidates(input);
    return input.candidates
      .map((candidate): RankedCandidate => ({
        candidate,
        score: Math.log1p(candidate.action.priceImpact.amount),
        reasonCodes: ['completes_your_item'],
        featureSummary: {
          priceImpactVnd: candidate.action.priceImpact.amount,
        },
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidate.action.actionId.localeCompare(
            right.candidate.action.actionId,
          ),
      );
  }
}
