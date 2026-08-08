# KFC automatic recommendation donor manifest

Status: Slice 2 path-level disposition inventory closed

Baseline: `origin/main` at `b6149c727b18d1d36f0a495fad73b0baff709eca`

Read-only donor: `codex/kfc-kiosk-recommendation-prototype` at `fc5fcafbaf7e0f00afbdd668ab90f6be0439b947`

This manifest accounts for the recommendation surfaces present in the donor.
Nothing from that branch is merged wholesale. An Adopt entry means the behavior
may be reimplemented after contract review; it does not make the donor runtime
authoritative.

The machine-checkable path-level authority is
`docs/kfc-automatic-recommendation-donor-dispositions.json`. It captures 299
exact donor paths at `fc5fcafbaf7e0f00afbdd668ab90f6be0439b947` and assigns
each path exactly one of `Adopt`, `Redesign`, `Delete`, `Preserve unrelated`, or
`Historical superseded`. The capture includes runtime modules, scripts,
configuration, CI, documentation, evidence, tests, assets, migrations, and
cross-cutting imports. Its declared donor roots and explicit exception paths
derive the exact inventory from `git ls-tree`; the maintained backend authority
audit requires equality and traverses the target runtime import graph plus
deployment/config/CI surfaces. Preserved chat ranking is explicitly allowlisted
and proven unreachable from the automatic core entrypoint.

## Adopt after contract review

| Donor surface | Disposition in the new system |
|---|---|
| `src/recommendations/domain/` | Reimplement opaque identities, revisions, money/cart facts, and canonical-time validation under the new wire authority. |
| `src/recommendations/eligibility/` | Reimplement deterministic candidate enumeration and eligibility. It remains the only pre-score policy boundary. |
| `src/recommendations/automatic/{engine,evidence-contracts,model-runtime,qualified-models,tracing,otel-tracer}.ts` | Retain the useful separation between trusted Main, qualified model binding, score reconciliation, and evidence stages. Rewrite against the four exact operations and atomic four-model bundle. |
| `src/recommendations/persistence/{repository,types}.ts` | Retain the provider-neutral repository seam. Implement its production target with DynamoDB transactions and S3 evidence. |
| `src/recommendations/observability/` | Retain stage vocabulary where it maps to context, candidates, eligibility, features, scoring, composition, and persistence. |
| `apps/kfc_live_monitor_flutter/**/recommendation_offer.dart` and its model/test/golden | Reuse rendering primitives only after they consume the generated new contract; chat remains a secondary client. |

## Redesign or replace

| Donor surface | Replacement |
|---|---|
| `contracts/recommendations/v1/` | Replace with one OpenAPI 3.1 and JSON Schema authority at `contracts/automatic-recommendations/v1/`, with four decision operations plus impression/outcome operations. |
| `src/recommendations/application/` | Replace the generic decision/journey application with channel-neutral type-specific services. Journey timing and repetition remain client-owned. |
| `src/recommendations/automatic/{application,bundled-components,chat-service,contracts,d1-persistence,runtime}.ts` | Rewrite around required type prerequisites, `recommended | empty | paused`, localhost scorer isolation, and AWS persistence. No D1 production target or in-process chat authority. |
| `src/recommendations/snapshots/` | Replace bundled demo snapshots with trusted catalog/history/store adapters whose synthetic implementation is removable. |
| `src/recommendations/history/` | Keep an opaque completed-history port; replace stored-demo history with the synthetic dataset adapter now and real KFC authority later. |
| `src/recommendations/state/` | Replace journey/presentation state with decision, idempotency, exposure, and evidence state only. |
| `src/api/routeRecommendationHandlers.ts` and `src/persistence/d1StoreRecommendationOperations.ts` | Replace with the four exact routes and provider-neutral persistence ports; production uses DynamoDB/S3. |
| migrations `0024` through `0029` | Replace recommendation-specific D1/demo tables with CDK-managed DynamoDB tables and versioned S3 evidence. Preserve unrelated chat migrations. |
| `fixtures/recommendations/` | Replace promotion/ranking/Sanity snapshots with versioned synthetic catalog, causal-world, qualified-bundle, and cross-language contract fixtures. |
| `services/kfc-recommendation-simulator/` | Retain only useful offline test ideas. Rebuild as a causal journey generator, leakage-safe trainer/evaluator, and minimal scorer package with separate training/serving dependencies. |
| `qualification/kfc-recommendation/` | Replace chat-first and Sanity narratives with ten-seed model qualification, slice metrics, invalid-output tests, and AWS Peak Serving Envelope evidence. |
| recommendation tests outside explicit Delete rows | Rewrite as small contract, eligibility, scorer-boundary, persistence, evidence, and failure-injection tests. Do not replay narrative scenarios deterministically. |
| active recommendation docs, SDD reports, demo tutorial, screenshots, and video assets | Mark historical/superseded or replace with the new release handoff, bundle evidence, workbench proof, and AWS runbook. |

## Delete with no compatibility path

| Donor surface | Reason |
|---|---|
| `services/kfc-recommendation-sanity/` | Sanity has no serving or control-plane role. |
| `src/recommendations/merchandising/` and `fixtures/recommendations/sanity-policy-snapshot-v1.json` | Manual/merchandising authority cannot replace or suppress learned output at request time. |
| `src/recommendations/ranking/` and `test/recommendations/deterministic-rankers.test.ts` | Deterministic rankers move to offline baselines only; none may serve. |
| `src/recommendations/shadow/`, `services/kfc-recommendation-shadow-runtime/`, and shadow tests | The Keras/shadow/tunnel path is not part of the atomic qualified bundle. |
| Hugging Face publication, embeddings, Transformers, Keras, and tunnel-specific simulator paths/tests | Model download and runtime model selection are forbidden. |
| `apps/kfc-recommendation-explainer-prototype/` | Replaced wholesale by the new kiosk-shaped Flutter web workbench after its acceptance gate. |
| generic recommendation aliases, parsers, hybrid/manual/shadow fields, and generic decide routes in the old schema/application/routes | The public contract has exactly four decision operations and no runtime fallback. |
| Sanity replacement/suppression and once-only/chat-journey qualification narratives | They encode retired authority or client-owned orchestration. |
| old scratch recommendation demo migrations/data and checked-in `qualified: true` manifests | Qualification must be reproducible from the causal world and ten frozen seeds. |

## Unrelated surfaces preserved

`src/ordering/recommendationRanking.ts` on `main` belongs to the existing chat
agent and is not silently deleted in Slice 0. It will be audited when the
secondary chat client is switched to the shared API. Existing chat, commerce,
monitor, and business-pack changes are outside this big-bang branch unless a
later slice names an explicit integration.

## Slice 0 exit check

The donor groups above cover contracts, runtime modules, API/persistence,
fixtures, migrations, tests, apps, simulator/training, qualification, configs,
and active/historical documentation. Prototype commits remain read-only, and
the detached planning worktree's dirty and untracked files remain preserved.
