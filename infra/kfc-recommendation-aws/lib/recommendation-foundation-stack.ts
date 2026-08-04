import { CfnParameter, Stack, Tags, type StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import { createDeploymentIdentity } from "./deployment-identity.js";
import { createFoundationRepositories } from "./image-repositories.js";

export class RecommendationFoundationStack extends Stack {
  public constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    if (this.region !== "ap-southeast-1") {
      throw new Error(`RecommendationFoundationStack requires ap-southeast-1, received ${this.region}`);
    }
    const githubRepository = this.node.tryGetContext("githubRepository") as string | undefined;
    if (githubRepository === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepository)) {
      throw new Error("CDK context githubRepository=owner/repository is required for scoped OIDC trust");
    }
    createFoundationRepositories(this);
    const deploymentRoleArn = new CfnParameter(this, "CdkDeploymentRoleArn", {
      type: "String",
      allowedPattern: "^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]+$",
      description: "Existing least-privilege CDK bootstrap deployment role assumed by GitHub OIDC",
    });
    createDeploymentIdentity(this, deploymentRoleArn.valueAsString, githubRepository);
    Tags.of(this).add("Environment", "synthetic-sandbox");
    Tags.of(this).add("Phase", "foundation");
  }
}
