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

Production is therefore synthesized paused with desired count zero and no
scheduled/reactive scaling resources. Candidate validation is separately
gated and also defaults to zero. Activation requires all eight live endpoints
to match their exact VPC, services, actions and resource policies; linux/arm64
image manifests; semantically bound release and bundle hashes; an ISSUED
certificate covering the VPC Link TLS SNI name; a valid dual-target-group ECS
canary; current `OK` release-specific and operational alarms; and executable
in-VPC proof that `/ready`, trusted ports, mounted QMB, scorer contract/feature/
composer digests, structured logs, ADOT `/healthcheck`, OTLP metrics/traces, and
cross-runtime warmup all passed. Task 4 does not yet supply the QMB/trusted
runtime composition, so the capability exists but activation remains
fail-closed. None of that evidence is fabricated here.

Offline proof remains valid for source structure only: TypeScript compilation,
CDK assertion tests, CDK Nag checks, and `cdk synth` pass for
`ap-southeast-1`. Before deployment, run `npm run deploy:preflight` from
`infra/kfc-recommendation-aws`; it reports all blockers without exposing
credentials and exits non-zero until every immutable artifact and AWS binding
is verified.
