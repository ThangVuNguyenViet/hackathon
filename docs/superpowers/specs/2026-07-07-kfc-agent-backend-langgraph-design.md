# KFC Agent Backend LangGraph Design

Date: 2026-07-07

## Purpose

Build a production-shaped backend for the KFC Vietnam conversational ordering assistant. The backend should run with mock external integrations for the hackathon, while preserving clean boundaries so those mocks can later be replaced by real KFC, OMS, loyalty, payment, Messenger, and Zalo APIs.

The backend is responsible for chat orchestration, mock external API integration, session state, dashboard events, scenario replay, and LangSmith-backed traceability. The Flutter live monitor remains a consumer of backend session and dashboard events.

## Inputs And Binding References

- MVP scope: `ai-talent-tracks/fnb/mvp-kfc-conversational-ordering.md`
- Mock API decision: `ai-talent-tracks/fnb/mock-api-decision.md`
- KFC public crawl: `ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/`
- Integration scenarios: `ai-talent-tracks/fnb/conversations/README.md`
- Google Doc markdown export: `docs/google_docs/kfc_ai_chat_ordering_assistant/markdown/`
- Dashboard UI spec: `docs/superpowers/specs/2026-07-06-kfc-dashboard-ui-design.md`
- OKF reference: GoogleCloudPlatform `knowledge-catalog/okf` Open Knowledge Format v0.1 draft.
- Meta Messenger Platform docs: `https://developers.facebook.com/documentation/business-messaging/messenger-platform/`
- Zalo OA OpenAPI docs: `https://developers.zalo.me/docs/api/official-account-api-230`

## Architecture

Use a single Node.js/TypeScript backend built on Fastify, LangGraph.js, and LangSmith.

Primary modules:

- `api`: Fastify HTTP server for channel webhooks, simulator endpoints, dashboard APIs, health checks, and scenario replay.
- `agent-graph`: LangGraph.js state machine for ordering conversations.
- `agent-state`: typed graph state containing channel, transcript pointers, intent, cart, voucher, loyalty, payment, order, escalation, cost, and trace metadata.
- `tools`: typed tool functions for menu search, cart mutation, voucher validation, loyalty lookup, delivery quote, order preview, payment, order placement, status, cancellation, feedback, and human handoff.
- `external-clients`: production-shaped interfaces for Menu, Cart, Recommendation, Promotion, Inventory, Store Locator, OMS, Payment, Delivery, Customer, Loyalty, Handoff, Feedback, Messenger, and Zalo.
- `mock-adapters`: hackathon implementations of those client interfaces, backed by crawled KFC Vietnam data and deterministic fixtures.
- `knowledge`: OKF bundle and index generated or curated from source documents and crawl evidence.
- `persistence`: session state, transcripts, structured events, mock orders, customer memory, and LangGraph checkpoints.
- `dashboard-stream`: SSE or WebSocket feed consumed by the Flutter live monitor.
- `channel-webhooks`: real Messenger and Zalo webhook verification, payload validation, inbound normalization, and outbound reply dispatch.
- `scenario-runner`: parser and replay harness for the Markdown conversation scripts.
- `observability`: LangSmith traces, run metadata, scenario tags, and evaluation outputs.
- `deployment`: Cloud Run backend deploy script, Cloudflare Pages dashboard deploy script, and a hackathon runbook that keeps secrets out of git.

OpenAI is the LLM provider for language understanding and response composition. Business decisions and state changes happen through graph policy nodes and typed tools.

## Production-Ready Data Boundary

Design as if external production APIs already exist, but implement them with mock adapters today.

The graph and tools call interfaces such as:

- `MenuClient`
- `CartClient`
- `RecommendationClient`
- `PromotionClient`
- `InventoryClient`
- `StoreLocatorClient`
- `OmsClient`
- `PaymentClient`
- `DeliveryClient`
- `CustomerClient`
- `LoyaltyClient`
- `HandoffClient`
- `FeedbackClient`
- `MessengerClient`
- `ZaloClient`

For the hackathon, mock adapters implement those interfaces:

- `MockMenuClient` reads normalized fixtures generated from the KFC Vietnam crawl.
- `MockVoucherClient` follows the public KFC Partner API-style voucher envelope and status/error patterns.
- `MockOmsClient` simulates cart preview, order placement, assignment, status, cancellation, timeout, and ambiguous-order states.
- `MockPaymentClient` simulates link creation, failure, retry, COD fallback, and paid-state transitions.
- `MockChannelClient` implementations simulate Messenger, Zalo, and web chat events.

Real channel adapters use the same internal graph input as mock channels. Messenger and Zalo webhooks are transport boundaries, not separate agent flows.

Initial real channel endpoints:

- `GET /webhooks/messenger`: Meta webhook verification endpoint. It validates `hub.mode=subscribe` and `hub.verify_token` against `MESSENGER_VERIFY_TOKEN`, then returns the raw `hub.challenge` value as the response body.
- `POST /webhooks/messenger`: Meta webhook delivery endpoint. It validates the request when the app secret is configured, normalizes message and postback events into internal conversation events, runs the graph, and sends responses through `MessengerClient`.
- `POST /webhooks/zalo`: Zalo OA webhook delivery endpoint. It applies the configured Zalo validation method once OA credentials and app settings expose it, normalizes user-message events into internal conversation events, runs the graph, and sends responses through `ZaloClient`.

Required channel environment variables:

- `OPENAI_API_KEY`
- `MESSENGER_VERIFY_TOKEN`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_PAGE_ID=118976205445198`
- `META_PAGE_ACCESS_TOKEN`
- `ZALO_OA_ID`
- `ZALO_APP_ID`
- `ZALO_APP_SECRET`
- `ZALO_ACCESS_TOKEN`
- `ZALO_WEBHOOK_SECRET` when the selected Zalo OA validation setup requires one

When moving to product, replace adapters without rewriting graph nodes:

```text
MockMenuClient -> KfcMenuApiClient
MockOmsClient -> KfcOmsApiClient
MockVoucherClient -> KfcVoucherApiClient
MockLoyaltyClient -> KfcLoyaltyApiClient
MockPaymentClient -> PaymentGatewayClient
```

No graph node should directly read raw crawl files, OKF Markdown, or fixture JSON. Only ingestion steps and mock adapters read those artifacts.

No graph node should depend on Messenger-specific or Zalo-specific payload fields. Channel adapters must convert channel payloads into the same internal `ConversationEvent` shape used by scenario replay.

## OKF And Business Knowledge

Use OKF as the governed knowledge and catalog layer. For the hackathon it is also the reviewed source for mock business knowledge, but runtime tools still operate through typed clients and normalized fixtures.

Source layers:

1. Raw crawl evidence: `ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/`.
2. OKF bundle: curated Markdown concepts with YAML frontmatter.
3. Generated mock fixtures: deterministic JSON or database records used by mock adapters.

Proposed OKF bundle shape:

```text
apps/kfc_agent_backend/knowledge/kfc-okf/
  index.md
  menu/
    categories/
    items/
  promotions/
  stores/
  contracts/
  policies/
  playbooks/
  scenarios/
  references/
```

OKF concept types should include `Menu Item`, `Menu Category`, `Promotion`, `Store`, `API Contract`, `Policy`, `Playbook`, `Scenario`, and `Reference`.

Every generated fixture should retain provenance:

- source raw crawl file
- OKF concept ID
- crawl timestamp or fixture timestamp
- whether the value is public evidence, mock-only extension, or scenario override

Time-sensitive promotions from the crawl must be marked as frozen demo fixtures. The backend must not claim current promotion validity unless a real promotion API adapter later confirms it.

## LangGraph Conversation Flow

Use LangGraph as a controlled state machine.

Main nodes:

- `ingestMessage`: normalize Messenger, Zalo, or web mock events.
- `loadSession`: restore checkpoint, transcript pointers, cart, customer profile, and pending confirmations.
- `retrieveKnowledge`: retrieve relevant OKF snippets and policy/tool contract context.
- `classifyIntent`: identify ordering, cart edit, voucher, payment, order status, complaint, feedback, handoff, safety, or unclear intent.
- `extractEntities`: extract items, quantities, address, voucher code, payment method, invoice fields, order ID, and references to earlier context.
- `resolveReferences`: handle long-range references such as "chỗ cũ", "món đó", "đơn lần trước", or "same as before".
- `policyGate`: block unsafe or unsupported requests, require clarification, and enforce confirmation before irreversible actions.
- `toolPlan`: choose required typed tool calls.
- `executeTools`: call external client interfaces.
- `updateState`: mutate graph state from tool outputs.
- `composeResponse`: produce customer-facing text from state, tool results, retrieved OKF, and recent context.
- `emitEvents`: persist transcript, structured events, dashboard events, metrics, and trace metadata.
- `checkpoint`: save graph state for the next turn.

Critical gates:

- Order creation requires a valid cart, delivery or pickup selection, required customer fields, current price preview, store/inventory validation, and explicit user confirmation.
- Payment success can only come from `PaymentClient`; the LLM cannot infer it from prose.
- Inventory and store routing must be checked during cart preview and again before order creation.
- Human handoff pauses irreversible AI actions and emits an operator-visible dashboard event.

## Context Management And Long-Range Memory

Do not append full chat history into every prompt. Store everything, then retrieve bounded evidence.

The backend is the source of truth for the live conversation transcript. The dashboard never scrapes Messenger directly.

Stored memory:

- full append-only transcript for every session
- structured user messages, assistant replies, delivery status, tool calls, tool outputs, cart mutations, order events, payment attempts, dashboard events, and handoff events
- customer-level memory for prior orders, saved addresses, loyalty profile, favorite or repeated items, and repeat complaints
- rolling session summaries for conversational continuity

Prompt context per turn:

- system instructions
- current graph state JSON
- pending confirmation or blocked action
- relevant OKF snippets
- rolling session summary
- last 6 messages by default
- up to 12 recent messages for local ambiguity
- bounded long-range retrieval results when needed

Long-range retrieval may search all prior session and customer history. It returns only compact, ranked evidence into the prompt. Each result must carry an event ID, timestamp, source type, and confidence.

Examples:

- "chỗ cũ" retrieves saved or recent addresses.
- "món đó" retrieves recent viewed or mentioned items and cart candidates.
- "đơn lần trước" retrieves prior completed orders.
- "lỗi hồi nãy" retrieves recent payment or OMS errors.
- "như mọi khi" retrieves favorite or repeated items but still requires confirmation.

If retrieval returns conflicting candidates, the graph asks the user to choose instead of guessing.

## Transcript Capture And Dashboard Read Model

Capture the user and assistant messages at backend boundaries:

1. Messenger sends a user message to `POST /webhooks/messenger`.
2. The channel adapter normalizes the payload into `ConversationEvent`.
3. The backend stores a `ConversationTurn` with `role: 'user'`.
4. LangGraph runs with live OpenAI calls for intent and response composition.
5. The backend stores the assistant `ConversationTurn` with `deliveryStatus: 'pending'`.
6. `MessengerClient` sends the reply through the Messenger Send API.
7. The backend updates the assistant turn to `deliveryStatus: 'sent'` or `deliveryStatus: 'failed'`.
8. The dashboard reads transcript turns and structured dashboard events from backend APIs.

Core transcript shape:

```ts
interface ConversationTurn {
  id: string;
  sessionId: string;
  channel: 'messenger' | 'zalo' | 'messenger_mock' | 'zalo_mock' | 'web_mock';
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  externalMessageId: string | null;
  externalUserId: string | null;
  deliveryStatus: 'received' | 'pending' | 'sent' | 'failed' | 'not_applicable';
  createdAt: string;
}
```

Dashboard APIs:

- `GET /dashboard/sessions`: active session cards and operational summary.
- `GET /dashboard/sessions/:sessionId`: one session detail, including cart/order/payment state.
- `GET /dashboard/sessions/:sessionId/turns`: transcript turns ordered by `createdAt`.
- `GET /dashboard/events/:sessionId`: structured operational events for polling and replay assertions.

The first implementation should use polling every 1-2 seconds for hackathon stability. SSE can be added later behind `GET /dashboard/events/stream`, but it is not required for the first deployable proof.

## Tools And Contracts

Tools should be narrow, typed, and deterministic where possible.

Core tools:

- `searchMenu`
- `getItemDetails`
- `updateCart`
- `previewCart`
- `recommendAddOns`
- `validateVoucher`
- `lookupLoyalty`
- `previewLoyaltyRedemption`
- `quoteDelivery`
- `assignStore`
- `checkInventory`
- `previewOrder`
- `createPaymentLink`
- `checkPaymentStatus`
- `placeOrder`
- `getOrderStatus`
- `cancelOrder`
- `updateDeliveryAddress`
- `addPostOrderItems`
- `recordFeedback`
- `escalateToHuman`

Irreversible tools must require explicit graph-state preconditions. `placeOrder` must reject execution unless the graph has recorded the latest order preview and explicit user confirmation.

## Channel Integration

Messenger and Zalo are first-class production channels. Scenario tests still use mock channel events, but the backend must expose real webhook routes and outbound client contracts.

Internal normalized event shape:

```ts
interface ConversationEvent {
  channel: 'messenger' | 'zalo' | 'messenger_mock' | 'zalo_mock' | 'web_mock';
  externalUserId: string;
  externalThreadId: string;
  text: string;
  eventType: 'message' | 'postback';
  rawEventId: string;
  receivedAt: string;
}
```

Messenger adapter responsibilities:

- Verify Meta webhook setup challenge using `MESSENGER_VERIFY_TOKEN`.
- Accept Messenger Page webhook events for the configured `META_PAGE_ID`.
- Normalize inbound `message.text` and postback payloads.
- Ignore delivery/read echoes and unsupported event types while preserving them in transcript events when useful.
- Send outbound text replies through the Messenger Send API using `META_PAGE_ACCESS_TOKEN`.

Zalo adapter responsibilities:

- Accept Zalo OA webhook POSTs for the configured OA/app.
- Apply the configured Zalo webhook validation method once OA credentials and app settings expose it.
- Normalize inbound text events into `ConversationEvent`.
- Preserve unsupported Zalo events as transcript events without triggering unsafe graph actions.
- Send outbound text replies through Zalo OA OpenAPI using `ZALO_ACCESS_TOKEN`.

Both adapters must call the same `runAgentTurn` or graph entrypoint used by scenario replay. This ensures channel parity: a Messenger message, Zalo message, and Markdown scenario turn enter the graph through the same normalized event model.

## Scenario-Driven Integration Tests

Treat `ai-talent-tracks/fnb/conversations/README.md` and the 8 scenario files as executable integration-test scripts.

The scenario runner parses:

- scenario metadata: channel, covered use cases, expected final state
- `Hội thoại demo` table: user turns as inputs, bot turns as semantic expectations
- `Use case` column: coverage tags
- `Kỳ vọng kiểm thử`: assertions on graph state, tool calls, dashboard events, and persisted records

Assertions should prefer structured outcomes over exact prose snapshots.

Required examples:

- Scenario 01 asserts `order_created`, `voucher_applied`, `payment_method=momo`, no order before confirmation, delivery note saved, invoice info saved.
- Scenario 03 asserts no unavailable item is ordered, ambiguous address is clarified, overload ETA is surfaced, and stock changes before confirmation trigger a customer decision.
- Scenario 08 asserts payment failure does not mark paid, retry or COD is offered, and abnormal bulk order triggers `human_review_required` with escalation reasons.

## Observability

Every graph run should emit LangSmith trace metadata:

- session ID
- channel
- scenario ID when replayed
- use case IDs
- graph node names
- tool names and outcomes
- external client adapter name
- final state
- escalation reason
- dashboard event count

LangSmith is used for trace inspection and regression analysis. It is not the source of truth for business state.

## Dashboard Event Stream

The backend must emit events for the Flutter live monitor:

- session created or updated
- conversation turn created
- customer message received
- assistant reply sent
- cart changed
- voucher applied or rejected
- payment link created
- payment failed or paid
- order previewed or created
- OMS status changed
- handoff required
- human joined
- session resolved
- cost and automation metrics updated

Scenario replay should drive this same event stream, proving that tests exercise the operator view as well as chat behavior.

For final proof, assistant messages must come from live OpenAI API calls. Mocked LLM outputs are allowed only in automated tests and scenario replay.

## Validation Strategy

Validation runs in layers:

1. Unit tests for OKF parsing, crawl normalization, fixture generation, tool contracts, cart pricing, voucher rules, inventory, store routing, payment state, handoff policy, and long-range retrieval.
2. LangGraph node tests with mocked LLM outputs and mocked external clients.
3. Scenario integration tests generated from the 8 Markdown conversation scripts.
4. Channel webhook tests with fixture Messenger and Zalo payloads, including Messenger verification challenge handling.
5. Outbound channel client tests using mocked HTTP responses for Messenger Send API and Zalo OA message sending.
6. Semantic response checks for response intents such as asking for address, confirming cart, offering COD, refusing unsafe requests, not promising delivery, and escalating to human.
7. LangSmith evaluation and trace inspection tagged by scenario and use case IDs.
8. Dashboard proof by verifying emitted event streams during scenario replay and channel webhook tests.
9. Final demo proof with two MP4 recordings captured from the same live proof run:
   - Chrome Messenger video showing a user chatting with the AI chatbot through the Ecomeasy Page.
   - Flutter dashboard video showing the operator monitor receiving and displaying that same conversation.

Pass criteria:

- all 8 scenario scripts pass
- all 50 use case tags are covered
- no irreversible order or payment success without required confirmation and tool result
- no live KFC, Zalo, Messenger, or payment dependency is required for tests
- real Messenger and Zalo webhook routes pass fixture-based verification and normalization tests
- every scenario leaves replayable transcript, tool-call log, dashboard event log, and LangSmith trace metadata
- final demo artifacts include `messenger-chat-ai.mp4` and `flutter-dashboard-conversation.mp4` under the same proof directory, with both videos showing the same session ID or customer/thread label

## Non-Goals

- Real production KFC credentials or private API access.
- Real Zalo OA or Messenger Page dependency for automated tests.
- Real payment capture.
- Free-form agent autonomy for business decisions.
- Using OKF Markdown as a per-request operational database.

## Implementation Choices

- Persistence uses Postgres for sessions, transcripts, structured events, mock orders, customer memory, and LangGraph checkpoints. Local development may run Postgres through Docker.
- LangSmith tracing is required when `LANGSMITH_API_KEY` is configured. CI and local tests must still pass without LangSmith credentials by using a no-op tracing exporter.
- `OPENAI_API_KEY` is required for live local demos and deployed chatbot runtime, but unit and scenario tests must use mocked LLM outputs so they do not spend model tokens.
- Scenario tests parse Markdown as the source contract and may generate temporary normalized JSON during test execution. The Markdown conversation files remain the reviewed source of truth.
- Messenger setup uses the Ecomeasy Page ID `118976205445198`. The callback URL is not final until the backend is running behind a public HTTPS URL.
- Zalo setup remains credential-ready: contracts, routes, and fixture tests are implemented before OA credentials are available.
- Final video proof is not a CI test. It is a release/demo artifact captured after the backend, public Messenger callback, and Flutter dashboard are running together.
- Hackathon deployment targets are Google Cloud Run for the backend, Neon Free Postgres for shared state, and Cloudflare Pages for the Flutter Web dashboard.
