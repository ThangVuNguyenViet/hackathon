#!/usr/bin/env node
import { App } from "aws-cdk-lib";

import { RecommendationCandidateStack } from "../lib/recommendation-candidate-stack.js";
import { RecommendationPlatformStack } from "../lib/recommendation-platform-stack.js";
import { RecommendationProductionStack } from "../lib/recommendation-production-stack.js";
import { RecommendationFoundationStack } from "../lib/recommendation-foundation-stack.js";

const app = new App();
new RecommendationFoundationStack(app, "KfcRecommendationFoundation", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-southeast-1",
  },
  description: "KFC recommendation immutable image and GitHub OIDC foundation",
});
const platform = new RecommendationPlatformStack(app, "KfcRecommendationPlatform", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-southeast-1",
  },
  description: "KFC Automatic Recommendation Engine shared private AWS platform",
});
const candidate = new RecommendationCandidateStack(app, "KfcRecommendationCandidate", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-southeast-1" },
  platform,
  description: "KFC independently deployable candidate validation release",
});
new RecommendationProductionStack(app, "KfcRecommendationProduction", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-southeast-1" },
  platform,
  candidate,
  description: "KFC explicitly promoted production recommendation release",
});
