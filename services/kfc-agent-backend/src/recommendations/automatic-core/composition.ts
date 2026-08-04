import type {
  AutomaticRecommendationCandidate,
  AutomaticRecommendationType,
  AutomaticScoredCandidate,
} from './types.js';

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference =
      leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

function byRetainedValueThenIdentity(
  left: AutomaticScoredCandidate,
  right: AutomaticScoredCandidate,
): number {
  return (
    right.expectedRetainedValueVnd - left.expectedRetainedValueVnd ||
    compareUnicodeCodePoints(
      left.candidate.candidateId,
      right.candidate.candidateId,
    )
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
