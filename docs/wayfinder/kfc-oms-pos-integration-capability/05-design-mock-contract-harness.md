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

The design must cover happy path, duplicate delivery, delayed acceptance, unavailable item, store rejection, timeout, retry, conflicting status, cancellation, and recovery after process restart.
