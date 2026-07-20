# PR #54 StateGraph scenario-replay reconciliation

Status: deterministic integration-green, live qualification pending. The
attested PR #54 v2 inventory is preserved, and a separate local v3 candidate
exercises the proposed StateGraph contracts. The migration has been reconciled
onto current main, the complete backend and Flutter gates are green, and the
StateGraph replacement coverage is independently accepted. No paid provider
qualification or LangSmith mutation has been performed.

## Sync strategy and conflict boundary

The publication branch was created directly from current `origin/main`
`8a8d6968529b972b7324a232c0a41b1b27372431`. The reviewed migration tree was
then applied onto that base in a separate worktree, with conflicts resolved
explicitly against PR #54:

- its serialized v2 dataset identity, inventory, and release policy remain
  digest-stable; the generalized source files themselves are not
  byte-for-byte identical to `origin/main`;
- its schema, evaluator, argument, state, polarity, side-effect, checkpoint,
  semantic-response, and mutation obligations are carried into the isolated
  v3 candidate;
- conflicts in `liveQualityContracts.ts`, `liveQualitySchemas.ts`,
  `liveQualityEvaluators.ts`, `scenarioCoverageLedger.ts`, `runner.ts`, and
  live qualification infrastructure were resolved by keeping v2 attestation
  active and placing migration-only behavior behind separate v3 contracts;
- no agent behavior from the PR #54 test-only merge was ported into
  production.

The resulting branch therefore has current-main ancestry rather than relying
on a content-only equivalence claim. The final migration commit records the
reviewed runtime and the PR #54 reconciliation together.

## Attested v2 boundary

- Dataset/schema: `kfc-live-quality-v2`
- Inventory: `2026-07-20.1`
- Digest:
  `9684774444e7b844fab12de0da5b9530035aa8f8cf5b5c275fbebd68e2cb76d5`
- Corpus: 9 scenarios, 46 customer turns, 92 Text/GenUI cases
- Semantic-response obligations: 16
- Independently scored multi-tool rows:
  `01#11`, `02#3`, `04#11`, `07#5`, `07#7`, and `07#9`
- Mandatory release mode: Text. GenUI remains optional.
- Controlled high-risk 3x command: retained but deferred until deterministic
  integration is green.

The mandatory text-qualification manifest is bound to this exact v2 digest.
The stale manifest digest found during reconciliation was corrected and its
focused test passes.

The migration intentionally replaces these canonical `origin/main` files:

- `test/scenarios/scenario-replay.test.ts`
- `test/scenarios/scenarioResponseExamples.ts`

They are not restored because their scripted legacy harness bypassed the real
StateGraph execution path and depended on response examples from the retired
planner/router/composer architecture. Their assertions were mapped
individually to the real StateGraph replacement below. The replacement runs
the actual graph, tool boundary, state projector, checkpointing, and evaluator,
and independently proves equal-or-stronger coverage, including the
provider-backed S04 handoff resolution.

## Local v3 candidate

The proposed big-bang inventory is local-only:

- Dataset/schema: `kfc-live-quality-v3`
- Inventory: `2026-07-20.5`
- Current candidate digest:
  `62036883be7e603d19fb08096b6e4931e00c11cc038b62a13d6f12c6e78a9c50`
- Corpus: 9 scenarios, 46 customer turns, 92 Text/GenUI cases
- Semantic-response obligations: 19
- Independently scored multi-tool rows:
  `01#11`, `02#3`, `03#3`, `04#11`, `07#5`, `07#7`, and `07#9`

The 92 cases are the two mode projections of the same 46 turns, not extra
conversation turns. A three-repetition Text+GenUI comparison is 46 × 2 × 3 =
276 turn evaluations per provider and 9 × 2 × 3 = 54 scenario-mode runs per
provider. The mandatory release gate remains Text-only across OpenAI and
Google: 46 × 3 × 2 = 276 turn evaluations and 9 × 3 × 2 = 54 scenario runs.

Issue #50's stale 48/96 wording is explicitly rejected. The canonical corpus
remains 9 scenarios, 46 customer turns, 92 Text/GenUI cases; the rejected
duplicate-turn donor must not be resurrected. The drink-recommendation and
typo-clarification requirements strengthen existing turns, and the safe
membership-confirmation requirement strengthens another existing turn:

1. `02#1` recommends verified food and drink for four people within budget.
2. `06#1` presents the interpreted order for clarification without mutating
   the cart.
3. `07#7` confirms the cart update but requests authenticated membership
   approval without executing a membership write.

These are the three v3 semantic additions to the 16 v2 obligations.

### Exact v3 behavior delta

| Row | Strengthened contract |
| --- | --- |
| `01#1` | Catalog reads may precede the cart mutation; `20702`, `41141`, `41074`, and modifier `70012` must come from verified catalog evidence. |
| `01#3` | The guest model sends the exact user-supplied district with `city:null`; the fulfillment provider—not deterministic inference—resolves and verifies Hồ Chí Minh in after-state evidence. V2's attested request constraint remains byte-for-byte unchanged. |
| `04#13` | The model selects `resolveHandoff` with no public arguments; the server binds the exact active verified escalation ID, requires provider-confirmed resolution, and forbids cart, order, payment, or replacement-handoff mutations. |
| `01#11` | `createPaymentLink.methodId` must equal verified `selectedPaymentMethod.methodId`; legacy `method` must be absent. |
| `02#1` | Drink-category evidence `20006`, immutable cart, and the new group-budget recommendation act are required. |
| `02#3` | Exact `searchMenu({scope:"all",query:null})`, one independent promotion read, complete categorized GenUI, and immutable cart are required. |
| `02#5` | Item-detail projection is explicitly governed by the turn's state-change partition. |
| `02#7` | Only the modifier-option projection may change: this turn can call `getModifierOptions`, not `getItemDetails`, so `menuItemDetail` is explicitly forbidden from changing. |
| `02#9` | Exactly two `20752` items with groups `2` and `3` selecting `41091`, unit price 143,000 VND, total 286,000 VND. |
| `03#1` | Model-authored filtered menu read must return verified catalog evidence for `41140` with `available:false`; cart, quote, and order remain forbidden. |
| `03#3` | Model-authored `searchMenu` and authenticated `getSavedAddresses` run together before exactly one `updateCart` change for `41141`, quantity `1`, and no modifiers; exactly one saved read, no quote/order, no persisted raw address, and an opaque pending ref. |
| `03#5` | Exactly one delivery quote uses and consumes the prior opaque ref. Cart identity, items, quantities, modifiers, subtotal, discount, and voucher remain identical while the verified delivery fee and total may change. |
| `04#11` | The private status-read digest binds `orderId` to the verified order before the subsequent handoff; raw private arguments remain redacted. |
| `04#15` | The reorder menu projection is explicitly governed by the turn's state-change partition. |
| `05#7` | Scenario 05 explicitly requires authenticated customer access, `handoff:write`, and approval receipt/action-digest evidence before handoff. |
| `06#1` | Search-only typo interpretation, immutable cart, and semantic clarification before mutation. |
| `07#5` | The membership overview may read the exact catalog candidate and project its menu collection before the verified cart update. |
| `07#7` | `getModifierOptions` and the cart update each require a separately grounded outcome; no acquire/redeem/order side effect; semantic confirmation request. |
| `07#9` | Exact acquire/redeem identifiers with model-authored `confirmed` fields absent; consent is supplied by sequential authenticated approval resumes. |

The 19 reviewed v3 rows above are the complete candidate delta. The v3 schema
rejects `plannerRecords` and omits inert v2 compatibility
evidence: deterministic execution allowance, exact-order fields, fixed-output
phrase fields, and duplicate legacy argument/outcome projections. Customer
prose is judged semantically; no keyword or phrase scan is acceptance
evidence.

Every mutable state key is default-denied unless the turn's typed
`stateTransition.mayChange` partition explicitly authorizes it. An internal
consistency test also rejects any active `changed`, `present`, or `equals`
path whose root is outside that partition. This keeps the new menu, modifier,
promotion, and opaque-address projections explicit instead of weakening the
oracle.

The v2 modifier-language compatibility fields are not scanned. Their two
attested behaviors are represented by exact verified tuples in the evaluator:
`20702/60254/70012` for `01#1` and
`20698/3/MOCK-PEACH-TEA-MODIFIER` for `07#7`. Wrong-item and wrong-group
mutations fail.

All v3 rows require a typed privacy verdict. The semantic judge receives only
customer-visible response text and bounded GenUI prose (title, summary, and
action labels), never GenUI payload/data. A separate structural guard rejects
internal metadata keys in every GenUI surface. Payment-method GenUI now
projects only the reviewed public method shape and strips provenance.

The v3 seven-row set retains all six attested multi-tool rows and adds
provider-neutral `03#3` saved-address read plus cart update. For `07#7`, the
unsafe pre-approval membership write is replaced by independently grounded
modifier-authority and cart-update outcomes plus a semantic request for later
approval.

## PR #54 assertion map

| PR #54 obligation | Preserved evidence |
| --- | --- |
| 9 scenarios, 46 turns, 92 mode cases | v2 dataset/ledger tests and v3 candidate identity tests |
| 16 v2 semantic obligations | v2 dataset tests; v3 proves all 16 plus 3 explicit additions |
| Six independent multi-tool groups | typed claims, tool counts, provider evidence, and mutation tests |
| Exact arguments and state-bound arguments | argument constraints, including `absent` and `equals_state_path` |
| Result polarity and `acceptedFailedTools` | evaluator plus reversed-polarity/provider-timeout mutation tests |
| Maximum-one irreversible side effects | tool-count oracle and duplicate-side-effect mutations |
| Path-level state transitions | state transition oracle and missing order/invoice/payment/ref mutations |
| Readable checkpoint thread/id/namespace | persistence oracle and offline replay checkpoint assertions |
| Text release gate; optional GenUI | unchanged in v2; v3 builds both 92 cases without changing release policy |
| No fixed Vietnamese phrase acceptance | typed semantic judge; legacy phrase fields are inert in v2 and absent in v3 |

The replacement replay also maps the six assertion groups that were initially
missing from the StateGraph migration:

| Canonical replay assertion | StateGraph replacement |
| --- | --- |
| Final state for all nine scenarios | Both Text and GenUI results must equal the loaded script final state and an independent explicit nine-row expectation map. |
| Non-synthetic event identity | Every Text and GenUI dashboard event ID is rejected if it contains the legacy `scenario_` synthetic marker. |
| Scenario 01 order and payment lifecycle | Both modes prove no order before the final user turn; exactly one order; exact payment-link method/status/verified URL; voucher success/code/discount; store `KFCVN0318`; provider-verified 18,000 VND/35-minute quote; invoice fields; final fulfillment; and exact embedded order payload. The old 25-minute value came only from a legacy test injection and is not provider truth. |
| Scenario 05 escalation evidence | Both modes require one `handoff_required` event with an anchored escalation ID and the exact five reasons, repeated in durable final state. |
| Scenario 08 escalation evidence | Both modes require one `handoff_required` event with the exact three reasons while preserving the failed check/pending payment-state distinction. |
| Underplanning boundary | The graph executes exactly the model-authored catalog read, emits exactly the `catalog` tool boundary, fails the tool/acceptance oracle, and performs no cart/order/payment side effect. |

An independent read-only reviewer accepted these six mappings as
equal-or-stronger. The final replay, including provider-backed S04 resolution,
has SHA-256
`5f6fb0e71316cf2c559708d84eef23199d46ef63d9f85426ad0e2347c93b9939`.
At the recorded PR #54 reconciliation checkpoint, the
architecture/evaluation/replay review passed 177/177 focused tests with no P1
runtime finding. That count is historical evidence, not the current suite size.

## Offline StateGraph replay

`test/scenarios/stategraph-scenario-replay.test.ts` uses scripted fake model
tool calls with the real StateGraph runner, scenario runner, state projector,
and v3 evaluator. It performs no provider or LangSmith network call. Semantic
customer-prose scores are deliberately not declared green from canned text.
Grounded tool-outcome polarity and state/GenUI evidence remain part of the
offline structural gate; live independent semantic judgment remains required
later.

Focused boundary proof covers:

- the graph executes an advertised but insufficient safe call exactly as the
  model authored it and never synthesizes a missing mutation;
- exact scenario/run/session/tag trace correlation;
- all-menu authority uses `searchMenu({scope:"all",query:null})`, returns the
  complete verified item set across real categories, and does not mutate cart;
- exact modifier authority is retained without deterministic customer-text
  recovery.

Latest full offline replay: 14/14 tests green. The aggregate cross-turn
assertions and all six newly mapped replay groups pass. Scenario 04 now uses
the typed `resolveHandoff` capability: the model supplies no public escalation
identifier, the server binds the exact active verified escalation, approval is
revalidated, and state clears only after exact provider-confirmed success.
Production adapters that do not support verified handoff resolution do not
advertise the tool and fail readiness if remote/local capabilities disagree.

Scenario 01 remains guest checkout. Its order/payment writes use a controlled
`messenger_mock` guest authority without granting global authenticated order
scopes. Its explicit delivery quote now sends only model-visible address
facts: the user-supplied district and `city:null`. The provider-resolved
after-state must still prove `Quận 7 / Hồ Chí Minh`. Verified public
`menuItemDetail` is retained across durable turn snapshots, so an unrelated
quote cannot erase a prior catalog projection and then hide that deletion
behind the quote's state partition.

The recorded PR #54 independent architecture/evaluation/replay subset was
green at 177/177 tests across 11 files. That checkpoint covered the v2
attestation, v3 identity/schema,
mutation sensitivity, semantic judge, mandatory Text qualification manifest,
privacy-safe trace correlation, the complete replacement replay, and verified
S04 resolution. Raw `inputs.metadata.rawEvent` is absent; exact scenario/probe
correlation remains in safe top-level metadata together with only structural
type/count/digest evidence. The mutation set specifically proves that an
inverted `41140` availability flag, a cart mutation for the wrong verified
item, or quote-time changes to cart identity, discount, or voucher fail the
candidate oracle. It also proves that supplying an inferred guest city instead
of `null` fails even when the provider later resolves the same city.

No oracle was weakened to obtain the offline green result. At the recorded PR
#54 checkpoint, the complete backend gate was 2,045 passed / 10 intentionally
skipped, Flutter was 211/211, and lint, typecheck, build, architecture,
policy-fixture, and diff checks were green. These totals are retained as
commit-bound historical evidence rather than current executable counts. No
full paid matrix, high-risk 3x run, deployment, dataset synchronization, push,
or merge has been performed. Paid Text qualification
remains the next release gate; GenUI qualification remains optional.
