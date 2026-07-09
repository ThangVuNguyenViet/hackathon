# KFC Customer GenUI Ordering Chat Design

Date: 2026-07-09

## Purpose

Build a separate customer-facing Flutter ordering chat for KFC Vietnam. The app
shares the same backend conversation engine as Messenger and Zalo, but renders
structured GenUI widgets when a visual control is more useful than a long text
reply.

The first release should prove the full customer ordering lifecycle with a small
job-based widget catalog. It should not be added as a tab inside the operator
live monitor. The monitor remains staff-facing; this app is customer-facing.

## Project Context

The current MVP already targets Messenger and Zalo conversational ordering with
mock KFC-adjacent integrations, fixture-backed menu and ordering tools, D1 or
Postgres transcript persistence, and a Flutter live monitor.

The 50 documented KFC use cases are grouped into eight natural conversation
journeys:

- clear ordering, delivery, voucher, payment, invoice, and store assignment;
- combo consultation, budget, group ordering, promotions, and upsell;
- inventory, address, store coverage, substitution, and peak-hour delay;
- order tracking, cancellation, reorder, and post-order modification;
- complaint, wrong item, feedback, angry customer, and human handoff;
- slang, typo handling, allergy or safety, spam, ambiguity, and unsupported
  requests;
- personalization, favorites, loyalty, and cart edits;
- payment failure and abnormal order review.

The Travel repo provides the reference implementation pattern: typed generated
controls and surfaces, deterministic Flutter fallback widgets, a GenUI boundary
around richer rendering, transcript persistence of GenUI attachments, and live
AI coverage tests that fail when required GenUI surfaces do not appear.

## Product Boundary

The new customer app is a separate Flutter app or package surface from
`apps/kfc_live_monitor_flutter`.

```text
Customer Flutter Chat
  -> same normalized conversation input as Messenger and Zalo
  -> KFC agent graph
  -> verified tools and backend state
  -> assistant text plus optional KFC GenUI attachment
  -> Flutter renders the specialized widget with deterministic fallback
```

The live monitor continues to own:

- operator queue;
- transcripts;
- alerts and handoff;
- session health;
- operational and cost-efficiency metrics.

The customer app owns:

- menu discovery;
- cart shaping;
- delivery and fulfillment checks;
- order review and confirmation;
- payment retry and order tracking;
- complaint or human-handoff status.

## Channel Parity Rule

Every GenUI action must map to a backend action that Messenger and Zalo can also
trigger through text, quick replies, or numbered choices. This is behavior
parity, not visual parity.

Example:

```text
Flutter GenUI button: Add Zinger Combo
Messenger/Zalo equivalent: "1", "Thêm Zinger Combo", or a quick reply
Backend action: add_item(itemCode: ...)
```

Flutter may render a better control, but it must not create a separate business
path for order placement, voucher application, payment retry, handoff, or any
other customer action.

## Visual Direction

The customer chat should feel like a KFC digital counter, not a generic chatbot.

Use:

- KFC red, white, and black as the dominant system colors;
- Be Vietnam Pro for Vietnamese readability and consistency with the current
  KFC Flutter app;
- compact shadcn-style controls with 4px to 8px radii;
- receipt-like dividers for cart and order review rows;
- kitchen-ticket progress strips for cart, fulfillment, payment, and order
  status;
- concise labels and action text owned by the widget, not duplicated in the
  surrounding chat bubble.

Avoid a stack of decorative cards. Each widget should be a focused tool for one
customer job.

## Data Contract

The customer app receives GenUI attachments from the backend. Attachments are
persisted with the transcript so the chat history can be replayed and the live
monitor can inspect what the customer saw.

```text
KfcGenUiAttachment
  id
  lifecycleStage
  widgetKind
  status
  title
  summary
  data
  actions
  selectedAction
  expiresAt?
```

Recommended `widgetKind` values:

```text
smartMenuPicker
cartBuilder
addressFulfillmentCheck
orderReviewConfirm
paymentOrderStatus
supportHandoff
```

Each customer interaction sends a structured action back to the backend:

```text
KfcGenUiAction
  attachmentId
  actionId
  value
  payload
```

Representative action IDs:

```text
add_item
view_details
choose_combo_size
skip_recommendation
update_quantity
remove_item
swap_item
select_modifier
use_loyalty
select_saved_address
submit_address
select_substitution
accept_eta
switch_to_pickup
apply_voucher
edit_invoice
edit_note
select_payment_method
confirm_order
retry_payment
switch_payment_method
track_order
cancel_order
request_modify_order
request_human
submit_complaint
rate_order
confirm_large_order_review
```

The backend treats a GenUI action as a normalized customer turn. Flutter must
not mutate durable cart, payment, order, loyalty, voucher, or handoff state
locally.

## MVP Widget Catalog

### SmartMenuPicker

Job: help the customer choose food.

Displays:

- recommended items;
- combo choices;
- prices;
- availability;
- short reason for the recommendation;
- add or view-detail actions.

Actions:

- `add_item`;
- `view_details`;
- `choose_combo_size`;
- `skip_recommendation`.

Primary use case coverage:

- UC-02, UC-03, UC-04, UC-09, UC-10, UC-19, UC-20, UC-21, UC-22.

### CartBuilder

Job: let the customer shape the cart.

Displays:

- cart lines;
- quantity controls;
- modifiers;
- swaps;
- subtotal;
- loyalty or voucher hints.

Actions:

- `update_quantity`;
- `remove_item`;
- `swap_item`;
- `select_modifier`;
- `use_loyalty`.

Primary use case coverage:

- UC-01, UC-05, UC-10, UC-16, UC-45, UC-46.

### AddressFulfillmentCheck

Job: verify delivery feasibility before checkout.

Displays:

- provided or saved address;
- nearest store;
- delivery zone state;
- fee;
- ETA;
- item availability;
- peak-hour warning;
- substitution or pickup choices when needed.

Actions:

- `select_saved_address`;
- `submit_address`;
- `select_substitution`;
- `accept_eta`;
- `switch_to_pickup`.

Primary use case coverage:

- UC-06, UC-07, UC-08, UC-29, UC-30, UC-31, UC-47, UC-48, UC-49.

### OrderReviewConfirm

Job: make final order placement explicit.

Displays:

- complete cart;
- address and fulfillment result;
- total;
- voucher;
- invoice data;
- delivery note;
- payment method;
- safety checklist for final confirmation.

Actions:

- `apply_voucher`;
- `edit_invoice`;
- `edit_note`;
- `select_payment_method`;
- `confirm_order`.

Primary use case coverage:

- UC-01, UC-11, UC-23, UC-32, UC-34, UC-35.

Safety rule:

Only `OrderReviewConfirm` can expose `confirm_order`, and only after the backend
has a valid cart, valid fulfillment result, final total, and selected payment
path. The `confirm_order` action is the explicit customer confirmation.

### PaymentOrderStatus

Job: handle payment and post-order state.

Displays:

- payment state;
- retry or switch-payment option;
- order timeline;
- cancellation or modification window;
- delivery ETA.

Actions:

- `retry_payment`;
- `switch_payment_method`;
- `track_order`;
- `cancel_order`;
- `request_modify_order`.

Primary use case coverage:

- UC-12, UC-13, UC-24, UC-26, UC-27, UC-33, UC-36, UC-37.

### SupportHandoff

Job: resolve unsafe, ambiguous, upset-customer, complaint, or human-needed
cases.

Displays:

- issue summary;
- reason for handoff;
- collected evidence;
- next step;
- expected wait or review state.

Actions:

- `request_human`;
- `submit_complaint`;
- `rate_order`;
- `confirm_large_order_review`.

Primary use case coverage:

- UC-14, UC-17, UC-28, UC-38, UC-39, UC-40, UC-41, UC-42, UC-43, UC-50.

## Lifecycle Rules

Normal ordering flow:

```text
SmartMenuPicker
  -> CartBuilder
  -> AddressFulfillmentCheck
  -> OrderReviewConfirm
  -> PaymentOrderStatus
  -> SupportHandoff when needed
```

Widgets may appear out of order when the customer starts from another job. For
example, "Don cua minh toi dau roi?" should enter `PaymentOrderStatus`, not
`SmartMenuPicker`.

Each widget should do one customer job. If a widget needs tabs, nested card
groups, or unrelated controls, the agent should emit the next lifecycle widget
instead.

## Rendering Rules

The assistant turn should usually contain:

1. one short conversational sentence;
2. one focused GenUI attachment;
3. no duplicate long recap if the widget already displays the title, prompt,
   summary, or action details.

Historical GenUI attachments remain visible in the transcript. Answered widgets
may collapse to compact receipts, while the latest actionable widget remains
fully interactive.

Unsupported or expired widget actions should result in a backend-owned recovery
message and a fresh widget, not local state mutation.

## Error Handling

- If a GenUI action is malformed, the backend rejects it and returns a clear
  customer-facing recovery turn.
- If an attachment has expired, the backend refreshes the relevant state before
  allowing payment or order actions.
- If the selected item becomes unavailable, the backend emits
  `AddressFulfillmentCheck` with substitutions rather than allowing checkout to
  continue.
- If payment state is ambiguous, `PaymentOrderStatus` must show a retry or
  switch-payment path and must not claim payment success without payment-tool
  evidence.
- If order size, language, policy, complaint, or customer sentiment requires a
  human, the backend emits `SupportHandoff` and dashboard handoff events.

## Live AI GenUI Test Suite

Add a separate live GenUI behavior suite for this customer app. It should not
replace the existing eight-scenario UC-01 through UC-50 backend replay suite.

In this repo, "live AI no mock" means:

- live model planning and response composition;
- no mocked model output;
- no scripted GenUI decisions;
- fixture-backed KFC, OMS, payment, loyalty, voucher, and fulfillment tools
  remain acceptable because the MVP explicitly does not use real KFC production
  integrations.

Recommended command shape:

```bash
OPENAI_API_KEY=... RUN_LIVE_AI_GENUI=1 npm run test:live:genui
```

For Flutter proof:

```bash
flutter test integration_test/kfc_ordering_live_ai_genui_flow_test.dart \
  --dart-define=KFC_AGENT_BACKEND_URL=http://localhost:18090 \
  --dart-define=RUN_LIVE_AI_GENUI=true
```

### Scenario 1: Recommendation To Menu Picker

Prompt: "Khong biet an gi, goi y combo cho 2 nguoi."

Required widget: `SmartMenuPicker`.

Assertions:

- live model calls menu or recommendation tools;
- the widget displays item options;
- no cart mutation happens until the user selects an option.

### Scenario 2: Selection To Cart Builder

Flow: user selects a combo, edits side or drink, and changes quantity.

Required widget: `CartBuilder`.

Assertions:

- GenUI action updates cart through the backend;
- cart total changes;
- transcript stores the GenUI attachment and selected action.

### Scenario 3: Address And Fulfillment

Flow: user gives an unclear or saved address, then confirms delivery.

Required widget: `AddressFulfillmentCheck`.

Assertions:

- address, store, fee, ETA, and availability tool evidence exists;
- out-of-zone, unavailable, or peak-hour state appears as structured choices
  instead of plain text only.

### Scenario 4: Checkout Review

Flow: user applies voucher, adds delivery note or invoice data, and chooses
payment.

Required widget: `OrderReviewConfirm`.

Assertions:

- voucher, invoice, note, payment method, total, and fulfillment summary are
  visible;
- `placeOrder` is forbidden before explicit confirmation.

### Scenario 5: Explicit Confirmation

Flow: user confirms the reviewed order.

Required widgets: `OrderReviewConfirm` followed by `PaymentOrderStatus`.

Assertions:

- after confirmation, the backend has `previewOrder`, `placeOrder`, and payment
  tool evidence;
- no order placement happens before `confirm_order` or equivalent text
  confirmation.

### Scenario 6: Payment Failure Recovery

Flow: payment fails, then the user retries or switches method.

Required widget: `PaymentOrderStatus`.

Assertions:

- live model checks payment status;
- retry or switch action is structured;
- no paid state is shown without payment-tool output.

### Scenario 7: Tracking And Modification

Flow: user asks where the order is, then asks to cancel or modify it.

Required widget: `PaymentOrderStatus`.

Assertions:

- order status timeline appears;
- cancellation or modification respects the OMS state;
- if the order is too late to change safely, the flow hands off instead of
  mutating order state.

### Scenario 8: Support Or Abnormal Order

Flow: complaint, angry user, unsafe request, or "dat 200 combo giao trong 30
phut."

Required widget: `SupportHandoff`.

Assertions:

- no unsafe order, payment, or private-data action is executed;
- handoff reason is structured;
- dashboard receives `handoff_required` or equivalent handoff event.

## Coverage Gates

The live GenUI suite must fail unless all six widget kinds appear at least once:

```text
smartMenuPicker
cartBuilder
addressFulfillmentCheck
orderReviewConfirm
paymentOrderStatus
supportHandoff
```

It must also assert:

- no `placeOrder` before explicit confirmation;
- every GenUI action maps to a backend normalized action;
- every persisted assistant turn with GenUI can be replayed from transcript;
- Messenger and Zalo have a behavior-equivalent text or quick-reply path for
  every action;
- no duplicated wall-of-text when a widget owns the visible summary;
- live model chooses widgets from current state and tool evidence, not from
  hardcoded scenario IDs.

## Implementation Order

1. Define backend GenUI attachment and action contracts.
2. Add fixture-backed widget selection to the agent output path.
3. Build deterministic Flutter fallback renderers for all six widgets.
4. Wire customer GenUI actions back into the normalized backend turn handler.
5. Persist GenUI attachments with transcript turns.
6. Add backend live GenUI evidence tests.
7. Add Flutter live GenUI flow proof with coverage collection and screenshots.

## Acceptance Criteria

- A customer can complete the full mock KFC ordering lifecycle in the separate
  Flutter customer chat.
- The six MVP widgets cover the 50 documented use cases through job-based
  reuse.
- Messenger and Zalo retain behavior parity through text or quick-reply
  equivalents.
- `OrderReviewConfirm` is the only widget that can expose final order
  confirmation.
- No order is placed before explicit customer confirmation.
- Payment success is never shown without payment-tool evidence.
- GenUI attachments persist in transcript history.
- The live GenUI suite covers all six widget kinds across eight scenarios.
- The customer app remains separate from the operator live monitor.
