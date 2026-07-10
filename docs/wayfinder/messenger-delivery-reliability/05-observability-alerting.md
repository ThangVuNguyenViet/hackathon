# Ticket 05: Observability And Alerting

## Type

Implementation task.

## Goal

Detect silent Messenger delivery failures before testers report them.

## Scope

- Monitor stale `received` rows.
- Monitor customer turns without assistant replies while `agent_mode='ai_active'`.
- Monitor queue inactivity and dead-letter queue depth.
- Monitor `human_joined` skipped replies per session.
- Add dashboard events for delivery lifecycle changes.

## Acceptance Criteria

- A stuck inbound message produces a visible alert within the chosen threshold.
- The dashboard can show whether a missing reply was caused by human mode, outbound failure, queue delay, duplicate handling, or processing error.
- Alerts include enough identifiers to investigate: `session_id`, `external_event_id`, Worker version, delivery state, and last error.

## Dependencies

- [01-delivery-state-machine.md](./01-delivery-state-machine.md)
- [03-self-healing-recovery.md](./03-self-healing-recovery.md)
