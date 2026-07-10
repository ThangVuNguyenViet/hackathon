# Design KFC Source Proof Matrix

## Status

Closed on 2026-07-10.

## Labels

wayfinder:task

## Blocks

- [Plan Backend KFC Source Implementation](./05-plan-backend-kfc-source-implementation.md)
- [Plan Flutter KFC Source Implementation](./06-plan-flutter-kfc-source-implementation.md)

## Question

What proof is required before the team can say KFC source feature parity is done?

Resolve:

- backend unit/integration tests for `kfc` source visibility, turns, events, and handoff controls;
- Flutter unit/widget/golden coverage for `kfc` channel rendering, filtering, fixture repositories, and mock-data behavior;
- backend-backed Flutter integration-test scenarios that start in customer chat, verify monitor visibility, exercise GenUI action events, and prove KFC handoff controls are disabled while Messenger/Zalo handoff behavior stays intact;
- explicit exclusion of Patrol tests and fake/mock-data Flutter integration tests;
- required commands and environment setup;
- pass/fail evidence that future agents must capture.

The answer should become the acceptance gate for implementation completion.

## Resolution

KFC source feature parity is done only when the implementation passes the matrix below on current `origin/main`. The gate is intentionally stricter than a smoke test: it must prove first-party KFC chat identity, backend persistence, monitor visibility, GenUI action handling, disabled KFC operator controls, and Messenger/Zalo regression safety.

### Hard exclusions

- Do not add, run, or document Patrol tests for this effort.
- Do not add fixture-backed or fake/mock-data Flutter `integration_test/` flows.
- Do not use retired mock source, browser-session, mock-ingress, or generic-action contracts as the KFC customer-chat proof path.
- Mock data is allowed only in normal unit, widget, and golden tests.

### Backend proof matrix

1. Source and route contracts.

   Required tests:

   - `Channel` and related event/profile types accept `kfc`.
   - Fastify and Worker both expose `POST /chat/kfc/message` and `POST /chat/kfc/genui-action`.
   - KFC request schemas reject client-supplied channel/source values.
   - KFC request schemas require `sessionId` with `kfc:` prefix and require `clientMessageId`.
   - Existing Messenger and Zalo webhook routes keep their current behavior.

   Suggested coverage locations:

   - `services/kfc-agent-backend/test/domain/contracts.test.ts`
   - `services/kfc-agent-backend/test/api/chat.test.ts`
   - `services/kfc-agent-backend/test/worker/worker.test.ts`

2. Persistence, idempotency, and dashboard events.

   Required tests:

   - `POST /chat/kfc/message` appends a customer turn with `channel: 'kfc'`.
   - `clientMessageId` is persisted as the backend `externalMessageId`.
   - `customerId` and `externalUserId` use the same stable anonymous identity for anonymous KFC chat.
   - Replaying the same `(sessionId, clientMessageId)` returns the original result or a typed duplicate response without running the graph twice.
   - Assistant turns returned through first-party HTTP are not left with pending webhook delivery state; they are marked sent or equivalent first-party delivered status.
   - `customer_message_received`, `conversation_turn_created`, `assistant_reply_sent`, and any GenUI/action event remain typed and visible through dashboard APIs/SSE.
   - `/dashboard/sessions`, `/dashboard/events/:sessionId`, and `/dashboard/sessions/:sessionId/turns` show KFC sessions and turns.

   Suggested coverage locations:

   - `services/kfc-agent-backend/test/api/chat.test.ts`
   - `services/kfc-agent-backend/test/persistence/memory-store.test.ts`
   - `services/kfc-agent-backend/test/persistence/d1-store.test.ts`
   - `services/kfc-agent-backend/test/runtime/runtime-source-guard.test.ts`

3. GenUI action contract.

   Required tests:

   - `POST /chat/kfc/genui-action` validates `sessionId`, `clientMessageId`, `attachmentId`, `actionId`, and action payload shape.
   - KFC GenUI actions append a user/action turn with `channel: 'kfc'`.
   - Assistant GenUI attachments are persisted on turn metadata as immutable snapshots.
   - The dashboard turns endpoint exposes enough GenUI metadata for monitor inspection.
   - Invalid or stale attachment/action IDs fail with a typed 4xx response where validation is practical.

   Suggested coverage locations:

   - `services/kfc-agent-backend/test/genui/kfc-genui-action.test.ts`
   - `services/kfc-agent-backend/test/genui/kfc-genui-selector.test.ts`
   - `services/kfc-agent-backend/test/graph/ai-tool-graph.test.ts`

4. KFC human control disablement.

   Required tests:

   - `POST /dashboard/sessions/kfc:<id>/human-join` rejects or returns typed unsupported-channel status.
   - `POST /dashboard/sessions/kfc:<id>/human-message` rejects with a stable unsupported KFC error and does not append/deliver a human turn.
   - `POST /dashboard/sessions/kfc:<id>/resume-ai` rejects or no-ops with a typed unsupported KFC response and does not resume a KFC human loop.
   - Messenger/Zalo human join, human message, and resume AI tests remain green.

   Suggested coverage locations:

   - `services/kfc-agent-backend/test/api/human-takeover.test.ts`
   - `services/kfc-agent-backend/test/worker/worker.test.ts`

### Flutter unit, widget, and golden proof matrix

1. Customer chat.

   Required tests:

   - `CustomerChatState.initial` creates durable `kfc:` sessions by default.
   - Anonymous KFC `customerId` and `externalUserId` are backed by the same stable client identity.
   - `CustomerChatController` creates one `clientMessageId` for each text turn and GenUI action before optimistic append.
   - `BackendCustomerChatRepository.sendMessage` posts to `/chat/kfc/message` with no `channel` field.
   - `BackendCustomerChatRepository.submitGenUiAction` posts to `/chat/kfc/genui-action` with no `channel` field.
   - Fixture repositories remain available for unit/widget/golden tests but do not claim to be a backend KFC source.

   Suggested coverage locations:

   - `apps/kfc_live_monitor_flutter/test/features/customer_chat/application/customer_chat_controller_test.dart`
   - `apps/kfc_live_monitor_flutter/test/features/customer_chat/domain/kfc_genui_models_test.dart`
   - `apps/kfc_live_monitor_flutter/test/features/customer_chat/presentation/customer_chat_screen_test.dart`
   - `apps/kfc_live_monitor_flutter/test/features/customer_chat/presentation/kfc_genui_renderer_test.dart`

2. Live monitor modeling and repository parsing.

   Required tests:

   - `ChatChannel.kfc` exists and labels as `KFC Chat`.
   - KFC summaries and turns map to `ChatChannel.kfc` from either backend turn channel or `kfc:` session prefix.
   - KFC sessions never fall through to Messenger.
   - KFC disabled deeplink reason maps to `ChatDeeplink.unavailable`.
   - Assistant turn `metadata.genUi` parses into monitor transcript inspection metadata.
   - `DashboardEventPayload` remains typed for any new event shapes.

   Suggested coverage locations:

   - `apps/kfc_live_monitor_flutter/test/features/live_monitor/data/backend_live_monitor_repository_test.dart`
   - `apps/kfc_live_monitor_flutter/test/features/live_monitor/data/dashboard_event_payload_test.dart`
   - `apps/kfc_live_monitor_flutter/test/features/live_monitor/application/live_monitor_controller_test.dart`

3. Live monitor UI and goldens.

   Required tests:

   - Filter bar includes `KFC Chat`; `All` still includes KFC.
   - Channel sorting handles `KFC Chat`.
   - Session cards render a distinct KFC badge without overflow.
   - Open-chat/deeplink button is disabled for KFC and does not call `openSession`.
   - KFC human join, human message, and resume controls are disabled or suppressed with a stable reason.
   - Messenger/Zalo controls still work in existing widget tests.
   - Session card transcript shows compact GenUI inspection metadata.
   - Primary live monitor golden includes at least one KFC card and intentionally updated baselines.

   Suggested coverage locations:

   - `apps/kfc_live_monitor_flutter/test/features/live_monitor/presentation/live_monitor_screen_test.dart`
   - `apps/kfc_live_monitor_flutter/test/features/live_monitor/presentation/session_card_test.dart`
   - `apps/kfc_live_monitor_flutter/test/features/live_monitor/data/mock_live_monitor_repository_test.dart`
   - `apps/kfc_live_monitor_flutter/test/goldens/live_monitor/live_monitor_golden_test.dart`

### Backend-backed Flutter integration proof

The final integration proof must run through the real backend in `services/kfc-agent-backend`, not through fixture repositories.

Required integration scenarios:

1. Customer-chat KFC scenario replay.

   - Run `apps/kfc_live_monitor_flutter/integration_test/customer_chat_genui_conversation_test.dart` against a backend URL supplied by `KFC_AGENT_BACKEND_URL`.
   - Use `kfc:` session IDs and KFC customer IDs.
   - Send customer turns through `BackendCustomerChatRepository`, which must call `/chat/kfc/message`.
   - Submit at least one GenUI action through `/chat/kfc/genui-action`.
   - Capture screenshots for the current GenUI scenario capture plan.

2. Customer-chat-to-monitor parity scenario.

   - Add one backend-backed integration target that starts by sending a customer message from the KFC customer chat UI or controller.
   - Then open the monitor UI against the same backend process.
   - Verify the created `kfc:` session appears in the default monitor grid.
   - Verify `KFC Chat` badge/filter behavior.
   - Verify transcript text and compact GenUI metadata are visible.
   - Verify the open-chat/deeplink button is disabled with the backend reason.
   - Verify KFC human join, human message, and resume controls are disabled or unavailable.

3. Messenger/Zalo regression scenario.

   - Keep the existing backend-backed `live_monitor_conversation_test.dart` coverage for Messenger and Zalo display names/history.
   - Keep the Messenger angry handoff scenario proving human join and resume AI still work for supported channels.
   - Do not use the Messenger/Zalo handoff scenario as evidence that KFC handoff works; KFC handoff must stay disabled.

The existing `run-live-genui-integration-proof.ts` runner should be updated so its dashboard telemetry searches for `kfc:` sessions, not the retired browser-based KFC-customer prefix, and so the manifest fails if expected KFC dashboard telemetry is missing.

### Required commands

Run these from a clean, current main-based checkout after implementation.

Backend:

```bash
cd services/kfc-agent-backend
npm test -- --maxWorkers=1 --no-file-parallelism
```

Flutter unit/widget/golden:

```bash
cd apps/kfc_live_monitor_flutter
flutter test test/features/customer_chat
flutter test test/features/live_monitor
flutter test test/goldens
```

Backend-backed Flutter integration proof:

```bash
cd services/kfc-agent-backend
npm run test:genui:integration
npm run test:live:genui:integration
```

Environment:

- `OPENAI_API_KEY` must be available through the shell or repo `.env` for live GenUI proof.
- `KFC_GENUI_FLUTTER_DEVICE` may override the default `macos` integration device.
- `KFC_GENUI_SCREENSHOT_DIR` may override screenshot output location.
- Manual Flutter integration runs must pass `--dart-define=KFC_AGENT_BACKEND_URL=<backend-url>`.

### Required evidence

Completion evidence must include:

- backend test command and exit status;
- Flutter unit/widget/golden command exit statuses;
- integration proof command exit statuses;
- `artifacts/genui-live-proof/<runId>/integration-test/manifest.json` with:
  - `passed: true`;
  - `liveAi: true`;
  - screenshot entries all `exists: true`;
  - dashboard telemetry containing at least one `kfc:` session;
  - KFC turns with assistant GenUI metadata where the scenario expects it;
- `artifacts/genui-live-proof/<runId>/integration-test/catalog.md` with rendered customer-chat screenshots;
- a grep guard showing the KFC app/proof path no longer references legacy mock source names:

Run the owned-surface legacy-source guard across the KFC customer-chat app,
integration proof, and backend proof runner.

The grep guard should return no matches for the KFC customer-chat app and integration proof path. Backend legacy tests may keep old mock-route coverage only if the first-party KFC route and proof path do not depend on it.
