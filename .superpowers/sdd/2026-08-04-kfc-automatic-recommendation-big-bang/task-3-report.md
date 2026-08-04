# Task 3 report — Build the synthetic causal world

## Result

Completed Slice 3 in implementation checkpoint
`201857a21b8462b42e1e1e2192dc683e43787084`
(`feat(recommendations): build synthetic causal world`).

The isolated `services/kfc-recommendation-simulator` Python package generates a
removable, synthetic-only causal world as real Apache Parquet 2.6 artifacts.
Its locked `uv` environment uses maintained PyArrow packaging; no fake Parquet
encoding or follow-up workaround was required.

No model was trained, no serving runtime was added, and no claim of real KFC
data compatibility is made.

## World and authority boundaries

- Physical `source/`, `model-visible/`, `evaluation/`, and `oracle/` surfaces
  use exact immutable Arrow schemas. `traffic/` separately exports
  arrivals-per-minute and strict scorer candidate-shape fixtures.
- The digest-rich manifest binds generator revision, exact profile, named
  stream seeds, stream overrides, physical-surface declarations, chronological
  split policy, condition and fulfilment vocabularies, exposure policy,
  quality counters, every artifact digest/schema/row count, and the complete
  manifest configuration through one world digest.
- Independent deterministic streams cover catalog, population, traffic,
  behavior, logging policy, outcomes, and splits. Changing only the outcome
  stream preserves source and traffic bytes while changing oracle outcomes.
- The training loader owns the exact model-visible path. It validates the
  world digest, exact schema, forbidden-field set, artifact digest, and allowed
  training/calibration/validation splits. It accepts neither an arbitrary
  artifact path nor evaluation/oracle fields.
- A fresh-process deliberate-leakage test injects an oracle field into the
  physical model-visible Parquet artifact and proves the loader fails closed.

## Causal world

- Whole journeys split chronologically into training, calibration, validation,
  and untouched test windows. Untouched rows contain held-out stores, cold
  customers, cold candidates, drift, lunch, dinner, and rush slices.
- The world covers Local Favorite, For You, Modifier Upsell, and Smart
  Cross-sell. Starter placement produces at most one Local Favorite or For You
  opportunity per journey. Exact API empty reasons represent missing
  prerequisites or no eligible candidates.
- Stochastic-popularity, basket-association, promotion-biased, and randomized
  exploration logging policies retain 20% exploration. Every shown candidate
  records a known positive propensity and rendered position; eligible unshown
  candidates have null labels rather than negative labels.
- Evaluation records impression/selection/dismissal, cart mutation, accepted
  item removal, checkout/abandonment, and final merchandise subtotal. Every
  journey has a declared terminal state.
- Oracle rows contain latent affinity and paired potential outcomes for
  automatic, no-recommendation, random-eligible, popularity, and all four
  one-type ablations. Empty opportunities cannot have impossible potential
  selections.
- Generated candidate-shape fixtures parse through the accepted strict Python
  `kfc-automatic-scorer-v1` contract for all four recommendation types. The
  only fulfilment values are the API vocabulary `pickup` and `delivery`.

## Profiles and operational proof

Profiles are exact per seed:

| Profile | Journeys per seed | Seeds | Total journeys |
|---|---:|---:|---:|
| Smoke | 2,000 | 1 | 2,000 |
| Development | 20,000 | 3 | 60,000 |
| Qualification | 50,000 | 10 | 500,000 |

The final-code qualification generation completed successfully:

- 500,000 physical source journeys;
- 1,568,059 model-visible candidate rows;
- 1,367,459 rows returned by the training loader after untouched-test removal;
- 4,000,000 paired oracle rows;
- every invalid counter equal to zero;
- world digest
  `01c7e408b9eab7e6d1ad39cb9aec65304cd8e2fb1a1cb63d64e1013eb2001c6d`;
- 39.59 seconds wall time and 1,525,153,792-byte maximum resident set on the
  local proof machine.

The generator writes one deterministic row group per seed, bounding memory
instead of retaining all ten qualification seeds at once.

## RED evidence

1. The profile test failed because `kfc_recommendation_simulator` did not
   exist. The minimal immutable profile definitions made it green.
2. The world suite failed because the generator, loader, and validation modules
   did not exist. The first real Parquet implementation made ten boundary and
   causal tests green.
3. The exposure-evidence test failed with missing `renderedPosition`; the
   evaluation schema now records position and shown-action propensity and the
   manifest binds the positive-support exposure policy.
4. The empty-opportunity oracle test found 570 impossible potential selections;
   potential selection now requires an eligible candidate.
5. The manifest-binding test showed the world digest covered artifacts but not
   generation configuration; it now binds the complete manifest except its own
   digest field.
6. The manifest-tamper test showed the training loader accepted a changed
   profile name; it now recomputes and rejects a mismatched world digest before
   loading training data.

## GREEN evidence

- `uv run ruff check .`
  - PASS.
- `uv run python -m compileall -q src tests`
  - PASS.
- `uv run python -m unittest discover -s tests -v`
  - PASS: 15 simulator tests.
- `PYTHONPATH=src python3 -m compileall -q src tests`
  - PASS in `services/kfc-recommendation-scorer`.
- `PYTHONPATH=src python3 -m unittest discover -s tests -v`
  - PASS: 9 accepted Python scorer/contract tests.
- `npm run check:automatic-recommendation-authority`
  - PASS: 1 file, 5 deterministic authority tests.
- `git diff --check`
  - PASS.

## Files

- `services/kfc-recommendation-simulator/{pyproject.toml,uv.lock,README.md}`
- `services/kfc-recommendation-simulator/src/kfc_recommendation_simulator/`
- `services/kfc-recommendation-simulator/tests/`

## Self-review

- Public artifacts and manifests regenerate byte-identically from identical
  inputs under the locked environment.
- Model-visible rows contain only fixed scorer features, exposure evidence, and
  permitted factual labels. Condition assignments, terminal outcomes, latent
  preferences, and potential outcomes remain physically separate.
- Random/popularity outputs are offline causal baselines only and expose no
  runtime recommendation authority.
- The two unrelated untracked audit reports were preserved and excluded from
  both checkpoints. Generated Python caches and temporary proof worlds were
  removed before commit.
