export { discoverAutomaticRecommendationCandidates } from './candidates.js';
export {
  automaticModelBinding,
  resolveQualifiedAutomaticRecommendationBundle,
} from './bundles.js';
export { composeAutomaticRecommendationSlate } from './composition.js';
export { resolveAutomaticRecommendationContext } from './context.js';
export { createAutomaticRecommendationEngine } from './engine.js';
export { AutomaticRecommendationInfrastructureError } from './errors.js';
export { evaluateAutomaticRecommendationEligibility } from './eligibility.js';
export {
  AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  AUTOMATIC_FEATURE_SCHEMA_VERSION,
  buildAutomaticRecommendationFeatureRows,
} from './features.js';
export type {
  AutomaticCatalogItemSnapshot,
  AutomaticCatalogSnapshot,
  AutomaticCompletedHistorySnapshot,
  AutomaticModifierGroupSnapshot,
  AutomaticModifierOptionSnapshot,
  AutomaticRecommendationCandidate,
  AutomaticRecommendationContext,
  AutomaticRecommendationContextPorts,
  AutomaticRecommendationContextResolution,
  AutomaticEligibilityDecision,
  AutomaticEligibilityEvidenceCode,
  AutomaticFeatureValue,
  AutomaticRecommendationFeatureRow,
  AutomaticModelBinding,
  AutomaticQualifiedBundlePort,
  AutomaticQualifiedModelConfiguration,
  AutomaticQualifiedRecommendationBundle,
  AutomaticRecommendationIdPort,
  AutomaticRecommendationScorerPort,
  AutomaticScoredCandidate,
  AutomaticRecommendationRequest,
  AutomaticRecommendationType,
} from './types.js';
