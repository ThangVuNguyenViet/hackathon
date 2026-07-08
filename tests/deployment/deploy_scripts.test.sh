#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required_files=(
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
  "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
  "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
)

for file in "${required_files[@]}"; do
  test -f "$file"
done

bash -n "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
bash -n "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"

test -x "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
test -x "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"

grep -q "Cloud Run" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Cloudflare Pages" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Neon" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Messenger" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "/ready" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "OPENAI_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "CLOUD_RUN_MIN_INSTANCES" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "/ready" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_AGENT_BACKEND_URL" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q 'dist/src/index.js' "$ROOT_DIR/services/kfc-agent-backend/package.json"
test -f "$ROOT_DIR/services/kfc-agent-backend/Dockerfile"
