# Plan Flutter KFC Source Implementation

## Status

Closed on 2026-07-10.

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
- disabled operator controls for KFC sessions;
- fixture repository updates versus backend repository updates;
- unit/widget/golden coverage for fixture and mock-data behavior;
- backend-backed Flutter integration-test updates only where the flow uses the current mainline backend path, not fake/mock data.

The answer should be execution-ready but should not implement the patch.

## Resolution

Implement Flutter KFC source support by separating first-party KFC chat identity and transport from fixture-mode behavior, then teaching the live monitor that `kfc` is a real channel with disabled operator controls.

### Ordered Flutter change list

1. Add KFC channel modeling.

   - Update `apps/kfc_live_monitor_flutter/lib/features/live_monitor/domain/chat_session.dart`:
     - add `ChatChannel.kfc`;
     - label it `KFC Chat`;
     - keep Messenger and Zalo labels unchanged.
   - Update `SortMode.channel` behavior through the existing `channel.label` comparison.
   - Update any exhaustive switches in filters, widgets, tests, and golden helpers.

2. Add monitor control availability to the domain model.

   - Add a small value to `ChatSession`, for example:
     - `bool get canJoinHuman`
     - `bool get canSendHumanMessage`
     - `bool get canResumeAi`
     - or a single `OperatorControlAvailability` value with `enabled` and `disabledReason`.
   - Default existing Messenger/Zalo sessions to enabled behavior so current tests and UI paths remain compatible.
   - KFC sessions should disable all human handoff controls with stable copy such as `KFC chat handoff disabled`.
   - This is separate from `deeplink`: KFC has disabled deeplink and disabled handoff controls, but those are different reasons and should not share one field.

3. Generate durable first-party KFC customer identity.

   - Replace the retired browser-based KFC-customer and browser-customer defaults in `CustomerChatState.initial`.
   - Default session shape:
     - `sessionId = 'kfc:<stable-id>'`
     - `customerId = '<same-stable-id>'` or another stable value backed by the same durable anonymous identity.
   - Use a durable per-client identity provider rather than only `DateTime.now()` plus a sequence.
   - For the first implementation, choose the simplest repo-appropriate persistence:
     - web: `window.localStorage` through a small platform-safe adapter;
     - non-web Flutter tests/macOS: fallback to an in-memory generated identity unless the app already has a storage abstraction.
   - Keep explicit `sessionId` and `customerId` constructor overrides for tests and integration scenarios.

4. Add client message IDs at the controller/repository boundary.

   - Extend `CustomerChatRepository.sendMessage` with `clientMessageId`.
   - Extend `CustomerChatRepository.submitGenUiAction` with `clientMessageId`.
   - Generate one stable outbound ID per local customer text turn and per GenUI action turn in `CustomerChatController`.
   - The ID must be created before optimistic UI append so retry handling can reuse it if the implementation later adds retry.
   - Suggested format:
     - `kfc_msg_<timestamp>_<counter>`
     - `kfc_action_<timestamp>_<counter>`
   - Keep UI-only message IDs separate from backend `clientMessageId` unless the implementation intentionally unifies them.

5. Move backend customer chat repository to KFC routes.

   - In `BackendCustomerChatRepository`:
     - `sendMessage` posts to `/chat/kfc/message`;
     - `submitGenUiAction` posts to `/chat/kfc/genui-action`;
     - remove the retired mock channel payload field;
     - include `clientMessageId`;
     - include optional client metadata only if useful for backend observability.
   - Preserve parsing of `responseText` and `genUi`.
   - Accept and ignore response `sessionId`, `customerId`, `userTurnId`, and `assistantTurnId` until the UI needs them.
   - Keep `FixtureCustomerChatRepository` as a local mock-data repository for widget/golden/unit coverage only.

6. Keep fixture repository KFC-shaped without making it a product source.

   - Fixture mode may continue returning canned `CustomerChatResponse` values.
   - Fixture mode should not emit the retired mock source, call retired mock ingress, or pretend to be a backend-backed KFC session.
   - Unit/widget/golden tests can keep using fixtures and mocks.
   - Do not add a fake/mock-data Flutter `integration_test`.

7. Map backend KFC sessions correctly in the live monitor repository.

   - Update `BackendLiveMonitorRepository._channelFor`:
     - if the first turn channel is `kfc`, return `ChatChannel.kfc`;
     - if no turns exist, use the session id prefix and map `kfc:` to `ChatChannel.kfc`;
     - keep Zalo and Messenger behavior unchanged.
   - Update summary-only fallback sessions so `kfc:` does not fall through to Messenger.
   - Use backend `externalUserId` and `displayName` for KFC customer identity when present; otherwise fall back to `sessionId`.
   - Keep existing sorting by `priorityRank` and controller sort modes unchanged.

8. Render KFC channel filters and badges.

   - Update `FilterBar`:
     - add a `KFC Chat` option;
     - map it to `ChatChannel.kfc`;
     - ensure `All` still includes KFC sessions.
   - Update `_channelValue` and any tests that enumerate channel options.
   - Update `_ChannelBadge`:
     - add a KFC color treatment that fits the existing operations UI;
     - do not reuse Messenger color for KFC.
   - Keep badge width/text stable so `KFC Chat` does not overflow compact session cards.

9. Preserve KFC deeplink-disabled behavior.

   - Existing `ChatDeeplink.unavailable` and `_OpenChatButton` already support disabled links and tooltips.
   - Ensure backend KFC deeplink reason is rendered as the tooltip.
   - Add tests asserting a KFC session does not call `openSession` when deeplink status is unavailable.

10. Disable KFC operator controls in UI and repository paths.

   - In `SessionCard`, use the new control availability model to suppress or disable:
     - `Join`;
     - human reply input and `Send`;
     - `Resume AI`.
   - Prefer disabled controls with clear tooltip/reason when the session status would normally show the controls, so operators can see that this is an intentional KFC limitation.
   - In `LiveMonitorController`, either:
     - guard `joinHuman`, `sendHumanMessage`, and `resumeAi` for KFC sessions before calling the repository; or
     - rely on disabled UI and backend unsupported responses, with tests proving KFC UI does not call these methods.
   - Existing Messenger/Zalo control calls must remain unchanged.

11. Add monitor transcript support for GenUI inspection.

   - Extend `ChatTurn` to carry optional GenUI metadata or a lightweight `TranscriptAttachment` value parsed from backend turn `metadata.genUi`.
   - Update `_chatTurnFromBackend` to parse assistant-turn `metadata.genUi` for all channels, including KFC.
   - In `SessionCard`, show an inspectable compact GenUI marker for turns with GenUI metadata, for example:
     - widget kind label;
     - title;
     - status;
     - selected action if present.
   - Keep transcript bubble layout stable. GenUI markers should not push card height unpredictably or hide text.
   - Full GenUI rendering in the monitor is not required for first parity unless the proof matrix later chooses it; inspection of what the customer saw is required.

12. Update dashboard event payload parsing only if backend adds new event types.

   - `DashboardEventPayload` already maps the current event set.
   - If backend KFC implementation reuses existing `customer_message_received`, `conversation_turn_created`, and `assistant_reply_sent`, no mapper change is required.
   - If backend adds a new typed event for unsupported controls or GenUI inspection, update `DashboardEventType` and regenerate `dashboard_event_payload.mapper.dart`.

13. Update customer-chat backend integration proof to KFC route/session shape.

   - In `integration_test/customer_chat_genui_conversation_test.dart`:
     - use `kfc:` session IDs;
     - use KFC customer IDs;
     - assert requests go through `BackendCustomerChatRepository`, which now uses `/chat/kfc/*`;
     - keep `KFC_AGENT_BACKEND_URL` required.
   - Do not add fixture-backed integration tests.

14. Update monitor backend integration proof only after backend KFC routes exist.

   - Extend `BackendSeedClient` in `integration_test/live_monitor_conversation_test.dart` with KFC route seeding methods:
     - `seedKfcMessage`;
     - `submitKfcGenUiAction` only if needed by the scenario.
   - Add or update a backend-backed scenario that:
     - starts in customer chat or directly seeds `/chat/kfc/message`;
     - waits for `LiveMonitorKeys.sessionCard('kfc:<id>')`;
     - sees `KFC Chat` badge/filter behavior;
     - verifies the open-chat button is disabled;
     - verifies KFC handoff controls are disabled while Messenger/Zalo handoff proof remains intact.
   - Keep the existing Messenger/Zalo backend-backed handoff scenario for regression.

15. Update unit, widget, and golden tests.

   - Customer chat:
     - default state uses `kfc:` session IDs and stable anonymous customer IDs;
     - repository request tests prove `/chat/kfc/message`, `/chat/kfc/genui-action`, `clientMessageId`, and no `channel` payload;
     - fixture repository tests remain unit/widget only.
   - Live monitor repository:
     - maps backend KFC summaries/turns to `ChatChannel.kfc`;
     - maps KFC disabled deeplink reason;
     - parses optional GenUI metadata on assistant turns;
     - preserves Messenger/Zalo mapping.
   - Controller:
     - channel filter keeps only KFC sessions;
     - channel sorting handles `KFC Chat`;
     - KFC disabled-control behavior does not call repository methods.
   - Session card:
     - renders KFC badge;
     - disables open chat with backend reason;
     - disables or suppresses handoff controls for KFC;
     - renders GenUI inspection marker.
   - Golden:
     - add one KFC session to `MockLiveMonitorRepository` or a focused golden fixture;
     - update the primary screen golden intentionally;
     - keep mock/golden data out of integration tests.

### Suggested verification commands

- `cd apps/kfc_live_monitor_flutter && flutter test test/features/customer_chat`
- `cd apps/kfc_live_monitor_flutter && flutter test test/features/live_monitor`
- `cd apps/kfc_live_monitor_flutter && flutter test test/goldens`
- Backend-backed proof only after backend KFC routes exist:
  - `cd services/kfc-agent-backend && npm run test:genui:integration`
  - `cd services/kfc-agent-backend && npm run test:live:genui:integration`

Do not use Patrol. Do not add or run fixture-backed Flutter `integration_test` paths.
