# Choose The Commerce Orchestration Topology

## Status

Closed

## Type

Grilling, HITL

## Assignee

Codex

## Blocks

- Audit The Current Commerce Prototype

## Question

Should OMS/POS orchestration, durable correlation, retries, and reconciliation live inside the KFC agent backend, inside a dedicated commerce gateway, or inside an existing enterprise integration layer?

Choose the owning runtime and deployment boundary, define what the agent backend may call synchronously, and identify which component owns credentials, durable operation state, retries, vendor mapping, and reconciliation.

## Interview notes

- The demo topology uses a dedicated commerce gateway boundary, unless an existing KFC enterprise integration layer is later supplied.
- The effort is demo-only. It does not require a real stateful commerce ledger, restart durability, production retries, or production reconciliation.
- The required proof is the observable chain from user answer, to AI tool selection, to tool execution, to mock OMS/POS API request and response.
- Demo acceptance is a trace sharing one temporary `traceId` across user message, planner decision, tool call and arguments, gateway request, mock OMS/POS request and response, tool result, assistant response, and rendered chat/GenUI state.
- OMS placement followed by POS submission executes synchronously for deterministic demo behavior. Follow-up order status also queries mock dependencies synchronously. Queues, background retries, and restart recovery are excluded.

## Resolution

Use a separately runnable local HTTP Demo Commerce Gateway between the KFC agent backend and separate Mock OMS and Mock POS HTTP services. The agent owns planner/tool execution; the gateway owns synchronous mock API orchestration and mapping; each mock owns its simulated API behavior.

One temporary `traceId` must connect the user message, planner decision, tool call, gateway request, mock OMS/POS requests and responses, tool result, assistant response, and rendered GenUI. No durable stateful layer, queue, background retry, restart recovery, or production reconciliation is required for this demo.

Full decision: [Demo Commerce Orchestration Topology](./assets/demo-commerce-orchestration-topology.md).
