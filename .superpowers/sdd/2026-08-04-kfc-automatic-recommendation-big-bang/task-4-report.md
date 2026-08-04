# Task 4 report — repaired four-family model qualification

## Result

Task 4 is **not qualified**. The current implementation and fresh fixed
60,000-journey/three-seed development evidence are bound to clean tracked source
SHA `6c27aabc99c0cb190161560394b3a35e12f24200`. The run stopped at
`failed_selection`: no family/threshold candidate passed every fixed pre-freeze
validation gate for every recommendation type.

The pipeline selected no fallback champion, wrote and froze no selected
configuration, opened no untouched test or untouched candidate-relevance rows, and
emitted no serving bundle. The 500,000-journey/ten-seed qualification was therefore
not authorized and was not run. No gate, threshold grid, composer rule, model
family, or margin was weakened or retuned after observing evidence.

This is synthetic-only evidence. It does not claim compatibility with real KFC data
and does not authorize real-customer exposure.

## Review repairs

The earlier Task 4 evidence retained by `fcab6e79` is superseded and inadmissible.
The first independent review found proxy-oracle business effects, Brier-first family
selection, and inconsistent copied success evidence. Those defects were repaired in
`b975ffd3`; domain code was split below the 900-line ceiling in `a12f37ee`; repaired
evidence was retained in `5663d822`.

The second review found two remaining P1 defects. Commit `6c27aabc` repairs them:

- Validation AOV is now one true order/journey outcome. The regression probe with a
  `100` base cart and retained `10` plus `20` across two opportunities yields AOV
  `130`, not two pseudo-checkouts averaging `115`.
- Every family/threshold's validation business gate now composes its learned
  decisions, joins immutable validation candidate potentials, and compares paired
  journey outcomes against the no-recommendation baseline. Conversion,
  abandonment, revenue-per-started-journey, and AOV margins use the unchanged
  declared gates.
- Lexicographic family/threshold selection now orders only validation-eligible
  candidates by paired learned-minus-no-recommendation revenue and AOV lower bounds,
  then paired ranking, artifact size, and family identity. Absolute candidate value
  is not a business-selection surrogate.
- The validation policy loader is manifest/digest/schema checked and reads only the
  validation split plus validation journey IDs. Untouched potential outcomes remain
  behind the frozen-configuration boundary.
- Untouched NDCG, paired model-versus-random/popularity bounds, and Recall@K now use
  journey-clustered uncertainty. Correlated opportunities from one journey no longer
  inflate independent-row support.

The broader repaired contracts remain in force: all four maintained model families
and all nine thresholds run through the exact composer before freeze; all five
validation gates must pass; clipped IPW and split ESS are retained; actual validity
counters are recorded; and an all-pass bundle finalizes byte-identical immutable
evidence before atomic emission.

Qualification domain sizes are `pipeline.py` 767 lines, `validation.py` 409,
`evaluation.py` 545, `business.py` 272, `datasets.py` 137, and `selection.py` 63.
The repository-wide 900-line architecture check passes.

## TDD and deterministic verification

The second repair followed four explicit RED/GREEN cycles:

1. True journey AOV: RED returned `115`; GREEN returned the literal expected `130`.
2. Paired business: RED lacked validation baseline/candidate-potential inputs; GREEN
   made harmful learned potentials produce conversion `-1`, abandonment `+1`, and a
   failed business gate despite positive factual labels.
3. Selection ordering: RED lacked a paired-effect candidate builder; GREEN sourced
   revenue/AOV lower bounds from `businessComparisonVsNoRecommendation` and ignored
   absolute-value distractors.
4. Clustered ranking: RED lacked journey-clustered ranking evidence; GREEN produced
   two clusters and lower 95% `-1.959963984540054` for the correlated-opportunity
   probe, including Recall@K.

The fresh simulator suite passed all 72 tests. Ruff, Python bytecode compilation,
`git diff --check`, and the 464-file architecture ceiling check passed.

## Fresh fixed development run

```text
uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator generate --profile development \
  --output /tmp/kfc-task4-p1-repair-6c27aabc-retry/development-worlds \
  --world-revision synthetic-causal-world-v5-task4-p1-repair-development

uv run --locked --no-dev --project services/kfc-recommendation-simulator \
  kfc-recommendation-simulator qualify-models \
  --world /tmp/kfc-task4-p1-repair-6c27aabc-retry/development-worlds/synthetic-causal-world-v5-task4-p1-repair-development \
  --output /tmp/kfc-task4-p1-repair-6c27aabc-retry/development-qualification
```

- Profile: 20,000 journeys per seed; seeds `101`, `211`, `307`; 60,000 total.
- Qualification: 20.69 seconds wall time, 2,469,707,776-byte maximum RSS, zero
  swaps.
- Source binding: clean tracked tree at
  `6c27aabc99c0cb190161560394b3a35e12f24200`.
- World digest: `3f50c9b1b731dacf0fe37fa1883a5436633322e8d72df4904f44f0abec979b1a`.
- World precommit was verified before selection.
- Validation policy evaluation opened only validation potentials and paired
  no-recommendation outcomes.
- `untouchedTestOpened=false`, `candidateRelevanceOpened=false`, and every type
  recorded zero untouched rows observed during selection.
- Status: `failed_selection`; selected/frozen configuration absent;
  `servingBundleEmitted=false`; bundle absent.

### Fixed-gate results

Each table cell is the number of thresholds, out of nine, that passed that gate.
`All` is the count passing all five gates.

| Type | Family | Cal | Coverage | Ranking | Business | Validity | All |
|---|---|---:|---:|---:|---:|---:|---:|
| For You | LightGBM | 0 | 9 | 9 | 9 | 9 | 0 |
| For You | Logistic | 0 | 9 | 9 | 9 | 9 | 0 |
| For You | MLP | 0 | 9 | 9 | 9 | 9 | 0 |
| For You | XGBoost | 0 | 9 | 9 | 9 | 9 | 0 |
| Local Favorite | LightGBM | 0 | 9 | 9 | 9 | 9 | 0 |
| Local Favorite | Logistic | 0 | 9 | 9 | 9 | 9 | 0 |
| Local Favorite | MLP | 0 | 9 | 9 | 9 | 9 | 0 |
| Local Favorite | XGBoost | 0 | 9 | 9 | 9 | 9 | 0 |
| Modifier Upsell | LightGBM | 0 | 9 | 0 | 9 | 9 | 0 |
| Modifier Upsell | Logistic | 0 | 9 | 0 | 0 | 9 | 0 |
| Modifier Upsell | MLP | 0 | 9 | 0 | 9 | 9 | 0 |
| Modifier Upsell | XGBoost | 0 | 9 | 0 | 9 | 9 | 0 |
| Smart Cross-sell | LightGBM | 0 | 0 | 0 | 9 | 9 | 0 |
| Smart Cross-sell | Logistic | 0 | 0 | 0 | 9 | 9 | 0 |
| Smart Cross-sell | MLP | 0 | 0 | 0 | 9 | 9 | 0 |
| Smart Cross-sell | XGBoost | 0 | 0 | 0 | 9 | 9 | 0 |

Calibration remains an independent universal blocker: zero family/type candidates
passed calibration at any threshold. At threshold `0.05`, For You Logistic had
selection Brier `0.249869` versus null `0.249569` and joint Brier `0.210430` versus
null `0.209770`. Smart Cross-sell XGBoost had selection Brier `0.125501` versus null
`0.125502`, but joint Brier `0.077712` versus null `0.077659`; both heads must pass.

The repaired paired evidence is real journey evidence. For You Logistic at threshold
`0.05` evaluated 4,255 paired journeys: learned AOV `71,908.51 VND` versus
no-recommendation `56,443.65 VND`; AOV-difference lower 95% `14,346.28 VND`;
revenue-per-started-journey difference lower 95% `12,845.32 VND`; conversion
difference lower 95% `+0.081154`; abandonment difference upper 95% `-0.081154`.
These paired gains cannot override failed calibration.

All reported validity counters came from actual composed decisions and were zero for
eligibility, composer cardinality, joint-above-selection probability, modifier, and
padding violations. These facts cannot override calibration, coverage, ranking, or
business failures.

## Retained evidence

- Development failed-selection evidence SHA-256:
  `288e2afae94b5fd51b90f612d1bb2a9f40060766033a71a9c436fb93001c1b3c`.
- Development status SHA-256:
  `8ecca52e81d55921b79f91ab54975268170a82b80d08867512d0bc0f6815d6cb`.
- The earlier smoke evidence remains historical first-review evidence bound to
  `a12f37ee`; it was not used as second-review proof. The mandated fixed development
  rerun supersedes it for current selection conclusions.

The selected/frozen artifacts remain absent because the repaired gate-first run
produced none. The ledger and the two unrelated untracked reports were not edited.
