#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/kfc-agent-backend"

PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-asia-southeast1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-kfc-agent-backend}"
DASHBOARD_ORIGIN="${DASHBOARD_ORIGIN:-}"
MAX_INSTANCES="${CLOUD_RUN_MAX_INSTANCES:-2}"
MIN_INSTANCES="${CLOUD_RUN_MIN_INSTANCES:-0}"
META_PAGE_ID="${META_PAGE_ID:-}"

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

KFC_AGENT_CANDIDATE="${KFC_AGENT_CANDIDATE:-openai-gpt-4.1-mini}"
KFC_MONITOR_CANDIDATE="${KFC_MONITOR_CANDIDATE:-$KFC_AGENT_CANDIDATE}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: Set GCP_PROJECT_ID to the Google Cloud project used for the hackathon deploy." >&2
  exit 64
fi

if [[ -z "$META_PAGE_ID" ]]; then
  echo "ERROR: Set META_PAGE_ID to the Messenger Page ID for this Cloud Run deployment." >&2
  exit 64
fi

if ! candidate_is_valid "$KFC_AGENT_CANDIDATE"; then
  echo "ERROR: Unknown KFC_AGENT_CANDIDATE: $KFC_AGENT_CANDIDATE" >&2
  exit 64
fi
if ! candidate_is_valid "$KFC_MONITOR_CANDIDATE"; then
  echo "ERROR: Unknown KFC_MONITOR_CANDIDATE: $KFC_MONITOR_CANDIDATE" >&2
  exit 64
fi

if [[ "${KFC_DEPLOY_PREFLIGHT_ONLY:-false}" == "true" ]]; then
  echo "Cloud Run deployment profile preflight passed."
  exit 0
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI is required. Install and authenticate it before deploying Cloud Run." >&2
  exit 69
fi

if [[ ! -d "$SERVICE_DIR" ]]; then
  echo "ERROR: Backend service directory is missing: $SERVICE_DIR" >&2
  echo "Run the backend implementation plan before deploying Cloud Run." >&2
  exit 66
fi

if [[ ! -f "$SERVICE_DIR/package.json" ]]; then
  echo "ERROR: Missing $SERVICE_DIR/package.json" >&2
  exit 66
fi

if [[ ! -f "$SERVICE_DIR/Dockerfile" ]]; then
  echo "ERROR: Missing $SERVICE_DIR/Dockerfile" >&2
  echo "Add the backend Dockerfile before running this deploy script." >&2
  exit 66
fi

env_vars=(
  "NODE_ENV=production"
  "META_PAGE_ID=$META_PAGE_ID"
  "KFC_AGENT_CANDIDATE=$KFC_AGENT_CANDIDATE"
  "KFC_MONITOR_CANDIDATE=$KFC_MONITOR_CANDIDATE"
)

if [[ -n "$DASHBOARD_ORIGIN" ]]; then
  env_vars+=("DASHBOARD_ORIGIN=$DASHBOARD_ORIGIN")
fi

env_var_arg="$(IFS=,; echo "${env_vars[*]}")"

secret_vars=(
  "DATABASE_URL=DATABASE_URL:latest"
  "MESSENGER_VERIFY_TOKEN=MESSENGER_VERIFY_TOKEN:latest"
  "META_PAGE_ACCESS_TOKEN=META_PAGE_ACCESS_TOKEN:latest"
)
agent_credential_env="$(candidate_credential_env "$KFC_AGENT_CANDIDATE")"
monitor_credential_env="$(candidate_credential_env "$KFC_MONITOR_CANDIDATE")"
if [[ "$agent_credential_env" == "OPENAI_API_KEY" || "$monitor_credential_env" == "OPENAI_API_KEY" ]]; then
  secret_vars+=("OPENAI_API_KEY=OPENAI_API_KEY:latest")
fi
if [[ "$agent_credential_env" == "OPENCODE_API_KEY" || "$monitor_credential_env" == "OPENCODE_API_KEY" ]]; then
  secret_vars+=("OPENCODE_API_KEY=OPENCODE_API_KEY:latest")
fi
if [[ "$agent_credential_env" == "GOOGLE_API_KEY" || "$monitor_credential_env" == "GOOGLE_API_KEY" ]]; then
  secret_vars+=("GOOGLE_API_KEY=GOOGLE_API_KEY:latest")
fi
secret_arg="$(IFS=,; echo "${secret_vars[*]}")"

echo "Deploying $SERVICE_NAME to Cloud Run project=$PROJECT_ID region=$REGION"
echo "Expected Secret Manager bindings: $secret_arg"

gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source "$SERVICE_DIR" \
  --allow-unauthenticated \
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --memory 512Mi \
  --cpu 1 \
  --timeout 60 \
  --set-env-vars "$env_var_arg" \
  --set-secrets "$secret_arg"

service_url="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"

echo
echo "Cloud Run URL:"
echo "$service_url"

echo
echo "Smoke checking deployed backend..."
curl -fsS "$service_url/health"
echo
curl -fsS "$service_url/ready?deep=1"
echo
