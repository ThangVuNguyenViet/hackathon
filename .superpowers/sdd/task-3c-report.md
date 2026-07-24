# Task 3C Report: LangSmith Observability Boundary

## Implemented

- Extended the provider-neutral business-pack invocation contract with optional
  LangChain callbacks and a generic active-context runner.
- Attached those callbacks to the sole `createAgent.invoke` call in
  `runtime/kernel.ts` and executed the invocation inside the active root trace.
  The kernel has no KFC, LangSmith, or observability imports.
- Added server-owned root correlation for session, durable run, canonical turn,
  pack ID/version, configured candidate/profile/transport, response profile,
  and channel. Scenario/probe IDs are read only through the existing branded
  `AgentTraceContext`; request/model metadata is not consulted.
- Added bounded allowlists for trace inputs, metadata, tags, and outputs.
  Customer/model prose, tool arguments/results, addresses, payment/auth data,
  provider payloads, and error messages are dropped before transport.
- Corrected the completion summary from `toolCalls` to `toolCallCount`, retained
  a compatibility normalization for the old field, and added only bounded
  response-character counts.
- Removed dead event-era LangSmith metadata handling for raw-event digests and
  session digests.
- Scheduled trace flushing outside the product response path using the existing
  server/Worker deferral hook. Callback acquisition, active-context, end/fail,
  flush, quota, and scheduling failures remain best-effort diagnostics and do
  not fail the customer turn.
- Kept diagnostics out of D1 and removed provider error prose from diagnostic
  logs. The dashboard product read model is unchanged.

## TDD Evidence

Initial RED:

```text
npm test -- test/runtime/kernel.test.ts \
  test/businessPacks/kfc-vietnam-pack.test.ts \
  test/observability/langsmith-agent-tracer.test.ts

Test Files  3 failed (3)
Tests       4 failed | 11 passed (15)
```

The failures proved that callbacks did not reach the model/tool loop, the
active context was unused, pack invocation carried no callback runtime, root
inputs were unsanitized, and no strict input sanitizer existed.

Two later focused RED checks proved that the old raw-event/session-digest
metadata still crossed the trace boundary and that diagnostic logs could echo
provider error text. Both were removed before the final GREEN run.

Final focused GREEN:

```text
Test Files  3 passed (3)
Tests       16 passed (16)
```

Coverage includes model and tool child callbacks, active trace execution,
trusted root correlation, scenario/probe authority, strict privacy allowlists,
field normalization, callback/context/quota failure fail-open behavior,
deferred trace flushing, safe diagnostics, and neutral-kernel imports.

## Verification

From `services/kfc-agent-backend`:

```text
npm test
Test Files  26 passed (26)
Tests       114 passed (114)

npm run typecheck
npm run lint
npm run build
npm run worker:deploy:dry-run
git diff --check
```

All passed. Wrangler completed a dry-run package with no deployment.

The repository-wide `npm run format:check` was temporarily blocked by the
concurrent Task 3D untracked file `src/security/messengerIngressClaim.ts`.
A scoped Prettier check over every Task 3C source and test file passed. Task 3D
files were preserved and not reformatted.

## Files Changed

- `services/kfc-agent-backend/src/agent/agentTurn.ts`
- `services/kfc-agent-backend/src/api/routeAgentRuntime.ts`
- `services/kfc-agent-backend/src/api/routeMessengerRuntime.ts`
- `services/kfc-agent-backend/src/businessPacks/kfcVietnam/kfcVietnamPack.ts`
- `services/kfc-agent-backend/src/observability/langsmithAgentTracer.ts`
- `services/kfc-agent-backend/src/runtime/businessPack.ts`
- `services/kfc-agent-backend/src/runtime/kernel.ts`
- `services/kfc-agent-backend/test/businessPacks/kfc-vietnam-pack.test.ts`
- `services/kfc-agent-backend/test/observability/langsmith-agent-tracer.test.ts`
- `services/kfc-agent-backend/test/runtime/kernel.test.ts`
- `.superpowers/sdd/task-3c-report.md`

## Explicit Exclusions

- No Messenger queue/envelope implementation or live scenario harness changes.
- No D1 schema or persistence changes.
- No dashboard read-model changes.
- No live model, LangSmith network, remote D1, deployment, or qualification run.
