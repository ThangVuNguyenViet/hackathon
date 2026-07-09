# Hackathon Free Deployment

This deployment shape is optimized for a stable hackathon submission while keeping the demo backend on Cloudflare's free-friendly path.

## Target Architecture

```text
Messenger Page 118976205445198
  -> Cloudflare Worker HTTPS URL
  -> Fastify-compatible shared handlers
  -> Cloudflare D1 runtime ledger
  -> Flutter dashboard on Cloudflare Pages
```

Use the same Worker URL for the Messenger webhook and the dashboard API base URL.

Cloudflare Worker is the canonical webhook target for the demo. Do not submit an ephemeral local tunnel URL as the Messenger callback. A tunnel can still be used as an emergency local fallback, but it must not replace the stable Worker callback in Meta setup.

## Services

- Backend: Cloudflare Workers using `services/kfc-agent-backend/src/worker.ts`.
- Database: Cloudflare D1 binding `DB`, database name `kfc-agent-demo`.
- Dashboard: Cloudflare Pages serving `apps/kfc_live_monitor_flutter/build/web`.
- Messenger: Meta webhook callback at `<WORKER_URL>/webhooks/messenger`.
- Historical fallback: Google Cloud Run script remains available, but it is not the primary demo path.

## Runtime Persistence Boundary

D1 stores runtime conversation state only:

- conversation turns and verified state snapshots
- webhook delivery/idempotency records
- dashboard events for the live monitor and proof review
- delivery status evidence for outbound channel replies

Generated fixtures are not the production database. They are bundled read-only mock responses standing in for KFC APIs that are not available in this hackathon environment. In a production integration, menu, store availability, promotions, membership, payment, and OMS facts should come from KFC-owned APIs through adapter clients, while D1 or a later production ledger remains the conversation and webhook reliability store.

## Required Cloudflare Setup

Install and authenticate Wrangler:

```bash
cd services/kfc-agent-backend
npm install
npx wrangler login
```

Create the D1 database and paste the printed `database_id` into `services/kfc-agent-backend/wrangler.toml`:

```bash
npx wrangler d1 create kfc-agent-demo
```

Apply migrations:

```bash
npm run worker:d1:migrate:remote
```

Create Worker secrets:

```bash
npx wrangler secret put MESSENGER_VERIFY_TOKEN
npx wrangler secret put META_PAGE_ACCESS_TOKEN
npx wrangler secret put OPENAI_API_KEY
```

`OPENAI_API_KEY` is optional for `/ready`; without it, `/ready` reports OpenAI as not configured but does not block the demo boot check. Messenger verification and live replies require the Messenger secrets.

## Backend Deploy

Deploy the Worker:

```bash
cd services/kfc-agent-backend
npm run worker:deploy:dry-run
cd ../..
./scripts/deploy-backend-cloudflare-worker.sh
```

After deploy, copy the printed Worker URL:

```text
https://<worker-name>.<account-subdomain>.workers.dev
```

For scripted smoke checks, set `CF_WORKER_URL` to the deployed URL before running the deploy helper.

## Messenger Setup

Configure the Meta app webhook:

```text
Callback URL: <WORKER_URL>/webhooks/messenger
Verify token: same value stored in MESSENGER_VERIFY_TOKEN
```

Subscribe the Ecomeasy Page ID:

```text
118976205445198
```

Required final smoke check:

```bash
curl -s <WORKER_URL>/health
curl -s <WORKER_URL>/ready
curl -s '<WORKER_URL>/webhooks/messenger?hub.mode=subscribe&hub.verify_token=<verify-token>&hub.challenge=demo'
```

Expected `/health`:

```json
{"ok":true,"service":"kfc-agent-backend"}
```

`/ready` must return `"ok": true` with healthy `database`, `fixtures`, and `messenger` checks before using the Messenger thread for proof.

## Dashboard Deploy

Deploy Flutter Web to Cloudflare Pages:

```bash
export CLOUDFLARE_PAGES_PROJECT='kfc-ai-live-monitor'
export CF_PAGES_BRANCH='main'
export KFC_AGENT_BACKEND_URL='<WORKER_URL>'
./scripts/deploy-dashboard-cloudflare-pages.sh
```

The dashboard uses polling endpoints against the Worker:

- `GET /dashboard/sessions`
- `GET /dashboard/sessions/:sessionId/turns`
- `GET /dashboard/events/:sessionId`

The Worker demo does not support the in-process SSE endpoint. `GET /dashboard/stream` returns `501`; use polling proof for the dashboard.

## Local Worker Checks

Run the Worker locally:

```bash
cd services/kfc-agent-backend
npm run worker:d1:migrate:local
npm run worker:dev
```

Smoke:

```bash
curl -s http://localhost:8787/health
curl -s http://localhost:8787/ready
curl -s 'http://localhost:8787/webhooks/messenger?hub.mode=subscribe&hub.verify_token=<verify-token>&hub.challenge=demo'
```

## Optional Cloud Run Fallback

Cloud Run + Neon is retained only as a fallback path for historical work. If Worker deploy is unavailable, use `scripts/deploy-backend-cloud-run.sh` and set the Messenger callback to `<CLOUD_RUN_URL>/webhooks/messenger`. Do not switch the hackathon submission to Cloud Run unless the Worker path is blocked.

## Cost Controls

- Use Cloudflare Workers Free and D1 Free for the demo window.
- Use Cloudflare Pages Free for static dashboard hosting.
- Avoid Cloudflare Tunnel as the primary callback path because tunnel URLs are easy to break during a live demo.
- Do not store API tokens in git or in Cloudflare Pages source files.

## Final Submission Proof

The final proof directory must contain:

```text
artifacts/kfc-ai-chat-ordering/proof/<timestamp>/messenger-chat-ai.mp4
artifacts/kfc-ai-chat-ordering/proof/<timestamp>/flutter-dashboard-conversation.mp4
artifacts/kfc-ai-chat-ordering/proof/<timestamp>/proof-manifest.json
```

Both videos must show the same Messenger thread or session identifier.
