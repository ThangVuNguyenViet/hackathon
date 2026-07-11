# KFC Combo Conversion and Upsize Scenario Design

## Objective

Strengthen the existing `02-tu-van-combo-va-upsell` demo so it proves the commercial behavior requested by the KFC team:

1. A customer initially selects separate menu items.
2. The AI identifies a suitable verified combo based on those selections.
3. The AI explains the combo recommendation and waits for consent.
4. The customer accepts the conversion to the combo.
5. The AI offers a relevant size upgrade with a clear price difference.
6. The customer accepts the upsize and the final cart reflects both decisions.

The scenario demonstrates a successful conversion rather than an upsell rejection.

## Scope

Update the existing Scenario 02 instead of adding a tenth scenario. Keep these synchronized surfaces aligned:

- `ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json`, the executable source of truth.
- `ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.md`, the readable mirror.
- `docs/testing-scenarios.md`, the consolidated scenario guide.
- Deterministic scenario replay planner and assertions.
- Live-AI tool expectations for Scenario 02.

Do not change unrelated scenarios, production ordering behavior, fixture data, or the UC-01 through UC-39 taxonomy.

## Conversation Design

The revised conversation follows one coherent buying journey:

1. After the existing discovery, budget, promotion, and best-seller questions establish the Scenario 02 use cases, the customer asks for ten pieces of fried chicken and four standard Pepsi drinks as separate items for four people with a `300.000đ` target budget.
2. The AI searches the verified menu and prepares or previews the requested cart without silently substituting a combo.
3. The AI detects that two units of fixture item `20752`, `Combo Đẫy Đà 129K`, contain the same ten pieces of fried chicken and four standard Pepsi drinks. It explains that the separate items total `404.000đ`, while two combos total `258.000đ`, saving `146.000đ` and meeting the customer's budget.
4. The customer explicitly accepts replacing the separate items with the suggested combo.
5. The AI removes the superseded items, adds the combo, and previews the updated cart.
6. The AI loads the combo's modifier options and proposes upgrading all four standard Pepsi drinks to large Pepsi drinks for `7.000đ` each, `28.000đ` total. The resulting `286.000đ` cart remains within budget.
7. The customer explicitly accepts the size upgrade.
8. The AI applies the upgrade and confirms the final cart.

The scripted bot turns are expected demo responses, not hard-coded runtime output. Live evaluation checks tool behavior and outcome rather than requiring exact wording.

## Behavioral Rules

- Recommendations must be grounded in menu, item-detail, promotion, or add-on tools.
- The AI must not replace separate items with a combo before explicit customer consent.
- The AI must not apply an upsize before explicit customer consent.
- The initial separate cart must use three units of `41037` (three fried-chicken pieces), one unit of `41035` (one fried-chicken piece), and four units of `41074` (standard Pepsi), totaling ten chicken pieces and four drinks.
- The suggested conversion must be two units of fixture item `20752`, whose verified composition matches the customer's ten pieces of fried chicken and four standard Pepsi drinks.
- The upsize must use combo modifier groups `2` and `3`, selecting large Pepsi modifier `41091` at `7.000đ` per drink.
- The final cart must not retain separate items that were explicitly replaced by the combo.
- The final cart must contain two units of combo `20752`, each priced with two accepted large-Pepsi modifiers.
- Price or savings claims must be supported by tool results available during the turn.

## Verification Design

### Script and documentation checks

- Validate that JSON and Markdown contain the same turns, metadata, use cases, goal, final state, and expectations.
- Preserve complete UC-01 through UC-39 coverage across the scenario corpus.

### Deterministic replay

The Scenario 02 static planner will model these stages:

- Search and inspect the customer's ten pieces of fried chicken and four standard Pepsi drinks.
- Add and preview the initial separate-item cart.
- Search or inspect combo `20752` and recommend it without mutation.
- After acceptance, mutate the cart to remove separate item codes `41037`, `41035`, and `41074`, then add two units of combo `20752` with its default drink modifiers.
- Load modifier options, preview the converted cart, and recommend the two verified large-Pepsi modifiers.
- After acceptance, update combo `20752` with large-Pepsi modifier `41091` in both drink groups. With combo quantity two, this upgrades four drinks. Preview the final cart.

Assertions will verify:

- Required recommendation and cart tools were called.
- No combo conversion or upsize occurs on a pre-consent turn.
- Superseded separate-item codes are absent from the final cart.
- Combo code `20752` is present.
- The combo unit price is `143.000đ`, reflecting two `7.000đ` large-Pepsi modifier deltas. With quantity two, the final subtotal is `286.000đ`, proving that the accepted upsize reached the cart mutation boundary.
- The scenario ends in `cart_ready` with cart and session events emitted.

### Live-AI replay

Turn-level expectations will require catalog grounding on recommendation turns, forbid premature cart mutation, and require `updateCart` plus a cart preview after each accepted change. Exact tool alternatives may remain grouped where the current planner contract permits equivalent verified lookup tools.

### Commands

Run focused deterministic checks first, then the live replay using the workspace environment:

```bash
cd services/kfc-agent-backend
npm test -- --maxWorkers=1 --no-file-parallelism test/scenarios/scenario-script.test.ts test/scenarios/scenario-replay.test.ts
set -a; . ../../.env; set +a
npm run test:live:scenarios -- --maxWorkers=1 --no-file-parallelism
```

If live-model variability causes a failure, report the exact failed turn and tool selection separately from deterministic correctness.

## Success Criteria

The work is complete when Scenario 02 visibly demonstrates separate-item-to-combo conversion and accepted upsize, all synchronized scenario surfaces agree, deterministic replay passes, and the full live scenario replay result is recorded without presenting a partial run as full proof.
