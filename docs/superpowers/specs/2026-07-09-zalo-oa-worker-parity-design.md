# Zalo OA Worker Parity Design

Date: 2026-07-09

## Purpose

Add Zalo Official Account support to the existing Cloudflare Worker demo runtime so it behaves like the current Messenger integration: stable public webhook, D1-backed transcript history, dashboard visibility, idempotent webhook handling, and live text replies through the same agent graph.

The first Zalo launch should ingest and display all practical inbound OA event categories, but customer replies remain text-only unless a specific attachment type has a verified business action. This avoids silently losing rich inbound messages while keeping the first live integration reliable.

## Confirmed Setup State

Chrome inspection of the active Zalo sessions confirmed:

- Zalo Developers is signed in as `Thang Vu`.
- Zalo Developers currently shows `0/100` apps, so no developer app exists under this account yet.
- Zalo OA Manager contains one active verified business OA:
  - OA name: `Công ty Cp Dd Thương Mại Điện Tử`
  - OA ID: `4225933857518051795`
  - followers shown in OA Manager: `16`

This means setup must begin by creating a Zalo Developer app, linking it to the OA, generating or obtaining OA token credentials, and configuring the app webhook to the Worker URL.

## Current Code Baseline

The backend already has the main transport seam:

- `POST /webhooks/zalo` in the Fastify and Worker route layers.
- `src/channels/zalo.ts` with text-event normalization and `sendText`.
- `ZALO_OA_ID`, `ZALO_ACCESS_TOKEN`, and `ZALO_API_BASE_URL` environment fields.
- D1/Postgres persistence for conversation turns, dashboard events, and webhook delivery idempotency.
- Flutter monitor support for the Zalo channel.
- Flutter monitor session cards already have a `customerName` field, but the backend repository currently falls back to `externalUserId`, which is why Messenger sessions can show a chat ID instead of a readable user name.

The existing Zalo adapter is useful but incomplete. It only handles text-like events, does not model token lifecycle, does not expose Zalo readiness separately from Messenger, and does not document Worker deployment setup for Zalo.

## Setup Boundary

The production demo target is the existing Cloudflare Worker runtime, not a local tunnel.

The Zalo webhook URL should be:

```text
<WORKER_URL>/webhooks/zalo
```

For the current Worker name, the unresolved shape is:

```text
https://kfc-agent-backend-demo.<account-subdomain>.workers.dev/webhooks/zalo
```

The exact Worker URL must be verified from `wrangler deploy`, Cloudflare dashboard, or `CF_WORKER_URL` before entering it in Zalo Developers.

Required admin setup:

1. Create a Zalo Developer app.
2. Link or authorize the app for OA `4225933857518051795`.
3. Generate OA access token credentials for that app/OA pair.
4. Configure the app webhook URL to `<WORKER_URL>/webhooks/zalo`.
5. Enable OA message webhook events needed for customer chat.
6. Store runtime secrets in Cloudflare Worker secrets, not in code or committed env files.

## Runtime Secrets

Required:

- `ZALO_OA_ID=4225933857518051795`
- `ZALO_ACCESS_TOKEN`

Likely required if official token refresh is implemented:

- `ZALO_REFRESH_TOKEN`
- `ZALO_APP_ID`
- `ZALO_APP_SECRET`

The implementation must verify the official token refresh contract before adding automatic refresh behavior. If the contract cannot be verified during implementation, the first launch should use manual token refresh with clear readiness and send-failure reporting.

## Architecture

Zalo should share the same channel boundary as Messenger.

```text
Zalo OA webhook
  -> Cloudflare Worker POST /webhooks/zalo
  -> Zalo webhook parser and normalizer
  -> webhook delivery reservation
  -> D1 conversation turn/event persistence
  -> agent graph when safe text exists
  -> Zalo text reply through OA API
  -> assistant delivery status and dashboard events
```

The channel adapter owns Zalo-specific payload shapes and outbound API calls. The agent graph should receive normalized conversation input and should not depend on raw Zalo webhook schemas.

## Event Normalization

Normalize inbound Zalo webhook payloads into a structured channel event with:

- `channel: "zalo"`
- external user ID
- external thread ID
- raw event ID or stable fallback ID
- received timestamp
- event type
- optional user-visible text
- optional attachment metadata
- original platform event name

Text events continue to the agent as normal customer messages.

Non-text events should be preserved in transcript/dashboard history. They should invoke the agent only when they include safe text or a deterministic text summary that does not claim to inspect unprocessed media contents.

Initial inbound categories to support as normalized records:

- text message
- image message
- file message
- link message
- sticker message
- audio or voice message, if present in OA webhook payloads
- location message, if present in OA webhook payloads
- follow or user-interaction events that are useful for audit history
- unsupported future events as `unsupported` records with raw event metadata

The implementation must verify exact Zalo `event_name` values and payload fields against official docs or observed webhook payloads before finalizing the parser. Unknown fields should be retained in raw metadata but not treated as confirmed semantics.

## Reply Behavior

The first launch replies with text only.

Reply rules:

- For a text customer message, run the existing graph and send the composed text reply.
- For a non-text event with useful text such as a link title or user caption, pass the text into the graph only if the event semantics are verified.
- For a non-text event without processable text, record the event and send a short text acknowledgement asking the customer to describe the order or request in text.
- For unsupported events, record the event and do not execute unsafe ordering actions.

This keeps Zalo customer experience consistent with Messenger while avoiding unverified image, file, or audio understanding.

## Persistence And Dashboard

Use the existing session convention:

```text
zalo:<externalThreadId>
```

Every accepted webhook event should be visible through existing dashboard polling APIs:

- `GET /dashboard/sessions`
- `GET /dashboard/sessions/:sessionId/turns`
- `GET /dashboard/events/:sessionId`

For attachment events, transcript turns should expose enough metadata for the monitor to show that a customer sent an image, file, link, sticker, audio, or location, even if the backend does not inspect the content. If the current turn schema cannot carry this cleanly, add a small metadata field at the persistence boundary rather than overloading text with raw JSON.

No Flutter monitor redesign is required for the first launch unless the existing UI cannot display the event type or fallback text coherently.

## Monitor Feature Parity

Zalo is not complete until the Flutter monitor proves the same operator workflow that Messenger has or is expected to have.

Required monitor behavior for both Messenger and Zalo:

- **Live text intake:** when a customer sends a text message, the monitor shows the new inbound turn for that session without requiring an app restart. In the Worker demo this can be implemented through the existing polling path; local Node SSE may remain a development convenience, but Worker proof should not depend on SSE.
- **Per-user chat history:** selecting or viewing a session shows the persisted turns for that user, ordered by time, with the latest customer and assistant turns visible. Zalo must at least preserve runtime history from the point the webhook is enabled. If official Zalo APIs support safe historical transcript import, design the importer behind a separate verification step; do not fabricate parity by scraping the OA UI.
- **Open chat deeplink:** each monitor session exposes a channel-specific operator handoff link that opens the corresponding Messenger or Zalo conversation/admin chat when the platform provides a verified URL shape. If the exact deep link cannot be verified, the UI should show a clear unavailable state rather than a fake `backend://` link.
- **Display customer names:** session cards should show the real customer display name for Messenger and Zalo when the platform payload or profile API provides it. The chat ID can remain secondary/debug metadata, but it should not be the primary customer label.

The backend should persist customer profile fields at the conversation boundary so the monitor does not need to call Messenger or Zalo directly. At minimum, persist `externalUserId`, `displayName`, `avatarUrl` when available, `profileSource`, and `profileUpdatedAt`. For privacy and proof clarity, do not expose access tokens or raw profile API payloads to the Flutter app.

Messenger should be fixed as part of this work: the monitor currently showing a chat ID is a parity bug, not a Zalo-specific limitation.

## Readiness

`/ready` should report Zalo independently from Messenger.

Required checks:

- `ZALO_OA_ID` configured.
- `ZALO_ACCESS_TOKEN` configured.
- Optional token/API smoke check only if there is a safe official OA endpoint that can be called without customer-visible side effects.

Messenger readiness must remain separate. Zalo misconfiguration should be visible without hiding Messenger status.

## Error Handling

Webhook delivery handling should mirror Messenger:

- Valid Zalo webhook deliveries return `200` after acceptance so Zalo does not retry indefinitely for business-logic failures.
- Malformed or unparsable payloads may return `400`.
- Duplicate event IDs are skipped without creating duplicate turns or replies.
- Unsupported event types are recorded and skipped without executing unsafe order actions.
- Missing access token marks assistant delivery failed.
- Zalo send API failure marks the assistant turn `failed`, emits a dashboard delivery event with `deliveryStatus: "failed"`, and marks the webhook delivery failed with an error code.

Each webhook delivery should end as processed, failed, or duplicate in `webhook_deliveries`.

## Documentation Updates

Update Cloudflare deployment docs with:

- Zalo OA ID and app creation checklist.
- Zalo Developer app to OA linking steps.
- Webhook URL: `<WORKER_URL>/webhooks/zalo`.
- Required Worker secrets.
- Manual token generation or refresh steps, unless automatic refresh is verified and implemented.
- Zalo live smoke proof steps.
- Clear note that the stable Worker URL is the canonical webhook target.

Update backend README with Zalo parity behavior, supported inbound event categories, and text-only first-launch reply scope.

Update monitor docs or README with the verified behavior for live text intake, per-user history, chat deeplinks, and display names for both channels.

## Test Plan

Backend tests should cover:

- Text event normalization runs the agent and sends a text reply.
- Image, file, link, sticker, audio, location, follow, and unsupported events normalize into persisted transcript/dashboard records.
- Non-text events without safe text do not execute unsafe order actions.
- Duplicate Zalo event IDs are idempotent.
- Missing Zalo token marks delivery failed while preserving inbound transcript history.
- Zalo send API errors mark assistant turns and webhook deliveries failed.
- `/ready` reports Zalo config independently from Messenger config.
- Worker routing continues to expose `POST /webhooks/zalo`.
- Customer profile/display-name persistence works for Messenger and Zalo payloads or verified profile API responses.

Flutter monitor tests should cover:

- Messenger and Zalo session cards prefer display names over external chat IDs.
- The chat ID remains available only as secondary/debug context when needed.
- Runtime turns from both channels hydrate into per-user session history.
- Channel-specific deeplink state is explicit: verified URL when available, unavailable state when not verified.
- Worker-backed polling updates visible text turns for Zalo and Messenger without app restart.

Flutter `integration_test` UI proof should verify the monitor dashboard after live or signed webhook messages, because backend-only tests are not sufficient for feature parity.

Live proof should include:

- Worker `/health` and `/ready` output.
- A real Zalo user message sent to OA `4225933857518051795`.
- A text assistant reply sent through the Zalo OA API.
- A dashboard transcript for the same `zalo:<user>` session.
- A monitor dashboard view showing the Zalo customer display name rather than only the Zalo user ID.
- A Messenger monitor view showing the Messenger customer display name rather than only the PSID/chat ID.
- Verified operator deeplink behavior for both channels, or an explicit unavailable state if a verified deep link cannot be obtained.
- D1-backed delivery evidence showing inbound and outbound turns.

## Out Of Scope For First Launch

- Rich outbound Zalo messages beyond text.
- Image OCR, file parsing, audio transcription, or location-based fulfillment decisions.
- Automated token refresh unless the official refresh contract is verified during implementation.
- Unverified Zalo history backfill. Runtime per-user Zalo history after webhook enablement is in scope.
- New Flutter monitor layouts.
- Replacing the existing Messenger setup.

## Approval Summary

The approved direction is Worker-first Zalo parity:

- use the existing Cloudflare Worker runtime;
- create/link a Zalo Developer app for the active OA;
- configure Zalo webhook to the Worker;
- ingest all practical inbound Zalo event categories;
- reply with text only in the first pass;
- share Messenger's transcript, idempotency, dashboard, and proof model;
- verify monitor feature parity for live text intake, per-user history, deeplinks, and display names;
- fix the current Messenger monitor behavior that shows a chat ID as the primary customer name.
