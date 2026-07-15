# Menu API Observation And Baseline-Fixture Research

Captured: 2026-07-14T11:47:59Z

## Runtime decision

The configured menu API is mutable runtime authority. Each successful fetch creates a Catalog Observation identified by Commerce Environment, provider version or validators, canonical hash, retrieval time, and provider-defined expiry. A recommendation, cart, or proof run pins the observation it read for internal consistency. Before cart mutation and checkout, or when the provider signals a newer version, the system revalidates product existence, modifier compatibility, price, and availability. A material change is shown to the customer and requires renewed selection or confirmation.

All crawled API observations are retained as separate Catalog Baseline Fixtures for deterministic parser, compatibility, arithmetic, and drift regression. The July 7 raw crawl and its generated fixture contain 120 products and 58 modifier trees, including `20751` and `20752`. The later payload `kfcvn-generic-menu@2026-07-10T14:45:08Z+3b163094` contains 118 products and 56 modifier trees and is identified by:

- source: [KFC Vietnam generic menu JSON](https://api.kfcvietnam.com.vn/menu/kfcvn-generic-menu)
- HTTP `Last-Modified`: `Fri, 10 Jul 2026 14:45:08 GMT`
- HTTP `ETag`: `3b163094b6e0a33fca2d5699afd6db5d`
- S3 version: `5WMbDjdajd2HLh8fnrUQ30qUX2_t4i7P`
- raw SHA-256: `a681130fc630f4cc37a0c102337c393e551ee53e2f028a53a3fb79483a886bcd`
- canonical sorted-JSON SHA-256: `cad4e00b51d9557f5e43d10eb3f4647e348432b841de43e483f00dc6b4246922`

The payload contains 118 unique orderable product records and 56 products with modifier trees. The [official human-facing menu](https://www.kfcvietnam.com.vn/menu/new-product) corroborates visible names, compositions, and prices, including standalone Pepsi at 13,000/17,000/20,000 VND for standard/medium/large. It does not expose the complete nested modifier graph, so the official JSON remains the modifier authority.

This baseline records one public observation; it is not current runtime truth and does not prove current store stock, address eligibility, promotion eligibility, final cart acceptance, or OMS/POS availability. Runtime uses the configured provider's current response. Dynamic facts stay `unknown` until independently verified.

## Repository reconciliation

The current generated fixtures represent the earlier July 7 120/58 observation, not a malformed version of the later 118/56 observation:

- `fixtures/generated/menu-items.json`: 120 items; SHA-256 `1ca22bcc566d0e4bcb352a40eaa3076ab10ce731ed657f74574e562ef47de432`
- `fixtures/generated/menu-modifiers.json`: 58 parent trees; SHA-256 `171d267b2d15a765274c2e4ebbe167c1e6d1e69d0dffce1c265f2d3f8b7041a6`
- observation-specific items and trees: `20751` (`Combo Hợp Gu 99K`) and `20752` (`Combo Đẫy Đà 129K`) exist in the July 7 raw crawl and are absent from the July 10 observation
- changed overlap: `41160` (`LOY_KEM_VANI_0d`) is 7,000 VND in the fixture and 5,000 VND in the captured payload
- all 56 overlapping modifier trees match the captured payload exactly for group IDs, min/max, option IDs/names, quantities, nesting, and price deltas

Therefore `20751`, `20752`, and either recorded price for `41160` must not be asserted as current without the current API observation. Preserve both observations with their provenance and generate each baseline from its own raw payload. Do not delete historical records or combine observations into a synthetic 120-item current catalog.

## Golden-journey candidate

Item `20702`, `Combo Burger Gà Yo & Gà Rán`, is the planned candidate only when the proof preflight still observes the required structure and prices. In the captured baseline it has base price 129,000 VND and:

- group `1` requires `41036` (two fried chicken); nested group `60254` requires exactly two choices from original `70003`, hot-and-spicy `70012`, and non-spicy crispy `70017`, all +0
- group `2` requires `41042` (Burger Gà Yo); nested group `60258` requires spicy `70443` or non-spicy `70444`, +0
- groups `4` and `5` independently allow medium Pepsi `41090` +0 or large Pepsi `41091` +3,000 VND
- upsizing both drink lines is therefore a baseline arithmetic expectation of +6,000 VND; a live proof must verify the current observation rather than infer it from the baseline or standalone drink prices

The official builder is [Combo Burger Gà Yo & Gà Rán](https://www.kfcvietnam.com.vn/order/delivery/sharing/ec.cbo-b.gayo-cob/builder), but location/order state is still required for a real cart.

## Complete item-to-modifier compatibility index

Each path is `group:option`; `>` denotes a required nested group under the preceding option. Group min/max, quantities, defaults, names, and deltas are facts of the captured baseline and must be preserved in its derived fixture.

| Item | Official name | Allowed `group:option` paths |
|---|---|---|
| `10515` | Combo 139K | `1:40084, 1:40084>60027:70087, 1:40084>60027:70088, 1:40084>60027:70079, 2:40351, 3:40732` |
| `20687` | Combo 1 Miếng Gà | `1:41035, 1:41035>60253:70031, 1:41035>60253:70027, 1:41035>60253:70036, 2:41063, 3:41089, 3:41093, 3:41099, 3:41100` |
| `20688` | Combo Một Mình Chill | `1:41035, 1:41035>60253:70031, 1:41035>60253:70027, 1:41035>60253:70036, 2:41046, 3:41063, 4:41089, 4:41093, 4:41099, 4:41100` |
| `20689` | Combo 2 Miếng Gà | `1:41036, 1:41036>60254:70003, 1:41036>60254:70012, 1:41036>60254:70017, 2:41063, 3:41089, 3:41093, 3:41099, 3:41100` |
| `20690` | Combo Nhóm 2 No Nê | `1:41105, 1:41105>60265:70247, 1:41105>60265:70246, 1:41105>60265:70253, 2:41063, 3:41089, 3:41093, 3:41099, 3:41100, 4:41089, 4:41093, 4:41099, 4:41100` |
| `20691` | Combo Nhóm 3 Tụ Tập | `1:41106, 1:41106>60266:70258, 1:41106>60266:70261, 1:41106>60266:70263, 2:41057, 2:41056, 3:41089, 3:41093, 3:41099, 3:41100, 4:41089, 4:41093, 4:41099, 4:41100, 5:41089, 5:41093, 5:41099, 5:41100` |
| `20692` | Combo Mỳ Ý Solo | `1:41048, 1:41048>60260:70027, 1:41048>60260:70031, 1:41048>60260:70036, 2:41089, 2:41093, 2:41099, 2:41100` |
| `20693` | Combo Mì Ý & Gà Tenders | `1:41046, 2:41040, 3:41089, 3:41093, 3:41099, 3:41100` |
| `20694` | Combo Cơm Gà Rán Solo | `1:41049, 1:41049>60261:70027, 1:41049>60261:70031, 1:41049>60261:70036, 2:41089, 2:41093, 2:41099, 2:41100` |
| `20695` | Combo Cơm Gà Rán & Súp | `1:41049, 1:41049>60261:70027, 1:41049>60261:70031, 1:41049>60261:70036, 2:41068, 3:41089, 3:41093, 3:41099, 3:41100` |
| `20696` | Combo Cơm Gà Quay Solo | `1:41051, 1:41051>60262:70059, 1:41051>60262:70060, 2:41089, 2:41093, 2:41099, 2:41100` |
| `20697` | Combo Cơm Gà Nanban Solo | `1:41050, 2:41089, 2:41093, 2:41099, 2:41100` |
| `20698` | Combo Burger Zinger | `1:41045, 2:41063, 3:41089, 3:41093, 3:41099, 3:41100` |
| `20699` | Combo Burger Gà Quay | `1:41043, 1:41043>60259:70049, 2:41063, 3:41089, 3:41093, 3:41099, 3:41100` |
| `20700` | Combo Burger Tôm | `1:41044, 2:41063, 3:41089, 3:41093, 3:41099, 3:41100` |
| `20701` | Combo Burger Gà Yo | `1:41042, 1:41042>60258:70443, 1:41042>60258:70444, 2:41063, 3:41089, 3:41093, 3:41099, 3:41100` |
| `20702` | Combo Burger Gà Yo & Gà Rán | `1:41036, 1:41036>60254:70003, 1:41036>60254:70012, 1:41036>60254:70017, 2:41042, 2:41042>60258:70443, 2:41042>60258:70444, 3:41063, 4:41090, 4:41091, 5:41090, 5:41091` |
| `20703` | Combo Nhóm 2 Vui Vẻ | `1:41037, 1:41037>60255:70079, 1:41037>60255:70087, 1:41037>60255:70088, 2:41047, 3:41063, 4:41089, 4:41093, 4:41099, 4:41100, 5:41089, 5:41093, 5:41099, 5:41100` |
| `20704` | Combo Hai Mình Chill | `1:41036, 1:41036>60254:70003, 1:41036>60254:70012, 1:41036>60254:70017, 2:41046, 3:41046, 4:41063, 5:41089, 5:41093, 5:41099, 5:41100, 6:41089, 6:41093, 6:41099, 6:41100` |
| `20705` | Combo Gà Chill 199k | `1:41037, 1:41037>60255:70079, 1:41037>60255:70087, 1:41037>60255:70088, 2:41046, 3:41046, 4:41063, 5:41089, 5:41093, 5:41099, 5:41100, 6:41089, 6:41093, 6:41099, 6:41100, 7:41089, 7:41093, 7:41099, 7:41100` |
| `20706` | Combo Gà No 279k | `1:41105, 1:41105>60265:70247, 1:41105>60265:70246, 1:41105>60265:70253, 2:41045, 3:41045, 4:41063, 5:41089, 5:41093, 5:41099, 5:41100, 6:41089, 6:41093, 6:41099, 6:41100, 7:41089, 7:41093, 7:41099, 7:41100, 8:41089, 8:41093, 8:41099, 8:41100` |
| `20707` | Combo Gà To 339k | `1:41107, 2:41063, 3:41063, 4:41063, 5:41063, 6:41091, 7:41091, 8:41091, 9:41091` |
| `20708` | Combo Gà Xịn 389k | `1:41106, 1:41106>60266:70258, 1:41106>60266:70261, 1:41106>60266:70263, 2:41108, 3:41063, 4:41063, 5:41063, 6:41089, 6:41093, 6:41099, 6:41100, 7:41089, 7:41093, 7:41099, 7:41100, 8:41089, 8:41093, 8:41099, 8:41100, 9:41089, 9:41093, 9:41099, 9:41100, 10:41089, 10:41093, 10:41099, 10:41100` |
| `20709` | Combo Tiêu Tung Chill 85k | `1:41035, 1:41035>60253:70031, 1:41035>60253:70027, 1:41035>60253:70036, 2:41124, 2:41124>60276:70673, 3:41102, 3:41091` |
| `20710` | Combo Chanh Sang Chảnh 140k | `1:41125, 1:41125>60277:70674, 2:41035, 2:41035>60253:70031, 2:41035>60253:70027, 2:41035>60253:70036, 3:41063, 4:41090, 4:41101, 5:41090, 5:41101` |
| `20711` | Combo Gà Rôm Rả 245k | `1:41126, 1:41126>60278:70685, 2:41037, 2:41037>60255:70079, 2:41037>60255:70087, 2:41037>60255:70088, 3:41090, 3:41101, 4:41090, 4:41101, 5:41090, 5:41101, 6:41116` |
| `20712` | Combo Gà Rôm Rả 245k | `1:41126, 1:41126>60278:70685, 2:41037, 2:41037>60255:70079, 2:41037>60255:70087, 2:41037>60255:70088, 3:41090, 3:41101, 4:41090, 4:41101, 5:41090, 5:41101` |
| `20732` | Xô Hợp Cạ 189k | `1:41170, 1:41170>60292:70258, 1:41170>60292:70261, 1:41170>60292:70263, 2:41063, 3:41090, 3:41101, 4:41090, 4:41101` |
| `20742` | Combo Cùng Vui | `1:41038, 1:41038>60256:70161, 1:41038>60256:70150, 1:41038>60256:70156, 2:40899` |
| `20743` | Combo Cùng "Dzô" | `1:41038, 1:41038>60256:70161, 1:41038>60256:70150, 1:41038>60256:70156, 2:41038, 2:41038>60256:70161, 2:41038>60256:70150, 2:41038>60256:70156, 3:41091, 3:41102, 4:41091, 4:41102, 5:41091, 5:41102, 6:41091, 6:41102` |
| `20748` | Xô Cùng Tiệc 269k | `1:41170, 1:41170>60292:70258, 1:41170>60292:70261, 1:41170>60292:70263, 2:41105, 2:41105>60265:70247, 2:41105>60265:70246, 2:41105>60265:70253, 3:41090, 3:41101, 4:41090, 4:41101, 5:41090, 5:41101` |
| `40905` | 1 Miếng Gà Xốt Mắm Tỏi | `60214:70518` |
| `40906` | 2 Miếng Gà Xốt Mắm Tỏi | `60215:70534` |
| `40907` | 3 Miếng Gà Xốt Mắm Tỏi | `60216:70562` |
| `40908` | Rice G.Fishsauce Chicken | `60217:70518` |
| `40924` | 1 Phần Cơm Gà Xốt Mắm Tỏi | `60221:70518` |
| `40968` | Miễn phí 1 miếng gà cho DH 120K | `60245:70027, 60245:70031, 60245:70036` |
| `41035` | 1 Miếng Gà Rán | `60253:70031, 60253:70027, 60253:70036` |
| `41036` | 2 Miếng Gà Rán | `60254:70003, 60254:70012, 60254:70017` |
| `41037` | 3 Miếng Gà Rán | `60255:70079, 60255:70087, 60255:70088` |
| `41038` | 6 Miếng Gà Rán | `60256:70161, 60256:70150, 60256:70156` |
| `41039` | 1 Miếng Phi-lê Gà Quay | `60257:70059, 60257:70060` |
| `41042` | Burger Gà Yo | `60258:70443, 60258:70444` |
| `41043` | Burger Phi-lê Gà Quay | `60259:70049` |
| `41048` | Mì Ý Gà Rán | `60260:70027, 60260:70031, 60260:70036` |
| `41049` | 1 Cơm Gà Rán | `60261:70027, 60261:70031, 60261:70036` |
| `41051` | 1 Cơm Phi-lê Gà Quay | `60262:70059, 60262:70060` |
| `41123` | 1 Cơm Gà Lắc Tiêu Chanh | `60275:70673` |
| `41127` | 1 Miếng Gà Lắc Tiêu Chanh | `60279:70673` |
| `41128` | 2 Miếng Gà Lắc Tiêu Chanh | `60280:70674` |
| `41129` | 3 Miếng Gà Lắc Tiêu Chanh | `60281:70685` |
| `41140` | Burger Tôm | `60283:70021` |
| `41141` | Burger Gà Zinger | `60284:70046` |
| `41159` | LOY_COB_0d_HD | `60288:70027, 60288:70031, 60288:70036` |
| `41172` | Xô Zòn Zã 159K | `60293:70258, 60293:70261, 60293:70263` |
| `41174` | Xô Zòn Zã 179K | `60294:70258, 60294:70261, 60294:70263` |

## Price-delta audit

Across all 56 trees, only these non-zero deltas exist:

- +3,000 VND: large Pepsi `41091` in each of `20702` drink groups `4` and `5`
- +8,000 VND: cheese add-on for `20699`, `41043`, `41140`, and `41141`
- +27,000 VND: large popcorn chicken option in `20691`

Standalone drink price differences are catalog prices, not compatible combo deltas, and must never be substituted.

## Observation, fixture, and drift contract

The implementation must store a manifest beside every baseline fixture with its source URL, retrieval timestamp, HTTP validators when captured, raw and canonical hashes, generator version, and hashes/counts for every derived file. Baseline regression passes only when:

1. Schema validation succeeds without coercion or silent repair.
2. Item IDs are unique and the raw-to-derived count is explained; no stale derived item survives absence from the raw source.
3. Semantic diff fails closed on any item add/remove, name/description/composition/price change, group min/max change, option ID/name/quantity/default change, nesting or compatibility change, or price-delta change.
4. Every modifier path has an existing parent item and every selected nested option carries its full ancestor path.
5. Baseline catalog evidence remains separate from store/address availability.

For runtime and proof:

6. The current configured menu API is fetched and exhaustively checked against generic schema and relationship invariants; its observation metadata is recorded in the run manifest.
7. The run pins that observation for internal consistency and revalidates consequential actions when the provider version changes or freshness expires.
8. A changed or missing golden candidate fails the proof preflight. The journey must be explicitly updated and reapproved; the baseline fixture is never used as fallback runtime data.
9. A recording reports the observation it captured and is described as pre-recorded. It does not claim that observation is still current.

No runtime fixture or product code was changed while resolving this planning ticket.
