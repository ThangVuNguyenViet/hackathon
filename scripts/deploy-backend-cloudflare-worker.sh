#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/kfc-agent-backend"
WORKER_NAME="${CF_WORKER_NAME:-kfc-agent-backend-demo}"
WORKER_URL="${CF_WORKER_URL:-}"

if [[ ! -d "$SERVICE_DIR" ]]; then
  echo "ERROR: Backend service directory is missing: $SERVICE_DIR" >&2
  exit 66
fi

if [[ ! -f "$SERVICE_DIR/wrangler.toml" ]]; then
  echo "ERROR: Missing $SERVICE_DIR/wrangler.toml" >&2
  exit 66
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required to deploy the Cloudflare Worker backend." >&2
  exit 69
fi

echo "Deploying Cloudflare Worker backend: $WORKER_NAME"
echo "Expected Wrangler secrets: MESSENGER_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN, optional OPENAI_API_KEY, optional KFC_DEMO_ADMIN_TOKEN"

(
  cd "$SERVICE_DIR"
  npm run build
  npm run worker:d1:migrate:remote
  npx wrangler deploy
)

echo
echo "Cloudflare Worker URL:"
if [[ -n "$WORKER_URL" ]]; then
  echo "$WORKER_URL"
else
  echo "https://$WORKER_NAME.<account-subdomain>.workers.dev"
  echo "Set CF_WORKER_URL to smoke check the exact deployed workers.dev URL."
fi

if [[ -n "$WORKER_URL" ]]; then
  echo
  echo "Smoke checking deployed Worker backend..."
  curl -fsS "$WORKER_URL/health"
  echo
  curl -fsS "$WORKER_URL/ready"
  echo
fi

echo
echo "Messenger callback URL:"
if [[ -n "$WORKER_URL" ]]; then
  echo "$WORKER_URL/webhooks/messenger"
else
  echo "https://$WORKER_NAME.<account-subdomain>.workers.dev/webhooks/messenger"
fi
