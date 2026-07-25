# KFC recommendation behavioral-world prototype

> THROWAWAY LOGIC PROTOTYPE — this package tests whether a sequential synthetic
> ordering world can produce reproducible, model-visible recommendation events
> and physically separate counterfactual truth. It is not the production
> recommendation service.

The original Streamlit inspection shell was retired after review. The surviving
prototype is the pure Python generator and auditor; MLflow is the planned
technical inspection surface for later model benchmarks.

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
   features?

## Run

```bash
cd services/kfc-recommendation-simulator
uv sync
uv run kfc-rec-sim generate --preset smoke
uv run kfc-rec-sim audit ../../.artifacts/kfc-recommendation-simulator/smoke
uv run python -m unittest discover -s tests -v
```

One benchmark seed contains 50,000 journeys and writes incrementally:

```bash
uv run kfc-rec-sim generate --preset benchmark
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
