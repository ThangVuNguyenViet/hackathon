# Task 1A — Legacy runtime demolition report

## Result

Task 1A is complete as an intentionally non-typechecking demolition commit. The repository-wide production-runtime guard is green, the legacy direct OpenAI/OpenAI Agents and application-authored LangGraph runtime has been removed, and no KFC, PVCFC, or TinyFish replacement behavior was introduced.

No application-owned commerce, security, provider-data, confirmation authority, or durable effect/persistence contract had to be weakened to perform the deletion.

## RED

The existing untracked architecture test was preserved and strengthened before production edits. It scans executable production TypeScript, active scripts, package manifests, runtime configuration, `langgraph.json`, and `wrangler.toml`; it excludes documentation, reports, fixtures, generated output, historical SQL migrations, tests other than the guard itself, and transitive lockfile entries.

Command (Node 24):

```sh
PATH="/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npm test -- --run test/architecture/langchain-only-production-runtime.test.ts
```

Pre-demolition output:

```text
FAIL test/architecture/langchain-only-production-runtime.test.ts
Forbidden legacy production runtime artifacts (86)
Test Files  1 failed (1)
Tests       1 failed (1)
```

The 86 hits covered the local OpenAI Agents runtime package, direct `openai` and `@langchain/langgraph` dependencies/imports, active SDK qualification and latency scripts, Responses executors and tool/session adapters, StateGraph runners/state/nodes/Studio configuration, checkpoint savers, runtime-selection flags, Worker/server construction, route branches, and runtime-only persistence APIs.

## Deletion inventory

The final scoped commit contains 91 changed paths, including 52 deleted files, with 253 insertions and 16,836 deletions. The principal groups are:

- Local runtime/package and dependencies: deleted `packages/openai-agents-runtime`; removed direct `openai`, `@langchain/langgraph`, and local runtime dependencies and their active npm scripts; regenerated the lockfile without those direct dependencies.
- Active scripts: deleted direct-Agent SDK boundary checks, live-text qualification, direct live scenarios, OpenAI geo canary, production latency probe, and the SDK demo server.
- OpenAI execution: deleted Responses executors, KFC SDK agent/tool adapters, tool-session lifecycle, direct-turn service, SDK session buffering/compaction, direct route helpers, and the legacy PVCFC pack/tools tied to that executor.
- LangGraph execution: deleted application-authored graph state/schema/builders, graph runners, model/tool nodes, middleware, observability, Studio entrypoint/configuration, scenario runner, graph-bound proof adapters, and graph-bound pause/resume adapters.
- Checkpoint/session persistence: deleted D1/Postgres LangGraph checkpoint savers and framework SDK-session item CRUD/mutation APIs from memory, D1, and Postgres stores.
- Runtime wiring: removed legacy runtime flags/enums, Worker and server construction, route-selection branches, readiness/proof branches, and graph/checkpoint-only configuration.
- Architecture guard: added `test/architecture/langchain-only-production-runtime.test.ts` as the repository-wide prohibition against reintroducing these artifacts.

## Preserved application-owned behavior

The demolition retains application-owned conversation turns, KFC commerce domain rules, PVCFC fixture/provider semantics, provider registries, confirmation records and authority, authorization and verified-reference checks, run fences, irreversible-operation reservations/idempotency, durable run/delivery outboxes, and historical SQL migrations.

No successful-response stub was added. Routes whose execution implementation was removed remain visible as compile-time seams for Tasks 1B–1D rather than silently fabricating customer behavior.

## Architecture GREEN

Command:

```sh
PATH="/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npm test -- --run test/architecture/langchain-only-production-runtime.test.ts
```

Output:

```text
PASS test/architecture/langchain-only-production-runtime.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)
```

The test completed with one passing test; no forbidden executable production artifact remained.

Additional architecture verification:

```sh
PATH="/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npm run check:architecture
```

```text
Architecture size check passed (459 files, 900-line ceiling with no baseline growth).
```

`git diff --check` also completed successfully.

## Expected typecheck failures

Command:

```sh
PATH="/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npm run typecheck -- --pretty false
```

Expected result: exit status 2. The captured diagnostic grouping was:

```text
total=582
production=64
scripts=9
tests=509
missing_modules=173
removed_contracts=135
inference_cascades=260
```

The failures are grouped by replacement seam as follows:

1. KFC execution seam: active route/runtime modules and evaluation helpers still import the deleted graph builder, agent-turn state, model/tool middleware, or direct KFC executor/adapters. Their downstream route result and presentation types consequently lose inference. Task 1B must supply the LangChain-only KFC execution path.
2. PVCFC execution seam: route/runtime and instruction typing still expects the deleted PVCFC pack/tools and Responses-executor types. Task 1C must supply the LangChain-only PVCFC execution path without changing fixture/provider semantics.
3. Confirmation/resume integration seam: route handlers and customer-run wiring still expect the deleted graph-bound pause-persistence and production-resume adapters. The underlying application-owned confirmation repository, authority, capability checks, reservations, and idempotency remain intact; a replacement execution adapter is required.
4. Downstream scripts/evaluations/proof modules: GenUI, StateGraph, direct-runtime qualification, and evaluation runners import deleted runtime/proof modules or their result types. They must be replaced or retired when the new runtime proof surface exists.
5. Tests: 509 diagnostics are from suites that directly instantiate the deleted runtimes, checkpoint savers, SDK-session APIs, graph proof adapters, and removed route options. These tests are intentionally obsolete at the demolition boundary and must be migrated to the replacement runtime/contracts.

No typecheck diagnostic indicates a surviving forbidden direct OpenAI/OpenAI Agents or LangGraph runtime artifact. The architecture guard is the authoritative executable-source check for that condition.

## Files and commit

The commit is intentionally scoped to the backend demolition paths listed above, the strengthened architecture guard, and this report. Commit subject:

```text
refactor(agent): remove legacy OpenAI and graph runtimes
```

The report is stored in the same commit; the final commit hash is reported by the task handoff.

## Self-review

- Confirmed the guard was RED before any production deletion and recorded the exact 86-hit baseline.
- Confirmed the guard is GREEN after deletion and the general architecture-size check passes.
- Confirmed remaining compiler failures are missing replacement seams or downstream obsolete imports, not surviving forbidden runtime implementations.
- Confirmed application-owned commerce/security/durable-effect behavior was preserved.
- Confirmed no TinyFish or replacement KFC/PVCFC behavior was added.
- Confirmed no fixture content, provider semantics, or historical SQL migration was changed.

## Concerns for follow-up tasks

- The branch is deliberately non-typechecking until Tasks 1B–1D replace the KFC, PVCFC, and confirmation/resume execution adapters and migrate downstream tests/evaluations.
- `@langchain/langgraph` may still appear transitively in `package-lock.json` through maintained packages; it is no longer a direct dependency or executable application import. The guard intentionally checks direct manifests/imports rather than transitive lockfile metadata.
- Routes must remain fail-closed while replacement execution is absent; follow-up work must not use response stubs to hide missing behavior.
