import type {
  AutomaticRecommendationCandidate,
  AutomaticRecommendationType,
  AutomaticScoredCandidate,
} from './types.js';

const composerContract = {
  schemaVersion: 'kfc-qualified-composer-v1',
  order:
    'calibrated joint probability times valid price impact descending; Unicode candidate identity tie-break',
  singleActionTypes: ['local_favorite', 'for_you', 'modifier_upsell'],
  singleActionCardinality: 1,
  smartCrossSell: {
    minimumReadyCount: 3,
    defaultRenderedCount: 3,
    maximumRenderedCount: 4,
    distinctCategory: true,
    positiveProbability: true,
    remainingBudgetRequired: true,
    noPadding: true,
  },
};

const canonicalComposerContract = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map(canonicalComposerContract).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalComposerContract(entry)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};
export const AUTOMATIC_COMPOSER_CONTRACT_DIGEST = createHash('sha256')
  .update(canonicalComposerContract(composerContract))
  .digest('hex');

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
import { createHash } from 'node:crypto';
