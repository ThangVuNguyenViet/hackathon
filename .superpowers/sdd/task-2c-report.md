# Task 2C Report: Retained KFC Ordering Behavior

## Implementation boundary

Task 2C retains the useful OpenAI-session behavior inside the provider-neutral
KFC pack and ordering modules. It does not add a second agent runtime, direct
provider SDK orchestration, a graph, provider/config changes, or live calls.

Implemented:

- structured full-menu and filtered menu discovery;
- independent OR alternatives through `queries`;
- normalized exact/category search and stable evidence-based ranking;
- party-size ranking and per-item price ceilings from catalog evidence;
- compact exact modifier evidence;
- uncapped complete collection envelopes with scope-keyed verified snapshots;
- multiple menu calls in one agent turn;
- one batched reversible `updateCart` call for a complete delegated plan;
- authoritative replacement of current cart state from the returned cart;
- provider-portable model schemas for menu discovery and batched cart changes;
- KFC guidance that total budget is a maximum rather than a spending target,
  every explicit component/quantity should be satisfied when evidence permits,
  safe work should finish in the same turn, and reversible cart permission
  never bypasses irreversible-action authority.

## Donor decision table

| Donor | Selected semantics | Skipped semantics |
| --- | --- | --- |
| `c2753c10` | Full and targeted menu retrieval, normalized matching, uncapped stable results, category/party/price inputs, compact modifier evidence, exact identifiers. Upgraded textual `OR` parsing to a structured `queries` array with explicit OR semantics. | Direct OpenAI tools/agent, provider/config wiring, route/API changes, GenUI changes, catalog gateway changes, and package changes. |
| `2d12c275` | Directly relevant menu corrections only: exact item/identifier ranking, catalog-backed availability, category filtering, per-item price-ceiling meaning, and keeping modifier evidence attached to its exact option. | Administrative/address fixtures, Flutter/UI work, response retry/recovery machinery, membership/payment/handoff work, streaming/health changes, giant prompt rewrite, and all direct SDK code. |
| `64821f6d` | Complete delegated cart-plan semantics: one multi-change reversible call, same-turn completion/correction guidance, returned cart as authority, and persisted tool-loop state. | OpenAI-specific session lifecycle, OpenAI trace persistence, Messenger delivery changes, and any irreversible-action shortcut. |
| `47965a7f` | Retained principle: verified state and tool evidence, never phrase/keyword intent routing. The current KISS runtime already lacks the removed graph heuristics, so no donor code was copied. | Legacy graph/safety/planner code and deterministic language rules. |
| `c6d59ea1` | Retained design principle: semantic routing remains model-driven. | The proposed small-talk router implementation and any `StateGraph` addition. |

## TDD evidence

Observed RED before production implementation:

1. `searchMenuTool is not a function` for complete full-menu retrieval.
2. Structured alternative/category/price/party/modifier tests returned the
   unfiltered full menu and no modifier evidence.
3. The provider-visible schema exposed only `scope/query` instead of structured
   discovery fields.
4. Pack lifecycle invocation rejected the new structured call; after the
   lifecycle was added, the strict KFC state parser rejected persisted modifier
   evidence until its schema was extended.

No scripted scenario, exact assistant response, deterministic word dictionary,
or live provider call is used in these tests.

## Verification

Run from `services/kfc-agent-backend`:

```text
npx prettier --write <Task 2C files>
npm test -- test/ordering/menu-search.test.ts \
  test/agent/provider-portable-tool-schema.test.ts \
  test/businessPacks/kfc-vietnam-pack.test.ts \
  test/runtime/kernel.test.ts \
  test/runtime/pack-state-envelope.test.ts
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
git diff --check
```

Results:

- focused Vitest: 5 files, 19 tests passed;
- full Vitest: 13 files, 58 tests passed;
- ESLint: passed with zero warnings;
- TypeScript typecheck: passed;
- clean build: passed;
- format and diff checks: passed.

## Explicit exclusions

- no `StateGraph`;
- no direct OpenAI SDK;
- no D1 trace persistence;
- no provider, config, deployment, package, or credential change;
- no fixture/UI/address bulk import;
- no live network;
- no PVCFC;
- neutral kernel unchanged.
