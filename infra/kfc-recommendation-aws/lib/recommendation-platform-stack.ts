import { Stack, Tags, type StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import { createAuth, type AuthResources } from "./auth.js";
import { createDataPlane, type DataPlaneResources } from "./data-plane.js";
import { createHttpApi } from "./http-api.js";
import { createNetwork, type NetworkResources } from "./network.js";
import { createPlatformCompute, type PlatformComputeResources } from "./platform-compute.js";
import { createPlatformParameters, type PlatformParameters } from "./platform-parameters.js";
import { applySandboxSecurityAcknowledgements } from "./security-acknowledgements.js";

export class RecommendationPlatformStack extends Stack {
  public readonly data: DataPlaneResources;
  public readonly network: NetworkResources;
  public readonly compute: PlatformComputeResources;
  public readonly parameters: PlatformParameters;
  public readonly auth: AuthResources;

  public constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    if (this.region !== "ap-southeast-1") throw new Error("RecommendationPlatformStack requires ap-southeast-1");
    this.parameters = createPlatformParameters(this);
    this.data = createDataPlane(this);
    this.network = createNetwork(this, this.data);
    this.compute = createPlatformCompute(this, this.network, this.data, this.parameters);
    this.auth = createAuth(this);
    createHttpApi(this, this.network, this.compute, this.auth, this.parameters);
    applySandboxSecurityAcknowledgements(this);
    Tags.of(this).add("Environment", "synthetic-sandbox");
    Tags.of(this).add("ServingRole", "platform-only");
  }
}
