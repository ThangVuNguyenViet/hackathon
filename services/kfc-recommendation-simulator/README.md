# KFC recommendation simulator

Synthetic-only, versioned causal-world generator for the Automatic
Recommendation Engine. It is not evidence of compatibility with real KFC data.

The package writes real Apache Parquet 2.6 artifacts with no compression or
dictionary encoding. The encoding choice and every immutable Arrow schema are
bound into `manifests/synthetic-world.json` by SHA-256 digests. Identical
inputs reproduce every Parquet and manifest byte.

Each world has four physically separate data surfaces:

```text
<world-revision>/
  source/{catalog,population,journeys}.parquet
  model-visible/training-examples.parquet
  evaluation/{opportunities,journeys}.parquet
  oracle/potential-outcomes.parquet
  traffic/{arrivals-per-minute,scorer-candidate-shapes}.parquet
  manifests/synthetic-world.json
```

The smoke profile produces 2,000 journeys for one seed, development produces
20,000 per seed for three seeds, and qualification produces 50,000 per seed
for ten seeds. Generate the smoke profile:

```shell
uv run kfc-recommendation-simulator generate --profile smoke --output ./build
```

Run deterministic package checks:

```shell
uv run ruff check .
uv run python -m compileall -q src tests
uv run python -m unittest discover -s tests -v
```

Training consumers call `load_training_table(world_root)`. That loader owns its
path and exact schema; it cannot be redirected to `evaluation/` or `oracle/`.
It verifies the manifest, artifact digest, exact model-visible schema, forbidden
fields, and permitted chronological splits before returning a table.

The generator includes held-out-store, cold-customer, cold-candidate, drift,
lunch, dinner, and rush slices. Paired oracle rows cover automatic,
no-recommendation, random-eligible, popularity, and each one-type ablation.
Random and popularity conditions are offline baselines only. Candidate-shape
fixtures conform to `kfc-automatic-scorer-v1`, and fulfilment uses only the API
vocabulary `pickup` and `delivery`.

Replacing synthetic data with real data requires the canonical specification's
fresh audit and a newly qualified model bundle.
