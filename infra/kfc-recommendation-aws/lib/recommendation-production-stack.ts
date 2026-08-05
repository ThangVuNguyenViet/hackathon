import { CfnOutput, Stack, Tags, type StackProps } from "aws-cdk-lib";
import { CfnService } from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";

import { createObservability } from "./observability.js";
import { importServiceRepositories } from "./image-repositories.js";
import { createProductionServing, type ProductionServingResources } from "./production-serving.js";
import type { RecommendationCandidateStack } from "./recommendation-candidate-stack.js";
import type { RecommendationPlatformStack } from "./recommendation-platform-stack.js";
import { createReleaseParameters, type ReleaseParameters } from "./release-parameters.js";
import { createReleaseTask } from "./release-task.js";
import { createScaling } from "./scaling.js";
import { applySandboxSecurityAcknowledgements } from "./security-acknowledgements.js";

export interface RecommendationProductionStackProps extends StackProps {
  readonly platform: RecommendationPlatformStack;
  readonly candidate: RecommendationCandidateStack;
}

export class RecommendationProductionStack extends Stack {
  public readonly release: ReleaseParameters;
  public readonly serving: ProductionServingResources;

  public constructor(scope: Construct, id: string, props: RecommendationProductionStackProps) {
    super(scope, id, props);
    if (this.region !== "ap-southeast-1") throw new Error("RecommendationProductionStack requires ap-southeast-1");
    this.release = createReleaseParameters(this);
    const task = createReleaseTask(this, props.platform.compute, props.platform.data, importServiceRepositories(this), this.release);
    this.serving = createProductionServing(this, props.platform.compute, props.platform.network, task);
    createScaling(this, props.platform.compute, this.serving, this.release);
    const releaseSafety = createObservability(
      this,
      props.platform.compute,
      this.serving,
      props.candidate.serving.validationTargetGroup.targetGroupFullName,
    );
    const cfnService = this.serving.service.node.defaultChild as CfnService;
    cfnService.addPropertyOverride("DeploymentConfiguration.Alarms", {
      AlarmNames: [props.candidate.validation.activationAlarm.alarmName, releaseSafety.alarmName],
      Enable: true,
      Rollback: true,
    });
    new CfnOutput(this, "ProductionServiceArn", { value: this.serving.service.serviceArn });
    new CfnOutput(this, "ProductionTaskDefinitionArn", { value: task.taskDefinitionArn });
    applySandboxSecurityAcknowledgements(this);
    this.addStackDependency(props.platform);
    this.addStackDependency(props.candidate);
    Tags.of(this).add("ServingRole", "production-promotion-only");
  }
}
