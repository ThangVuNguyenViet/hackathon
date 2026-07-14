Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 01-audit-current-demo-failures-and-commerce-fallbacks.md, 03-verify-and-freeze-menu-and-modifier-snapshot.md
Assignee: Codex

## Question

What exact three-minute first-party KFC journey should be presented, using natural two-to-seven-word non-address turns and a deliberate text/GenUI split? Resolve the customer turns, GenUI actions, selected catalog entities, modifier-aware suggestion, cart-before/cart-after checkpoints, upsize economics, address entry and acceptance, supported payment selection, explicit order confirmation, sandbox-provider paid transition, order-status query, delivery-status query, presenter narration, latency budget, and failure conditions. Keep every expected claim bound to verified evidence in the current Commerce Environment and obtain user approval of the complete journey contract.

## Resolution

Present one `20702` `Combo Burger Gà Yo & Gà Rán`; do not add promotions, invoices, or a second order to the three-minute path. Text carries discovery and status questions. GenUI carries exact item and modifier choices, cart mutation, address acceptance, payment selection, and the irreversible order confirmation.

Use this exact journey:

1. Presenter, `0:00-0:10`: “Một hành trình đặt món hoàn chỉnh; mọi giá và trạng thái đều đến từ môi trường hiện tại.” Start a fresh sandbox session bound to the release, frozen catalog snapshot, customer, and golden-journey scenario.
2. Customer: `Có combo gà cay không?` The assistant recommends verified item `20702` at 129,000 VND and renders its menu control. GenUI selects parent items `41036`, `41042`, and `41063`; spicy chicken `60254:70012` twice; spicy burger `60258:70443`; and medium Pepsi `4:41090` and `5:41090`. After the explicit add action, cart revision 1 is one `20702` at 129,000 VND.
3. The assistant offers the verified two-drink upsize for 6,000 VND. GenUI replaces `4:41090` and `5:41090` with `4:41091` and `5:41091`, each +3,000 VND. Cart revision 2 is 135,000 VND; no medium-drink selection remains.
4. GenUI continues to fulfillment and submits `Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7, TP.HCM`. The configured sandbox scenario provider must return the accepted normalized address, store assignment `KFCVN0058`, store-specific availability for `20702`, an 18,000 VND fee, and a 25-minute ETA before GenUI may offer `Giao đến địa chỉ này`. Acceptance produces a 153,000 VND total.
5. Customer: `ZaloPay được không?` The assistant answers from verified payment-method evidence. GenUI then selects `zalopay_wallet`; this choice neither creates an order nor claims payment success.
6. `orderReviewConfirm` shows the exact item, modifiers, address, assigned store, 135,000 VND subtotal, 18,000 VND fee, 153,000 VND total, and ZaloPay. The customer invokes the single-use `confirm_order` action. Only that approval may place the order. The configured provider returns order `KFC-1001`, order status `created`, payment status `pending`, and its payment URL; a duplicate confirmation returns the same result rather than placing another order.
7. The customer completes the configured sandbox checkout. Its provider callback, not customer wording or query count, advances payment from `pending` to `paid`.
8. Customer: `Thanh toán xong chưa?` A fresh provider query must return `paid` before text or `paymentOrderStatus` reports success.
9. The proof harness advances the environment-scoped order lifecycle to `preparing`. Customer: `Đơn đang làm chưa?` A fresh provider query reports `preparing` through text and `orderTrackingStatus`.
10. The proof harness advances the lifecycle to `delivering`. Customer: `Bao giờ giao tới?` A fresh provider query reports `delivering` and the configured remaining ETA, 15 minutes.
11. Presenter, by `2:55`: “AI tìm đúng món; khách kiểm soát mọi thay đổi và xác nhận; giá, thanh toán và giao hàng đều được kiểm tra lại.”

The five non-address customer text turns are exactly the five quoted questions above; each is two to seven words. `KFCVN0058`, 18,000 VND, both ETAs, `KFC-1001`, and the payment URL are configured sandbox scenario outputs, not facts established by the public catalog. They become authoritative only when the configured provider returns them with the required environment, subject, journey, revision/version, and freshness bindings. They receive no customer-facing simulation or mock label.

First visible progress must appear within two seconds; discovery must complete within eight seconds; a structured action or provider mutation within three seconds; and a status query within five seconds. Target completion is 165 seconds, with 180 seconds an absolute failure boundary. Any single step over ten seconds fails the run.

The run also fails on an unsupported or stale fact, missing binding, unbound fallback, hidden retry, manual state repair, premature mutation, duplicate order, inferred lifecycle transition, or any text/GenUI/provider/persisted-state contradiction. Store assignment and availability, address acceptance, fee/ETA, order identity, payment URL, and all lifecycle statuses remain absent and block dependent actions unless the current provider supplies them.
