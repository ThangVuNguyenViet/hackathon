# Task 4 blocker report — full-eligible-set ranking evidence

## Result

Task 4 is **not qualified**. The maintained Slice 4 implementation checkpoint is
`af60617c36fb5b4a14f48ee7273507f804946de7`
(`feat(recommendations): guard model qualification evidence`). A clean-source
development run on that exact commit returned `failed_qualification` with all
four per-type gates false. It emitted no `qualified-model-bundle` directory and
performed no partial promotion or runtime baseline substitution.

The 500,000-journey qualification profile was intentionally not run. The
development world proves that Task 3 lacks the evaluation-only candidate-level
relevance needed to identify the canonical NDCG gate. Spending the ten 50,000-
journey seeds would only reproduce an invalid metric. Task 4 must resume after a
sequential Task 3 data-contract repair.

This is synthetic-only evidence. It does not claim compatibility with real KFC
data and does not authorize real-customer exposure.

## Implemented checkpoint

- Added maintained NumPy/scikit-learn/LightGBM/XGBoost packaging with exact
  locked versions.
- Benchmarks real regularized logistic regression, LightGBM, and XGBoost on the
  same chronological model-visible splits for every recommendation type and
  both factual selection/joint-retention heads.
- Adds clipped inverse-propensity weights and effective-sample-size evidence,
  sigmoid/isotonic calibration selection, joint-probability bounds, frozen
  per-type abstention thresholds, and the accepted deterministic one-action /
  three-or-four Smart composer.
- Serializes logistic models as data-only coefficient JSON, LightGBM as native
  text, and XGBoost as native JSON, with exact library versions and golden
  predictions. No pickle artifact is permitted.
- Freezes champions, hyperparameters, seeds, feature encoders, calibrators,
  thresholds, split rules, and composer before evaluator-only untouched-test
  access. A deliberate tamper probe must be rejected and the exact
  configuration digest must still match after evaluation.
- Computes per-seed/slice calibration, coverage, invalid counters, outcome
  intervals, evaluator-only random/popularity/no-recommendation evidence, and
  paired business intervals. Oracle outcomes are used only for paired business
  evaluation, never for training or model-visible ranker evaluation.
- Emits an atomic four-model bundle only if every per-type and combined gate
  passes. Any failure returns exit code 2, writes explicit failed evidence, and
  emits no bundle.

## RED/GREEN evidence

1. Qualification-contract tests first failed because the qualification package
   did not exist. Frozen configuration/tamper rejection, clipped IPW/ESS,
   calibrator rules, joint bounds, composer cardinality, and atomic no-partial-
   promotion implementations made 8 tests green.
2. Native-artifact tests first failed because the feature encoder and model
   package did not exist. Explicit unknown categories and real native model
   round trips with golden predictions made 3 tests green.
3. Evaluator-boundary tests first failed because untouched evaluation had no
   freeze-gated loader. Digest-verified evaluator-only access made it green.
4. The smoke CLI test first failed because `qualify-models` did not exist. The
   end-to-end command now benchmarks all four types and three challenger
   families, freezes before test, proves tamper rejection, and fails atomically.
5. The first development evaluator incorrectly collapsed ranking groups to
   shown rows. The new guard test failed because no full-eligible-set ranking
   module existed; it now proves that one rendered action does not mean one
   eligible candidate and rejects missing candidate relevance rather than
   manufacturing NDCG.
6. The end-to-end smoke test then failed until its evidence reported
   `insufficient_evidence`, full/shown/unlabelled candidate counts, the Task 3
   repair contract, and no ranking intervals derived from incomplete labels.

## Development failed qualification

Commands:

```text
uv run --locked --no-dev kfc-recommendation-simulator generate \
  --profile development \
  --output /tmp/kfc-task4-development.phWQLb/worlds \
  --world-revision synthetic-causal-world-v3

uv run --locked --no-dev kfc-recommendation-simulator qualify-models \
  --world /tmp/kfc-task4-development.phWQLb/worlds/synthetic-causal-world-v3 \
  --output /tmp/kfc-task4-development.phWQLb/model-qualification-af60617c
```

- Profile: 20,000 journeys per seed, seeds `101`, `211`, `307`, 60,000 total.
- Generation: 44.87 seconds wall time; 2,173,075,456-byte maximum RSS; zero
  swaps.
- Clean-source qualification: 7.19 seconds wall time; 778,665,984-byte maximum
  RSS; zero swaps; exit code 2.
- Source binding: `af60617c36fb5b4a14f48ee7273507f804946de7`, tracked
  tree clean at run start.
- Champions selected without untouched-test access: Local Favorite LightGBM,
  For You logistic regression, Modifier Upsell XGBoost, Smart Cross-sell
  LightGBM.
- World validity passed and the combined paired business gate passed. Every
  per-type gate failed because canonical ranking evidence is insufficient;
  calibration failures remain reported separately in the retained artifact.
- Atomic bundle emitted: false.

Full eligible versus shown/unlabelled untouched-test candidate rows:

| Recommendation type | Eligible | Shown | Unlabelled eligible |
|---|---:|---:|---:|
| Local Favorite | 6,122 | 1,539 | 4,583 |
| For You | 19,340 | 4,862 | 14,478 |
| Modifier Upsell | 12,290 | 2,458 | 9,832 |
| Smart Cross-sell | 19,364 | 7,383 | 11,981 |

The retained machine evidence contains every challenger/head metric,
calibrator, hyperparameter, ESS, threshold candidate, per-seed/slice metric,
invalid counter, baseline, business interval, environment version, artifact
digest, and explicit failure reason.

## Required Task 3 repair

Add a physically separate **evaluation-only** surface containing per-candidate
relevance or potential-outcome evidence for every eligible candidate at each
opportunity, sufficient to compute ideal DCG for the full candidate set and
paired NDCG@K confidence intervals against random and popularity. It must:

- never appear in `model-visible/training-examples.parquet`;
- remain inaccessible through `load_training_table` and all model,
  calibrator, threshold, feature, and champion selection paths;
- bind journey, opportunity, recommendation type, candidate identity, and the
  evaluation outcome definition without latent/semantic leakage; and
- preserve null labels for unshown candidates on the factual model-visible
  surface.

Task 4 must re-run smoke, development, and then all ten qualification seeds only
after that repaired evaluation contract passes leakage and full-set NDCG tests.
No gate may be weakened and oracle fields may not be moved into training or the
model-visible evaluator.

## Retained proof and digests

- `task-4-development-failed-qualification.json`:
  `c58a5c1deafb77b15b4cf45d730214a10adc50f3c34a8f8065906056c57ff885`
- `task-4-development-qualification-status.json`:
  `459260500dbbc38b9905b1d7f592efbed8cfa357b556ec6cb2d7e59565750f44`
- `task-4-development-selected-configuration.json`:
  `573206c1aebd7550edb6ce2b659b4138fcf12ce1bdc1492763ecd7d209aa2929`
- `task-4-development-frozen-configuration.json`:
  `5f4b335048b5c30efdca83a8306d48c37f67ccec6a5f55bf59885d83e995ac6e`
- World digest:
  `3ea86f44d59a5a02a509990b594ba0611aac6c124a0d0304bc3a34c5e456a23b`
- Model-visible dataset artifact:
  `b68ae923d2c33e569344c9f614601eea2e09ace37cbc0443d08652f63d8bca17`
- Canonical wire digest:
  `30fb774b804b4868abd78e30e489aa9fe835d3b959b38ae389c127949ac8e678`
- Feature contract digest:
  `35b710d0b73e7419038e83bc9c39f93feb38564d793726cd47021fa2dbc8421b`
- Composer contract digest:
  `16adfe83b611495758df995693781264b61f12d54c698da9ab52c895b64d7e49`

## GREEN gates on the implementation checkpoint

- `uv run ruff check .` — PASS.
- `uv run python -m compileall -q src tests` — PASS.
- `uv run python -m unittest discover -s tests -v` — PASS: 38 simulator
  tests.
- `PYTHONPATH=src python3 -m compileall -q src tests` in the scorer — PASS.
- `PYTHONPATH=src python3 -m unittest discover -s tests -v` in the scorer —
  PASS: 9 tests.
- `npm run check:automatic-recommendation-authority` — PASS: 5 tests.
- `git diff --check` — PASS.

The ledger and the two unrelated untracked reports were not edited.
