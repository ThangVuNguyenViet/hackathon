export { discoverAutomaticRecommendationCandidates } from './candidates.js';
export {
  automaticModelBinding,
  resolveQualifiedAutomaticRecommendationBundle,
} from './bundles.js';
export {
  AUTOMATIC_COMPOSER_CONTRACT_DIGEST,
  composeAutomaticRecommendationSlate,
} from './composition.js';
export { resolveAutomaticRecommendationContext } from './context.js';
export { createAutomaticRecommendationEngine } from './engine.js';
export {
  AutomaticRecommendationBindingError,
  AutomaticRecommendationInfrastructureError,
} from './errors.js';
export { evaluateAutomaticRecommendationEligibility } from './eligibility.js';
export {
  AUTOMATIC_FEATURE_KEYS,
  AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  AUTOMATIC_FEATURE_SCHEMA_VERSION,
  buildAutomaticRecommendationFeatureRows,
  parseAutomaticRecommendationFeatureVector,
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
  AutomaticTrustedOrderContextSnapshot,
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
  AutomaticScorerRequest,
  AutomaticScoredCandidate,
  AutomaticRecommendationRequest,
  AutomaticRecommendationType,
} from './types.js';
