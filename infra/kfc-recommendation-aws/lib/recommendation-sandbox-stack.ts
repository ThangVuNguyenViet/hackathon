import { CfnCondition, Fn, Stack, type StackProps, Tags, Token, Validations } from "aws-cdk-lib";
import { CfnService } from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";

import { createAuth } from "./auth.js";
import { createCandidateValidation } from "./candidate-validation.js";
import { createCompute } from "./compute.js";
import { createDataPlane } from "./data-plane.js";
import { createHttpApi } from "./http-api.js";
import { importServiceRepositories } from "./image-repositories.js";
import { createNetwork } from "./network.js";
import { createObservability } from "./observability.js";
import { createReleaseParameters } from "./release-parameters.js";
import { createScaling } from "./scaling.js";
import { createSyntheticSentinels } from "./synthetic-sentinels.js";

export class RecommendationSandboxStack extends Stack {
  public constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    if (this.region !== "ap-southeast-1") {
      throw new Error(`RecommendationSandboxStack requires ap-southeast-1, received ${this.region}`);
    }
    const githubRepository = this.node.tryGetContext("githubRepository") as string | undefined;
    if (githubRepository === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepository)) {
      throw new Error("CDK context githubRepository=owner/repository is required for scoped OIDC trust");
    }
    const release = createReleaseParameters(this);
    const data = createDataPlane(this);
    createSyntheticSentinels(this, data, release);
    const network = createNetwork(this, data);
    const repositories = importServiceRepositories(this);
    const auth = createAuth(this);
    const compute = createCompute(this, network, data, repositories, release);
    const activateProduction = new CfnCondition(this, "ActivateProductionCondition", {
      expression: Fn.conditionEquals(release.activateProduction.valueAsString, "true"),
    });
    const validateCandidate = new CfnCondition(this, "ValidateCandidateCondition", {
      expression: Fn.conditionEquals(release.validateCandidate.valueAsString, "true"),
    });
    const hasLivePrimary = new CfnCondition(this, "HasLivePrimaryCondition", {
      expression: Fn.conditionNot(Fn.conditionEquals(release.previousReleaseDigest.valueAsString, "")),
    });
    const cfnService = compute.service.node.defaultChild as CfnService;
    cfnService.desiredCount = Token.asNumber(Fn.conditionIf(activateProduction.logicalId, 1, 0));
    // A first 0->1 activation has no live primary to split, so it is an
    // explicitly validated rolling scale-up that can return to the completed
    // paused service. Native 10% canary semantics begin only once provenance
    // identifies a completed live primary release.
    cfnService.addPropertyOverride(
      "DeploymentConfiguration.Strategy",
      Fn.conditionIf(hasLivePrimary.logicalId, "CANARY", "ROLLING"),
    );
    cfnService.addPropertyOverride(
      "DeploymentConfiguration.CanaryConfiguration",
      Fn.conditionIf(
        hasLivePrimary.logicalId,
        { CanaryPercent: 10, CanaryBakeTimeInMinutes: 5 },
        { Ref: "AWS::NoValue" },
      ),
    );
    cfnService.addPropertyOverride(
      "LoadBalancers.0.AdvancedConfiguration",
      Fn.conditionIf(
        hasLivePrimary.logicalId,
        {
          AlternateTargetGroupArn: compute.alternateTargetGroupArn,
          ProductionListenerRule: compute.productionListenerRuleArn,
          TestListenerRule: compute.testListenerRuleArn,
          RoleArn: compute.infrastructureRole.roleArn,
        },
        { Ref: "AWS::NoValue" },
      ),
    );
    const validationService = compute.validationService.node.defaultChild as CfnService;
    validationService.desiredCount = Token.asNumber(Fn.conditionIf(validateCandidate.logicalId, 1, 0));
    createHttpApi(this, network, compute, auth, release);
    createScaling(this, compute, release, activateProduction);
    const releaseSafety = createObservability(this, compute, release);
    const validation = createCandidateValidation(this, network, compute, release, validateCandidate);
    cfnService.addPropertyOverride("DeploymentConfiguration.Alarms", {
      AlarmNames: [validation.activationAlarm.alarmName, releaseSafety.alarmName],
      Enable: true,
      Rollback: true,
    });

    const acknowledgements: ReadonlyArray<[string, string]> = [
      ["AwsSolutions-EC23", "The unresolved VPC CIDR is used only for DNS egress; no ingress is CIDR-open and no internet route exists."],
      ["AwsSolutions-S1", "The dedicated access-log sink is terminal and expires sandbox logs after 30 days; logging it recursively is impossible."],
      ["AwsSolutions-SMG4", "The generated non-customer runtime token rotates only through an immutable release deployment because no rotation Lambda is permitted in the no-NAT serving boundary."],
      ["AwsSolutions-COG1", "This user pool has no human/password users; only OAuth2 client_credentials is enabled."],
      ["AwsSolutions-COG2", "MFA does not apply to OAuth2 client_credentials machine identities."],
      ["AwsSolutions-COG8", "Plus-tier human sign-in threat protection does not apply to the synthetic M2M-only sandbox."],
      ["AwsSolutions-ECS2", "All direct environment values are non-secret immutable digests, resource names, localhost addresses, or bounded concurrency configuration; secret material uses ECS Secrets."],
      ["AwsSolutions-IAM5[Action::s3:GetObject*]", "CDK expands object-version reads; access remains resource-scoped to the evidence prefix."],
      ["AwsSolutions-IAM5[Action::s3:GetBucket*]", "CDK expands bucket metadata reads; access remains scoped to the evidence bucket."],
      ["AwsSolutions-IAM5[Action::s3:List*]", "Prefix-constrained evidence reconciliation requires the S3 list action family."],
      ["AwsSolutions-IAM5[Action::s3:DeleteObject*]", "The generated grant is defense-in-depth denied by the evidence bucket policy; application code cannot delete evidence."],
      ["AwsSolutions-IAM5[Action::s3:Abort*]", "Aborting incomplete multipart evidence uploads is required to avoid orphaned storage."],
      ["AwsSolutions-IAM5[Action::kms:ReEncrypt*]", "KMS grant action families are generated by CDK and remain scoped to the stack key."],
      ["AwsSolutions-IAM5[Action::kms:GenerateDataKey*]", "KMS grant action families are generated by CDK and remain scoped to the stack key."],
      ["AwsSolutions-IAM5[Resource::<EvidenceBucketFBA44255.Arn>/automatic-recommendations/*]", "The wildcard is limited to canonical automatic recommendation evidence keys."],
      ["AwsSolutions-IAM5[Resource::<StateTable9728C7E5.Arn>/index/*]", "The task role can query only indexes on the single state table; evidence lookup uses the evidenceDigest index."],
      ["AwsSolutions-IAM5[Resource::<CandidateValidationLogs28ED8219.Arn>:*]", "CloudWatch Logs requires a wildcard stream suffix under the single dedicated candidate-validation log group."],
      ["AwsSolutions-IAM5[Resource::*]", "X-Ray, CloudWatch PutMetricData, and ECR authorization-token APIs do not support resource-level permissions; action and namespace conditions bound them."],
    ];
    for (const [id, reason] of acknowledgements) {
      Validations.of(this).acknowledge({ id, reason });
    }

    Tags.of(this).add("Environment", "synthetic-sandbox");
    Tags.of(this).add("DataClass", "synthetic-only");
    Tags.of(this).add("ManagedBy", "CDK");
  }
}
