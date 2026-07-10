# Design The Mock OMS And POS Contract Harness

## Status

Open

## Type

Prototype, HITL

## Assignee

Unassigned

## Blocks

- Define The Commerce Domain And Correlation Contract
- Decide POS Delivery And Failure Semantics

## Question

What mock OMS and mock POS behaviors, configurable failures, contract fixtures, and deterministic scenarios are required to demonstrate the chosen integration semantics without letting the mocks define the future vendor contract accidentally?

The design must cover happy path, duplicate delivery in one demo run, delayed response, unavailable item, store rejection, timeout, conflicting status, and cancellation. Recovery after process restart is outside the demo scope.
