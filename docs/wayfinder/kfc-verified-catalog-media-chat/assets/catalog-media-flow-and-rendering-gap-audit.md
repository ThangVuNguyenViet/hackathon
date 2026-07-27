# Catalog Media Flow And Rendering Gap Audit

## Scope

This audit traces catalog media through the current fixture-backed KFC ordering system. It distinguishes four states that otherwise look deceptively similar:

- **exists**: the fixture or upstream tool result contains an image reference;
- **typed**: a domain contract carries the reference with a defined meaning;
- **persisted**: the reference survives as part of the immutable assistant turn;
- **presented**: the customer actually receives or sees it.

No runtime implementation was changed during this ticket.

## End-to-end result

| Entity or surface | Exists now | Typed through graph | Persisted in GenUI | Presented in GenUI | Delivered to Messenger/Zalo |
|---|---|---|---|---|---|
| Menu search results | Yes, `MenuItem.imageUrl` | Yes | Yes | No | No |
| Product detail | Yes in tool result | No fresh state case | Only if prior menu search survives | No | No |
| Add-on recommendations | Yes in tool result | No fresh state case | Only if prior menu search survives | No | No |
| Modifier options | `imageName` only | No | No | No | No |
| Promotions | Images only in crawl evidence | IDs only | IDs in order review only | No discovery image | No |
| Membership rewards/wallet | Fixture `imageUrl`, currently ineligible | No | No | No | No |
| Allergen chart/parent product | Verified externally | No media field | No | No | No |
| Cart and order review | No media on `CartItem` | No | No | No | No |

## Fixture and generation layer

### Menu

`services/kfc-agent-backend/src/fixtures/schema.ts` requires a valid URL-shaped `imageUrl` on every `GeneratedMenuItem`. `OrderingDataService.searchMenu` and `getMenuItem` return the full item, and `createMockClients.toMenuItem` explicitly copies `imageUrl` into the domain `MenuItem`. The historical generic add-on catalog method has been removed.

What is missing:

- no capture timestamp, validation result, media host policy, or media identity separate from URL;
- URL syntax validation is not reachability or entity-association validation;
- `scripts/build-fixtures.ts` only copies generated JSON; it does not crawl, refresh, validate, diff, or remove stale entities;
- `test/fixtures/build-fixtures.test.ts` asserts the stale 120-item/58-modifier counts and specifically expects stale item `20751`, so it currently protects drift rather than detecting it.

### Modifiers

`GeneratedModifierOption` carries `imageName`, not `imageUrl`, provenance, capture time, or validation status. Nested modifier associations are otherwise structurally sound through parent item ID, modifier group, and modifier ID.

The media inventory proved every current modifier image identity can resolve to a live official image, but that resolved URL is not represented in the generated fixture or runtime type.

### Promotions and content

`GeneratedContentPage` stores markdown and normal links but not extracted image links or typed campaign-media associations. `GeneratedPromotionVoucherOffer` has no image field. Promotion artwork remains buried in crawl markdown and cannot be selected deterministically by runtime code.

The content/allergen path has the same issue: `GeneratedContentPage` can hold markdown containing an image, but `ContentEvidence` has no media association and graph logic cannot distinguish chart media from page chrome.

### Membership

Membership reward and wallet schemas contain `imageUrl`, but permit an empty string and do not enforce host eligibility or reachability. Current fixture URLs are either third-party-hosted or 404, as documented by the media inventory.

## Ordering client and tool layer

The client contracts expose:

- `searchMenu` and `getItemDetails` as `ToolResult<MenuItem...>`;
- the historical generic add-on recommendation read as `ToolResult<MenuItem[]>` (removed);
- `getModifierOptions` as `ToolResult<GeneratedMenuModifier>`;
- promotion and membership methods as their fixture-backed types.

The tool executor returns these full values. However, `ToolTraceEntry` persists only tool name, arguments, success, summary, and provenance—not the result value. If `applyToolResultToState` does not explicitly project a value, it disappears after the current tool call.

## Graph-state drop points

### Menu search survives

`applyToolResultToState` handles `searchMenu` by assigning the full result array to `state.menuSearchResults`. Because `AgentGraphState.menuSearchResults` is `MenuItem[]`, `imageUrl` remains typed.

`buildVerifiedStateSnapshot` also includes `menuSearchResults`, so verified menu media survives graph-state persistence and later context reuse.

### Product detail and add-ons disappear

At the time of this audit, there were no `applyToolResultToState` cases for
`getItemDetails` or the historical generic add-on recommendation read.
`shouldPreserveCurrentMenuSearchResults` also recognized only a successful
`searchMenu` call. The generic recommendation read has since been removed.
Therefore, the historical finding was:

- a detail or recommendation tool cannot independently populate a fresh image-bearing menu surface;
- any Smart Menu Picker shown after those tools depends on older `menuSearchResults` being retained for another reason;
- the UI can present stale choices rather than the exact fresh detail/add-on result.

This is a state-projection gap, not merely a Flutter rendering gap.

### Modifier results disappear

There is no graph field for the latest modifier tree and no result-application case for `getModifierOptions`. `selectedModifiers` represents chosen modifiers for cart operations, not the available modifier-choice tree. The tool result becomes only a trace summary.

### Promotion results collapse to IDs

`searchPromotions` and `explainPromotion` update `promotionContext.matchedOfferIds`; they do not retain the matched offer objects. The selected GenUI catalog has no promotion-discovery widget. `promotionContext` appears only inside Order Review data, where it still contains IDs/validation rather than presentable cards.

### Membership results disappear

There is no graph-state field or result projection for membership reward or wallet lists. Membership imagery cannot reach any GenUI Snapshot even if a future fixture URL becomes eligible.

### Allergen media disappears

`answerAllergenQuestion` stores text/link-oriented `contentEvidence` and emits an evidence event. There is no chart-media field, parent-menu-item join, or GenUI selection branch for allergen answers.

### Cart strips product media

The domain `CartItem` contains only `itemCode`, `name`, `quantity`, and `unitPriceVnd`. `createMockClients.updateCart` constructs exactly those fields from a selected `MenuItem`, discarding `imageUrl`. Every later cart, order preview, order, Cart Builder, and Order Review therefore lacks product media.

The agreed first-cart-summary image cannot be implemented solely in Flutter; the cart snapshot needs a verified media association or a deterministic resolver keyed by item code.

## GenUI selection and persistence

`selectKfcGenUiAttachment` limits Smart Menu Picker data to five `menuSearchResults`, matching the agreed discovery limit. It places the full `MenuItem` objects in `data.items`, so current menu `imageUrl` values are present in the selected attachment.

The attachment contract uses `data: Record<string, unknown>`. This preserves flexibility but provides no typed media eligibility, alt text, aspect ratio, role, or failure behavior.

`runAgentTurn` persists the complete selected attachment as `ConversationTurnMetadata.genUi` before delivery. The same metadata is emitted in `conversation_turn_created`. Persistence is durable across:

- `MemoryStore`, which retains metadata directly;
- `PostgresStore`, which stores metadata as JSONB and maps it back;
- `D1Store`, which serializes metadata to JSON text and parses it back.

The first-party KFC endpoint returns the same `genUi` in its HTTP response, and `/chat/kfc/genui-action` resolves actions from the stored attachment. Therefore a menu image URL already survives immutable Snapshot replay; no regeneration from current graph state is required.

## Flutter parsing and rendering

`CustomerChatResponse.fromJson` parses the attachment and retains `data` as a generic object map. No typed menu-card or media model validates `imageUrl`, host eligibility, alt text, or display role.

`CustomerChatScreen` renders assistant text and then `KfcGenUiRenderer`. `SmartMenuPicker` reads name, description, price, code, and quantity, but never reads `imageUrl`. `CartBuilder` and `OrderReviewConfirm` cannot read an image because cart items do not contain one.

The local `kfcGenUiFixture` also omits image URLs, so widget tests and goldens cannot reveal this omission. There is no `Image.network`, `NetworkImage`, cached-image component, media semantics key, loading state, error callback, or text-only degradation assertion anywhere in the customer-chat Flutter tests.

## Messenger and Zalo delivery

The backend creates and persists GenUI metadata for Messenger and Zalo turns because both channels use the same `runAgentTurn`. That metadata is visible internally in transcript/dashboard evidence.

Customer delivery discards it:

- `deliverAssistantReply` accepts `responseText` but not `genUi` or a media intent;
- `MessengerClient` and `ZaloClient` expose `sendText` only (Messenger additionally exposes sender actions/profile lookup);
- `createMessengerClient` posts `{ message: { text } }`;
- `createZaloClient` posts `{ message: { text } }`;
- both webhook flows call `deliverAssistantReply` with only `output.responseText`.

`assistant_reply_sent` records only aggregate sent/failed status. There is no media message ID, sequence, partial-success state, media retry identity, or proof that text still delivered when media failed. Messenger webhook idempotency protects the inbound event and overall processing, but there is no separate outbound media idempotency contract.

Zalo inbound attachment parsing is unrelated: it understands customer-uploaded attachments, but it does not provide outbound catalog media.

## Existing tests to extend

### Backend fixture and domain tests

- `test/fixtures/build-fixtures.test.ts`: replace stale exact counts/sample with refreshed entity/media coverage, provenance, eligibility, and deterministic diff assertions.
- `test/ordering/ordering-data-service.test.ts`: assert verified media survives menu search/detail/add-ons and active-promotion filtering.
- `test/mock/mock-clients.test.ts`: assert resolved modifier media and cart media association.
- `test/domain/contracts.test.ts`: add the typed media contract and text-only boundary.

### Backend graph and GenUI tests

- `test/genui/kfc-genui-selector.test.ts`: currently supplies image URLs but does not assert them; add menu/detail/add-on/promotion/modifier/cart media and five-card/single-image limits.
- `test/graph/planner-context-policy.test.ts` and `test/graph/ai-tool-graph.test.ts`: prove detail/add-on/modifier/promotion results project into the intended state without stale menu reuse.
- `test/genui/kfc-genui-action.test.ts` and `test/api/chat.test.ts`: prove media-bearing Snapshots persist, replay identically, and remain safe action capabilities.
- `test/persistence/memory-store.test.ts` and `test/persistence/d1-store.test.ts`: add explicit media-bearing GenUI metadata round trips. Postgres mapping should receive equivalent coverage where its integration harness lives.

### Channel tests

- `test/channels/messenger-webhook.test.ts` and `test/channels/zalo-webhook.test.ts`: add decision-point media mapping, ordering, media failure with successful text, delivery evidence, and retry/idempotency cases after the channel contract is decided.

### Flutter tests

- `test/features/customer_chat/domain/kfc_genui_models_test.dart`: parse typed media and reject ineligible/malformed values according to the backend contract.
- `test/features/customer_chat/data/customer_chat_repository_test.dart`: preserve media-bearing response payloads.
- `test/features/customer_chat/presentation/kfc_genui_renderer_test.dart`: render five discovery cards, one detail/cart image, accessible semantics, and text-only failure behavior.
- `test/features/customer_chat/presentation/customer_chat_screen_test.dart`: prove failed media does not suppress assistant text or actions.
- customer-chat component/catalog goldens: update only after the prototype is accepted.

### Full proof surfaces

- `test/scenarios/live-ai-genui.test.ts`: assert eligible media appears only at scripted decision points and persisted attachments replay.
- `apps/kfc_live_monitor_flutter/integration_test/customer_chat_genui_conversation_test.dart`: capture the real backend-backed image experience across the full scenario set.
- `test/evaluation/genui-proof-evaluator.test.ts` and the live GenUI proof manifest: add media decision-point coverage, URL eligibility evidence, text-only degradation, and channel delivery proof without reducing the existing full-suite gate.

## Verified baseline

The audit ran the existing focused suites without modifying runtime code:

```text
Backend: 10 test files passed; 107 tests passed
Flutter: 36 tests passed
```

The backend run emitted the existing unrelated warning that `proof:live:monitor` is duplicated in `package.json`. The green baseline proves current text/GenUI behavior is stable; it does not prove image behavior, because the audited tests contain no customer-facing image assertion.
