# Task 3 repair report — evaluation candidate relevance, review-fix round 4

## Result

The round-3 independent-review findings C6, C7, and I4 are repaired at exact
implementation checkpoint `a37bbab7cd92e2e8d3d2bbc04e1574094f86c317`
(`fix(recommendations): precommit complete relevance evaluation`). The fresh
500,000-journey v5 world passed the new semantic audits and all retained Task 3
causal-world, physical-boundary, cardinality, composer, drift, and information-
boundary audits.

No Task 4 model, calibrator, threshold, gate, or bundle behavior was weakened or
changed. This remains synthetic-only qualification evidence and does not claim
compatibility with real KFC data or authorize real-customer exposure.

## C6 — complete automatic-reference evaluation support

- Every opportunity's evaluation and model-visible candidate universe begins
  with the ordered eligible candidates from that journey's automatic reference
  path. This includes `no_recommendation`, suppressed ablation placements, and
  candidates not shown by the factual logging policy.
- Deduplicated factual-state extensions are appended only when necessary to
  retain actual observed exposure support. Factual shown labels still come only
  from factual exposures; unshown and suppressed candidates remain unlabelled.
- Training keys, candidate-relevance keys, and
  `evaluation/opportunities.candidateCount` use the same union.
- The full-scale audit reconciled 4,592,398 keys exactly, with zero missing or
  out-of-order automatic candidates, zero duplicate keys, and zero missing
  factual exposure labels. It covered 283,160 suppressed/nonempty automatic
  opportunities and retained 183,092 factual extension candidates.

## I4 — candidate- and context-responsive causal relevance

- `candidate-singleton-value-v2` makes selection probability respond to
  journey affinity, candidate desirability, promotion, basket fit, and
  contextual price burden.
- Checkout probability responds to affinity, candidate desirability,
  fulfilment mode, and post-action price burden. Removal responds to contextual
  price burden, candidate desirability, and promotion.
- Expected retained VND remains the exact product of the three causal
  probabilities and candidate price; candidate-keyed exogenous draws remain
  stable and independent of ranking policy.
- The full-scale audit found 1,121,959 opportunities with within-opportunity
  candidate probability variation and 583,161 opportunities containing a
  cheaper candidate with greater relevance than a more expensive candidate.
  Causal-value identity, expected-value identity, probability bounds, and
  removal-state audits all had zero violations.

## C7 — world-owned immutable precommit

- World generation now writes the read-only canonical token
  `manifests/qualification-precommit.json`. Its digest and source-contract
  digest are bound into the world manifest before configuration selection.
- `precommit_qualification` only consumes this world-owned token. It rejects an
  existing selected configuration, a caller-selected token path, a mutable,
  missing, replaced, or tampered token, a noncanonical path, and a source/world
  mismatch.
- `freeze_configuration` requires the verified precommit, checks token birth
  before configuration birth, then atomically creates a read-only freeze token
  binding configuration, precommit, manifest, world, and source-contract
  digests. Frozen loaders verify the complete chain.
- Fresh-process tests prove that posthoc configuration cannot be precommitted,
  cross-world reuse fails, caller-created tokens fail, exact-byte replacement
  after selection fails, and the legitimate precommit-select-freeze-load path
  succeeds.
- The retained world token is `-r--r--r--`, SHA-256
  `55135158c35eb45151146643248aa4be4ab3bd945a905446e08b1de8c4c05c9b`,
  and source-contract SHA-256
  `762b1c0fca370b226177e6ab15a9b364f8034b4891f0583173d6f3e501d8359c`.
  It predated the selected configuration; digest, source-binding, and
  write-bit audits had zero violations.

## Strict TDD evidence

1. The C6 test first failed because no-recommendation opportunities omitted
   automatic eligible product IDs. Automatic-reference enumeration made the
   no-recommendation and named-ablation cases green.
2. The broadened reconciliation then failed because 19 factual exposure keys
   disappeared when factual state differed. Ordered automatic candidates plus
   deduplicated factual extensions made exposure parity green without moving
   hidden labels into training.
3. The I4 audit first found zero groups whose candidate probabilities varied.
   Candidate/context-responsive causal equations made the probability-variation,
   price-inversion, and repeat-candidate/context tests green.
4. C7 tests first showed a freeze token could be minted after seeing a selected
   configuration. A world-generation-owned manifest-bound precommit, consumed
   before selection, made the fresh-process posthoc and caller-token attacks
   fail closed.
5. Additional C7 red cases covered cross-world reuse and exact-byte token
   replacement after configuration selection. Source/world/digest/birth-order
   verification made both green while preserving the valid fresh-process path.

## Final 500,000-journey proof

The retained machine proof is
`.superpowers/sdd/2026-08-04-kfc-automatic-recommendation-big-bang/task-3-qualification-proof.json`.
Its SHA-256 is
`c5a09876b4714b26c140c224b195e5300e35fcfebf177010340a78de03f18259`.

The exact implementation SHA above generated ten seeds of 50,000 journeys:

- 500,000 journeys, 1,500,000 opportunities, 804,837 exposures, and 4,000,000
  paired oracle rows;
- exactly 4,592,398 model-visible, candidate-relevance, and summed opportunity
  candidate rows;
- 3,942,202 training-loader rows, 650,196 freeze-gated untouched relevance
  rows, and 3,787,561 unshown model-visible rows;
- zero artifact-digest, candidate-key, duplicate, automatic-support, factual-
  exposure, causal-value, expected-value, probability, removal, forbidden-field,
  and unshown-label violations;
- zero prior cardinality, parent-binding, positive-price, Smart composer,
  undeclared-fourth, empty-with-slate, and zero-value-checkout violations;
- untouched paired NDCG evidence across 171,877 opportunities, separately
  reported for model proxy, random, and popularity policies. These intervals
  establish evaluability, not Task 4 model qualification;
- manifest SHA-256
  `2f772a9b4009dfbc45745aa27704b4600174a592234ebc42fe7c879e4d95178e`;
- world digest
  `7bd3748589ac3222553b52a6f1fa2035a20bec450222eb3122042297ec0ec83a`;
- candidate-relevance artifact SHA-256
  `60d81a37126cfd5d4856b96d0a3016299b5336d9448d8177a5692cd85cc659d4`;
- 386.33 seconds wall time, 5,173,231,616-byte maximum RSS, zero swaps,
  754,192,384-byte generated-world disk usage, and 737,553,695 artifact bytes.

## GREEN gates

- `uv run ruff check .` — PASS.
- `uv run python -m compileall -q src tests` — PASS.
- `uv run python -m unittest discover -s tests -v` — PASS: 56 simulator
  tests.
- `PYTHONPATH=src python3 -m compileall -q src tests` in the scorer — PASS.
- `PYTHONPATH=src python3 -m unittest discover -s tests -v` in the scorer —
  PASS: 9 tests.
- `npm run check:automatic-recommendation-authority` in the backend — PASS: 5
  tests.
- `git diff --check` — PASS.
- Fresh 500,000-journey manifest, precommit, candidate-support, frozen-loader,
  causal, leakage, cardinality/composer, and zero-value audits — PASS.

## Cleanup and handoff

- No generated Parquet world is committed.
- The two unrelated untracked audit reports remain preserved and excluded.
- Task 4 can consume the manifest-bound relevance surface and independently
  re-run its unchanged smoke, development, and qualification gates. This Task 3
  repair does not claim that Task 4 has passed.
