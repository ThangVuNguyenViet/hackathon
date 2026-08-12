# KFC Agent Backend

LangChain backend for the KFC and PVCFC business agents. Cloudflare Workers +
D1 is the primary demo runtime; Node/Fastify + PostgreSQL remains available for
local development and tests.

## Local Setup

```bash
npm install
npm run fixtures:build
docker compose up -d postgres
npm test
npm run build
KFC_COMMERCE_MODE=fixture npm run dev
```

Unit tests and offline scenario tests inject mock business adapters and do not
require real KFC, Zalo, Messenger, payment, model-provider, or LangSmith
credentials. The server defaults to `KFC_COMMERCE_MODE=gateway` and fails
closed when its gateway configuration is absent; local fixture-backed
development must opt in with `KFC_COMMERCE_MODE=fixture`.

Choose the runtime with `KFC_AGENT_PROVIDER=openai` or
`KFC_AGENT_PROVIDER=google`. `KFC_AGENT_PROFILE_MODE=production` is the
fail-closed default: it pins GPT-4.1-mini for OpenAI and Gemini 3.1 Flash-Lite
with LOW thinking for Google. `KFC_AGENT_MODEL` may only repeat the selected
pinned model and fails closed on drift.

An explicit `KFC_AGENT_PROFILE_MODE=qualification` keeps GPT-4.1-mini pinned
for OpenAI and defaults Google to the affordable Gemini 3.1 Flash-Lite with
HIGH thinking. Other model IDs fail closed in both modes. Deployment scripts
default to production and carry the mode into both Cloud Run and Worker
configuration. The selected agent provider is the only synchronous model
dependency in the customer-facing request path.

The post-turn operations monitor is asynchronous and non-authoritative. By
default it follows `KFC_AGENT_PROVIDER`, using GPT-5 mini with low reasoning
and low verbosity for OpenAI or Gemini 3.1 Flash-Lite with LOW thinking for
Google, so a Google agent does not
silently incur an OpenAI dependency. `KFC_MONITOR_PROVIDER` and
`KFC_MONITOR_MODEL` may make a different pinned provider explicit; an
unsupported model or missing explicitly selected credential fails
configuration instead of falling back to another provider.

The pinned IDs and capabilities are checked against the official
[GPT-5 mini model reference](https://developers.openai.com/api/docs/models/gpt-5-mini),
[Gemini 3.1 Flash-Lite reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite).
Google’s [Gemini 3 guidance](https://ai.google.dev/gemini-api/docs/gemini-3#temperature)
also recommends leaving temperature at its default, so the Google adapter does
not force a lower value.

The same authoring model submits customer prose with a typed publication
declaration in its terminal response. Deterministic publication boundaries
validate the response schema, verified evidence references, authorization, and
approval state before persistence. They do not invoke a third model or police
customer prose with keyword matching. The asynchronous monitor remains
non-authoritative and does not block publication.
`OPENAI_BASE_URL` is optional for the OpenAI adapter.

## Runtime architecture

KFC and PVCFC are separate business packs selected only by trusted route
configuration. Each pack owns its prompt, LangChain `createAgent` loop, tools,
evidence rules, and presentation. The shared registry knows only the pack ID
and `runTurn` contract; it does not contain a universal business model.

Application stores remain authoritative for the canonical transcript,
verified business state, authorization, confirmation pauses, irreversible
effects, idempotency, delivery, and run fences. LangChain supplies the
model/tool loop only. There is no direct OpenAI Agents SDK runtime, authored
LangGraph runtime, framework checkpoint transcript, or runtime selector.

KFC web chat, Messenger, and Zalo use the KFC pack. The PVCFC web route uses
the PVCFC pack and its public-data provider without constructing KFC cart,
confirmation, human-pause, or GenUI state. Both HTTP deployments report
`langchain-create-agent` as the agent runtime.

The packaged PVCFC React client calls `/chat/pvcfc/message` on its own origin.
For split local development only, set `VITE_PVCFC_API_BASE_URL` while building
the web app; non-local HTTP overrides and base URLs containing a path,
credentials, query, or fragment are rejected.

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

The Worker stores application conversation turns, verified business state,
confirmation authority, delivery journals, dashboard events, and webhook
idempotency records in its environment-owned D1 database. The Node entrypoint
stores the same application-owned state durably in PostgreSQL. Generated KFC fixtures are local deterministic
provider responses for tests; they are not database seed content.

Messenger POST webhooks are acknowledged by the Worker after D1 idempotency
reservation and Cloudflare Queue enqueue. The queued consumer performs the
selected provider’s agent turn, Messenger Graph API calls, reply delivery, and
dashboard persistence. This keeps Meta callback responses short and avoids
spending Worker request CPU on the full agent turn.

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
wrangler secret put GOOGLE_API_KEY
wrangler secret put TINYFISH_API_KEY
wrangler secret put KFC_DEMO_ADMIN_TOKEN
```

Customer-facing operation requires credentials for the selected agent
provider. TinyFish is optional: without `TINYFISH_API_KEY`, both packs retain
their canonical fixture/API tools and report current web evidence as
unavailable.

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
  -H "Authorization: Bearer $KFC_DEMO_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"limitConversations":10}'

curl http://localhost:18090/admin/messenger/sync-history/status \
  -H "Authorization: Bearer $KFC_DEMO_ADMIN_TOKEN"
```

History sync imports transcript records only. It does not invoke the AI agent and does not send Messenger replies.

## Key Commands

```bash
npm run fixtures:build
npm test
npm run build
KFC_COMMERCE_MODE=fixture npm run dev
```

## Health Check

```bash
curl http://localhost:18090/health
```

Expected response:

```json
{ "ok": true, "service": "kfc-agent-backend" }
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

The backend is the transcript source of truth. Dashboard session and turn
reads return only the durable state already stored by the backend; they never
perform a hidden Messenger network sync. This keeps polling bounded and means
the response is fresh through the latest completed webhook or explicit sync.

To hydrate older Messenger history before polling, call the authenticated
admin endpoint explicitly:

```bash
curl -X POST http://localhost:18090/admin/messenger/sync-history \
  -H "Authorization: Bearer $KFC_DEMO_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

The dashboard should read the durable APIs rather than scraping Messenger.

## Scenario Contract

The reviewed customer scripts live in
`../../ai-talent-tracks/fnb/conversations/*.json`; their adjacent Markdown,
GenUI capture plan, and Flutter capture data are maintained presentation and
capture artifacts. The executable behavior oracle is the static
`test/scenarios/scenarioCoverageLedger.ts` ledger. The current corpus contains
11 scenarios and 50 customer turns in the UC-01 through UC-39 taxonomy. The
dataset builder derives one Text and one GenUI case per turn, currently 100
cases. These counts and the inventory digest are computed report metadata, not
hard-coded behavioral gates; structural sync instead proves every active turn
has exactly one case per mode with no missing, duplicate, or unexpected turns.
Every turn has a 10-second soft-quality target; the runtime fails closed at the
separate 30-second hard deadline.

The shared evaluator grades verified state, effects and receipts, exact
structured facts and collections, provenance, persistence, latency, and
Text/GenUI outcomes. It does not prescribe planner routes or fixed wording.
Per-turn safety, authority, arithmetic, availability, persistence, and deadline
checks remain blocking. Scenario-wide advisory judgments use metadata-defined
phase boundaries: core scenarios 02, 03, 10, and 11 report nonblocking warnings
until calibration approval; supporting scenarios 06 and 07 are evidence-only;
provider or judge exhaustion is inconclusive rather than a product verdict.

Generated menu items, modifiers, and governed content remain the unified
source of catalog facts. Offline tests do not invoke a model, TinyFish, or
mutate LangSmith. The retired graph-era live-matrix commands are not a current
release gate; a replacement credentialed model matrix must exercise the
LangChain business packs directly before it becomes release-blocking.

TinyFish Search/Fetch qualification is separately gated and never runs in
ordinary CI. It performs one allowlisted PVCFC search and one exact-page fetch,
then prints only latency and a content SHA-256:

```bash
RUN_LIVE_TINYFISH=1 TINYFISH_API_KEY=... npm run test:live:tinyfish
```

Without both gate and credential, the command exits successfully with an
explicit skipped result.

## Messenger And Zalo

Messenger and Zalo adapters are transport boundaries. They normalize inbound
channel payloads into the same KFC application-turn input used by scenario
replay and persist profile/display metadata for the live monitor.

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
manifests, current readiness/catalog/application-state bindings, production latency JSON, and
independent five-golden/three-matrix streaks into one release-candidate manifest. Full GenUI
qualification currently also requires `KFC_GENUI_BRANCH_SESSIONS_FILE`, a reviewed plan that binds
the eight legacy persisted proof scenarios to clean durable deployed sessions. No maintained
canonical producer emits that artifact yet, so the acceptance runner fails closed when it is
missing. This dependency remains bound to the legacy v3 8-scenario/44-turn
proof contract and must not be relabelled as nine-scenario proof.

For final proof, assistant behavior must come from the pinned live OpenAI and
Gemini profiles. Deterministic fake-model output is only test infrastructure.
The selected model authors semantic commerce tool calls and the typed terminal
response; deterministic code validates schemas, verified state, authorization,
policy, approvals, tool execution, grounding, and persistence. A no-tool turn
is expected to use one authoring call, while a turn with one tool round trip
uses two authoring calls. A future complete live-quality qualification
must run the shared evaluator through its LangSmith adapter for every turn and
compare both modes and providers; the maintained selected replay does not yet
establish that matrix. Malformed publication declarations, unavailable evidence
references, stale authority, and unauthorized disclosures fail closed. Semantic
contradictions between customer prose and cited evidence are release-blocking
post-turn judge failures; there is no deterministic customer-prose fallback.

## Sandbox OMS And POS Component Tests

Run the credential-free contract and component suite:

```bash
npm test -- \
  test/commerceProof/contracts.test.ts \
  test/commerceProof/mock-oms-server.test.ts \
  test/commerceProof/mock-pos-server.test.ts \
  test/commerceProof/gateway-server.test.ts
```

These tests exercise the versioned project contracts and real loopback HTTP
boundaries between the Demo Commerce Gateway and the in-memory Mock OMS/POS
servers. They cover authentication, readiness, correlation, duplicate
suppression, rejection compensation, timeouts, POS-first cancellation, partial
cancellation, and conflicting source status.

This is component-test evidence only. It does not prove that a live model chose
the correct tool, that an agent response was grounded, that a deployed system
completed the flow, or that LangSmith contains an end-to-end trace. It also does
not establish compatibility with KFC or any named OMS/POS vendor, durability,
or production readiness. Provider-facing evidence must come from an
authoritative sandbox or production integration, while model behavior remains
owned by the canonical live scenario matrix.

No generated mock-commerce proof manifest, synthetic trace, Patrol suite, or
mock-backed Flutter `integration_test` is part of this boundary. Existing
Flutter integration tests remain backend-backed.

## Final Proof Videos

The final demo proof is two MP4 files produced from the same live proof run. Chrome and FDB are used to drive and verify the proof surfaces.

- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/messenger-chat-ai.mp4`
- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/flutter-dashboard-conversation.mp4`

Both videos must show the same Messenger thread/customer/session identifier.
