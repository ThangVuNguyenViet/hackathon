# KFC Source Feature Parity Map

## Destination

Make the Flutter customer chat a first-class `kfc` conversation source, peer to `messenger` and `zalo`, with feature parity across backend orchestration, transcript persistence, live monitor visibility, operator controls, GenUI actions, and proof coverage.

The end state is a clear implementation plan that future sessions can execute without re-deciding source naming, session identity, monitor behavior, human handoff semantics, or proof gates.

## Notes

- Domain: KFC conversational ordering, customer GenUI chat, live monitor, operator handoff, backend channel/source contracts.
- Use `domain-modeling` when changing terms such as source, channel, session target, and handoff.
- Use `grilling` for HITL tickets that decide product/operator behavior.
- Use Patrol as the Flutter integration-test surface for end-to-end proof in `apps/kfc_live_monitor_flutter/patrol_test/`.
- Keep dashboard SSE payloads typed with `DashboardEventPayload`; do not fall back to raw string event contracts.
- Current verified boundary: `/chat/mock` and `/chat/genui-action` write turns/events, but `/dashboard/sessions` only exposes `messenger:` and `zalo:` session targets.

## Decisions so far

- [Define KFC Source Identity And Session Semantics](./01-define-kfc-source-identity-and-session-semantics.md) — KFC chat is a real `kfc` source with `kfc:<stable-id>` sessions, no `web_mock` source, first-party ingress routes, monitor visibility, disabled deeplink, and shared graph parity.
- [Audit Source Assumptions Across Backend And Flutter](./02-audit-source-assumptions-across-backend-and-flutter.md) — Current assumptions are concentrated in backend channel/profile/session-target contracts, `/chat/mock` route validators, Messenger/Zalo-only human delivery, Flutter `ChatChannel`, hidden `web:` customer sessions, and split Patrol proofs.

## Not yet specified

- Production identity and authentication for a real KFC-owned customer session may need a later decision after the source contract is fixed.
- Migration or archival behavior for existing `web:` and `web_mock` proof sessions may need a later decision after the canonical `kfc` session shape is chosen.
- Deployment URL, routing, and public customer-chat hosting details may need a later decision after the backend and Flutter contract is settled.
- Any durable storage migration for existing D1/Postgres rows depends on the chosen source/session model.

## Out of scope

- Rebuilding the KFC ordering graph, tool planner, menu fixtures, or GenUI widget catalog beyond what source parity requires.
- Changing Messenger or Zalo customer-facing behavior except where shared source abstractions require parity-safe refactors.
- Replacing the live monitor UI with a new product surface.
- Integrating real KFC production ordering APIs.

## Frontier

Open child tickets are the frontier. In this local markdown tracker, `Blocks` names the tickets that must close first.

- [Decide Monitor Parity For KFC Source](./03-decide-monitor-parity-for-kfc-source.md)
- [Design KFC Chat Ingress And GenUI Action Contract](./04-design-kfc-chat-ingress-and-genui-action-contract.md)
- [Plan Backend KFC Source Implementation](./05-plan-backend-kfc-source-implementation.md)
- [Plan Flutter KFC Source Implementation](./06-plan-flutter-kfc-source-implementation.md)
- [Design KFC Source Proof Matrix](./07-design-kfc-source-proof-matrix.md)
