# Task 2A Report: Provider-Neutral Kernel and KFC Pack

## Implementation commit

- `4d7ca291dde659635bd5595534814f83e8908aec`
  (`feat(kfc): extract neutral semantic kernel`)

## Files

- `services/kfc-agent-backend/src/runtime/businessPack.ts`
  - `BusinessPack` / `PackRef` contracts
  - trusted in-process registry bindings
  - versioned typed state envelopes with canonical SHA-256 integrity checks
- `services/kfc-agent-backend/src/runtime/kernel.ts`
  - sole production LangChain `createAgent` invocation
  - trusted registry resolution and optional envelope validation before pack work
- `services/kfc-agent-backend/src/businessPacks/registry.ts`
  - static KFC registry and server-created trusted binding
- `services/kfc-agent-backend/src/businessPacks/kfcVietnam/kfcVietnamPack.ts`
  - KFC instructions, model messages, tool construction/execution, verified
    state loading/projection, and final persistence/presentation lifecycle
- `services/kfc-agent-backend/src/agent/kfcAgent.ts`
  - compatibility-only `runAgentTurn` facade
- `services/kfc-agent-backend/test/runtime/pack-state-envelope.test.ts`
- `services/kfc-agent-backend/test/runtime/kernel.test.ts`
- `services/kfc-agent-backend/test/businessPacks/kfc-vietnam-pack.test.ts`
- `services/kfc-agent-backend/test/architecture/migration-inventory.test.ts`

## TDD evidence

Initial focused RED:

```text
npm test -- test/architecture/migration-inventory.test.ts
```

Result: 3 expected failures. The sole `createAgent` owner was still
`src/agent/kfcAgent.ts`, while `src/runtime/kernel.ts` and the KFC business-pack
file did not exist.

The new runtime/pack tests were then added before their production modules:

```text
npm test -- test/runtime/pack-state-envelope.test.ts \
  test/runtime/kernel.test.ts \
  test/businessPacks/kfc-vietnam-pack.test.ts
```

Result: expected RED because the runtime contract, kernel, and KFC pack modules
did not yet exist.

A later compatibility regression test produced a second precise RED:

```text
npm test -- test/businessPacks/kfc-vietnam-pack.test.ts
```

Result: expected `kfc_agent_model_response_empty`, received the new generic
kernel error. The kernel contract was then made pack-configurable so the KFC
facade preserves its existing error code.

## Final verification

From `services/kfc-agent-backend`:

```text
npm run format
npm test -- test/runtime/pack-state-envelope.test.ts \
  test/runtime/kernel.test.ts \
  test/businessPacks/kfc-vietnam-pack.test.ts \
  test/architecture/migration-inventory.test.ts
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
```

All commands passed:

- focused Vitest: 4 files, 14 tests
- full Vitest: 10 files, 32 tests
- ESLint: pass with zero warnings
- TypeScript typecheck: pass
- clean TypeScript build: pass
- formatting check: pass

## Contract coverage

- one production `createAgent` owner and a neutral kernel import boundary
- no `StateGraph` or direct `openai` package imports
- untrusted, foreign-registry, and unknown pack rejection before pack/model work
- envelope integrity, pack-ref, and schema-version mismatch rejection
- no cross-pack state inference or parsing
- KFC prompt, tools, current verified-state snapshot, presentation, and
  `runAgentTurn` compatibility
- no new generic persistence event

## Concerns and deferred boundaries

- No blocker remains in Task 2A.
- Task 3 still owns the storage cutover. KFC continues to read and write the
  existing `agent:verified_state` compatibility snapshot; the new generic
  envelope is validated in-process but is not persisted yet.
- PVCFC, OpenCode/provider profiles, session model pinning, and capability
  preflight were deliberately not implemented in this task.

## Important review fix: strict KFC state validation

Implementation commit:

- `e3408c5b` (`fix(kfc): validate pack state envelopes`)

The review found that a correctly hashed and versioned KFC envelope still
accepted any object because `parseKfcVerifiedState` used a type cast. The
focused RED proved `{ cart: "corrupt" }` resolved successfully instead of
rejecting.

The fix adds `kfcVerifiedStateSnapshotSchema`, a strict runtime schema for the
persisted `Partial<VerifiedStateSnapshot>` whitelist. It reuses the repository's
authoritative address, availability, verified-ref, payment-authority, fixture,
and evidence schemas, and adds strict KFC schemas where none existed. The pack
now rejects malformed known fields and unknown top-level authority fields.

Focused coverage proves:

- a correctly bound `{ cart: "corrupt" }` envelope is rejected;
- an unknown state-authority field is rejected;
- a valid partial cart envelope is accepted;
- the current legacy `buildVerifiedStateSnapshot` output remains accepted.

The legacy `agent:verified_state` read/write path is unchanged; Task 3 still
owns persistence of generic pack envelopes.

Review-fix verification:

```text
npm run format
npm test -- test/businessPacks/kfc-vietnam-pack.test.ts \
  test/runtime/pack-state-envelope.test.ts \
  test/runtime/kernel.test.ts \
  test/architecture/migration-inventory.test.ts
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
```

All commands passed:

- focused Vitest: 4 files, 15 tests
- full Vitest: 10 files, 33 tests
- ESLint, TypeScript typecheck, clean build, and formatting check: pass
