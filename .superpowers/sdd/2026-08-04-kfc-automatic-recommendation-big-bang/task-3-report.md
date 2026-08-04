# Task 3 repair report — evaluation candidate relevance, round 3

## Result

Repair round 3 is complete at exact implementation checkpoint
`6b25a0e0f7f0172bcc8a6545c2d95807a1f7f24d`
(`fix(recommendations): add evaluation candidate relevance`). It adds the
evaluation-only candidate outcome contract required by the Task 4 sequential
blocker without moving hidden labels into training or changing any Task 4
model, calibrator, threshold, gate, or bundle behavior.

The prior round-1 and round-2 causal-world, exact-policy, physical-boundary,
drift, reproducibility, single-action, and Smart composer repairs remain
intact. The fresh 500,000-journey v4 world passed all old audits and the new
candidate-relevance audits.

This remains synthetic-only qualification evidence. It does not claim
compatibility with real KFC data or authorize real-customer exposure.

## Evaluation-only candidate relevance

- Added `evaluation/candidate-relevance.parquet`, physically separate from
  `model-visible/training-examples.parquet` and `oracle/`.
- Emits exactly one row for every unique eligible candidate at every factual
  opportunity, including candidates not shown by the factual logging policy.
- Binds seed, split, journey, opportunity, recommendation type, candidate,
  price, outcome reference, probabilities, realized potential events,
  realized incremental VND, expected retained VND, and graded relevance.
- Uses manifest-bound `candidate-singleton-value-v1`: render only the named
  eligible candidate; use the existing singleton selection, one-selection
  checkout, and post-checkout removal equations; value is price only when the
  candidate is selected, checkout completes, and the candidate is not removed.
- Candidate-keyed SHA-256 exogenous draws do not depend on model, random, or
  popularity ranking policy, so policy comparisons share the same candidate
  potential outcomes.
- `gradedRelevance` is expected retained incremental VND. It supplies a
  complete, non-binary ideal-DCG target without exposing latent affinity or
  policy condition fields.
- Smart eligibility now removes duplicate candidate identities before any
  policy ranking/composition. This makes the eligible set a true set and keeps
  training, opportunity counts, and relevance keys exactly aligned.

## Freeze and information boundaries

- Added `load_untouched_candidate_relevance_table`, which first verifies the
  selected-configuration path, digest, and physical freeze evidence token,
  then verifies world manifest, artifact SHA-256, and exact immutable Arrow
  schema before returning only `untouched_test` rows.
- Strengthened freeze verification so a fabricated dataclass with a correct
  configuration digest but missing or mismatched evidence token cannot open
  untouched evaluation.
- Added every candidate-relevance/potential-value field to the training
  forbidden-field set. A fresh Python process injecting `gradedRelevance` into
  the training Parquet fails with `forbidden training field`.
- Model-visible unshown rows remain deliberately unlabelled. The final audit
  found 2,342,173 unshown rows and zero non-null
  `selectedThroughCheckout` violations.
- No training, feature encoding, model fitting, calibration, threshold,
  champion selection, or Task 4 gate path imports or loads the new surface.

## Full-set ranking support

- `evaluate_opportunity_ndcg` now accepts an explicit, separate
  `relevance_by_candidate` map while retaining the old fail-closed behavior for
  incomplete factual labels.
- It rejects duplicate eligible identities and missing candidate relevance,
  then computes ideal DCG over the complete eligible set with real-valued
  relevance.
- `evaluate_paired_policy_ndcg` computes policy NDCG intervals and paired
  reference-policy differences from the same opportunity/candidate outcomes.
- Dedicated tests prove nontrivial model/random/popularity ordering and paired
  differences. The final full-scale diagnostic evaluated 122,577 untouched
  opportunities across all four types and emitted separate model-proxy,
  random, popularity, and paired 95% intervals. These demonstrate that the
  surface is evaluable; they are not Task 4 model-qualification results.

## Strict TDD evidence

1. The candidate-surface tests first failed because
   `evaluation/candidate-relevance.parquet` did not exist. Schema, generator,
   causal identity, and manifest binding made them green.
2. Full-key uniqueness then failed with 28 duplicate Smart candidate rows in a
   512-journey fixture. Deduplicating eligible Smart identities before ranking
   made candidate keys, training keys, and opportunity candidate totals equal.
3. Evaluator-boundary tests first failed because the dedicated relevance loader
   did not exist. Freeze-token, digest, and immutable-schema verification made
   missing-token, digest-tamper, and schema-tamper cases green.
4. The fresh-process leakage test first received only a generic schema error.
   Explicit candidate-relevance forbidden fields made it fail at the intended
   information boundary.
5. Ranking tests first failed because separate graded relevance and paired
   policy evaluation were unsupported. Complete-map NDCG and paired interval
   evaluation made all legacy and new ranking tests green.
6. The manifest test failed on v3 and the absent artifact/definition. Manifest
   v4 now binds the physical surface, schema, artifact digest, causal definition
   digest, and policy-independent exogenous rule.

## Final 500,000-journey proof

The retained machine proof is
`.superpowers/sdd/2026-08-04-kfc-automatic-recommendation-big-bang/task-3-qualification-proof.json`.
Its SHA-256 is
`e8d089426da2e3fbeb3597a3c6ded43ef5cc9213985f98c59ea8f34e8a748de9`.

The run used the exact implementation SHA above and generated ten seeds of
50,000 journeys each:

- 500,000 journeys, 1,500,000 opportunities, 801,654 exposures, and 4,000,000
  paired oracle rows;
- 3,143,827 model-visible rows, exactly 3,143,827 candidate-relevance rows,
  and exactly 3,143,827 summed opportunity candidates;
- 2,704,346 training-loader rows and 439,481 freeze-gated untouched relevance
  rows;
- zero candidate-key mismatches, duplicate candidate keys, artifact-digest
  violations, causal-value violations, expected-value violations,
  probability-bound violations, invalid removal states, training forbidden
  fields, or unshown-label violations;
- 28,160 distinct graded-relevance values under exactly one version/digest/
  intervention tuple;
- zero old invalid-data, cardinality, parent, price, Smart composer,
  undeclared-fourth, empty-with-slate, and zero-value-checkout violations;
- manifest SHA-256
  `3e3a9804bb70662fb9a9e410a8ff85ee792ffd35e788922068633ea07e67e24c`;
- world digest
  `c60c0976824bf72c4675d88c22a23f00d5cb234295618e265e65049a7546f957`;
- candidate-relevance artifact SHA-256
  `67ccbc5311c2925d0f576560fc8785ede435fdd16374debbf0e79b37543d325b`;
- 362.55 seconds wall time, 4,678,909,952-byte maximum RSS, zero swaps,
  539,688,960-byte generated-world disk usage, and 535,467,225 artifact bytes.

## GREEN gates

- `uv run ruff check .` — PASS.
- `uv run python -m compileall -q src tests` — PASS.
- `uv run python -m unittest discover -s tests -v` — PASS: 46 simulator
  tests.
- `PYTHONPATH=src python3 -m compileall -q src tests` in the scorer — PASS.
- `PYTHONPATH=src python3 -m unittest discover -s tests -v` in the scorer —
  PASS: 9 tests.
- `npm run check:automatic-recommendation-authority` in the backend — PASS: 5
  tests.
- `git diff --check` — PASS.
- Machine proof versus manifest, full candidate-key reconciliation, frozen
  loader, causal identity, leakage, cardinality/composer, and zero-value
  contracts — PASS.

## Cleanup and handoff

- No generated Parquet world is committed.
- The two unrelated untracked audit reports remain preserved and excluded.
- Task 4 can now consume the dedicated freeze-gated relevance surface and
  re-run its unchanged smoke, development, and qualification gates. This Task 3
  repair does not claim that Task 4 has passed.
