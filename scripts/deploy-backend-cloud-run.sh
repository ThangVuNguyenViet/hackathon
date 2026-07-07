#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/kfc-agent-backend"

PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-asia-southeast1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-kfc-agent-backend}"
DASHBOARD_ORIGIN="${DASHBOARD_ORIGIN:-}"
MAX_INSTANCES="${CLOUD_RUN_MAX_INSTANCES:-2}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: Set GCP_PROJECT_ID to the Google Cloud project used for the hackathon deploy." >&2
  exit 64
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
  "META_PAGE_ID=118976205445198"
)

if [[ -n "$DASHBOARD_ORIGIN" ]]; then
  env_vars+=("DASHBOARD_ORIGIN=$DASHBOARD_ORIGIN")
fi

env_var_arg="$(IFS=,; echo "${env_vars[*]}")"

secret_arg="DATABASE_URL=DATABASE_URL:latest,MESSENGER_VERIFY_TOKEN=MESSENGER_VERIFY_TOKEN:latest,META_PAGE_ACCESS_TOKEN=META_PAGE_ACCESS_TOKEN:latest,META_APP_SECRET=META_APP_SECRET:latest"

echo "Deploying $SERVICE_NAME to Cloud Run project=$PROJECT_ID region=$REGION"
echo "Expected Secret Manager secrets: DATABASE_URL, MESSENGER_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN, META_APP_SECRET"

gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source "$SERVICE_DIR" \
  --allow-unauthenticated \
  --max-instances "$MAX_INSTANCES" \
  --memory 512Mi \
  --cpu 1 \
  --timeout 60 \
  --set-env-vars "$env_var_arg" \
  --set-secrets "$secret_arg"

echo
echo "Cloud Run URL:"
gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)'
