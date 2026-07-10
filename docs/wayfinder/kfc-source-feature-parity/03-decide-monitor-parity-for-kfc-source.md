# Decide Monitor Parity For KFC Source

## Status

Open, claimed by Codex on 2026-07-10.

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
