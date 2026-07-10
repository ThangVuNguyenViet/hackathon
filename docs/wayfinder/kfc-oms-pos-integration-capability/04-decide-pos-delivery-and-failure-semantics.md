# Decide POS Delivery And Failure Semantics

## Status

Closed

## Type

Grilling, HITL

## Assignee

Codex

## Blocks

- Define The Commerce Domain And Correlation Contract
- Choose The Commerce Orchestration Topology

## Question

How should the synchronous demo flow present success, explicit rejection, timeout, duplicate submission, cancellation, and conflicting mock state without implying production retry or reconciliation guarantees?

The resolution must define deterministic mock outcomes, timeout bounds, duplicate behavior, which failures appear in the tool result and GenUI, and which production behaviors remain non-goals.

## Interview notes

- A POS timeout after OMS creation returns `customerStatus: failed` with trace outcome `ambiguous_pos_submission`.
- Do not claim the OMS order was cancelled automatically. Preserve raw OMS/POS outcomes and tell the customer the order could not be confirmed.
- Explicit POS rejection triggers synchronous Mock OMS cancellation. Report `compensationStatus: succeeded` only after OMS confirms cancellation; otherwise report `compensationStatus: failed` and preserve the conflict in LangSmith.
- A duplicate `idempotencyKey` makes no new OMS/POS calls. Return the original result under a new trace with `deduplicated: true` and `originalTraceId`, preserving the same customer status and GenUI.
- Customer cancellation calls Mock POS first and Mock OMS second. Derive `cancelled` only when both confirm; otherwise derive `failed` and preserve both raw outcomes as a visible conflict.
- Each mock API call has a three-second timeout. The deterministic timeout scenario delays the selected mock response for five seconds.

## Resolution

The demo runs OMS/POS calls synchronously with a three-second per-call timeout and no automatic retries. Duplicate commands return the original result without downstream calls. Explicit POS rejection may trigger verified OMS compensation; POS timeout is classified as ambiguous and does not claim cancellation. Customer cancellation is POS-first and returns `cancelled` only after both mocks confirm. Contradictory states return `failed`, retain both raw states, and render status-unconfirmed GenUI without KFC human controls.

Full matrix: [Demo POS Delivery And Failure Semantics](./assets/demo-pos-delivery-and-failure-semantics.md).
