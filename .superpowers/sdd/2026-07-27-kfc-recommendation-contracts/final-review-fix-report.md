# Recommendation contract final-review fix report

## Outcome

All four Important whole-slice findings are resolved in the JSON Schema
authority and the affected TypeScript/Zod and Python/Pydantic projections. No
routes, services, rankers, state, CMS access, model serving, agent tools, UI,
compatibility paths, semantic routing, StateGraph, or provider orchestration
were added.

The commit subject is:

```text
fix(kfc): close recommendation contract review findings
```

## RED evidence

Tests and the shared corpus were added before production validators changed.

### Backend

Command:

```bash
cd services/kfc-agent-backend
npx vitest run \
  test/recommendations/json-schema-contract.test.ts \
  test/recommendations/domain-contract.test.ts
```

Result: **15 failed, 64 passed, 79 total**.

- JSON Schema and Zod accepted lowercase separators/UTC markers, spaces,
  numeric offsets, and leap seconds from the rejected Instant corpus.
- Zod rejected the complete valid `merchandising_replacement` response because
  the normal For You product-only rule had no Sanity replacement exception.
- Zod rejected the new Sanity snapshot object as a string type mismatch.
- JSON Schema accepted the now-invalid scalar `sanitySnapshot`.

### Simulator

Command:

```bash
cd services/kfc-recommendation-simulator
uv run python -m unittest tests.test_recommendation_contracts -v
```

Result: **35 tests run, 10 failing subtests and 3 errors**.

- Pydantic accepted seven rejected non-canonical Instant forms.
- Strict Pydantic integers rejected valid integral JSON floats.
- Nested `NaN`, positive infinity, and negative infinity passed event payload
  validation.
- The complete valid Sanity replacement response and strict Sanity binding
  failed under the old projection.

These failures exercised all four review findings through public contract
parsers rather than implementation details.

## Implementation

### Canonical Instant

- Added `examples/instant-conformance.json`, consumed by JSON Schema, Zod, and
  Pydantic tests.
- Kept JSON Schema `format: date-time` and added the canonical
  `YYYY-MM-DDTHH:mm:ss[.fraction]Z` pattern.
- Applied the same lexical pattern before Ajv-format validation in Zod and
  before aware-datetime parsing in Pydantic.
- Guarded every TypeScript time-window `Date.parse` call behind a successful
  canonical Instant parse and a finite epoch check.

### Sanity merchandising replacement

- A response containing `replace_cart_line` is valid only when it is
  `recommended`, has `decisionSource: merchandising_replacement`, and contains
  exactly that one action.
- That validated replacement bypasses the normal ranked placement action shape
  at the response's Sanity-selected placement.
- Responses without `replace_cart_line` retain all existing placement rules,
  including when their decision source is `merchandising_replacement`.
- Tests cover the complete valid response, every other decision source, mixed
  actions, and retained normal placement behavior in both languages.

### Sanity snapshot binding

- Replaced the scalar version with the strict binding
  `{snapshotId, digest, contributingRevisions}` in JSON Schema, Zod, Pydantic,
  response example, and event example.
- Enforced a valid opaque ID, SHA-256 digest, non-empty revision array,
  non-empty revision strings, uniqueness, and unknown-field rejection.

### Python numeric and JSON parity

- Added one reusable JSON-integer pre-validator used by all existing
  non-negative and positive integer fields.
- It accepts non-boolean integers and finite integral floats, normalizes
  accepted floats to `int`, and rejects strings, booleans, fractions, `NaN`,
  and infinities before existing bounds apply.
- Added recursive pre-validation for event payload JSON, rejecting non-finite
  numbers at any nesting depth while accepting ordinary JSON values.
- Documented that Pydantic freezing is shallow and nested transport
  collections remain caller-read-only.

## Changed files

- `contracts/recommendations/v1/kfc-recommendation.schema.json`
- `contracts/recommendations/v1/examples/instant-conformance.json`
- `contracts/recommendations/v1/examples/invalid-contract-values.json`
- `contracts/recommendations/v1/examples/valid-decision-response.json`
- `contracts/recommendations/v1/examples/valid-recommendation-event.json`
- `services/kfc-agent-backend/src/recommendations/domain/schemas.ts`
- `services/kfc-agent-backend/test/recommendations/domain-contract.test.ts`
- `services/kfc-agent-backend/test/recommendations/json-schema-contract.test.ts`
- `services/kfc-recommendation-simulator/src/kfc_recommendation_simulator/recommendation_contracts.py`
- `services/kfc-recommendation-simulator/tests/test_recommendation_contracts.py`
- this report

## GREEN evidence

| Verification | Result |
| --- | --- |
| Backend focused contract suites | 2 files, 79/79 tests passed |
| `npm run check` | format, ESLint, and TypeScript passed |
| Backend full `npm test` | 58 files, 313/313 tests passed |
| `uvx ruff check src tests` | passed |
| Python `compileall` | passed |
| Simulator focused contract suite | 35/35 tests passed |
| Simulator full discovery | 56/56 tests passed |
| `git diff --check` | passed |

The first static-check attempt found formatting only in the two modified
language files. The maintained formatter and focused Python edits corrected
those issues; the required static commands were rerun and passed.

## Self-review

- The JSON Schema remains the transport authority; field names, requiredness,
  strictness, and the new binding constraints match both projections.
- The Instant corpus verifies the same acceptance set in all three validators.
- All pre-existing versions, enums, placements, action definitions, statuses,
  counts, unknown-property rejection, and the 12 original cross-field
  invariants remain intact.
- The replacement branch is narrowly conditional on an actual
  `replace_cart_line`; normal non-replacement placement behavior is unchanged.
- Every Python integer field continues to use its original positive or
  non-negative bound after the shared JSON-integer normalization.
- The complete diff contains no unrelated files or runtime feature work.

## Residual concern

No blocking concern remains. As directed by the brief, Pydantic models are
shallow-frozen only; deep immutability of nested transport collections remains
a non-blocking future hardening item.
