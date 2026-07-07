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
