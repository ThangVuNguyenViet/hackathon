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

for name in LANGSMITH_API_KEY LANGSMITH_PROJECT LANGSMITH_ENDPOINT META_APP_SECRET META_PAGE_ACCESS_TOKEN; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name must be set in $ENV_FILE" >&2
    exit 64
  fi
done
LANGSMITH_TRACING_SAMPLING_RATE="${LANGSMITH_TRACING_SAMPLING_RATE:-1}"
KFC_AGENT_PROFILE_MODE="${KFC_AGENT_PROFILE_MODE:-production}"
KFC_AGENT_PROVIDER="${KFC_AGENT_PROVIDER:-}"
KFC_AGENT_MODEL="${KFC_AGENT_MODEL:-}"
KFC_MONITOR_PROVIDER="${KFC_MONITOR_PROVIDER:-$KFC_AGENT_PROVIDER}"
KFC_MONITOR_MODEL="${KFC_MONITOR_MODEL:-}"
KFC_CONFIRMATION_SIGNING_KEY_ID="${KFC_CONFIRMATION_SIGNING_KEY_ID:-primary}"
KFC_CONFIRMATION_SIGNING_SECRET="${KFC_CONFIRMATION_SIGNING_SECRET:-}"
KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS="${KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS:-[]}"
KFC_COMMERCE_MODE="${KFC_COMMERCE_MODE:-}"
KFC_COMMERCE_ENVIRONMENT="${KFC_COMMERCE_ENVIRONMENT:-}"
KFC_MENU_API_URL="${KFC_MENU_API_URL:-}"
KFC_COMMERCE_GATEWAY_BASE_URL="${KFC_COMMERCE_GATEWAY_BASE_URL:-}"
KFC_COMMERCE_GATEWAY_TOKEN="${KFC_COMMERCE_GATEWAY_TOKEN:-}"
KFC_SHOWCASE_DATASET="${KFC_SHOWCASE_DATASET:-kfc-showcase-scenarios-v1}"
if [[ ! "$KFC_CONFIRMATION_SIGNING_KEY_ID" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  echo "ERROR: KFC_CONFIRMATION_SIGNING_KEY_ID is invalid." >&2
  exit 64
fi
if [[ ${#KFC_CONFIRMATION_SIGNING_SECRET} -lt 32 ]]; then
  echo "ERROR: KFC_CONFIRMATION_SIGNING_SECRET must contain at least 32 bytes." >&2
  exit 64
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to validate confirmation signing key rotation." >&2
  exit 69
fi
if ! printf '%s' "$KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS" | node -e '
  const activeKeyId = process.argv[1];
  let source = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { source += chunk; });
  process.stdin.on("end", () => {
    try {
      const value = JSON.parse(source);
      const ids = new Set([activeKeyId]);
      const valid = Array.isArray(value) && value.every((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          Object.keys(entry).sort().join(",") !== "keyId,secret" ||
          typeof entry.keyId !== "string" ||
          !/^[A-Za-z0-9._-]{1,64}$/u.test(entry.keyId) ||
          typeof entry.secret !== "string" ||
          new TextEncoder().encode(entry.secret).byteLength < 32 ||
          ids.has(entry.keyId)
        ) return false;
        ids.add(entry.keyId);
        return true;
      });
      if (!valid) process.exitCode = 1;
    } catch {
      process.exitCode = 1;
    }
  });
' "$KFC_CONFIRMATION_SIGNING_KEY_ID"; then
  echo "ERROR: KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS must be a valid, unique rotation-key JSON array." >&2
  exit 64
fi
if [[ "$KFC_AGENT_PROFILE_MODE" != "production" && "$KFC_AGENT_PROFILE_MODE" != "qualification" ]]; then
  echo "ERROR: KFC_AGENT_PROFILE_MODE must be production or qualification." >&2
  exit 64
fi
if [[ "$KFC_AGENT_PROVIDER" != "google" && "$KFC_AGENT_PROVIDER" != "openai" ]]; then
  echo "ERROR: KFC_AGENT_PROVIDER must be google or openai." >&2
  exit 64
fi
if [[ "$KFC_AGENT_PROVIDER" == "google" ]]; then
  expected_agent_model="gemini-3.1-flash-lite"
else
  expected_agent_model="gpt-4.1-mini"
fi
if [[
  -n "$KFC_AGENT_MODEL" &&
  "$KFC_AGENT_MODEL" != "$expected_agent_model"
]]; then
  echo "ERROR: KFC_AGENT_MODEL must be $expected_agent_model when KFC_AGENT_PROVIDER=$KFC_AGENT_PROVIDER." >&2
  exit 64
fi
if [[ "$KFC_MONITOR_PROVIDER" != "google" && "$KFC_MONITOR_PROVIDER" != "openai" ]]; then
  echo "ERROR: KFC_MONITOR_PROVIDER must be google or openai." >&2
  exit 64
fi
if [[ "$KFC_MONITOR_PROVIDER" == "google" ]]; then
  expected_monitor_model="gemini-3.1-flash-lite"
else
  expected_monitor_model="gpt-5-mini-2025-08-07"
fi
if [[
  -n "$KFC_MONITOR_MODEL" &&
  "$KFC_MONITOR_MODEL" != "$expected_monitor_model"
]]; then
  echo "ERROR: KFC_MONITOR_MODEL must be $expected_monitor_model when KFC_MONITOR_PROVIDER=$KFC_MONITOR_PROVIDER." >&2
  exit 64
fi
if [[
  ("$KFC_AGENT_PROVIDER" == "openai" || "$KFC_MONITOR_PROVIDER" == "openai") &&
  -z "${OPENAI_API_KEY:-}"
]]; then
  echo "ERROR: OPENAI_API_KEY must be set for the selected agent or monitor provider." >&2
  exit 64
fi
if [[
  ("$KFC_AGENT_PROVIDER" == "google" || "$KFC_MONITOR_PROVIDER" == "google") &&
  -z "${GOOGLE_API_KEY:-}"
]]; then
  echo "ERROR: GOOGLE_API_KEY must be set for the selected agent or monitor provider." >&2
  exit 64
fi
if [[ "$KFC_COMMERCE_MODE" == "fixture" && "${KFC_COMMERCE_ENVIRONMENT:-}" != "sandbox" ]]; then
  echo "ERROR: fixture commerce is allowed only in the sandbox environment." >&2
  exit 64
elif [[ "$KFC_COMMERCE_MODE" == "gateway" && ( -z "${KFC_COMMERCE_ENVIRONMENT:-}" || -z "${KFC_MENU_API_URL:-}" || -z "${KFC_COMMERCE_GATEWAY_BASE_URL:-}" || -z "${KFC_COMMERCE_GATEWAY_TOKEN:-}" ) ]]; then
  echo "ERROR: deployed releases require explicit gateway commerce environment, menu API, gateway URL, and token." >&2
  exit 64
elif [[ "$KFC_COMMERCE_MODE" != "fixture" && "$KFC_COMMERCE_MODE" != "gateway" ]]; then
  echo "ERROR: KFC_COMMERCE_MODE must be fixture or gateway." >&2
  exit 64
fi
if [[ "$KFC_COMMERCE_ENVIRONMENT" == "production" ]]; then
  WRANGLER_CONFIG="${KFC_WRANGLER_CONFIG:-$SERVICE_DIR/wrangler.production.toml}"
  KFC_D1_DATABASE_NAME="${KFC_D1_DATABASE_NAME:-}"
  if [[ ! -f "$WRANGLER_CONFIG" || -z "$KFC_D1_DATABASE_NAME" ]] || grep -q 'REPLACE_WITH_DISTINCT_PRODUCTION_D1_DATABASE_ID' "$WRANGLER_CONFIG"; then
    echo "ERROR: production requires KFC_WRANGLER_CONFIG and KFC_D1_DATABASE_NAME for a distinct provisioned production D1; copy and fill wrangler.production.toml.example first." >&2
    exit 64
  fi
else
  WRANGLER_CONFIG="${KFC_WRANGLER_CONFIG:-$SERVICE_DIR/wrangler.toml}"
  KFC_D1_DATABASE_NAME="${KFC_D1_DATABASE_NAME:-kfc-agent-demo}"
fi
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
echo "Expected Wrangler secrets: META_APP_SECRET, META_PAGE_ACCESS_TOKEN, LANGSMITH_API_KEY, confirmation signing material, selected provider API keys, KFC_COMMERCE_GATEWAY_TOKEN, optional KFC_DEMO_ADMIN_TOKEN"

build_output_dir="$(mktemp -d)"
deploy_log="$build_output_dir/wrangler-deploy.log"
trap 'rm -rf "$build_output_dir"' EXIT
mkdir -p "$(dirname "$DEPLOYMENT_OUTPUT_FILE")"

(
  cd "$SERVICE_DIR"
  npm run build
  npm run worker:d1:migrate:remote -- --config "$WRANGLER_CONFIG"
  printf '%s' "$META_APP_SECRET" | npx wrangler versions secret put META_APP_SECRET --name "$WORKER_NAME"
  printf '%s' "$META_PAGE_ACCESS_TOKEN" | npx wrangler versions secret put META_PAGE_ACCESS_TOKEN --name "$WORKER_NAME"
  printf '%s' "$LANGSMITH_API_KEY" | npx wrangler versions secret put LANGSMITH_API_KEY --name "$WORKER_NAME"
  printf '%s' "$KFC_CONFIRMATION_SIGNING_SECRET" | npx wrangler versions secret put KFC_CONFIRMATION_SIGNING_SECRET --name "$WORKER_NAME"
  printf '%s' "$KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS" | npx wrangler versions secret put KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS --name "$WORKER_NAME"
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    printf '%s' "$OPENAI_API_KEY" | npx wrangler versions secret put OPENAI_API_KEY --name "$WORKER_NAME"
  fi
  if [[ -n "${GOOGLE_API_KEY:-}" ]]; then
    printf '%s' "$GOOGLE_API_KEY" | npx wrangler versions secret put GOOGLE_API_KEY --name "$WORKER_NAME"
  fi
  if [[ -n "${KFC_COMMERCE_GATEWAY_TOKEN:-}" ]]; then
    printf '%s' "$KFC_COMMERCE_GATEWAY_TOKEN" | npx wrangler versions secret put KFC_COMMERCE_GATEWAY_TOKEN --name "$WORKER_NAME"
  fi
  if [[ -n "${KFC_DEMO_ADMIN_TOKEN:-}" ]]; then
    printf '%s' "$KFC_DEMO_ADMIN_TOKEN" | npx wrangler versions secret put KFC_DEMO_ADMIN_TOKEN --name "$WORKER_NAME"
  fi
  npx wrangler deploy --config "$WRANGLER_CONFIG" --name "$WORKER_NAME" --outdir "$build_output_dir/bundle" \
    --var "RELEASE_GIT_SHA:$GIT_SHA" \
    --var "RELEASE_DEPLOYMENT_ID:$RELEASE_DEPLOYMENT_ID" \
    --var "RELEASE_BUILT_AT:$RELEASE_BUILT_AT" \
    --var "RELEASE_DIRTY:false" \
    --var "LANGSMITH_PROJECT:$LANGSMITH_PROJECT" \
    --var "LANGSMITH_ENDPOINT:$LANGSMITH_ENDPOINT" \
    --var "LANGSMITH_TRACING_SAMPLING_RATE:$LANGSMITH_TRACING_SAMPLING_RATE" \
    --var "KFC_AGENT_PROFILE_MODE:$KFC_AGENT_PROFILE_MODE" \
    --var "KFC_AGENT_PROVIDER:$KFC_AGENT_PROVIDER" \
    --var "KFC_AGENT_MODEL:$KFC_AGENT_MODEL" \
    --var "KFC_MONITOR_PROVIDER:$KFC_MONITOR_PROVIDER" \
    --var "KFC_MONITOR_MODEL:$KFC_MONITOR_MODEL" \
    --var "KFC_CONFIRMATION_SIGNING_KEY_ID:$KFC_CONFIRMATION_SIGNING_KEY_ID" \
    --var "KFC_COMMERCE_MODE:$KFC_COMMERCE_MODE" \
    --var "KFC_COMMERCE_ENVIRONMENT:$KFC_COMMERCE_ENVIRONMENT" \
    --var "KFC_MENU_API_URL:$KFC_MENU_API_URL" \
    --var "KFC_COMMERCE_GATEWAY_BASE_URL:$KFC_COMMERCE_GATEWAY_BASE_URL" \
    --var "KFC_SHOWCASE_DATASET:$KFC_SHOWCASE_DATASET" \
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
printf '{"gitSha":"%s","deploymentId":"%s","releaseBuiltAt":"%s","dirty":false,"deployedAt":"%s","workerName":"%s","workerUrl":"%s","agentProfileMode":"%s","agentProvider":"%s","agentModelSelector":"%s","monitorProvider":"%s","monitorModel":"%s"}\n' \
  "$GIT_SHA" "$RELEASE_DEPLOYMENT_ID" "$RELEASE_BUILT_AT" "$deployed_at" "$WORKER_NAME" "$WORKER_URL" "$KFC_AGENT_PROFILE_MODE" "$KFC_AGENT_PROVIDER" "$KFC_AGENT_MODEL" "$KFC_MONITOR_PROVIDER" "$KFC_MONITOR_MODEL" > "$DEPLOYMENT_OUTPUT_FILE"

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
