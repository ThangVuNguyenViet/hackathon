# KFC recommendation simulator

Synthetic-only, versioned causal-world generator for the Automatic
Recommendation Engine. It is not evidence of compatibility with real KFC data.

The package writes Apache Parquet 2.6 artifacts with Zstandard level-3
compression, dictionary encoding, statistics, and Parquet data-page v2. The
exact Python 3.11.14, PyArrow 23.0.1, lock digest, writer settings, and every
immutable Arrow schema are bound into `manifests/synthetic-world.json`.
Identical inputs reproduce every Parquet and manifest byte.

Each world has four physically separate data surfaces:

```text
<world-revision>/
  source/{catalog,population,journeys}.parquet
  model-visible/training-examples.parquet
  evaluation/{opportunities,exposures,journeys,candidate-relevance}.parquet
  oracle/potential-outcomes.parquet
  traffic/{arrivals-per-minute,scorer-candidate-shapes}.parquet
  manifests/synthetic-world.json
  manifests/qualification-precommit.json
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

Benchmark and qualify all four learned rankers from an already generated world:

```shell
uv run --locked --no-dev kfc-recommendation-simulator qualify-models \
  --world ./build/synthetic-causal-world-v3 \
  --output ./build/model-qualification
```

The command benchmarks regularized logistic regression, LightGBM, and XGBoost
for both factual outcome heads of every recommendation type. It freezes the
selected champions, calibrators, feature encoders, thresholds, composer, and
configuration before evaluator-only untouched-test access. Exit code `0`
means every per-type and combined gate passed and one atomic four-model bundle
was emitted. Exit code `2` means explicit failed qualification; no serving
bundle or baseline substitute is emitted. Candidate-level singleton potential
value is physically isolated in `evaluation/candidate-relevance.parquet`. Its
versioned, manifest-bound expected retained VND responds to candidate
desirability, basket/context fit, promotion, fulfilment, and contextual price
burden. It defines graded relevance for honest full-set ideal DCG and paired
model/random/popularity NDCG intervals. Eligibility uses the automatic
reference path for every journey, including factual suppression, plus deduped
factual-state extensions so no observed exposure is lost.

The world generator owns a read-only qualification precommit whose SHA-256 is
bound by the world manifest before configuration selection. The dedicated
untouched loaders require that token, its world/source-contract binding, a
configuration created later, and a v2 frozen configuration binding all of
those digests. Evaluators cannot supply a token path or mint a new token after
selection. Oracle and candidate-relevance data are never used for training,
calibration, threshold selection, champion selection, or model-visible
ranking.

Training consumers call `load_training_table(world_root)`. That loader owns its
path and exact schema; it cannot be redirected to `evaluation/` or `oracle/`.
It verifies the manifest, artifact digest, exact model-visible schema, forbidden
fields, and permitted chronological splits before returning a table.
Unshown factual candidates keep null labels; evaluation values are not copied
onto the model-visible surface.

The generator emits stateful starter -> modifier -> Smart journeys. Starter
eligibility is exact: zero completed orders receives Local Favorite; positive
history receives For You. A modifier opportunity is attached only to the cart
line created by an accepted starter action, and Smart occurs after modifier
resolution against the resulting cart. Local Favorite, For You, and Modifier
Upsell render one action. Ordered Smart slates render three products by default
and a fourth only when requested and its positive score, new category, and
price keep the composed slate within the remaining budget. A one- or two-member
composition becomes a typed empty result with no slate. Automatic, random,
popularity, and active ablation conditions all rank first and then use this
same deterministic composer. Positions, exact joint slate/member propensities,
typed empty cases, and terminal outcomes are explicit.

Paired oracle rows cover automatic, no-recommendation, uniform random eligible,
popularity-descending, and each one-type ablation. Each condition owns its
actions, prices, removals, retention, checkout, and final order value. The
untouched window changes actual demand, preference, promotion, availability,
and catalog revision inputs. Traffic fixtures include the full qualification
profile, including 30 minutes at 50 RPS and 2 minutes at 100 RPS. Candidate
shapes include Local/For You 120 and 240, modifier 5/17/25, and Smart
insufficient/default/max/no-padding/120/240 cases. Fulfilment uses only `pickup`
and `delivery`.

For a clean locked reproduction:

```shell
UV_PROJECT_ENVIRONMENT=/tmp/kfc-simulator-clean \
  uv run --locked --no-dev kfc-recommendation-simulator generate \
  --profile smoke --output ./build
```

Replacing synthetic data with real data requires the canonical specification's
fresh audit and a newly qualified model bundle.
