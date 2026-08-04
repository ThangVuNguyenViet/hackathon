# Task 5 report — fail-closed serving and durable evidence persistence

## Result

Task 5 implements the production-shaped negative/no-qualification serving path.
Task 4 scientifically ended at `failed_selection`, so no Qualified Model Bundle
exists. This task did not create, copy, relabel, or substitute a model bundle or
baseline. The scorer remains unready and returns a typed retryable `503` while the
bundle is missing or invalid. No runtime recommendation fallback exists.

The local serving and persistence contracts pass their focused gates. A fixture
marked explicitly test-only proves the future all-four positive load, golden
warmup, readiness, and scoring path without being usable as production
qualification. The scientific limitation is preserved instead of bypassed.

## Implemented boundary

- Main now has a persistent localhost-only HTTP/1.1 JSON scorer client with one
  keep-alive pool, bounded active concurrency, immediate typed saturation,
  request timeout, invalid-response, and unavailable failure classes.
- The existing canonical scorer parser/reconciler remains the exact authority for
  request identity, candidate coverage, response model provenance, and reordered
  candidate reconciliation. The canonical wire manifest was not changed.
- The Python 3.11 scorer has a minimal standard-library HTTP service and non-root
  container. Its loader recomputes the exact Task 4 canonical binding digest and
  verifies the contract, feature, composer, qualification evidence, all payload
  digests, and atomic four-type champion inventory before availability.
- All four champion runtimes load their native estimator, feature encoder,
  selection/joint heads, calibrators, threshold, and golden vectors. Any tampered
  binding, payload, or golden prediction keeps readiness false and scoring at a
  typed retryable `503`; no fallback scorer exists.
- Readiness never turns true for a manifest alone: native predictors and their
  golden vectors must load. Because Task 4 emitted no bundle/runtime, the current
  image stays typed-unready rather than installing a substitute.
- Main is pinned to Node 24 in its engine contract, Node type definitions, and
  container base. The verification host runs Node 26.5.0, so the Node 24 image
  itself was not executed locally.
- Main registers all four decision endpoints plus impression and outcome event
  endpoints. A process-owned provider participates in readiness and shutdown.
  Because trusted order/catalog/history/exposure ports are not configured in the
  current composition root, its production default is explicitly typed-unavailable;
  request bodies are never promoted into trusted state.
- The AWS runtime factory requires a real decision-engine factory and complete
  technical-evidence projector, and owns one persistent scorer client, S3 client,
  DynamoDB clients, readiness probes, and coordinated close.
- Readiness performs a canonical scorer request through the real Node HTTP client
  into Python and reconciles candidate coverage plus exact model provenance. The
  cross-runtime test uses the explicitly test-only four-model bundle; a tampered
  warmup model binding remains unready. Production without a QMB remains `503`.
- Decision and event idempotency is claimed in DynamoDB before scoring, object
  writes, or other effects. Conditional pending bindings contain canonical
  request/cart/context or event-payload digests; matching concurrent instances
  wait for and read the committed winner, while rebounds return canonical `409`.
  Identical retries return the original stored response and timestamps without a
  second scorer call or S3 orphan. Failed owners release only their exact pending
  claim so immutable-orphan recovery can safely take over.
- Decision and event evidence use an immutable content-addressed object write
  before a transactional ledger commit. Same-payload retries remain stable across
  wall-clock changes. A changed binding conflicts without rewriting evidence.
- S3 contracts use create-only `If-None-Match: *` writes, mandatory version IDs,
  exact byte digest/size metadata, version-aware pagination, and exact-version
  reads.
  DynamoDB contracts commit the idempotency binding and decision/event record in
  one conditional transaction with strongly consistent replay checks.
- Orphan reconciliation scans immutable versions, re-hashes exact bytes, and
  verifies key, version, digest, size, envelope, and canonical typed payload before
  repairing missing transactions.
- Canonical decision evidence binds request/cart digests and revisions plus full
  candidate, eligibility, feature, scoring/calibration, composition, release, and
  trace sections. Every response, including empty and paused, requires complete
  engine execution evidence; the former fabricated public-response fallback was
  removed. Events expose typed/queryable journey, channel, action,
  position, revision, digest, and time fields.
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

- Complete automatic-recommendation Node suites: **88 passed**, 0 failed.
- Complete Python scorer suite: **14 passed**, 0 failed.
- TypeScript typecheck: passed.
- Maintained-file format gate: passed.
- Strict ESLint warning budget: preserved at 542 warnings across 161 legacy files;
  Task 5 added no warning budget.
- Scoped Ruff format and lint for all Task 5 Python files: passed.
- Python bytecode compilation: passed.
- Architecture check: **471 files**, 900-line ceiling, no baseline growth.
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

There is deliberately no production-ready scorer: Task 4 emitted no qualified
bundle. The explicitly non-production fixture proves that a future valid bundle
can load all native predictors and golden vectors and score canonically, while
tamper tests prove the same path fails closed. A later model iteration must pass
the fixed scientific gates and emit the real atomic bundle before production
readiness/contract/latency qualification. Until then, the only valid
production-shaped behavior is typed unavailability and no fallback.
