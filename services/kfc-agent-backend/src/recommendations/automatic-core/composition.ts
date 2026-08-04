import type {
  AutomaticRecommendationCandidate,
  AutomaticRecommendationType,
  AutomaticScoredCandidate,
} from './types.js';

function byRetainedValueThenIdentity(
  left: AutomaticScoredCandidate,
  right: AutomaticScoredCandidate,
): number {
  return (
    right.expectedRetainedValueVnd - left.expectedRetainedValueVnd ||
    left.candidate.candidateId.localeCompare(right.candidate.candidateId)
  );
}

export function composeAutomaticRecommendationSlate(
  recommendationType: AutomaticRecommendationType,
  scoredCandidates: readonly AutomaticScoredCandidate[],
): AutomaticRecommendationCandidate[] {
  const ordered = [...scoredCandidates].sort(byRetainedValueThenIdentity);
  if (recommendationType !== 'smart_cross_sell') {
    return ordered.slice(0, 3).map(({ candidate }) => candidate);
  }

  const selected: AutomaticRecommendationCandidate[] = [];
  const selectedCategories = new Set<string>();
  for (const { candidate } of ordered) {
    if (selectedCategories.has(candidate.categoryId)) {
      continue;
    }
    selected.push(candidate);
    selectedCategories.add(candidate.categoryId);
    if (selected.length === 3) {
      break;
    }
  }
  return selected;
}
