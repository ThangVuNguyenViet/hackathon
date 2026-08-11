# Independent execution recommendations: KFC Automatic Recommendation Engine

Date: 2026-08-04

Scope: read-only audit of the canonical implementation-ready specification, current implementation branch, donor manifest, Wayfinder map issue #93, and child issues #94 through #110. This report does not change implementation files, issues, branches, or commits.

## Executive recommendation

Continue on `codex/kfc-automatic-recommendation-big-bang`, but do not start the deterministic engine until Slice 1 is genuinely closed. The branch is clean at `d8411333`, based on `origin/main` `b6149c72`, and is two commits ahead. Those commits establish the initial contract boundary and wire authority. The focused Node contract suite passes (10 tests), but Slice 1 is not complete: Dart and Python currently prove only names and a shared digest, not generated/validated request, response, event, problem, and scorer representations.

The safest program order remains contract-first, deterministic core, synthetic world, four-model qualification, production-shaped serving/persistence, AWS infrastructure, clients, final load qualification, and release assembly. Three refinements are necessary:

1. Insert a short **Slice 1A authority closure** before engine work.
2. Split the Peak Serving Envelope into discovery and final qualification phases to remove its circular dependency on CDK scaling values.
3. Freeze the engine/release inputs before final client acceptance and load qualification; any bound change restarts the affected gate.

Non-negotiable boundary: four type-specific decision operations, shared impression/outcome operations, no generic decide route, no Sanity/manual/merchandising/shadow/Personalize serving, no runtime ranking fallback, synthetic-only POC evidence, complete AWS deployment in `ap-southeast-1`, Node 22 Main plus a minimal same-task Python scorer, and one kiosk-first Flutter web workbench.

## Current program state

### Slice 0: substantially complete, one manifest closure needed

The donor manifest correctly treats `fc5fcafb` as read-only donor evidence and separates Adopt, Redesign, Delete, and unrelated surfaces. It preserves `src/ordering/recommendationRanking.ts` until chat cutover and forbids wholesale merging of the old prototype.

Before calling Slice 0 closed, append explicit disposition coverage for donor surfaces that are presently covered only by broad prose:

- the old Remotion/tutorial-video tree under `tools/demo-videos/kfc-recommendation-engine-tutorial/`;
- recommendation qualification/finalization scripts and package scripts;
- root/backend environment, Wrangler, deployment, CI, and package bindings;
- old deep-dive screenshots/evidence and `.superpowers` reports/plans; and
- cross-cutting imports in chat, GenUI, route, Worker, and persistence files.

Recommended default: generate a machine-readable donor path inventory and require every path to map to Adopt/Redesign/Delete/Preserve. Historical artifacts may remain only under an explicit historical/superseded classification and must be excluded from active runbooks and release proof.

### Slice 1: partial, not exited

What is proven now:

- exactly four decision paths exist;
- event and protected inspection paths exist;
- the generic decide path is absent;
- the ordered OpenAPI/JSON Schema authority has one reproducible digest;
- Node schemas reject obvious client-authored authority fields; and
- focused Node contract tests pass.

What remains before Slice 2:

- Generate or mechanically validate complete Node, Python, and Dart models and both kiosk/chat clients. A digest constant is not representation parity.
- Validate every example against JSON Schema/OpenAPI, not only through handwritten Node parsers.
- Add negative cross-language fixtures and relational contract checks: unique actions/positions/candidates, monotonic counts, action/type compatibility, exact modifier-parent binding, complete score reconciliation, and no missing/duplicate scorer rows.
- Make outcome requests discriminated and typed. `payload: object` cannot reliably carry checkout subtotal, abandonment horizon, mutation failure, or attribution evidence.
- Require at least one rendered action for an Impression and define whether explicit dismissal is action-scoped or slate-scoped. Recommended default: card dismissal is action-scoped; whole-slate dismissal gets an explicit separate typed shape.
- Bind the scorer to the complete champion provenance needed at runtime. Recommended minimum: bundle digest, per-type model revision, calibrator revision, feature-schema digest, threshold revision, composer-contract digest, and qualification run/evidence digest.
- Have Main recompute expected retained value from trusted price impact and returned calibrated joint probability; the scorer must not become composition authority.
- Apply replaceable service-to-service sandbox authentication to decision/event operations and a distinct admin scope to inspection. The current public operations have no declared security while the canonical specification requires replaceable sandbox authentication.

Recommended default: make OpenAPI/JSON Schema the only authored wire source and generate language models/clients with maintained tooling. Handwritten domain adapters may wrap generated types but may not redefine them.

## Dependency-ordered execution through all remaining slices

### 1A — close wire, attribution, and trusted-authority decisions

Complete the Slice 1 items above, then resolve these two blockers in the canonical contract:

- Add an opaque, trusted `orderingJourneyRef` (and, if needed by the evaluator, `opportunityRef`) without adding engine-owned journey orchestration. DynamoDB is required to maintain journey indexes and business evaluation requires journey joins, but the current request/event wire supplies no journey identity.
- Define the synthetic sandbox commerce-authority ports for catalog, store, cart, completed history, current price/availability, and action revalidation. The browser must not become history or catalog authority merely because the world is synthetic.

Recommended default: the trusted workbench/chat backend issues and persists opaque journey/customer references; Main resolves them through explicit provider-neutral authority ports. The workbench backend durably stores the Recommendation Presentation Binding and revalidates cart effects. Do not add a generic decision endpoint.

Exit gate: cross-language positive/negative fixtures, schema validation, generated-client compilation, relational tests, and canonical digest checks all pass.

### 2 — clean deterministic engine core

Implement new type-specific application services behind the four operations. Port donor ideas selectively for candidate enumeration, Eligibility Policy, modifier validation, feature construction, scorer reconciliation, and deterministic type-aware composition.

Recommended internal sequence:

1. trusted context resolver ports and immutable context snapshot;
2. complete candidate enumeration;
3. Eligibility Policy with typed exclusion evidence;
4. feature schema/version construction;
5. qualified bundle resolver with no-qualified typed empty;
6. scorer port plus strict reconciliation;
7. threshold and type-aware composition; and
8. response/evidence assembly.

Use an explicit fake scorer only in deterministic tests. Do not import popularity, deterministic rankers, Personalize, stale bundle, Sanity, merchandising, manual, or shadow code into the serving graph. Missing qualification, below-threshold output, or no eligible candidate must return typed empty; scorer/infrastructure failure must return retryable 503.

Exit gate: enumeration completeness, zero invalid outputs, exact modifier binding, cardinality/no-padding, score-set reconciliation, typed empty/pause, and source/config audits proving no fallback authority.

### 3 — synthetic causal world

Build the removable dataset adapter and versioned Parquet surfaces before training code. Freeze one explicit synthetic fulfilment vocabulary and use it consistently across API, world, workbench, slices, and load tests.

Recommended internal sequence:

1. manifest/schema and independent random-stream contract;
2. source/catalog/population/traffic generation;
3. opportunity and stochastic exposure generation with positive support;
4. outcomes and paired potential-outcome world;
5. physical model-visible/evaluation/oracle separation;
6. chronological train/calibration/validation/untouched-test splits; and
7. smoke/development/qualification profiles plus arrival/candidate fixtures.

Exit gate: byte-identical regeneration, separate-process leakage rejection, propensity/support checks, complete journey terminals, held-out store/cold/drift/lunch/dinner slices, and actual invalid counters.

### 4 — four-type benchmark and atomic bundle qualification

Do not begin full qualification while world or composer contracts are still moving. Run smoke, then development, freeze all candidate settings, and only then open ten untouched 50,000-journey seeds.

For each type, benchmark regularized logistic regression, LightGBM, and XGBoost on identical splits. Train selection and selected-through-checkout heads, apply clipped inverse-propensity weights, calibrate, select the per-type abstention threshold, and run the frozen deterministic composer. Random and popularity remain evaluator-only baselines.

Recommended default: no bundle is emitted unless all four per-type gates and combined business/non-inferiority gates pass. Store the actual artifacts and evidence digests in one atomic manifest; a checked-in boolean `qualified: true` is insufficient.

Exit gate: one immutable four-type Qualified Model Bundle or an explicit failed qualification with no serving artifact.

### 5 — production-shaped Main, minimal Python scorer, and persistence

Package the Node 22 Main separately from the existing Cloudflare Worker/chat runtime surface. Keep the Python scorer package minimal and bake the complete bundle into its image.

Recommended internal sequence:

1. scorer startup/digest verification and bounded localhost protocol;
2. Main readiness warm-up across all four types;
3. hard in-flight semaphore and request deadline;
4. DynamoDB repository implementations;
5. versioned S3 evidence writer;
6. transactional decision/idempotency commit; and
7. append-only typed event persistence and reconciliation.

Use repository contract tests and failure-injection fakes locally, followed by ephemeral real AWS integration tests in Slice 6. Do not make a LocalStack/emulator contract authoritative unless separately chosen and verified.

Exit gate: identical replay/conflict behavior, no false durability, no partial decision pointer, strict event idempotency, invalid-bundle unready state, scorer timeout/failure as 503, saturation as retryable 503, and zero fallback.

### 6A — parameterized CDK sandbox and security baseline

Create `infra/kfc-recommendation-aws/` for API Gateway HTTP API, VPC Link V2, internal ALB, ECS Fargate Main/scorer/ADOT task, DynamoDB, versioned S3, KMS, ECR, CloudWatch/X-Ray, OIDC, and alarms in `ap-southeast-1`.

At this phase, task size, concurrency, safe RPS, maximum tasks, and scaling targets are provisional inputs, not qualified values. Use conservative sandbox defaults solely for functional/security verification.

Exit gate: CDK synth/snapshots/security checks, immutable digest deployment, readiness, infrastructure failure behavior, and first-release rollback-to-paused behavior.

### 6B — single-task capacity discovery

Run the candidate-shape and worker/concurrency matrix on production-shaped AWS requests with synchronous DynamoDB/S3 evidence. Determine safe per-task RPS and eliminate failing configurations.

This phase resolves the circularity in the canonical order: CDK cannot calculate target request rate or maximum tasks until safe per-task throughput is measured, while the final envelope cannot be bound until those CDK values are set.

Output: selected task resources/workers/in-flight values, safe per-task RPS, and proposed scaling/max-task settings. This is discovery evidence, not the final Peak Serving Envelope.

### 7 — new kiosk-first Flutter web workbench and cutover

Build one new Variant-A-style three-region Flutter web feature/entrypoint using the generated client. It may use contract fixtures during development, but acceptance must use the deployed exact API and qualified release inputs.

Keep browser state presentational. Trusted synthetic commerce/cart/history and action revalidation belong to its application backend. Demonstrate guest/returning profiles, all four independent types, success, every prerequisite empty, below-threshold/no-eligible cases, trusted selection/dismissal, mutation results, reload safety, inspection/evidence, and explicit synthetic disclaimers.

Only after this acceptance gate may old explainer/demo entrypoints, state, routes, assets, fixtures, and tutorial artifacts be deleted or marked historical. No migration or compatibility alias is allowed.

### 8 — secondary chat reuse

Use the same generated client and exact AWS release. Keep only the three semantic chat tools. The configured `BaseChatModel` interprets customer language and selects among tools; typed backend state selects For You versus Local Favorite.

Persist Recommendation Journey Orchestration and Presentation Binding by Ordering Journey. Record an Impression only after durable assistant-turn and attachment publication. Revalidate delivered digest-bound actions against current commerce authority before mutation. Cap chat concurrency independently.

Exit gate: cross-client equivalence, reconnect/no duplicate proactive placement, exact-parent modifier, current-cart cross-sell, typed empty, stale/wrong action and digest rejection, infrastructure failure with no substitute recommender, channel-labelled evidence, and one held-out live-model integration canary.

### 9 — final Peak Serving Envelope

Freeze Git SHA, Main/scorer/ADOT image digests, Qualified Model Bundle, evidence mode, task sizing, worker/concurrency settings, traffic/candidate manifests, and the CDK scaling policy derived in 6B. Then run the complete scheduled and reactive qualification matrix.

The scheduled lunch/dinner run is the qualifying serving run; reactive-only is recovery evidence. Preserve raw load-generator histograms as authority. Any bound change invalidates this envelope and requires rerun.

Exit gate: all 50-RPS, 100-RPS shock, readiness, queue, correctness, evidence reconciliation, one-task-loss, invalid-bundle, DynamoDB/S3/scorer failure, alarm, scaling, and rollback gates pass in `ap-southeast-1`.

### 10 — synthetic sandbox release qualification

Assemble one immutable Recommendation Release Candidate from the exact frozen artifacts. Re-run deterministic repository checks and verify bundle, final envelope, workbench, chat, security, evidence, and claim boundaries.

First-release resolution: the `previousCompatibleRelease` field may be explicitly null. A rollback drill must then prove safe pause/typed-empty behavior, not invent a stale fallback. Subsequent candidates must name and successfully restore an exact prior compatible completed release.

Require the four evidence responsibilities and at least two distinct humans. The release approver cannot be the sole evidence author.

Exit state: `synthetic_sandbox_qualified` only. No real customer exposure, real KFC compatibility, production SLA, or AOV/conversion claim is authorized.

## Specification conflicts and recommended resolutions

| Conflict or gap | Risk | Recommended resolution |
|---|---|---|
| Current Dart/Python “parity” is digest-only | Consumers can drift while the digest constant still matches | Generate or fully validate every representation and client from the canonical schemas before Slice 2 |
| DDB requires journey indexes but the wire has no journey identity | Business attribution and reconnect joins are impossible or guessed from cart/session | Add trusted opaque journey/opportunity references; keep orchestration client-owned |
| Main must resolve catalog/history, but no synthetic commerce authority is specified | Browser/client data can accidentally become authoritative | Define provider-neutral trusted ports and one synthetic sandbox implementation before engine work |
| Generic outcome payload is untyped | Final subtotal, abandonment, mutation, and attribution evidence cannot be validated | Replace it with a discriminated union of typed outcome payloads |
| Scorer returns expected retained value while Main owns composition | Python can silently become ranking/composition authority | Main recomputes value from trusted price impact and calibrated joint probability and rejects mismatch |
| CDK scaling precedes measured safe RPS/max tasks | Circular or guessed infrastructure qualification | Use 6A parameterized infra, 6B discovery, then final immutable Slice 9 envelope |
| Slice 6 rollback trial precedes any completed release | First release has no valid rollback target | Test rollback-to-paused for the first release; require exact prior release thereafter |
| Decision/event APIs lack declared sandbox auth while inspection is protected | Public sandbox surface exceeds the approved boundary | Add replaceable service-to-service sandbox auth and separate admin inspection scope |
| Donor manifest uses broad categories for several executable/doc surfaces | Retired authority can survive through scripts, CI, tutorials, or config | Produce a path-level disposition inventory and enforce it with an architecture audit |
| Fulfilment vocabulary is not explicitly frozen by the canonical spec | World, API, kiosk, slices, and metrics can disagree | Declare one synthetic POC enum before world generation; change only through a contract version |

## Stop/go rules

Stop immediately if any slice introduces customer-serving random/popularity/deterministic/Personalize ranking, model download/runtime selection, stale-model fallback, a generic decide operation, Sanity/manual/merchandising/shadow authority, client-authored candidates/features, or semantic keyword/regex routing in chat.

Do not advance on partial evidence. A failing per-type model gate yields no bundle; a persistence mismatch yields no durable decision; a failed Peak Serving Envelope yields no qualified release; and missing human approval yields no deployment promotion.

Proceed only when each exit gate is preserved as a reproducible artifact bound to the exact next-slice inputs.
