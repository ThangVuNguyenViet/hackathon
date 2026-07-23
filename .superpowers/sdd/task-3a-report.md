# Task 3A Report: Durable Context and Typed State

## Implemented

- Kept `conversation_turns` as the canonical transcript and added an atomic,
  monotonic per-session `ordinal`. Memory and D1 append, import, paused-intake,
  non-agent-delivery, and guarded assistant-commit paths now allocate it;
  transcript reads order by ordinal rather than timestamp or ID.
- Added versioned `ConversationSummary` records with revision and
  `throughOrdinal` watermark CAS semantics. Only validated complete exchanges
  can advance the watermark; empty/model failure and stale races preserve the
  prior record.
- Added one current `PackStateEnvelope` projection per
  session/pack/version. KFC validates the Task 2 ref, schema, and SHA-256
  integrity before parsing. Legacy `agent:verified_state` reads are restricted
  to `kfc-vietnam@1.0.0` schema `1` during cutover.
- Added a provider-neutral context assembler that:
  - carries the persisted older summary separately;
  - selects the newest contiguous complete exchanges under an injected async
    token counter and explicit budget;
  - never splits an exchange or includes an orphan incoming user turn;
  - carries typed authoritative business state separately and never submits it
    to the summarizer;
  - has no turn-count or inactivity TTL.
- KFC runtime uses `BaseChatModel.getNumTokens` by default and accepts
  deterministic counter/summarizer injection. An exchange that cannot fit is
  omitted whole and marked oversized; no text is fabricated or truncated.
  Rolling summary generation is fail-open for conversational continuity and
  fail-closed for persistence: the prior summary/watermark remains unchanged.
- Added D1 migration `0021_conversation_context_state.sql` and matching runtime
  initialization/schema support for ordinal, summary, and pack-state records.
  Session reset removes the two new projections. Postgres received only the
  compilation compatibility required by the Task 3A boundary.

## TDD evidence

The first focused RED run failed on the absent ordinal, missing summary/pack
store methods, and missing context assembler:

```text
npm test -- test/persistence/memory-store-contract.test.ts \
  test/persistence/pack-state-projection.test.ts \
  test/session/conversation-context.test.ts
```

The KFC projection RED failed because
`loadVerifiedStateProjection`/`persistVerifiedStateProjection` did not exist.
A later context RED proved malformed orphan exchanges could incorrectly advance
the summary watermark. Each became GREEN after its bounded implementation.

Final focused result: 4 files, 14 tests passed. Coverage includes concurrent
per-session ordinals, complete grouping, token budgets, oversized exchanges,
summary CAS/idempotency/failure, a week-old session with no TTL, typed state
separation, pack isolation/integrity/ref/schema checks, and the KFC-only legacy
fallback.

## Verification

From `services/kfc-agent-backend`:

```text
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
git diff --check
```

All passed. Vitest reported 16 files and 74 tests passing.

Local-only D1 verification:

```text
npm run worker:d1:migrate:local
npx wrangler d1 execute kfc-agent-demo --local --command \
  "SELECT name, sql FROM sqlite_master WHERE name IN (...);"
```

All pending local migrations through `0021_conversation_context_state.sql`
applied successfully. The follow-up query confirmed
`conversation_turns_session_ordinal_idx`, `conversation_summaries`, and
`pack_state_projections`. No remote D1 mutation or live network/model call was
made.

## Explicit exclusions

- No LangSmith callback work, event-log deletion, Messenger ingress change, or
  Postgres migration/removal; those remain Task 3B.
- No `StateGraph`, checkpointer, direct provider SDK, deployment, or live
  qualification.
