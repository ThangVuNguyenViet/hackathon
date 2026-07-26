# KFC recommendation behavioral-world prototype

> THROWAWAY LOGIC PROTOTYPE — this package tests whether a sequential synthetic
> ordering world can produce reproducible, model-visible recommendation events
> and physically separate counterfactual truth. It is not the production
> recommendation service.

The original Streamlit inspection shell was retired after review. This package
now contains the pure Python generator/auditor and the Smart Cross-sell ranker
benchmark. MLflow provides the local technical inspection surface.

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
   ranker can beat deterministic baselines on untouched journeys?

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
TF_USE_LEGACY_KERAS=1 uv run kfc-rec-sim benchmark \
  --profile smoke \
  --output ../../.artifacts/kfc-recommendation-simulator/smart-cross-sell-smoke
```

Run the held-out qualification benchmark (ten independent 50,000-journey
seeds):

```bash
TF_USE_LEGACY_KERAS=1 uv run kfc-rec-sim benchmark \
  --profile qualification \
  --output ../../.artifacts/kfc-recommendation-simulator/smart-cross-sell-qualification
```

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
blended deterministic baselines with LightGBM, XGBoost, compact TensorFlow
Recommenders, and a pinned multilingual-embedding LightGBM ablation. It writes:

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
