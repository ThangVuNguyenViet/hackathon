#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER_DEPLOY="$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
CLOUD_RUN_DEPLOY="$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
PAGES_DEPLOY="$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
FREE_DEPLOY_DOC="$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
LANGCHAIN_TARGET_TEST="$ROOT_DIR/tests/deployment/langchain_agent_target.test.sh"
PVCFC_RELEASE_TEST="$ROOT_DIR/tests/deployment/pvcfc_packaged_release.test.sh"
DEPLOYMENT_INTEGRITY_TEST="$ROOT_DIR/tests/deployment/deployment_integrity.test.sh"
CLOUD_RUN_DOCKERFILE="$ROOT_DIR/services/kfc-agent-backend/Dockerfile.cloud-run"
CLOUD_RUN_BUILD_CONFIG="$ROOT_DIR/services/kfc-agent-backend/cloudbuild.cloud-run.yaml"
WRANGLER_CONFIG="$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"

required_files=(
  "$WORKER_DEPLOY"
  "$CLOUD_RUN_DEPLOY"
  "$PAGES_DEPLOY"
  "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh"
  "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
  "$LANGCHAIN_TARGET_TEST"
  "$PVCFC_RELEASE_TEST"
  "$DEPLOYMENT_INTEGRITY_TEST"
  "$CLOUD_RUN_DOCKERFILE"
  "$CLOUD_RUN_BUILD_CONFIG"
  "$FREE_DEPLOY_DOC"
  "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
  "$ROOT_DIR/services/kfc-agent-backend/wrangler.production.toml.example"
  "$ROOT_DIR/services/kfc-agent-backend/migrations/0001_worker_runtime.sql"
)

for file in "${required_files[@]}"; do
  test -f "$file"
done

for script in \
  "$WORKER_DEPLOY" \
  "$CLOUD_RUN_DEPLOY" \
  "$PAGES_DEPLOY" \
  "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh" \
  "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" \
  "$LANGCHAIN_TARGET_TEST" \
  "$PVCFC_RELEASE_TEST" \
  "$DEPLOYMENT_INTEGRITY_TEST"; do
  bash -n "$script"
done

for script in "$WORKER_DEPLOY" "$CLOUD_RUN_DEPLOY" "$PAGES_DEPLOY" "$LANGCHAIN_TARGET_TEST"; do
  test -x "$script"
done

bash "$LANGCHAIN_TARGET_TEST"
bash "$PVCFC_RELEASE_TEST"
bash "$DEPLOYMENT_INTEGRITY_TEST"

grep -q "Cloudflare Worker" "$FREE_DEPLOY_DOC"
grep -q "Cloudflare D1" "$FREE_DEPLOY_DOC"
grep -q "Cloud Run" "$FREE_DEPLOY_DOC"
grep -q "Cloudflare Pages" "$FREE_DEPLOY_DOC"
grep -q "GOOGLE_API_KEY" "$FREE_DEPLOY_DOC"
! grep -Eqi '\bOpenAI\b|langgraph|serve-demo-agent-server' "$FREE_DEPLOY_DOC"

grep -q "nodejs_compat" "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
grep -q 'binding = "DB"' "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
grep -q "CREATE TABLE IF NOT EXISTS webhook_deliveries" "$ROOT_DIR/services/kfc-agent-backend/migrations/0001_worker_runtime.sql"
grep -q "worker:deploy:dry-run" "$ROOT_DIR/services/kfc-agent-backend/package.json"
grep -q '^KFC_AGENT_PROVIDER = "google"$' "$WRANGLER_CONFIG"
grep -q '^KFC_AGENT_MODEL = "gemini-3.1-flash-lite"$' "$WRANGLER_CONFIG"
! grep -Eqi 'KFC_AGENT_(PROVIDER|MODEL).*(openai|gpt-)' "$WRANGLER_CONFIG"

grep -Fq 'KFC_AGENT_PROVIDER="${KFC_AGENT_PROVIDER:-}"' "$WORKER_DEPLOY"
grep -Fq 'KFC_AGENT_MODEL="${KFC_AGENT_MODEL:-}"' "$WORKER_DEPLOY"
grep -q "KFC_AGENT_PROVIDER must be google for the maintained LangChain deployment" "$WORKER_DEPLOY"
grep -q "KFC_MONITOR_PROVIDER must be google for the maintained LangChain deployment" "$WORKER_DEPLOY"
grep -q "wrangler versions secret put GOOGLE_API_KEY" "$WORKER_DEPLOY"
grep -q "wrangler versions secret put PVCFC_ASTRAFLOW_API_KEY" "$WORKER_DEPLOY"
grep -q "wrangler versions secret put TINYFISH_API_KEY" "$WORKER_DEPLOY"
grep -q "wrangler versions secret put KFC_CONFIRMATION_SIGNING_SECRET" "$WORKER_DEPLOY"
grep -Fq -- '--var "KFC_CONFIRMATION_SIGNING_KEY_ID:$KFC_CONFIRMATION_SIGNING_KEY_ID"' "$WORKER_DEPLOY"
grep -q "ALLOW_NON_MAIN_DEPLOY" "$WORKER_DEPLOY"
grep -q "refs/remotes/origin/main" "$WORKER_DEPLOY"
grep -q "KFC_DEPLOY_PREFLIGHT_ONLY" "$WORKER_DEPLOY"
grep -q "worker:d1:migrate:remote" "$WORKER_DEPLOY"
grep -q -- "--outdir" "$WORKER_DEPLOY"

grep -q "KFC_AGENT_PROVIDER must be google for the maintained LangChain deployment" "$CLOUD_RUN_DEPLOY"
grep -q "KFC_MONITOR_PROVIDER must be google for the maintained LangChain deployment" "$CLOUD_RUN_DEPLOY"
grep -Fq 'GOOGLE_API_KEY=GOOGLE_API_KEY:latest' "$CLOUD_RUN_DEPLOY"
grep -Fq 'KFC_CONFIRMATION_SIGNING_SECRET=$KFC_CONFIRMATION_SIGNING_SECRET_NAME:latest' "$CLOUD_RUN_DEPLOY"
grep -q "CLOUD_RUN_MIN_INSTANCES" "$CLOUD_RUN_DEPLOY"
grep -q "KFC_DEPLOY_PREFLIGHT_ONLY" "$CLOUD_RUN_DEPLOY"
grep -q "/ready" "$CLOUD_RUN_DEPLOY"
grep -Fq 'gcloud builds submit "$ROOT_DIR"' "$CLOUD_RUN_DEPLOY"
grep -Fq -- '--config "$CLOUD_RUN_BUILD_CONFIG"' "$CLOUD_RUN_DEPLOY"
grep -Fq -- '--image "$IMAGE_URI"' "$CLOUD_RUN_DEPLOY"
! grep -Fq -- '--source "$SERVICE_DIR"' "$CLOUD_RUN_DEPLOY"
grep -Fq 'services/kfc-agent-backend/Dockerfile.cloud-run' "$CLOUD_RUN_BUILD_CONFIG"
grep -Fq 'CMD ["node", "dist/src/index.js"]' "$CLOUD_RUN_DOCKERFILE"
! grep -Fq 'recommendations/serving/aws-main.js' "$CLOUD_RUN_DOCKERFILE"

! grep -Eqi '\bOpenAI\b|openai_api_key|langgraph|tool_planner|small_talk_router' \
  "$WORKER_DEPLOY" \
  "$CLOUD_RUN_DEPLOY" \
  "$LANGCHAIN_TARGET_TEST" \
  "$PVCFC_RELEASE_TEST"

grep -q "KFC_AGENT_BACKEND_URL" "$PAGES_DEPLOY"
grep -q "generate-pages-deployment-assets.sh" "$PAGES_DEPLOY"
grep -q "KFC_PAGES_DEPLOYMENT_ID" "$PAGES_DEPLOY"
grep -q -- "--pwa-strategy=none" "$PAGES_DEPLOY"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
worker_env="$tmp_dir/worker.env"
printf '%s\n' \
  'LANGSMITH_API_KEY=test-langsmith-key' \
  'LANGSMITH_PROJECT=test-project' \
  'LANGSMITH_ENDPOINT=https://example.test/langsmith' \
  'META_APP_SECRET=test-meta-secret' \
  'META_PAGE_ACCESS_TOKEN=test-page-access-token' \
  'KFC_CONFIRMATION_SIGNING_KEY_ID=test-active' \
  'KFC_CONFIRMATION_SIGNING_SECRET=test-confirmation-signing-secret-32-bytes-minimum' \
  'KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS=[]' \
  'KFC_AGENT_PROVIDER=google' \
  'KFC_AGENT_MODEL=gemini-3.1-flash-lite' \
  'KFC_MONITOR_PROVIDER=google' \
  'KFC_MONITOR_MODEL=gemini-3.1-flash-lite' \
  'GOOGLE_API_KEY=test-google-key' \
  'KFC_COMMERCE_MODE=fixture' \
  'KFC_COMMERCE_ENVIRONMENT=sandbox' \
  >"$worker_env"

ALLOW_NON_MAIN_DEPLOY=true \
  KFC_DEPLOY_PREFLIGHT_ONLY=true \
  ENV_FILE="$worker_env" \
  "$WORKER_DEPLOY" >"$tmp_dir/worker-preflight.log"
grep -q "Cloudflare Worker deployment preflight passed" "$tmp_dir/worker-preflight.log"

KFC_DEPLOY_PREFLIGHT_ONLY=true \
  GCP_PROJECT_ID=test-project \
  META_PAGE_ID=test-page \
  KFC_AGENT_PROFILE_MODE=production \
  KFC_AGENT_PROVIDER=google \
  KFC_AGENT_MODEL=gemini-3.1-flash-lite \
  KFC_MONITOR_PROVIDER=google \
  KFC_MONITOR_MODEL=gemini-3.1-flash-lite \
  "$CLOUD_RUN_DEPLOY" >"$tmp_dir/cloud-run-preflight.log"
grep -q "Cloud Run deployment profile preflight passed" "$tmp_dir/cloud-run-preflight.log"

echo "Maintained deployment contracts passed."
