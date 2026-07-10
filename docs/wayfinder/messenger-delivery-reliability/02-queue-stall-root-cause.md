# Ticket 02: Queue Stall Root Cause

## Type

Research and incident analysis.

## Goal

Prove the exact reason queued Messenger deliveries stopped invoking the consumer during the 2026-07-10 incident.

## Known Facts

- The live webhook returned `queued`.
- `webhook_deliveries` rows remained in `status='received'`.
- Worker tail showed fetch-handler enqueue logs.
- No queue-consumer processing appeared until queue delivery was resumed and the Worker was redeployed.
- After that action, the real tester row processed and an assistant reply was sent.

## Research Tasks

- Capture queue configuration for `kfc-messenger-webhook-jobs` and `kfc-messenger-webhook-dlq`.
- Check whether queue delivery was paused before `wrangler queues resume-delivery`.
- Compare Worker versions around the incident, especially the pre-recovery version and the post-recovery deployment.
- Inspect dead-letter queue depth and recent failure history.
- Determine whether Cloudflare exposes consumer delivery errors, paused state, or retry exhaustion through API or logs.

## Acceptance Criteria

- The final note clearly separates verified Cloudflare state from inference.
- If exact Cloudflare state cannot be recovered, the note states what evidence was unavailable and which safeguards still address the failure mode.
- The result updates the architecture decision ticket.

## Dependencies

- None.
