## What I implemented

- Added the Task 2 Zalo webhook tests for image events and broader non-text event normalization in `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`.
- Extended `ConversationEvent` in `services/kfc-agent-backend/src/channels/conversationEvent.ts` with:
  - `platformEventName`
  - `attachments`
  - `profile`
  - `shouldRunAgent`
  - `acknowledgementText`
  - `rawEvent`
  - expanded `eventType` to include `attachment`, `follow`, and `unsupported`
- Updated Messenger normalization in `services/kfc-agent-backend/src/channels/messenger.ts` to populate Task 2 fields:
  - `platformEventName: 'message'`
  - `shouldRunAgent: true`
  - `rawEvent`
- Reworked Zalo normalization in `services/kfc-agent-backend/src/channels/zalo.ts` to:
  - accept sender name/avatar and message attachments
  - normalize attachments into `ConversationAttachment`
  - preserve `platformEventName`
  - emit `profile` from webhook sender data
  - classify events as `message`, `attachment`, `follow`, or `unsupported`
  - set `shouldRunAgent` only for text events
  - provide text-only acknowledgement copy for non-text events
  - preserve `rawEvent`

## Tests run and exact results

1. Pre-red baseline before adding new tests:

```bash
cd services/kfc-agent-backend
npm test -- test/channels/zalo-webhook.test.ts
```

Result:

```text
✓ test/channels/zalo-webhook.test.ts (2 tests) 244ms
Test Files  1 passed (1)
Tests  2 passed (2)
```

2. RED after adding the Task 2 tests, before implementation:

```bash
cd services/kfc-agent-backend
npm test -- test/channels/zalo-webhook.test.ts
```

Result:

```text
❯ test/channels/zalo-webhook.test.ts (4 tests | 2 failed)
× records a Zalo image event without running order tools
  expected received: 1 processed: 1, got received: 0 processed: 0
× normalizes Zalo link, file, sticker, audio, location, follow, and unsupported events
  expected received: 1, got received: 0
```

3. Post-implementation Task 2 state:

```bash
cd services/kfc-agent-backend
npm test -- test/channels/zalo-webhook.test.ts
```

Result:

```text
❯ test/channels/zalo-webhook.test.ts (4 tests | 2 failed)
✓ normalizes a Zalo OA text event and runs the agent turn
× acknowledges unsupported Zalo events without running unsafe order actions
  expected { received: 0, processed: 0, skippedDuplicates: 0, failed: 0 }
  received { received: 1, processed: 0, skippedDuplicates: 0, failed: 1 }
× records a Zalo image event without running order tools
  expected first stored user turn metadata.platformEventName and metadata.attachments
  received metadata: null
✓ normalizes Zalo link, file, sticker, audio, location, follow, and unsupported events
```

## TDD Evidence

- `RED`: confirmed after adding the new Task 2 tests and before implementation.
- `EXPECTED-RED`: confirmed after Task 2 implementation because Task 3 route handling is not yet added.

## Files changed

- `services/kfc-agent-backend/src/channels/conversationEvent.ts`
- `services/kfc-agent-backend/src/channels/messenger.ts`
- `services/kfc-agent-backend/src/channels/zalo.ts`
- `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`

## Self-review findings

- The normalization layer now produces the Task 2 event contract for Zalo and Messenger.
- The remaining failures are consistent with the brief:
  - route handling still tries to run agent/delivery flows for non-agent events
  - user turn persistence still stores `metadata: null` for webhook-created turns
- No unrelated files were edited.
- No commit was created, per the brief.

## Any issues or concerns

- The legacy test `acknowledges unsupported Zalo events without running unsafe order actions` now fails because webhook routes count the normalized follow event and still attempt downstream processing. That is a Task 3 route-layer gap, not a Task 2 normalization bug.
- The new image-event test still fails because route handling has not yet persisted `platformEventName` / `attachments` onto the stored user turn metadata. That is also explicitly deferred to Task 3.

## Fix section

Commands run:

```bash
cd services/kfc-agent-backend && npm test -- test/channels/zalo-webhook.test.ts
cd services/kfc-agent-backend && npx tsc --noEmit
```

Results:

- `npm test -- test/channels/zalo-webhook.test.ts` passed 2 tests and failed 2 tests. The remaining failures were the expected Task 3 route-level deferrals:
  - `acknowledges unsupported Zalo events without running unsafe order actions`
  - `records a Zalo image event without running order tools`
- `npx tsc --noEmit` passed with no TypeScript errors.
