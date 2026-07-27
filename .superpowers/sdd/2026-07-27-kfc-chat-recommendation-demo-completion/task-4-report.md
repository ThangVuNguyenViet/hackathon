# Task 4 Report: Replace the Legacy Add-On Tool

## Status

Implemented and verified from task base
`41fdaee9e486b94cdeb65e975b9e3ea1afe1f1b3`.

The legacy add-on tool has no compatibility alias or remaining backend/monitor
reference. The KFC LangChain agent now exposes three placement-specific
recommendation tools whose semantic inputs are model-authored and whose
identity, cart, customer-history, commerce-snapshot, policy, experiment, and
durable request fields are injected by the server.

## What changed

- Replaced the legacy tool with:
  - `recommendStarter({requestKind})`
  - `recommendModifierUpsell({requestKind, parentCartLineId})`
  - `recommendSmartCrossSell({requestKind})`
- Removed the old client, mock client, fixture-service method, collection
  schema, publication projection, GenUI selector branch, progress mapping,
  evidence contract, and POS boundary.
- Added a dedicated recommendation tool boundary and typed
  `recommended|silent` result.
- Added server-owned recommendation execution authority:
  - durable session/turn identity and turn creation time;
  - current authoritative cart and deterministic cart-line IDs;
  - verified linked-customer reference and completed-order-history result;
  - store, fulfillment, commerce snapshot, policy, and experiment bindings.
- Starter placement is deterministic:
  - For You requires authorized linked identity plus at least one completed
    stored order;
  - all other cases use Local Favorite.
- Empty and suppressed decisions return a typed silent result only after the
  application service has durably consumed the placement.
- Added LangChain model-call middleware which reloads the durable recommendation
  state before every call and publishes only the currently eligible placement
  tool. The completed flow keeps the three tools available for explicit
  customer-requested recommendations while the prompt forbids repeating a
  proactive placement.
- Reloaded the recommendation state after each recommendation tool execution so
  the final agent-state commit cannot overwrite the application service's
  durable placement transition.
- Updated the KFC system prompt to:
  - be slightly proactive only after genuine food/menu/order intent;
  - offer one recommendation at a time in placement order;
  - avoid checkout, fulfillment, payment, and unresolved safety interruptions;
  - use only returned facts and reason codes;
  - keep empty/suppressed results silent;
  - never improvise cart mutations or repeat proactive placements.
- Wired the existing recommendation application service into Fastify chat and
  Messenger agent turns. Recommendation tools remain unavailable when the
  server recommendation service is not configured.

## TDD Evidence

Initial RED runs established the new public seams:

- provider-portable schema test failed before the three schemas existed;
- availability test failed before the durable-state availability module
  existed;
- ordering tool tests failed before the recommendation executor boundary
  existed;
- prompt publication test failed before the recommendation policy was added.

Focused GREEN runs:

```text
provider-portable-tool-schema.test.ts: 3 tests passed
recommendation-tool-availability.test.ts: 2 tests passed
recommendation-tools.test.ts: 5 tests passed
kfc-openai-donor-parity.test.ts: 5 tests passed
```

The donor-parity integration test uses the real bundled recommendation
application service and spies on actual LangChain tool binding. It proves the
first model call receives only `recommendStarter` and the next model call
receives no proactive recommendation tool after the durable starter attempt.

## Required Verification

From `services/kfc-agent-backend`:

```bash
npm run check
npm test
```

Observed:

- format check: passed;
- ESLint: passed with zero warnings;
- TypeScript no-emit typecheck: passed;
- Vitest: 77 files passed, 630 tests passed.

Legacy-reference gate:

```bash
rg -n "recommendAddOns" \
  services/kfc-agent-backend \
  apps/kfc_live_monitor_flutter
```

Observed: no output.

## Self-review

- Re-read the Task 4 brief and checked every named removal surface.
- Confirmed the model schemas reject server-owned session and cart fields.
- Confirmed decision time is derived from durable turn time with a deterministic
  verified-snapshot observation/effective-time floor, preserving the same
  request fingerprint across retry/replay without predating its evidence.
- Confirmed tool availability reloads durable state on every LangChain model
  call rather than trusting a stale invocation-time snapshot.
- Confirmed an application-service placement transition is copied back before
  the pack's final state commit.
- Confirmed the For You gate checks both linked history ownership and a
  non-empty completed-order history.
- Confirmed recommendation tools do not mutate the cart and returned empty or
  suppressed decisions stay typed and silent.
- Confirmed no keyword, phrase, or regular-expression semantic routing,
  `StateGraph`, or direct OpenAI SDK orchestration was added.
- Confirmed `AGENTS.md` and narrative scenario files were not changed.

## Concerns / Deferred Work

- Task 5 owns the new recommendation-offer GenUI surface. Task 4 deliberately
  removes the legacy GenUI selection path without inventing that downstream
  presentation contract.
- Runtime recommendation availability still depends on the server's configured
  Sanity-backed recommendation service, as established by Task 3.

## Fix Round 1

### Findings addressed

- The published prompt now separately requires at most one recommendation and
  at most one recommendation attachment at a time.
- The interruption rule now covers every unresolved customer request, with
  checkout, fulfillment, payment, and safety-sensitive work retained as
  examples rather than the limit of the rule.
- Removed the session-derived order-flow fallback. Recommendation execution now
  requires a server-owned durable product-order-flow binding.
- Bound that identity to the existing verified checkout lifecycle:
  - it remains stable through cart edits and order submission;
  - when a verified cart supersedes its submitted order, it rotates once using
    that predecessor order ID;
  - later edits in the same next order retain the new identity;
  - a later submitted order causes the following product order flow to rotate
    again.
- Persisted and rehydrated the strict versioned product-order-flow binding with
  the KFC pack state.
- Reset recommendation progression only when that durable product-order-flow
  identity changes, and made per-model-call availability prefer the in-memory
  new-flow state until the new binding reaches the durable envelope.
- Updated every historical repository document and plan outside the excluded
  `.superpowers` evidence workspace so the removed identifier has no remaining
  repository reference.

### TDD RED evidence

Prompt publication:

```text
npm test -- --run test/businessPacks/kfc-openai-donor-parity.test.ts
1 test failed, 4 passed: the prompt lacked the one-attachment requirement.
```

Product-order-flow lifecycle:

```text
npm test -- --run test/recommendations/product-order-flow.test.ts
Failed to load product-order-flow.js because the durable lifecycle module did
not exist.
```

Executor binding:

```text
npm test -- --run test/ordering/recommendation-tools.test.ts
1 test failed, 5 passed: the request used the session-derived fallback instead
of the server-bound product order flow.
```

### Focused GREEN evidence

Command:

```bash
npm test -- --run \
  test/businessPacks/kfc-openai-donor-parity.test.ts \
  test/recommendations/product-order-flow.test.ts \
  test/ordering/recommendation-tools.test.ts \
  test/agent/verified-state-projection.test.ts \
  test/recommendations/recommendation-tool-availability.test.ts
```

Observed:

```text
Test Files  5 passed (5)
Tests       17 passed (17)
```

Repository-wide legacy-name gate:

```bash
rg -n "recommendAddOns" . \
  --glob '!.git/**' \
  --glob '!.superpowers/**'
```

Observed: no output.

### Full verification

Command:

```bash
npm run check && npm test
```

Observed after the final fix:

- format check passed;
- ESLint passed with zero warnings;
- TypeScript no-emit typecheck passed;
- Vitest passed 78 files and 632 tests.

### Fix-round self-review

- Confirmed no tool request can derive order-flow identity from session ID.
- Confirmed the order-flow identity is derived only from server-verified cart
  and submitted-order state, never customer prose or model arguments.
- Confirmed the strict binding crosses persistence and hydration.
- Confirmed a new product order flow re-enables the starter placement while
  ordinary edits in the same flow do not.
- Confirmed the prompt publication test covers the exact attachment and
  unresolved-request policies.
- Confirmed the repository-wide excluded-path command returns no matches.
