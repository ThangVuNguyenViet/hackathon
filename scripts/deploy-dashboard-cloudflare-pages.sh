#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/kfc_live_monitor_flutter"
PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-kfc-ai-live-monitor}"
BRANCH_NAME="${CF_PAGES_BRANCH:-main}"
DEFAULT_WORKER_URL="https://kfc-agent-backend-demo.thangvnv0806.workers.dev"
BACKEND_BASE_URL="${KFC_AGENT_BACKEND_URL:-${KFC_BACKEND_BASE_URL:-/}}"

# Set KFC_AGENT_BACKEND_URL to a full backend URL for direct CORS mode.
# The default is same-origin Pages mode, where web/_worker.js proxies API calls
# to the deployed KFC Worker so the browser never has to cross origins.

if [[ ! -d "$APP_DIR" ]]; then
  echo "ERROR: Flutter dashboard app is missing: $APP_DIR" >&2
  exit 66
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "ERROR: flutter CLI is required to build the dashboard." >&2
  exit 69
fi

if command -v wrangler >/dev/null 2>&1; then
  wrangler_cmd=(wrangler)
elif command -v npx >/dev/null 2>&1; then
  wrangler_cmd=(npx --yes wrangler)
else
  echo "ERROR: Install wrangler or Node.js/npx to deploy Cloudflare Pages." >&2
  exit 69
fi

cd "$APP_DIR"

build_args=(build web --release)
build_args+=(--dart-define "KFC_AGENT_BACKEND_URL=$BACKEND_BASE_URL")

flutter pub get
flutter "${build_args[@]}"

"${wrangler_cmd[@]}" pages deploy build/web \
  --project-name "$PROJECT_NAME" \
  --branch "$BRANCH_NAME"
