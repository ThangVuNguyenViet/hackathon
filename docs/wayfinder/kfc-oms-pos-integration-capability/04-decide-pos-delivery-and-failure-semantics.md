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

When and how should an OMS order be delivered to POS, retried, cancelled, reconciled, or escalated when either system times out, rejects, duplicates, or reports conflicting state?

The resolution must choose sync versus async ownership, retry and timeout policy, compensation limits, poison-message handling, and operator reconciliation behavior.
