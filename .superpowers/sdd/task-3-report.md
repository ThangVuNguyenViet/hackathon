## Task 3 Report: Webhook Processing, Zalo Readiness, And Failure States

### What I implemented

- Added independent Zalo readiness reporting to `/ready` alongside Messenger.
- Updated Zalo webhook processing so non-agent events are persisted as inbound transcript turns with metadata and optional profile persistence.
- Added non-agent acknowledgement delivery for Zalo events and marked webhook deliveries `processed` or `failed` based on outbound delivery result.
- Preserved inbound transcript state when Zalo outbound delivery fails because the access token is missing.
- Passed inbound event metadata through `runAgentTurn` so persisted user turns and dashboard payloads retain platform metadata.
- Added env schema and worker bindings for `ZALO_REFRESH_TOKEN`, `ZALO_APP_ID`, and `ZALO_APP_SECRET` without using refresh flow yet.
- Kept approved Task 2 channel changes intact and committed them together with Task 3 for a coherent green build surface.

### Tests run and exact results

#### RED

Command:

```bash
cd services/kfc-agent-backend
npm test -- test/api/health.test.ts test/channels/zalo-webhook.test.ts
```

Result:

- FAIL
- `health.test.ts`
  - missing `checks.zalo`
  - `/ready` returned `200` when Messenger was configured but Zalo was missing
- `zalo-webhook.test.ts`
  - unsupported/follow event path did not handle non-agent events correctly
  - persisted image event user turn lost metadata

#### GREEN

Command:

```bash
cd services/kfc-agent-backend
npm test -- test/api/health.test.ts test/channels/zalo-webhook.test.ts test/channels/messenger-webhook.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       17 passed (17)
```

### TDD Evidence: RED/GREEN

- RED: targeted readiness + Zalo webhook tests failed before implementation.
- GREEN: readiness, Zalo webhook, and Messenger webhook suites all passed after implementation.

### Files changed

- `services/kfc-agent-backend/.env.example`
- `services/kfc-agent-backend/src/api/routeHandlers.ts`
- `services/kfc-agent-backend/src/channels/conversationEvent.ts`
- `services/kfc-agent-backend/src/channels/messenger.ts`
- `services/kfc-agent-backend/src/channels/zalo.ts`
- `services/kfc-agent-backend/src/config/env.ts`
- `services/kfc-agent-backend/src/graph/buildGraph.ts`
- `services/kfc-agent-backend/src/worker.ts`
- `services/kfc-agent-backend/test/api/health.test.ts`
- `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`

### Files staged

- `services/kfc-agent-backend/.env.example`
- `services/kfc-agent-backend/src/api/routeHandlers.ts`
- `services/kfc-agent-backend/src/channels/conversationEvent.ts`
- `services/kfc-agent-backend/src/channels/messenger.ts`
- `services/kfc-agent-backend/src/channels/zalo.ts`
- `services/kfc-agent-backend/src/config/env.ts`
- `services/kfc-agent-backend/src/graph/buildGraph.ts`
- `services/kfc-agent-backend/src/worker.ts`
- `services/kfc-agent-backend/test/api/health.test.ts`
- `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`

### Commit created

- `22b325d` - `feat: process Zalo webhooks with readiness`

### Self-review findings

- No blocking issues found in the scoped Task 3 surface after the requested tests passed.
- The non-agent Zalo acknowledgement path now avoids fixture loading, which prevents follow/attachment events from failing because ordering fixtures are absent.

### Issues or concerns

- `services/kfc-agent-backend/src/graph/buildGraph.ts` was included because the Task 3 metadata plumbing lands in an already-dirty approved work area. The staged version preserves those existing changes and layers the Task 3 metadata propagation on top.

## Review Fix Follow-up

### Fixes implemented

- Emitted `customer_message_received` and `conversation_turn_created` dashboard events for non-agent Zalo inbound turns so polling clients now see the customer-side event with metadata.
- Removed the duplicate non-agent Zalo profile upsert by keeping profile persistence in the webhook path and making the non-agent helper append-only.
- Reclassified `user_send_link` as `attachment` instead of `unsupported` while still keeping it out of the agent path.
- Strengthened `test/channels/zalo-webhook.test.ts` so the non-agent follow flow fails without the inbound dashboard event emission and updated normalization expectations for Zalo link events.

### Tests run and exact results

Command:

```bash
cd services/kfc-agent-backend && npm test -- test/api/health.test.ts test/channels/zalo-webhook.test.ts test/channels/messenger-webhook.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       17 passed (17)
```

Command:

```bash
cd services/kfc-agent-backend && npx tsc --noEmit
```

Result:

```text
success
```

### Files changed/staged

- `services/kfc-agent-backend/src/api/routeHandlers.ts`
- `services/kfc-agent-backend/src/channels/zalo.ts`
- `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`
- `.superpowers/sdd/task-3-report.md`

### Commit created

- Pending during follow-up commit creation.

### Self-review

- The non-agent path now emits the same inbound dashboard event shape as agent-driven turns, including metadata.
- The link classification change is limited to normalization and does not widen agent execution beyond Zalo text events.
- No Task 4 dashboard profile/deeplink surface was added.
