#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required_files=(
  "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
  "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
  "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh"
  "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
  "$ROOT_DIR/scripts/lib/kfc-acceptance-artifacts.sh"
  "$ROOT_DIR/services/kfc-agent-backend/scripts/validate-outcome-judgments.ts"
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
grep -q "validate-outcome-judgments.ts" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'outcome-evidence.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'outcome-judgments.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'durability_post' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'publication_hygiene' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'KFC_PROOF_RUN_ID' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'A-Za-z0-9._-' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'JSON.stringify' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q 'printf '\''{"gitSha":"%s"'\''' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'rg -a -n -i' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
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
validator_line="$(grep -n 'validate-outcome-judgments.ts' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
test "$durability_line" -lt "$judgment_line"
test "$judgment_line" -lt "$validator_line"
test "$validator_line" -lt "$publication_line"
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

for invalid_run_id in '.' '..' '../escape' 'nested/path' $'control\ncharacter'; do
  if KFC_PROOF_RUN_ID="$invalid_run_id" \
    "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" >"$tmp_dir/invalid-run-id.out" 2>"$tmp_dir/invalid-run-id.err"; then
    echo "Expected invalid KFC_PROOF_RUN_ID to be rejected: $invalid_run_id" >&2
    exit 1
  fi
  grep -q 'KFC_PROOF_RUN_ID must match' "$tmp_dir/invalid-run-id.err"
done

artifact_test_dir="$tmp_dir/artifact-finalization"
mkdir -p "$artifact_test_dir"
printf '{"runId":"artifact-test","passed":true}\n' > "$artifact_test_dir/proof-manifest.json"
printf 'stale checksums\n' > "$artifact_test_dir/SHA256SUMS"
printf 'stale bundle\n' > "$artifact_test_dir/proof-bundle.tar.gz"
source "$ROOT_DIR/scripts/lib/kfc-acceptance-artifacts.sh"
finalize_acceptance_failure \
  "$artifact_test_dir/proof-manifest.json" \
  "$artifact_test_dir" \
  "artifact-test" \
  "checksums" \
  77
test ! -e "$artifact_test_dir/SHA256SUMS"
test ! -e "$artifact_test_dir/proof-bundle.tar.gz"
node - "$artifact_test_dir/proof-manifest.json" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (manifest.passed !== false || manifest.acceptanceStatus !== 'failed' || manifest.failedPhase !== 'checksums' || manifest.exitCode !== 77) {
  throw new Error('Failure finalization did not produce an invalidated manifest');
}
NODE

binary_scan_dir="$tmp_dir/binary-scan"
mkdir -p "$binary_scan_dir"
printf '\x89PNG\r\n\x1a\nauthorization: Bearer binary-secret\x00' > "$binary_scan_dir/screenshot.png"
if ! rg -a -n -i '(authorization:[[:space:]]*bearer|api[_-]?key["=: ]+[A-Za-z0-9_-]{16,}|gho_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{16,})' \
  "$binary_scan_dir" > "$tmp_dir/binary-scan-findings.txt"; then
  echo "Expected binary screenshot secret to be detected" >&2
  exit 1
fi
grep -q 'authorization: Bearer' "$tmp_dir/binary-scan-findings.txt"

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
grep -q '^./scripts/run-kfc-deployed-acceptance.sh$' "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
! grep -q 'OUTCOME_JUDGE_MODEL=\${OUTCOME_JUDGE_MODEL:-gpt-4.1-mini}' "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "outcome-evidence.json" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "proof-bundle.tar.gz" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q 'dist/src/index.js' "$ROOT_DIR/services/kfc-agent-backend/package.json"
test -f "$ROOT_DIR/services/kfc-agent-backend/Dockerfile"
