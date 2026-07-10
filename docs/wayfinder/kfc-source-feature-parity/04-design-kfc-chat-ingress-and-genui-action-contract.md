# Design KFC Chat Ingress And GenUI Action Contract

## Status

Open, unclaimed.

## Labels

wayfinder:prototype

## Blocks

- [Define KFC Source Identity And Session Semantics](./01-define-kfc-source-identity-and-session-semantics.md)
- [Audit Source Assumptions Across Backend And Flutter](./02-audit-source-assumptions-across-backend-and-flutter.md)

## Question

What backend ingress contract should the Flutter customer chat use once it is a real `kfc` source?

Resolve:

- whether to keep `/chat/mock` and `/chat/genui-action`, add `/chat/kfc`, or generalize to a channel-neutral customer chat route;
- how text turns and GenUI actions become normalized customer turns;
- how external message IDs, timestamps, raw event metadata, and delivery status should be represented for first-party chat;
- how the backend should persist GenUI attachments so monitor transcript replay can inspect what the customer saw;
- what behavior remains fixture-only for tests versus production-like for `kfc`.

The answer should be a contract sketch, not a code patch.
