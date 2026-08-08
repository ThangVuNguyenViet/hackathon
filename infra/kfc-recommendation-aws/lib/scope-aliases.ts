export const canonicalScopeAliases = {
  "recommendations.decision:write": "recommendations/decision.write",
  "recommendations.event:write": "recommendations/event.write",
  "recommendations.inspection:read": "recommendations/inspection.read",
} as const;

export type CanonicalRecommendationScope = keyof typeof canonicalScopeAliases;

export const cognitoScopeFor = (canonical: string): string => {
  if (!(canonical in canonicalScopeAliases)) {
    throw new Error(`unknown canonical recommendation scope: ${canonical}`);
  }
  return canonicalScopeAliases[canonical as CanonicalRecommendationScope];
};
