Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

What is the exact current path for menu items, modifier trees, promotions, recommendations, cart lines, and GenUI Snapshots from generated fixtures through ordering clients, graph state, persisted assistant turns, Flutter renderers, and Messenger/Zalo delivery? Identify every place where a verified media reference exists, is dropped, is untyped, is persisted, or is ignored, and inventory the focused tests and proof scripts that should be extended.

## Answer

[Catalog Media Flow And Rendering Gap Audit](../assets/catalog-media-flow-and-rendering-gap-audit.md) traces each entity class through fixtures, typed clients, graph state, immutable GenUI Snapshot persistence, Flutter rendering, and Messenger/Zalo delivery. It also identifies the exact contract gaps and the existing tests/proof surfaces to extend.

The decision-level findings are:

- Menu `imageUrl` is already typed and preserved through `searchMenu`, graph `menuSearchResults`, Smart Menu Picker data, assistant-turn metadata, KFC HTTP responses, and Memory/Postgres/D1 replay. Flutter receives the value in an untyped data map but never renders it.
- `getItemDetails` and the historical generic add-on recommendation path returned image-bearing `MenuItem` values, but `applyToolResultToState` had no cases for them; only `searchMenu` populated `menuSearchResults`. Their fresh results could not independently create an image-bearing GenUI Snapshot. The generic path has since been removed.
- Modifier fixtures expose only `imageName`; the graph has no modifier-result state, the GenUI catalog has no modifier-choice data surface, and Flutter has no modifier renderer.
- Promotion offers have no media field and graph state reduces successful promotion results to `matchedOfferIds`; no promotion-discovery GenUI exists.
- Membership fixture image fields never enter graph state or GenUI. The separate media inventory also found zero currently eligible membership images.
- `CartItem` omits media, and `updateCart` copies only item code, name, quantity, and price. Cart Builder and Order Review therefore cannot show the agreed first-cart image without a typed media association.
- Allergen/content evidence has markdown and links but no typed media reference or GenUI surface; the verified chart and parent-product image are not currently connected to answers.
- Messenger and Zalo assistant turns persist GenUI metadata internally, but `deliverAssistantReply` passes only `responseText` to channel clients whose outbound contract exposes `sendText` only. Delivery evidence has no media-level status or idempotency identity.
- Existing focused tests are green but assert text, widget kind, actions, persistence, and channel text delivery—not image eligibility, rendering, failure degradation, or channel media delivery.
