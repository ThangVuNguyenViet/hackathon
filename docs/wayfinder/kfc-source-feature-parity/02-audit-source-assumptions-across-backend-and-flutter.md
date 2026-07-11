# Audit Source Assumptions Across Backend And Flutter

## Status

Closed on 2026-07-10.

## Labels

wayfinder:research

## Blocks

None.

## Question

Where does the current code assume that operator-visible conversation sources are only Messenger and Zalo, or that Flutter customer chat is only a hidden browser/mock source?

Audit at least:

- backend channel/source unions and validators;
- session ID helpers and dashboard session visibility;
- persistence schemas and profile lookup keys;
- route handlers for chat, GenUI actions, dashboard events, dashboard sessions, human join, human messages, and AI resume;
- live monitor Flutter `ChatChannel`, filters, repository mapping, session cards, deeplinks, and tests;
- Flutter integration-test customer-chat and monitor proof scenarios.

The answer should list concrete files and risk points, not implementation changes.

## Resolution

The current code has two separate assumption clusters:

1. Operator-visible sources are only `messenger` and `zalo`.
2. Flutter customer chat is a hidden browser/mock path rather than an operator-visible first-party source.

This audit found about 115 retired mock-source, browser-session, browser-customer, mock-ingress, or generic-action references across backend source/tests and Flutter source/tests, plus additional docs and fixture references. The important risk points are below.

### Backend source and channel contracts

- `services/kfc-agent-backend/src/domain/types.ts`
  - `Channel` currently includes Messenger, Zalo, and their mock variants plus a retired browser/mock value; it has no `kfc` value.
  - `ConversationProfile.channel` is restricted to Messenger/Zalo only.
  - `ConversationProfile.profileSource` has Messenger/Zalo/manual values only; no first-party KFC profile source.
- `services/kfc-agent-backend/src/channels/conversationEvent.ts`
  - `ConversationEvent.channel` allows Messenger, Zalo, and retired mock sources, but not `kfc`.
- `services/kfc-agent-backend/src/session/sessionContext.ts`
  - `sessionIdForConversationEvent` prefixes only Messenger/Zalo. Any other channel returns `externalThreadId` directly, which is incompatible with canonical `kfc:<stable-id>` sessions unless changed.

### Backend route and handler assumptions

- `services/kfc-agent-backend/src/api/routes.ts`
  - Customer chat uses retired mock ingress and generic action routes; there are no first-party KFC message or GenUI action routes.
- `services/kfc-agent-backend/src/api/routeHandlers.ts`
  - `chatPayloadSchema` and `genUiActionPayloadSchema` accept only the Messenger, Zalo, and browser mock channels.
  - `chatMock` and `chatGenUiAction` run the shared graph, persist turns/events, and emit dashboard events, but they are semantically mock routes.
  - `emitSessionControlIntelligence` falls back to the retired browser/mock source when a session has no dashboard target.
  - `deliverAssistantReply` is typed around Messenger/Zalo clients and API delivery. KFC human/operator delivery needs a separate first-party app-readable turn/sync path.
  - `dashboardHumanMessage` appends a human turn but then calls `deliverAssistantReply`, so KFC cannot reuse this path until delivery is split by channel.
  - `dashboardSessions` reads summaries directly from `DashboardEventBus.listSessionSummaries`; current main can surface any session with dashboard activity, including non-Messenger/Zalo sessions.
  - `dashboardSessions` still enriches profile data only for Messenger/Zalo and derives `externalUserId` by splitting `sessionId` on `:`, so `kfc:<stable-id>` needs explicit KFC-aware metadata handling.
  - `dashboardTurns` can read arbitrary session turns directly, including `web:` and future `kfc:` sessions.
  - `deeplinkForSession` only knows Messenger and Zalo. KFC needs an explicit unavailable deeplink reason.
  - `channelTargetForSession` returns only Messenger/Zalo targets.
- `services/kfc-agent-backend/src/worker.ts`
  - Worker fetch routing exposes retired mock ingress, generic action ingress, and dashboard controls, but has no first-party KFC message or GenUI action routes.
  - Messenger history/profile sync intentionally targets only Messenger; that part should remain Messenger-only.
  - Worker human controls delegate to route handlers, so KFC unsupported-control behavior must be implemented in shared handlers and routed by Worker.

### Dashboard visibility assumptions

- Current main has no `services/kfc-agent-backend/src/dashboard/sessionVisibility.ts` helper; visibility is event-driven through `DashboardEventBus`.
- `services/kfc-agent-backend/src/dashboard/eventBus.ts`
  - `listSessionSummaries` groups any dashboard event by `sessionId`; KFC monitor visibility mainly depends on emitting typed dashboard events from KFC ingress.
- `services/kfc-agent-backend/test/api/chat.test.ts`
  - Tests currently prove the retired mock ingress emits events/turns and appears in `/dashboard/sessions`, but only through the mock route/source contract.
  - Tests also assert live/mock Messenger/Zalo channel names are rejected by that ingress.

### Persistence assumptions

- `services/kfc-agent-backend/src/persistence/memoryStore.ts`
  - `WebhookDeliveryChannel` is only Messenger/Zalo. That matches the decision that KFC must not use `webhook_deliveries`.
  - `ConversationStore.getProfile` and `profileKey` are typed through `ConversationProfile['channel']`, which currently excludes KFC.
- `services/kfc-agent-backend/src/persistence/d1Store.ts` and `services/kfc-agent-backend/src/persistence/postgresStore.ts`
  - Tables store `channel` as text and can physically hold `kfc`.
  - TypeScript row mapping currently casts rows back into `ConversationTurn` / `ConversationProfile`; the type definitions are the blocking layer.
  - `conversation_profiles` schema has `channel`, `external_user_id`, `display_name`, `avatar_url`, and `profile_source`, which is structurally compatible with KFC profiles once types and accepted profile sources are updated.
- `services/kfc-agent-backend/src/persistence/schema.sql` and `migrations/0002_conversation_profiles_and_metadata.sql`
  - No database enum blocks KFC; migration need is likely not for the channel value itself, but possibly for any new profile source constraints if added later.

### Scenario, evaluation, scripts, and fixture assumptions

- `services/kfc-agent-backend/src/scenarios/scenarioScript.ts`
  - Scenario scripts allow only Messenger, Zalo, and browser mock channels.
- `services/kfc-agent-backend/src/evaluation/contextEvalCases.ts` and `contextEvalRunner.ts`
  - Context evals are hard-coded to the retired browser/mock source.
- Backend tests under graph, GenUI, monitor, ordering, LLM, and API areas heavily use the retired browser/mock source; these are not only customer-chat tests. Implementation should distinguish product-source migration from test fixture dependency injection.
- The live replay and LangSmith proof scripts reference retired source, session-prefix, or ingress contracts; proof scripts need KFC route/source updates.
- Some `ai-talent-tracks/fnb/conversations/*.json` fixtures use the retired browser/mock source; decide whether those are historical fixtures or should migrate to `kfc`.

### Flutter customer chat assumptions

- `apps/kfc_live_monitor_flutter/lib/features/customer_chat/data/customer_chat_repository.dart`
  - Backend customer chat posts to retired mock message and generic action routes.
  - Payloads send the retired browser/mock channel.
  - No `clientMessageId` is sent for text turns or GenUI actions.
- `apps/kfc_live_monitor_flutter/lib/features/customer_chat/application/customer_chat_state.dart`
  - Default session IDs use the retired browser-based KFC-customer prefix.
  - Default customer IDs are `web_customer_...`.
  - Identity is per state creation, not durable per client install/browser profile.
- `apps/kfc_live_monitor_flutter/lib/app/kfc_customer_chat_app.dart`
  - Backend mode is controlled by `KFC_AGENT_BACKEND_URL`; missing URL uses fixture repository. That split is fine, but fixture mode should still model `kfc` as the source once contracts change.

### Flutter live monitor assumptions

- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/domain/chat_session.dart`
  - `ChatChannel` is only `messenger` and `zalo`.
  - Channel labels have no KFC case.
- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/backend_live_monitor_repository.dart`
  - `_channelFor` maps any non-Zalo channel to Messenger. A `kfc` session would display as Messenger today.
  - Summary hydration, turns, events, joinHuman, and resumeAi endpoints are otherwise session-ID based and can support `kfc` once backend returns the session and channel mapping is fixed.
  - Deeplink mapping already supports unavailable links generically, so KFC disabled deeplinks can be represented by backend response data.
- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/presentation/widgets/filter_bar.dart`
  - Channel filter options are All, Messenger, and Zalo only.
- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/presentation/widgets/session_card.dart`
  - Channel badge color/background logic is binary Messenger versus Zalo.
  - Open-chat button already disables itself when deeplink status is unavailable; KFC can reuse this once backend emits the disabled deeplink reason.
- `apps/kfc_live_monitor_flutter/test/features/live_monitor/...`
  - Repository, controller, presentation, golden, and mock repository tests only cover Messenger/Zalo channel values.

### Integration proof assumptions

- `apps/kfc_live_monitor_flutter/integration_test/customer_chat_genui_conversation_test.dart`
  - Customer-chat proof uses `web:` session IDs and `web_customer_...` customer IDs.
  - It proves GenUI lifecycle in customer chat but does not assert the session appears in the live monitor.
  - This is current mainline backend-backed coverage, but it is not an acceptable final KFC parity proof while it still exercises the old web/mock customer-chat path.
- `apps/kfc_live_monitor_flutter/integration_test/live_monitor_conversation_test.dart`
  - Live monitor proof covers primary session rendering, history, channel parity, and handoff behavior with backend-provided Messenger/Zalo-style sessions.
  - It does not yet drive a KFC customer-chat session into the monitor as a first-party source.
- `services/kfc-agent-backend/scripts/run-live-genui-integration-proof.ts`
  - Current proof runner launches `integration_test/customer_chat_genui_conversation_test.dart` and `integration_test/live_monitor_conversation_test.dart`.
  - It filters old customer-chat proof sessions by the retired browser-based KFC-customer prefix, so it needs KFC session-prefix updates once the route contract changes.
  - Do not replace this with a fake/mock-data integration path; mock data should be covered in unit, widget, or golden tests.

### Implementation risk summary for downstream tickets

- Runtime path changes are cross-cutting but mostly mechanical: add `kfc` to channel/profile/session target types, replace retired mock route contracts with KFC first-party routes, and update monitor channel mapping.
- Human/operator outbound is the non-mechanical risk. Current code assumes human messages deliver via Messenger/Zalo clients; KFC needs app-readable persisted delivery and customer app sync.
- Idempotency must move through `clientMessageId` / `externalMessageId`, not `webhook_deliveries`.
- Storage likely does not require a channel-value migration, but TypeScript profile/source types and tests do.
- Proof must combine customer chat and monitor in one backend-backed Flutter integration-test scenario; existing customer GenUI proof and monitor proof are separate and still use old source assumptions.
