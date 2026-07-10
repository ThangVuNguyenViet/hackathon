# Audit Source Assumptions Across Backend And Flutter

## Status

Closed on 2026-07-10.

## Labels

wayfinder:research

## Blocks

None.

## Question

Where does the current code assume that operator-visible conversation sources are only Messenger and Zalo, or that Flutter customer chat is only `web` or `web_mock`?

Audit at least:

- backend channel/source unions and validators;
- session ID helpers and dashboard session visibility;
- persistence schemas and profile lookup keys;
- route handlers for chat, GenUI actions, dashboard events, dashboard sessions, human join, human messages, and AI resume;
- live monitor Flutter `ChatChannel`, filters, repository mapping, session cards, deeplinks, and tests;
- Patrol customer-chat and monitor proof scenarios.

The answer should list concrete files and risk points, not implementation changes.

## Resolution

The current code has two separate assumption clusters:

1. Operator-visible sources are only `messenger` and `zalo`.
2. Flutter customer chat is a hidden `web` / `web_mock` path rather than an operator-visible first-party source.

This audit found about 115 `web_mock`, `web:`, `web_customer`, `/chat/mock`, or `/chat/genui-action` references across backend source/tests and Flutter source/tests, plus additional docs and fixture references. The important risk points are below.

### Backend source and channel contracts

- `services/kfc-agent-backend/src/domain/types.ts`
  - `Channel` is currently `'messenger' | 'zalo' | 'messenger_mock' | 'zalo_mock' | 'web_mock'`; it has no `kfc` value.
  - `ConversationProfile.channel` is restricted to Messenger/Zalo only.
  - `ConversationProfile.profileSource` has Messenger/Zalo/manual values only; no first-party KFC profile source.
- `services/kfc-agent-backend/src/channels/conversationEvent.ts`
  - `ConversationEvent.channel` allows Messenger/Zalo/mock/web_mock, but not `kfc`.
- `services/kfc-agent-backend/src/session/sessionContext.ts`
  - `sessionIdForConversationEvent` prefixes only Messenger/Zalo. Any other channel returns `externalThreadId` directly, which is incompatible with canonical `kfc:<stable-id>` sessions unless changed.

### Backend route and handler assumptions

- `services/kfc-agent-backend/src/api/routes.ts`
  - Customer chat routes are `/chat/mock` and `/chat/genui-action`; there are no `/chat/kfc/message` or `/chat/kfc/genui-action` routes.
- `services/kfc-agent-backend/src/api/routeHandlers.ts`
  - `chatPayloadSchema` and `genUiActionPayloadSchema` require `channel: 'web_mock'`.
  - `chatMock` and `chatGenUiAction` run the shared graph, persist turns/events, and emit dashboard events, but they are semantically mock routes.
  - `emitSessionControlIntelligence` falls back to `web_mock` when a session has no dashboard target.
  - `deliverAssistantReply` is typed around Messenger/Zalo clients and API delivery. KFC human/operator delivery needs a separate first-party app-readable turn/sync path.
  - `dashboardHumanMessage` appends a human turn but then calls `deliverAssistantReply`, so KFC cannot reuse this path until delivery is split by channel.
  - `dashboardSessions` filters summaries through `dashboardSessionTarget`, which currently hides non-Messenger/Zalo sessions.
  - `dashboardTurns` can read arbitrary session turns directly, including `web:` sessions, but those sessions do not appear in `/dashboard/sessions`.
  - `deeplinkForSession` only knows Messenger and Zalo. KFC needs an explicit unavailable deeplink reason.
  - `channelTargetForSession` returns only Messenger/Zalo targets.
- `services/kfc-agent-backend/src/worker.ts`
  - Worker dashboard summary code also filters through `dashboardSessionTarget`.
  - Messenger history/profile sync intentionally targets only Messenger; that part should remain Messenger-only.
  - `channelTargetForWorkerSession` returns only Messenger/Zalo, so Worker human controls and deeplink logic need KFC-aware behavior.

### Dashboard visibility assumptions

- `services/kfc-agent-backend/src/dashboard/sessionVisibility.ts`
  - `DashboardSessionTarget.channel` is only `'messenger' | 'zalo'`.
  - `dashboardSessionTarget` returns targets only for `messenger:` and `zalo:` session IDs.
- `services/kfc-agent-backend/test/dashboard/session-visibility.test.ts`
  - Tests explicitly assert `web_mock:` and `web:` sessions are hidden from the operator dashboard. This must invert for `kfc:`.
- `services/kfc-agent-backend/test/api/chat.test.ts`
  - Tests currently prove the existing gap: `/chat/mock` emits events/turns but `/dashboard/sessions` remains empty for `plain_session` and `web:customer_api`.
  - Tests also assert live/mock Messenger/Zalo channel names are rejected by `/chat/mock`.

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
  - Scenario scripts allow only `messenger_mock`, `zalo_mock`, and `web_mock`.
- `services/kfc-agent-backend/src/evaluation/contextEvalCases.ts` and `contextEvalRunner.ts`
  - Context evals are hard-coded to `web_mock`.
- Backend tests under graph, GenUI, monitor, ordering, LLM, and API areas heavily use `web_mock`; these are not only customer-chat tests. Implementation should distinguish product-source migration from test fixture dependency injection.
- `services/kfc-agent-backend/scripts/run-live-ai-replay.ts`, `run-live-genui-patrol-proof.ts`, and `run-langsmith-context-baseline.ts` reference `web_mock` or `/chat/mock`; proof scripts need KFC route/source updates.
- Some `ai-talent-tracks/fnb/conversations/*.json` fixtures use `web_mock`; decide whether those are historical fixtures or should migrate to `kfc`.

### Flutter customer chat assumptions

- `apps/kfc_live_monitor_flutter/lib/features/customer_chat/data/customer_chat_repository.dart`
  - Backend customer chat posts to `/chat/mock` and `/chat/genui-action`.
  - Payloads send `channel: 'web_mock'`.
  - No `clientMessageId` is sent for text turns or GenUI actions.
- `apps/kfc_live_monitor_flutter/lib/features/customer_chat/application/customer_chat_state.dart`
  - Default session IDs are `web:kfc-customer-...`.
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

### Patrol and proof assumptions

- `apps/kfc_live_monitor_flutter/patrol_test/customer_chat_genui_conversation_test.dart`
  - Patrol customer-chat proof uses `web:` session IDs and `web_customer_...` customer IDs.
  - It proves GenUI lifecycle in customer chat but does not assert the session appears in the live monitor.
- `apps/kfc_live_monitor_flutter/patrol_test/live_monitor_channel_parity_test.dart`
  - Channel parity proof covers Messenger and Zalo display/history/deeplink behavior only.
- `apps/kfc_live_monitor_flutter/patrol_test/api_clients/live_monitor_history_client.dart`
  - Test API client fixtures are Messenger/Zalo-only and include Messenger deeplink assertions.

### Implementation risk summary for downstream tickets

- Runtime path changes are cross-cutting but mostly mechanical: add `kfc` to channel/profile/session target types, replace `web_mock` route contracts with KFC first-party routes, and update monitor channel mapping.
- Human/operator outbound is the non-mechanical risk. Current code assumes human messages deliver via Messenger/Zalo clients; KFC needs app-readable persisted delivery and customer app sync.
- Idempotency must move through `clientMessageId` / `externalMessageId`, not `webhook_deliveries`.
- Storage likely does not require a channel-value migration, but TypeScript profile/source types and tests do.
- Proof must combine customer chat and monitor in one Patrol scenario; existing customer GenUI proof and monitor channel parity proof are separate.
