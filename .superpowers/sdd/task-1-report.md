# Task 1 Report: Policy, Scenarios, and Deterministic Test Foundation

## Completed work

- Added root `AGENTS.md` rules for semantic model routing, the selective
  StateGraph boundary, narrative-scenario integrity, held-out live review, and
  direct deterministic tests.
- Ported the approved narrative updates for scenarios 02, 03, 04, 06, 07, and
  09 from the designated JSON donor corpus.
- Added the JSON-only donor narratives for scenarios 10 and 11.
- Converted all 11 scenario JSON files from scripted `expectations` (and the
  one `acceptance` object) to high-level `risks`, retaining goals, customer and
  assistant turns, use-case tags, and final outcome state. No scenario replay
  tests were added.
- Updated the scenario loader and showcase seeder to consume `risks` instead
  of scripted expectations.
- Added a normal `npm test` / Vitest configuration plus three small direct
  deterministic checks for existing model-profile identity and portable tool
  schema normalization.
- Included test files and the Vitest config in TypeScript project checking so
  lint and typecheck cover the new foundation.

## Generated inventory cleanup

The stale test-suite inventory generator and its generated artifacts are not
present in this checkout, so there was no live inventory artifact to delete.
They were verified absent after the baseline inspection.

## Verification

From `services/kfc-agent-backend`:

```text
npm run format:check
npm test -- --reporter=dot
npm run lint
npm run typecheck
npm run build
```

All commands passed. Vitest reported 2 test files and 3 tests passing.

Additional integrity checks passed:

- the corpus contains 11 JSON scenarios;
- every JSON scenario has valid turns, `risks`, and `finalState` fields;
- no scenario JSON retains acceptance, expectation, exact-tool, or word-match
  assertion fields;
- no stale test-suite inventory generator or generated inventory artifacts are
  present in the checkout.

## Scope and concerns

- The existing showcase output schema still calls its display field
  `acceptanceCriteria`; the seeder now supplies narrative risks to that legacy
  output field so the existing showcase contract remains type-safe. Renaming
  that public showcase schema is outside this foundation task.
- `docs/plans/` was already untracked before this task and was deliberately
  left untouched.
