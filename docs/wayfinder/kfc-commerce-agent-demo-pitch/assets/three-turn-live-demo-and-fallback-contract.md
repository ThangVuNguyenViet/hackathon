# Three-Turn Live Demo And Fallback Contract

## Decision

The main demo is one Vietnamese customer journey with exactly three customer-initiated agent runs. It starts with separately requested items, shows a grounded combo recommendation, applies the conversion only after customer approval, offers a priced size upgrade, and uses the final customer turn as informed approval of the upsize plus explicit order confirmation. The final reveal is the verified confirmed order.

The Operations Dashboard is not opened during this live sequence. Inserting a separate human-control session before confirmation is not coherent within the 60-second cap, and opening it afterward would weaken the narrative ticket's confirmed-order ending. Human takeover/resume remains Slide 4 supporting evidence or numbered-appendix evidence.

This contract designs the target; it does not claim that the target is demo-ready today.

## Exact customer turns and checkpoints

An **agent turn** is any customer text or GenUI action that submits a backend request and runs the agent graph. Dashboard actions do not count.

| Turn | Exact Vietnamese submission | Required returned evidence | Failure conditions |
|---|---|---|---|
| 1 | `Cho mình 10 miếng gà và 4 Pepsi cỡ vừa cho 4 người, ngân sách đồ ăn 300.000đ, giao đến Big C Đồng Nai, thanh toán khi nhận hàng.` | The separate-item cart is grounded in mocked upstream/API fixture data: three `41037`, one `41035`, and four `41074`, representing ten chicken pieces and four standard Pepsi, subtotal `404.000đ`. The agent recommends two verified `Combo Đẫy Đà 129K` (`20752`) with the same relevant composition, subtotal `258.000đ`, saving `146.000đ`. It asks before changing the cart. | A combo is substituted before consent; item composition, price, saving, address, or payment wording is wrong; the recommendation is not grounded; the expected recommendation/cart surface is absent. |
| 2 | `Đổi sang 2 Combo Đẫy Đà 129K nhé.` | The loose-item codes are absent and the cart contains two `20752` combos with standard drinks, subtotal `258.000đ`. The agent offers upgrading all four drinks to large Pepsi using modifier `41091`, states `7.000đ` per drink / `28.000đ` total, discloses the resulting `286.000đ` food subtotal and `18.000đ` delivery fee, and does not apply the upsize yet. | Loose items remain; conversion occurs incorrectly; large-drink modifiers appear before consent; any price is wrong; the expected cart/upsize surface is absent. |
| 3 | `Đồng ý nâng cả 4 Pepsi lên cỡ lớn. Tổng món 286.000đ, phí giao 18.000đ; xác nhận đặt đơn và thanh toán khi nhận hàng.` | Both drink modifier groups on each of the two combos use `41091`; food subtotal is `286.000đ`, delivery fee is `18.000đ`, and final total is `304.000đ`. Explicit confirmation permits exactly one order creation. The final customer surface shows the confirmed/created order and cash-on-delivery state. This is a confirmed order, not a paid order. | Upsize is missing or duplicated; totals differ; order is absent or duplicated; confirmation/safety gating fails; final GenUI is not the verified order result. |

The item, modifier, payment, address, fee, and order values above are prototype state backed by fixtures and mocked upstream/API clients. They are not KFC's production system of record.

## Presenter narration

Visible customer text is Vietnamese; presenter narration and slides remain English.

- Before Turn 1: `The customer starts with loose items and a budget. Watch whether the agent finds a better basket without changing anything first.`
- After Turn 1: `It found the same relevant basket as two verified combos: 404,000 down to 258,000 dong, but it waits for the customer.`
- After Turn 2: `With approval, the cart changes. Now it offers four large-drink upgrades for 28,000 dong and discloses the final price before confirmation.`
- After Turn 3: `The customer approved both the modification and the disclosed total. The result is the verified confirmed order.`

During a wait, the baseline line is only: `The request is running; the current build does not expose internal sub-steps.` The presenter must not narrate tool calls, planning stages, or streaming that the customer cannot see.

The current checkout exposes only the generic `KFC đang trả lời...` state in [`customer_chat_screen.dart`](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/customer_chat_screen.dart). If the separate streaming Wayfinder later produces proof-bound customer-visible milestones, the demo may read those exact visible labels verbatim. Candidate labels such as `Đang so sánh combo`, `Đang cập nhật giỏ hàng`, or `Đang xác nhận đơn` are planned examples, not current claims.

## Timing and readiness gate

The main demo segment must complete in 60 seconds or less. The approved hard timeout is **18 seconds per agent response**, measured from submission until the complete expected response and GenUI state are visible. The overall clock still applies; passing three individual 18-second limits does not by itself prove the segment fits within 60 seconds.

Classify the live demo as ready only when all of the following are true:

1. Three consecutive rehearsals use the exact turns above against the intended runtime snapshot.
2. Every response in every rehearsal appears within 18 seconds.
3. Every rehearsal completes the whole customer segment, including submissions and concise narration, within 60 seconds.
4. All three state checkpoints and final single-order outcome are verified from the same session.
5. A recording of that exact scenario, runtime/checkout snapshot, and visible outcome is preloaded and cue-checked.

Current evidence does not pass this gate. The successful live Flutter Scenario 02 artifact at [`2026-07-11T10-06-56-327Z`](../../../../artifacts/genui-live-proof/2026-07-11T10-06-56-327Z/integration-test/manifest.json) is an eight-turn predecessor scenario against local backend `http://127.0.0.1:52996`; its manifest has no Git SHA binding. Its fastest observed intervals between customer submissions were `17.950–25.477s`, and an earlier successful run varied from `31.473–160.262s`. Neither artifact proves this three-turn contract. No matching fallback recording exists.

## Immediate fallback contract

Trigger fallback immediately when any of these occurs:

- 18 seconds elapse after a submission without the complete expected response and GenUI;
- the returned card/widget, recommendation, item composition, price, saving, modifier state, cart state, fulfillment fee, payment state, or final order outcome differs from the checkpoint;
- the UI reports an error, the backend becomes unavailable, the session is stale, or a duplicate/early order appears.

Use exactly one transition line:

> I'll switch to the recorded run of this exact scenario.

The preloaded recording must prove the same three customer submissions and the same runtime/checkout snapshot as its manifest. It must include cue points at: clean start, Turn 1 submitted, combo recommendation visible, Turn 2 submitted, upsize offer visible, Turn 3 submitted, and confirmed order visible. Switch from the last verified matching cue; if live state is already inconsistent, restart the recording from clean start. Do not explain the failure, improvise a fourth turn, repair the cart onstage, or switch to a different scenario.

The recording is part of readiness, not an optional later asset. If it is missing, stale, differently scripted, or unbound to its snapshot, neither the live path nor fallback path is ready.

## Tab and runtime preparation

Prepare before Slide 6:

1. Customer-chat tab on a clean, reset session with Turn 1 prefilled but unsent.
2. Exact-scenario recording paused at its clean-start cue, with the remaining cue points tested.
3. Slide 6 ready for the return transition after the confirmed-order reveal.
4. Runtime readiness checked without creating an order; record backend endpoint, deployment/release identity, local checkout SHA if applicable, fixture version, and recording manifest.
5. No Operations Dashboard tab in the live-demo tab order. Human-control evidence is prepared only in Slide 4 support or the numbered appendix.

Do not send customer-facing messages through Messenger, Zalo, or any external channel during preparation or rehearsal without explicit authorization. The intended demo surface is the first-party KFC customer chat using mocked upstream/API commerce data.

## Evidence boundaries

- The scenario design and exact conversion/upsize arithmetic come from [`KFC Combo Conversion and Upsize Scenario Design`](../../../../docs/superpowers/specs/2026-07-11-kfc-combo-conversion-upsize-scenario-design.md).
- GenUI actions are normalized customer turns under the current [`KFC Customer GenUI Ordering Chat Design`](../../../../docs/superpowers/specs/2026-07-09-kfc-customer-genui-ordering-chat-design.md).
- Explicit confirmation and final order gating are implemented and deterministically exercised in [`order-confirmation.test.ts`](../../../../services/kfc-agent-backend/test/graph/order-confirmation.test.ts) and [`safetyGates.ts`](../../../../services/kfc-agent-backend/src/ordering/safetyGates.ts).
- The resolved narrative authority is [`Lock Six-Slide Narrative And Claim Language`](../issues/02-lock-six-slide-narrative-and-claim-language.md): the demo ends on the confirmed customer order and does not open the dashboard afterward.
- Human-control behavior remains supported evidence through the provenance-limited [`warning/escalation manifest`](../../../../artifacts/warning-escalation-proof/2026-07-11T06-11-03-078Z/manifest.json), but it is not the same customer journey and is not shown in this live segment.

## Readiness result

**Design resolved; live demo not ready.** Readiness requires the exact three-turn implementation/proof, three consecutive sub-18-second and sub-60-second rehearsals, and a provenance-bound matching recording. This ticket does not implement product behavior, produce the recording, or authorize unsupported claims.
