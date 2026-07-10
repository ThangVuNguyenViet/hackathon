# Ticket 07: Live Replay Runbook

## Type

Operations and proof task.

## Goal

Create a repeatable proof that shows a live Messenger message travelled through webhook, queue or fallback, AI processing, dashboard state, and outbound Messenger send.

## Scope

- Define the exact commands to inspect `webhook_deliveries`, `conversation_turns`, session control, dashboard events, queue state, and Worker readiness.
- Include a real-PSID proof path and a fake-PSID negative proof path.
- Include recovery commands for stale rows.
- Keep customer-facing messages free of debug prefixes and timestamps.

## Acceptance Criteria

- The runbook proves a fresh real tester message gets an assistant reply.
- The runbook proves a fake PSID reaches an explicit outbound failure state.
- The runbook includes a recovery procedure for stale `received` rows.
- The runbook records the live Worker version and git commit used for the proof.

## Dependencies

- [03-self-healing-recovery.md](./03-self-healing-recovery.md)
- [04-deploy-safety.md](./04-deploy-safety.md)
- [05-observability-alerting.md](./05-observability-alerting.md)
