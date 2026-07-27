#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/kfc-agent-backend"
WORKER_NAME="${CF_WORKER_NAME:-kfc-agent-backend-demo}"
WORKER_URL="${CF_WORKER_URL:-}"
DEPLOYMENT_OUTPUT_FILE="${DEPLOYMENT_OUTPUT_FILE:-$ROOT_DIR/artifacts/deployment/worker-deployment.json}"
GIT_SHA="${RELEASE_GIT_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
RELEASE_BUILT_AT="${RELEASE_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
RELEASE_DEPLOYMENT_ID="${RELEASE_DEPLOYMENT_ID:-worker-${GIT_SHA:0:12}-${RELEASE_BUILT_AT//[^0-9]/}}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ "${ALLOW_NON_MAIN_DEPLOY:-false}" != "true" ]]; then
  git -C "$ROOT_DIR" fetch --quiet origin main
  main_sha="$(git -C "$ROOT_DIR" rev-parse refs/remotes/origin/main)"
  head_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  if [[ "$GIT_SHA" != "$head_sha" || "$GIT_SHA" != "$main_sha" ]]; then
    echo "ERROR: Refusing to deploy a Worker release that is not the current origin/main." >&2
    echo "release=$GIT_SHA head=$head_sha origin_main=$main_sha" >&2
    echo "Set ALLOW_NON_MAIN_DEPLOY=true only for an intentional non-production branch deployment." >&2
    exit 67
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing deployment environment file: $ENV_FILE" >&2
  exit 66
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[
  -n "${KFC_AGENT_PROVIDER+x}" ||
  -n "${KFC_AGENT_MODEL+x}" ||
  -n "${KFC_MONITOR_PROVIDER+x}" ||
  -n "${KFC_MONITOR_MODEL+x}"
]]; then
  echo "ERROR: KFC_AGENT_PROVIDER, KFC_AGENT_MODEL, KFC_MONITOR_PROVIDER, and KFC_MONITOR_MODEL are no longer supported; use KFC_AGENT_CANDIDATE and optional KFC_MONITOR_CANDIDATE." >&2
  exit 64
fi

candidate_is_valid() {
  case "$1" in
    openai-gpt-4.1-mini | deepseek-v4-flash | qwen3.7-max | minimax-m3 | google-gemini-3.1-flash-lite)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

candidate_credential_env() {
  case "$1" in
    openai-gpt-4.1-mini)
      printf '%s' "OPENAI_API_KEY"
      ;;
    deepseek-v4-flash | qwen3.7-max | minimax-m3)
      printf '%s' "OPENCODE_API_KEY"
      ;;
    google-gemini-3.1-flash-lite)
      printf '%s' "GOOGLE_API_KEY"
      ;;
  esac
}

for name in LANGSMITH_API_KEY LANGSMITH_PROJECT LANGSMITH_ENDPOINT META_APP_SECRET; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name must be set in $ENV_FILE" >&2
    exit 64
  fi
done
LANGSMITH_TRACING_SAMPLING_RATE="${LANGSMITH_TRACING_SAMPLING_RATE:-1}"
KFC_AGENT_CANDIDATE="${KFC_AGENT_CANDIDATE:-openai-gpt-4.1-mini}"
KFC_MONITOR_CANDIDATE="${KFC_MONITOR_CANDIDATE:-$KFC_AGENT_CANDIDATE}"
KFC_SHOWCASE_DATASET="${KFC_SHOWCASE_DATASET:-kfc-showcase-scenarios-v1}"
if ! candidate_is_valid "$KFC_AGENT_CANDIDATE"; then
  echo "ERROR: Unknown KFC_AGENT_CANDIDATE: $KFC_AGENT_CANDIDATE" >&2
  exit 64
fi
if ! candidate_is_valid "$KFC_MONITOR_CANDIDATE"; then
  echo "ERROR: Unknown KFC_MONITOR_CANDIDATE: $KFC_MONITOR_CANDIDATE" >&2
  exit 64
fi
agent_credential_env="$(candidate_credential_env "$KFC_AGENT_CANDIDATE")"
monitor_credential_env="$(candidate_credential_env "$KFC_MONITOR_CANDIDATE")"
if [[ -z "${!agent_credential_env:-}" ]]; then
  echo "ERROR: $agent_credential_env must be set for KFC_AGENT_CANDIDATE=$KFC_AGENT_CANDIDATE." >&2
  exit 64
fi
if [[ -z "${!monitor_credential_env:-}" ]]; then
  echo "ERROR: $monitor_credential_env must be set for KFC_MONITOR_CANDIDATE=$KFC_MONITOR_CANDIDATE." >&2
  exit 64
fi
for name in \
  KFC_RECOMMENDATION_SHADOW_URL \
  KFC_RECOMMENDATION_SHADOW_MODEL_REVISION \
  SANITY_PROJECT_ID \
  SANITY_DATASET \
  SANITY_API_VERSION; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name must be set for recommendation qualification." >&2
    exit 64
  fi
done
KFC_RECOMMENDATION_OUTPUT_MODE="${KFC_RECOMMENDATION_OUTPUT_MODE:-baseline}"
if [[ ! "$KFC_RECOMMENDATION_SHADOW_URL" =~ ^https://[^[:space:]]+$ ]]; then
  echo "ERROR: KFC_RECOMMENDATION_SHADOW_URL must be an HTTPS URL." >&2
  exit 64
fi
if [[ ! "$KFC_RECOMMENDATION_SHADOW_MODEL_REVISION" =~ ^[a-f0-9]{40,64}$ ]]; then
  echo "ERROR: KFC_RECOMMENDATION_SHADOW_MODEL_REVISION must be an immutable hexadecimal revision." >&2
  exit 64
fi
if [[ "$KFC_RECOMMENDATION_OUTPUT_MODE" != "baseline" ]]; then
  echo "ERROR: Live qualification requires KFC_RECOMMENDATION_OUTPUT_MODE=baseline." >&2
  exit 64
fi
if [[ "$SANITY_DATASET" != "production" ]]; then
  echo "ERROR: Live qualification requires the public Sanity production dataset." >&2
  exit 64
fi
if [[ ! "$SANITY_API_VERSION" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "ERROR: SANITY_API_VERSION must be a YYYY-MM-DD version." >&2
  exit 64
fi
WRANGLER_CONFIG="${KFC_WRANGLER_CONFIG:-$SERVICE_DIR/wrangler.toml}"
KFC_D1_DATABASE_NAME="${KFC_D1_DATABASE_NAME:-kfc-agent-demo}"
export KFC_D1_DATABASE_NAME

if [[ "${KFC_DEPLOY_PREFLIGHT_ONLY:-false}" == "true" ]]; then
  echo "Cloudflare Worker deployment preflight passed."
  exit 0
fi

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
echo "Expected Wrangler secrets: META_APP_SECRET, LANGSMITH_API_KEY, selected provider API keys, optional KFC_DEMO_ADMIN_TOKEN"

build_output_dir="$(mktemp -d)"
deploy_log="$build_output_dir/wrangler-deploy.log"
trap 'rm -rf "$build_output_dir"' EXIT
mkdir -p "$(dirname "$DEPLOYMENT_OUTPUT_FILE")"

(
  cd "$SERVICE_DIR"
  npm run build
  npm run worker:d1:migrate:remote -- --config "$WRANGLER_CONFIG"
  printf '%s' "$META_APP_SECRET" | npx wrangler versions secret put META_APP_SECRET --name "$WORKER_NAME"
  printf '%s' "$LANGSMITH_API_KEY" | npx wrangler versions secret put LANGSMITH_API_KEY --name "$WORKER_NAME"
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    printf '%s' "$OPENAI_API_KEY" | npx wrangler versions secret put OPENAI_API_KEY --name "$WORKER_NAME"
  fi
  if [[ -n "${OPENCODE_API_KEY:-}" ]]; then
    printf '%s' "$OPENCODE_API_KEY" | npx wrangler versions secret put OPENCODE_API_KEY --name "$WORKER_NAME"
  fi
  if [[ -n "${GOOGLE_API_KEY:-}" ]]; then
    printf '%s' "$GOOGLE_API_KEY" | npx wrangler versions secret put GOOGLE_API_KEY --name "$WORKER_NAME"
  fi
  if [[ -n "${KFC_DEMO_ADMIN_TOKEN:-}" ]]; then
    printf '%s' "$KFC_DEMO_ADMIN_TOKEN" | npx wrangler versions secret put KFC_DEMO_ADMIN_TOKEN --name "$WORKER_NAME"
  fi
  if [[ -n "${SANITY_READ_TOKEN:-}" ]]; then
    printf '%s' "$SANITY_READ_TOKEN" | npx wrangler versions secret put SANITY_READ_TOKEN --name "$WORKER_NAME"
  fi
  npx wrangler deploy --config "$WRANGLER_CONFIG" --name "$WORKER_NAME" --outdir "$build_output_dir/bundle" \
    --var "RELEASE_GIT_SHA:$GIT_SHA" \
    --var "RELEASE_DEPLOYMENT_ID:$RELEASE_DEPLOYMENT_ID" \
    --var "RELEASE_BUILT_AT:$RELEASE_BUILT_AT" \
    --var "RELEASE_DIRTY:false" \
    --var "LANGSMITH_PROJECT:$LANGSMITH_PROJECT" \
    --var "LANGSMITH_ENDPOINT:$LANGSMITH_ENDPOINT" \
    --var "LANGSMITH_TRACING_SAMPLING_RATE:$LANGSMITH_TRACING_SAMPLING_RATE" \
    --var "KFC_AGENT_CANDIDATE:$KFC_AGENT_CANDIDATE" \
    --var "KFC_MONITOR_CANDIDATE:$KFC_MONITOR_CANDIDATE" \
    --var "KFC_SHOWCASE_DATASET:$KFC_SHOWCASE_DATASET" \
    --var "KFC_RECOMMENDATION_SHADOW_URL:$KFC_RECOMMENDATION_SHADOW_URL" \
    --var "KFC_RECOMMENDATION_SHADOW_MODEL_REVISION:$KFC_RECOMMENDATION_SHADOW_MODEL_REVISION" \
    --var "KFC_RECOMMENDATION_OUTPUT_MODE:$KFC_RECOMMENDATION_OUTPUT_MODE" \
    --var "SANITY_PROJECT_ID:$SANITY_PROJECT_ID" \
    --var "SANITY_DATASET:$SANITY_DATASET" \
    --var "SANITY_API_VERSION:$SANITY_API_VERSION" \
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
printf '{"gitSha":"%s","deploymentId":"%s","releaseBuiltAt":"%s","dirty":false,"deployedAt":"%s","workerName":"%s","workerUrl":"%s","agentCandidate":"%s","monitorCandidate":"%s","recommendationShadowUrl":"%s","recommendationShadowModelRevision":"%s","recommendationOutputMode":"%s","sanityProjectId":"%s","sanityDataset":"%s","sanityApiVersion":"%s"}\n' \
  "$GIT_SHA" "$RELEASE_DEPLOYMENT_ID" "$RELEASE_BUILT_AT" "$deployed_at" "$WORKER_NAME" "$WORKER_URL" "$KFC_AGENT_CANDIDATE" "$KFC_MONITOR_CANDIDATE" "$KFC_RECOMMENDATION_SHADOW_URL" "$KFC_RECOMMENDATION_SHADOW_MODEL_REVISION" "$KFC_RECOMMENDATION_OUTPUT_MODE" "$SANITY_PROJECT_ID" "$SANITY_DATASET" "$SANITY_API_VERSION" > "$DEPLOYMENT_OUTPUT_FILE"

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
