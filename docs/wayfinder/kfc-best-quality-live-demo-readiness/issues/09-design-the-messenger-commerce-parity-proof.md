Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 07-design-the-exhaustive-coverage-matrix-and-oracles.md
Assignee: Codex

## Question

How will a release-blocking Messenger live proof validate text-level parity for short-turn menu discovery, menu/modifier-aware recommendation, cart changes, address clarification and confirmation, supported/unsupported payment behavior, truthful payment checks, order status, delivery status, and guaranteed replies? Define fresh-session setup, webhook/queue/outbound delivery evidence, expected/forbidden tools and claims, text rendering without KFC GenUI assumptions, coalescing and duplicate handling, latency/timeouts, persisted-turn and dashboard correlation, no-debug-prefix customer messages, and artifact output.

## Decisions captured

- Messenger parity means the same verified commerce meaning, permitted state transition, and consent boundary as KFC GenUI; it does not mean the same widget interaction. Messenger renders self-contained text and optional verified catalog media, never GenUI metadata or an action that exists only as a client control.
- Do not replay the scenarios 01-08 44 customer turns through the model a second time. Feed every captured Verified Commerce Projection from that accepted run through the deterministic Messenger presenter, then run one compact deployed Messenger journey and two transport boundary probes.
- The deployed journey uses the current configured menu API. Its Catalog Observation is recorded and pinned for the run; cart mutation and checkout revalidate it. Historical 120/58, 118/56, or other crawls are baseline fixtures only and are never a runtime fallback.
- A counted run uses a dedicated real tester PSID, a new Lifecycle Scenario Instance, and a completely empty application session. The existing `demo-reset` route is insufficient until it also clears pending turns, agent runs/links/state, webhook deliveries for the session, graph checkpoints, and scenario bindings; the proof must query every store and prove zero relevant rows before turn one.
- A customer turn is guaranteed only when it reaches an explicit terminal outcome: one delivered assistant text reply, an intentional human-pause/handoff skip, or a persisted failure. Any AI-active commerce turn without a delivered reply inside its limit fails the run; later recovery is diagnostic and cannot repair the counted pass.

## Resolution

Use three release-blocking layers on the exact release.

### 1. Deterministic projection parity

For every active Scenario Coverage Ledger row, take the same accepted Verified Commerce Projection, state before/after, tool trace, and originating evidence used by the KFC assertion and pass it through the existing social presenter. This makes full semantic coverage cheap and adds no model call.

The oracle compares normalized semantic facts, not prose equality: entity IDs and names, modifier choices and deltas, quantities, cart revisions and totals, accepted address and store, fee/ETA, supported and unavailable payment methods, order/payment/delivery identity and status, verification time, consent requirement, and permitted next actions. Messenger may omit decorative KFC fields, but it may not add, upgrade, or contradict a fact. Every social result must be non-empty standalone text, contain no `genUi`, widget kind, action capability, internal tool/state/debug term, or unsupported URL, and use optional media only from the verified catalog-media allowlist. Text delivery remains authoritative when optional media fails.

Required text equivalents are numbered menu choices with current prices; named modifier choices with exact compatible deltas; cart lines, quantities, and total after a mutation; the missing address fields when clarification is required; the accepted normalized address, store, fee, and ETA before address acceptance; supported and unavailable payment methods as distinct claims; the complete order review before confirmation; and freshly queried payment, order, and delivery status with order identity. An ordinal such as `số 1` is valid only for the current presented choice revision.

### 2. One deployed Messenger commerce journey

Run this compact sequence from the real Messenger client after deep readiness, complete session reset, current-catalog preflight, and Lifecycle Scenario Instance creation. Address text is exempt from the short-turn length target.

| Step | Customer text or trusted control | Required evidence/tools and reply | Forbidden behavior |
|---|---|---|---|
| 1 | `Có combo gà cay không?` | Current Catalog Observation; `searchMenu`, with `getItemDetails`/`getModifierOptions` allowed; at most three numbered verified choices with price and relevant modifiers | Cart, fulfillment, payment, or order mutation; fixture fallback |
| 2 | `Chọn gà cay, burger cay.` | Preserve an exact choice revision and ask only for the remaining required choices | Guessing a drink, mutating the cart, or treating an ordinal from an older revision as current |
| 3 | `Hai Pepsi vừa, thêm giỏ.` | Revalidate current item/modifier compatibility; `updateCart` exactly once; one `20702` at the provider-returned total | Default modifier substitution, duplicate mutation, order/payment tool |
| 4 | `Đổi cả hai Pepsi lớn.` | Revalidate both drink groups; two exact compatible modifier replacements in one cart revision; render both deltas and new total | Changing one drink only, retaining a medium selection, inferring a different delta |
| 5 | `Giao Quận 7.` | State which address fields are missing; no provider fulfillment claim | `quoteFulfillment`, store, fee, ETA, or default address claim |
| 6 | `Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7, TP.HCM.` | `quoteFulfillment` and, when separate, `checkStoreAvailability`; render only the provider-accepted address/store/availability/fee/ETA and request acceptance | Unbound Quận 7/store/fee/ETA defaults; order or payment mutation |
| 7 | `Giao đến địa chỉ này.` | Bind explicit address acceptance to the quoted fulfillment revision and render the reviewable subtotal, fee, and total | Silent address replacement or order placement |
| 8 | `ZaloPay được không?` | `listPaymentMethods`; state support only from current provider evidence | `createPaymentLink`, payment-success claim, or method selection |
| 9 | `Apple Pay được không?` | `listPaymentMethods`; the sandbox scenario provider must explicitly return this method as unsupported/unavailable, and text must report that result | Calling it supported, silently choosing another method, or mutating checkout |
| 10 | `Chọn ZaloPay.` | Bind the supported method choice and render the complete order review plus an explicit confirmation request | `placeOrder`, `createPaymentLink`, or paid claim |
| 11 | `Xác nhận đặt đơn.` | Revalidate catalog, cart, fulfillment, and method; `previewOrder`, then exactly one `placeOrder`, then `createPaymentLink`; render provider order ID, pending payment, and URL | Any irreversible call before this turn; duplicate order/link on replay |
| 12 | provider control advances payment; `Thanh toán xong chưa?` | Fresh `checkPaymentStatus`; report `paid` only from the returned provider revision | Advancing from wording/query count or using cached pending/paid as current |
| 13 | provider control advances order; `Đơn đang làm chưa?` | Fresh `getOrderStatus`; report `preparing` only from current evidence | Inferred or regressed order state |
| 14 | provider control advances delivery; `Bao giờ giao tới?` | Fresh `getOrderStatus`/delivery read; report `delivering` and remaining ETA only from current evidence | Inferred delivery state or old ETA |

The exact `20702` prices, modifier deltas, store, fee, ETAs, order ID, and lifecycle values are expectations only when this run's provider returns them. If current preflight no longer verifies the golden contract, the run fails for explicit review; it never substitutes a baseline fixture. Every customer message above is sent without `demo`, `proof`, `codex`, run IDs, or timestamps in its visible text.

### 3. Deployed transport boundaries

Run two fresh boundary cases without repeating the commerce journey:

1. Replay one already accepted signed webhook body with the same Meta message ID. Assert one `webhook_deliveries` reservation, one customer turn, one included pending turn, no second model run, no second cart/order mutation, and one outbound assistant message.
2. Send two distinct natural messages inside the configured debounce window. Assert two inbound deliveries and persisted customer turns, one current agent run containing both in arrival order, supersession or stale-run suppression as applicable, one Natural Coalesced Reply, and one outbound message. No reply may expose numbering from `coalescedInputText`, queue/run/debug language, or a stale intermediate cart.

These probes exercise the deployed signed-webhook, D1, queue, coordinator, presenter, and Graph API paths. The main journey must originate in the real Messenger client and retain real `m_...` inbound IDs; callback injection alone cannot satisfy the live-channel gate.

### Evidence and timing oracles

For each counted customer turn, correlate one Evidence Correlation Envelope across the Meta inbound ID, `webhook_deliveries`, pending turn, agent run and generation, persisted user/assistant turns, graph/tool trace and checkpoint, provider requests/audit/revisions, dashboard events, Graph API outbound message ID, and the visible Messenger reply. The assistant turn must be `sent`, its external ID must equal the Graph API result, the delivery row must be `processed`, and the dashboard/monitor must show the same text, state, and session. A `received`, `pending`, scheduled, running, or missing row at timeout is a failure, not success in progress.

Measure webhook acknowledgement at at most 2 seconds; mark-seen or typing progress at at most 2 seconds when Meta accepts it; discovery/recommendation delivery at at most 8 seconds; cart/structured mutation at at most 3 seconds; status delivery at at most 5 seconds; and no customer turn at more than 10 seconds. The full 14-turn proof is not the three-minute stage journey, but any hidden retry, recovery, manual repair, duplicate send, missing reply, unsupported fact, fixture fallback, or text/provider/persistence/monitor contradiction fails it. Preflight reads may retry only under the already approved recorded pre-run rule; counted turns have zero retries.

### Artifact contract

Write one immutable manifest plus redacted JSON evidence per step: release SHA/deployment/clean-tree state; Commerce Environment/provider fingerprint; Catalog Observation version/validators/hash/retrieval/expiry; Lifecycle Scenario Instance and revisions; tester/session binding; exact customer text; inbound, delivery, pending-turn, run, assistant, outbound, trace, checkpoint, provider-audit, and dashboard IDs; expected/observed/forbidden tools and facts; state and cart revisions; latency; retry/recovery/manual-intervention counters; text/media delivery outcomes; ledger-row results; and hashes/paths for Messenger and monitor screenshots or video. Secrets, raw access tokens, raw PII beyond the approved proof address, and internal chain-of-thought are excluded.

The existing `buildStandaloneSocialFallback`, channel-presentation guards, webhook reservation, `AgentRunCoordinator`, D1 records, stale-delivery recovery, and live proof evaluator are the implementation starting points. Confirmed gaps are the incomplete `demo-reset`, existence-only `evaluateLiveScenarioProof`, absence of the projection-parity matrix and per-turn manifest, and no current script that drives this complete real-Messenger commerce proof.
