# KFC recommendation behavioral-world prototype

> THROWAWAY LOGIC PROTOTYPE — this package tests whether a sequential synthetic
> ordering world can produce reproducible, model-visible recommendation events
> and physically separate counterfactual truth. It is not the production
> recommendation service.

The original Streamlit inspection shell was retired after review. This package
now contains the pure Python generator/auditor and the Smart Cross-sell and
Modifier Upsell ranker benchmarks. MLflow provides the local technical
inspection surface.

## Platform contract

`../../contracts/recommendations/v1/kfc-recommendation.schema.json` is the
cross-language transport authority. The Python Pydantic projection validates
the same checked-in examples as the TypeScript/Zod projection and adds the same
cross-field invariants. Model code receives only already-eligible
request-candidate rows; it does not own API, eligibility, merchandising, state,
or basket effects.

## Provenance

- KISS branch base:
  `6b36d0f2245e950ade843aeda48e1af33ea76e6b`
  (`codex/kfc-kiss-model-agnostic`)
- Validated simulator snapshot:
  `58cef2d1e9cece6075e1035158eb2674e530f9b7`
  (`prototype/kfc-synthetic-behavioral-world`)

## Question

Can one reproducible synthetic world model:

1. anonymous Local Favorite and history-qualified For You starters;
2. product addition → Modifier Upsell → Smart Cross-sell stage order;
3. complete eligibility, stochastic logging, Sanity effects, impressions,
   customer outcomes, cart mutation, and checkout;
4. store/product/modifier cold start and time-based drift; and
5. counterfactual potential outcomes that are physically unavailable to model
   features; and
6. a three-item-default, four-item-maximum Smart Cross-sell slate whose learned
   ranker can beat deterministic baselines on untouched journeys; and
7. a single, positive-price, parent/path-compatible Modifier Upsell action
   whose learned ranker can beat deterministic baselines on untouched journeys?

## Run

```bash
cd services/kfc-recommendation-simulator
uv sync
uv run kfc-rec-sim generate --preset smoke
uv run kfc-rec-sim audit ../../.artifacts/kfc-recommendation-simulator/smoke
uv run python -m unittest discover -s tests -v
```

Run the three-seed development smoke benchmark:

```bash
uv run kfc-rec-sim benchmark \
  --profile smoke \
  --output ../../.artifacts/kfc-recommendation-simulator/smart-cross-sell-smoke
```

Run the held-out qualification benchmark (ten independent 50,000-journey
seeds):

```bash
uv run kfc-rec-sim benchmark \
  --profile qualification \
  --output ../../.artifacts/kfc-recommendation-simulator/smart-cross-sell-qualification
```

Run the Modifier Upsell qualification over its own generated bundles:

```bash
uv run kfc-rec-sim benchmark \
  --placement modifier-upsell \
  --profile qualification \
  --output ../../.artifacts/kfc-recommendation-simulator/modifier-upsell-qualification
```

`--dataset-root <audited-datasets>` may reuse immutable generated seed bundles
without copying them. Placement-specific caches, models, explanations, MLflow
runs, and reports still live under the selected output.

## Qualified shadow-model package

The reviewed qualification snapshots are pinned by canonical result digest:

- Smart Cross-sell:
  `e76c7641d48a9f47f0da084ca77f30ceb8df6c31c2ebee65eef15d52c80cda80`
- Modifier Upsell:
  `75f1d02a4e230e901eb222b26268b255f46842483ad77f04e2192ea74d81de26`

The Modifier Upsell qualification reused the Smart Cross-sell qualification's
audited datasets. Reproduce its restartable stage graph with that same
`--dataset-root`; changing the dataset-root identity intentionally invalidates
its checkpoints:

```bash
uv run kfc-rec-sim benchmark \
  --placement modifier-upsell \
  --profile qualification \
  --dataset-root <smart-cross-sell-qualification>/datasets \
  --output <modifier-upsell-qualification>
```

After both benchmark results reproduce their pinned digests, create the local
placement-aware MLflow PyFunc:

```bash
uv run kfc-rec-sim package-shadow-models \
  --smart-cross-sell-qualification <smart-cross-sell-qualification> \
  --modifier-upsell-qualification <modifier-upsell-qualification> \
  --output <new-mlflow-model-directory>
```

Packaging fails closed unless each `benchmark-result.json` both declares and
canonically recomputes to its required digest. The MLflow package copies only
the qualified LightGBM/Keras model, calibration, feature-schema, ranker
manifest, and qualification results; generated datasets and duplicate model
binaries remain outside Git. Its `shadow-model-manifest.json` records input
file hashes, immutable model/calibration/schema IDs, the MLflow signature, and
the synthetic-evidence disclaimer. The PyFunc also packages a pinned trusted
artifact manifest and verifies the manifest plus every model, calibrator,
feature-schema, ranker-manifest, and qualification-result digest before loading
either placement. Hugging Face publication and deployment are separate
provisioning work.

Generated bundles contain:

```text
model-visible/
  journeys.parquet
  requests.parquet
  candidates.parquet
  eligibility_decisions.parquet
  pre_policy_rankings.parquet
  policy_effects.parquet
  decisions.parquet
  impressions.parquet
  outcomes.parquet
  carts_checkouts.parquet
evaluation/
  evaluation_slices.parquet
oracle/
  potential_outcomes.parquet
```

Model-visible tables contain only pre-decision features and serving evidence.
Cold-slice membership is evaluation-only. Latent preferences and potential
outcomes remain oracle-only.

The ranker benchmark compares popularity, basket-association, promotion, and
blended deterministic baselines with LightGBM, XGBoost, a compact native
Keras 3 scorer, and—where eligible cold-start evidence exists—a pinned
multilingual-embedding LightGBM ablation. It writes:

```text
benchmark-result.json
benchmark-report.md
mlflow.db
mlartifacts/
models/
explanations/
datasets/
evaluation-cache/
.stages/
```

The learned success target is the exact recommended action added to the basket
and retained through checkout. Candidate scores are calibrated success
probability multiplied by net merchandise value. Oracle outcomes are used only
by evaluation after ranking.

## Resource isolation and restartability

The benchmark runs data preparation, cache construction, each model's tuning,
training, validation, untouched-test scoring, SHAP explanation, and MLflow
logging as sequential low-priority subprocess stages. Each heavy process group
is limited to one native thread and monitored against a 1,600 MiB RSS ceiling.
Successful stages write digest-bound checkpoints and measured peak-RSS/elapsed
time evidence under `.stages/`; a retry reuses only matching completed stages.

Candidate evaluation uses partitioned Parquet caches so every model reads the
same materialized candidate join instead of repeatedly scanning the source
tables. Frozen Hugging Face/ONNX catalog embedding generation uses the pinned
ARM64 QInt8 artifact and exits before its LightGBM behavioral-ranker training
starts.

## Qualification result

The ten-seed, 50,000-journey qualification selected LightGBM as the learned
validation winner, but retained the deterministic blend for serving:

- LightGBM improved untouched-test expected incremental AOV by ₫3,272 on
  average (paired 95% interval: ₫1,368 to ₫5,347).
- NDCG@5 was 0.0298 lower than the deterministic blend.
- Eligibility, coverage, diversity, and three-to-four-item slate guardrails
  held.
- The promotion gate therefore returned `retain_baseline`.
- All 21 isolated stages stayed below the 1,600 MiB ceiling; the measured
  maximum was 974.2 MiB, and a completed qualification resumed in 2.32 seconds.

These are synthetic-world ranker-recovery results, not evidence of real KFC
conversion or AOV lift.

## Modifier Upsell qualification result

Modifier Upsell differs from product cross-sell:

- Deterministic eligibility admits only compatible, non-default,
  positive-price modifier actions. Free substitutions remain ordinary item
  configuration.
- The ranker returns one atomic `apply_modifier` action bound to the exact
  parent cart item and modifier path.
- Modifier-specific features include the parent item, modifier path and option,
  price delta, remaining budget, parent-option affinity, customer history, and
  store/global usage.
- The label is the exact modifier applied and retained through checkout; the
  score is calibrated success probability multiplied by price delta.
- Parent popularity, parent association, incremental value, and their blend
  replace product promotion and slate-diversity baselines.

The ten-seed, 50,000-journey qualification selected the modern Keras scorer as
the learned validation winner, but retained the deterministic incremental-value
baseline for serving:

- Learned untouched-test expected incremental AOV was ₫2,176 versus ₫2,132 for
  the baseline.
- The paired mean delta was only ₫44, with a 95% interval from −₫20 to ₫106;
  the required positive lower confidence bound was not met.
- NDCG@5 improved by 0.0069, every output remained one compatible action, and
  invalid modifier output stayed zero.
- No embedding ablation was claimed: all six fixture cold modifiers are
  zero-price substitutions and therefore outside proactive upsell eligibility.
- All 17 isolated stages stayed below the 1,600 MiB ceiling; the measured
  maximum was 938.2 MiB, and a completed qualification resumed in 2.43 seconds.

These are synthetic-world ranker-recovery results, not evidence of real KFC
conversion or AOV lift.
