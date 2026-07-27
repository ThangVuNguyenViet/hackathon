# Independent evaluation

## Run

- Run ID: `20260727-parity-deepseek-kfc-s02-a1`
- Scenario: `02-tu-van-combo-va-upsell`
- Candidate: `deepseek-v4-flash` via `openai_compatible_chat`
- Reviewed evidence: `codex-review-packet.md`, `transcript.md`, `trace.jsonl`, `manifest.json`, and `preflight.json`
- Evaluation method: narrative and evidence based; no exact wording or exact tool order was required.

## Verdict

**FAIL — not qualified for this narrative.**

The candidate eventually found and accurately identified a suitable 279,000 VND combo, but it did not reach the intended `cart_ready` state, did not produce a usable cart proposal or GenUI action, did not perform the intended drink-size upsell, lost the selected product across turns, and proposed an unsupported chicken-flavor default. The successful capability preflight proves ordinary invocation and typed tool calling only; it does not offset the failed commerce outcome.

Severity meanings used below:

- **Blocker:** prevents the intended outcome.
- **Major:** materially breaks grounding, continuity, recovery, or customer experience.
- **Minor:** does not independently prevent the outcome but weakens the evidence or UX.

## Dimension judgments

| Dimension | Judgment | Severity | Evidence-based rationale |
|---|---|---:|---|
| Narrative outcome | Fail | Blocker | The run ends after the customer's explicit approval with no cart mutation and no `cart_ready` state. The manifest finish note confirms that the target state was not reached. |
| Exact grounding | Partial | Major | Product `20706`, its 279,000 VND price, base contents, drink alternatives, and zero price deltas are grounded in tool results. However, “Gà Giòn Cay” was presented as the default even though every nested chicken-flavor option has `default:false` and quantity `0` in the modifier evidence. “Tiết kiệm nhất” is also contradicted by cheaper returned combos and no individual-order baseline was retrieved. |
| Retrieval and recovery | Partial | Major | The candidate did retry and ultimately recovered through a scoped `Combo Nhóm` query. Before that, it repeatedly sent the literal string `"null"` as the category, received empty filtered collections, called even `mode:"full"` with the same bad filter, and required customer-directed recovery twice. |
| Cross-turn product preservation | Fail | Major | Sequence 17 returned code `20706`, but after the customer selected that exact item, the candidate discarded the verified result and ran three failing name searches. It incorrectly told the customer that no combo data existed until the customer supplied the category and price again. |
| Customer authority | Pass | — | No cart change occurred without consent. The candidate requested approval and did not claim that a mutation succeeded. This is the strongest part of the run. |
| Cart proposal / GenUI behavior | Fail | Blocker | The trace contains only `searchMenu` and `getModifierOptions`; there is no structured cart-proposal, confirmation, or cart-action event. After multiple explicit approvals, the candidate first promised to proceed, then said the confirmation surface did not exist, and finally instructed the customer to click an “Add to cart” button that the run had not produced. A Markdown cart summary is not a GenUI proposal. |
| Upsell | Fail | Major | No drink-size upgrade was retrieved or proposed. The candidate offered same-size, zero-price beverage substitutions, which are customization choices rather than the intended size upsell. |
| UX | Fail | Major | The customer had to debug retrieval, repeat the selected product and price, approve the cart repeatedly, and was left with an impossible next action. The helpful combo comparison and localized presentation do not compensate for that dead end. |
| Observability isolation | Pass with caveat | Minor | The run is well isolated by run/scenario/session identifiers, ordered trace sequences, call IDs, timestamps, raw and model-facing results, fixture/public-crawl provenance, and artifact hashes. All four evidence hashes and the scenario-source hash match the manifest. The caveat is that manifest `status:"completed"` means execution completed, while the scenario failed; a distinct outcome field would prevent this ambiguity. |

## Strengths

1. The candidate made a useful budget-aware recovery once the customer redirected it to group combos. The 279,000 VND recommendation, 21,000 VND remaining budget, item code, price, and base contents are supported by the retrieved menu evidence.
2. After the correct item code was recovered, it used `getModifierOptions` and grounded the included burgers, fries, standard Pepsi choices, and available beverage substitutions.
3. It preserved customer authority: there was no silent or unauthorized cart mutation, and it did not falsely report a successful add-to-cart action.
4. The sealed evidence is reviewable and internally consistent. Preflight, full tool arguments/results, provenance, timings, transcript, and explicit unsuccessful finish note are retained.

## Failures

### Blocker — commerce outcome and GenUI path

The central transaction never became actionable. The customer explicitly selected the combo, asked to keep the default choices, and then approved again. No structured proposal or cart action appeared, and the run stopped outside `cart_ready`. The final instruction to click a button is not supported by any emitted surface in the evidence.

### Major — unsupported required modifier default

The modifier tree requires four chicken-flavor selections (`min:4`, `max:4`), while all three flavor options are non-default with quantity `0`. The candidate nevertheless asserted that “Gà Giòn Cay” was the default and carried that choice into the cart summary. This is not a cosmetic wording issue: the proposed line item is incomplete or incorrectly configured.

### Major — verified product lost across turns

The first successful combo result already included `code:"20706"`. The candidate failed to preserve that verified identity after the customer selected it, repeated broader searches with the malformed category filter, and denied the existence of data it had just shown. Recovery depended on the customer restating the correct category and price.

### Major — upsell and savings narrative not completed

The candidate neither retrieved nor proposed a larger drink option. Same-size beverage swaps do not satisfy the intended upsell. It also did not establish that the combo saved money relative to the original loose-item request, because no grounded loose-item total was obtained. Calling the 279,000 VND option “tiết kiệm nhất” was false against the returned list.

### Major — weak autonomous recovery and customer experience

The repeated literal `"category":"null"` narrowed searches to a nonexistent category, including the attempted full-menu query. The assistant treated those empty filtered results as a temporary menu outage instead of inspecting its query scope. The resulting apologies, escalation offer, repeated consent prompts, and nonexistent-button instruction created avoidable friction.

### Minor — run completion versus scenario success

The manifest accurately explains the failure in `finishNote`, but `status:"completed"` alone can be misread as qualification success. The evidence should separately encode execution completion and narrative outcome, for example `finalStateReached:false` and `scenarioOutcome:"failed"`.

## Is a bounded fix justified?

**Yes.** The candidate demonstrated basic Vietnamese dialogue, typed tool use, grounded catalog reading once correctly scoped, and consent preservation. The failures are concentrated in retrieval argument hygiene, preservation of verified selections, required-modifier validation, and the missing proposal/action surface. A bounded fix is justified if it includes:

1. omit absent filters instead of serializing `"null"` as a category, and recover from empty filtered results by inspecting the returned scope;
2. retain the selected item's verified code and revision across turns rather than re-resolving it by name;
3. validate every required nested modifier group and ask the customer when no default exists;
4. expose a real cart-proposal/GenUI confirmation path to this qualification surface, or declare the surface blocked before eliciting approvals;
5. retrieve a grounded size upgrade, or explicitly state that no size upgrade exists for this combo and offer a grounded alternative;
6. record scenario success separately from run completion.

These changes should remain contract- and state-based. They do not justify keyword routing, an exact response template, a fixed tool sequence, or a broader orchestration rewrite. Re-run the same sealed narrative in a fresh session after the bounded changes.
