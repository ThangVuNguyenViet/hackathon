# Task 1 review-fix report

## Scope completed

- Restored explicit narrative `preconditions` to all 11 retained scenario JSON
  files and to the scenario TypeScript contract.
- Surfaced preconditions through `runScenario`, the live CLI output, the
  LangSmith showcase seed inputs, and the showcase catalog.
- Renamed the misleading showcase `acceptanceCriteria` output to `risks`.
  Backend and Flutter parsing retain read-only fallback support for already
  seeded legacy examples.
- Added direct Vitest coverage for:
  - the 11-scenario narrative contract;
  - the current single-`createAgent`, no-`StateGraph`, no-direct-OpenAI-SDK
    architecture;
  - normalized menu retrieval and modifier-alias search;
  - session-isolated conversation persistence plus its audit event;
  - Cloudflare Queue payload size enforcement before every Worker queue send.
- Added a bounded queue-send helper. This prevents the current expanded
  raw-body proof from exceeding Cloudflare's message limit. Task 3 still owns
  replacing that proof with a compact normalized, verifiable ingress claim.
- Recorded current business-pack absence as a transition inventory assertion.
  Task 2 must replace it with real trusted-pack isolation tests when that seam
  is introduced.

## TDD evidence

Initial focused command:

```text
npm test -- --run test/scenarios/scenario-script.test.ts test/worker/queue-payload-bound.test.ts
```

Result: expected RED. The scenario test failed because `preconditions` was
absent, and the queue test failed because `workerQueueEnvelope` did not exist.

After implementation:

```text
npm test
```

Result: PASS, 7 files and 11 tests.

## Verification

```text
npm run format
npm test
npm run lint
npm run typecheck
npm run build
```

Result: PASS. Vitest reported 7 files and 11 tests; ESLint, TypeScript
typecheck, and the clean TypeScript build all exited successfully.

```text
dart format lib/features/showcase/showcase_models.dart lib/features/showcase/showcase_content.dart test/features/showcase/showcase_screen_test.dart test/features/showcase/showcase_controller_test.dart
flutter test test/features/showcase/showcase_screen_test.dart test/features/showcase/showcase_controller_test.dart
```

Result: PASS. Both focused Flutter showcase tests passed. Dependency
resolution reported available incompatible updates and one disposed-beacon
warning already emitted by the controller test; neither failed the run.

## Explicit next-task boundaries

- Task 2: provider-neutral kernel contract and actual KFC/PVCFC business-pack
  isolation.
- Task 3: compact normalized Messenger ingress claim, durable context/storage
  boundaries, and LangSmith callback correlation.
