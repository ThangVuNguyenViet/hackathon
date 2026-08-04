# Task 5 report — fail-closed serving and durable evidence persistence

## Result

Task 5 implements the production-shaped negative/no-qualification serving path.
Task 4 scientifically ended at `failed_selection`, so no Qualified Model Bundle
exists. This task did not create, copy, relabel, or substitute a model bundle or
baseline. The scorer remains unready and returns a typed retryable `503` while the
bundle is missing or invalid. No runtime recommendation fallback exists.

The local serving and persistence contracts pass their focused gates. Positive
native-model inference and a ready scorer cannot be qualified until a future Task
4 run atomically emits a real all-four bundle; that scientific limitation is
preserved instead of bypassed.

## Implemented boundary

- Main now has a persistent localhost-only HTTP/1.1 JSON scorer client with one
  keep-alive pool, bounded active concurrency, immediate typed saturation,
  request timeout, invalid-response, and unavailable failure classes.
- The existing canonical scorer parser/reconciler remains the exact authority for
  request identity, candidate coverage, response model provenance, and reordered
  candidate reconciliation. The canonical wire manifest was not changed.
- The Python 3.11 scorer has a minimal standard-library HTTP service and non-root
  container. Its loader verifies the exact expected bundle digest, atomic four-type
  champion inventory, every payload digest, and immutable qualified evidence
  before a bundle can be considered structurally available.
- Readiness never turns true for a manifest alone: native predictors and their
  golden vectors must load. Because Task 4 emitted no bundle/runtime, the current
  image stays typed-unready rather than installing a substitute.
- Main is pinned to Node 24 in its engine contract, Node type definitions, and
  container base. The verification host runs Node 26.5.0, so the Node 24 image
  itself was not executed locally.
- Decision and event evidence use an immutable content-addressed object write
  before a transactional ledger commit. Same-payload retries remain stable across
  wall-clock changes. A changed binding conflicts without rewriting evidence.
- S3 contracts use create-only `If-None-Match: *` writes and digest metadata.
  DynamoDB contracts commit the idempotency binding and decision/event record in
  one conditional transaction with strongly consistent replay checks.
- Orphan reconciliation scans immutable evidence and repairs missing transactions.
  In-memory production-shaped adapters support deterministic failure injection and
  local durability tests without an AWS deployment.
- Every new source module remains below the 900-line ceiling.

## TDD evidence

The implementation followed explicit RED/GREEN cycles for:

1. Missing scorer client: connection reuse/provenance and saturation/timeout tests
   failed on missing imports, then passed with the bounded persistent client.
2. Missing evidence saga: immutable-first ordering, idempotency, injected
   transaction failure, orphan repair, events, and conflicts failed first, then
   passed.
3. Missing Main serving wrapper and Python HTTP service: durable-before-return and
   typed unready/score `503` tests failed first, then passed.
4. Missing S3 adapter: the create-only write contract failed first, then passed.
5. Missing DynamoDB adapter: the two-item transactional contract failed first,
   then passed.
6. Retry wall-clock instability: a same-payload retry initially produced an
   idempotency conflict; the evidence identity was repaired to exclude local retry
   time and the regression test passed.

## Fresh verification

- Focused Node serving/core/authority suites: **32 passed**, 0 failed.
- Complete Python scorer suite: **12 passed**, 0 failed.
- TypeScript typecheck: passed.
- Maintained-file format gate: passed.
- Strict ESLint warning budget: preserved at 542 warnings across 161 legacy files;
  Task 5 added no warning budget.
- Scoped Ruff format and lint for all Task 5 Python files: passed.
- Python bytecode compilation: passed.
- Architecture check: **468 files**, 900-line ceiling, no baseline growth.
- `git diff --check`: passed.

The repository-wide backend test command also completed: **2,527 passed, 12
skipped, 100 failed** across 253 files. Every automatic-recommendation and Task 5
suite passed. The 100 failures are in pre-existing agent/chat/worker/scenario
surfaces (for example `agent_authored_tool_batch_invalid`, legacy StateGraph
scenario replay, and Messenger worker expectations) and do not import the new
Task 5 modules. They are recorded rather than repaired outside this task's scope.

Docker build validation could not run because the local Docker daemon is stopped
(`Cannot connect to the Docker daemon`). No AWS resources were deployed.

## Remaining scientific gate

There is deliberately no ready scorer and no positive native-inference result:
Task 4 emitted no qualified bundle. A later model iteration must pass the fixed
scientific gates, emit one atomic four-type bundle, load all native predictors and
golden vectors, and then rerun serving readiness/contract/latency qualification.
Until then, the only valid production-shaped behavior is typed unavailability with
durable empty/no-qualified-model evidence and no fallback.
