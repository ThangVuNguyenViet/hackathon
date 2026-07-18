const plannerOutputAliases = {
  i: 'intent',
  c: 'contextPolicy',
  e: 'entities',
  f: 'foodContentEvidenceRequirement',
  p: 'pendingDecisions',
  g: 'catalogSuggestion',
  s: 'savedAddressDecision',
  x: 'catalogSelections',
  t: 'toolCalls',
  r: 'responseClaims',
  d: 'directResponse',
} as const;

export function expandCompactPlannerOutput(output: Record<string, unknown>): void {
  for (const [compactKey, key] of Object.entries(plannerOutputAliases)) {
    if (output[key] === undefined && output[compactKey] !== undefined) output[key] = output[compactKey];
    delete output[compactKey];
  }
}
