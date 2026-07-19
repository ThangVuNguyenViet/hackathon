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

Set `OPENAI_API_KEY` to make runtime replies use the live OpenAI Responses API. `OPENAI_MODEL` defaults to `gpt-4.1-mini`, and `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`.

## LangSmith Studio

The authoritative turn runtime is a compiled LangGraph `StateGraph` with the visible topology `load_context -> classify_turn -> route_turn -> social_response | structured_action | plan_tools -> execute_tools -> enforce_invariants -> compose_response -> persist_turn -> monitor`. Trusted GenUI actions use the structured branch without an LLM call; natural-language commerce turns use the bounded planner branch. Both branches converge on response, persistence, and monitor guarantees.

Start the local Agent Server from this directory:

```bash
npm run dev:studio -- --no-browser
```

Open the Studio URL printed by the command. The default local API is `http://localhost:2024`, and the graph ID is `kfc-agent`. The command uses the fixture-backed commerce clients; when `OPENAI_API_KEY` is present in `../../.env`, it also uses the configured OpenAI social router, tool planner, and response composer.

Use this Studio input for a first run:

```json
{
  "sessionId": "studio:demo-customer",
  "customerId": "demo-customer",
  "channel": "kfc",
  "text": "Cho mình 1 Combo 99K"
}
```

Studio state is development-only and in memory. Production session identity and conversation persistence remain app-owned; the StateGraph does not replace D1/Postgres or channel webhook idempotency.

## Worker Runtime

Cloudflare Worker is the primary stable webhook target:

```bash
npm run worker:d1:migrate:local
npm run worker:queue:create
npm run worker:dev
npm run worker:deploy:dry-run
```

The checked-in `wrangler.toml` and its existing D1 UUID are sandbox-only. Production must use a
separate D1 database and the tracked `wrangler.production.toml.example`: copy it to
`wrangler.production.toml`, replace its intentionally invalid database ID, and deploy with
`wrangler deploy --config wrangler.production.toml`. Never point the production config at the
sandbox UUID. Create secrets separately for each Worker.

The Messenger callback submitted to Meta should be:

```text
https://<worker-name>.<account-subdomain>.workers.dev/webhooks/messenger
```

The Worker stores runtime conversation turns, dashboard events, webhook idempotency records, and
LangGraph checkpoints in its environment-owned D1 database. The Node entrypoint stores the same
runtime state and checkpoints durably in PostgreSQL. Generated KFC fixtures are local deterministic
provider responses for tests; they are not database seed content.

Messenger POST webhooks are acknowledged by the Worker after D1 idempotency reservation and Cloudflare Queue enqueue. The queued consumer performs the OpenAI turn, Messenger Graph API calls, reply delivery, and dashboard persistence. This keeps Meta callback responses short and avoids spending Worker request CPU on the full agent turn.

Create the queue resources once per Cloudflare account/environment:

```bash
npm run worker:queue:create
```

Set or rotate live secrets before deploying:

```bash
wrangler secret put MESSENGER_VERIFY_TOKEN
wrangler secret put META_APP_SECRET
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

`KFC_DEMO_ADMIN_TOKEN` temporarily protects dashboard, admin, customer-run event/control, and session-update routes. Send it as `Authorization: Bearer ...` or `X-KFC-Demo-Admin-Token`. This is a demo-operations boundary, not caller-bound KFC customer authentication.

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

The reviewed contracts live in `../../ai-talent-tracks/fnb/conversations/*.json`. Those nine JSON
files are the sole authored source for 48 customer turns, observable outcomes, and the UC-01 through
UC-39 taxonomy. Adjacent Markdown, the GenUI capture plan, and Flutter capture data are generated;
run `npx tsx scripts/generate-scenario-docs.ts --check` to detect drift.

The provider-neutral acceptance inventory contains 96 Text/GenUI cases. Qualification requires
three unchanged repetitions: 54 scenario-mode runs and 288 turn-mode evaluations per provider.
The shared evaluator grades verified state, effects and receipts, exact structured facts and
collections, provenance, persistence, latency, Text/GenUI parity, and cross-provider parity. It
does not grade planner routes, tool order, fixed wording, or keyword matches.

The paid matrix remains blocked until the task-49 single-agent runtime adapter projects real turn
results into `LiveQualityExperimentOutput` and the deployed proof consumers move from v3 8/44 to
v4 9/48. Offline tests do not invoke a model or mutate LangSmith.

Small-talk routing, direct-catalog streaming, and Worker interruption remain separate boundary checks:

```bash
npm run test:live:small-talk-router
npm run test:live:direct-catalog
npm run test:live:interruption
```

## Messenger And Zalo

Messenger and Zalo adapters are transport boundaries. They normalize inbound channel payloads into the same graph input used by scenario replay and persist profile/display metadata for the live monitor.

- Messenger setup uses Page ID `118976205445198`.
- Zalo setup uses OA ID `4225933857518051795`.
- `GET /webhooks/messenger` handles Meta verification with `MESSENGER_VERIFY_TOKEN`.
- The Cloudflare Worker `POST /webhooks/messenger` ingress accepts Page webhook deliveries only after validating `X-Hub-Signature-256` against `META_APP_SECRET` over the raw request body.
- `POST /webhooks/zalo` accepts Zalo OA webhook deliveries.
- Zalo text messages run the agent and receive text replies.
- Zalo image, file, link, sticker, audio, location, follow, and unsupported events are recorded into transcript history. The first launch replies with text only and does not inspect unprocessed media contents.
- The dashboard session summary includes `displayName`, `externalUserId`, `avatarUrl`, and a typed `deeplink` state for both Messenger and Zalo.
- Local tests use fixture payloads and do not require live channel credentials.

The release-blocking Messenger proof is opt-in and deployed-only:

```bash
npm run proof:live:messenger
```

It requires `KFC_AGENT_BACKEND_URL`, `KFC_PROOF_ADMIN_TOKEN`, `KFC_MESSENGER_SESSION_ID`,
`KFC_MESSENGER_OUTPUT_DIR`, `KFC_EXPECTED_RUNTIME_BINDING_FILE`,
`KFC_MESSENGER_EXPECTATIONS_FILE`, `KFC_MESSENGER_DUPLICATE_WEBHOOK_FILE`, and
`KFC_MESSENGER_DUPLICATE_SIGNATURE`. The command resets the session, binds the current deployed
release/catalog/lifecycle state, guides the real tester through the fixed 14-turn journey, and
writes exclusive per-turn and duplicate/coalescing evidence files. It never sends customer turns
on the tester's behalf or substitutes local credentials or fixtures.

The root `scripts/run-kfc-deployed-acceptance.sh` composes the deployed GenUI and Messenger child
manifests, current readiness/catalog/graph/checkpoint bindings, production latency JSON, and
independent five-golden/three-matrix streaks into one release-candidate manifest.

For final proof, assistant messages must come from live OpenAI API calls. Static deterministic LLM output is only for automated tests and scenario replay. The deterministic graph still owns business state, cart/payment decisions, and dashboard events; OpenAI only composes the final customer-facing wording from that verified outcome. If response composition fails, the backend records `llm:response_composer_failed` and sends the deterministic fallback so live channels do not drop the conversation.

## Sandbox OMS And POS Proof

Run the credential-free local proof:

```bash
npm run proof:commerce:mock
```

Run the reviewer-facing LangSmith gate:

```bash
npm run proof:commerce:mock -- --require-langsmith
```

The command starts four loopback HTTP services on ephemeral ports: KFC agent backend, Commerce Gateway, OMS provider, and POS provider. It executes eight deterministic scenarios, validates readiness and correlation, writes local traces and evaluator results, and shuts every service down. The LangSmith gate additionally fails unless every scenario exports a run URL with ordered hop children and deterministic scores.

Artifacts are written under `../../artifacts/mock-commerce-proof/<timestamp>/` by default. `manifest.json` is the index; each scenario contains `local-trace.json`, `evaluator-results.json`, `api-summary.json`, `assistant-genui.json`, and `langsmith.json`. Generated proof artifacts are ignored by Git and exclude tokens and customer PII.

The accepted claim is: **Demonstrated OMS/POS orchestration in the qualified sandbox environment through replaceable adapter contracts.** This does not prove compatibility with KFC or any named vendor, production-environment validation, durability, or production readiness.

Placement, rejection, compensation, and timeout scenarios enter through the normal KFC backend and agent tool executor. Duplicate, cancellation, partial cancellation, and conflict checks currently enter through the gateway API; their manifests state that limitation because `cancelOrder` is not yet exposed in the agent tool catalog.

No Patrol suite or mock-backed Flutter `integration_test` is used. Mock coverage remains in Vitest and Flutter widget/golden tests; existing Flutter integration tests remain backend-backed.

## Final Proof Videos

The final demo proof is two MP4 files produced from the same live proof run. Chrome and FDB are used to drive and verify the proof surfaces.

- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/messenger-chat-ai.mp4`
- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/flutter-dashboard-conversation.mp4`

Both videos must show the same Messenger thread/customer/session identifier.
