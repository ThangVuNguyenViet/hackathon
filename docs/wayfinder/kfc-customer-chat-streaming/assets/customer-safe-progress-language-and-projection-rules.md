# Customer-Safe Progress Language And Projection Rules

## Decision

KFC customer chat shows **Customer-Safe Agent Progress** as one active, evidence-backed Vietnamese status for the newest valid run. The status changes only when the customer-meaningful activity changes. At the first text delta it collapses to one deterministic completion summary; technical history remains in operator and proof surfaces.

The backend owns projection from internal evidence to a customer-safe progress family. Flutter renders the already-projected family and copy key. Flutter must not infer work from elapsed time, map raw tool names, inspect LangSmith spans, or turn missing events into a fabricated status.

## Display model

1. Immediately after Send, Flutter may show a subtle animated assistant placeholder. It contains no claim about work performed.
2. After backend run acceptance/start evidence exists, the first semantic label may be `Đang xem yêu cầu của bạn…`.
3. Exactly one active semantic status is visible. A new status replaces the prior status; customer chat does not accumulate a step history.
4. Repeated events in the same progress family are deduplicated. Very fast intermediate families may be skipped rather than flashed; exact timing belongs to the Cue prototype.
5. When response composition starts, show `Đang chuẩn bị câu trả lời…` if composition is not immediate.
6. On the first text delta, collapse active progress into a deterministic summary and stream text in the assistant bubble. Do not show a second typing indicator.
7. A deterministic fallback that is already available may render directly without a preparation label.
8. Terminal failure, Stop, supersession, and reconnect follow the rules below.

## Canonical active labels

### General

| Family | Active label | Allowed evidence |
|---|---|---|
| `reviewing_request` | `Đang xem yêu cầu của bạn…` | Accepted/current run has started; context or planning work is active. No more specific customer-safe family has started. |
| `preparing_response` | `Đang chuẩn bị câu trả lời…` | The response-composition phase has started after verified planning/tool work. |

Planner iterations never create distinct customer labels. Repeated planning remains `reviewing_request` until a more specific verified family begins.

### Read-only checking

| Family | Active label | Allowed evidence | Current tool/outcome examples |
|---|---|---|---|
| `checking_menu` | `Đang kiểm tra menu…` | A permitted menu, item-detail, modifier, or recommendation lookup has started. | `searchMenu`, `getItemDetails`, `getModifierOptions`, `recommendAddOns` |
| `checking_promotions` | `Đang kiểm tra ưu đãi…` | Promotion discovery, explanation, or voucher validation has started without an application success claim. | `searchPromotions`, `explainPromotion`, `validateVoucher` |
| `checking_food_information` | `Đang kiểm tra thông tin món…` | Ingredient, allergen, or food-content evidence lookup has started. | `answerAllergenQuestion`; food-information use of `searchContentPolicy` |
| `checking_fulfillment` | `Đang kiểm tra địa chỉ và giao hàng…` | Store discovery, item availability, or fulfillment quote has started. | `findStores`, `checkStoreAvailability`, `quoteFulfillment` |
| `checking_payment` | `Đang kiểm tra thanh toán…` | Payment-method discovery or payment-status lookup has started. | `listPaymentMethods`, `checkPaymentStatus` |
| `checking_order_status` | `Đang kiểm tra trạng thái đơn…` | Existing order or delivery-status lookup has started. | `getOrderStatus` |

These are semantic families, not one-to-one tool labels. `previewCart`, membership reads, general policy search, and any future tool without an approved customer-safe family remain under the current broader status, normally `reviewing_request`. The runtime must never improvise a new label from a tool name.

### State-changing work

| Family | Active label | Allowed start evidence | Verified success required for completion claim |
|---|---|---|---|
| `updating_cart` | `Đang cập nhật giỏ hàng…` | A permitted cart mutation is about to execute. | Verified changed cart from `updateCart` |
| `applying_promotion` | `Đang áp dụng ưu đãi…` | An authorized promotion/voucher application is about to execute. Validation alone remains read-only. | Verified applied voucher/discount outcome |
| `updating_fulfillment` | `Đang cập nhật phương thức nhận món…` | An authorized fulfillment selection/change is about to execute. | Verified fulfillment state reflects the selection |
| `recording_invoice` | `Đang ghi nhận thông tin hóa đơn…` | Valid invoice details are about to be recorded. | Verified invoice request state |
| `preparing_order` | `Đang chuẩn bị đơn hàng…` | Order preview/preparation is about to execute. | Verified order preview |
| `submitting_order` | `Đang gửi yêu cầu đặt đơn…` | Authorized order placement has crossed its execution start boundary. | Verified created order; success copy may say `Đã tạo đơn hàng.` |
| `preparing_payment` | `Đang chuẩn bị thanh toán…` | Authorized payment-link creation is about to execute. | Verified payment URL/method state |
| `transferring_support` | `Đang chuyển yêu cầu hỗ trợ…` | Authorized human handoff is about to execute. | Verified queued/created handoff |

The active labels describe attempted work, not success. In particular, `Đang gửi yêu cầu đặt đơn…` is required instead of wording that claims the order already exists.

Membership acquisition/redemption and any other mutation without an agreed customer label remain under `reviewing_request`; their verified outcome appears in the final response. A later product decision may add a canonical family, but implementation may not invent one.

## Evidence boundary

An active tool-backed family may begin only from an always-on internal `tool_started`-equivalent fact emitted after:

- the run is current;
- the planner proposed the operation or a trusted GenUI action selected it;
- arguments passed structural validation;
- policy/safety gates allowed it;
- execution is about to begin.

The current success-only dashboard `session_updated/updateType=tool_called` is a completion fact and cannot honestly drive an in-progress label. The implementation must add an internal start fact rather than backdating progress from a successful result.

A completion summary may include a family only after its matching verified success fact. Attempted, blocked, failed, skipped, or superseded work is excluded.

## Deterministic completion summaries

The backend or shared presentation model constructs summaries from fixed mappings over distinct verified-success families. It does not ask an LLM to narrate work.

| Verified family | Completion phrase |
|---|---|
| `reviewing_request` | `Đã xem yêu cầu.` |
| `checking_menu` | `Đã kiểm tra menu.` |
| `checking_promotions` | `Đã kiểm tra ưu đãi.` |
| `checking_food_information` | `Đã kiểm tra thông tin món.` |
| `checking_fulfillment` | `Đã kiểm tra địa chỉ và giao hàng.` |
| `checking_payment` | `Đã kiểm tra thanh toán.` |
| `checking_order_status` | `Đã kiểm tra trạng thái đơn.` |
| `updating_cart` | `Đã cập nhật giỏ hàng.` |
| `applying_promotion` | `Đã áp dụng ưu đãi.` |
| `updating_fulfillment` | `Đã cập nhật phương thức nhận món.` |
| `recording_invoice` | `Đã ghi nhận thông tin hóa đơn.` |
| `preparing_order` | `Đã chuẩn bị đơn hàng.` |
| `submitting_order` | `Đã tạo đơn hàng.` |
| `preparing_payment` | `Đã chuẩn bị thanh toán.` |
| `transferring_support` | `Đã chuyển yêu cầu đến nhân viên hỗ trợ.` |

Rules:

- Prefer the two most customer-meaningful verified families in chronological order.
- Two phrases are joined naturally, for example `Đã kiểm tra menu và cập nhật giỏ hàng.`
- More than two distinct meaningful families collapse to `Đã hoàn tất các bước kiểm tra cần thiết.`
- `preparing_response` is never listed as completed work.
- If an immediate no-tool turn skipped semantic progress, it may also skip the completion summary.
- A family that only started but did not succeed never appears as completed.

## Policy and safety projection

- Never display `Đang kiểm tra chính sách`, safety gates, risk scores, context policy, confirmation-rule names, or block reasons.
- While policy is evaluated, retain the current broader customer status.
- A concrete order-confirmation safeguard may use the broader `reviewing_request` status; the final response asks for confirmation plainly.
- Unsupported or unsafe outcomes are explained in the final customer response without exposing prompts, hidden rules, scores, or internal classifications.
- Repeated planner or policy passes do not cause visible churn.

## No-tool turns

Greetings, thanks, and other no-tool turns use the immediate placeholder, optionally `Đang xem yêu cầu của bạn…` after run start, then streamed text. They never show a checking or mutation family. If the response is immediate, semantic progress and its completion summary may both be skipped.

## Ordering, delay, and replay

- Apply customer progress events in durable run sequence.
- Ignore duplicate event IDs/sequences.
- During active work, the latest distinct customer-meaningful family may replace the prior family.
- Once response composition or text streaming begins, late work events may update evidence but cannot reopen an earlier active label.
- After a terminal outcome, no later event changes customer-visible progress.
- A sequence gap freezes advancement and triggers replay. Flutter does not guess the missing status.

## Failure behavior

Recoverable planner, provider, lookup, tool, or fallback failures remain invisible when the run safely continues. Preserve them in operator/proof evidence.

A customer-impacting terminal failure replaces progress with a phase-specific message and retains the last authoritative state:

- `Chưa thể kiểm tra menu lúc này.`
- `Chưa thể cập nhật giỏ hàng.`
- `Chưa thể kiểm tra giao hàng.`
- `Chưa thể tạo yêu cầu đặt đơn.`
- `Chưa thể chuẩn bị thanh toán.`

Use the closest approved phase wording. Offer Retry only where the lifecycle contract later declares it safe. Never show raw exceptions, provider messages, stack traces, HTTP statuses, or error codes.

## Reconnection, Stop, and supersession

### Run Transport Loss

Freeze the last verified progress and show a secondary connection line:

```text
Đang kiểm tra menu…
Đang kết nối lại…
```

Remove the connection line after replay fills the gap. Transport loss does not become failure, cancellation, or a new semantic family.

### Explicit Stop

- After the cancellation command is accepted: `Đang dừng…`
- After the durable cancelled terminal event: `Đã dừng.`
- Retain partial streamed text and mark it incomplete.
- Remove provisional GenUI that never became authoritative.
- Never imply that an irreversible action was reversed.

### Newer customer input

- Never display `superseded`, generation numbers, or run-coordination language.
- If the old run produced no text, remove its placeholder.
- If it produced partial text, retain it with `Đã dừng câu trả lời trước.`
- Show active progress only for the newest valid run.
- If an irreversible action completed, preserve that verified result and treat the new message as a follow-up.

## Handoff boundary

Active handoff uses `Đang chuyển yêu cầu hỗ trợ…`; verified completion uses `Đã chuyển yêu cầu đến nhân viên hỗ trợ.` Internal reasons such as risk score, angry-customer classification, abnormal-order rules, safety labels, or tool failure remain private. The final assistant response may state a plain customer-safe reason such as a payment issue requiring help.

## Forbidden customer-progress detail

Customer progress must never contain:

- raw tool names, arguments, result summaries, provenance paths, fixture names, or API endpoints;
- planner intent/entities, iteration counts, prompts, model names, tokens, or chain-of-thought;
- policy names, safety reasons, risk/confidence scores, or confirmation-rule identifiers;
- trace IDs, run generations, queue attempts, retry counts, internal timestamps, or latency diagnostics;
- raw error codes, exception text, HTTP status, stack traces, or provider failures;
- internal escalation classifications;
- customer, order, payment, address, membership, or credential values not already intended for the final customer response.

Operator and proof surfaces may retain authorized technical evidence. They must correlate it to the projected customer event rather than copying it into customer chat.

## Copy style

- Vietnamese, concise, customer-facing, and action-led.
- Active labels begin with `Đang` and end with an ellipsis.
- Completed and failed states are full sentences ending with a period.
- No English technical terms, IDs, scores, model/tool names, or timestamps.
- Do not claim customer emotion or intent.
- Keep canonical labels short enough to remain one line on ordinary mobile widths; exact responsive treatment belongs to the prototype.

## Acceptance examples

### Menu recommendation

```text
animated placeholder
Đang xem yêu cầu của bạn…
Đang kiểm tra menu…
Đang chuẩn bị câu trả lời…
Đã kiểm tra menu. + streamed response
```

### Menu selection and cart update

```text
Đang xem yêu cầu của bạn…
Đang kiểm tra menu…
Đang cập nhật giỏ hàng…
Đang chuẩn bị câu trả lời…
Đã kiểm tra menu và cập nhật giỏ hàng. + streamed response
```

### Order placement

```text
Đang chuẩn bị đơn hàng…
Đang gửi yêu cầu đặt đơn…
Đang chuẩn bị câu trả lời…
Đã chuẩn bị đơn hàng và tạo đơn hàng. + streamed response
```

The created-order completion phrase is legal only after verified order creation. A failed attempt becomes `Chưa thể tạo yêu cầu đặt đơn.`

### Policy-required clarification

```text
Đang xem yêu cầu của bạn…
streamed clarification response
```

No policy label or block reason appears.

### Recoverable lookup failure

```text
Đang kiểm tra menu…
<internal recovery remains invisible>
Đang chuẩn bị câu trả lời…
```

If the run ultimately lacks verified menu evidence, its completion summary does not claim that menu was successfully checked.

## Effect on later tickets

- **Prototype The Visible Progress And Cue Motion Experience** now has fixed states, copy, and transition scenarios to render with the user.
- **Design Text-Delta Streaming And Partial-Response Safety** owns the exact first-delta boundary and partial-text model.
- **Design Versioned GenUI Structural Streaming** owns provisional/authoritative UI behavior; this decision only says provisional UI disappears on cancellation.
- **Design Run Lifecycle, Ordering, Replay, And Recovery Contracts** owns event schemas, cancellation safe points, retry safety, and terminal state reduction.
- **Design Evidence Correlation And Demo Proof** must prove that every displayed family is linked to its allowed evidence and that forbidden detail never reaches Flutter.

No additional child ticket is required by this decision.
