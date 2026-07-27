# KFC Fixture-Backed AI Orchestration Design

Date: 2026-07-08

## Purpose

Replace the current phrase-matched KFC agent flow with a production-shaped, AI-led orchestration layer that uses the full generated fixture database as its source of truth. The final behavior should be realistic for demos, backed by crawled KFC Vietnam data, and free of scripted business shortcuts.

Temporary breakage during implementation is acceptable. The priority is the final architecture: every business claim and business state transition must be backed by fixture-backed tools, explicit safety gates, or mock external side effects.

## Current Implementation Gaps

The backend currently loads rich generated fixtures, including menu items, modifier trees, stores, store availability, promotion pages, promotion/voucher offers, and content pages. The agent path does not yet use all of them.

Confirmed current gaps:

- Menu search and cart pricing use fixtures, but modifier choices are not first-class agent tools.
- Store assignment uses rough city matching, while delivery/pickup disposition, item exclusions, and timeslot exclusions are not fully coordinated in one fulfillment path.
- Promo/voucher behavior still has hardcoded `KFC50` logic even though public crawl data does not expose a reusable public promo code.
- Promotion pages, normalized promotion/voucher offers, allergen chart, and content/news pages are loaded or present but not agent-queryable through typed tools.
- `runAgentTurn` contains phrase-matched branches for scenario-specific flows such as `combo gà cay`, `Sunrise City`, `Momo`, invoice text, and large order text.
- Scenario replay injects business events through `applyScenarioEvent`, so replay can pass without the production agent actually making the required tool calls.

## Non-Negotiable Boundary

Production behavior and live AI scenario replay are the same thing. Live replay must run through the same AI-led graph as Messenger, Zalo, and web chat.

The model decides:

- intent
- extracted entities
- missing information
- tool plan
- next action
- customer-facing wording

The backend verifies:

- tool names and arguments
- fixture-backed facts
- irreversible-action safety gates
- source/provenance on business claims
- required tool evidence for scenario success

Deterministic behavior is allowed only at dependency or test seams:

- unit tests with mocked model output
- fake OMS order IDs
- fake payment provider state
- fake channel send status
- stable clocks and IDs in test harnesses

Deterministic behavior is not allowed for normal business decisions:

- no hardcoded voucher success such as `KFC50`
- no hardcoded cart contents
- no hardcoded store assignment such as `store_mock_nearest`
- no fixed delivery fee or ETA unless returned by a fulfillment tool
- no scenario-specific event injection in production/live replay
- no exact response text assertions for live AI replay

## Architecture

Introduce `OrderingDataService` as the only runtime layer that reads generated fixtures.

Graph nodes, mock clients, and tools do not read raw JSON or CSV directly. They call typed clients, and fixture-backed clients call `OrderingDataService`.

```text
Channel/Web/Scenario Input
  -> AI-led graph
  -> validated tool plan
  -> typed clients
  -> OrderingDataService
  -> generated fixtures
  -> tool results with provenance
  -> safety gates
  -> AI response composition
  -> transcript, tool trace, dashboard events
```

Later, real KFC/OMS/payment/channel clients can replace fixture-backed clients without changing graph policy.

## OrderingDataService

`OrderingDataService` provides stable domain methods over `GeneratedFixtures`:

- `searchMenu(query)`
- `getMenuItem(itemIdOrCode)`
- `getModifierTree(itemIdOrCode)`
- `searchStores(input)`
- `getStoreAvailability(storeId, disposition)`
- `checkItemsAvailable(storeId, disposition, itemIds, requestedAt?)`
- `searchPromotionOffers(query, cart?, channel?)`
- `explainPromotion(offerId)`
- `validateVoucherInput(inputCodeOrText, cart)`
- `searchContent(kind, query)`
- `getAllergenEvidence(query)`

Every method that returns business facts must include enough provenance for traceability: source fixture file, source URL or API when available, and whether the value is public crawl evidence or mock-only external simulation.

Recommendation decisions now use the placement-specific recommendation
application service rather than a generic `OrderingDataService` catalog method.

## Client Surface

The agent-facing client surface should be complete enough for realistic ordering:

- `MenuClient`: search items, item details, modifier tree/options.
- `CartClient`: add, remove, update quantity, select modifiers, preview price.
- `RecommendationClient`: fixture-backed add-ons and upsells from categories, product context, and modifier data.
- `StoreLocatorClient`: find candidate stores from city, district, or address text using fixture stores.
- `InventoryClient`: check item exclusions and timeslot exclusions for store, disposition, item IDs, and requested time.
- `PromotionClient`: search public offers, explain campaigns, validate voucher-like text against fixture-backed public data.
- `ContentClient`: search promotion pages, news, allergen chart, policy/content pages.
- `CustomerClient`: saved addresses, recent orders, favorites, customer profile.
- `LoyaltyClient`: points, member status, and loyalty constraints when available as mock data.
- `FulfillmentClient`: coordinate delivery vs pickup, store candidate, disposition, fee, ETA, exclusions, and timeslot availability.
- `OmsClient`: preview, place, status, cancel, reorder.
- `PaymentClient`: create payment link, check payment status, switch payment method, COD path.
- `InvoiceClient`: collect and validate company name, tax code, and invoice email.
- `HandoffClient`: create human handoff with structured reasons.
- `FeedbackClient`: complaints, ratings, post-order feedback.
- `ChannelClient`: Messenger, Zalo, and web send results.

`FulfillmentClient` is the key coordination point for store, availability, disposition, fee, ETA, and timeslot checks. Store and inventory clients can remain available as lower-level contracts, but graph-level ordering should use fulfillment for preview/order readiness.

## AI-Led Graph Flow

Replace phrase-matched flow with an AI-planned loop:

1. **Understand turn**
   The model reads the latest user message, bounded session context, current state, and available tool schemas. It extracts intent, entities, constraints, and missing information.

2. **Plan tools**
   The model chooses tool calls from the allowed client surface. The backend validates tool name, arguments, and state preconditions before execution.

3. **Execute tools**
   Tools return structured results with provenance and concise result summaries. Tool results are persisted in a traceable form.

4. **Apply safety gates**
   The backend enforces non-negotiable rules outside the model.

5. **Update state**
   State is updated only from validated tool outputs, safety-gate decisions, or explicit user input.

6. **Compose response**
   The model writes a natural customer response from current state and verified tool outputs. It does not receive raw fixture dumps.

7. **Persist evidence**
   The backend stores transcript turns, tool calls, tool outputs, source provenance, dashboard events, and state snapshots needed for proof.

## Safety Gates

Safety gates are backend-owned and cannot be bypassed by model wording.

Required gates:

- No order placement without explicit confirmation.
- No payment success without `PaymentClient` output.
- No promotion, discount, or voucher claim without `PromotionClient` output.
- No live reusable promo code claim unless the fixture marks `actualCodeExposed=true` and provides a non-empty public code, or the code is explicitly marked mock-only in test mode.
- No allergen certainty beyond public allergen/content evidence.
- No order preview or order placement when `FulfillmentClient` reports unavailable items, blocked timeslots, missing disposition, or missing store.
- No private customer data disclosure beyond authenticated or explicitly provided customer context.
- No real external order/payment/customer action in mock mode.

## State Model

Graph state should store structured facts and evidence rather than inferred prose:

- `intent`
- `entities`
- `cart`
- `selectedModifiers`
- `fulfillment`: method, disposition, store ID/name, fee, ETA, availability result, blocked items, blocked timeslots
- `promotionContext`: matched offer IDs, voucher validation result, discount or rejection reason, caveats
- `contentEvidence`: allergen, policy, promotion, or news snippets with source references
- `customerContext`: saved addresses, recent orders, loyalty snapshot, favorites
- `orderPreview`
- `paymentAttempt`
- `invoiceRequest`
- `handoff`
- `toolTrace`: tool name, arguments, status, result summary, source fixture/provenance

The response composer receives current state and verified evidence. It should not invent missing fields to make the conversation smoother.

## Scenario Replay

Live AI scenario replay is production behavior.

Replay inputs are scripted user messages, but the assistant path is not scripted. Each turn goes through the same graph, model planner, tools, safety gates, and response composer used by real chat.

Replay success is evaluated through evidence:

- required final state
- required tool calls
- required tool-call arguments or payload fragments
- required dashboard events
- forbidden calls before confirmation
- no unsupported promo/payment/store claims
- no order placement before explicit confirmation

Exact assistant wording is not a success criterion for live AI replay. Assertions should check meaning, state, and tool evidence.

Unit and contract tests may inject mocked model tool plans for narrow safety and parser cases. Those tests are not demo proof and should be labeled as test-mode behavior.

## Final Proof Deliverables

The end result must include two videos from a real live AI run:

1. **Messenger chat video**
   - Shows the customer messages and assistant replies in Messenger.
   - Uses the production/live AI orchestration path, not mocked planner output.
   - Shows a realistic ordering flow that exercises fixture-backed data, such as menu search, modifiers or upsell, fulfillment/store availability, promotion/voucher handling, and order confirmation safety.

2. **Monitor dashboard video**
   - Shows the live monitor dashboard updating from the same session as the Messenger video.
   - Shows transcript turns, cart or order state, tool-backed dashboard events, and any handoff/payment/promotion status relevant to the chosen proof flow.
   - Uses the same session/customer correlation as the Messenger proof so the two videos can be compared directly.

The videos are proof artifacts, not presentation mockups. They must be captured after implementation from the running backend, live AI graph, fixture-backed tools, and monitor dashboard. A passing local unit test or scripted scenario replay is not enough to satisfy final proof.

## Removal Targets

The implementation should remove or isolate these current deterministic business shortcuts:

- `scenarioOneCart`
- `scenarioOneAddress`
- `scenarioOneOrder`
- hardcoded `KFC50` validation and discount
- `store_mock_nearest`
- fixed `18000` delivery fee and fixed `25` ETA
- phrase branches for `combo gà cay`, `Sunrise City`, `Momo`, invoice text, and scenario-specific large-order text
- `applyScenarioEvent` injecting business outcomes into scenario replay
- scenario tests that pass from injected events rather than production tool traces
- response-composer prompt fields that label fallback business output as deterministic production truth

Mock external systems can remain deterministic where they represent unavailable integrations, but their outputs must consume verified state.

## Testing Plan

Testing should be layered:

1. `OrderingDataService` unit tests over all generated fixture tables:
   - menu search
   - modifier tree lookup
   - store search
   - store item exclusions
   - store timeslot exclusions
   - promotion/voucher offer search
   - public-code absence
   - allergen/content search

2. Client contract tests:
   - every client reads through `OrderingDataService` or a mock external dependency
   - no client hardcodes menu, promo, store, fee, ETA, or voucher outcomes

3. Graph safety tests with mocked model plans:
   - order placement blocked before confirmation
   - payment success blocked without payment output
   - promo claim blocked without promotion tool output
   - unavailable item blocks preview/order
   - allergen answer cites content evidence or refuses certainty

4. Live AI replay tests:
   - run scenario messages through the production AI graph
   - assert tool traces and business outcomes
   - do not assert exact response text

5. Regression tests:
   - no hardcoded `KFC50` success in production path
   - no `applyScenarioEvent` production replay injection
   - no `store_mock_nearest` in production replay output
   - no unsupported public promo-code claim

## Acceptance Criteria

The redesign is complete when:

- All generated fixture categories are reachable through typed services/clients.
- Production/live replay uses the AI-led graph and fixture-backed tools.
- Normal business outcomes are not driven by phrase-matched deterministic branches.
- Promotions and vouchers are answered from fixture-backed offer data, with public reusable code absence preserved.
- Modifier choices are available to the agent and cart state.
- Store assignment and availability use store, disposition, exclusions, and timeslot fixture data.
- Scenario replay proof includes tool-call evidence for the business facts it asserts.
- Existing deterministic scenario business injection is removed from production/live replay.
- Unit tests may mock the model, but live AI replay is treated as production behavior.
- Two final videos are captured from the same live session: one Messenger chat video and one monitor dashboard video.

## Self-Review Notes

This spec intentionally chooses replacement over compatibility. It does not require preserving the current phrase-matched graph during migration. The only allowed deterministic behavior is at dependency/test seams or mock external systems that cannot be backed by public KFC data.
