# Define The Commerce Domain And Correlation Contract

## Status

Closed

## Type

Grilling, HITL

## Assignee

Codex

## Blocks

- Define The OMS And POS Capability Claim

## Question

What canonical entities, identifiers, lifecycle states, and ownership rules should connect chat checkout, OMS orders, store/POS tickets, payments, and monitor telemetry without depending on an unknown vendor schema?

Resolve the source for each demo field, temporary `traceId`, in-process OMS/POS correlation, status normalization, and the minimum mock API mapping contract. Durable restart-safe correlation is explicitly outside the demo scope.

## Interview notes

- Keep `sessionId`, `traceId`, `commerceOrderId`, `omsOrderId`, `posTicketId`, and `idempotencyKey` distinct.
- `traceId` identifies one user-to-response execution chain; it is not an order identifier.
- Preserve `omsStatus` and `posStatus` independently. The gateway derives a separate `customerStatus` for the agent and GenUI rather than overwriting either source status.
- LangSmith is the canonical visual trace and evaluation evidence. The local JSON trace report is the credential-free fallback; neither stores authoritative commerce state.
- Propagate LangSmith distributed tracing headers across the agent, gateway, Mock OMS, and Mock POS while retaining the domain `traceId` in metadata.
- The Demo Commerce Gateway generates `commerceOrderId` before downstream calls. Mock OMS receives it and returns `omsOrderId`; Mock POS receives both and returns `posTicketId`.
- Derive `idempotencyKey` as `sessionId + clientMessageId + toolName`. The gateway suppresses duplicates in memory for one demo run. Each attempt still receives a new `traceId` so deduplicated attempts remain observable.

## Resolution

The demo uses distinct conversation, execution, gateway-order, OMS-order, POS-ticket, and idempotency identifiers. The gateway owns `commerceOrderId`; Mock OMS and Mock POS own their identifiers. Raw `omsStatus` and `posStatus` remain visible while the gateway derives one seven-state `customerStatus` for the agent and GenUI.

LangSmith is the canonical visual evidence, using distributed tracing across services and deterministic evaluators for tool choice, arguments, hop order, correlation, simulation labels, grounded response, and GenUI. A local JSON report remains the credential-free fallback. Neither trace system is authoritative commerce state.

Full contract: [Demo Commerce Domain And Correlation Contract](./assets/demo-commerce-domain-contract.md).
