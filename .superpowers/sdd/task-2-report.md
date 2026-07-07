# Task 2 Report: OrderingDataService over generated fixtures

## Implementation summary

- Added [services/kfc-agent-backend/src/ordering/orderingDataService.ts](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/src/ordering/orderingDataService.ts) implementing the fixture-backed query layer for:
  - `searchMenu`
  - `getMenuItem`
  - `getModifierTree`
  - `recommendAddOns`
  - `searchStores`
  - `getStoreAvailability`
  - `checkItemsAvailable`
  - `searchPromotionOffers`
  - `explainPromotion`
  - `validateVoucherInput`
  - `searchContent`
  - `getAllergenEvidence`
- Added `loadOrderingDataService(rootDir)` so later runtime callers can construct the service without reading generated fixture files directly.
- Kept runtime provenance returned by the service narrowed to the ordering `SourceProvenance` contract instead of leaking raw generated fixture provenance shapes.

## Tests and outputs

### 1. Required red test before implementation

Command:

```bash
cd services/kfc-agent-backend
npm test -- --run test/ordering/ordering-data-service.test.ts
```

Result:

```text
FAIL  test/ordering/ordering-data-service.test.ts
Error: Cannot find module '../../src/ordering/orderingDataService.js'
```

### 2. Focused service tests after implementation

Command:

```bash
cd services/kfc-agent-backend
npm test -- --run test/ordering/ordering-data-service.test.ts
```

Result:

```text
✓ test/ordering/ordering-data-service.test.ts (5 tests)
Test Files  1 passed (1)
Tests       5 passed (5)
```

### 3. Backend build

Command:

```bash
cd services/kfc-agent-backend
npm run build
```

Result:

```text
> kfc-agent-backend@0.1.0 build
> tsc -p tsconfig.json
```

Build completed successfully with exit code 0.

## Files changed

- [services/kfc-agent-backend/src/ordering/orderingDataService.ts](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/src/ordering/orderingDataService.ts)
- [services/kfc-agent-backend/test/ordering/ordering-data-service.test.ts](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/test/ordering/ordering-data-service.test.ts)

## Self-review findings

- Verified the service only depends on `GeneratedFixtures` and the fixture loader, not raw JSON or CSV parsing at call sites.
- Verified the public return shapes use `SourceProvenance` rather than the more specific generated provenance objects; this required a small type fix after the first build.
- Verified the focused tests hit the intended runtime behaviors: Vietnamese menu search, modifier lookup, store search plus availability, public voucher non-exposure, and allergen evidence lookup.
- Adjusted the modifier-tree assertion to match current generated fixture content for item `20751` (`Burger Tôm` is present; `Pepsi` is not in that tree).

## Concerns

- None for Task 2 scope. The service is isolated and verified by focused tests plus a clean TypeScript build.

---

## Review fix follow-up (2026-07-08)

### Reviewer findings fixed

1. `checkItemsAvailable` no longer treats missing store availability or missing disposition payloads as implicitly safe. Missing data now returns `ok: false`, marks all checked items unavailable, and preserves source provenance from the availability fixture when present or the generated availability file when the store record is missing.
2. `validateVoucherInput` no longer collapses unknown inputs into `public_code_not_exposed`. Unknown text now returns `not_found`; matched active public offers without reusable codes return `public_code_not_exposed`; matched expired offers or exposed codes return `expired`.
3. Promotion date, channel, and subtotal semantics are now applied in `searchPromotionOffers`, and voucher validation uses an injectable `currentDate` seam for stable tests against the stated review date `2026-07-08` in `Asia/Ho_Chi_Minh`.
4. `getAllergenEvidence` no longer falls back to the first allergen page for unmatched queries.
5. `searchStores` no longer fabricates fallback store results on no-match queries.
6. Ordering service tests were broadened to cover the negative cases above.

### Changed files

- [services/kfc-agent-backend/src/ordering/orderingDataService.ts](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/src/ordering/orderingDataService.ts)
- [services/kfc-agent-backend/test/ordering/ordering-data-service.test.ts](/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend/test/ordering/ordering-data-service.test.ts)

### Commands

```bash
cd services/kfc-agent-backend && npm test -- --run test/ordering/ordering-data-service.test.ts
cd services/kfc-agent-backend && npm run build
```

### Outputs

```text
> kfc-agent-backend@0.1.0 test
> vitest run --run test/ordering/ordering-data-service.test.ts

RUN  v3.2.7 /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend

✓ test/ordering/ordering-data-service.test.ts (13 tests) 266ms

Test Files  1 passed (1)
Tests       13 passed (13)
```

```text
> kfc-agent-backend@0.1.0 build
> tsc -p tsconfig.json
```
