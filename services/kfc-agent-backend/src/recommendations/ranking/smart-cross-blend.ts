import { assertEligibleCandidates } from './contextual-popularity.js';
import type { RankedCandidate, PlacementRanker, RankerInput } from './types.js';

const compareRankedCandidates = (
  left: RankedCandidate,
  right: RankedCandidate,
): number =>
  right.score - left.score ||
  left.candidate.action.actionId.localeCompare(right.candidate.action.actionId);

const countForKey = (counts: object, key: string): number => {
  const entry = Object.entries(counts).find(([entryKey]) => entryKey === key);
  return typeof entry?.[1] === 'number' ? entry[1] : 0;
};

export class SmartCrossBlendRanker implements PlacementRanker {
  readonly version = 'smart-cross-blend-v1';

  rank(input: RankerInput): RankedCandidate[] {
    assertEligibleCandidates(input);
    const normalization = input.rankingStatistics.normalization;
    const storeId = input.context.request.storeId;
    return input.candidates
      .map((candidate): RankedCandidate => {
        const statistics = input.rankingStatistics.productStatistics.find(
          (entry) => entry.sellableItemId === candidate.sellableItemId,
        );
        const storeItemOrderCount = statistics
          ? countForKey(statistics.storeOrderCounts, storeId)
          : 0;
        const globalItemOrderCount = statistics?.globalOrderCount ?? 0;
        const popularityRaw = Math.log1p(
          2 * storeItemOrderCount + globalItemOrderCount,
        );
        const popularityZ =
          (popularityRaw - normalization.smartPopularityLog.mean) /
          normalization.smartPopularityLog.standardDeviation;
        const discountZ =
          (candidate.activeDiscountRatio - normalization.discountRatio.mean) /
          normalization.discountRatio.standardDeviation;
        return {
          candidate,
          score: 0.5 * popularityZ + 0.5 * discountZ,
          reasonCodes:
            candidate.activeDiscountRatio > 0
              ? ['active_offer']
              : ['completes_your_meal'],
          featureSummary: {
            storeItemOrderCount,
            globalItemOrderCount,
            popularityRaw,
            popularityZ,
            discountZ,
            activeDiscountRatio: candidate.activeDiscountRatio,
          },
        };
      })
      .sort(compareRankedCandidates);
  }
}

export function composeSmartCrossSellSlate(
  rankedCandidates: readonly RankedCandidate[],
  remainingBudgetVnd: number | null,
): RankedCandidate[] {
  const selected: RankedCandidate[] = [];
  const selectedItems = new Set<string>();
  const categoryCounts = new Map<string, number>();
  let budget = remainingBudgetVnd;
  const sorted = [...rankedCandidates].sort(compareRankedCandidates);

  const fits = (candidate: RankedCandidate): boolean =>
    budget === null || candidate.candidate.action.priceImpact.amount <= budget;
  const choose = (candidate: RankedCandidate): void => {
    selected.push(candidate);
    selectedItems.add(candidate.candidate.sellableItemId);
    categoryCounts.set(
      candidate.candidate.categoryId,
      (categoryCounts.get(candidate.candidate.categoryId) ?? 0) + 1,
    );
    if (budget !== null)
      budget -= candidate.candidate.action.priceImpact.amount;
  };

  for (const candidate of sorted) {
    if (selected.length === 3) break;
    if (candidate.candidate.action.type !== 'add_product') continue;
    if (selectedItems.has(candidate.candidate.sellableItemId)) continue;
    if ((categoryCounts.get(candidate.candidate.categoryId) ?? 0) >= 2)
      continue;
    if (!fits(candidate)) continue;
    choose(candidate);
  }
  if (selected.length < 3) return [];

  const firstThreeCategories = new Set(
    selected.map((candidate) => candidate.candidate.categoryId),
  );
  for (const candidate of sorted) {
    if (candidate.candidate.action.type !== 'add_product') continue;
    if (candidate.score <= 0) continue;
    if (selectedItems.has(candidate.candidate.sellableItemId)) continue;
    if (firstThreeCategories.has(candidate.candidate.categoryId)) continue;
    if (!fits(candidate)) continue;
    choose(candidate);
    break;
  }
  return selected;
}
