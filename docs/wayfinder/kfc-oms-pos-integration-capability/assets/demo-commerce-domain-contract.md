# Demo Commerce Domain And Correlation Contract

## Purpose

Define the smallest domain model needed to prove this demo chain:

```text
user answer -> planner -> agent tool -> gateway -> Mock OMS -> Mock POS -> tool result -> assistant -> GenUI
```

This is a demo trace contract, not a production commerce model.

## Canonical Terms

### Commerce command

An agent tool execution requesting a commerce operation such as `placeOrder` or `getOrderStatus`. It carries the user-confirmed state needed by the tool plus tracing and duplicate-suppression identifiers.

### Commerce order

The Demo Commerce Gateway's canonical representation of one demo order. It correlates downstream mock-system identifiers without replacing them.

### OMS order

The order representation and identifier returned by Mock OMS.

### POS ticket

The store-execution representation and identifier returned by Mock POS.

### Execution trace

One observable user-to-response attempt. LangSmith is the canonical visual evidence; a local JSON report is the credential-free fallback. Neither is authoritative commerce state.

## Identifiers

| Identifier | Owner | Lifetime | Meaning |
| --- | --- | --- | --- |
| `sessionId` | Agent backend | Conversation | Stable KFC customer conversation |
| `traceId` | Agent backend | One execution attempt | Correlates planner, tool, HTTP, result, response, and GenUI evidence |
| `commerceOrderId` | Demo Commerce Gateway | One demo order | Canonical cross-system demo order identifier |
| `omsOrderId` | Mock OMS | One OMS order | Raw simulated OMS identifier |
| `posTicketId` | Mock POS | One POS ticket | Raw simulated POS identifier |
| `idempotencyKey` | Agent backend | One logical tool command | Suppresses duplicate execution during one demo run |

The identifiers must remain distinct in traces and responses. Reusing one fake identifier for every system does not prove mapping.

## Identifier Rules

```text
idempotencyKey = sessionId + clientMessageId + toolName
```

- A repeated logical command reuses `idempotencyKey`.
- Each attempt receives a new `traceId`, including a deduplicated attempt.
- The gateway generates `commerceOrderId` before downstream calls.
- Mock OMS receives `commerceOrderId` and returns `omsOrderId`.
- Mock POS receives `commerceOrderId` and `omsOrderId`, then returns `posTicketId`.
- Correlation is held in memory for one demo run only.

## Status Model

Keep source statuses independent:

- `omsStatus`: raw Mock OMS state.
- `posStatus`: raw Mock POS state.
- `customerStatus`: gateway-derived state consumed by the agent and GenUI.

Do not overwrite an OMS state with a POS state or vice versa.

### Customer status vocabulary

- `awaiting_confirmation`
- `submitting`
- `accepted`
- `preparing`
- `ready`
- `cancelled`
- `failed`

### Demo derivation rules

| Condition | `customerStatus` |
| --- | --- |
| Order review exists but user has not confirmed | `awaiting_confirmation` |
| Confirmed command is executing | `submitting` |
| Mock OMS created order and Mock POS accepted ticket | `accepted` |
| Mock POS reports preparing | `preparing` |
| Mock POS reports ready | `ready` |
| Explicit cancellation succeeds for the demonstrated path | `cancelled` |
| OMS/POS rejects, times out, or returns the selected deterministic demo failure | `failed` |

Conflicting raw states remain visible in the trace even when the demo derives `failed`.

## Minimum Gateway Command

```json
{
  "traceId": "trace-demo-001",
  "sessionId": "kfc:anon_customer_123",
  "clientMessageId": "customer_chat_msg_12",
  "idempotencyKey": "kfc:anon_customer_123:customer_chat_msg_12:placeOrder",
  "toolName": "placeOrder",
  "order": {
    "cart": {},
    "fulfillment": {},
    "userConfirmed": true
  }
}
```

The actual cart and fulfillment schemas remain those already used by the agent tool boundary. The trace should record safe summaries such as item codes, quantities, store ID, totals, and payment method, not customer address, phone, invoice email, tokens, or other secrets.

## Minimum Combined Result

```json
{
  "traceId": "trace-demo-001",
  "commerceOrderId": "COM-DEMO-1001",
  "omsOrderId": "OMS-DEMO-1001",
  "posTicketId": "POS-DEMO-1001",
  "omsStatus": "created",
  "posStatus": "accepted",
  "customerStatus": "accepted",
  "simulated": {
    "gateway": true,
    "oms": true,
    "pos": true
  }
}
```

## Trace Contract

Expected ordered runs/events under one `traceId`:

1. `user_message`
2. `planner_decision`
3. `tool_call`
4. `gateway_request`
5. `mock_oms_request`
6. `mock_oms_response`
7. `mock_pos_request`
8. `mock_pos_response`
9. `tool_result`
10. `assistant_response`
11. `genui_rendered`

Use LangSmith distributed tracing headers (`langsmith-trace` and optional `baggage`) across HTTP services, while retaining the domain `traceId` in metadata. See [LangSmith distributed tracing](https://docs.langchain.com/langsmith/distributed-tracing).

Required trace metadata:

- The six identifiers when available.
- `scenarioId`, `toolName`, and tool argument summary.
- `omsStatus`, `posStatus`, and `customerStatus`.
- Independent `gateway`, `oms`, and `pos` simulation labels.
- Model, prompt, and tool version metadata.
- Expected and rendered GenUI widget kind.

LangSmith supports searchable trace metadata and tags; see [metadata and tags](https://docs.langchain.com/langsmith/add-metadata-tags).

## LangSmith Evaluation Boundary

Deterministic code evaluators should verify:

- Correct tool selection.
- Tool arguments match the user answer.
- Required hop order.
- Continuous domain `traceId` and distributed trace.
- Identifier correlation.
- Independent simulation labels.
- Assistant response grounded in the tool result.
- Expected GenUI widget rendered.

Use LLM-as-judge only for response quality. LangSmith datasets and experiments can compare prompt/model/tool versions while retaining associated traces; see [LangSmith evaluation](https://docs.langchain.com/langsmith/evaluation).

## Non-goals

- Durable correlation after restart.
- Production idempotency or exactly-once guarantees.
- Vendor schema compatibility.
- LangSmith as a business-state database.
- Logging customer PII or credentials in traces.
