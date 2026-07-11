#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/kfc-agent-backend"
WORKER_NAME="${CF_WORKER_NAME:-kfc-agent-backend-demo}"
WORKER_URL="${CF_WORKER_URL:-}"
DEPLOYMENT_OUTPUT_FILE="${DEPLOYMENT_OUTPUT_FILE:-$ROOT_DIR/artifacts/deployment/worker-deployment.json}"
GIT_SHA="${RELEASE_GIT_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
RELEASE_BUILT_AT="${RELEASE_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing deployment environment file: $ENV_FILE" >&2
  exit 66
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for name in LANGSMITH_API_KEY LANGSMITH_PROJECT LANGSMITH_ENDPOINT; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name must be set in $ENV_FILE" >&2
    exit 64
  fi
done
LANGSMITH_TRACING_SAMPLING_RATE="${LANGSMITH_TRACING_SAMPLING_RATE:-1}"
OPENAI_TOOL_PLANNER_MODEL="${OPENAI_TOOL_PLANNER_MODEL:-gpt-4.1}"
OPENAI_SMALL_TALK_ROUTER_MODEL="${OPENAI_SMALL_TALK_ROUTER_MODEL:-gpt-4.1-nano}"
OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS="${OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS:-2500}"

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" && "${ALLOW_DIRTY_DEPLOY:-false}" != "true" ]]; then
  echo "ERROR: Refusing to deploy acceptance Worker from a dirty worktree." >&2
  exit 65
fi

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
echo "Expected Wrangler secrets: MESSENGER_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN, OPENAI_API_KEY, LANGSMITH_API_KEY, optional KFC_DEMO_ADMIN_TOKEN"

build_output_dir="$(mktemp -d)"
deploy_log="$build_output_dir/wrangler-deploy.log"
trap 'rm -rf "$build_output_dir"' EXIT
mkdir -p "$(dirname "$DEPLOYMENT_OUTPUT_FILE")"

(
  cd "$SERVICE_DIR"
  npm run build
  npm run worker:d1:migrate:remote
  printf '%s' "$LANGSMITH_API_KEY" | npx wrangler versions secret put LANGSMITH_API_KEY --name "$WORKER_NAME"
  npx wrangler deploy --name "$WORKER_NAME" --outdir "$build_output_dir/bundle" \
    --var "RELEASE_GIT_SHA:$GIT_SHA" \
    --var "RELEASE_BUILT_AT:$RELEASE_BUILT_AT" \
    --var "RELEASE_DIRTY:false" \
    --var "LANGSMITH_PROJECT:$LANGSMITH_PROJECT" \
    --var "LANGSMITH_ENDPOINT:$LANGSMITH_ENDPOINT" \
    --var "LANGSMITH_TRACING_SAMPLING_RATE:$LANGSMITH_TRACING_SAMPLING_RATE" \
    --var "OPENAI_TOOL_PLANNER_MODEL:$OPENAI_TOOL_PLANNER_MODEL" \
    --var "OPENAI_SMALL_TALK_ROUTER_MODEL:$OPENAI_SMALL_TALK_ROUTER_MODEL" \
    --var "OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS:$OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS" \
    | tee "$deploy_log"
)

if [[ -z "$WORKER_URL" ]]; then
  WORKER_URL="$(grep -Eo 'https://[^[:space:]]+\.workers\.dev' "$deploy_log" | tail -1 || true)"
fi
if [[ -z "$WORKER_URL" ]]; then
  echo "ERROR: Wrangler did not report a workers.dev URL; set CF_WORKER_URL explicitly." >&2
  exit 70
fi

deployed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"gitSha":"%s","releaseBuiltAt":"%s","dirty":false,"deployedAt":"%s","workerName":"%s","workerUrl":"%s"}\n' \
  "$GIT_SHA" "$RELEASE_BUILT_AT" "$deployed_at" "$WORKER_NAME" "$WORKER_URL" > "$DEPLOYMENT_OUTPUT_FILE"

echo
echo "Cloudflare Worker URL:"
echo "$WORKER_URL"
echo "Deployment metadata: $DEPLOYMENT_OUTPUT_FILE"

echo
echo "Smoke checking deployed Worker backend..."
curl -fsS "$WORKER_URL/health"
echo
curl -fsS "$WORKER_URL/ready?deep=1"
echo

echo
echo "Messenger callback URL:"
echo "$WORKER_URL/webhooks/messenger"
