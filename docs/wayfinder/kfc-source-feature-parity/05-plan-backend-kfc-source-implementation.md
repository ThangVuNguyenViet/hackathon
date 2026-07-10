# Plan Backend KFC Source Implementation

## Status

Closed on 2026-07-10.

## Labels

wayfinder:task

## Blocks

- [Decide Monitor Parity For KFC Source](./03-decide-monitor-parity-for-kfc-source.md)
- [Design KFC Chat Ingress And GenUI Action Contract](./04-design-kfc-chat-ingress-and-genui-action-contract.md)

## Question

What is the backend implementation plan for adding `kfc` source support without regressing Messenger or Zalo?

Resolve the ordered change list for:

- domain types and validators;
- session target parsing and dashboard visibility;
- route handlers and normalized ingress;
- dashboard events, session summaries, turns, profiles, and deeplink behavior;
- disabled or unsupported human takeover/resume behavior for `kfc`;
- D1/Postgres/memory persistence expectations;
- backend test updates and new regression tests.

The answer should be execution-ready but should not implement the patch.

## Resolution

Implement backend KFC source support as a small first-party ingress layer over the existing graph and persistence primitives. Do not route KFC through `/chat/mock`, `web_mock`, Messenger/Zalo webhook delivery, or `webhook_deliveries`.

### Ordered backend change list

1. Add `kfc` to source/channel types.

   - Update `services/kfc-agent-backend/src/domain/types.ts`:
     - `Channel` includes `'kfc'`.
     - `ConversationProfile.channel` includes `'kfc'`.
     - `ConversationProfile.profileSource` includes `'kfc_chat'`.
   - Keep `PendingCustomerTurn.channel` and `AgentRun.channel` Messenger/Zalo-only for the first release unless the implementation intentionally ports the interruption queue to KFC. The KFC contract is synchronous first-party HTTP, not webhook queue delivery.
   - Update `services/kfc-agent-backend/src/channels/conversationEvent.ts` only if KFC ingress is normalized through `ConversationEvent`; the simpler first implementation can bypass `ConversationEvent` and call a KFC-specific route helper directly.

2. Add explicit KFC ingress schemas and handlers.

   - In `services/kfc-agent-backend/src/api/routeHandlers.ts`, add schemas for:
     - `POST /chat/kfc/message`
     - `POST /chat/kfc/genui-action`
   - Required fields:
     - `sessionId`, with `kfc:` prefix validation.
     - `customerId`.
     - `clientMessageId`.
     - `text` for message ingress.
     - `action.attachmentId`, `action.actionId`, optional `action.value`, optional `action.payload` for GenUI action ingress.
   - Optional fields:
     - `sentAt` or `actedAt`.
     - `profile.displayName`, `profile.avatarUrl`.
     - `client.platform`, `client.appVersion`, `client.locale`.
   - The route implies `channel: 'kfc'`; reject any client-supplied `channel` field instead of accepting it.

3. Register routes in both server runtimes.

   - Add Fastify routes in `services/kfc-agent-backend/src/api/routes.ts`:
     - `server.post('/chat/kfc/message', ...)`
     - `server.post('/chat/kfc/genui-action', ...)`
   - Add matching Worker fetch routes in `services/kfc-agent-backend/src/worker.ts`.
   - Leave `/chat/mock` and `/chat/genui-action` available only for existing tests/tools until the implementation intentionally migrates those callers.

4. Extract a KFC first-party turn helper.

   - Add a shared internal helper in `routeHandlers.ts`, or a small new module if the file becomes too large, that accepts normalized KFC input:
     - `sessionId`
     - `customerId`
     - `clientMessageId`
     - `text`
     - optional metadata
   - It should:
     - validate `sessionId.startsWith('kfc:')`;
     - upsert optional KFC profile with `profileSource: 'kfc_chat'`;
     - enforce idempotency before calling `runAgentTurn`;
     - call `runAgentTurn({ channel: 'kfc', externalMessageId: clientMessageId, ... })`;
     - mark the returned assistant turn as delivered through the first-party HTTP path.

5. Implement KFC idempotency before graph execution.

   - Use `store.findTurnByExternalMessage(sessionId, clientMessageId)` as the first lookup.
   - If no existing customer turn exists, proceed with `runAgentTurn`.
   - If an existing turn exists with the same normalized payload, do not run the graph again. Return the already-created assistant response if available.
   - If an existing turn conflicts with the new payload, return a typed conflict response such as:
     - HTTP `409`
     - `errorCode: 'duplicate_client_message_id'`
   - Avoid relying on `runAgentTurn`'s existing duplicate user-turn behavior alone, because it can still create a second assistant turn and repeated side effects after it sees an existing customer turn.

6. Persist KFC message turns with normalized metadata.

   - Customer text turn:
     - `channel: 'kfc'`
     - `role: 'user'`
     - `externalMessageId: clientMessageId`
     - `externalUserId: customerId`
     - `deliveryStatus: 'received'`
     - `metadata.rawEvent.source: 'kfc_message'`
     - include optional `sentAt`, `client`, and original request metadata.
   - GenUI action turn:
     - same turn shape, but `text` comes from `normalizeGenUiActionToText(action)`;
     - `metadata.rawEvent.source: 'kfc_genui_action'`;
     - include submitted `action`, `actedAt`, and `attachmentId`.

7. Validate GenUI action submissions.

   - Before running the graph for `/chat/kfc/genui-action`, read session turns and find an assistant turn whose `metadata.genUi.id` equals `action.attachmentId`.
   - If missing, return `404` or `409` with a typed error such as `genui_attachment_not_found`.
   - If the action is not present in that attachment's `actions`, return `400` with `invalid_genui_action`.
   - If the attachment status is expired/blocked when that is represented, return `409` with `genui_attachment_not_actionable`.
   - Do not mutate the historical assistant GenUI attachment. The customer action becomes a new user turn referencing it.

8. Mark first-party assistant delivery explicitly.

   - `runAgentTurn` currently creates assistant turns with `deliveryStatus: 'pending'`.
   - For KFC HTTP ingress, after `runAgentTurn` returns, call `store.updateTurnDeliveryStatus(output.assistantTurnId, 'sent', null)`.
   - Emit an `assistant_reply_sent` dashboard event with `deliveryStatus: 'sent'` and a payload marker such as `deliveryPath: 'kfc_http_response'`.
   - Do not call `deliverAssistantReply`, Messenger clients, Zalo clients, or webhook-delivery status methods.

9. Return a customer-app response.

   - Response body should include:
     - `sessionId`
     - `customerId`
     - `userTurnId`
     - `assistantTurnId`
     - `responseText`
     - optional `genUi`
   - Preserve the existing `responseText` and `genUi` shape that Flutter already consumes.
   - On idempotent retry, return the same response shape from persisted turns when possible.

10. Make dashboard summary metadata KFC-aware.

   - Current main's `DashboardEventBus.listSessionSummaries` already groups any session with dashboard events.
   - Update `dashboardSessions` enrichment in `routeHandlers.ts`:
     - detect `channel === 'kfc'`;
     - use `store.getProfile('kfc', externalUserId)` when available;
     - derive `externalUserId` from the KFC profile/turn data rather than blindly trusting `sessionId.split(':', 2)` if the stable session id can diverge from customer id.
   - Keep Messenger history sync gated to Messenger sessions only.

11. Add KFC deeplink and disabled-control behavior.

   - Update `channelTargetForSession` or introduce a safer session parser that can return:
     - Messenger target
     - Zalo target
     - KFC target
     - unknown
   - Update `deeplinkForSession` so `kfc:` returns:
     - `status: 'unavailable'`
     - `url: null`
     - `reason: 'KFC chat deeplink disabled'` or equivalent stable copy.
   - Update `dashboardHumanJoin`, `dashboardHumanMessage`, and `dashboardResumeAi`:
     - if the session is `kfc:`, return a typed unsupported response and do not change `session_controls`;
     - suggested status: `409` for unsupported state transition or `400` if the existing API convention prefers bad request;
     - suggested error codes: `unsupported_kfc_human_join`, `unsupported_kfc_human_message`, `unsupported_kfc_resume_ai`.
   - Ensure Messenger/Zalo behavior is unchanged.

12. Persistence expectations.

   - D1/Postgres/memory stores already store `channel`, `external_user_id`, `external_message_id`, `delivery_status`, and metadata as text/json values without database enums blocking `kfc`.
   - No channel-value migration is required for new KFC rows.
   - Type-level updates are required in row mappings and profile method signatures once `ConversationProfile.channel` includes `kfc`.
   - Do not add KFC to `WebhookDeliveryChannel`.
   - Do not add KFC to `webhook_deliveries`.
   - Consider a follow-up cleanup after implementation if old `web:` proof rows need migration or archival; that is not required for first KFC source support.

13. Keep mock behavior in test-only surfaces.

   - Existing graph/unit tests may continue to use injected mock clients while they are being migrated.
   - New product-path tests for KFC should use `channel: 'kfc'` and `/chat/kfc/*`.
   - Do not add new backend product behavior that requires `web_mock`.

### Backend test plan

Add or update tests in this order:

1. Domain/type contract tests.

   - `Channel` accepts `kfc`.
   - `ConversationProfile` can use `channel: 'kfc'` and `profileSource: 'kfc_chat'`.
   - `WebhookDeliveryChannel` remains Messenger/Zalo-only.

2. Fastify API tests in `services/kfc-agent-backend/test/api/chat.test.ts` or a new `kfc-chat.test.ts`.

   - `POST /chat/kfc/message` rejects missing `clientMessageId`.
   - `POST /chat/kfc/message` rejects non-`kfc:` session IDs.
   - `POST /chat/kfc/message` rejects a submitted `channel` field.
   - Successful message:
     - appends user and assistant turns with `channel: 'kfc'`;
     - stores `clientMessageId` as `externalMessageId`;
     - marks the assistant turn `deliveryStatus: 'sent'`;
     - emits dashboard events;
     - appears in `/dashboard/sessions`;
     - has disabled KFC deeplink data.
   - Idempotent retry with same payload returns without creating duplicate turns/events/tool side effects.
   - Idempotent retry with conflicting text returns `duplicate_client_message_id`.

3. GenUI action API tests.

   - Rejects missing or unknown `attachmentId`.
   - Rejects unknown `actionId`.
   - Successful action:
     - normalizes action to text;
     - persists raw action metadata;
     - leaves the original assistant GenUI snapshot unchanged;
     - returns the next assistant response.

4. Dashboard control tests.

   - `POST /dashboard/sessions/kfc%3A.../human-join` returns unsupported and leaves session control unchanged.
   - `POST /dashboard/sessions/kfc%3A.../human-message` returns unsupported and creates no human turn.
   - `POST /dashboard/sessions/kfc%3A.../resume-ai` returns unsupported and does not trigger recovery.
   - Existing Messenger/Zalo control tests continue passing.

5. Worker routing tests in `services/kfc-agent-backend/test/worker/worker.test.ts`.

   - Worker serves `/chat/kfc/message`.
   - Worker serves `/chat/kfc/genui-action`.
   - Worker returns the same unsupported behavior for KFC dashboard controls as Fastify.

6. Store tests.

   - Memory, D1, and Postgres profile tests cover `channel: 'kfc'`.
   - Conversation turn tests cover `channel: 'kfc'` and `externalMessageId = clientMessageId`.
   - Existing webhook delivery tests verify KFC is not accepted as a webhook delivery channel.

### Suggested verification commands

- `cd services/kfc-agent-backend && npm test -- --maxWorkers=1 --no-file-parallelism test/api/kfc-chat.test.ts`
- `cd services/kfc-agent-backend && npm test -- --maxWorkers=1 --no-file-parallelism test/worker/worker.test.ts`
- `cd services/kfc-agent-backend && npm test -- --maxWorkers=1 --no-file-parallelism`

Use the repo's serial Vitest fallback if parallelism causes memory pressure.
