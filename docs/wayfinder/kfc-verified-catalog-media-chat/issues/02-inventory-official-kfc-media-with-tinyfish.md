Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

Using TinyFish against official KFC Vietnam sources only, what verified image references can be associated with all current menu products, modifier options, promotions, membership rewards, and ordering-relevant ingredient/allergen evidence? Produce a source-backed inventory with stable entity join keys, capture timestamps, URL reachability, media host and dimensions where available, active/scheduled/expired promotion classification, explicit coverage gaps, and no inferred URL or image association.

## Answer

[Official KFC Media Inventory — 2026-07-11](../assets/official-kfc-media-inventory-2026-07-11.md) records the source-backed inventory, entity join keys, current-versus-fixture drift, verified hosts and reachability, promotion lifecycle coverage, and explicit text-only gaps.

The decision-level result is:

- The current official catalog API exposes 118 products and 391 modifier-option occurrences across 56 customizable products.
- All 118 current products have official image identities. Their 108 unique KFC CDN URLs returned `200 image/*`.
- All 391 modifier occurrences reduce to 42 unique official API `imageName` identities. Thirty reuse already verified menu images and the remaining twelve KFC CDN URLs were individually verified as `200 image/*`; none were accepted from filename inference alone.
- The generated runtime fixture is stale by two products: `Combo Hợp Gu 99K` and `Combo Đẫy Đà 129K` remain in the 120-row fixture but are absent from the current official API.
- Three official-hosted promotion images were verified: two active campaigns as of 2026-07-11 and one expired campaign retained only as archive evidence. The third active fixture campaign has no verified image and must remain text-only.
- Membership fixtures currently have zero eligible verified images: two URLs use third-party `i.ibb.co`, while all three KFC-hosted `invoice.kfcvietnam.com.vn` URLs return 404.
- The allergen surface provides one verified chart image, not product-specific ingredient photography. Product-specific ingredient/allergen answers may reuse only the independently verified parent menu-product image.
- TinyFish did not report reliable pixel dimensions for these binary assets; channel-specific size/format acceptance remains assigned to Verify Messenger And Zalo Media Delivery Capabilities.
