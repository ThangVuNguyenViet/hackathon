# Task 4 report — repaired four-family model qualification

## Result

Task 4 is **not qualified**. The review-repaired implementation is bound to the
clean tracked source SHA `a12f37ee48b9d6101bb1660fbfb4b6c3bf125372`.
Fresh smoke and fixed 60,000-journey/three-seed development runs both stopped at
`failed_selection`. No family/threshold candidate passed every fixed pre-freeze
validation gate for every recommendation type.

The pipeline therefore selected no fallback champion, wrote and froze no selected
configuration, opened neither the untouched test surface nor candidate relevance,
and emitted no serving bundle. The 500,000-journey/ten-seed qualification was not
authorized and was not run. No gate, threshold grid, composer rule, or model family
was weakened or retuned after observing either run.

This is synthetic-only evidence. It does not claim compatibility with real KFC data
and does not authorize real-customer exposure.

## Independent-review repair

The earlier Task 4 evidence retained by commit `fcab6e79` is superseded and is not
admissible qualification evidence. Review found that it selected families by
validation Brier before exact-composer business evaluation, reported business
effects from an oracle automatic policy rather than the learned frozen policy, and
could copy `servingBundleEmitted=false` evidence before mutating the external copy.

The repair in `b975ffd3` and domain split in `a12f37ee` now:

- evaluates all four maintained families at every one of nine thresholds through
  the exact composer before freeze;
- requires calibration, coverage, ranking, business, and validity gates before a
  candidate is selection-eligible, then applies the declared lexicographic
  business/ranking/artifact order;
- computes business outcomes from composed learned decisions and immutable
  candidate potential outcomes, paired against no-recommendation, random,
  popularity, and per-type ablation policies;
- uses clipped IPW, effective sample size on training/calibration/validation and
  policy evaluation surfaces, and journey-clustered weighted uncertainty;
- records actual per-slice validity counters; and
- finalizes `servingBundleEmitted=true` before copying byte-identical, digest-bound,
  read-only success evidence into an atomic all-pass bundle.

Qualification code is split by domain: `pipeline.py` is 746 lines,
`evaluation.py` 518, `business.py` 266, and `configuration.py` 248. No domain file
exceeds the 900-line ceiling.

## TDD and deterministic verification

The repair was developed through failing tests for gate-first selection,
learned-policy business effects, exact-composer validation, immutable consistent
bundle finalization, read-only success evidence, and explicit failed-selection
behavior. The repaired deterministic simulator suite passed all 67 tests. Ruff and
Python bytecode compilation passed after the domain split.

## Fresh smoke run

```text
uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator generate --profile smoke \
  --output /tmp/kfc-task4-review-repair-a12f37ee/smoke-worlds \
  --world-revision synthetic-causal-world-v5-task4-review-repair-smoke

uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator qualify-models \
  --world /tmp/kfc-task4-review-repair-a12f37ee/smoke-worlds/synthetic-causal-world-v5-task4-review-repair-smoke \
  --output /tmp/kfc-task4-review-repair-a12f37ee/smoke-qualification
```

- Profile: 2,000 journeys, seed `101`.
- Generation: 1.70 seconds wall time, 341,704,704-byte maximum RSS, zero swaps.
- Qualification: 1.69 seconds wall time, 207,716,352-byte maximum RSS, zero swaps.
- Every type evaluated four families by nine thresholds; zero candidates passed all
  validation gates.
- Status: `failed_selection`; `servingBundleEmitted=false`; bundle path absent.

## Fixed development run

```text
uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator generate --profile development \
  --output /tmp/kfc-task4-review-repair-a12f37ee/development-worlds \
  --world-revision synthetic-causal-world-v5-task4-review-repair-development

uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator qualify-models \
  --world /tmp/kfc-task4-review-repair-a12f37ee/development-worlds/synthetic-causal-world-v5-task4-review-repair-development \
  --output /tmp/kfc-task4-review-repair-a12f37ee/development-qualification
```

- Profile: 20,000 journeys per seed; seeds `101`, `211`, `307`; 60,000 total.
- Qualification: 16.32 seconds wall time, 947,716,096-byte maximum RSS, zero swaps.
- Source binding: clean tracked tree at
  `a12f37ee48b9d6101bb1660fbfb4b6c3bf125372`.
- World digest: `ede8b659eaffbb95d29c9693ac5a79f73fd1197303e0f258f2cd6a01059e764b`.
- World precommit was verified before selection.
- Status: `failed_selection`; `servingBundleEmitted=false`; bundle path absent.
- Selected/frozen configuration: absent by design.
- `untouchedTestOpened=false`, `candidateRelevanceOpened=false`, and each type
  records zero untouched-test rows observed during selection.

### Validation selection evidence

Each table cell is the number of thresholds, out of nine, that passed that gate.
`All` is the number passing all five gates.

| Type | Family | Cal | Coverage | Ranking | Business | Validity | All |
|---|---|---:|---:|---:|---:|---:|---:|
| For You | LightGBM | 0 | 9 | 9 | 9 | 9 | 0 |
| For You | Logistic | 0 | 9 | 9 | 9 | 9 | 0 |
| For You | MLP | 0 | 9 | 9 | 9 | 9 | 0 |
| For You | XGBoost | 0 | 9 | 9 | 9 | 9 | 0 |
| Local Favorite | LightGBM | 0 | 9 | 9 | 9 | 9 | 0 |
| Local Favorite | Logistic | 0 | 9 | 9 | 9 | 9 | 0 |
| Local Favorite | MLP | 0 | 9 | 0 | 9 | 9 | 0 |
| Local Favorite | XGBoost | 0 | 9 | 9 | 9 | 9 | 0 |
| Modifier Upsell | LightGBM | 0 | 9 | 9 | 9 | 9 | 0 |
| Modifier Upsell | Logistic | 0 | 9 | 0 | 9 | 9 | 0 |
| Modifier Upsell | MLP | 0 | 9 | 9 | 9 | 9 | 0 |
| Modifier Upsell | XGBoost | 0 | 9 | 0 | 9 | 9 | 0 |
| Smart Cross-sell | LightGBM | 0 | 0 | 0 | 6 | 9 | 0 |
| Smart Cross-sell | Logistic | 0 | 0 | 0 | 6 | 9 | 0 |
| Smart Cross-sell | MLP | 0 | 0 | 0 | 6 | 9 | 0 |
| Smart Cross-sell | XGBoost | 0 | 0 | 0 | 6 | 9 | 0 |

Calibration is the universal blocker. For example, at threshold `0.05`, For You
Logistic had selection Brier `0.249431` versus null `0.249326` and joint Brier
`0.207185` versus null `0.207108`; Smart Cross-sell XGBoost had selection Brier
`0.122018` versus null `0.121955` and joint Brier `0.076252` versus null
`0.076130`. A candidate must beat or match null on both calibrated heads.

The exact-composer validation evaluation also produced honest support evidence. At
threshold `0.05`, weighted ESS and composer opportunity counts were:

| Type | Weighted ESS | Composer opportunities |
|---|---:|---:|
| For You | 2,028.23 | 4,245 |
| Local Favorite | 693.12 | 1,440 |
| Modifier Upsell | 886.92 | 2,530 |
| Smart Cross-sell | 3,398.89 | 5,315 |

All reported validity counters were computed from actual decisions. They were zero
for eligibility, composer cardinality, joint-above-selection probability, modifier,
and padding violations across every family/threshold candidate. These facts do not
override calibration, coverage, ranking, or business failures.

## Retained evidence

- Development failed-selection evidence SHA-256:
  `6825678b94fa2a69f874741963a5ac1259458c3dc3f24835675299ecb8524128`.
- Development status SHA-256:
  `a7c37247cd23baf23b7d19f0b5c3904b1e3f39654ed2dd4c943fe1853ac01c04`.
- Smoke failed-selection evidence SHA-256:
  `113f0f37f603f285e9cc10ed9287bc5bea80c3be5a9d39fd03897bee0f9dfdba`.
- Smoke status SHA-256:
  `73aa5dca68075b903b3a1c0cb756c1637ea3aa22b774dbeac616730bf1931051`.

The superseded selected/frozen configuration artifacts were removed because the
repaired gate-first runs correctly produced none; they remain recoverable in Git
history. The ledger and the two unrelated untracked reports were not edited.
