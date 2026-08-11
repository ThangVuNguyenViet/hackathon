# Task 3 repair report — evaluation candidate relevance, C8 amendment

## Result

The round-3 findings C6, C7, and I4 and the round-4 C8 finding are repaired at
current implementation checkpoint `483117f6f8f18ae1649a5991553e692620072ca4`
(`fix(recommendations): reverify precommit immutability`). The fresh
500,000-journey v5 world generated at
`a37bbab7cd92e2e8d3d2bbc04e1574094f86c317` passed the semantic audits and all
retained Task 3 causal-world, physical-boundary, cardinality, composer, drift,
and information-boundary audits.

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

## C8 — immutability rechecked at every authorization boundary

- `_verify_precommit` now checks `st_mode & 0o222` every time a precommit is
  used to authorize configuration freeze or an untouched evaluation loader.
- Restoring owner, group, or other write access after precommit consumption now
  fails closed even when the file bytes, SHA-256, manifest binding, birth time,
  world digest, and source-contract digest remain unchanged.
- The regression executes the complete precommit-select-freeze-mode-tamper-
  loader sequence in a fresh Python process. It first failed because mode
  `0644` still opened untouched rows, then passed after the shared verification
  check was added.
- This verification-only repair changes no generated data, schema, manifest,
  causal equation, relevance value, source-contract input, or artifact digest.
  The retained 500,000-journey world therefore remains valid; the machine proof
  records the generation SHA and the later authorization-verification SHA
  separately.

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
6. The C8 fresh-process regression first failed with `write bit 200 was
   accepted` after changing the canonical precommit to mode `0644`. Rechecking
   all owner/group/other write bits inside `_verify_precommit` made the complete
   tamper matrix green.

## Final 500,000-journey proof

The retained machine proof is
`.superpowers/sdd/2026-08-04-kfc-automatic-recommendation-big-bang/task-3-qualification-proof.json`.
Its SHA-256 is
`609f37b6751d00cc6797719d890a77191438ac157cb634646e8008759382815c`.

The qualification-data checkpoint generated ten seeds of 50,000 journeys:

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
- `uv run python -m unittest discover -s tests -v` — PASS: 57 simulator
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
