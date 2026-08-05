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
- Candidate validation and production promotion use different CloudFormation
  stacks, task definitions, services, release parameters, and application log
  groups. Updating `KfcRecommendationCandidate` cannot update or scale the live
  production service. `KfcRecommendationProduction` is deployed only as the
  explicit promotion operation after candidate proof. Each Fargate task contains
  digest-pinned Node 24 Main, Python scorer, and ADOT
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
  reads of seven non-overwriting `RELEASE#<digest>` sentinels (order, journey,
  catalog, and all four exposure types) and a real immutable S3 write plus
  exact-version read under reserved `readiness-probes/*`;
  a bucket metadata check is not considered readiness. ECR repositories are
  immutable and scanned on push.
- Native ECS 10%/5-minute production canary uses two target groups, explicit production
  and test listener rules, the required ECS load-balancer infrastructure role,
  and alarm rollback. The circuit breaker is intentionally absent because AWS
  supports it only for rolling deployments. Every deploy binds Main,
  scorer, ADOT, Qualified Model Bundle, release, and previous-release digests.
  The independently deployed candidate service never shares this production
  task definition or target registration.

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

The platform stack has no ECS service. Candidate validation always runs one
isolated candidate task. The production promotion stack always retains at least
one warm production task and is never deployed as part of candidate validation.
Scheduled minimum capacity rises to two at
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
catalog to `/opt/kfc/catalog/catalog.json`. Both builds explicitly target
`linux/arm64` and inspect the loaded image architecture before succeeding.

Deployment has four independently addressable stacks:

1. `KfcRecommendationFoundation` creates immutable ECR repositories and GitHub
   OIDC.
2. `KfcRecommendationPlatform` creates the retained private network, data plane,
   ALB, target groups, Cognito, and API; it contains no ECS task or service.
3. `KfcRecommendationCandidate` receives candidate-only release parameters and
   runs one isolated candidate service plus the in-VPC deep-readiness probe.
4. Only after preflight passes, deploy `KfcRecommendationProduction` with the
   exact proven candidate parameters. This creates or updates only the live
   production task/service and its scaling/rollback resources.

Never deploy the production stack as part of candidate validation. The strong
cross-stack references protect the retained platform while serving stacks import
it; candidate and production release identities remain independent.

The preflight is read-only and never deploys. It verifies exact release and QMB
content, the trusted catalog digest, all payload digests, linux/arm64 ECR manifests, ACM `ISSUED` plus SAN,
eight endpoints whose live type, VPC, route-table/subnet, private-DNS,
security-group, service, and policy bindings match exactly, a completed
contract-compatible rollback release read from an exact immutable S3 key and
version, then live-reverified through `DescribeServiceDeployments`, the exact
ARM64 task definition/container images/release environment, and the exact OK
alarm states recorded at completion,
or explicit first-release rollback-to-paused, synthesized alarm-linked canary,
trusted ports, task CPU/memory/architecture, mounted QMB, compiled-equal runtime
contract/feature/composer digests, certificate and capacity shape, source/CDK
revision derived from local Git HEAD, CDK revision derived from the exact
synthesized production-template bytes, rollback binding, ADOT `/healthcheck`, structured
logs, telemetry, and a successful cross-runtime warmup. The preflight invokes
the VPC validation Lambda and then observes the same
immutable release in structured CloudWatch logs, an X-Ray segment, and native
ALB request metrics. It also requires a freshly updated `OK` activation alarm
and an `OK` operational composite; a hand-authored local proof cannot activate
the service.

Release manifests must be produced with `build-release-manifest.ts`; callers may
not supply source or CDK revisions. After a production ECS service deployment is
`SUCCESSFUL`, run `finalize-release.ts` with its service-deployment ARN, the
approved manifest bytes, exact completion alarm names, and evidence bucket. The
finalizer independently reads live ECS/task/alarm state and only then writes a
content-addressed `completed-releases/<release>/<digest>.json` object with
`If-None-Match: *`. Record the returned S3 VersionId for the next preflight.

A real deployment additionally requires an existing scoped CDK bootstrap deployment role named by
`CdkDeploymentRoleArn`; GitHub OIDC can assume only that role from the main
branch of the configured repository. The generated Cognito client secret and
runtime secret are never emitted as stack outputs.

The current `aws-cdk-lib@2.263.0` bundles `brace-expansion@5.0.8`, which npm
reports under GHSA-rgw5-rvv9-x895. The vulnerable package is used by local CDK
synthesis, not shipped in any service image. No fixed `aws-cdk-lib` release was
available on 2026-08-05, so deploy automation must update and re-run the full
gate as soon as an upstream release replaces it.
