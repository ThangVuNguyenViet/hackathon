Implementation summary
- Added typed dashboard `session_updated` payload support for Task 9 tool evidence update kinds.
- Emitted `tool_called` from actual tool execution results for every executed tool call, including result summary and provenance.
- Emitted backend dashboard session updates for `fulfillment_quoted`, `promotion_answered`, and `content_evidence_found` from verified graph state transitions.
- Added API coverage proving the monitor events endpoint exposes real voucher-tool evidence and adjusted an existing API assertion to account for the new `session_updated` entries that now precede `cart_changed`.

Tests with commands/results
- `cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend && npm test -- --run test/api/chat.test.ts`
  - Initial result: FAIL before implementation (`tool_called` event missing).
  - Final result: PASS (`6 passed`).
- `cd /Users/vietthangvunguyen/Workspace/hackathon && rg -n "tool_called|session_updated|voucher_rejected|promotion_answered|dashboard/events|updateType" apps/kfc_live_monitor_flutter/lib apps/kfc_live_monitor_flutter/test`
  - Result: Flutter monitor only references `/dashboard/events/...` in the repository layer and does not filter known `updateType` values, so no Flutter compatibility change was required.
- `cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend && npm run build`
  - Result: PASS.

Files changed
- `services/kfc-agent-backend/src/domain/types.ts`
- `services/kfc-agent-backend/src/graph/buildGraph.ts`
- `services/kfc-agent-backend/test/api/chat.test.ts`

Self-review
- Verified Task 9 evidence comes from production tool execution in `runAgentTurn` rather than scenario-only payload injection.
- Kept safety gates unchanged so this task does not loosen promotion, allergen, fulfillment, or order-placement constraints.
- Confirmed the monitor app does not need new event mapping because it does not currently branch on `session_updated.updateType`.

Concerns
- The brief’s sample test used `fixturesRoot: join(process.cwd(), '../..')`, but in this repo that resolves to `/Users/vietthangvunguyen/Workspace/hackathon` and causes fixture loading to fail. The passing test uses `process.cwd()` so the API contract is exercised against the real generated fixtures under `services/kfc-agent-backend/fixtures/generated`.

## Fix (Reviewer Findings 1 and 2)
- Files changed:
  - `services/kfc-agent-backend/src/graph/buildGraph.ts`
  - `services/kfc-agent-backend/src/api/routes.ts`
  - `services/kfc-agent-backend/test/api/chat.test.ts`
- Resulting command outputs:
  - `cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend && npm test -- --run test/api/chat.test.ts`
    - `7 passed`
  - `cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend && npm run build`
    - `PASS`
