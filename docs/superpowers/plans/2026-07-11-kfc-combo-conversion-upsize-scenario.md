# KFC Combo Conversion and Upsize Scenario Implementation Plan

> **Superseded implementation plan (2026-07-20).** The scenario remains
> canonical, but the `StaticToolPlanner` implementation strategy below does
> not. The active runtime uses one explicit `@langchain/langgraph`
> `StateGraph`; the model authors semantic tool calls, while deterministic code
> validates schemas, verified state, policy, and execution authority.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Scenario 02 prove a tool-grounded conversion from separate items to two matching combos, followed by a consented four-drink upsize.

**Architecture:** Keep JSON as the executable source and synchronize both Markdown copies. Extend the deterministic planner with actual fixture item codes and modifiers, then align live-planner expectations with the new consent boundaries.

**Tech Stack:** TypeScript, Vitest, JSON scripts, Markdown, fixture-backed ordering tools.

## Global Constraints

- Preserve nine scenarios and complete UC-01 through UC-39 coverage.
- Use combo `20752` and large-Pepsi modifier `41091` from current fixtures.
- Never convert or upsize before explicit customer consent.
- Do not modify production behavior, fixtures, or unrelated workspace files.

---

### Task 1: Define and implement the revised script contract

**Files:**
- Modify: `services/kfc-agent-backend/test/scenarios/scenario-script.test.ts`
- Modify: `ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json`
- Modify: `ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.md`
- Modify: `docs/testing-scenarios.md`

**Interfaces:**
- Consumes: `loadScenarioScript(filePath: string): Promise<ScenarioScript>`.
- Produces: One canonical five-user-turn script and synchronized Markdown copies.

- [ ] **Step 1: Write a failing contract test**

```ts
it('loads the combo conversion and accepted upsize contract', async () => {
  const script = await loadScenarioScript(
    join(process.cwd(), '../../ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json'),
  );
  expect(script.finalState).toBe('cart_ready');
  expect(script.userTurns.map((turn) => turn.text)).toEqual(expect.arrayContaining([
    expect.stringContaining('10 miếng gà'),
    expect.stringContaining('đổi sang 2 Combo Đẫy Đà 129K'),
    expect.stringContaining('nâng cả 4 Pepsi lên size đại'),
  ]));
  expect(script.expectations).toEqual(expect.arrayContaining([
    expect.stringContaining('146.000đ'),
    expect.stringContaining('286.000đ'),
    expect.stringContaining('không tự đổi'),
  ]));
});
```

- [ ] **Step 2: Verify the old script fails the contract**

Run: `cd services/kfc-agent-backend && npm test -- --maxWorkers=1 --no-file-parallelism test/scenarios/scenario-script.test.ts`

Expected: FAIL because the old script lacks the new consent and upsize turns.

- [ ] **Step 3: Rewrite Scenario 02 and its mirrors**

Use these user turns with paired bot responses:

```json
[
  "Không biết ăn gì, gợi ý cho nhóm 4 người với, ngân sách khoảng 300k.",
  "Hôm nay có ưu đãi gì phù hợp không?",
  "Món gà nào bán chạy? Nếu gọi lẻ thì cho mình 10 miếng gà rán và 4 Pepsi tiêu chuẩn.",
  "Hợp lý đó, đổi sang 2 Combo Đẫy Đà 129K giúp mình.",
  "Ok, nâng cả 4 Pepsi lên size đại luôn nhé."
]
```

Bot copy must state separate items `404.000đ`, two combos `258.000đ`, savings `146.000đ`, upsize delta `28.000đ`, and final total `286.000đ`. Retain all existing Scenario 02 use cases across the turns. Copy the same table and expectations into both Markdown documents.

- [ ] **Step 4: Verify the contract passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit the synchronized script contract**

```bash
git add services/kfc-agent-backend/test/scenarios/scenario-script.test.ts ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.md docs/testing-scenarios.md
git commit -m "test(kfc): define combo conversion upsize scenario"
```

---

### Task 2: Prove the converted and upsized cart deterministically

**Files:**
- Modify: `services/kfc-agent-backend/test/scenarios/scenario-replay.test.ts`

**Interfaces:**
- Consumes: `StaticToolPlanner` and fixture-backed ordering tools.
- Produces: Two combo `20752` lines at `143000` VND per unit with no separate-item remnants.

- [ ] **Step 1: Replace `createScenario02Planner()` with five outputs**

Use these calls in user-turn order:

```ts
// Discover and promotion turns: lookup only, no cart mutation.
{ toolName: 'searchMenu', arguments: { query: 'combo nhóm 4 người dưới 300k' } }
{ toolName: 'searchPromotions', arguments: { query: 'ưu đãi nhóm dưới 300k' } }

// Build requested separate cart and inspect the matching combo.
{ toolName: 'updateCart', arguments: { itemCode: '41037', quantity: 3 } }
{ toolName: 'updateCart', arguments: { itemCode: '41035', quantity: 1 } }
{ toolName: 'updateCart', arguments: { itemCode: '41074', quantity: 4 } }
{ toolName: 'getItemDetails', arguments: { code: '20752' } }
{ toolName: 'previewCart', arguments: {} }

// Accepted conversion.
{ toolName: 'updateCart', arguments: { itemCode: '41037', quantity: 0 } }
{ toolName: 'updateCart', arguments: { itemCode: '41035', quantity: 0 } }
{ toolName: 'updateCart', arguments: { itemCode: '41074', quantity: 0 } }
{ toolName: 'updateCart', arguments: { itemCode: '20752', quantity: 2 } }
{ toolName: 'getModifierOptions', arguments: { code: '20752' } }
{ toolName: 'previewCart', arguments: {} }

// Accepted upsize.
{ toolName: 'updateCart', arguments: {
  itemCode: '20752', quantity: 2, modifiers: [
    { groupId: '2', groupName: 'Drink 1', modifierId: '41091', modifierName: 'Pepsi (Đại)', quantity: 1, priceDeltaVnd: 7000 },
    { groupId: '3', groupName: 'Drink 2', modifierId: '41091', modifierName: 'Pepsi (Đại)', quantity: 1, priceDeltaVnd: 7000 },
  ],
} }
{ toolName: 'previewCart', arguments: {} }
```

Include `searchMenu` on the separate-item turn and `getModifierOptions` in `expectedToolNames`.

- [ ] **Step 2: Replace Scenario 02 final-cart assertions**

```ts
expect(result.cart?.items).toEqual([
  expect.objectContaining({ itemCode: '20752', quantity: 2, unitPriceVnd: 143000 }),
]);
expect(result.cart?.subtotalVnd).toBe(286000);
expect(result.cart?.totalVnd).toBe(286000);
expect(result.cart?.items.some((item) => ['41037', '41035', '41074'].includes(item.itemCode))).toBe(false);
```

- [ ] **Step 3: Run deterministic replay**

Run: `cd services/kfc-agent-backend && npm test -- --maxWorkers=1 --no-file-parallelism test/scenarios/scenario-replay.test.ts`

Expected: all nine scenarios PASS; Scenario 02 ends at `cart_ready` with total `286000`.

- [ ] **Step 4: Commit deterministic proof**

```bash
git add services/kfc-agent-backend/test/scenarios/scenario-replay.test.ts
git commit -m "test(kfc): prove combo conversion and drink upsize"
```

---

### Task 3: Align live-AI consent expectations

**Files:**
- Modify: `services/kfc-agent-backend/test/scenarios/live-ai-scenario-replay.test.ts`

**Interfaces:**
- Consumes: `LiveScenarioCase.turnExpectations`.
- Produces: Five turn-level tool expectations matching the revised script.

- [ ] **Step 1: Replace Scenario 02 expectations**

```ts
turnExpectations: [
  { turnIndex: 1, requiredGroups: [['searchMenu', 'recommendStarter']], forbiddenTools: ['updateCart'] },
  { turnIndex: 3, requiredGroups: [['searchPromotions', 'explainPromotion', 'validateVoucher']], forbiddenTools: ['updateCart'] },
  { turnIndex: 5, requiredGroups: [['searchMenu'], ['updateCart'], ['getItemDetails', 'recommendModifierUpsell'], ['previewCart']] },
  { turnIndex: 7, requiredGroups: [['updateCart'], ['getModifierOptions'], ['previewCart']] },
  { turnIndex: 9, requiredGroups: [['updateCart'], ['previewCart']] },
],
```

- [ ] **Step 2: Run the structural test**

Run: `cd services/kfc-agent-backend && npm test -- --maxWorkers=1 --no-file-parallelism test/scenarios/live-ai-scenario-replay.test.ts`

Expected: credential-gated calls skip cleanly or pass, and UC coverage remains complete.

- [ ] **Step 3: Commit live expectations**

```bash
git add services/kfc-agent-backend/test/scenarios/live-ai-scenario-replay.test.ts
git commit -m "test(kfc): evaluate combo and upsize consent flow"
```

---

### Task 4: Run complete verification

**Files:**
- Verify only: all Task 1 through Task 3 files.

**Interfaces:**
- Consumes: synchronized scenario and replay suites.
- Produces: Fresh deterministic and full-live evidence.

- [ ] **Step 1: Run deterministic verification**

Run: `cd services/kfc-agent-backend && npm test -- --maxWorkers=1 --no-file-parallelism test/scenarios/scenario-script.test.ts test/scenarios/scenario-replay.test.ts`

Expected: both files PASS and nine-scenario UC coverage stays green.

- [ ] **Step 2: Run the full live replay**

```bash
cd services/kfc-agent-backend
set -a
. ../../.env
set +a
npm run test:live:scenarios -- --maxWorkers=1 --no-file-parallelism
```

Expected: all nine scenarios PASS. On failure, record scenario, turn, required group, actual tools, and error without presenting deterministic success as a full live pass.

- [ ] **Step 3: Inspect workspace state**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and unrelated files remain untouched.
