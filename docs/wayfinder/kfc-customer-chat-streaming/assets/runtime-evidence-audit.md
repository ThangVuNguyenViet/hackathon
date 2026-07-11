# Runtime Evidence Available To Customer Streaming

Audit snapshot: commit `a91edd5897429482f2d8e309168cd96b3f36648e`, inspected 2026-07-11T11:44:45Z in a shared dirty checkout. Unrelated working-tree edits were not changed.

## Finding

The current runtime can prove final customer turns, final verified state, final GenUI attachments, successful tool outcomes, derived business outcomes, and final KFC HTTP delivery. It also has optional technical spans around context loading, planner iterations, policy gates, tool calls, state updates, response composition, and session intelligence.

It cannot currently drive the agreed customer experience honestly. First-party KFC chat has no run identity or run lifecycle, no customer-safe progress projection, no public planner/policy phase events, no tool-start event, no text delta, no GenUI revision event, no cancellation contract, no replay cursor, and no explicit KFC terminal run outcome. The only Flutter-visible in-flight state is a locally inferred `isSending` boolean.

The dashboard feed must not be reused directly as the customer stream. It mixes technical payloads with business events, has no customer-safe projection boundary, does not expose a monotonic sequence in its wire type, and persists asynchronously on a best-effort basis.

## Current first-party KFC timeline

1. Flutter appends an optimistic customer message and sets `isSending=true` (`customer_chat_controller.dart:69-84`). The screen disables input and shows `KFC đang trả lời...` (`customer_chat_screen.dart:93-123`, `360-369`, `435-471`). This is local request state, not backend progress.
2. `BackendCustomerChatRepository` sends one buffered POST to `/chat/kfc/message` or `/chat/kfc/genui-action` and awaits a complete JSON body (`customer_chat_repository.dart:42-70`, `93-129`). Its retry loop resends the same encoded request for selected network and 5xx failures.
3. `kfcAgentResponse` checks the durable `kfc_request_completed` marker for the same `clientMessageId`. A completed matching request returns its stored response as an idempotent replay (`routeHandlers.ts:413-445`).
4. The KFC route calls `runAgentTurn` directly without the coordinated-channel `runGuard` or an `AgentRun` record (`routeHandlers.ts:448-462`).
5. `runAgentTurn` optionally creates an `agent_turn` trace. The graph loads context and persists the user turn; a new user turn emits `customer_message_received` and `conversation_turn_created` dashboard events (`buildGraph.ts:1891-2014`).
6. Each planner iteration is visible only as an optional `planner_iteration` trace span. Planner failure is additionally persisted as a `llm:tool_planner_failed` conversation event (`buildGraph.ts:2072-2131`).
7. Policy decisions are optional `policy_gate` trace spans containing proposed tools, allowed tools, block reasons, and confirmation state (`buildGraph.ts:188-211`). There is no corresponding typed dashboard or customer event.
8. A tool is wrapped in an optional `tool_call:<toolName>` span, followed by an optional `state_update` span (`buildGraph.ts:655-735`). The dashboard `session_updated/updateType=tool_called` event is emitted only after a successful tool result is applied; failed results deliberately emit no `tool_called` update (`buildGraph.ts:327-330`, `462-486`). The name therefore means successful tool completion, not tool start.
9. Some tools also emit result-specific `session_updated` events such as store assignment, delivery quote, promotion evidence, content evidence, or invoice request. After graph work, derived business events such as `cart_changed`, `order_created`, `payment_link_created`, `payment_failed`, and `handoff_required` are emitted from verified state (`buildGraph.ts:489-649`, `1457-1512`).
10. The graph awaits a durable `graph:verified_state` conversation event containing the state snapshot and accumulated tool trace, then emits session intelligence (`buildGraph.ts:437-459`, `2685-2702`). A failed tool result can survive in this snapshot if execution reaches the persistence point.
11. `selectKfcGenUiAttachment` selects one complete attachment before response composition. The result is held in memory while the optional, non-streaming response composer runs (`buildGraph.ts:1744-1818`; `responseComposer.ts:105-131`). Composer start/end exists only as the optional `response_compose` trace span. Composer failure is persisted as `llm:response_composer_failed`, and the graph falls back to deterministic text.
12. The graph appends one final assistant turn containing complete text and, when selected, one complete GenUI attachment. It then emits `conversation_turn_created` (`buildGraph.ts:1832-1866`). There is no earlier GenUI availability event and no revision field.
13. `kfcAgentResponse` marks the assistant turn sent, emits `assistant_reply_sent`, persists `kfc_request_completed` with the complete response, and returns HTTP 200 (`routeHandlers.ts:464-504`). It emits no KFC `agent_run_delivered` or equivalent terminal run event.
14. Flutter parses only `responseText` and optional `genUi`; it ignores backend state, turn IDs, replay status, and any other response fields. The controller appends one completed assistant message and clears `isSending` (`kfc_genui_models.dart:284-299`; `customer_chat_controller.dart:90-109`).

## Evidence inventory

| Signal | Current source | Availability and durability | What its timing proves | Customer-stream readiness |
|---|---|---|---|---|
| Customer request identity | Flutter-generated `clientMessageId`; persisted as the user turn's external message ID and in `kfc_request_completed` | Durable after awaited store writes | Identifies a submitted request and completed replay | Reusable, but not a run ID |
| User turn accepted | Persisted conversation turn; dashboard `customer_message_received` and `conversation_turn_created` | Turn is awaited and durable in Postgres/D1; dashboard copy is live plus best-effort persistence | The graph accepted or found the user turn | Authoritative fact, but needs a customer event envelope |
| Context loaded | `context_load` trace span | Optional LangSmith trace or no-op | Technical context phase start/end | Not a product contract and payload is customer-unsafe |
| Planner started/completed | `planner_iteration` trace span | Optional LangSmith trace or no-op | Exact planner iteration boundaries when tracing is enabled | Not sufficiently available or safe |
| Planner failure | `llm:tool_planner_failed` conversation event plus failed trace span | Conversation event is awaited and durable; trace optional | Planner invocation failed before a usable plan | Durable diagnostic, but requires safe projection |
| Policy result | `policy_gate` trace span | Optional LangSmith trace or no-op | Tool allow/block and confirmation result | Not sufficiently available; raw content is technical |
| Tool started | `tool_call:<name>` trace span | Optional LangSmith trace or no-op | Exact execution start when tracing is enabled | No runtime/customer event exists |
| Tool succeeded | Tool trace in state; `session_updated/tool_called` after success | Tool trace becomes durable at `graph:verified_state`; dashboard is live plus best-effort persistence | A named tool completed successfully and its result was applied | Authoritative enough after redaction and projection; current payload is too technical |
| Tool failed | Tool trace and escalation reason if the graph reaches snapshot persistence; failed tool trace span | Durable only at the later verified-state checkpoint; trace optional | A handled tool returned failure | No live typed failure event; hard exceptions may exist only in trace/HTTP failure |
| Verified state checkpoint | `graph:verified_state` conversation event | Awaited durable store write | All state and tool trace included in that checkpoint were accepted by the graph | Strong authoritative source, but currently emitted too late and too broadly for direct customer use |
| Business outcome | Derived dashboard events such as `cart_changed`, `order_created`, `payment_link_created` | Live immediately; best-effort durable when a persistence adapter is configured | A successful tool produced a specific verified business state | Strong projection source, but payloads need minimization and correlation |
| Session intelligence | `session_intelligence_updated` dashboard event and optional trace span | Dashboard live plus best-effort persistence; trace optional | Monitor projection completed | Operator-oriented, not a customer progress source |
| Response composition started/completed | `response_compose` trace span | Optional LangSmith trace or no-op | Exact composer boundary when configured | No always-on runtime event exists |
| Response text delta | None; OpenAI response is parsed only after complete JSON | Not available | Nothing | Missing |
| Final assistant text | Persisted assistant turn and `kfc_request_completed` response | Awaited durable writes before successful response completion | Final authoritative response text exists | Ready as terminal state, not streaming |
| GenUI selected | In-memory result from `selectKfcGenUiAttachment` | Transient until assistant turn append | A complete attachment has been selected before response composition | No observable event; not independently durable |
| Final GenUI Snapshot | Assistant turn metadata and `kfc_request_completed` response | Awaited durable writes | Final immutable attachment exists with the assistant turn | Ready as terminal snapshot; no revisions or provisional lifecycle |
| KFC delivery complete | Assistant turn delivery status, `assistant_reply_sent`, `kfc_request_completed`, HTTP 200 | Turn and request marker are durable; dashboard event is live plus best-effort persistence | The first-party response was finalized for HTTP delivery | Authoritative terminal evidence, but there is no run terminal event |
| Request failure | HTTP error caught by Flutter; selected LLM failures persisted as diagnostics | Mixed | The synchronous request failed or degraded | No typed phase/terminal contract; Flutter exposes raw error text |
| Cancellation | None on first-party KFC path | Not available | Nothing | Missing |
| Supersession | Coordinated Messenger/Zalo `AgentRun` records and dashboard events only | Durable run records for those channels; not invoked for KFC | A coordinated channel run became stale | Not available to KFC |
| Reconnect/replay cursor | Dashboard fetch endpoints and live feeds have separate behavior; no per-run cursor | No customer run log | At most, a monitor can refetch broad events | Missing for customer streaming |

## Durability classes

### Awaited durable facts

With Postgres or D1 stores, conversation turns, `graph:verified_state`, LLM failure diagnostics, `kfc_request_completed`, GenUI on the final assistant turn, and coordinated Messenger/Zalo agent-run records are awaited store operations. The in-memory development store has the same interface but is not restart-durable.

### Live plus best-effort persistence

`DashboardEventBus.emitEvent` appends in memory, starts persistence without awaiting it, swallows persistence failures, and immediately notifies subscribers (`dashboard/eventBus.ts:23-33`). Production Node and Worker construction normally supplies a Postgres or D1 persistence adapter, but a dashboard event is not a transactionally durable commit boundary.

Fastify `/dashboard/stream` sends only events emitted while connected and has no replay cursor (`api/routes.ts:31-55`). Cloudflare Worker explicitly rejects dashboard SSE and uses `/dashboard/socket`; its Durable Object forwards new frames to connected sockets without replay (`worker.ts:146-176`, `225-239`). Persisted dashboard fetch endpoints can be queried separately, but the `DashboardEvent` wire type has no monotonic sequence or schema version (`domain/types.ts:195-223`).

### Optional tracing-only evidence

Without an injected tracer, every span is a no-op. With LangSmith, span operations are queued and external; safe tracing failures are converted into diagnostics rather than failing the agent run (`observability/agentTracing.ts:29-102`; `observability/langsmithAgentTracer.ts:36-125`). Tracing is useful technical proof, not an always-on product event source.

### Flutter-local inference

`isSending` begins before the POST and ends after a complete response or exception. It cannot distinguish context load, planning, policy, tools, composition, GenUI availability, reconnection, cancellation, or supersession. The separate customer-session polling path returns durable turns and handoff control state, but the controller starts it only for queued handoff and filters for human-agent assistant turns (`customer_chat_controller.dart:103-158`; `routeHandlers.ts:1754-1771`).

## Timing and correlation limits

- KFC has a `clientMessageId`, but no `runId`. Tool, business, and response dashboard events do not consistently carry the request identity.
- Dashboard events carry `id`, `sessionId`, `type`, payload, and wall-clock `createdAt`, but no exposed monotonic per-run sequence.
- Postgres internally orders persisted dashboard rows by `event_sequence`; that value is not part of the returned event contract. D1 orders by timestamp and ID.
- Trace spans can measure phases only when tracing is configured. Their correlation metadata includes `clientMessageId`, but that correlation is not propagated into every dashboard event or Flutter response model.
- The first always-available authoritative boundary for response text and GenUI is the final assistant turn. Therefore time-to-first-text-token and time-to-first-GenUI-snapshot cannot be measured from current product events.
- Inferring phases from elapsed time, gaps between dashboard events, tool order, or the Flutter loading indicator would fabricate runtime meaning and is prohibited.

## Signals that must be added or deliberately projected

The later architecture tickets need to establish, rather than assume:

- a first-party KFC `runId` linked to `clientMessageId`;
- customer-stream schema version, event ID, monotonic sequence, and timestamps;
- explicit run acceptance/start and terminal `completed`, `failed`, `cancelled`, and `superseded` events;
- always-on internal phase boundaries sufficient to project customer-safe progress without depending on LangSmith;
- tool-start and handled tool-failure facts, separate from the current success-only `tool_called` completion update;
- response-composition start, text deltas, text completion, and partial-text failure/cancellation semantics;
- versioned GenUI snapshot availability and revision events;
- Stop/cancellation acknowledgement and irreversible-boundary behavior for first-party KFC;
- replay, duplicate, gap, authoritative-resync, heartbeat, and reconnect evidence;
- a projection record connecting each customer-safe event to its internal evidence without leaking raw inputs or hidden reasoning.

## Effect on the map

The audit validates the need for the existing transport, customer-safe progress, text streaming, GenUI structural streaming, run lifecycle, evidence/proof, and test/rollout tickets. It does not resolve the vocabulary or architecture those tickets own, and it does not surface a separate child ticket yet.

No domain glossary entry is added by this audit: the precise definition of Customer-Safe Agent Progress remains the decision owned by **Define The Customer-Safe Progress Language And Projection Rules**.

## Verification

Targeted current-checkout tests:

```text
test/api/chat.test.ts: 16 passed
test/graph/agent-tracing.test.ts: 7 passed
test/worker/live-ai-interruption.test.ts: 1 skipped by its existing live-test gate
```

Command:

```sh
npm test -- --maxWorkers=1 --no-file-parallelism test/api/chat.test.ts test/graph/agent-tracing.test.ts test/worker/live-ai-interruption.test.ts
```
