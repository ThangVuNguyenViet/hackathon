export interface RecommendationCandidate<T> {
  itemCode: string;
  eligible: boolean;
  safetyBlocked?: boolean;
  value: T;
  score?: {
    requestMatch: number;
    partySizeFit: number;
    budgetFit: number;
    preferenceMatch: number;
    cartDisruption: number;
  };
}

export function safetyRerank<T>(
  candidates: RecommendationCandidate<T>[],
): RecommendationCandidate<T>[] {
  return candidates.filter((candidate) => !candidate.safetyBlocked);
}

export function rankEligibleRecommendations<T>(
  candidates: RecommendationCandidate<T>[],
  limit = 3,
): RecommendationCandidate<T>[] {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const scoringAvailable = eligible.every((candidate) =>
    candidate.score && Object.values(candidate.score).every(Number.isFinite),
  );
  const ranked = [...eligible].sort((left, right) => {
    if (!scoringAvailable) return left.itemCode.localeCompare(right.itemCode);
    const total = (candidate: RecommendationCandidate<T>): number => {
      const score = candidate.score!;
      return score.requestMatch + score.partySizeFit + score.budgetFit +
        score.preferenceMatch - score.cartDisruption;
    };
    return total(right) - total(left) || left.itemCode.localeCompare(right.itemCode);
  });
  const requestedLimit = Number.isInteger(limit) ? Math.max(0, limit) : 3;
  return safetyRerank(ranked).slice(0, Math.min(3, requestedLimit));
}
