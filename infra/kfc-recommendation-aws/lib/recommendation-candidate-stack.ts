import { CfnOutput, Tags, Stack, type StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import { createCandidateServing, type CandidateServingResources } from "./candidate-serving.js";
import { createCandidateValidation, type CandidateValidationResources } from "./candidate-validation.js";
import { importServiceRepositories } from "./image-repositories.js";
import type { RecommendationPlatformStack } from "./recommendation-platform-stack.js";
import { createReleaseParameters, type ReleaseParameters } from "./release-parameters.js";
import { createReleaseTask } from "./release-task.js";
import { createSyntheticSentinels } from "./synthetic-sentinels.js";
import { applySandboxSecurityAcknowledgements } from "./security-acknowledgements.js";

export interface RecommendationCandidateStackProps extends StackProps {
  readonly platform: RecommendationPlatformStack;
}

export class RecommendationCandidateStack extends Stack {
  public readonly release: ReleaseParameters;
  public readonly serving: CandidateServingResources;
  public readonly validation: CandidateValidationResources;

  public constructor(scope: Construct, id: string, props: RecommendationCandidateStackProps) {
    super(scope, id, props);
    if (this.region !== "ap-southeast-1") throw new Error("RecommendationCandidateStack requires ap-southeast-1");
    this.release = createReleaseParameters(this, { includeMaximumTasks: false });
    createSyntheticSentinels(this, props.platform.data, this.release);
    const task = createReleaseTask(this, props.platform.compute, props.platform.data, importServiceRepositories(this), this.release);
    this.serving = createCandidateServing(this, props.platform.compute, props.platform.network, task);
    this.validation = createCandidateValidation(this, props.platform.network, this.serving, this.release);
    new CfnOutput(this, "CandidateApplicationLogGroupName", {
      value: `/kfc/recommendations/sandbox/${this.stackName}/application`,
    });
    applySandboxSecurityAcknowledgements(this);
    this.addStackDependency(props.platform);
    Tags.of(this).add("ServingRole", "candidate-validation-only");
  }
}
