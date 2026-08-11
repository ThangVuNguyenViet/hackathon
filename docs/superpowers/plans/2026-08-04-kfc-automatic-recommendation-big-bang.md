# KFC Automatic Recommendation Engine Big-Bang Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for implementation and `superpowers:subagent-driven-development` for task execution and review.

**Goal:** Deliver the synthetic-sandbox-qualified, channel-neutral Automatic Recommendation Engine specified by the completed Wayfinder map, with a kiosk-shaped Flutter workbench as the primary client and chat as a secondary client.

**Authority:** `docs/wayfinder/kfc-product-recommendation-poc/implementation-ready-specification.md` in the planning checkout is the canonical product and architecture specification. The live Wayfinder map and all 17 child decisions are closed. This plan sequences implementation only; it does not reopen product decisions.

**Architecture:** Four exact recommendation APIs feed a deterministic candidate/eligibility boundary and four learned placement rankers. A Node 24 LTS Main container calls a minimal Python scorer sidecar over persistent localhost HTTP/1.1, commits durable decision/event evidence, and runs on CDK-managed AWS ECS Fargate in `ap-southeast-1`. Generated clients power the Flutter kiosk workbench and secondary chat integration. There is no runtime recommendation fallback, authored merchandising authority, LLM ranker, or automatic cart mutation.

## Global constraints

- Preserve the canonical wire digest across Node, Python, Dart, workbench, and chat clients.
- Pin Node 24 and all release images by immutable digest; any runtime or image change invalidates affected qualification evidence.
- Keep candidate validity, availability, exact modifier relationships, safety, and placement cardinality deterministic; learned models alone rank eligible candidates.
- Missing qualification, threshold failure, saturation, persistence failure, and scorer failure return typed empty/error results with no substitute recommender.
- Use synthetic data only. Real KFC data requires the fresh audit in the canonical specification and may replace the full data/model integration.
- Qualify lunch/dinner bursts at 50 RPS peak and 100 RPS shock; keep at least one warm task off peak and at least two before rush windows.
- Preserve unrelated user changes and use checkpoint commits after every accepted task.
- Do not enable real-customer exposure. The terminal state is `synthetic_sandbox_qualified`.

---

### Task 1: Complete cross-runtime contract authority

**Scope:** Finish Slice 1 after the existing canonical OpenAPI/JSON Schema checkpoint.

- [ ] Generate or validate complete Node, Python, and Dart representations for decision, event, inspection, error, and scorer payloads.
- [ ] Validate all schema references and exact error/idempotency semantics.
- [ ] Add trusted opaque journey/opportunity references, typed outcome unions, complete scorer provenance, and service-to-service JWT route scopes without exposing credentials to browsers.
- [ ] Prove every fixture parses identically and every client reports the canonical manifest digest.
- [ ] Run focused contract suites plus format, lint, typecheck, and architecture checks.

**Exit:** Identical canonical digest and payload semantics across all clients.

### Task 2: Build the clean deterministic engine core

**Scope:** Implement Slice 2 under the new automatic-recommendation boundary.

- [ ] Close the donor inventory at path level so every legacy recommendation/runtime/demo/config/script/evidence surface maps to Adopt, Redesign, Delete, Preserve unrelated, or Historical superseded.
- [ ] Implement complete candidate discovery and deterministic Eligibility Policy.
- [ ] Implement exact modifier-path validation, feature construction, scorer reconciliation, and type-aware slate composition.
- [ ] Return typed empty for missing qualification and threshold failure.
- [ ] Remove or isolate merchandising, manual, shadow, generic-decide, and fallback selection authority from the target runtime.
- [ ] Add direct deterministic tests for enumeration, invalid-output rejection, cardinality, no-padding, and absence of fallback paths.

**Exit:** The deterministic core is complete, tested, and has no alternate recommendation authority.

### Task 3: Build the synthetic causal world

**Scope:** Implement Slice 3 as a reproducible, versioned generator and loader.

- [ ] Separate physical-source, model-visible, evaluation, and oracle surfaces.
- [ ] Use independent random streams, known exposure propensities, chronological splits, and cold/drift/rush slices.
- [ ] Support smoke (2,000 journeys/1 seed), development (20,000/3), and qualification (50,000 per seed/10) profiles.
- [ ] Export scorer candidate shapes and arrivals-per-minute for AWS qualification.
- [ ] Add deterministic-reproduction and deliberate-leakage tests proving training loaders cannot read evaluation/oracle data.

**Exit:** Identical inputs reproduce identical manifests and artifacts with enforced information boundaries.

### Task 4: Benchmark and atomically qualify all four rankers

**Scope:** Implement Slice 4 with reproducible training and evidence.

- [ ] Benchmark logistic regression, LightGBM, and XGBoost independently for each recommendation type.
- [ ] Fit dual calibrated outcome heads, propensity weighting, per-type thresholds, and deterministic composers.
- [ ] Freeze configuration before untouched test evaluation and execute ten 50,000-journey qualification seeds.
- [ ] Emit all per-seed/slice/business/safety evidence and promote one four-model Qualified Model Bundle atomically or fail without a partial release.

**Exit:** Every per-type and combined gate passes with immutable evidence and no fallback model.

### Task 5: Integrate Main, scorer, and durable evidence persistence

**Scope:** Implement Slice 5 using production-shaped local dependencies.

- [ ] Build the minimal Python scorer image with a digest-bound qualified bundle.
- [ ] Implement persistent HTTP/1.1 JSON localhost Main-to-scorer calls, readiness, bounded concurrency, typed saturation, and failure behavior.
- [ ] Implement an immutable S3-first evidence saga followed by transactional DynamoDB decision/idempotency/event persistence, including orphan reconciliation.
- [ ] Add contract, failure-injection, idempotency, durability, digest, and no-fallback tests.

**Exit:** Local production-shaped serving and evidence gates pass.

### Task 6: Build and qualify the CDK AWS sandbox

**Scope:** Implement Slice 6 for AWS Singapore.

- [ ] Provision a `$default`-stage HTTP API Gateway through VPC Link V2 and an internal HTTPS ALB to ECS Fargate Main/scorer/ADOT tasks, with application readiness guards.
- [ ] Add Cognito M2M JWT scopes, immutable ECR, encrypted S3/DynamoDB, least-privilege IAM, Secrets Manager, OIDC deployment, OpenTelemetry-to-ADOT/X-Ray/CloudWatch, dashboards, alarms, and scheduled/reactive scaling.
- [ ] Run tasks without NAT using S3/DynamoDB gateway endpoints and only the verified ECR, Logs, Secrets, and telemetry interface endpoints required by the task.
- [ ] Define one warm off-peak task and at least two pre-warmed tasks before lunch and dinner.
- [ ] Prove CDK synth/tests, security checks, readiness, circuit breaker, and exact-digest canary/rollback behavior.

**Exit:** The sandbox infrastructure is reproducible and passes deployment-safety gates.

### Task 7: Replace the old demo with the Flutter kiosk workbench

**Scope:** Implement Slice 7 as the only recommendation demo surface.

- [ ] Build the three-panel Flutter web workbench and one-command Chromium kiosk launcher.
- [ ] Consume only the generated recommendation client; duplicate no ranking logic.
- [ ] Cover guest/returning state, all four types, typed-empty cases, trusted actions/events, reload durability, and evidence inspection.
- [ ] Capture real-browser integration evidence at the agreed desktop kiosk viewport.
- [ ] After acceptance, remove old demo routes/apps/assets/state with no compatibility layer.

**Exit:** Visual and integration gates pass with no console errors or old demo entrypoint.

### Task 8: Reuse the exact engine contract from chat

**Scope:** Implement Slice 8 without creating a chat-specific recommender.

- [ ] Replace target in-process recommendation calls with the shared generated client.
- [ ] Persist journey orchestration, retain the three semantic tools, bind digest-qualified GenUI, revalidate actions, and label evidence by channel.
- [ ] Bound chat sandbox concurrency separately.
- [ ] Prove cross-client equivalence, reconnect, typed-empty, failure, stale-action, event, and one held-out live `BaseChatModel` canary.

**Exit:** Chat is a thin secondary client and does not requalify or fork the model.

### Task 9: Discover capacity, then measure and freeze the Peak Serving Envelope

**Scope:** Implement Slice 9 against the AWS sandbox.

- [ ] First run single-task capacity discovery across 0.5 vCPU/2 GiB, 1 vCPU/3 GiB, and 2 vCPU/4 GiB sizes and candidate/concurrency sweeps; feed measured safe RPS into CDK scaling/max-task settings.
- [ ] Run 50 RPS peak and 100 RPS shock profiles with synchronous evidence writes.
- [ ] Inject scorer, DynamoDB, S3, invalid-bundle, one-task-loss, saturation, alarm, and rollback failures.
- [ ] Require p95 <= 250 ms, p99 <= 500 ms, 100% evidence durability, and bounded saturation behavior.
- [ ] Select the smallest safe task and publish immutable `peak-serving-envelope.json` with scaling/max-task calculations.

**Exit:** The rerunnable Peak Serving Envelope passes every declared gate.

### Task 10: Qualify and deploy the synthetic sandbox release

**Scope:** Implement Slice 10 and complete the POC.

- [ ] Assemble one Recommendation Release Candidate bound to immutable source, image, contract, bundle, and envelope digests.
- [ ] Re-run deterministic, model, workbench, chat, security, infrastructure, and evidence gates on that exact candidate.
- [ ] Record required human approvals and deploy only the synthetic sandbox.
- [ ] Publish the proof index and deletion/disposition reconciliation.

**Exit:** Release state is exactly `synthetic_sandbox_qualified`; real-customer exposure remains disabled.
