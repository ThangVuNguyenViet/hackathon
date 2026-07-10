# Decide POS Delivery And Failure Semantics

## Status

Open

## Type

Grilling, HITL

## Assignee

Unassigned

## Blocks

- Define The Commerce Domain And Correlation Contract
- Choose The Commerce Orchestration Topology

## Question

How should the synchronous demo flow present success, explicit rejection, timeout, duplicate submission, cancellation, and conflicting mock state without implying production retry or reconciliation guarantees?

The resolution must define deterministic mock outcomes, timeout bounds, duplicate behavior, which failures appear in the tool result and GenUI, and which production behaviors remain non-goals.
