#!/usr/bin/env node
import { App } from "aws-cdk-lib";

import { RecommendationSandboxStack } from "../lib/recommendation-sandbox-stack.js";

const app = new App();
new RecommendationSandboxStack(app, "KfcRecommendationSyntheticSandbox", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-southeast-1",
  },
  description: "KFC Automatic Recommendation Engine synthetic-only AWS Singapore sandbox",
});
