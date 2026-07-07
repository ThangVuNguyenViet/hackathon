# Task 3 Report

## Implementation summary

Implemented Task 3 in the scoped backend client/mock surface:

- Expanded `ExternalClients` and related client interfaces in `services/kfc-agent-backend/src/clients/interfaces.ts` to cover:
  - `menu.getModifierOptions`
  - `cart.updateCart(..., modifiers?)`
  - `promotion.searchPromotions`
  - `promotion.explainPromotion`
  - `promotion.validateVoucherInput`
  - `inventory.checkInventory(..., disposition?)`
  - `storeLocator.findStores`
  - new `fulfillment`, `content`, and `invoice` clients
- Reworked `services/kfc-agent-backend/src/mock/createMockClients.ts` so fixture-backed menu, promotion, inventory, store, fulfillment, and content behavior goes through `OrderingDataService` instead of duplicating raw fixture queries.
- Preserved the existing natural-language menu-search test seam by normalizing user chat phrasing before routing the query into `OrderingDataService`.
- Added focused fixture coverage in `services/kfc-agent-backend/test/fixtures/testFixtures.ts` for:
  - modifier tree data for item `20751`
  - a non-public `KFC50` voucher offer that resolves to `public_code_not_exposed`
  - allergen content for `phô mai`
- Added the four Task 3 mock-client tests in `services/kfc-agent-backend/test/mock/mock-clients.test.ts`.

## Tests and outputs

### Red step

Command:

```bash
cd services/kfc-agent-backend
npm test -- --run test/mock/mock-clients.test.ts
```

Result:

- Failed as expected.
- Missing behavior surfaced in the right places:
  - `clients.menu.getModifierOptions is not a function`
  - `clients.fulfillment` missing
  - `clients.content` missing
  - voucher validation still returned hardcoded success for `KFC50`

### Green verification

Command:

```bash
cd services/kfc-agent-backend
npm test -- --run test/mock/mock-clients.test.ts
```

Result:

- Passed
- `9` tests passed in `test/mock/mock-clients.test.ts`

### Build verification

Command:

```bash
cd services/kfc-agent-backend
npm run build
```

Result:

- Passed
- One intermediate TypeScript helper-signature error was fixed, then build passed cleanly on rerun

## Files changed

- `services/kfc-agent-backend/src/clients/interfaces.ts`
- `services/kfc-agent-backend/src/mock/createMockClients.ts`
- `services/kfc-agent-backend/test/fixtures/testFixtures.ts`
- `services/kfc-agent-backend/test/mock/mock-clients.test.ts`

## Self-review findings

- Scope check: changes stayed inside the four Task 3 files named in the brief.
- Fixture access check: mock clients no longer perform direct raw fixture searching for the new behavior; they delegate to `OrderingDataService`.
- Regression check: existing natural Vietnamese menu search coverage still passes after the service-backed switch.
- Constraint check: voucher success is no longer hardcoded in the mock promotion client; the result now comes from fixture-backed validation.

## Concerns

- `fulfillment.quoteFulfillment` still uses the brief-prescribed fixed `feeVnd` and `etaMinutes` values after choosing a fixture-backed store and availability result. That matches the Task 3 brief, but those two values are not currently fixture-derived.

## Task 3 Fix Addendum - 2026-07-08

### Findings fixed

- Critical 1 fixed: `storeLocator.assignStore()` no longer manufactures `store_mock_nearest`, no longer falls back to the first city match, and now fails with `store_not_found` when the address cannot be resolved from fixture-backed store search.
- Important 2 fixed: `fulfillment.quoteFulfillment()` no longer hardcodes normal-business `feeVnd`/`etaMinutes`. It now requires an injected `fulfillmentQuoteProvider` seam after store and availability resolution, and fails with `fulfillment_quote_unavailable` when no quote seam is configured.

### Changed files

- `services/kfc-agent-backend/src/clients/interfaces.ts`
- `services/kfc-agent-backend/src/mock/createMockClients.ts`
- `services/kfc-agent-backend/test/mock/mock-clients.test.ts`

### Added/updated test coverage

- unresolved store assignment returns `store_not_found`
- `quoteFulfillment` succeeds only when the injected quote seam returns fee/ETA
- `quoteFulfillment` fails with `fulfillment_quote_unavailable` when no quote seam is configured
- existing fixture-backed menu, content, and `KFC50` rejection behavior remains covered

### Commands and outputs

Command:

```bash
cd services/kfc-agent-backend && npm test -- --run test/mock/mock-clients.test.ts
```

Output:

- Passed
- `1` test file passed
- `11` tests passed in `test/mock/mock-clients.test.ts`

Command:

```bash
cd services/kfc-agent-backend && npm run build
```

Output:

- First rerun exposed a return-type mismatch from the new quote seam error path in `src/mock/createMockClients.ts`
- After narrowing that error return to a fulfillment-specific failure result, `tsc -p tsconfig.json` passed cleanly
