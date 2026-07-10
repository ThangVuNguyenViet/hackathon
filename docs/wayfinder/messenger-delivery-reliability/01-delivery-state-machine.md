# Ticket 01: Delivery State Machine

## Type

Design plus implementation task.

## Goal

Define and implement a delivery lifecycle that makes every Messenger webhook event explainable from database state alone.

## Scope

- Enumerate valid states for `webhook_deliveries`.
- Distinguish successful replies, intentional AI skips, outbound send failures, duplicate webhook events, and unrecoverable processing errors.
- Record the session control mode used for each decision.
- Make `human_joined` suppression explicit and session-scoped.
- Add database-level and service-level tests for state transitions.

## Acceptance Criteria

- A stuck message can no longer look identical to a normal pending message after the timeout threshold.
- `human_joined` produces an explicit skipped state with the affected `session_id`.
- Duplicate webhook retries do not create duplicate customer turns or duplicate assistant sends.
- Tests cover normal reply, human paused, resume recovery, fake PSID outbound failure, duplicate event, and thrown processing error.

## Dependencies

- None.
