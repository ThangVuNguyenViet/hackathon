# Plan Runtime Readiness And Observability

## Status

Closed

## Type

Research, AFK

## Assignee

Codex

## Blocks

- Decide POS Delivery And Failure Semantics
- Choose The Commerce Orchestration Topology

## Question

What configuration, process readiness, structured trace events, and dashboard/proof surfaces are required to run the four-service demo and distinguish simulated dependencies from unavailable ones?

Include local demo tokens, dependency health, temporary trace lookup, ordered hop visibility, and proof provenance. Production alerting, retry visibility, and reconciliation queues are outside this demo scope.

## Resolution

[Demo Runtime Readiness And Observability Plan](./assets/demo-runtime-readiness-and-observability-plan.md) defines runner-owned ephemeral configuration, side-effect-free health and deep readiness for all four services, an in-memory structured event collector, LangSmith distributed trace/evaluation evidence, a scoped monitor trace summary, proof provenance, and separate local versus presentation gates.

## Current implementation amendment (2026-07-20)

Only the side-effect-free gateway and Mock OMS/POS readiness checks remain in
the component-test boundary. The runner-owned collector, synthetic trace
contract, generated proof provenance, and mock LangSmith presentation gate are
retired and must not be cited as current evidence.
