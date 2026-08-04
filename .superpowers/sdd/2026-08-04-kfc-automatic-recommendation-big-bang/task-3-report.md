# Task 3 repair report — synthetic causal world, round 2

## Result

Repair round 2 is complete in implementation checkpoint
`ba4f981b3b892548ac78a6a21d2c41d47b7a07ae`
(`fix(recommendations): enforce placement composer cardinality`). It follows
round-1 implementation checkpoint
`f9540b8efc6e0042358217bf245980b80f14a63b`.

The two remaining critical cardinality defects are repaired without regressing
the treatment-specific counterfactuals, stateful journey lifecycle, exact
policy mechanisms, information boundaries, drift, traffic, or locked
reproduction fixes from round 1.

## C4 — Single-action placements

- Local Favorite, For You, and Modifier Upsell now compose exactly one rendered
  action after condition-specific ranking.
- A ready Modifier Upsell is attached to the exact cart line created by the
  accepted starter and has a positive price impact.
- Generated-world tests inspect real opportunity and exposure artifacts for
  all three types, position 1, exact parent identity, and positive modifier
  price.
- The final 500,000-journey audit found 488,431 ready single-action placements,
  zero cardinality violations, zero ready-modifier parent-binding violations,
  and zero non-positive rendered modifier prices.

## C5 — Shared valid Smart composer

- Every automatic, uniform-random, popularity, and active-ablation path first
  ranks its eligible candidates, then uses the same deterministic composer.
- Smart composition accepts only positive-score candidates, distinct
  categories, and a total price within the remaining `250,000 VND` budget.
- Three members is the default valid offer. A fourth is allowed only when size
  four was requested and the fourth member remains positive-score,
  category-diverse, and within remaining budget.
- A one- or two-member composition becomes typed
  `insufficient_composable_candidates` empty evidence with no slate or
  exposures. The two-candidate scorer request remains an input-shape fixture,
  never a rendered offer.
- Oracle paths persist eligible candidate facts and condition-ranked IDs.
  Tests independently recompose every policy path. Uniform-random output-slate
  and member propensities are enumerated across the complete small candidate
  permutation set, so category/budget skips do not retain the invalid
  `1 / P(n,k)` shortcut.
- The manifest declares ranking-before-composition, single-action types,
  minimum/default/maximum Smart cardinality, budget ceiling, insufficient
  result, and the exact fourth-member rule.

## Strict TDD evidence

1. The generated single-action test failed because ready starters/modifiers
   rendered three members. Target size one made it green.
2. The generated Smart test failed because undersized ready offers existed and
   no typed insufficient state existed. Shared composition and fail-closed
   minimum cardinality made it green.
3. The cross-policy composer test failed because exposure evidence did not
   persist composer score. Persisted score plus shared constraints made it
   green.
4. The oracle rank/composer test failed because ranked candidate facts were not
   persisted. Adding those facts exposed the old random propensity shortcut;
   exact enumerated slate/member propensity computation made it green.
5. The manifest contract test failed on schema v2 and missing composer rules.
   Manifest v3 and explicit composer policy made it green.

## Final qualification and retained proof

The exact final-code qualification proof is retained at
`.superpowers/sdd/2026-08-04-kfc-automatic-recommendation-big-bang/task-3-qualification-proof.json`.
Its SHA-256 digest is
`24de11034a1209d5a6ffd946b9d8cdd3828985de80bfdad252e6891aa007679e`.

The machine-readable artifact binds the exact command, implementation SHA,
manifest path and digest, world digest, interpreter/PyArrow/lock/writer
settings, artifact and training-loader row counts, invalid counters,
cardinality/composer audits, zero-value-checkout audits, and resource metrics.
No generated Parquet world is committed.

Final proof summary:

- 500,000 source/evaluation journeys;
- 1,500,000 ordered factual opportunities;
- 800,018 rendered exposure members;
- 3,182,171 model-visible rows and 2,705,961 loader-visible rows;
- 4,000,000 paired oracle rows;
- 274,728 typed-empty Smart results;
- 88,269 ready three-member and 11,695 ready four-member Smart offers;
- zero invalid, cardinality, parent, price, composer, undeclared-fourth,
  empty-with-slate, and zero-value-checkout violations;
- manifest SHA-256
  `606e52727906900cdb94017e7a5517fd00893f7c64a2c88be4fa83e97c3f08dd`;
- world digest
  `08a6a2d99753b860287f3b9a423a96e344ce758af81302f3663539c8b14cdcc5`;
- 456.65 seconds wall time;
- 4,791,779,328-byte maximum RSS, zero swaps;
- 474,030,080-byte generated-world disk usage.

## GREEN gates

- `uv run ruff check .` — PASS.
- `uv run python -m compileall -q src tests` — PASS.
- `uv run python -m unittest discover -s tests -v` — PASS: 23 simulator
  tests.
- `PYTHONPATH=src python3 -m compileall -q src tests` in the scorer — PASS.
- `PYTHONPATH=src python3 -m unittest discover -s tests -v` in the scorer —
  PASS: 9 tests.
- `npm run check:automatic-recommendation-authority` — PASS: 5 tests.
- `git diff --check` — PASS.
- Machine proof versus final manifest and independent zero-audit contracts —
  PASS.

## Boundaries and cleanup

- Model-visible artifacts still exclude condition, terminal, treatment-path,
  treatment-revenue, latent, and oracle fields.
- Random/popularity remain offline evidence conditions and add no runtime
  recommendation authority.
- Large qualification and smoke worlds plus generated Python/Ruff caches were
  removed after proof extraction.
- The two unrelated untracked audit reports were preserved and excluded from
  both round-2 checkpoints.
