Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

Which current runtime facts and timings are authoritative enough to drive customer-visible progress, text-stream start, GenUI revisions, completion, failure, cancellation, and supersession? Audit the first-party KFC route, graph, planner, policy gates, tool execution, response composition, persistence, dashboard events, tracing, and Flutter consumption. Produce a source-backed event inventory that distinguishes durable facts, live-only signals, tracing-only spans, inferred states, and signals that do not yet exist. Do not design the final UI or implement events in this ticket.

## Answer

The source-backed [Runtime Evidence Available To Customer Streaming](../assets/runtime-evidence-audit.md) audit finds that final turns, verified-state snapshots, final GenUI, completed KFC request markers, successful tool outcomes, and derived business outcomes can anchor a future customer stream. Planner, policy, tool-start, state-update, and response-composition boundaries currently exist only as optional technical traces; dashboard events are live with best-effort persistence and are not a customer-safe or sequenced contract.

First-party KFC has no `AgentRun`, run lifecycle, customer-safe projection, text delta, GenUI revision, cancellation, supersession, replay cursor, or explicit terminal run event. Flutter observes only a locally inferred `isSending` state and one completed response. Later tickets must add always-on evidence and projection contracts rather than infer phases from timing or expose dashboard/LangSmith payloads directly.
