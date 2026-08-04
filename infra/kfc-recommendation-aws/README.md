# KFC recommendation AWS sandbox

This CDK v2 application defines the synthetic-only recommendation sandbox in
`ap-southeast-1`. It is deliberately not a deployment shortcut: synthesis is
offline, but deployment remains blocked until the read-only preflight verifies
the AWS identity, account, region, endpoint availability, exact ECR digests,
Qualified Model Bundle digest, ACM certificate, and rollback target.

## Topology and safety boundary

- `$default` HTTP API with Cognito client-credentials JWT scopes
  `recommendations/decide` and `recommendations/events`.
- VPC Link V2 to an internal HTTPS ALB. Only healthy Main containers join the
  target group.
- One Fargate task contains digest-pinned Node 24 Main, Python scorer, and ADOT
  containers. Main starts only after the scorer is healthy and performs its
  full application readiness contract at `/recommendations/ready`.
- No NAT or public task IP. Isolated route tables expose S3/DynamoDB gateway
  endpoints and ECR API/DKR, Logs, Secrets Manager, Monitoring, and X-Ray
  interface endpoints. The task security group permits only DNS inside the VPC
  and TLS; without an internet route, TLS is constrained to those endpoints.
- Evidence is versioned, KMS-encrypted, retained, and protected from object
  deletion. DynamoDB uses KMS encryption, PITR, deletion protection, and
  on-demand capacity. ECR repositories are immutable and scanned on push.
- Deployment circuit breaker rollback is enabled. Every deploy binds Main,
  scorer, ADOT, Qualified Model Bundle, release, and previous-release digests.
  A first release requires explicit `AllowRollbackToPaused=true`.

## Rush capacity and telemetry

Off peak retains one warm task. Scheduled minimum capacity rises to two at
10:00 and 16:30 and drains at 14:30 and 22:00 in
`Asia/Ho_Chi_Minh`. CPU 65%, memory 70%, and bounded in-flight pressure provide
reactive recovery with 30-second scale-out and 15-minute scale-in cooldowns.
`MaximumTasks` is a temporary safety ceiling and must be replaced by Task 9's
measured safe-RPS calculation before Peak Serving Envelope qualification.

Main/scorer/ADOT use JSON CloudWatch logs with 30-day retention. Metrics use
only bounded environment, immutable release, recommendation type, outcome, and
candidate-shape dimensions. Request/customer/store/cart/decision identities
belong only in controlled logs and traces. The dashboard, percentile alarm
with low-sample handling, readiness/durability/saturation alarms, composite
release-safety alarm, VPC flow logs, and ECS deployment-event log are part of
the stack.

## Local verification

```bash
npm ci
npm run check
npm run deploy:preflight
```

The preflight is read-only and never deploys. A real deployment additionally
requires an existing scoped CDK bootstrap deployment role named by
`CdkDeploymentRoleArn`; GitHub OIDC can assume only that role from the main
branch of the configured repository. The generated Cognito client secret and
runtime secret are never emitted as stack outputs.

The current `aws-cdk-lib@2.263.0` bundles `brace-expansion@5.0.8`, which npm
reports under GHSA-rgw5-rvv9-x895. The vulnerable package is used by local CDK
synthesis, not shipped in any service image. No fixed `aws-cdk-lib` release was
available on 2026-08-05, so deploy automation must update and re-run the full
gate as soon as an upstream release replaces it.
