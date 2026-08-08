import { Validations } from "aws-cdk-lib";
import { Construct } from "constructs";

export const applySandboxSecurityAcknowledgements = (scope: Construct): void => {
  const acknowledgements: ReadonlyArray<[string, string]> = [
    ["AwsSolutions-IAM5", "Cross-stack imported ARNs synthesize dynamic wildcard finding IDs; every wildcard remains constrained to the documented evidence prefixes, state-table indexes, log streams, or AWS APIs without resource-level permissions."],
    ["Annotation::@aws-cdk/core:crossStackReferencesDefaultStrong", "Strong producer protection is intentional: shared platform resources cannot be replaced while candidate or production serving stacks still import them."],
    ["AwsSolutions-EC23", "The unresolved VPC CIDR is used only for DNS egress; no ingress is CIDR-open and no internet route exists."],
    ["AwsSolutions-S1", "The dedicated access-log sink is terminal and expires sandbox logs after 30 days; logging it recursively is impossible."],
    ["AwsSolutions-SMG4", "The generated non-customer runtime token rotates only through an immutable release deployment because no rotation Lambda is permitted in the no-NAT serving boundary."],
    ["AwsSolutions-COG1", "This user pool has no human/password users; only OAuth2 client_credentials is enabled."],
    ["AwsSolutions-COG2", "MFA does not apply to OAuth2 client_credentials machine identities."],
    ["AwsSolutions-COG8", "Plus-tier human sign-in threat protection does not apply to the synthetic M2M-only sandbox."],
    ["AwsSolutions-ECS2", "All direct environment values are non-secret immutable digests, resource names, localhost addresses, or bounded concurrency configuration; secret material uses ECS Secrets."],
    ["AwsSolutions-IAM5[Action::s3:GetObject*]", "Object version reads are prefix-scoped to recommendation evidence and readiness probes."],
    ["AwsSolutions-IAM5[Action::s3:GetBucket*]", "Bucket metadata reads remain scoped to the evidence bucket."],
    ["AwsSolutions-IAM5[Action::s3:List*]", "Prefix-constrained evidence reconciliation requires version listing."],
    ["AwsSolutions-IAM5[Action::s3:Abort*]", "Aborting incomplete multipart uploads avoids orphaned storage."],
    ["AwsSolutions-IAM5[Action::kms:GenerateDataKey*]", "The data-key family is scoped to the single platform KMS key."],
    ["AwsSolutions-IAM5[Resource::*]", "Only AWS APIs without resource-level permissions use Resource star; action and namespace conditions remain bounded."],
    ["AwsSolutions-IAM5[Resource::<StateTable9728C7E5.Arn>/index/*]", "The task can query only indexes on the single state table."],
    ["AwsSolutions-IAM5[Resource::<EvidenceBucketFBA44255.Arn>/automatic-recommendations/*]", "The wildcard is limited to canonical automatic recommendation evidence keys."],
    ["AwsSolutions-IAM5[Resource::<EvidenceBucketFBA44255.Arn>/readiness-probes/*]", "The wildcard is limited to reserved release-bound readiness probes."],
  ];
  for (const [id, reason] of acknowledgements) Validations.of(scope).acknowledge({ id, reason });
};
