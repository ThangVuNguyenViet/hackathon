# KFC Agent Backend

Fastify + LangGraph.js backend for the KFC Vietnam conversational ordering assistant. The hackathon demo runtime is Cloudflare Workers + D1; the Node/Fastify server remains available for local development and tests.

## Local Setup

```bash
npm install
npm run fixtures:build
docker compose up -d postgres
npm test
npm run build
npm run dev
```

The backend uses mock business adapters by default. Unit and scenario tests do not require real KFC, Zalo, Messenger, payment, OpenAI, or LangSmith credentials.

Set `OPENAI_API_KEY` to make runtime replies use the live OpenAI Responses API. `OPENAI_MODEL` defaults to `gpt-4.1`, and `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`.

## Worker Demo Runtime

Cloudflare Worker is the primary stable webhook target for the hackathon demo:

```bash
npm run worker:d1:migrate:local
npm run worker:dev
npm run worker:deploy:dry-run
```

Production deploy uses `../../scripts/deploy-backend-cloudflare-worker.sh` after the real D1 `database_id` is copied into `wrangler.toml` and secrets are created with `wrangler secret put`.

The Messenger callback submitted to Meta should be:

```text
https://<worker-name>.<account-subdomain>.workers.dev/webhooks/messenger
```

The Worker stores runtime conversation turns, dashboard events, and webhook idempotency records in D1. Generated KFC fixtures are bundled mock external API responses; they are not database seed content.

`GET /dashboard/stream` is not supported on the Worker runtime. Dashboard proof should use the polling APIs below.

## Persistence

Runtime chat and monitor history is persisted in D1 for the Worker demo and Postgres for the optional local/Cloud Run Node runtime:

```bash
docker compose up -d postgres
DATABASE_URL=postgres://kfc_agent:kfc_agent@localhost:15432/kfc_agent npm run dev
```

The backend creates `conversation_turns`, `conversation_events`, `dashboard_events`, and `webhook_deliveries` if they do not already exist. Inbound webhook turns preserve the platform message ID when Meta/Zalo provides one.

Postgres is the default store because the monitor needs ordered transcript queries, session indexes, and durable dashboard events, while JSONB payload columns still preserve flexible channel-specific webhook payloads. If conversation analytics later need high-volume document search, add a document/search store as a projection from these source-of-truth tables rather than splitting live writes across two databases.

Messenger Page history sync runs in the background on startup when `META_PAGE_ACCESS_TOKEN` is configured. It can also be triggered manually:

```bash
curl -s -X POST http://localhost:18090/admin/messenger/sync-history \
  -H 'Content-Type: application/json' \
  -d '{"limitConversations":10}'

curl http://localhost:18090/admin/messenger/sync-history/status
```

History sync imports transcript records only. It does not invoke the AI agent and does not send Messenger replies.

## Key Commands

```bash
npm run fixtures:build
npm test
npm run build
npm run dev
```

## Health Check

```bash
curl http://localhost:18090/health
```

Expected response:

```json
{"ok":true,"service":"kfc-agent-backend"}
```

## Mock Chat Turn

```bash
curl -s http://localhost:18090/chat/mock \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"demo","customerId":"demo_customer","channel":"messenger_mock","text":"Cho mình 1 Combo 99K"}'
```

## Dashboard Polling

```bash
curl http://localhost:18090/dashboard/sessions
curl http://localhost:18090/dashboard/sessions/demo/turns
curl http://localhost:18090/dashboard/events/demo
```

The backend is the transcript source of truth. The dashboard should read these APIs rather than scraping Messenger.

## Scenario Contract

The reviewed integration scripts live in `../../ai-talent-tracks/fnb/conversations/`. The scenario parser treats those Markdown files as the source contract, with one integration replay test per script. Scenario 01 is the selected live Messenger/dashboard demo script, and scenario replay requires the reviewed generated fixture set.

## Messenger And Zalo

Messenger and Zalo adapters are transport boundaries. They normalize inbound channel payloads into the same graph input used by scenario replay.

- Messenger setup uses Page ID `118976205445198`.
- `GET /webhooks/messenger` handles Meta verification with `MESSENGER_VERIFY_TOKEN`.
- `POST /webhooks/messenger` accepts Page webhook deliveries.
- `POST /webhooks/zalo` accepts Zalo OA webhook deliveries.
- Local tests use fixture payloads and do not require live channel credentials.

For final proof, assistant messages must come from live OpenAI API calls. Mocked or deterministic LLM output is only for automated tests and scenario replay. The deterministic graph still owns business state, cart/payment decisions, and dashboard events; OpenAI only composes the final customer-facing wording from that verified outcome. If response composition fails, the backend records `llm:response_composer_failed` and sends the deterministic fallback so live channels do not drop the conversation.

## Final Proof Videos

The final demo proof is two MP4 files produced from the same live proof run. Chrome and FDB are used to drive and verify the proof surfaces.

- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/messenger-chat-ai.mp4`
- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/flutter-dashboard-conversation.mp4`

Both videos must show the same Messenger thread/customer/session identifier.
