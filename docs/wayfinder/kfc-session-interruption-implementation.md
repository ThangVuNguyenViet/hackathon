# KFC Session Interruption Implementation

This note tracks the implementation branch for session interruption and rapid-message coalescing.

Source wayfinder map:

- Local planning map: `/Users/vietthangvunguyen/Workspace/hackathon/.scratch/kfc-session-interruption-wayfinder/map.md`

Decision summary:

- Treat interruption as session coordination, not an orchestrator/specialist multi-agent architecture.
- Keep the existing single agent and backend-owned tool contracts.
- Preserve raw customer messages as individual transcript turns.
- Add durable pending-turn, agent-run, run-turn, and session-agent-state records.
- Use delayed queue wakeups plus scheduled recovery to claim one current run for a burst.
- Make Messenger coalescing the default behavior; use `KFC_AGENT_INTERRUPTION_ENABLED=0` as the explicit rollback switch.
- Treat `KFC_AGENT_INTERRUPTION_ENABLED` as enabling the coordinator/wakeup path too, unless `KFC_AGENT_INTERRUPTION_SHADOW=0` explicitly disables shadow recording.

Implemented slices:

- Slice 0: isolated worktree and backend baseline verification.
- Slice 1: domain contracts, Memory/D1/Postgres store support, fake D1 support, D1 migration, and run lifecycle dashboard event types.
- Slice 2: shadow-mode coordinator, delayed wakeup jobs, stale-generation no-op, scheduled recovery, and Worker coverage behind `KFC_AGENT_INTERRUPTION_SHADOW`.
- Slice 3: Messenger run-bound execution default-on, including raw customer transcript turns, one coalesced agent run, one delivered assistant reply, webhook delivery closure for included messages, and explicit opt-out through `KFC_AGENT_INTERRUPTION_ENABLED=0`.
- Slice 4: supersession for uncommitted current runs, centralized tool side-effect classification, stale irreversible tool-call blocking, run-current graph guards, exact assistant-turn delivery updates, and stale delivery suppression.
- Slice 5: deterministic Worker integration coverage for default coalescing, three-message bursts, duplicate webhook retries, outbound delivery failure, Zalo default coalescing, unsupported Zalo legacy acknowledgements, and Zalo duplicate retries. Added a skipped-by-default live OpenAI Worker proof for a rapid Messenger burst, runnable with `npm run test:live:interruption`.
- Slice 6: monitor visibility for interruption lifecycle events, including pending/coalescing state before wakeup, scheduled/running/delivered/superseded/suppressed status mapping, and a compact Flutter session-card status strip. The live OpenAI proof now verifies dashboard session/event/turn endpoints before and after queue processing.

Next slice:

- Slice 7: merge-readiness review, migration sanity, and final proof packaging.
