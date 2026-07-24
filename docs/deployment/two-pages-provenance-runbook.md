# Two-Pages Deployment and Provenance Runbook

This runbook deploys one backend Worker and two Flutter Pages projects from one clean commit:

- customer chatbot: `kfc-ai-chatbot`
- operations monitor: `kfc-ai-live-monitor`

Both Pages artifacts contain the same `/release.json` values: `gitSha`, `releaseBuiltAt`, and `dirty: false`. The deployment helper refuses a dirty worktree and builds with `--pwa-strategy=none`, preventing an old service worker from hiding a newly deployed release.

## Prerequisites

Authenticate Wrangler and configure the Worker secrets described in `hackathon-free-deploy.md`. The two Pages projects must already exist. Run every command from the repository root.

The checked-in Worker is the fixture-backed demo application. It has no
production commerce mode or production Wrangler template. A future production
migration must replace the bundled mock providers and fixtures explicitly.

## 1. Verify a clean source commit

```bash
git status --short
git rev-parse HEAD
```

Do not continue unless `git status --short` is empty. The Pages script enforces this because the release contract requires `dirty=false`.

## 2. Deploy the backend Worker

```bash
DEPLOYMENT_OUTPUT_FILE=artifacts/deployment/worker-deployment.json \
  ./scripts/deploy-backend-cloudflare-worker.sh
```

The script builds the Worker, applies remote D1 migrations, deploys it, derives the actual `workers.dev` URL from Wrangler output, checks `/health` and `/ready`, and writes machine-readable deployment metadata.

If Wrangler does not print the URL for the account configuration, provide the verified URL explicitly:

```bash
CF_WORKER_URL=https://verified-worker.example.workers.dev \
  ./scripts/deploy-backend-cloudflare-worker.sh
```

## 3. Deploy both Pages projects

Read the Worker target from the previous deployment artifact and deploy both Pages surfaces:

```bash
export KFC_AGENT_BACKEND_URL="$(jq -r .workerUrl artifacts/deployment/worker-deployment.json)"
DEPLOYMENT_OUTPUT_FILE=artifacts/deployment/pages-deployment.json \
  ./scripts/deploy-dashboard-cloudflare-pages.sh
```

The helper uses one `gitSha` and one `releaseBuiltAt` for both builds. It updates the `KFC_AGENT_BACKEND_URL` Pages secret for each project before deploying, so no backend URL is committed into `_worker.js`.

The chatbot proxy permits `/ready`, `/chat/kfc/message`, and `/chat/kfc/genui-action`. The monitor proxy permits `/ready` and `/dashboard/*`, including the `/dashboard/socket` live WebSocket transport. Other requests are served as static Flutter assets.

## 4. Verify provenance and routing

```bash
CHATBOT_URL="$(jq -r .deployments.chatbot.url artifacts/deployment/pages-deployment.json)"
MONITOR_URL="$(jq -r .deployments.monitor.url artifacts/deployment/pages-deployment.json)"

curl -fsS "$CHATBOT_URL/release.json" | jq .
curl -fsS "$MONITOR_URL/release.json" | jq .
curl -fsS "$CHATBOT_URL/ready" | jq .
curl -fsS "$MONITOR_URL/ready" | jq .

diff \
  <(curl -fsS "$CHATBOT_URL/release.json") \
  <(curl -fsS "$MONITOR_URL/release.json")
```

The `diff` must be empty. Confirm that both responses match the current `git rev-parse HEAD`, share the same `releaseBuiltAt`, and report `dirty` as `false`.

## 5. Exercise the deployed agent

Open the chatbot URL and run the intended conversations directly. The backend
uses the selected model for natural tool choice and response composition while
the menu, cart, store, fulfillment, order, and payment capabilities use the
bundled fixture provider. There is no scripted deployed qualification gate.

Finally, open the monitor to confirm session polling and the live socket.
Preserve `worker-deployment.json` and `pages-deployment.json` with any demo
artifacts you choose to keep.
