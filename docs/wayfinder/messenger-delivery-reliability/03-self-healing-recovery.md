# Ticket 03: Self-Healing Recovery

## Type

Implementation task.

## Goal

Add an automated recovery path for inbound Messenger deliveries that were accepted but not processed.

## Scope

- Find `webhook_deliveries.status='received'` rows older than the configured threshold.
- Check whether a matching customer turn and assistant turn already exist before replaying.
- Reprocess safely using existing idempotency keys and external message IDs.
- Mark unrecoverable rows failed with a specific error reason.
- Emit dashboard and log events for recovered, skipped, and failed rows.

## Acceptance Criteria

- A stale `received` row can be recovered without duplicating turns.
- A fake PSID reaches an explicit outbound failure state instead of staying pending forever.
- Recovery can be triggered by scheduled Worker, admin endpoint, or local operator script.
- Tests prove recovery is idempotent across repeated runs.

## Dependencies

- [01-delivery-state-machine.md](./01-delivery-state-machine.md)
