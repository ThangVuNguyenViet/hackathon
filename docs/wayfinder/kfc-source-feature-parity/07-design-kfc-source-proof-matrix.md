# Design KFC Source Proof Matrix

## Status

Open, unclaimed.

## Labels

wayfinder:task

## Blocks

- [Plan Backend KFC Source Implementation](./05-plan-backend-kfc-source-implementation.md)
- [Plan Flutter KFC Source Implementation](./06-plan-flutter-kfc-source-implementation.md)

## Question

What proof is required before the team can say KFC source feature parity is done?

Resolve:

- backend unit/integration tests for `kfc` source visibility, turns, events, and handoff controls;
- Flutter unit/widget/golden coverage for `kfc` channel rendering and filtering;
- Patrol end-to-end scenarios that start in customer chat, verify monitor visibility, exercise GenUI action events, and prove operator takeover/resume behavior;
- required commands and environment setup;
- pass/fail evidence that future agents must capture.

The answer should become the acceptance gate for implementation completion.
