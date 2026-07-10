# Choose The Commerce Orchestration Topology

## Status

Open

## Type

Grilling, HITL

## Assignee

Unassigned

## Blocks

- Audit The Current Commerce Prototype

## Question

Should OMS/POS orchestration, durable correlation, retries, and reconciliation live inside the KFC agent backend, inside a dedicated commerce gateway, or inside an existing enterprise integration layer?

Choose the owning runtime and deployment boundary, define what the agent backend may call synchronously, and identify which component owns credentials, durable operation state, retries, vendor mapping, and reconciliation.
