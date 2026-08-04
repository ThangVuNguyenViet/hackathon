# Task 4 report — four-family model qualification

## Result

Task 4 is **not qualified**. The clean-source implementation checkpoint is
`00f9eda65f1f443ca82f01f048f3c8da071b6ea4`
(`feat(recommendations): qualify four model families`). The fixed 60,000-
journey, three-seed development run returned `failed_qualification`. It emitted
no `qualified-model-bundle`, made no partial promotion, and substituted no
runtime baseline.

The 500,000-journey ten-seed qualification run was intentionally not launched.
The task contract permits that expensive untouched qualification only if the
fixed development run passes. It did not. No threshold, calibration gate,
coverage gate, ranking gate, model family, or composer rule was weakened or
retuned after observing smoke or development evidence.

This is synthetic-only evidence. It does not claim compatibility with real KFC
data and does not authorize real-customer exposure.

## Implemented checkpoint

- Benchmarks four real maintained families for each of the four recommendation
  types and both factual heads: regularized logistic regression, LightGBM,
  XGBoost, and a compact scikit-learn MLP.
- Uses the same chronological training/calibration/validation surfaces, clipped
  inverse-propensity weights, effective-sample-size evidence, calibration,
  joint-probability bounds, champion rules, thresholds, feature encoder, and
  exact shared deterministic composer for every challenger.
- Serializes logistic coefficients and compact MLP weights/intercepts as
  data-only JSON, LightGBM as native text, and XGBoost as native JSON. Every
  champion head carries native-artifact digests and golden predictions; pickle
  is not used.
- Consumes the world-owned immutable qualification precommit before a selected
  configuration exists. Training, calibration, threshold selection, and
  champion selection receive only the model-visible table. The v5 candidate
  relevance loader is called only after the exact selected configuration is
  written and frozen.
- Verifies exact candidate-set parity between model-visible untouched rows and
  `evaluation/candidate-relevance.parquet`, one immutable relevance definition,
  and post-freeze artifact/schema digests before computing evaluation metrics.
- Computes paired full-set NDCG@K and Recall@K for model, deterministic random,
  and popularity orderings. The ranker score remains calibrated joint
  probability times valid price impact with Unicode identity tie-break.
- Preserves the fixed gates: zero invalid/cardinality/padding violations, at
  least 95% of the better baseline coverage, both Brier scores no worse than
  null, ECE at most 0.05, paired NDCG lower 95% above both baselines, per-type
  business non-harm, and positive combined business lower bounds.
- Emits a serving bundle only when all four per-type gates and the combined
  business gate pass atomically.

## TDD evidence

1. The native artifact test first failed with `unsupported model family: mlp`.
   A real `MLPClassifier`, data-only native JSON representation, independent
   NumPy inference loader, and golden-prediction round trip made it green.
2. The end-to-end smoke test then failed because qualification exposed only the
   three earlier challenger families. It also required evaluated post-freeze
   relevance evidence instead of the earlier `insufficient_evidence` blocker.
3. Adding the fourth challenger to the fixed configuration and opening the v5
   relevance surface only after freeze made the end-to-end test green. Exact
   candidate parity, paired NDCG intervals, Recall@K, and atomic failure
   behavior are asserted.
4. The simulator deterministic suite passed 57 tests and Ruff passed on the
   clean implementation checkpoint.

## Fixed smoke run

Commands:

```text
uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator generate --profile smoke \
  --output /tmp/kfc-task4-v5-00f9eda6/smoke-worlds \
  --world-revision synthetic-causal-world-v5-task4-smoke

uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator qualify-models \
  --world /tmp/kfc-task4-v5-00f9eda6/smoke-worlds/synthetic-causal-world-v5-task4-smoke \
  --output /tmp/kfc-task4-v5-00f9eda6/smoke-qualification
```

- Profile: 2,000 journeys, seed `101`.
- Generation: 1.67 seconds wall time, 347,308,032-byte maximum RSS, zero
  swaps.
- Qualification: 1.47 seconds wall time, 232,374,272-byte maximum RSS, zero
  swaps.
- Source binding: clean tracked tree at `00f9eda65f1f443ca82f01f048f3c8da071b6ea4`.
- World validity and combined business passed. All four ranking gates passed.
- All four calibration gates failed at smoke support; Smart Cross-sell also
  failed slice coverage. Status was `failed_qualification`; bundle emitted was
  false.

## Fixed development run

Commands:

```text
uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator generate --profile development \
  --output /tmp/kfc-task4-v5-00f9eda6/development-worlds \
  --world-revision synthetic-causal-world-v5-task4-development

uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator qualify-models \
  --world /tmp/kfc-task4-v5-00f9eda6/development-worlds/synthetic-causal-world-v5-task4-development \
  --output /tmp/kfc-task4-v5-00f9eda6/development-qualification
```

- Profile: 20,000 journeys per seed, seeds `101`, `211`, `307`, 60,000 total.
- Generation: 43.54 seconds wall time, 2,685,796,352-byte maximum RSS, zero
  swaps.
- Qualification: 8.99 seconds wall time, 1,159,938,048-byte maximum RSS, zero
  swaps.
- Source binding: clean tracked tree at `00f9eda65f1f443ca82f01f048f3c8da071b6ea4`.
- World validity passed, all invalid counters were exactly zero, every per-type
  business non-harm gate passed, and the combined business gate passed.
- Configuration precommit, pre-test freeze verification, deliberate tamper
  rejection, post-test freeze verification, and post-freeze-only relevance
  opening all passed.
- Atomic bundle emitted: false.

### Champions and fixed gate results

| Type | Champion | Calibration | Ranking | Slice coverage/validity | Business | Type gate |
|---|---|---:|---:|---:|---:|---:|
| Local Favorite | LightGBM | fail | pass | pass | pass | fail |
| For You | LightGBM | fail | pass | pass | pass | fail |
| Modifier Upsell | compact MLP | fail | pass | pass | pass | fail |
| Smart Cross-sell | XGBoost | fail | pass | fail | pass | fail |

Candidate relevance covered every eligible row exactly:

| Type | Eligible rows | Shown factual rows | Relevance rows |
|---|---:|---:|---:|
| Local Favorite | 8,212 | 1,544 | 8,212 |
| For You | 25,714 | 4,794 | 25,714 |
| Modifier Upsell | 24,580 | 2,536 | 24,580 |
| Smart Cross-sell | 20,774 | 6,822 | 20,774 |

The evaluation definition was `candidate-singleton-value-v2`, digest
`61e5aed6ab9654984ecde0beea0ee1747a2af80fd08a102b3370f464e59b3e92`,
with intervention `render_only_this_eligible_candidate`. It was not used for
model, calibrator, threshold, or champion selection.

Paired NDCG lower 95% bounds were all strictly positive:

| Type | Model vs random | Model vs popularity |
|---|---:|---:|
| Local Favorite | 0.141254 | 0.228942 |
| For You | 0.151272 | 0.228001 |
| Modifier Upsell | 0.282989 | 0.273141 |
| Smart Cross-sell | 0.039283 | 0.046557 |

### Honest failure diagnosis

The development failure is a model-calibration and composer-coverage result,
not missing ranking evidence:

| Type/head | Brier | Null Brier | ECE | Failed condition |
|---|---:|---:|---:|---|
| Local Favorite selection | 0.253734 | 0.248971 | 0.070231 | Brier and ECE |
| Local Favorite joint | 0.226042 | 0.222849 | 0.056326 | Brier and ECE |
| For You selection | 0.253369 | 0.249989 | 0.056102 | Brier and ECE |
| For You joint | 0.214208 | 0.213394 | 0.028886 | Brier |
| Modifier Upsell selection | 0.251251 | 0.249993 | 0.035206 | Brier |
| Modifier Upsell joint | 0.217249 | 0.216312 | 0.029799 | Brier |
| Smart Cross-sell selection | 0.131218 | 0.131150 | 0.008213 | Brier |
| Smart Cross-sell joint | 0.082299 | 0.082302 | 0.003334 | pass |

Smart Cross-sell additionally missed the fixed 95%-of-better-baseline coverage
gate in 11 evaluated slices for seed `211` and 11 for seed `307`. For example,
seed `211` all-slice model coverage was 0.354731 versus required 0.369425;
seed `307` was 0.353926 versus required 0.360979. Its zero threshold does not
force invalid or padded slates: the exact composer still abstains when the
three-or-four-item diversity/budget contract cannot be met.

The combined automatic-vs-no-recommendation evidence remained positive:
AOV lower 95% `26,177.75 VND`, revenue per started journey lower 95%
`20,520.97 VND`, checkout conversion lower 95% `+0.09791`, and abandonment
upper 95% `-0.09791`. Those business results cannot override failed per-type
model gates.

A scientifically valid next attempt requires a new predeclared experiment on a
new development world, with a training-only reason for changing calibration or
composer behavior. It must not tune gates or configuration against this
observed development result, and it still must pass development before the
ten-seed qualification is authorized.

## Retained evidence and digests

- Development failed qualification:
  `d5dc231201b87799aec0de1ca6158c4b0fb3ec795b12a7dd64edcb344f8492a3`
- Development status:
  `633f44079679883fa62fc86ff56c1bc84c8f024b7b2aa4ae73ac57f7ef435675`
- Development selected configuration:
  `1b8d83d3ebab143ef0fbedb7d4715dd4722736ec74d9e51a561a45bbc417fcb7`
- Development frozen configuration:
  `7b9372fac3077363ae2cd8b2473f614099f5fccf87944b429e1ddebe0f7b56a2`
- Smoke failed qualification:
  `41adeafa3c17baed58a8a3c5dc9491a9010d0e0a29c26e0feb3623c077f5f2a7`
- Smoke status:
  `e7d803b7f5d4a1742f0ee5f248872601b4e76705c83bc611f282e39b9f2e5929`
- Smoke selected configuration:
  `de29f3a0b6379f5917e6227149964f2914b774a1cf728fa30d6019a92a63e330`
- Smoke frozen configuration:
  `34d6c68352c6e92f93cc0c9bcc1f646655393da79d0c0f10266fa1068ab35371`
- Development world digest:
  `c8252efef9107f692eb377e72dc1ff3802c277de3ebb53f33470c0677976e181`
- Development model-visible artifact:
  `eca35e4154b418a4bcde88415b8235489d2a5164d5916a21ddbf243dcc185385`
- Development candidate-relevance artifact:
  `8976f15bf70ee4cb0f444b299aaf9478da3490d36b78bdca0a2021943677fd2c`

The ledger and the two unrelated untracked reports were not edited.
