# Task 1 Report: Shared Conversation Metadata And Profiles

## What you implemented

- Added the shared domain contracts in `services/kfc-agent-backend/src/domain/types.ts`:
  - `ConversationAttachment`
  - `ConversationTurnMetadata`
  - `ConversationProfile`
  - `ConversationTurn.metadata: ConversationTurnMetadata | null`
- Extended `ConversationStore` in `services/kfc-agent-backend/src/persistence/memoryStore.ts` with:
  - `upsertProfile(input: ConversationProfile): Promise<ConversationProfile>`
  - `getProfile(channel, externalUserId): Promise<ConversationProfile | undefined>`
- Implemented profile storage and turn-metadata persistence in `MemoryStore`.
- Implemented D1 schema/mapping support in `services/kfc-agent-backend/src/persistence/d1Store.ts` for:
  - `conversation_turns.metadata`
  - `conversation_profiles`
  - `upsertProfile`
  - `getProfile`
  - metadata serialization/deserialization on turn writes and reads
- Implemented the same metadata/profile support in `services/kfc-agent-backend/src/persistence/postgresStore.ts`, using `jsonb` for turn metadata.
- Updated `services/kfc-agent-backend/migrations/0001_worker_runtime.sql` with the Task 1 migration statements for turn metadata and conversation profiles.
- Added the briefed persistence tests in:
  - `services/kfc-agent-backend/test/persistence/memory-store.test.ts`
  - `services/kfc-agent-backend/test/persistence/d1-store.test.ts`
- Updated `services/kfc-agent-backend/test/support/fakeD1Database.ts` so the D1 test harness understands the new `conversation_profiles` table, `ALTER TABLE conversation_turns ADD COLUMN metadata TEXT`, and metadata-bearing turn rows.

## Tests run and exact results

### RED

Command:

```bash
cd services/kfc-agent-backend
npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts
```

Result:

```text
RUN  v3.2.7 /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
❯ test/persistence/d1-store.test.ts (2 tests | 1 failed)
  × D1Store > persists profile rows and turn metadata in D1
    → store.upsertProfile is not a function
❯ test/persistence/memory-store.test.ts (6 tests | 1 failed)
  × MemoryStore > stores turn metadata and channel customer profiles
    → store.upsertProfile is not a function

Test Files  2 failed (2)
Tests  2 failed | 6 passed (8)
```

Summary:
- The brief expected a missing-feature failure.
- In this repo the first RED signal was a runtime missing-method failure (`store.upsertProfile is not a function`), rather than TypeScript compile errors.

### Intermediate fix verification

Command:

```bash
cd services/kfc-agent-backend
npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts
```

Result:

```text
RUN  v3.2.7 /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
✓ test/persistence/memory-store.test.ts (6 tests)
❯ test/persistence/d1-store.test.ts (2 tests | 1 failed)
  × D1Store > persists profile rows and turn metadata in D1
    → Unsupported fake D1 run query: INSERT INTO conversation_profiles ...

Test Files  1 failed | 1 passed (2)
Tests  1 failed | 7 passed (8)
```

Summary:
- Store implementation was in place.
- The remaining failure was isolated to the fake D1 harness not yet supporting the new schema/query shape.

### GREEN

Command:

```bash
cd services/kfc-agent-backend
npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts
```

Result:

```text
RUN  v3.2.7 /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
✓ test/persistence/memory-store.test.ts (6 tests) 4ms
✓ test/persistence/d1-store.test.ts (2 tests) 4ms

Test Files  2 passed (2)
Tests  8 passed (8)
```

## TDD Evidence

### RED command/output summary

- Command: `cd services/kfc-agent-backend && npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts`
- Observed failure:
  - `MemoryStore > stores turn metadata and channel customer profiles`
  - `D1Store > persists profile rows and turn metadata in D1`
  - Both failed because `upsertProfile` did not exist yet.

### GREEN command/output summary

- Command: `cd services/kfc-agent-backend && npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts`
- Observed pass:
  - `2` test files passed
  - `8` tests passed
  - No failing persistence assertions remained

## Files changed

- `services/kfc-agent-backend/src/domain/types.ts`
- `services/kfc-agent-backend/src/persistence/memoryStore.ts`
- `services/kfc-agent-backend/src/persistence/d1Store.ts`
- `services/kfc-agent-backend/src/persistence/postgresStore.ts`
- `services/kfc-agent-backend/migrations/0001_worker_runtime.sql`
- `services/kfc-agent-backend/test/persistence/memory-store.test.ts`
- `services/kfc-agent-backend/test/persistence/d1-store.test.ts`
- `services/kfc-agent-backend/test/support/fakeD1Database.ts`

## Self-review findings

- The main persistence contract now matches the brief:
  - profiles are addressable by `(channel, externalUserId)`
  - turn metadata is nullable and preserved across read/write paths
  - D1 and Postgres use the same external store interface
- I removed an older `channel_customer_profiles` shape from the migration path so the persisted schema matches the Task 1 brief.
- The implementation stayed narrowly focused on persistence/domain support and did not touch the unrelated dirty files the workspace note called out.

## Any issues or concerns

- `services/kfc-agent-backend/test/support/fakeD1Database.ts` was not listed in the brief, but it had to be updated for the D1 test in the brief to execute against the new `conversation_profiles` schema and metadata column shape. No unrelated harness behavior was changed.
- I did not run a full repo typecheck/build. I ran only the exact test command requested by the brief.

---

## Review fix follow-up (2026-07-09)

### What I fixed

- Added `metadata: null` at the Task 1 `ConversationTurn` call sites that the review flagged and that were still constructing turns without metadata:
  - `src/graph/buildGraph.ts`
  - `src/channels/messengerHistory.ts`
  - `test/api/chat.test.ts`
  - `test/channels/messenger-webhook.test.ts`
- Removed the unconditional D1 runtime schema mutation:
  - `src/persistence/d1Store.ts` now defines `conversation_turns.metadata` directly in the `CREATE TABLE IF NOT EXISTS conversation_turns` statement.
  - The unconditional `ALTER TABLE conversation_turns ADD COLUMN metadata TEXT` statement was removed from the D1 initializer list.
- Removed the same duplicate-column hazard from the initial Worker migration:
  - `migrations/0001_worker_runtime.sql` now declares `metadata TEXT` in the `conversation_turns` table definition and no longer runs an unconditional `ALTER TABLE`.
- Added a focused D1 regression test that calls `initialize()` twice and verifies writes still succeed afterward.

### Tests/commands run and exact results

- `cd services/kfc-agent-backend && npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts`
  - Result: passed
  - Output summary: `2` test files passed, `9` tests passed, `0` failed
- `cd services/kfc-agent-backend && npx tsc --noEmit`
  - Result: failed with one unrelated existing dirty-worktree error outside Task 1
  - Remaining error:
    - `scripts/run-live-ai-replay.ts(6,35): error TS2307: Cannot find module '../src/scenarios/parser.js' or its corresponding type declarations.`
  - The review-flagged Task 1 `ConversationTurn.metadata` type errors no longer appear.

### Files changed

- `services/kfc-agent-backend/src/graph/buildGraph.ts`
- `services/kfc-agent-backend/src/channels/messengerHistory.ts`
- `services/kfc-agent-backend/test/api/chat.test.ts`
- `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`
- `services/kfc-agent-backend/src/persistence/d1Store.ts`
- `services/kfc-agent-backend/migrations/0001_worker_runtime.sql`
- `services/kfc-agent-backend/test/persistence/d1-store.test.ts`

### Self-review

- Scope stayed within the two review issues:
  - missing `metadata` at Task 1 turn construction/import call sites
  - non-idempotent D1 initialization for the `metadata` column
- I did not touch unrelated dirty README/package/tool-planner/scenario work.
- The D1 fix is safe for repeated `initialize()` calls because the initializer now uses only idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements for the `metadata` column path.

---

## Second review fix follow-up (2026-07-09)

### What I fixed

- Added forward D1 migration `services/kfc-agent-backend/migrations/0002_conversation_profiles_and_metadata.sql` for deployed Worker databases.
  - It adds `conversation_turns.metadata` for existing D1 schemas.
  - It creates `conversation_profiles` if missing.
- Reverted `services/kfc-agent-backend/migrations/0001_worker_runtime.sql` to the base Worker runtime schema so a fresh D1 migration sequence `0001 -> 0002` does not duplicate-add `metadata` or recreate Task 1 schema changes in the wrong migration.
- Hardened `services/kfc-agent-backend/src/persistence/d1Store.ts` initialization for old local/test schemas:
  - keep latest-schema `CREATE TABLE IF NOT EXISTS` statements for fresh local/test databases
  - check `PRAGMA table_info(conversation_turns)` before adding `metadata`
  - check `sqlite_master` before creating `conversation_profiles`
  - keep repeated `initialize()` calls idempotent
- Added a focused D1 regression test for an old `conversation_turns` table without `metadata`, then verified `initialize()` upgrades it before a metadata-bearing append/list flow.
- Expanded the fake D1 harness only enough to model table schemas, `PRAGMA table_info`, `sqlite_master`, and `ALTER TABLE ... ADD COLUMN` so the regression test proves the upgrade path instead of passing accidentally.

### Tests/commands run and exact results

- `cd services/kfc-agent-backend && npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts`
  - Result: passed
  - Output summary: `2` test files passed, `10` tests passed, `0` failed
- `cd services/kfc-agent-backend && npx tsc --noEmit`
  - Result: passed
  - Output summary: exited `0` with no TypeScript errors

### Files changed

- `services/kfc-agent-backend/migrations/0001_worker_runtime.sql`
- `services/kfc-agent-backend/migrations/0002_conversation_profiles_and_metadata.sql`
- `services/kfc-agent-backend/src/persistence/d1Store.ts`
- `services/kfc-agent-backend/test/persistence/d1-store.test.ts`
- `services/kfc-agent-backend/test/support/fakeD1Database.ts`

### Self-review

- The migration path now covers both cases the review called out:
  - deployed D1 databases receive a forward-only upgrade through `0002`
  - old local/test schemas are upgraded safely by `D1Store.initialize()` before code inserts into `conversation_turns.metadata`
- `0001` and `0002` are now consistent for fresh Worker migration application; the duplicate-column path is removed.
- The new D1 regression test would fail without the schema-upgrade logic because the fake D1 harness now enforces actual table/column presence.
