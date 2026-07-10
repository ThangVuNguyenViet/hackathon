# Ticket 06: Runtime Architecture Decision

## Type

Architecture decision record.

## Goal

Choose the runtime pattern that prevents accepted Messenger messages from silently stalling.

## Options

- Keep Cloudflare Queues as the only async processing path, plus stronger monitoring.
- Keep Cloudflare Queues and add a scheduled stale-row reconciler.
- Add direct processing fallback when queue health is stale.
- Replace the queue with a different durable job mechanism.

## Decision Inputs

- Queue stall root-cause findings.
- Messenger webhook response time requirements.
- Duplicate delivery risk.
- Operational complexity during demos.
- Cost and platform limits.

## Acceptance Criteria

- The decision names the chosen pattern and rejected alternatives.
- The decision explains how a message accepted by the webhook is guaranteed to reach terminal state.
- The decision includes rollback and demo-operation guidance.

## Dependencies

- [02-queue-stall-root-cause.md](./02-queue-stall-root-cause.md)
- [03-self-healing-recovery.md](./03-self-healing-recovery.md)
