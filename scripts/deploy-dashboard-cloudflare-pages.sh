#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/kfc_live_monitor_flutter"
BRANCH_NAME="${CF_PAGES_BRANCH:-main}"
BACKEND_BASE_URL="${KFC_AGENT_BACKEND_URL:-${KFC_BACKEND_BASE_URL:-}}"
DEPLOYMENT_OUTPUT_FILE="${DEPLOYMENT_OUTPUT_FILE:-$ROOT_DIR/artifacts/deployment/pages-deployment.json}"

if [[ -z "$BACKEND_BASE_URL" ]]; then
  echo "ERROR: Set KFC_AGENT_BACKEND_URL to the deployed Cloudflare Worker URL." >&2
  exit 64
fi
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "ERROR: Refusing to deploy from a dirty worktree; both Pages releases require dirty=false." >&2
  exit 65
fi

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
RELEASE_BUILT_AT="${RELEASE_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

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

build_root="$(mktemp -d)"
trap 'rm -rf "$build_root"' EXIT
mkdir -p "$(dirname "$DEPLOYMENT_OUTPUT_FILE")"

cd "$APP_DIR"
flutter pub get

deploy_surface() {
  local surface="$1"
  local target="$2"
  local project="$3"
  local output_dir="$build_root/$surface"
  local log_file="$build_root/$surface-deploy.log"

  flutter build web --release --pwa-strategy=none \
    --target "$target" \
    --dart-define "KFC_AGENT_BACKEND_URL=/" >&2
  mkdir -p "$output_dir"
  cp -R build/web/. "$output_dir/"
  "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh" \
    --surface "$surface" \
    --output-dir "$output_dir" \
    --git-sha "$GIT_SHA" \
    --release-built-at "$RELEASE_BUILT_AT" \
    --dirty false

  printf '%s' "$BACKEND_BASE_URL" | "${wrangler_cmd[@]}" pages secret put \
    KFC_AGENT_BACKEND_URL --project-name "$project" >&2
  "${wrangler_cmd[@]}" pages deploy "$output_dir" \
    --project-name "$project" \
    --branch "$BRANCH_NAME" \
    --commit-hash "$GIT_SHA" \
    --commit-dirty=false | tee "$log_file" >&2

  local deployment_url
  deployment_url="$(grep -Eo 'https://[^[:space:]]+\.pages\.dev' "$log_file" | tail -1 || true)"
  printf '%s' "$deployment_url"
}

chatbot_url="$(deploy_surface chatbot lib/main_customer.dart kfc-ai-chatbot)"
monitor_url="$(deploy_surface monitor lib/main_live.dart kfc-ai-live-monitor)"

printf '{"gitSha":"%s","releaseBuiltAt":"%s","dirty":false,"workerUrl":"%s","deployments":{"chatbot":{"project":"kfc-ai-chatbot","url":"%s"},"monitor":{"project":"kfc-ai-live-monitor","url":"%s"}}}\n' \
  "$GIT_SHA" "$RELEASE_BUILT_AT" "$BACKEND_BASE_URL" "$chatbot_url" "$monitor_url" \
  > "$DEPLOYMENT_OUTPUT_FILE"
echo "Deployment metadata: $DEPLOYMENT_OUTPUT_FILE"
