# Messenger Delivery Reliability Map

## Destination

Make Messenger delivery reliable enough that a tester message cannot be accepted by the webhook and then silently receive no AI response.

The target end state is:

- Every inbound Messenger event has a visible lifecycle: accepted, queued, processing, replied, skipped, failed, or recovered.
- `human_joined` only suppresses AI for the intended chat session, and that suppression is visible in telemetry.
- Queue delivery stalls, deployment mistakes, and unanswered customer turns are detected and repaired without waiting for a human to notice.
- The live proof checks the real production surfaces: `webhook_deliveries`, `conversation_turns`, dashboard events, and outbound Messenger send status.

## Verified Incident Boundary

This is the verified boundary from the 2026-07-10 incident investigation.

- A real tester message was accepted by the live webhook and persisted in `webhook_deliveries` as `status='received'`.
- That session had `agent_mode='ai_active'`, so the latest incident was not caused by `human_joined`.
- No `conversation_turns` user turn or assistant turn existed for the tester message while the delivery row was stuck.
- A synthetic webhook probe also stayed in `status='received'`, proving the issue was not isolated to one tester PSID.
- Worker tail showed webhook fetch logs and queue enqueue logs, but queue consumer processing did not happen until delivery was resumed and the Worker was redeployed.
- After `wrangler queues resume-delivery kfc-messenger-webhook-jobs` and redeploying `kfc-agent-backend-demo`, the stuck tester message was processed and an assistant reply was sent.

Verified root-cause boundary: ingress and queue enqueue worked, but queue consumer delivery was not reliably invoking. The exact Cloudflare-internal reason for the queue delivery stall is not yet proven.

## Frontier

### Reliability State Machine

Define the durable state machine for Messenger delivery, including state transitions, retry ownership, timeout thresholds, and the difference between intentional skips and failures.

Ticket: [01-delivery-state-machine.md](./01-delivery-state-machine.md)

### Queue Stall Root Cause

Investigate why Cloudflare Queue delivery stopped invoking despite accepted and queued messages. Use deployment history, queue configuration, dead-letter state, Worker version IDs, tail logs, and Cloudflare Queue behavior.

Ticket: [02-queue-stall-root-cause.md](./02-queue-stall-root-cause.md)

### Self-Healing Recovery

Design and implement a reconciler that finds stale `webhook_deliveries.status='received'` rows, determines whether they were answered, and safely replays or marks them failed with an alert.

Ticket: [03-self-healing-recovery.md](./03-self-healing-recovery.md)

### Deploy Safety

Make deploys provenance-aware and hard to do from the wrong state. The live service should expose the Worker version, git commit, build time, queue binding, and consumer health in `/ready?deep=1`.

Ticket: [04-deploy-safety.md](./04-deploy-safety.md)

### Observability And Alerting

Add monitors for stuck received rows, missing assistant replies, queue/DLQ depth, queue consumer inactivity, and `human_joined` suppression counts.

Ticket: [05-observability-alerting.md](./05-observability-alerting.md)

### Runtime Architecture Decision

Decide whether to keep Cloudflare Queues as the only async path, add synchronous fallback for small messages, or introduce a scheduled recovery worker as the primary reliability layer.

Ticket: [06-runtime-architecture-decision.md](./06-runtime-architecture-decision.md)

### Live Replay Runbook

Create the operator runbook and proof script that can replay one live tester scenario end to end and prove the database, dashboard, and outbound send all agree.

Ticket: [07-live-replay-runbook.md](./07-live-replay-runbook.md)

## Current Recommendation

Do not treat the prior `human_joined` fix as sufficient. It solved one bug, but the latest failure is a separate class: queue delivery can stall after the webhook has already accepted the message.

The durable fix should be a reliability layer around delivery, not only another local code patch:

1. Add a persistent delivery state machine and stale-row reconciler.
2. Add production readiness and deployment provenance checks.
3. Add alerting on unanswered customer turns and queue inactivity.
4. Keep the `human_joined` logic scoped per session, but verify it through the same delivery lifecycle.
5. Require a live replay proof after every deploy that touches webhook, queue, session control, or outbound Messenger code.

## Open Questions

- What exact Cloudflare Queue condition caused consumer delivery to stop invoking?
- Was message delivery paused at the queue level before the manual `resume-delivery` command, or did redeploying the consumer clear a stale runtime state?
- What stale-row threshold is acceptable for the demo: 30 seconds, 60 seconds, or 2 minutes?
- Should fake/test PSIDs be explicitly marked as expected outbound failures to avoid noisy alerts?
- Should the webhook handler include a direct processing fallback when queue enqueue succeeds but queue consumption is stale?

## Proof Required Before Calling This Solved

- Unit tests for every delivery state transition and `human_joined` suppression path.
- Integration test for stale `received` replay without duplicate user turns or duplicate outbound sends.
- Live Worker proof where a fresh Messenger message creates a user turn, creates an assistant turn, and sends a real outbound message.
- Live negative proof where a fake PSID fails with an explicit outbound failure state instead of staying `received`.
- Monitor proof where a deliberately stale `received` row triggers a recoverable alert or reconciler action.
