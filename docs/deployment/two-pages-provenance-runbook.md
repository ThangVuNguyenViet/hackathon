# Two-Pages Deployment and Provenance Runbook

This runbook deploys one backend Worker and two Flutter Pages projects from one clean commit:

- customer chatbot: `kfc-ai-chatbot`
- operations monitor: `kfc-ai-live-monitor`

Both Pages artifacts contain the same `/release.json` values: `gitSha`, `releaseBuiltAt`, and `dirty: false`. The deployment helper refuses a dirty worktree and builds with `--pwa-strategy=none`, preventing an old service worker from hiding a newly deployed release.

## Prerequisites

Authenticate Wrangler and configure the Worker secrets described in `hackathon-free-deploy.md`. The two Pages projects must already exist. Run every command from the repository root.

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

## 5. Run the deployed acceptance and outcome judge

The full acceptance runner replays all nine canonical browser scenarios, writes the redacted `outcome-evidence.json` input with scenario metadata/use cases, durable turns, monitor events, tool summaries, and GenUI summaries, then checks D1 durability after a same-release Worker redeploy. It invokes the live outcome judge only in this acceptance phase and loads credentials from the workspace `.env` for that phase. The caller environment takes precedence for a caller-selected `OUTCOME_JUDGE_MODEL`; `.env` supplies it only when the caller did not provide one:

```bash
OUTCOME_JUDGE_MODEL=${OUTCOME_JUDGE_MODEL:-gpt-4.1-mini} \
  ./scripts/run-kfc-deployed-acceptance.sh
```

The judge model is configured with `OUTCOME_JUDGE_MODEL` and the request timeout with `OUTCOME_JUDGE_TIMEOUT_MS` (default `60000` ms). The runner fails closed on missing or malformed model output and requires exactly nine `passed: true` judgments whose `gitSha`, `releaseBuiltAt`, and `dirty` fields match `release.json`.

The resulting `artifacts/kfc-deployed-proof/<run-id>/outcome-judgments.json` is scanned for secrets, included in `SHA256SUMS`, `proof-bundle.tar.gz`, and the GitHub release. Deployment provenance, HTTP/browser transport, and post-redeploy durability remain hard gates; the LLM score and rationale are supplemental quality evidence and cannot make a failed hard gate pass.

The proof run ID is used as an artifact-directory name and must contain only ASCII letters, digits, `.`, `_`, or `-`; slashes, traversal segments, and control characters are rejected. Release metadata is serialized as JSON, and publication hygiene scans binary screenshots as well as text artifacts.

Finally, open the monitor to confirm session polling and the live socket. Preserve `worker-deployment.json` and `pages-deployment.json` with the demo proof artifacts.
