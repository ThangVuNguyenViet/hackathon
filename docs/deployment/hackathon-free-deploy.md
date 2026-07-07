# Hackathon Free Deployment

This deployment shape is optimized for a stable hackathon submission while keeping the always-on cost at or near zero.

## Target Architecture

```text
Messenger Page 118976205445198
  -> Cloud Run backend HTTPS URL
  -> Fastify + LangGraph agent
  -> Neon Postgres
  -> Flutter dashboard on Cloudflare Pages
```

Use the same backend URL for the Messenger webhook and the dashboard API base URL.

## Services

- Backend: Google Cloud Run, region `asia-southeast1`, max instances `2`.
- Database: Neon Free Postgres.
- Dashboard: Cloudflare Pages serving `apps/kfc_live_monitor_flutter/build/web`.
- Messenger: Meta webhook callback at `<CLOUD_RUN_URL>/webhooks/messenger`.

## Required Secrets

Create these in Google Cloud Secret Manager before deploying Cloud Run:

```bash
printf '%s' '<neon-postgres-url>' | gcloud secrets create DATABASE_URL --data-file=-
printf '%s' '<openai-api-key>' | gcloud secrets create OPENAI_API_KEY --data-file=-
printf '%s' '<verify-token>' | gcloud secrets create MESSENGER_VERIFY_TOKEN --data-file=-
printf '%s' '<page-access-token>' | gcloud secrets create META_PAGE_ACCESS_TOKEN --data-file=-
```

If a secret already exists, add a new version instead:

```bash
printf '%s' '<value>' | gcloud secrets versions add SECRET_NAME --data-file=-
```

## Backend Deploy

Prerequisites:

- `gcloud auth login`
- `gcloud config set project <project-id>`
- billing enabled on the project
- Secret Manager API, Cloud Run API, Cloud Build API, and Artifact Registry API enabled
- `services/kfc-agent-backend/Dockerfile` exists

Deploy:

```bash
export GCP_PROJECT_ID='<project-id>'
export GCP_REGION='asia-southeast1'
export CLOUD_RUN_SERVICE='kfc-agent-backend'
export DASHBOARD_ORIGIN='https://<cloudflare-pages-domain>'
./scripts/deploy-backend-cloud-run.sh
```

After deploy, copy the printed Cloud Run URL.

## Messenger Setup

Configure the Meta app webhook:

```text
Callback URL: <CLOUD_RUN_URL>/webhooks/messenger
Verify token: same value stored in MESSENGER_VERIFY_TOKEN
```

Subscribe the Ecomeasy Page ID:

```text
118976205445198
```

Required final smoke check:

```bash
curl -s <CLOUD_RUN_URL>/health
```

Expected:

```json
{"ok":true,"service":"kfc-agent-backend"}
```

## Dashboard Deploy

Deploy Flutter Web to Cloudflare Pages:

```bash
export CLOUDFLARE_PAGES_PROJECT='kfc-ai-live-monitor'
export CF_PAGES_BRANCH='main'
export KFC_AGENT_BACKEND_URL='<CLOUD_RUN_URL>'
./scripts/deploy-dashboard-cloudflare-pages.sh
```

The dashboard URL is the stable URL to submit for the operator view. The Messenger conversation proof uses the Messenger thread URL plus the Cloud Run webhook.

## Cost Controls

- Keep Cloud Run `CLOUD_RUN_MAX_INSTANCES=2` for the hackathon.
- Use Neon Free for the shared Postgres database.
- Use Cloudflare Pages Free for static dashboard hosting.
- Set a Google Cloud budget alert for the project.
- Do not store API tokens in git or in Cloudflare Pages source files.

## Final Submission Proof

The final proof directory must contain:

```text
artifacts/kfc-ai-chat-ordering/proof/<timestamp>/messenger-chat-ai.mp4
artifacts/kfc-ai-chat-ordering/proof/<timestamp>/flutter-dashboard-conversation.mp4
artifacts/kfc-ai-chat-ordering/proof/<timestamp>/proof-manifest.json
```

Both videos must show the same Messenger thread or session identifier.
