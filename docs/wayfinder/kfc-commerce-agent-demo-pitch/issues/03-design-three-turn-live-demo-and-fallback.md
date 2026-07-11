Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 01-audit-pitch-evidence-and-demo-readiness.md
Assignee: Codex (current thread)

## Question

What exact Vietnamese customer turns, GenUI actions, semantic progress milestones, state checkpoints, operator-dashboard moment, tab preparation, wait narration, timeout threshold, and fallback transition will prove a complete governed order in 55-65 seconds? The design must cap the live path at three agent turns, avoid unsupported narration, use a pre-seeded human-control session, and switch cleanly to a recording of the same scenario when a live checkpoint fails or exceeds the agreed latency.

## Working decisions

- Approved: an agent turn is any customer text or GenUI action that triggers the backend agent graph. Dashboard operator actions do not count. The live path therefore permits exactly three combined text/GenUI submissions.
- Approved canonical scenario: (1) send `Cho mình 1 Combo Hợp Gu 99K, giao đến Big C Đồng Nai, thanh toán khi nhận hàng.`; (2) tap `Giao đến địa chỉ này`; (3) tap the offered `Đặt đơn …` confirmation. The expected state surfaces are `addressFulfillmentCheck`, then `orderReviewConfirm`, then `paymentOrderStatus` with an `order_created` event. Voucher, invoice, and upsell are excluded from the live path. Exact live proof remains a rehearsal gate rather than an established fact.
- Superseding stakeholder input: the KFC team specifically wants the demo to show rational conversion of separately ordered items into a verified combo and a size upgrade. The previously approved simple checkout scenario is therefore no longer the preferred commercial story and must be revised without pretending that the currently designed combo scenario already completes an order.
- Superseded by resolved narrative ticket 02: the previously approved `286.000đ` `cart_ready` ending is insufficient. The live customer path must continue through explicit confirmation and end on a verified confirmed order.
- Superseded by resolved narrative ticket 02: do not switch to the Operations Dashboard after the confirmed-order reveal. Current latency evidence leaves no credible room for a coherent dashboard interaction before confirmation within 60 seconds, so human-control proof moves to Slide 4 supporting evidence or the numbered appendix. It is not part of the live three-turn contract.
- Binding reconciled target: preserve the KFC-requested loose-item-to-combo conversion and size upsell, capture customer approval for each modification, and use the third and final customer submission as informed approval of the disclosed upsize and explicit order confirmation. This combined final action remains a rehearsal-gated target, not currently proven live behavior.
- Approved readiness gate: every response must appear within 18 seconds in three consecutive exact-scenario rehearsals; switch immediately to the matching recording at 18 seconds or on any wrong card, price, cart state, or failed outcome. The full customer segment must also remain within 60 seconds.

## Resolution

[Three-Turn Live Demo And Fallback Contract](../assets/three-turn-live-demo-and-fallback-contract.md) defines the exact Vietnamese submissions, consent and state checkpoints, confirmed-order ending, truth-safe narration, conditional semantic-progress language, 18-second timeout, three-rehearsal and 60-second gates, matching recording cues, fallback line, and tab/runtime preparation.

The conflict with the earlier working decisions is resolved explicitly: the KFC-requested combo conversion and size upsell remain central, but `cart_ready` is no longer the ending; Turn 3 combines informed upsize approval with explicit confirmation and must reveal the verified confirmed order. The previously approved post-confirmation Operations Dashboard interaction is removed from the live sequence. Current latency evidence leaves no credible room for it before confirmation within 60 seconds, so human-control proof moves to Slide 4 supporting evidence or the numbered appendix.

This resolves the demo contract, not demo readiness. The exact three-turn path and matching recording do not yet have current provenance-bound live proof, so the live demo remains **not ready** until every gate in the linked contract passes. Fixtures remain mocked upstream/API data, not KFC's production system of record.
