import {
  assertEligibleCandidates,
  contextualPopularityForCandidate,
} from './contextual-popularity.js';
import { compareCanonicalUtcInstants } from '../domain/canonical-instant.js';
import type { PlacementRanker, RankedCandidate, RankerInput } from './types.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function normalize(value: number, range: { min: number; max: number }): number {
  if (range.min === range.max) return value <= range.min ? 0 : 1;
  return Math.min(
    1,
    Math.max(0, (value - range.min) / (range.max - range.min)),
  );
}

function historyTotals(
  input: RankerInput,
  sellableItemId: string,
  categoryId: string,
) {
  const history = input.context.customerHistory;
  if (
    !history ||
    history.verifiedCustomerRef !== input.context.request.verifiedCustomerRef
  ) {
    return { category: 0, exact: 0 };
  }
  const decisionEpoch = Date.parse(input.context.request.decisionTime);
  let exact = 0;
  let category = 0;
  for (const order of history.completedOrders) {
    if (
      compareCanonicalUtcInstants(
        order.completedAt,
        input.context.request.decisionTime,
      ) !== -1
    ) {
      continue;
    }
    const completedEpoch = Date.parse(order.completedAt);
    if (!Number.isFinite(completedEpoch)) continue;
    const ageDays = (decisionEpoch - completedEpoch) / MILLISECONDS_PER_DAY;
    const decay = 2 ** (-ageDays / 90);
    for (const line of order.lines) {
      const weight = line.quantity * decay;
      if (line.sellableItemId === sellableItemId) exact += weight;
      if (line.categoryId === categoryId) category += weight;
    }
  }
  return { category, exact };
}

export class ForYouAffinityRanker implements PlacementRanker {
  readonly version = 'for-you-affinity-v1';

  rank(input: RankerInput): RankedCandidate[] {
    assertEligibleCandidates(input);
    const normalization = input.rankingStatistics.normalization;
    return input.candidates
      .map((candidate) => {
        const totals = historyTotals(
          input,
          candidate.sellableItemId,
          candidate.categoryId,
        );
        const exact = normalize(totals.exact, normalization.exactItemAffinity);
        const category = normalize(
          totals.category,
          normalization.categoryAffinity,
        );
        const contextual = contextualPopularityForCandidate(candidate, input);
        return {
          candidate,
          score: 0.55 * exact + 0.25 * category + 0.2 * contextual.score,
          reasonCodes:
            totals.exact > 0
              ? ['ordered_before']
              : totals.category > 0
                ? ['matches_your_history']
                : [],
          featureSummary: {
            exactAffinityTotal: totals.exact,
            categoryAffinityTotal: totals.category,
            exactAffinity: exact,
            categoryAffinity: category,
            contextualPopularity: contextual.score,
            contextualPopularitySegment: contextual.segment,
            popularHere: true,
            popularityReasonCode: 'popular_here',
          },
        } satisfies RankedCandidate;
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidate.action.actionId.localeCompare(
            right.candidate.action.actionId,
          ),
      );
  }
}
