# Demo POS Delivery And Failure Semantics

## Scope

These semantics exist to make the synchronous mock OMS/POS call chain deterministic and honest during a demo. They do not define production retries, reconciliation, or exactly-once behavior.

## Timing

- Each Mock OMS or Mock POS API call has a three-second timeout.
- Timeout scenarios configure the selected mock response to wait five seconds.
- The Demo Commerce Gateway performs no automatic background retry.
- Every attempt receives a new `traceId` and LangSmith trace.

## Result Fields

Every combined gateway result should expose:

- `traceId`
- `commerceOrderId`
- `omsOrderId` when available
- `posTicketId` when available
- `omsStatus` and `posStatus` independently
- derived `customerStatus`
- `outcome`
- `deduplicated`
- `originalTraceId` when deduplicated
- `compensationStatus` when compensation was attempted
- `conflictType` for contradictory states
- independent gateway, OMS, and POS simulation labels

## Outcome Matrix

### Successful placement

Sequence:

1. Mock OMS creates an order.
2. Mock POS accepts a ticket.
3. Gateway returns all three correlated order/ticket identifiers.

Result:

- `outcome: accepted`
- `customerStatus: accepted`
- Assistant confirms only identifiers and facts returned by the tools.
- GenUI renders the order/payment status appropriate to the existing chat flow.

### Duplicate command

Condition: the gateway receives an `idempotencyKey` already completed during the current demo run.

Behavior:

- Do not call Mock OMS or Mock POS again.
- Return the original combined result.
- Create a new trace for the attempt.
- Set `deduplicated: true` and `originalTraceId`.
- Render the same customer status and GenUI without creating another order.

### Explicit POS rejection

Condition: Mock POS definitively responds that no ticket was created.

Behavior:

1. Record `outcome: pos_rejected`.
2. Call Mock OMS cancellation synchronously.
3. If Mock OMS confirms cancellation, set `compensationStatus: succeeded`.
4. If cancellation fails, set `compensationStatus: failed` and retain the raw OMS state.

Customer behavior:

- `customerStatus: failed`
- Say the order was cancelled only when Mock OMS confirms cancellation.
- Otherwise say the order could not be confirmed and avoid asserting a terminal OMS state.

### POS timeout after OMS creation

Condition: Mock OMS created the order, but the Mock POS call exceeds three seconds.

Behavior:

- `outcome: ambiguous_pos_submission`
- `customerStatus: failed`
- Do not automatically call or claim OMS cancellation.
- Preserve the OMS result and POS timeout independently.
- Assistant says the order could not be confirmed, not that POS rejected it or OMS cancelled it.

The ambiguity is intentional: POS may have accepted before the client timed out.

### Customer cancellation

Sequence:

1. Cancel Mock POS first.
2. Only after POS confirms cancellation, cancel Mock OMS.

Result:

- Return `customerStatus: cancelled` only when both systems confirm.
- If POS cancellation fails, do not call OMS cancellation; return `failed` with raw states.
- If POS cancellation succeeds but OMS cancellation fails, return `failed` with `conflictType: cancellation_partial_failure`.
- Never tell the customer cancellation completed unless both confirm.

### Conflicting status

Example: OMS reports `cancelled` while POS reports `preparing`.

Behavior:

- `outcome: conflict`
- `customerStatus: failed`
- `conflictType: oms_pos_status_conflict`
- Preserve both raw statuses.
- Render order-status GenUI stating that the order status could not be confirmed.
- Do not expose KFC human join or resume controls.

## LangSmith Evidence

Each scenario should produce deterministic evaluator scores:

| Evaluator | Pass condition |
| --- | --- |
| `hop_order` | OMS precedes POS for placement; POS cancellation precedes OMS cancellation |
| `timeout_classification` | Five-second delay becomes `ambiguous_pos_submission` after the three-second budget |
| `no_false_success` | Assistant never confirms order/cancellation after failed or ambiguous tools |
| `duplicate_suppression` | Deduplicated trace contains no downstream OMS/POS request runs |
| `compensation_truthfulness` | Cancellation is claimed only after a successful OMS cancellation response |
| `raw_status_preserved` | Both source statuses remain present for conflict scenarios |
| `customer_status_mapping` | Derived customer status matches this matrix |
| `kfc_human_controls_disabled` | Failure GenUI does not enable join/resume controls |

## Required Demo Scenarios

1. Successful OMS creation and POS acceptance.
2. Duplicate command suppression.
3. Explicit POS rejection with successful OMS compensation.
4. Explicit POS rejection with failed OMS compensation.
5. POS timeout after OMS creation.
6. Successful POS-first cancellation.
7. Partial cancellation failure.
8. Conflicting OMS/POS status.

These scenarios are deterministic mock configurations, not attempts to model every production failure.

## Non-goals

- Automatic retries.
- Queues or dead-letter handling.
- Restart recovery.
- Production reconciliation.
- Vendor-specific timeout or cancellation guarantees.
- KFC human join/resume controls.
