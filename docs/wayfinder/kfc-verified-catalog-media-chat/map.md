# KFC Verified Catalog Media Chat Map

Labels: wayfinder:map

## Destination

Make KFC ordering chat image-aware across first-party GenUI, Messenger, and Zalo using reproducibly crawled, verified, official KFC-hosted media references. Menu, modifier, promotion, product-detail, and first cart-summary decision points show useful imagery within agreed limits, while missing or failed media degrades to text only.

The map is complete when the fixture/media contract, refresh workflow, GenUI presentation, Messenger/Zalo delivery behavior, and deterministic plus live proof gates are clear and executable without further product decisions.

## Notes

Domain: public KFC Vietnam catalog evidence, fixture generation, ordering tools and graph state, GenUI Snapshots, Flutter customer chat, Messenger Graph API delivery, and Zalo OA delivery.

Execution is in scope after the contracts are settled because the user asked to crawl the media, enhance the fixtures, and implement the chat experience.

Skills to consult: `wayfinder`, `use-tinyfish`, `domain-modeling`, `grilling`, `systematic-debugging`, `test-driven-development`, and `verification-before-completion`.

Settled product constraints:

- Keep official KFC-hosted image URLs in fixtures; do not mirror or download them into owned storage.
- Use only verified images. Never infer, invent, generate, or substitute fallback artwork.
- When an image is absent, invalid, unreachable, or rejected by a channel, degrade to text only.
- Send or render images only at Media Decision Points: menu discovery, recommendations, modifier choices, promotions, product detail, and optionally the first cart summary.
- Limit discovery to five image cards and product detail, modifier, or cart summary to one image.
- Crawl all discoverable official promotion media for evidence, but expose only active or scheduled offers to runtime chat; retain expired promotions as archived crawl evidence.
- For ingredient or allergen answers, use a verified parent-product image when available. Do not manufacture standalone ingredient imagery.
- The TinyFish workflow must be reproducible, record capture time and provenance, validate URLs, update fixture references, and report additions/removals.
- Fixtures remain mocked upstream/API data and must not be presented as KFC's production system of record.
- Preserve unrelated uncommitted changes in `services/kfc-agent-backend/src/api/serverOptions.ts` and `services/kfc-agent-backend/test/api/server-options.test.ts`.

Verified charting baseline:

- Generated runtime fixtures currently contain 120 menu items and all 120 have `imageUrl`.
- The 58 modifier trees expose `imageName` but not a verified, directly usable image URL.
- The 29 structured promotion/voucher offers have no image field, although official promotion pages expose campaign images.
- `smartMenuPicker` receives menu objects carrying `imageUrl` but renders text-only rows.
- Messenger and Zalo outbound clients currently expose `sendText` only.

## Decisions so far

- [Audit Catalog Media Flow And Rendering Gaps](./issues/01-audit-catalog-media-flow-and-rendering-gaps.md) — Menu images already survive search, GenUI Snapshot persistence, and replay but are ignored by Flutter; detail/add-on, modifier, promotion, membership, allergen, cart, and Messenger/Zalo media are dropped at explicit missing state or delivery contracts.
- [Inventory Official KFC Media With TinyFish](./issues/02-inventory-official-kfc-media-with-tinyfish.md) — Current official sources verify 118 product images, all 42 modifier image identities, two active promotion images plus one archived expired image, one allergen chart image, and no eligible membership images; the 120-row runtime menu fixture is stale by two products.
- [Verify Messenger And Zalo Media Delivery Capabilities](./issues/03-verify-messenger-and-zalo-media-delivery-capabilities.md) — Persist a text-first Catalog Media Intent; Messenger sends one direct remote-URL image batch, Zalo sends one remote-URL advisory media request per item, and media delivery outcomes/idempotency remain separate from authoritative text delivery.
- [Design Media Fixture And Refresh Contract](./issues/04-design-media-fixture-and-refresh-contract.md) — Use one verified runtime media registry referenced by nullable media keys, keep rejected/expired/run-timestamp evidence in dated crawl archives, and publish only deterministic staged refreshes that pass source, association, host, HTTP, MIME, size, schema, and reference gates.
- [Prototype Image-Rich GenUI Decision Points](./issues/05-prototype-image-rich-genui-decision-points.md) — The accepted standalone prototype uses verified official images at seven useful decision states, keeps discovery to five images and detail states to one, collapses failed media to text-only UI, and makes menu selection a zero-based per-dish quantity flow with exactly one atomic batch-confirm action.

## Not yet specified

- None at the current frontier. New fog may emerge while the typed fixture and refresh contract is designed.

## Out of scope

- Downloading, mirroring, rehosting, editing, or generating KFC imagery.
- Using generic food photography, placeholders, or fallback artwork.
- Treating public crawl fixtures as live KFC production inventory, pricing, promotion, or availability APIs.
- Image recognition or ordering from customer-uploaded images.
- Sending imagery on status, support, payment, handoff, or other replies where it does not help a customer choose or confirm.
- Redesigning the monitor dashboard or unrelated GenUI widgets.

## Frontier

Open, unblocked, unassigned child tickets are the frontier. In this local markdown tracker, `Blocked by` names the tickets that must close first.

The current frontier is [Implement TinyFish Media Refresh And Fixtures](./issues/06-implement-tinyfish-media-refresh-and-fixtures.md).
