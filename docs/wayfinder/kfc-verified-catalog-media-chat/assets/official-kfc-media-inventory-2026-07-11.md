# Official KFC Media Inventory — 2026-07-11

## Purpose

This asset answers which public media references are safe to carry into fixture design for KFC ordering chat. It inventories associations and gaps; it does not change runtime fixtures or chat behavior.

Only images that satisfy both conditions are eligible:

1. the entity-to-image association is exposed by an official KFC Vietnam page or public catalog API; and
2. the final image is hosted on a KFC-controlled hostname and currently responds as an image.

An image embedded by an official page but hosted on a third-party domain is not eligible under the agreed product constraint. Missing or ineligible media degrades to text only.

## Capture and verification method

Captured on 2026-07-11 against:

- [Official KFC Vietnam menu](https://www.kfcvietnam.com.vn/menu)
- [Official public catalog API](https://api.kfcvietnam.com.vn/menu/kfcvn-generic-menu)
- [Official KFC Vietnam promotion detail surface](https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi)
- [Official KFC Vietnam allergen chart](https://www.kfcvietnam.com.vn/allergen-chart)

TinyFish was used as follows:

- `agent run` traversed all visible menu category tabs and returned named product-to-image associations. Run `ac8d7145-7d73-46ca-a054-f2286609dc7e` completed at `2026-07-11T07:35:40.093Z`.
- `fetch content get --image-links` read the official catalog API, promotion detail surfaces, related promotion cards, and allergen chart.
- The promotion index and one promotion detail timed out, so TinyFish search discovered official detail URLs and the successfully fetched detail pages supplied the currently rendered related-promotion cards.
- TinyFish reports direct image binaries as `empty_content`, so reachability was independently checked with HTTP `HEAD`. A URL counted as verified only when it returned `2xx` with `Content-Type: image/*`.

TinyFish did not expose reliable pixel dimensions for these assets. Dimension and platform-size acceptance belongs to the channel-capability ticket.

## Coverage summary

| Entity class | Current official entities | Verified official media | Join key | Result |
|---|---:|---:|---|---|
| Menu products | 118 products | 118 products / 108 unique URLs | catalog item `id`; API `imageName` | Full current coverage |
| Modifier options | 391 occurrences on 56 products | 391 occurrences / 42 unique image identities | parent item `id` + modifier `id`; API `imageName` | Full current coverage |
| Promotion campaigns represented in runtime offers | 3 active, 0 scheduled, 5 expired campaign groups | 2 active images, 0 scheduled images, 1 expired archive image | normalized campaign title + source URL + effective dates, pending typed fixture contract | Partial coverage |
| Membership rewards and wallet vouchers | 5 fixture entries | 0 eligible current images | `rewardId` or `voucherId` | Text only |
| Allergen/ingredient evidence | 1 public chart | 1 chart image; no standalone ingredient images | allergen source URL; parent product `itemId` for optional product image | Chart plus verified parent-product image only |

## Menu inventory

The live catalog API currently returns:

- 118 products;
- 118 products with an official API `imageName`;
- 108 unique resolved URLs on `static.kfcvietnam.com.vn`;
- 108 of 108 unique URLs returning `200` with an image content type.

Multiple products intentionally share one image identity, which explains why 118 products map to 108 unique URLs.

The checked-in generated fixture at [menu-items.json](../../../../services/kfc-agent-backend/fixtures/generated/menu-items.json) contains 120 products and 108 unique image URLs. It is stale by two products that are no longer present in the live API:

| Fixture item ID | Product | Fixture image identity | Current result |
|---|---|---|---|
| `20751` | Combo Hợp Gu 99K | `HOPGU` | Absent from current API; do not expose after refresh |
| `20752` | Combo Đẫy Đà 129K | `DAYDA` | Absent from current API; do not expose after refresh |

The fixture-refresh contract must use catalog item `id` as the stable product join key and treat API removal separately from transient image failure.

## Modifier inventory

The live catalog API currently returns:

- 56 products with modifier groups;
- 391 nested modifier-option occurrences;
- 42 unique, case-folded modifier `imageName` identities.

Thirty unique modifier identities exactly reuse already verified menu image identities. The remaining twelve identities were associated by the official API and each resolved on the official KFC item-image CDN with `200 image/*`:

- `1PCS`
- `3Pep-gift`
- `4-Fried-Chicken`
- `5_Nuggests`
- `Cheese`
- `MIGAXUXI`
- `MIGAXUXI-GA-RAN`
- `MIGAXUXI-GA-VIEN`
- `MOD-Ga-Gion-Cay`
- `MOD-Ga-Gion-Khong-Cay`
- `MOD-Ga-Truyen-Thong`
- `PHI-LE-GA-QUAY-TIEU`

The checked-in generated modifier fixture at [menu-modifiers.json](../../../../services/kfc-agent-backend/fixtures/generated/menu-modifiers.json) is also stale: it contains 58 products and 416 option occurrences. Runtime fixture generation should resolve and validate all unique API image identities during refresh; it must not invent a URL for a new identity without verifying the resulting official-host response.

## Promotion inventory

As of 2026-07-11, the structured offer fixture contains 11 active offer rows grouped into three campaigns, no scheduled campaign, and 18 expired rows grouped into five campaigns. The official detail surface currently renders campaign cards for these verified official-hosted images:

| Lifecycle | Campaign | Effective dates | Verified image URL | Runtime rule |
|---|---|---|---|---|
| Active | Trưa Nay Khỏi Nghĩ Nhiều – Đã Có KFC Lo! | 2026-01-02 through 2026-12-31 | `https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg` | Eligible |
| Active | Thêm Gà, Tiệc Thêm Vui | 2026-07-01 through 2026-07-31 | `https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg` | Eligible |
| Expired archive | Gà Giòn Thay Hoa, Gửi Trọn Yêu Thương | 2026-03-01 through 2026-03-31 | `https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T3%20PHASE%202.jpg` | Archive evidence only |

All three URLs returned `200 image/*`.

The active fixture campaign `Giảm giá đơn hàng` has no verified official-hosted image in the captured sources and therefore remains text only. Several official promotion pages embed detail artwork on `i.ibb.co`; those images are excluded because the agreed policy requires KFC-hosted URLs. Expired campaign images remain crawl evidence and must not make an expired offer discoverable at runtime.

## Membership inventory

The generated membership fixtures contain five image references:

- two use `i.ibb.co` and are ineligible because the host is not KFC-controlled;
- three use `invoice.kfcvietnam.com.vn`, but all three currently return `404`.

Therefore no current membership reward or wallet voucher has eligible Verified Catalog Media. The runtime behavior is text only until a future official source provides a live KFC-hosted association.

## Allergen and ingredient inventory

The public allergen chart exposes one relevant official image:

`https://static.kfcvietnam.com.vn/images/items/lg/BANG-DI-UNG-VI.jpg?v=4lmbjg`

It returned `200 image/jpeg` with a reported content length of 502,548 bytes. The page exposes no separate, product-specific ingredient photography.

For a product-specific allergen or ingredient answer, the only eligible product visual is the independently verified parent menu-product image joined by catalog item `id`. The chart image may illustrate the chart itself. No standalone ingredient image should be inferred from product text.

## Contract implications for downstream tickets

- Refresh from the official catalog API before modifying fixtures; do not build new behavior around the two stale menu rows.
- Store the official API image identity and resolved verified URL separately so a future URL change can be distinguished from an entity change.
- Resolve nested modifiers by parent item `id` plus modifier `id`; do not key solely by display name.
- Promotion media needs explicit campaign association and lifecycle dates. Image presence never overrides active/scheduled/expired filtering.
- Membership stays text-only in this iteration.
- Image reachability is a crawl-time eligibility gate, not proof that Messenger or Zalo accepts the URL; that remains a separate channel decision.
