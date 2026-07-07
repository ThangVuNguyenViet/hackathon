# KFC Agent Backend

Fastify + LangGraph.js backend for the KFC Vietnam conversational ordering assistant.

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
