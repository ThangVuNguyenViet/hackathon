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
npm run worker:queue:create
npm run worker:dev
npm run worker:deploy:dry-run
```

Production deploy uses `../../scripts/deploy-backend-cloudflare-worker.sh` after the real D1 `database_id` is copied into `wrangler.toml` and secrets are created with `wrangler secret put`.

The Messenger callback submitted to Meta should be:

```text
https://<worker-name>.<account-subdomain>.workers.dev/webhooks/messenger
```

The Worker stores runtime conversation turns, dashboard events, and webhook idempotency records in D1. Generated KFC fixtures are bundled mock external API responses; they are not database seed content.

Messenger POST webhooks are acknowledged by the Worker after D1 idempotency reservation and Cloudflare Queue enqueue. The queued consumer performs the OpenAI turn, Messenger Graph API calls, reply delivery, and dashboard persistence. This keeps Meta callback responses short and avoids spending Worker request CPU on the full agent turn.

Create the queue resources once per Cloudflare account/environment:

```bash
npm run worker:queue:create
```

Set or rotate live secrets before deploying:

```bash
wrangler secret put MESSENGER_VERIFY_TOKEN
wrangler secret put META_PAGE_ACCESS_TOKEN
wrangler secret put OPENAI_API_KEY
wrangler secret put KFC_DEMO_ADMIN_TOKEN
```

Meta access-token expiry cannot be extended in place after a token expires. Generate a new long-lived Page access token for Page ID `118976205445198`, confirm it in Meta's Access Token Debugger, then update `META_PAGE_ACCESS_TOKEN`.

Run the deployed demo preflight before sending a live Messenger message:

```bash
KFC_WORKER_URL=https://kfc-agent-backend-demo.<account-subdomain>.workers.dev \
MESSENGER_VERIFY_TOKEN=... \
npm run worker:preflight
```

`GET /ready` remains lightweight. `GET /ready?deep=1` additionally validates the configured Messenger token against the Graph API without exposing the token value.

`GET /dashboard/socket` upgrades to the production dashboard WebSocket. The monitor hydrates once from the REST session endpoints, then refreshes from pushed dashboard events.

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

## KFC Chat Turn

```bash
curl -s http://localhost:18090/chat/kfc/message \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"kfc:demo_customer","customerId":"demo_customer","clientMessageId":"demo_message_1","text":"Cho mình 1 Combo 99K"}'
```

## Dashboard Polling

```bash
curl http://localhost:18090/dashboard/sessions
curl http://localhost:18090/dashboard/sessions/kfc%3Ademo_customer/turns
curl http://localhost:18090/dashboard/events/kfc%3Ademo_customer
```

The backend is the transcript source of truth. The dashboard should read these APIs rather than scraping Messenger.

## Scenario Contract

The reviewed integration scripts live in `../../ai-talent-tracks/fnb/conversations/`. The scenario parser treats those Markdown files as the source contract, with one integration replay test per script. Scenario 01 is the selected live Messenger/dashboard demo script, and scenario replay requires the reviewed generated fixture set.

Default scenario replay is deterministic: it uses `StaticToolPlanner` with generated mock KFC fixtures so `npm test` does not depend on OpenAI availability. To prove the live OpenAI tool planner independently chooses the expected tool groups across the same 8 scripts and UC-01 through UC-50, run:

```bash
OPENAI_API_KEY=... npm run test:live:scenarios
```

That live suite uses the real `OpenAIToolPlanner`, records the model's planned tool calls for each user turn, and fails if any scenario is missing its required tool group coverage. The command defaults the tool planner proof model to `gpt-4.1`; set `OPENAI_TOOL_PLANNER_MODEL=...` to override it. It still uses mock KFC fixture clients for business data; it does not call real KFC APIs.

## Messenger And Zalo

Messenger and Zalo adapters are transport boundaries. They normalize inbound channel payloads into the same graph input used by scenario replay and persist profile/display metadata for the live monitor.

All response surfaces use the same verified tool catalog, planner, safety gates, and commerce state. The first-party `kfc` surface uses `responseType: "genui"` and may return a typed GenUI attachment; Messenger and Zalo use `responseType: "text"` and receive only a concise text reply. The difference is response rendering and style, not business capability: menu search, modifiers, promotions, fulfillment, payment, ordering, and handoff remain available in both modes.

- Messenger setup uses Page ID `118976205445198`.
- Zalo setup uses OA ID `4225933857518051795`.
- `GET /webhooks/messenger` handles Meta verification with `MESSENGER_VERIFY_TOKEN`.
- `POST /webhooks/messenger` accepts Page webhook deliveries.
- `POST /webhooks/zalo` accepts Zalo OA webhook deliveries.
- Zalo text messages run the agent and receive text replies.
- Zalo image, file, link, sticker, audio, location, follow, and unsupported events are recorded into transcript history. The first launch replies with text only and does not inspect unprocessed media contents.
- The dashboard session summary includes `displayName`, `externalUserId`, `avatarUrl`, and a typed `deeplink` state for both Messenger and Zalo.
- Local tests use fixture payloads and do not require live channel credentials.

For final proof, assistant messages must come from live OpenAI API calls. Mocked or deterministic LLM output is only for automated tests and scenario replay. The deterministic graph still owns business state, cart/payment decisions, and dashboard events; OpenAI only composes the final customer-facing wording from that verified outcome. If response composition fails, the backend records `llm:response_composer_failed` and sends the deterministic fallback so live channels do not drop the conversation.

## Simulated OMS And POS Proof

Run the credential-free local proof:

```bash
npm run proof:commerce:mock
```

Run the reviewer-facing LangSmith gate:

```bash
npm run proof:commerce:mock -- --require-langsmith
```

The command starts four loopback HTTP services on ephemeral ports: KFC agent backend, Demo Commerce Gateway, Mock OMS, and Mock POS. It executes eight deterministic scenarios, validates readiness and correlation, writes local traces and evaluator results, and shuts every service down. The LangSmith gate additionally fails unless every scenario exports a run URL with ordered hop children and deterministic scores.

Artifacts are written under `../../artifacts/mock-commerce-proof/<timestamp>/` by default. `manifest.json` is the index; each scenario contains `local-trace.json`, `evaluator-results.json`, `api-summary.json`, `assistant-genui.json`, and `langsmith.json`. Generated proof artifacts are ignored by Git and exclude tokens and customer PII.

The accepted claim is: **Demonstrated simulated OMS/POS orchestration through replaceable adapter contracts.** This does not prove compatibility with KFC or any named vendor, sandbox validation, durability, or production readiness.

Placement, rejection, compensation, and timeout scenarios enter through the normal KFC backend and agent tool executor. Duplicate, cancellation, partial cancellation, and conflict checks currently enter through the gateway API; their manifests state that limitation because `cancelOrder` is not yet exposed in the agent tool catalog.

No Patrol suite or mock-backed Flutter `integration_test` is used. Mock coverage remains in Vitest and Flutter widget/golden tests; existing Flutter integration tests remain backend-backed.

## Final Proof Videos

The final demo proof is two MP4 files produced from the same live proof run. Chrome and FDB are used to drive and verify the proof surfaces.

- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/messenger-chat-ai.mp4`
- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/flutter-dashboard-conversation.mp4`

Both videos must show the same Messenger thread/customer/session identifier.
