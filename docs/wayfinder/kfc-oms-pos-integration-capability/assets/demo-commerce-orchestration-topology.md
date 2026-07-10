# Demo Commerce Orchestration Topology

## Decision

Use a separate local HTTP **Demo Commerce Gateway** between the KFC agent backend and separate mock OMS and mock POS HTTP services.

```text
Customer chat
  -> KFC agent backend
  -> Demo Commerce Gateway
  -> Mock OMS API
  -> Mock POS API
  -> Demo Commerce Gateway
  -> KFC agent backend
  -> assistant response and GenUI
```

All calls execute synchronously so the demo can deterministically show the complete chain in one interaction.

## Ownership

### KFC agent backend

- Receives the user message or GenUI action.
- Runs the planner and selects the agent tool.
- Starts or propagates a temporary `traceId`.
- Calls the Demo Commerce Gateway through the stable commerce client contract.
- Converts the returned tool result into assistant text, GenUI, and dashboard/tool-trace evidence.

### Demo Commerce Gateway

- Exposes the stable HTTP API called by the agent backend.
- Maps the canonical demo request to mock OMS and mock POS requests.
- Calls mock OMS first and mock POS second for order placement.
- Combines the mock identifiers and outcomes into one tool result.
- Propagates `traceId` through every downstream request and structured trace event.
- May retain transient in-memory demo correlation while running, but is not a durable system of record.

### Mock OMS

- Exposes order preview, placement, status, and cancellation endpoints required by the scenarios.
- Returns clearly simulated OMS identifiers and structured request/response trace events.

### Mock POS

- Exposes ticket submission, status, and cancellation endpoints required by the scenarios.
- Returns clearly simulated POS identifiers and structured request/response trace events.

## Execution Contract

For order placement:

1. The user confirms the order.
2. The planner emits `placeOrder` with arguments and the agent executes the tool.
3. The agent's commerce client sends the request to the Demo Commerce Gateway.
4. The gateway places the order with Mock OMS.
5. On OMS success, the gateway submits the order to Mock POS.
6. The gateway returns a combined result containing simulated OMS and POS identifiers.
7. The agent renders the assistant response and GenUI from that result.

Order-status scenarios synchronously query the required mock APIs through the same gateway. Explicit mock rejection may return a deterministic failure result. Queues, background retries, restart recovery, and production reconciliation are not part of this demo topology.

## Proof Contract

Every scenario must produce an ordered trace with the same temporary `traceId`:

```text
user_message
planner_decision
tool_call
gateway_request
mock_oms_request
mock_oms_response
mock_pos_request
mock_pos_response
tool_result
assistant_response
genui_rendered
```

Use `X-Trace-Id` for HTTP propagation and include `traceId` in every structured trace record. The proof artifact must label the gateway, OMS, and POS independently as `simulated`.

## Explicit Non-goals

- Durable OMS/POS correlation or idempotency across restart.
- Queues, scheduled retries, dead-letter handling, or reconciliation workers.
- Production credentials, vendor mappings, or real order placement.
- Claims of KFC OMS/POS compatibility.
- Production throughput, availability, security, or exactly-once guarantees.

## Consequence For The Existing Prototype

Preserve the typed clients and mock POS behavior from `d06b0933`, but enhance the proof by adding a separately runnable Demo Commerce Gateway and Mock OMS, propagating `traceId`, and recording the agent/tool/API/response/GenUI chain. Do not spend demo scope on replacing the in-memory maps with durable storage.
