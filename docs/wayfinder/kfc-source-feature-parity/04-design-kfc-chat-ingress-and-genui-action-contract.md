# Design KFC Chat Ingress And GenUI Action Contract

## Status

Closed on 2026-07-10.

## Labels

wayfinder:prototype

## Blocks

- [Define KFC Source Identity And Session Semantics](./01-define-kfc-source-identity-and-session-semantics.md)
- [Audit Source Assumptions Across Backend And Flutter](./02-audit-source-assumptions-across-backend-and-flutter.md)

## Question

What backend ingress contract should the Flutter customer chat use once it is a real `kfc` source?

Resolve:

- whether to keep the retired mock message and generic action routes, add a KFC route, or generalize to a channel-neutral customer chat route;
- how text turns and GenUI actions become normalized customer turns;
- how external message IDs, timestamps, raw event metadata, and delivery status should be represented for first-party chat;
- how the backend should persist GenUI attachments so monitor transcript replay can inspect what the customer saw;
- what behavior remains fixture-only for tests versus production-like for `kfc`.

The answer should be a contract sketch, not a code patch.

## Resolution

The Flutter customer chat should move from mock chat ingress to explicit first-party KFC ingress routes:

- `POST /chat/kfc/message`
- `POST /chat/kfc/genui-action`

Do not generalize the retired mock ingress into a channel-neutral customer route. Messenger and Zalo already have webhook-specific ingress, and KFC is a first-party app surface with different idempotency and delivery semantics. The retired mock ingress and source value should stop being part of the customer-chat product path; any remaining mocking belongs in tests, fixtures, or injected clients.

### Message request

`POST /chat/kfc/message` accepts:

```json
{
  "sessionId": "kfc:<stable-client-or-session-id>",
  "customerId": "<same stable anonymous id for this client/session>",
  "clientMessageId": "<durable client-generated id>",
  "text": "Cho mình combo gà rán",
  "sentAt": "2026-07-10T12:00:00.000Z",
  "profile": {
    "displayName": "KFC Guest",
    "avatarUrl": null
  },
  "client": {
    "platform": "flutter",
    "appVersion": "optional",
    "locale": "vi-VN"
  }
}
```

Contract rules:

- The route implies `channel/source = 'kfc'`; the client must not send a channel field.
- `sessionId` must start with `kfc:`.
- `customerId` is the same durable anonymous identity selected in the identity ticket, and it becomes `externalUserId` for persisted turns.
- `clientMessageId` becomes `externalMessageId` on the persisted customer turn.
- `sentAt` is optional client metadata. Server receive time remains the authoritative ordering time unless implementation later proves client clocks are trusted enough.
- `profile` is optional. If present, it upserts a KFC conversation profile with a first-party profile source such as `kfc_chat`.

### GenUI action request

`POST /chat/kfc/genui-action` accepts:

```json
{
  "sessionId": "kfc:<stable-client-or-session-id>",
  "customerId": "<same stable anonymous id for this client/session>",
  "clientMessageId": "<durable client-generated action id>",
  "action": {
    "attachmentId": "<assistant-genui-attachment-id>",
    "actionId": "confirm_order",
    "value": "optional display value",
    "payload": {}
  },
  "actedAt": "2026-07-10T12:00:05.000Z"
}
```

Contract rules:

- The route implies `channel/source = 'kfc'`.
- `clientMessageId` is required and is distinct from the text-message IDs.
- The backend normalizes the action to customer text using the same GenUI action normalization used today, then runs the shared graph.
- The customer action turn is persisted as a normal `role: 'user'` turn with `deliveryStatus: 'received'`.
- The action turn metadata includes `rawEvent.source = 'kfc_genui_action'`, the submitted action, the optional client action timestamp, and the referenced `attachmentId`.
- The backend should validate that the referenced attachment exists in the session transcript and that the `actionId` is one of that attachment's actions when practical. Invalid or expired action submissions should return a typed 400/409 error instead of silently becoming free text.

### Idempotency

Both routes are idempotent by `(sessionId, clientMessageId)`.

- First receipt persists the customer turn and runs the graph.
- A retry with the same `sessionId` and `clientMessageId` must not create another user turn, assistant turn, dashboard event, or tool side effect.
- A retry with the same key and same payload should return the already-created response if available.
- A retry with the same key but conflicting text/action payload should return a conflict error such as `duplicate_client_message_id`.
- Do not use `webhook_deliveries` for KFC idempotency; that table remains Messenger/Zalo delivery infrastructure.

### Normalized persistence

For KFC message and action ingress:

- Customer turns persist with `channel: 'kfc'`, `role: 'user'`, `externalUserId: customerId`, `externalMessageId: clientMessageId`, `deliveryStatus: 'received'`, and raw client metadata in `metadata.rawEvent`.
- Assistant turns persist with `channel: 'kfc'`, `role: 'assistant'`, `externalUserId: customerId`, `externalMessageId: null`, and the same generated response text returned to the customer app.
- Since KFC delivery is a first-party HTTP response, assistant delivery should not call Messenger/Zalo clients. The persisted assistant turn should be marked delivered for the first-party response path, not left permanently pending.
- Dashboard events should be emitted through the existing typed payload path: `customer_message_received` and `conversation_turn_created` for the customer turn, plus `conversation_turn_created` for the assistant turn and any graph/session update events.

### GenUI replay

Assistant GenUI attachments should be persisted as full immutable snapshots on the assistant turn metadata:

```json
{
  "genUi": {
    "id": "genui_...",
    "lifecycleStage": "...",
    "widgetKind": "orderReviewConfirm",
    "status": "active",
    "title": "...",
    "summary": "...",
    "data": {},
    "actions": []
  }
}
```

The monitor should replay what the customer saw from that assistant turn snapshot. A later customer GenUI action should not overwrite the historical assistant attachment; it should appear as a later customer action turn that references `attachmentId` and records the submitted `actionId`, `value`, and `payload`.

### Response shape

The Flutter customer chat can keep its current minimal response shape while adding IDs for sync and proof:

```json
{
  "sessionId": "kfc:<stable-client-or-session-id>",
  "customerId": "<stable customer id>",
  "userTurnId": "turn_...",
  "assistantTurnId": "turn_...",
  "responseText": "...",
  "genUi": {}
}
```

`responseText` and `genUi` remain the customer-facing fields. `userTurnId` and `assistantTurnId` are for debugging, idempotent retry responses, monitor proof, and future customer transcript sync.

### Fixture-only behavior

- Fixture Flutter repositories may return canned `CustomerChatResponse` values without HTTP, but only for unit/widget/golden-style coverage.
- Backend tests may inject mock clients and fixtures, but they should still exercise `channel: 'kfc'` for the first-party route contract.
- Flutter integration tests must not point at fixture repositories or fake/mock data paths. If an integration test remains, it must drive the current mainline backend-backed flow.
- No first-party KFC path should require or emit the retired mock-only source.
- Messenger/Zalo webhook behavior and human delivery paths remain separate from this KFC ingress contract.
