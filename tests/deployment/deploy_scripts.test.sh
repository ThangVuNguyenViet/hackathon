#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required_files=(
  "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
  "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
  "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
  "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
  "$ROOT_DIR/services/kfc-agent-backend/migrations/0001_worker_runtime.sql"
)

for file in "${required_files[@]}"; do
  test -f "$file"
done

bash -n "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
bash -n "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
bash -n "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"

test -x "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
test -x "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
test -x "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"

grep -q "Cloudflare Worker" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Cloudflare D1" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "workers.dev" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "GET /dashboard/stream.*501" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "webhooks/messenger" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Cloud Run" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Cloudflare Pages" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Messenger" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "/ready" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "nodejs_compat" "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
grep -q 'binding = "DB"' "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
grep -q "CREATE TABLE IF NOT EXISTS webhook_deliveries" "$ROOT_DIR/services/kfc-agent-backend/migrations/0001_worker_runtime.sql"
grep -q "worker:deploy:dry-run" "$ROOT_DIR/services/kfc-agent-backend/package.json"
grep -q "/ready" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "worker:d1:migrate:remote" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "OPENAI_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "CLOUD_RUN_MIN_INSTANCES" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "/ready" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_AGENT_BACKEND_URL" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q 'dist/src/index.js' "$ROOT_DIR/services/kfc-agent-backend/package.json"
test -f "$ROOT_DIR/services/kfc-agent-backend/Dockerfile"
