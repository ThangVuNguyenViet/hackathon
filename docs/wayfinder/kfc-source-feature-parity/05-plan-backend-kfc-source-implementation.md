# Plan Backend KFC Source Implementation

## Status

Open, unclaimed.

## Labels

wayfinder:task

## Blocks

- [Decide Monitor Parity For KFC Source](./03-decide-monitor-parity-for-kfc-source.md)
- [Design KFC Chat Ingress And GenUI Action Contract](./04-design-kfc-chat-ingress-and-genui-action-contract.md)

## Question

What is the backend implementation plan for adding `kfc` source support without regressing Messenger or Zalo?

Resolve the ordered change list for:

- domain types and validators;
- session target parsing and dashboard visibility;
- route handlers and normalized ingress;
- dashboard events, session summaries, turns, profiles, and deeplink behavior;
- human takeover/resume behavior for `kfc`;
- D1/Postgres/memory persistence expectations;
- backend test updates and new regression tests.

The answer should be execution-ready but should not implement the patch.
