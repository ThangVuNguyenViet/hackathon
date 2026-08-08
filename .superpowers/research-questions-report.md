# KFC Automatic Recommendation Engine: implementation decision report

Date: 2026-08-04
Mode: read-only independent research and current-branch review
Scope: implementation-blocking questions only

## Executive conclusion

The Wayfinder map ([#93](https://github.com/ThangVuNguyenViet/hackathon/issues/93)) and all 17 child issues are closed, and the canonical specification is internally coherent at the product/ML-governance level. The implementation branch is clean and two commits ahead of `origin/main`:

- `b692c681` — establishes the automatic contract boundary and donor manifest.
- `d8411333` — publishes the OpenAPI/JSON Schema authority and example fixtures.

Those commits are an appropriate Slice 0/early Slice 1 start, but they do not yet resolve the implementation choices below. The most urgent amendment is the runtime baseline: Node 22 is already in Maintenance LTS and reaches end of life on 2027-04-30, while Node 24 remains supported until 2028-04-30. Node 24 should be selected before runtime qualification so the Peak Serving Envelope is not immediately invalidated by a runtime migration.

Two current-branch observations also need resolution before Slice 1 can be called complete:

1. Only the protected inspection operation declares security in `openapi.json`; the four decision and two event operations currently declare none.
2. Node parses the wire shapes, but the committed Python and Dart representations currently prove only operation/type constants and the canonical digest. They do not yet prove full cross-language request/response/event validation or generated clients.

## Decision questions

### 1. Which Node runtime should become the qualified Main baseline?

Current fact: Node's official schedule places Node 22 in Maintenance LTS from 2025-10-21 through end of life on 2027-04-30. Node 24 is LTS, enters maintenance on 2026-10-20, and remains supported through 2028-04-30. Node 26 is still Current on the report date; Node recommends production use of Active or Maintenance LTS releases. The repository already declares `node >=22.13.0`, although its Dockerfile is pinned only to the moving `node:22-bookworm-slim` major tag. ([Node release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json), [Node release guidance](https://nodejs.org/en/about/previous-releases))

Options:

- **Recommended — amend the specification to Node 24 LTS now.** Pin the build and runtime images by exact image digest, run the normal backend gates, and qualify only Node 24 in the first Peak Serving Envelope.
- Keep Node 22 for initial implementation, then requalify Node 24 before any post-POC exposure. This preserves the approved text but creates a near-term mandatory image/runtime/envelope migration.
- Wait for Node 26 LTS in October 2026. This delays implementation for no current requirement and would qualify a runtime that is not LTS today.

Decision needed by: before Slice 2 runtime work and certainly before any performance evidence.

### 2. How are trusted client backends authenticated to all API operations?

Current fact: API Gateway HTTP APIs natively support JWT authorizers with issuer, audience and route scopes, and also support IAM/SigV4 authorization. Cognito supports machine-to-machine client-credentials grants and custom resource-server scopes. The current OpenAPI protects only the admin inspection operation with an unspecified bearer token; decision and event routes are unsecured in the wire authority. ([API Gateway JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html), [API Gateway IAM authorization](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html), [Cognito M2M scopes](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html))

Options:

- **Recommended — Cognito M2M access tokens plus API Gateway JWT route scopes.** Create separate confidential app clients for the workbench backend and chat backend; define `recommendations.decide`, `recommendations.events`, and `recommendations.inspect` scopes; keep client secrets only in trusted backends. This works even while a client backend remains outside AWS.
- IAM/SigV4 on all routes. This is simpler and stronger for AWS-hosted callers with task roles, but an external chat backend needs federated temporary AWS credentials or a long-lived key, so it is not the best present fit.
- Lambda authorizer. This permits custom policies but adds custom security code, latency and another failure surface without an identified need.

Decision needed by: before extending the canonical OpenAPI or deploying API Gateway. The customer-facing browser must never hold these backend credentials.

### 3. What exact API Gateway VPC Link/ALB integration contract should CDK build?

Current fact: HTTP API private integrations support VPC Link V2 to an ALB listener, require the API, link and load balancer to be in the same account, use HTTP to the private integration by default, and prepend a named stage unless parameter mapping overwrites the path with `$request.path`. ECS Fargate containers in one task can communicate on `localhost`. ALB routes only to healthy targets, but if every target is unhealthy it fails open and routes to them, so the Main process must still reject work when dependencies are unavailable. ([HTTP API private integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-private.html), [Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html), [ALB target health](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html))

Options:

- **Recommended — one API per environment using the `$default` stage, VPC Link V2, an internal ALB HTTPS listener with `tlsConfig`, and an ALB `/ready` check served by Main.** `/ready` must fail unless the scorer contract warm-up, bundle digests and required DynamoDB/S3 probes are healthy. Keep an application-level readiness guard on every request because of ALB fail-open behavior.
- Named stages with an explicit integration path mapping to `$request.path`, otherwise identical. Choose this only if a shared API across environments is required.
- Plain HTTP from API Gateway to the internal ALB. This is simpler, but leaves the VPC hop unencrypted and should be an explicit sandbox risk acceptance rather than an accidental default.

Decision needed by: before Slice 6 CDK implementation.

### 4. How does a fresh decision become durable across S3 and DynamoDB?

Current fact: DynamoDB `TransactWriteItems` is atomic only across DynamoDB items/tables. Its `ClientRequestToken` provides API-level idempotency for 10 minutes. S3 provides strong read-after-write consistency, per-key atomicity and conditional `If-None-Match: *` writes, but no transaction spans S3 and DynamoDB. Therefore the specification's synchronous S3-plus-DynamoDB durability promise requires an explicit application saga and orphan handling. ([DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html), [S3 consistency](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel), [S3 conditional PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html))

Options:

- **Recommended — immutable S3-first commit saga.** Derive one object key from `recommendationId`; upload compressed evidence with `If-None-Match: *` and a supplied SHA-256 checksum; capture key, version ID, checksum and size; then transact the decision and idempotency items with conditional puts and a deterministic `ClientRequestToken`. On retry, `HEAD` the existing object and accept it only if all immutable metadata match. Reconcile or expire S3 objects that never receive a DynamoDB completion pointer.
- DynamoDB `pending` record, then S3, then DynamoDB `complete`. This makes recovery visible but adds an externally observable intermediate state and two DynamoDB writes; readers must never treat `pending` as durable.
- Put all evidence in DynamoDB. This avoids the cross-service saga but violates the approved large-evidence boundary and the DynamoDB item-size constraint as evidence grows.

Decision needed by: before Slice 5 persistence ports. Required failure tests include crash after S3 success, transaction conflict, retry after the 10-minute transaction token window, checksum mismatch, and orphan reconciliation.

### 5. What is the Main-to-scorer protocol and artifact format?

Current fact: Fargate supports `localhost` communication between containers in the same task. The branch has a JSON Schema for scorer requests/responses, but no transport. XGBoost guarantees backward compatibility for saved model JSON/UBJSON, while memory snapshots/pickle are not stable. Scikit-learn documents security and cross-version risks for pickle/joblib/cloudpickle; ONNX can reduce the serving environment but does not support every estimator and conversion can change the effective serving implementation. ([Fargate localhost](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html), [XGBoost model IO](https://xgboost.readthedocs.io/en/stable/tutorials/saving_model.html), [scikit-learn persistence](https://scikit-learn.org/stable/model_persistence.html), [LightGBM Booster API](https://lightgbm.readthedocs.io/en/latest/pythonapi/lightgbm.Booster.html))

Options for transport:

- **Recommended — persistent HTTP/1.1 JSON over `127.0.0.1` using the committed scorer schema.** Provide `/score`, `/live`, and `/ready`; use keep-alive, strict body limits, hard deadlines and one request-level model thread by default. This is the smallest contract-preserving implementation and its serialization cost remains part of the Peak Serving Envelope.
- gRPC/protobuf on localhost. It may reduce serialization overhead, but introduces a second wire authority/code-generation stack before profiling establishes need.
- Unix-domain socket HTTP. It may shave loopback overhead, but requires a shared task volume and extra lifecycle/permission handling.

Options for model artifacts:

- **Recommended — champion-native, non-pickle artifacts in a digest-pinned scorer image.** Use LightGBM's saved model representation, XGBoost JSON/UBJSON, and an explicit data-only coefficient/calibrator representation for logistic regression. Pin exact runtime libraries and preserve golden prediction fixtures. Any runtime-library or artifact-format change invalidates qualification.
- Convert every champion to ONNX. Treat conversion as a distinct serving implementation and require numerical, explanation and business-gate requalification.
- Pickle/joblib complete Python objects. Reject for the serving bundle because of code-execution and version-coupling risks.

Decision needed by: before Slice 4 emits bundle artifacts and Slice 5 implements the scorer.

### 6. Which observability stack and sampling policy is authoritative?

Current fact: AWS moved its X-Ray SDKs and daemon into maintenance mode on 2026-02-25 and recommends OpenTelemetry. ADOT can run as a Fargate sidecar, receive OTLP over HTTP or gRPC, and export to X-Ray. CloudWatch p99 alarms need at least 1,000 samples per evaluation period to avoid low-sample handling. Container Insights enhanced observability is supported on ECS/Fargate and its metrics are billed as custom metrics. ([X-Ray support timeline](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html), [ADOT on ECS](https://aws-otel.github.io/docs/setup/ecs/), [ADOT X-Ray exporter](https://aws-otel.github.io/docs/getting-started/x-ray/), [CloudWatch low-sample percentiles](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/percentiles-with-low-samples.html), [Container Insights enhanced observability](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/deploy-container-insights-ECS-cluster.html))

Options:

- **Recommended — OpenTelemetry SDKs in Node/Python -> OTLP to the ADOT sidecar -> X-Ray/CloudWatch.** Do not add the legacy X-Ray SDK/daemon. Use 100% trace sampling only for the bounded synthetic qualification run, where trace/evidence reconciliation is a gate; use a controlled lower parent-based rate plus reservoir for routine sandbox traffic. Keep raw load-generator histograms, not CloudWatch percentiles, as latency authority.
- Enable CloudWatch Application Signals in addition to ADOT. Revisit only if its managed service maps add value without duplicating the approved custom stages and metrics.
- Use the X-Ray SDK/daemon directly. Reject because it is already maintenance-only.

Decision needed by: before Slice 6 instrumentation/CDK and before defining evidence retention costs.

### 7. How do private Fargate tasks reach required AWS services?

Current fact: Fargate tasks need a network path for ECR pulls, logs, secrets and application AWS calls. S3 and DynamoDB gateway endpoints require no NAT and carry no endpoint charge; other AWS services can use PrivateLink interface endpoints. ([Fargate networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html), [S3/DynamoDB gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html), [ECR VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html), [ECS network security](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-network.html))

Options:

- **Recommended — private subnets with S3 and DynamoDB gateway endpoints plus the minimum required interface endpoints for ECR API/Docker, CloudWatch Logs, Secrets Manager and telemetry/control-plane calls.** Deny general internet egress from the serving task; verify a fresh task can pull images, fetch secrets, publish telemetry and reach persistence with NAT absent.
- Private subnets with NAT Gateway. This is simpler for broad egress but adds fixed cost and permits unnecessary destinations unless separately restricted.
- Public subnets with public task IPs. Reject because it weakens the intended private service boundary without solving an identified requirement.

Decision needed by: before Slice 6 VPC/CDK design. Confirm the final endpoint list with the exact task execution/runtime calls; do not create interface endpoints speculatively.

### 8. How will the canonical wire authority actually control all language clients?

Current fact: the branch computes one canonical digest and validates all examples through the hand-written Node parsers. Python currently exposes the digest and recommendation enum; Dart exposes the enum, paths, schema version and digest. Neither consumes the complete canonical request/response/event schemas yet. Digest equality proves file identity, not representation equivalence.

Options:

- **Recommended — generate complete Node, Python and Dart wire models/clients from the checked-in OpenAPI/JSON Schemas, then run every canonical example and negative fixture through each language in CI.** Keep handwritten domain adapters outside the generated package.
- Use canonical JSON Schema runtime validation in every language and handwrite only typed adapters. This can work, but it pushes more errors to runtime and still requires full cross-language negative-fixture tests.
- Keep hand-written representations plus digest checks. Reject because it cannot mechanically prove semantic equivalence and does not satisfy Slice 1's stated exit.

Decision needed by: before calling Slice 1 complete or adding more behavior on the hand-written contracts.

## Recommended decision order

1. Approve Node 24 and cross-language generation/validation before further runtime work.
2. Add route authentication semantics to the canonical OpenAPI.
3. Freeze the scorer transport/artifact rules and S3/DynamoDB commit saga before Slices 4–5.
4. Freeze API Gateway/ALB, private egress, and OpenTelemetry details before Slice 6.
5. Only then run the Peak Serving Envelope; all selected image, runtime, protocol, artifact, persistence and telemetry parameters must be bound into it.

## Evidence boundary

This report does not reopen resolved product decisions: four type-specific operations, deterministic eligibility, four learned type-specific rankers promoted atomically, no customer-serving fallback, synthetic-only qualification, kiosk-shaped workbench as primary client, chat as secondary client, and the AWS Singapore ECS/Fargate destination remain accepted. It also does not claim implementation, AWS deployment, model qualification or real KFC compatibility.

Research used current first-party Node.js, AWS, LightGBM, XGBoost and scikit-learn documentation. GitHub inspection used live issue #93 and its 17 child issues via `gh`; no issue, branch or commit was changed.
