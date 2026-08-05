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
  full application readiness contract at `/ready`. That path is available only
  to target-group health checks and the isolated candidate-validation path; it
  is not an API Gateway route.
- No internet gateway, NAT, or public task IP. Isolated route tables expose S3/DynamoDB gateway
  endpoints and ECR API/DKR, Logs, Secrets Manager, Monitoring, and X-Ray
  interface endpoints. Every endpoint has an action-scoped endpoint policy.
  The task security group permits only DNS inside the VPC
  and TLS; without an internet route, TLS is constrained to those endpoints.
- Evidence under `automatic-recommendations/*` is versioned, KMS-encrypted,
  retained, and protected from object deletion. DynamoDB uses KMS encryption,
  PITR, deletion protection, on-demand capacity, and a digest index for bounded
  reconciliation. Release-bound synthetic order/journey, exposure, and catalog
  sentinels are created with the stack. Deep readiness performs exact consistent
  reads of those sentinels and a real immutable S3 write plus exact-version read;
  a bucket metadata check is not considered readiness. ECR repositories are
  immutable and scanned on push.
- Once a completed live primary exists, native ECS 10%/5-minute canary uses two target groups, explicit production
  and test listener rules, the required ECS load-balancer infrastructure role,
  and alarm rollback. The circuit breaker is intentionally absent because AWS
  supports it only for rolling deployments. Every deploy binds Main,
  scorer, ADOT, Qualified Model Bundle, release, and previous-release digests.
  A first release has no traffic to split: it requires explicit
  `AllowRollbackToPaused=true` and promotes the already validated task with a
  rolling 0→1 scale-up. Subsequent releases use the native canary.

Main runs the recommendation-only entrypoint; it does not open Postgres or
start the conversational agent. Request commerce facts are never authorities.
Order/history/exposure snapshots come from fixed DynamoDB `pk`/`sk` contracts, and
the synthetic catalog plus atomic QMB are immutable files baked into the
qualified Main image and verified against release digests before composition.
Missing state or artifacts keeps `/ready` closed.

Public recommendation inspection does not require the generated internal admin
secret. Its boundary is the exact Cognito
`recommendations.inspection:read` JWT scope, the explicit API Gateway route,
VPC Link, and an internal ALB that accepts ingress only from that link. Other
administrative routes remain secret-protected and are not exposed by the public
listener. Inspection uses an exact decision read plus a bounded, paginated
DynamoDB query; it does not enumerate or download S3 object versions.

## Rush capacity and telemetry

The service stack defaults to `ActivateProduction=false`: desired count is zero
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

Production images must be assembled from the qualified artifacts; the
Dockerfiles have no production fallback. From the repository root, set
`QUALIFIED_BUNDLE_ROOT`, `QUALIFIED_BUNDLE_DIGEST`, `TRUSTED_CATALOG_FILE`,
`TRUSTED_CATALOG_DIGEST`, `MAIN_IMAGE_TAG`, and `SCORER_IMAGE_TAG`, then run
`infra/kfc-recommendation-aws/bin/build-release-images.sh`. The script supplies
named BuildKit contexts and copies the bundle to `/opt/kfc/bundle` and the
catalog to `/opt/kfc/catalog/catalog.json`.

Deployment is two phase. First deploy only `KfcRecommendationFoundation` to
create immutable repositories and GitHub OIDC without needing images or a QMB.
Then synthesize/deploy `KfcRecommendationSyntheticSandbox` with
`ActivateProduction=false` and `ValidateCandidate=false`. To validate, set
`ValidateCandidate=true`: one isolated service runs the exact production task
definition and an in-VPC Lambda probes deep readiness every minute through a
private validation listener. The release-specific alarm treats missing data as
breaching. Keep validation running through the native canary, set
`ActivateProduction=true` only after preflight passes. Activation requires
`ValidateCandidate=true`, so the exact validation service remains available
through the first 0→1 promotion or subsequent canary bake.

The preflight is read-only and never deploys. It verifies exact release and QMB
content, the trusted catalog digest, all payload digests, linux/arm64 ECR manifests, ACM `ISSUED` plus SAN,
eight endpoints whose live type, VPC, route-table/subnet, private-DNS,
security-group, service, and policy bindings match exactly, a completed
contract-compatible rollback release read from an exact immutable S3 key and
version with AWS/task provenance,
or explicit first-release rollback-to-paused, synthesized alarm-linked canary,
trusted ports, task CPU/memory/architecture, mounted QMB, compiled-equal runtime
contract/feature/composer digests, certificate and capacity shape, source/CDK
revision, rollback binding, ADOT `/healthcheck`, structured
logs, telemetry, and a successful cross-runtime warmup. The preflight invokes
the VPC validation Lambda and then observes the same
immutable release in structured CloudWatch logs, an X-Ray segment, and native
ALB request metrics. It also requires a freshly updated `OK` activation alarm
and an `OK` operational composite; a hand-authored local proof cannot activate
the service.

A real deployment additionally requires an existing scoped CDK bootstrap deployment role named by
`CdkDeploymentRoleArn`; GitHub OIDC can assume only that role from the main
branch of the configured repository. The generated Cognito client secret and
runtime secret are never emitted as stack outputs.

The current `aws-cdk-lib@2.263.0` bundles `brace-expansion@5.0.8`, which npm
reports under GHSA-rgw5-rvv9-x895. The vulnerable package is used by local CDK
synthesis, not shipped in any service image. No fixed `aws-cdk-lib` release was
available on 2026-08-05, so deploy automation must update and re-run the full
gate as soon as an upstream release replaces it.
