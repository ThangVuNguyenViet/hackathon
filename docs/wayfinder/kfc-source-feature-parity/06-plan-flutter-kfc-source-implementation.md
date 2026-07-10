# Plan Flutter KFC Source Implementation

## Status

Open, unclaimed.

## Labels

wayfinder:task

## Blocks

- [Decide Monitor Parity For KFC Source](./03-decide-monitor-parity-for-kfc-source.md)
- [Design KFC Chat Ingress And GenUI Action Contract](./04-design-kfc-chat-ingress-and-genui-action-contract.md)

## Question

What is the Flutter implementation plan for making the customer chat and live monitor understand `kfc` as a first-class source?

Resolve the ordered change list for:

- customer chat session ID generation and repository payloads;
- live monitor `ChatChannel` modeling, labels, filters, sort, and visual treatment;
- session card transcript and GenUI attachment display expectations;
- operator controls for KFC sessions;
- fixture repository updates versus backend repository updates;
- widget tests, golden tests, and Patrol bundle updates.

The answer should be execution-ready but should not implement the patch.
