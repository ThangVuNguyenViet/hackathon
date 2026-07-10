# KFC Source Feature Parity Map

## Destination

Make the Flutter customer chat a first-class `kfc` conversation source, peer to `messenger` and `zalo`, with feature parity across backend orchestration, transcript persistence, live monitor visibility, operator controls, GenUI actions, and proof coverage.

The end state is a clear implementation plan that future sessions can execute without re-deciding source naming, session identity, monitor behavior, human handoff semantics, or proof gates.

## Notes

- Domain: KFC conversational ordering, customer GenUI chat, live monitor, operator handoff, backend channel/source contracts.
- Use `domain-modeling` when changing terms such as source, channel, session target, and handoff.
- Use `grilling` for HITL tickets that decide product/operator behavior.
- Do not add Patrol tests.
- Mock-data coverage belongs in normal unit, widget, or golden tests. Do not use Flutter `integration_test/` for fake/mock-data paths.
- Any Flutter `integration_test/` proof must exercise the current mainline backend-backed flow in `apps/kfc_live_monitor_flutter/integration_test/`.
- Keep dashboard SSE payloads typed with `DashboardEventPayload`; do not fall back to raw string event contracts.
- Current verified boundary: `/chat/mock` and `/chat/genui-action` write turns/events and current-main dashboard summaries include sessions with activity, but route/source contracts are still mock/web-oriented and profile/deeplink/human-control logic only understands Messenger/Zalo.

## Decisions so far

- [Define KFC Source Identity And Session Semantics](./01-define-kfc-source-identity-and-session-semantics.md) — KFC chat is a real `kfc` source with `kfc:<stable-id>` sessions, no `web_mock` source, first-party ingress routes, monitor visibility, disabled deeplink, and shared graph parity.
- [Audit Source Assumptions Across Backend And Flutter](./02-audit-source-assumptions-across-backend-and-flutter.md) — Current assumptions are concentrated in backend channel/profile/session-target contracts, `/chat/mock` route validators, Messenger/Zalo-only human delivery, Flutter `ChatChannel`, hidden `web:` customer sessions, and split backend-backed Flutter integration proofs that still need KFC route/source updates.
- [Decide Monitor Parity For KFC Source](./03-decide-monitor-parity-for-kfc-source.md) — KFC sessions appear in the default monitor grid with the same sorting/priority semantics and transcript/GenUI inspection, but KFC deeplink and human handoff controls are disabled for the first release.
- [Design KFC Chat Ingress And GenUI Action Contract](./04-design-kfc-chat-ingress-and-genui-action-contract.md) — KFC chat uses explicit first-party `/chat/kfc/message` and `/chat/kfc/genui-action` routes, `clientMessageId` idempotency, `kfc:` sessions, no client-supplied channel, and immutable GenUI snapshots on assistant turn metadata.
- [Plan Backend KFC Source Implementation](./05-plan-backend-kfc-source-implementation.md) — Backend work should add `kfc` types, explicit KFC ingress in Fastify and Worker, pre-graph idempotency, first-party assistant delivery status, KFC-aware dashboard metadata/deeplink handling, unsupported KFC human controls, and focused backend regression tests without adding KFC to webhook delivery.
- [Plan Flutter KFC Source Implementation](./06-plan-flutter-kfc-source-implementation.md) — Flutter work should generate durable `kfc:` customer identities and client message IDs, post to `/chat/kfc/*`, add `ChatChannel.kfc`, render KFC filters/badges, parse GenUI transcript metadata, disable KFC deeplink and handoff controls, and keep mock data in unit/widget/golden tests only.
- [Design KFC Source Proof Matrix](./07-design-kfc-source-proof-matrix.md) — Completion requires backend route/persistence/event/handoff tests, Flutter unit/widget/golden coverage, backend-backed KFC customer-chat-to-monitor integration proof, live GenUI artifacts, and grep evidence that the KFC proof path no longer uses legacy mock source names.

## Not yet specified

- Production identity and authentication for a real KFC-owned customer session are deferred until after anonymous `kfc:` source parity is implemented.
- Migration or archival behavior for existing `web:` and `web_mock` proof sessions is deferred unless implementation discovers persisted production rows that must be preserved.
- Deployment URL, routing, and public customer-chat hosting details are deferred; they are not required to implement the source contract.
- Durable storage migration is deferred unless the implementation changes an actual database schema rather than string channel/session values.

## Out of scope

- Rebuilding the KFC ordering graph, tool planner, menu fixtures, or GenUI widget catalog beyond what source parity requires.
- Changing Messenger or Zalo customer-facing behavior except where shared source abstractions require parity-safe refactors.
- Replacing the live monitor UI with a new product surface.
- Integrating real KFC production ordering APIs.

## Frontier

Open child tickets are the frontier. In this local markdown tracker, `Blocks` names the tickets that must close first.

No open first-release Wayfinder tickets remain. The map is ready for implementation handoff.
