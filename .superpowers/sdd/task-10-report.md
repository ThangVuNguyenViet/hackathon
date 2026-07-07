# Task 10 Report: Full Verification And Banned Shortcut Audit

## Scope

- Repo: `/Users/vietthangvunguyen/Workspace/hackathon`
- Task brief: `.superpowers/sdd/task-10-brief.md`
- Base commit before task: `59e3c88`
- Constraint followed: targeted fixes only, no revert of unrelated dirty files

## Commands And Results

1. Backend tests

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend && npm test
```

- Initial result: failed
- Failing tests:
  - `test/graph/order-confirmation.test.ts`
    - `asks for clarification instead of claiming cart success when no item matches`
  - `test/graph/ai-tool-graph.test.ts`
    - `suppresses planner success wording when a tool call fails backend validation`
- Failure pattern: dashboard events were emitted for cases that should remain silent because the turn did not reach verified progress.

2. Backend build

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend && npm run build
```

- Initial result: passed
- Post-fix rerun result: passed

3. Banned shortcut audit

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon && rg -n "scenarioOneCart|scenarioOneAddress|scenarioOneOrder|store_mock_nearest|voucherCode === 'KFC50'|applyScenarioEvent|lower\\.includes\\('sunrise city'|lower\\.includes\\('kfc50'|deterministicFallback" services/kfc-agent-backend/src services/kfc-agent-backend/test
```

- Result: no matches
- Interpretation: clean for the banned shortcut patterns listed in the brief

4. Live AI replay smoke

Required only when `OPENAI_API_KEY` is set:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
OPENAI_TOOL_PLANNER_MODEL=gpt-4.1-mini npm run build
OPENAI_TOOL_PLANNER_MODEL=gpt-4.1-mini node dist/scripts/run-live-ai-replay.js ../../ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.md
```

- Result: skipped
- Reason: `OPENAI_API_KEY` was not set in the current environment

## Audit Findings

1. No banned production-path shortcut strings were found by the required grep audit.
2. The real issue was graph-layer dashboard telemetry:
   - `tool_called` session updates were emitted even when tool execution failed validation.
   - `tool_called` session updates were also emitted for `searchMenu` calls that returned no matches.
3. Those emissions caused the backend verification failures because the turn had not produced verified business progress.

## Fixes Applied

File changed:

- `services/kfc-agent-backend/src/graph/buildGraph.ts`

Change made:

- Added `shouldEmitToolCalledEvent(result)` and used it to suppress `session_updated/tool_called` emission when:
  - the tool result is not `ok`
  - `searchMenu` succeeds but returns an empty list

Why this fix is within scope:

- It does not introduce deterministic business behavior.
- It does not modify planner logic, tool execution semantics, payment behavior, promo behavior, or order confirmation rules.
- It is limited to dashboard event emission for non-verified progress cases.

## Verification After Fix

1. Re-ran backend tests:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend && npm test
```

- Result: passed
- Summary: `19` test files passed, `88` tests passed

2. Re-ran backend build:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend && npm run build
```

- Result: passed

3. Re-ran banned shortcut audit:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon && rg -n "scenarioOneCart|scenarioOneAddress|scenarioOneOrder|store_mock_nearest|voucherCode === 'KFC50'|applyScenarioEvent|lower\\.includes\\('sunrise city'|lower\\.includes\\('kfc50'|deterministicFallback" services/kfc-agent-backend/src services/kfc-agent-backend/test
```

- Result: no matches

## Files Changed

- `services/kfc-agent-backend/src/graph/buildGraph.ts`
- `.superpowers/sdd/task-10-report.md`

## Self-Review

- The fix is minimal and directly tied to the observed failures.
- Existing API and scenario tests that rely on verified dashboard events remained green after the change.
- No unrelated dirty files were modified or reverted.

## Concerns

- Live AI replay smoke could not be exercised in this environment because `OPENAI_API_KEY` was unavailable.
