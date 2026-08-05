// Compatibility export for callers that only need the shared, non-serving platform.
// Candidate validation and production serving are intentionally separate stacks.
export { RecommendationPlatformStack as RecommendationSandboxStack } from "./recommendation-platform-stack.js";
