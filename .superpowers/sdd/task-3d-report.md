# Task 3D Report: Compact Messenger Queue Ingress

## Completed work

- Replaced queued Meta raw-body bytes and the provider signature header with a
  compact `kfc-messenger-ingress-claim-v1` claim.
- The HTTP ingress verifies Meta's raw-body HMAC once, normalizes the relevant
  Messenger event, and issues a domain-separated HMAC claim using the existing
  Meta app secret.
- The claim binds the tenant, channel, session, customer, surface subject,
  thread, external message, received time, normalized event evidence digest,
  queue job kind, AgentRun generation where applicable, issuance time, and
  expiry.
- The queue consumer reloads the authoritative reserved webhook delivery,
  reconstructs only the minimal normalized event, verifies the claim and every
  exact field binding, and only then registers a verified Messenger ingress
  object that can mint guest-checkout authority in the consumer isolate.
- Paused Messenger control jobs now carry only the session/message identifiers,
  the compact claim, and queue time. They no longer carry `ConversationEvent`,
  `rawEvent`, the provider payload, raw bytes, or the Meta signature.
- Agent wakeups retain generation/idempotency/retry behavior and add only the
  external message identifier plus the compact claim. Zalo wakeups remain
  compatible with the shared queue union.
- Reserved webhook storage remains the minimal replay/product envelope:
  `eventType`, `text`, and `receivedAt`, plus the existing delivery identifiers
  and status columns.
- The existing 120,000-byte application ceiling remains enforced before every
  Queue send, leaving 8,000 bytes below Cloudflare's 128,000-byte message
  ceiling.

## Fail-closed properties

- Cross-serialization verification succeeds without relying on a shared
  `WeakSet`.
- Tampered claims, wrong secrets, durable-event mismatches, queued
  session/message mismatches, generation replay, and expired claims do not
  produce verified Messenger ingress.
- The private local registration step remains inside
  `guestCheckoutAuthority.ts`; callers cannot directly register a plain object
  as verified production ingress.
- Invalid control claims are acknowledged only after marking the reserved
  delivery failed. Invalid AgentRun claims never grant guest-checkout authority;
  the authentically reserved support conversation can still run without that
  privileged authority.

## TDD evidence

### Claim security RED

Command:

```text
npm test -- --run test/security/messenger-ingress-claim.test.ts
```

Expected failure:

```text
FAIL test/security/messenger-ingress-claim.test.ts
Cannot find module '../../src/security/messengerIngressClaim.js'
```

The test was written first for serialized roundtrip, tampering, wrong secret,
event mismatch, generation replay, expiry, and bounded identifiers.

### HTTP/queue RED

Command:

```text
npm test -- --run test/worker/messenger-queue-ingress.test.ts
```

Expected failures:

```text
large body: queued 0 / failed 1, worker_queue_payload_too_large
paused control: missing externalMessageId and messengerIngressClaim
```

This reproduced the original expanded raw-body queue bug and the expanded
control-event job.

### Consumer RED

Command:

```text
npm test -- --run test/worker/messenger-queue-consumer.test.ts
```

Expected failure:

```text
FAIL test/worker/messenger-queue-consumer.test.ts
Cannot find module '../../src/workerMessengerIngress.js'
```

The test was written first for exact durable record reconstruction and
fail-closed durable text, queued identifier, and queued session mismatches.

### Focused GREEN

```text
npm test -- --run test/security/messenger-ingress-claim.test.ts \
  test/worker/messenger-queue-consumer.test.ts \
  test/worker/messenger-queue-ingress.test.ts \
  test/architecture/messenger-queue-boundary.test.ts
```

All focused tests passed. The final Task 3D suite contains 17 tests across the
claim, consumer, HTTP/queue, and architecture boundaries, in addition to the
existing exact Queue-ceiling tests.

## Final verification

From `services/kfc-agent-backend`:

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run worker:deploy:dry-run
```

Results:

- formatting: passed
- ESLint: passed with zero warnings
- TypeScript typecheck: passed
- Vitest: 27 files passed, 117 tests passed
- TypeScript build: passed
- Wrangler Worker dry-run: passed; Queue and D1 bindings were recognized

The large-body test signs an approximately 900 KB HTTP payload whose relevant
Messenger event is small. Ingress succeeds and the resulting serialized queue
job is below 4,096 bytes, with no padding, provider payload, raw event, raw
bytes, or signature field.

## Files

- `services/kfc-agent-backend/src/security/guestCheckoutAuthority.ts`
- `services/kfc-agent-backend/src/security/messengerIngressClaim.ts`
- `services/kfc-agent-backend/src/worker.ts`
- `services/kfc-agent-backend/src/workerHttp.ts`
- `services/kfc-agent-backend/src/workerMessaging.ts`
- `services/kfc-agent-backend/src/workerMessengerIngress.ts`
- `services/kfc-agent-backend/test/architecture/messenger-queue-boundary.test.ts`
- `services/kfc-agent-backend/test/security/messenger-ingress-claim.test.ts`
- `services/kfc-agent-backend/test/worker/messenger-queue-consumer.test.ts`
- `services/kfc-agent-backend/test/worker/messenger-queue-ingress.test.ts`

## Coordination

Task 3C's tracing files and its two additive lines in
`src/api/routeMessengerRuntime.ts` were preserved and are not included in the
Task 3D commit.
