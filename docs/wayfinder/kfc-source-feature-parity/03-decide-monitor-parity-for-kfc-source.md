# Decide Monitor Parity For KFC Source

## Status

Closed on 2026-07-10.

## Labels

wayfinder:grilling

## Blocks

- [Define KFC Source Identity And Session Semantics](./01-define-kfc-source-identity-and-session-semantics.md)
- [Audit Source Assumptions Across Backend And Flutter](./02-audit-source-assumptions-across-backend-and-flutter.md)

## Question

What exactly does feature parity mean for a `kfc` source in the operator live monitor?

Resolve:

- whether `kfc` sessions appear in the same grid as Messenger and Zalo by default;
- channel filter label, icon/copy, sort behavior, and priority behavior;
- transcript visibility and GenUI attachment inspection expectations;
- whether `openSession` should deep-link to the Flutter customer chat, a local route, or show no external link;
- whether `joinHuman`, `human-message`, and `resume-ai` must work for `kfc` sessions in the first parity release;
- how operator-sent human messages are delivered back into the customer chat UI if the session is first-party Flutter rather than an external network.

The answer should separate required parity for the first implementation from acceptable follow-up behavior.

## Resolution

For the first KFC source parity release, `kfc` sessions are operator-visible but do not enter the human handoff loop.

Required first implementation:

- `kfc` sessions appear in the same main live monitor grid as Messenger and Zalo by default.
- `kfc` sessions use the same priority, risk, order-stage, freshness, and sorting semantics as Messenger and Zalo sessions.
- The channel/source filter includes a `KFC Chat` option, and KFC sessions are included under the existing `All` view.
- Transcript turns for KFC sessions are visible in the monitor like any other session.
- GenUI attachments and GenUI action events from the customer chat must be inspectable from the monitor transcript/event surface.
- The open/deeplink action is disabled for KFC sessions in this release. Backend data should make the unavailable reason explicit so the Flutter button can stay disabled with predictable copy.
- `joinHuman`, operator `human-message`, and `resume-ai` are not required for KFC sessions in this release. They should be disabled or rejected with an explicit unsupported-channel response rather than partially wired.
- Because operator messages are disabled for KFC in this release, there is no first-release requirement to deliver operator-sent human messages back into the Flutter customer chat UI.

Acceptable follow-up behavior:

- A later KFC-account or first-party support release may add authenticated customer sessions, a local customer-chat route, app-readable operator turns, and AI resume semantics.
- That later work should be designed as first-party persisted chat delivery, not Messenger/Zalo webhook delivery and not `webhook_deliveries`.
- Messenger and Zalo human handoff behavior must remain unchanged while KFC controls are disabled.
