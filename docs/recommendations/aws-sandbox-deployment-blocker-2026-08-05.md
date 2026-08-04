# AWS sandbox deployment blocker — 2026-08-05

Status: **implementation and offline qualification only; deployment prohibited**.

Read-only checks from the implementation worktree found AWS CLI `2.34.10` and
a shared-credentials-file identity configured for `us-west-2`. The credential
could not be identified: `aws sts get-caller-identity` returned
`InvalidClientTokenId`. The explicit `ap-southeast-1` VPC endpoint service
query returned `AuthFailure`. No AWS account or caller ARN is therefore claimed.

Deployment is also blocked because no complete Task 4 Qualified Model Bundle,
immutable Main/scorer/ADOT ECR image digests, internal ALB ACM certificate, or
verified previous compatible release exists in this task. Docker availability
and image publication were not fabricated or inferred. No `cdk deploy`, ECR
write, IAM mutation, or other cost-incurring AWS action was attempted.

The service is therefore synthesized paused with desired count zero and no
scheduled/reactive scaling resources. Activation also requires all eight
deployed endpoints to be available, linux/arm64 image manifests, exact release
and bundle payload hashes, an ISSUED certificate covering the VPC Link TLS SNI
name, alarm-linked canary/circuit-breaker rollback, and retained runtime proof
that `/ready`, trusted ports, mounted QMB, scorer contract/feature/composer
digests, structured logs, healthy ADOT, telemetry, and cross-runtime warmup all
passed. None of that evidence is fabricated here.

Offline proof remains valid for source structure only: TypeScript compilation,
CDK assertion tests, CDK Nag checks, and `cdk synth` pass for
`ap-southeast-1`. Before deployment, run `npm run deploy:preflight` from
`infra/kfc-recommendation-aws`; it reports all blockers without exposing
credentials and exits non-zero until every immutable artifact and AWS binding
is verified.
