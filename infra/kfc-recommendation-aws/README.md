# KFC recommendation AWS sandbox

This CDK v2 application defines the synthetic-only recommendation sandbox in
`ap-southeast-1`. It is deliberately not a deployment shortcut: synthesis is
offline, but deployment remains blocked until the read-only preflight verifies
the AWS identity, account, region, endpoint availability, exact ECR digests,
Qualified Model Bundle digest, ACM certificate, and rollback target.

## Topology and safety boundary

- `$default` HTTP API stage with seven explicit OpenAPI routes and no permissive
  default route. Canonical scopes map one-to-one to Cognito provider aliases:
  `recommendations.decision:write` → `recommendations/decision.write`,
  `recommendations.event:write` → `recommendations/event.write`, and
  `recommendations.inspection:read` → `recommendations/inspection.read`.
- VPC Link V2 to an internal HTTPS ALB. Only healthy Main containers join the
  target group. API Gateway sets TLS SNI and verifies the configured private
  server name against the ISSUED ACM certificate.
- One Fargate task contains digest-pinned Node 24 Main, Python scorer, and ADOT
  containers. Main starts only after the scorer is healthy and performs its
  full application readiness contract at `/recommendations/ready`.
- No internet gateway, NAT, or public task IP. Isolated route tables expose S3/DynamoDB gateway
  endpoints and ECR API/DKR, Logs, Secrets Manager, Monitoring, and X-Ray
  interface endpoints. Every endpoint has an action-scoped endpoint policy.
  The task security group permits only DNS inside the VPC
  and TLS; without an internet route, TLS is constrained to those endpoints.
- Evidence is versioned, KMS-encrypted, retained, and protected from object
  deletion. DynamoDB uses KMS encryption, PITR, deletion protection, and
  on-demand capacity. ECR repositories are immutable and scanned on push.
- Native ECS 10%/5-minute canary, alarm rollback, and deployment circuit
  breaker rollback are enabled. Every deploy binds Main,
  scorer, ADOT, Qualified Model Bundle, release, and previous-release digests.
  A first release requires explicit `AllowRollbackToPaused=true`.

## Rush capacity and telemetry

The service stack defaults to `ActivateService=false`: desired count is zero
and all scheduled/reactive scaling resources are conditionally absent. After
preflight, off peak retains one warm task. Scheduled minimum capacity rises to two at
10:00 and 16:30 and drains at 14:30 and 22:00 in
`Asia/Ho_Chi_Minh`. CPU 65%, memory 70%, and bounded in-flight pressure provide
reactive recovery with 30-second scale-out and 15-minute scale-in cooldowns.
`MaximumTasks` is a temporary safety ceiling and must be replaced by Task 9's
measured safe-RPS calculation before Peak Serving Envelope qualification.

Main/scorer/ADOT use JSON CloudWatch logs with 30-day retention. The current
rollback/scaling signals use only native ALB and ECS metrics, avoiding claims
from custom metrics without proven emitters. Request/customer/store/cart/decision
identities belong only in controlled logs and traces. Activation additionally
requires retained proof of structured logs, healthy ADOT, and the exact
telemetry contract.

## Local verification

```bash
npm ci
npm run check
npm run deploy:preflight
```

Deployment is two phase. First deploy only `KfcRecommendationFoundation` to
create immutable repositories and GitHub OIDC without needing images or a QMB.
Then synthesize/deploy `KfcRecommendationSyntheticSandbox` with
`ActivateService=false`. Only after images, QMB, endpoints, TLS and the runtime
activation proof pass may the service stack be updated with
`ActivateService=true`.

The preflight is read-only and never deploys. It verifies exact release and QMB
content, all payload digests, linux/arm64 ECR manifests, ACM `ISSUED` plus SAN,
eight available endpoint IDs, a completed contract-compatible rollback release
or explicit first-release rollback-to-paused, synthesized alarm-linked canary,
trusted ports, mounted QMB, all runtime digests, ADOT health, structured logs,
telemetry, and a successful cross-runtime warmup. The preflight must also call
deep `/ready` itself and then observe the same
immutable release in structured CloudWatch logs, an X-Ray segment, and native
ALB request metrics. A hand-authored boolean proof cannot activate the service.

A real deployment additionally requires an existing scoped CDK bootstrap deployment role named by
`CdkDeploymentRoleArn`; GitHub OIDC can assume only that role from the main
branch of the configured repository. The generated Cognito client secret and
runtime secret are never emitted as stack outputs.

The current `aws-cdk-lib@2.263.0` bundles `brace-expansion@5.0.8`, which npm
reports under GHSA-rgw5-rvv9-x895. The vulnerable package is used by local CDK
synthesis, not shipped in any service image. No fixed `aws-cdk-lib` release was
available on 2026-08-05, so deploy automation must update and re-run the full
gate as soon as an upstream release replaces it.
