# Task 2 report — Build the clean deterministic engine core

## Result

Completed Slice 2 in implementation checkpoint
`95d7e5de9ca59c48374a57c25ba61020a0d0580f`
(`feat(recommendations): build deterministic automatic core`).

Independent-review repairs were completed in checkpoint
`34e49db5a817c3abb72d177de5534e92ab5c1162`
(`fix(recommendations): harden deterministic core authority`).

The new `src/recommendations/automatic-core/` boundary owns trusted context
resolution, complete four-type candidate discovery, the sole Eligibility
Policy, versioned features, atomic Qualified Model Bundle resolution, strict
scorer reconciliation, Main-owned expected-retained-value recomputation,
thresholding, and deterministic type-aware composition.

It returns typed empty/paused results for insufficient history, missing exact
parent, empty cart, no eligible candidates, no qualified four-model bundle,
threshold abstention, and governed pause. Scorer mismatch, invalid output,
saturation, and trusted infrastructure failure produce retryable 503 errors.
No HTTP, AWS, persistence, synthetic training, semantic-language routing, or
runtime substitute recommender was added.

## Donor inventory closure

- `docs/kfc-automatic-recommendation-donor-dispositions.json` assigns one of
  `Adopt`, `Redesign`, `Delete`, `Preserve unrelated`, or
  `Historical superseded` to 299 exact paths from donor commit
  `fc5fcafbaf7e0f00afbdd668ab90f6be0439b947`.
- Coverage includes runtime, scripts, config, CI, docs, evidence, assets,
  migrations, tests, and cross-cutting imports.
- The maintained authority audit derives the exact path set from declared donor
  roots plus explicit exceptions, requires equality with `git ls-tree`, and
  traverses the target import graph plus deployment/config/CI surfaces. The
  preserved chat ranker is explicit and unreachable from the automatic core.

## Independent review repair

- A trusted journey/order-context port now resolves store, fulfilment, locale,
  cart/revision/subtotal, parent line, verified customer, and remaining budget
  from opaque references. Submitted commerce facts are bindings only; a
  mismatch is a typed non-retryable 409 before catalog, candidates, or scorer.
- Modifier eligibility compares exact nested group paths and applied options.
  Exact duplicates and satisfied single-select groups have separate evidence;
  multi-select sibling options remain eligible.
- One strict `automatic-feature-v1` schema owns a fixed exhaustive key set,
  explicit nullable unknowns, applicability rules, and a mechanical digest.
  The scorer boundary rejects missing, extra, nested, post-decision, and
  type-inapplicable fields in Node, Python, and Dart.
- Trusted order, catalog, history, exposure, and clock snapshots are validated
  at the port boundary. Context, bundle, feature/request construction, and
  scorer failures expose named retryable 503 stages, and failure tests prove
  there is no scorer or substitute call.
- Equal retained-value ties now use explicit Unicode code-point ordering for
  all four recommendation types, independent of host locale.

## RED evidence

1. `npm test -- --run test/recommendations/automatic-core-context-and-candidates.test.ts`
   - Failed because `src/recommendations/automatic-core/index.js` did not exist.
2. `npm test -- --run test/recommendations/automatic-core-eligibility-and-features.test.ts`
   - Failed four tests because the wished-for Eligibility Policy and feature
     builder did not exist.
3. `npm test -- --run test/recommendations/automatic-core-engine.test.ts`
   - Failed eight tests because bundle resolution and the deterministic engine
     did not exist.
4. The added trusted-snapshot failure test failed because a catalog adapter
   `TypeError` escaped instead of becoming a retryable 503; the engine now
   distinguishes wire `ZodError` from infrastructure failure.
5. `npm test -- --run test/recommendations/automatic-core-authority-audit.test.ts`
   - Failed because one D1 cross-cutting path and the maintained package script
     were absent from the machine-checked closure.
6. The catalog-authority mutation test failed with `eligible, eligible` after
   candidate flags and identity were spoofed; Eligibility Policy now
   recomputes validity from the trusted catalog snapshot.
7. Six spoofed commerce-binding cases initially reached trusted context instead
   of returning 409; the trusted order-context binding now rejects each before
   catalog/candidate/scorer access.
8. Nested applied-modifier tests initially returned all candidates eligible;
   exact duplicates and single-group siblings now return their dedicated
   exclusion evidence while multi-group siblings remain eligible.
9. Fixed-feature mutation tests initially failed because the exported schema
   parser/key list did not exist and the scorer accepted missing/extra fields.
   The strict contract-owned schema now rejects those mutations across all
   three runtimes.
10. Invalid time-zone/catalog-price/zero-parent-price tests initially leaked raw
    `RangeError`/`ZodError`, and the infrastructure error had no stage. They now
    return `context` or `features` retryable 503 without calling the scorer.
11. Four equal-value composition cases initially produced locale-dependent
    `a, é, Z`; they now produce code-point order `Z, a, é` for every type.
12. The donor audit initially rejected the new roots/exceptions fields and only
    validated a self-declared list. It now derives 299 exact donor paths,
    including both recommender framework research assets, and requires equality.
13. The architecture gate initially reported the Dart contract at 1,046 lines;
    scorer-feature validation was split into a 184-line part and the main file
    is now 867 lines.

## GREEN evidence

- Focused core and accepted-contract suite:
  `npm test -- --run test/recommendations/automatic-core-context-and-candidates.test.ts test/recommendations/automatic-core-eligibility-and-features.test.ts test/recommendations/automatic-core-engine.test.ts test/recommendations/automatic-core-authority-audit.test.ts test/recommendations/automatic-recommendation-contract.test.ts test/recommendations/automatic-wire-authority.test.ts`
  - PASS after independent-review repair: 6 files, 62 tests.
- `npm run check:automatic-recommendation-authority`
  - PASS: 5 tests, including donor-tree equality and target import-graph audit.
- `npm run check`
  - PASS: formatting, ESLint, strict 542-warning legacy budget with no
    regression, direct-agent boundaries, typecheck, 219 test files and 2,309
    tests passed; 2 files/12 live tests skipped by their normal opt-in gates.
- `npm run check:architecture`
  - PASS: 464 files, 900-line ceiling, no baseline growth.
- `PYTHONPATH=src python3 -m unittest discover -s tests -v`
  - PASS: 9 Python contract/parity tests.
- `flutter test test/features/automatic_recommendations/automatic_recommendation_contract_test.dart`
  - PASS: 9 Dart contract/parity tests.
- `git diff --check`
  - PASS.

## Files

- `docs/kfc-automatic-recommendation-donor-manifest.md`
- `docs/kfc-automatic-recommendation-donor-dispositions.json`
- `services/kfc-agent-backend/package.json`
- `services/kfc-agent-backend/src/recommendations/automatic-core/{bundles,candidates,composition,context,eligibility,engine,errors,features,index,types}.ts`
- `services/kfc-agent-backend/test/recommendations/automatic-core-{authority-audit,context-and-candidates,eligibility-and-features,engine}.test.ts`

## Self-review

- Candidate discovery enumerates every potential catalog product for Local
  Favorite, For You, and Smart Cross-sell, and every exact modifier option for
  the requested parent line before eligibility filtering.
- Eligibility re-resolves item, fulfilment, safety, exact parent/path/option,
  and cart redundancy facts from trusted snapshots; copied candidate flags do
  not carry authority.
- Only eligible strict fixed-schema feature rows reach the scorer. The scorer cannot
  enumerate, filter, compose, select a model, persist, or mutate commerce.
- Scorer request/response identity, model binding, candidate uniqueness, score
  set equality, probabilities, and provenance reuse the accepted strict
  contract boundary.
- Expected retained value is recomputed in Main as valid candidate price impact
  multiplied by calibrated joint probability. Scorer output cannot supply it.
- Modifier output is capped at three with no padding. Smart Cross-sell chooses
  up to three unique categories and does not fill diversity gaps with redundant
  candidates. Other types use their target of three and may return fewer.
- No popularity, random, deterministic-ranker, Personalize, stale, manual,
  merchandising, shadow, or fallback authority is reachable from the new
  boundary. Existing `src/ordering/recommendationRanking.ts` remains explicitly
  preserved unrelated for the later chat cutover.
- The two unrelated untracked audit reports were preserved and excluded from
  the checkpoint. The task ledger was not edited.
