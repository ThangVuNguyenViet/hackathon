# Legacy Mock Source Elimination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the four retired mock source, session, and route literals from every user-owned tracked surface while preserving protected core-runtime and test files.

**Architecture:** Add a source guard that inventories the explicitly owned fixture, evaluation, scenario, script, backend-test, and documentation surfaces while excluding the three protected tests. Migrate those surfaces to the first-party KFC channel, `kfc:` session namespace, and KFC ingress/action endpoints, then verify focused behavior and a repository scan.

**Tech Stack:** TypeScript, Vitest, JSON, Markdown

---

### Task 1: Owned-surface regression guard

**Files:**
- Create: `services/kfc-agent-backend/test/runtime/legacy-mock-source-elimination.test.ts`

- [ ] Add a guard that scans only owned tracked paths, constructs retired literals from fragments, and excludes protected tests.
- [ ] Run the guard and confirm it fails on existing references.

### Task 2: Fixtures, evaluation, scenarios, and proof scripts

**Files:**
- Modify: `ai-talent-tracks/fnb/conversations/*.json`
- Modify: `services/kfc-agent-backend/src/evaluation/**`
- Modify: `services/kfc-agent-backend/src/scenarios/scenarioScript.ts`
- Modify: `services/kfc-agent-backend/scripts/run-live-ai-replay.ts`
- Modify: `services/kfc-agent-backend/scripts/run-langsmith-context-baseline.ts`
- Modify: owned backend tests except the three protected files

- [ ] Replace retired source/session/route values with current KFC contracts.
- [ ] Run scenario, evaluation, script, and affected unit tests until green.

### Task 3: Tracked documentation and final verification

**Files:**
- Modify: `CONTEXT.md`, backend `README.md`, and `docs/**` files containing retired literals.

- [ ] Rewrite current and historical wording without reproducing retired literals.
- [ ] Run the owned-surface guard, focused tests, typecheck, and a final tracked-content scan.
- [ ] Review `git diff` to confirm protected and unrelated changes were preserved.
