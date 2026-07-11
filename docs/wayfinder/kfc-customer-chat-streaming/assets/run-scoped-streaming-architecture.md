# Run-Scoped Streaming Across Flutter And Backend Targets

Research snapshot: Flutter 3.41.9, Dart 3.11.5, `http` 1.6.0, Fastify 5.4.x, Wrangler 4.108.x, Cloudflare Worker compatibility date 2026-07-08, inspected in the current shared checkout on 2026-07-11.

## Decision

Use a two-step, replay-first run protocol:

1. An idempotent POST creates or returns a durable KFC customer-chat run and queues its execution.
2. Flutter opens an authenticated run-scoped SSE GET that first replays persisted events after its cursor and then tails new persisted events until a terminal outcome.

The event log is authoritative. SSE is only a delivery view over that log. Execution is independent of the stream connection, so connection loss never cancels or supersedes a run.

For the canonical Cloudflare deployment, execute accepted runs through a dedicated queue job with an atomic D1 run claim. For local Fastify, use the same run repository and scheduler abstraction with immediate in-process dispatch plus startup/recovery scanning. Both targets expose the same HTTP and event contracts.

Use `package:http` `StreamedResponse` in Flutter rather than browser `EventSource`. The repo's locked `http` 1.6.0 implementation streams response bodies on both `BrowserClient` and `IOClient`, supports abortable requests, and lets web and native clients share authorization, explicit cursor, parsing, and cleanup behavior. The current Flutter live-monitor WebSocket implementation is web-only; non-web targets receive a no-op stream factory.

## Why the preferred shape works here

### Flutter

- The app has web, iOS, Android, and macOS targets, while the canonical demo runs Flutter Web on Cloudflare Pages.
- [`BrowserClient`](https://pub.dev/documentation/http/1.6.0/browser_client/BrowserClient-class.html) documents that responses are streamed. Its locked source reads `response.body` incrementally and maps abort signals to `RequestAbortedException`.
- Dart's [`HttpClientResponse`](https://api.flutter.dev/flutter/dart-io/HttpClientResponse-class.html) is itself a byte stream, and `package:http`'s IO adapter preserves streaming and cancellation.
- A manually parsed SSE response avoids separate web/native libraries and avoids the browser `EventSource` constraint of an implicit reconnect policy. Flutter owns the exact resume cursor and capability header.

### Fastify

- Fastify 5 can send a Web `ReadableStream` or `Response` directly. Its official [`Reply` documentation](https://fastify.dev/docs/latest/Reference/Reply/) treats a `ReadableStream` as a pre-serialized stream.
- Prefer a shared Web `ReadableStream` producer returned through `reply.send()` so normal Fastify lifecycle and response handling remain intact. `reply.hijack()` remains a fallback for explicit low-level control, but it makes the route responsible for cleanup and skips remaining Fastify handling.
- The repo's existing dashboard SSE route already proves that Node can flush event frames, heartbeat, and close on request termination, although it is not replayable or suitable as the customer contract.

### Cloudflare Worker

- Cloudflare's official [Streams documentation](https://developers.cloudflare.com/workers/runtime-apis/streams/) confirms that Workers can return a `ReadableStream` and deliver chunks as they become available. The current `worker_sse_not_supported` response is a repo-specific dashboard choice, not a platform limitation.
- Cloudflare's current [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) impose no hard wall-time limit while an HTTP client remains connected and a response body is streaming. Network waits do not count as CPU time, though the free-plan CPU budget still requires deployed measurement.
- `ctx.waitUntil()` is not a reliable run executor: Cloudflare's [Context documentation](https://developers.cloudflare.com/workers/runtime-apis/context/) limits it to 30 seconds after a response completes or a client disconnects. The current planner timeout can exceed that window.
- Cloudflare Queues provide [at-least-once delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), so a durable run ID, atomic claim, and existing side-effect idempotency are mandatory. The repo already uses queue jobs, run claims, retry configuration, a dead-letter queue, and scheduled recovery for coordinated channel work.
- The current queue is configured with batch size 1 and timeout 0, matching low-latency run wakeups. A dedicated KFC run binding is clearer than expanding the Messenger-named binding indefinitely.

## Transport comparison

| Approach | Strengths | Blocking weaknesses | Decision |
|---|---|---|---|
| Idempotent run start + replayable SSE GET | Reattachable; one-way protocol matches progress/text/GenUI; ordinary HTTP through Pages, Fastify, and Worker; explicit authorization and cursor; same Flutter implementation on web/native | Requires durable run/event tables, queue execution, tailing, and buffering proof | Preferred |
| Single streaming POST | Lowest first-event latency; simple local execution; both backend targets can stream the response | Run lifetime is coupled to one connection; reconnect cannot reattach; Worker may cancel outstanding work after disconnect; ambiguous retries can duplicate reasoning; cancellation and replay need a second contract anyway | Reject as primary; optional non-production spike only |
| WebSocket | Bidirectional Stop and progress; current Worker already has a dashboard Durable Object; Cloudflare recommends WebSocket hibernation for long-lived socket servers | Still requires a durable replay log; adds multiplexing, socket authorization, connection state, and custom resume semantics; current Flutter implementation is web-only; global dashboard socket is the wrong trust/scope boundary | Defer unless deployed SSE/long-poll proof fails |
| Repeated polling only | Simple request lifecycle; easiest fallback through restrictive proxies | Higher latency/request count; less fluid text streaming; client must continuously schedule requests | Required fallback over the same event log, not primary |

Cloudflare's [Durable Object WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) makes WebSocket viable, especially with hibernation, but it does not remove the need for persisted sequencing and replay. That extra state machine is not justified for one short-lived, server-to-client run stream in the first rollout.

## Logical API contract

Exact event payloads remain owned by the later text, GenUI, lifecycle, and projection tickets. The transport boundary is:

### Start a run

```http
POST /chat/kfc/runs
Content-Type: application/json
```

The request carries the current `sessionId`, `customerId`, `clientMessageId`, and exactly one trusted input kind: customer text or a GenUI action. The server fingerprints the canonical input.

Success returns `202 Accepted` only after a durable run record exists and queue publication succeeds:

```json
{
  "runId": "run_opaque",
  "sessionId": "kfc:customer",
  "clientMessageId": "customer_chat_msg_...",
  "status": "accepted",
  "streamUrl": "/chat/kfc/runs/run_opaque/events",
  "streamCapability": "short-lived-secret",
  "nextSequence": 1
}
```

Submitting the same `clientMessageId` and fingerprint returns the same run without a second queue job. Reusing the ID with different canonical input returns `409 idempotency_conflict`.

If the run record is committed but queue publication fails, return a retryable error and leave the run recoverable. Retrying the same start request must enqueue only an unclaimed accepted run. A scheduled recovery scan handles the crash gap.

### Replay and tail events

```http
GET /chat/kfc/runs/{runId}/events?after={lastAppliedSequence}
Authorization: Bearer {streamCapability}
Accept: text/event-stream
```

The server:

1. authorizes the capability against the run;
2. reads persisted events where `sequence > after`;
3. sends them in ascending sequence;
4. tails newly persisted events;
5. closes after a terminal event or stream lifetime limit.

Use a query cursor as the canonical resume mechanism because Flutter parses SSE manually. The server may also accept `Last-Event-ID` for standards compatibility, but it must not depend on browser-managed reconnection.

Frame shape:

```text
id: 17
event: kfc-run
data: {"schemaVersion":1,"runId":"run_opaque","sequence":17,"type":"...","occurredAt":"...","payload":{...}}

```

Comments such as `: heartbeat` do not consume sequence numbers. Send an immediate connected comment, then heartbeat at a conservative interval such as 15 seconds. Add `retry: 1000` only as advisory metadata; Flutter owns retry timing.

Required headers:

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store, no-cache, no-transform
Connection: keep-alive              # Node/Fastify only
X-Accel-Buffering: no               # defensive for compatible proxies
```

Do not set `Content-Length`, compress the event stream, or pass it through code that reads the entire body.

### Long-poll fallback

The same event resource must support an explicit JSON/long-poll mode, for example:

```http
GET /chat/kfc/runs/{runId}/events?after=17&waitMs=20000
Accept: application/json
```

It returns the next persisted batch or an empty nonterminal result when the wait expires. Flutter switches to this mode if a deployed proxy demonstrably buffers SSE. It does not switch to a new synchronous agent execution.

### Request cancellation

```http
POST /chat/kfc/runs/{runId}/cancel
Authorization: Bearer {streamCapability}
```

This idempotently records a cancellation request. The stream remains open until the durable log reports the authoritative outcome. A terminal run returns its existing terminal state. Detailed safe-point and irreversible-side-effect behavior remains owned by the run-lifecycle ticket.

Cancelling an HTTP subscription, closing the app, navigating away, or losing connectivity is **Run Transport Loss**, not run cancellation. The executor continues, and the next connection replays from the last applied sequence.

## Persistence and ordering

Introduce a project-owned run ledger and event log rather than extending `DashboardEvent`:

- one durable run identity unique by `(sessionId, clientMessageId)` plus request fingerprint;
- one durable event stream unique by `(runId, sequence)`;
- an atomic run claim so at-least-once queue delivery cannot execute the same run concurrently;
- terminal state and final assistant turn linked to the run;
- cancellation request state separate from connection state;
- retention sufficient for demo replay and reconnect, with an authoritative terminal snapshot available after incremental events expire.

Persist each event before it becomes visible to SSE. Live notification may wake a tailing reader, but it is never the source of truth. Queue ordering must not be trusted: Cloudflare documents that Queues do not guarantee publication order, so sequence assignment belongs to the claimed run executor and durable repository.

For the first Cloudflare rollout, a short-lived Worker SSE request may poll D1 for new run events while connected. Waiting on D1 is not Worker CPU time; serialization and query frequency still need deployed CPU measurement. Begin with a modest active cadence and back off when idle. A per-run Durable Object fan-out is a later optimization only if the measured latency, D1 reads, or CPU budget fails.

For Fastify, the repository can pair Postgres replay with an in-process wake signal, while periodic durable reads preserve correctness across missed notifications and restarts. Wire behavior must remain identical to Worker/D1.

## Authentication and CORS

The current first-party KFC chat is anonymous and its routes accept client-generated durable customer identities. This research does not pretend that a full customer-auth system exists.

For the first rollout:

- generate an unguessable short-lived run capability on accepted start;
- scope it to read events and request cancellation for one run;
- store only a hash, expire it after terminal retention, and never place it in logs or SSE payloads;
- send it in `Authorization`, not the query string;
- use TLS and prefer the existing same-origin Cloudflare Pages deployment;
- rate-limit run creation and reject malformed or cross-session access;
- treat production customer authentication as a separate expansion beyond this hackathon contract.

The Pages chatbot proxy generator currently lists only the legacy message and GenUI-action paths. Streaming implementation must proxy the `/chat/kfc/runs/` prefix and return the backend `Response` body untouched. Cloudflare documents that forwarding a streamed response body without reading it preserves streaming.

For direct cross-origin development, CORS must allow `GET`, `POST`, `OPTIONS`, `Content-Type`, and `Authorization`. Prefer an origin allowlist in deployed mode. Cookies are unnecessary; `BrowserClient.withCredentials` can remain false.

## Buffering and first-event rules

- Return response headers and an initial comment immediately so Flutter can distinguish connection establishment from agent progress.
- Only durable semantic events count toward time to first progress; heartbeats and connection comments do not.
- Parse UTF-8 incrementally across arbitrary byte boundaries. One network chunk is not necessarily one SSE frame.
- Bound individual event payload size. Large GenUI data belongs in complete but compact snapshots, not huge text frames.
- If the client sees no bytes within the deployment-specific buffering threshold, abort only the subscription and resume through long polling. Do not cancel the run.

## Resource cleanup

Flutter owns one subscription and one abort trigger per active run. Disposal or reconnect cancels the response-body subscription and aborts the HTTP request. Stop first sends the explicit cancellation command; it does not merely abort the stream.

Fastify closes the tail reader and heartbeat when `request.raw` closes. Worker `ReadableStream.cancel()` stops polling/tailing and releases readers. Neither path mutates run lifecycle state on disconnect.

Terminal events close the SSE response. Nonterminal streams use a bounded connection lifetime and reconnect with `after`; the run itself is not bounded by one connection. Recovery workers must turn unrecoverable queue/DLQ outcomes into a durable `failed` terminal event so Flutter cannot wait forever.

## Synchronous fallback and rollout

Keep `/chat/kfc/message` and `/chat/kfc/genui-action` unchanged behind the existing fallback path.

The feature flag chooses the transport before submitting a new request:

- streaming disabled or server explicitly reports unsupported before accepting a run: use the legacy synchronous route;
- streaming start succeeds and returns `runId`: never invoke the legacy route for that request;
- start response is lost or ambiguous: retry the idempotent start with the same `clientMessageId` until it returns the existing run;
- stream fails after acceptance: replay SSE or long-poll the same run.

This prevents fallback from becoming a second execution path for an already accepted run.

## Required implementation spikes and proof

Before rollout promotion, prove:

1. Cloudflare Pages forwards the first SSE byte and subsequent frames without buffering.
2. Worker queue-to-D1-to-SSE time-to-first-progress stays within the agreed demo budget with `max_batch_size=1` and `max_batch_timeout=0`.
3. Worker free-plan CPU usage for an active D1-tailed stream remains within limits, or the deployment plan explicitly changes.
4. Flutter Web, iOS, and Android parse split UTF-8/SSE frames, abort cleanly, reconnect from a cursor, suppress duplicates, and fall back to long polling.
5. Disconnect during planning, tool work, text streaming, and GenUI delivery never cancels the run and never repeats an irreversible effect.
6. Duplicate queue delivery cannot acquire the run claim twice.
7. Queue exhaustion/DLQ and recovery produce a terminal failure event.
8. Legacy synchronous mode remains usable when the flag is off.

## Risks retained for later tickets

- Exact event taxonomy, customer-safe projection, and text/GenUI payloads are unresolved by design.
- Exact cancellation safe points and supersession behavior remain with the lifecycle ticket.
- D1 polling cadence, retention, compaction, and terminal snapshot shape require measurement and contract tests.
- Capability authorization is appropriate for the anonymous hackathon surface, not a substitute for KFC customer authentication.
- Cloudflare free-plan CPU is a deployment risk until measured with the real event volume.
- Queue dispatch adds a hop. Current zero-timeout single-message batching minimizes it, but proof must measure rather than assume acceptable latency.

## Verification performed

- Backend Worker suite: 25 tests passed.
- Flutter dashboard-socket and customer-chat repository suites: 7 tests passed.
- Current locked client source confirms streamed browser/native responses and abort support.
- No production route, runtime, or Flutter implementation was changed.
