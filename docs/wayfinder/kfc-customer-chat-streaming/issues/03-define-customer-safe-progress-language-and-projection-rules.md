Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 01-audit-runtime-evidence-available-to-customer-streaming.md
Assignee: Codex

## Question

What canonical customer-safe progress stages and Vietnamese labels should the KFC chat expose, and exactly which verified runtime facts may project into each stage? Define behavior for no-tool turns, repeated planner iterations, policy blocks, read-only discovery, cart mutation, fulfillment, payment, order placement, handoff, response composition, delayed signals, and events too technical or sensitive to expose. Establish the domain boundary between Customer-Safe Agent Progress and operator/debug evidence without revealing chain-of-thought.

## Answer

The user-reviewed [Customer-Safe Progress Language And Projection Rules](../assets/customer-safe-progress-language-and-projection-rules.md) establish one active Vietnamese status for the newest valid run, semantic coalescing rather than event-by-event churn, fixed read-only and mutation label families, deterministic success-only completion summaries, and a strict boundary excluding planner, policy, tool, trace, error, and escalation internals.

Flutter shows an immediate claim-free animated placeholder, but semantic labels require backend evidence. Tool-backed active labels require a new always-on start fact after validation and policy approval; the current success-only `tool_called` event cannot be backdated into progress. The first text delta collapses progress, recoverable failures remain invisible, terminal failures use phase-specific customer copy, reconnect is secondary Run Transport Loss, Stop is explicit, and supersession never exposes coordination mechanics.
