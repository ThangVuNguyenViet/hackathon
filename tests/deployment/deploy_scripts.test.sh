#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required_files=(
  "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
  "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
  "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh"
  "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
  "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
  "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
  "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
  "$ROOT_DIR/services/kfc-agent-backend/migrations/0001_worker_runtime.sql"
)

for file in "${required_files[@]}"; do
  test -f "$file"
done

bash -n "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
bash -n "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
bash -n "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
bash -n "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh"
bash -n "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"

test -x "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
test -x "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
test -x "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
test -x "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh"
test -x "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"

grep -q "Cloudflare Worker" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Cloudflare D1" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "workers.dev" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "GET /dashboard/stream.*501" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "webhooks/messenger" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Cloud Run" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Cloudflare Pages" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "Messenger" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "/ready" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "webhooks/zalo" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "ZALO_OA_ID" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "4225933857518051795" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "customer display name" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "nodejs_compat" "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
grep -q 'binding = "DB"' "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
grep -q "CREATE TABLE IF NOT EXISTS webhook_deliveries" "$ROOT_DIR/services/kfc-agent-backend/migrations/0001_worker_runtime.sql"
grep -q "worker:deploy:dry-run" "$ROOT_DIR/services/kfc-agent-backend/package.json"
grep -q "/ready" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "worker:d1:migrate:remote" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "OPENAI_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "CLOUD_RUN_MIN_INSTANCES" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "/ready" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "META_PAGE_ID" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "Set META_PAGE_ID" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
! grep -q "META_PAGE_ID=118976205445198" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_AGENT_BACKEND_URL" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q "generate-pages-deployment-assets.sh" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q -- "--pwa-strategy=none" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q "kfc-ai-chatbot" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q "kfc-ai-live-monitor" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q -- "--outdir" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "run-deployed-browser-proof.ts" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q "run-outcome-judgments.ts" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'outcome-evidence.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'outcome-judgments.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'durability_post' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'publication_hygiene' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'caller_outcome_judge_model="${OUTCOME_JUDGE_MODEL-}"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'caller_selected_outcome_judge_model=false' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'if \[\[ -n "${OUTCOME_JUDGE_MODEL+x}" \]\]' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'if \[\[ "$caller_selected_outcome_judge_model" == true \]\]' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'OUTCOME_JUDGE_MODEL="$caller_outcome_judge_model"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'worker-ready-replacement.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'Replacement Worker release identity mismatch' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
replacement_ready_line="$(grep -n 'worker-ready-replacement.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | head -1 | cut -d: -f1)"
replacement_check_line="$(grep -n 'Replacement Worker release identity mismatch' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
test "$replacement_ready_line" -lt "$replacement_check_line"
durability_line="$(grep -n 'PHASE=\"durability_post\"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
judgment_line="$(grep -n 'PHASE=\"outcome_judgments\"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
publication_line="$(grep -n 'PHASE=\"publication_hygiene\"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
test "$durability_line" -lt "$judgment_line"
test "$judgment_line" -lt "$publication_line"
grep -q 'shasum -a 256 -c SHA256SUMS' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'gh release create' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q "kfc-ai-chatbot.pages.dev" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q "kfc-ai-live-monitor.pages.dev" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q "gh release create" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! rg -q "https://[^[:space:]\"']+\.workers\.dev" \
  "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh" \
  "$ROOT_DIR/apps/kfc_live_monitor_flutter/web/_worker.js"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

release_json='{"gitSha":"0123456789abcdef","releaseBuiltAt":"2026-07-11T08:30:00Z","dirty":false}'
for surface in chatbot monitor; do
  output_dir="$tmp_dir/$surface"
  "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh" \
    --surface "$surface" \
    --output-dir "$output_dir" \
    --git-sha "0123456789abcdef" \
    --release-built-at "2026-07-11T08:30:00Z" \
    --dirty false
  test "$(tr -d '\n' < "$output_dir/release.json")" = "$release_json"
  grep -q "env.KFC_AGENT_BACKEND_URL" "$output_dir/_worker.js"
  grep -q "return fetch(target.toString(), init)" "$output_dir/_worker.js"
done

grep -q "'/chat/kfc/message'" "$tmp_dir/chatbot/_worker.js"
grep -q "'/chat/kfc/genui-action'" "$tmp_dir/chatbot/_worker.js"
! grep -q "startsWith('/dashboard/')" "$tmp_dir/chatbot/_worker.js"

grep -q "startsWith('/dashboard/')" "$tmp_dir/monitor/_worker.js"
! grep -q "'/chat/kfc/message'" "$tmp_dir/monitor/_worker.js"

grep -q "gitSha" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "releaseBuiltAt" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "dirty.*false" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "OUTCOME_JUDGE_MODEL" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "caller environment takes precedence" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "outcome-evidence.json" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "proof-bundle.tar.gz" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q 'dist/src/index.js' "$ROOT_DIR/services/kfc-agent-backend/package.json"
test -f "$ROOT_DIR/services/kfc-agent-backend/Dockerfile"
