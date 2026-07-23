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
  "$ROOT_DIR/scripts/lib/kfc-qualification-integrity.mjs"
  "$ROOT_DIR/services/kfc-agent-backend/scripts/validate-outcome-judgments.ts"
  "$ROOT_DIR/tests/deployment/openai_agent_target.test.sh"
  "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
  "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
  "$ROOT_DIR/services/kfc-agent-backend/wrangler.toml"
  "$ROOT_DIR/services/kfc-agent-backend/wrangler.production.toml.example"
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
bash -n "$ROOT_DIR/tests/deployment/openai_agent_target.test.sh"

test -x "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
test -x "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
test -x "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
test -x "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh"
test -x "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
test -x "$ROOT_DIR/tests/deployment/openai_agent_target.test.sh"

bash "$ROOT_DIR/tests/deployment/openai_agent_target.test.sh"

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
grep -q "RELEASE_DEPLOYMENT_ID" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "worker:d1:migrate:remote" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "LANGSMITH_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "LANGSMITH_PROJECT" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "LANGSMITH_ENDPOINT" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "LANGSMITH_TRACING_SAMPLING_RATE" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "META_APP_SECRET" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq 'KFC_AGENT_PROFILE_MODE="${KFC_AGENT_PROFILE_MODE:-production}"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq 'KFC_AGENT_PROVIDER="${KFC_AGENT_PROVIDER:-}"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq 'KFC_AGENT_MODEL="${KFC_AGENT_MODEL:-}"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq -- '--var "KFC_AGENT_PROVIDER:$KFC_AGENT_PROVIDER"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq -- '--var "KFC_AGENT_MODEL:$KFC_AGENT_MODEL"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq -- '--var "KFC_AGENT_PROFILE_MODE:$KFC_AGENT_PROFILE_MODE"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq 'KFC_MONITOR_PROVIDER="${KFC_MONITOR_PROVIDER:-$KFC_AGENT_PROVIDER}"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq 'KFC_MONITOR_MODEL="${KFC_MONITOR_MODEL:-}"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq -- '--var "KFC_MONITOR_PROVIDER:$KFC_MONITOR_PROVIDER"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq -- '--var "KFC_MONITOR_MODEL:$KFC_MONITOR_MODEL"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "KFC_MONITOR_PROVIDER must be google or openai" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "KFC_MONITOR_MODEL must be" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "KFC_AGENT_PROVIDER must be google or openai" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "KFC_AGENT_MODEL must be" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "selected provider API keys" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "KFC_DEPLOY_PREFLIGHT_ONLY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
! grep -q "OPENAI_TOOL_PLANNER_MODEL" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
! grep -q "TOOL_PLANNER_PROVIDER" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
! grep -q "OPENAI_SMALL_TALK_ROUTER_MODEL" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq 'KFC_COMMERCE_MODE="${KFC_COMMERCE_MODE:-}"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'KFC_COMMERCE_MODE.*gateway' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'KFC_COMMERCE_MODE.*fixture' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'fixture commerce is allowed only in the sandbox environment' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'KFC_COMMERCE_ENVIRONMENT' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'wrangler.production.toml.example' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'KFC_WRANGLER_CONFIG' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'KFC_D1_DATABASE_NAME' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'KFC_MENU_API_URL' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
! grep -q 'KFC_COMMERCE_MODE="${KFC_COMMERCE_MODE:-fixture}"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "wrangler versions secret put LANGSMITH_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "wrangler versions secret put META_APP_SECRET" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "wrangler versions secret put META_PAGE_ACCESS_TOKEN" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "wrangler versions secret put GOOGLE_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "wrangler versions secret put OPENAI_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "wrangler versions secret put KFC_COMMERCE_GATEWAY_TOKEN" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "wrangler versions secret put KFC_CONFIRMATION_SIGNING_SECRET" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "wrangler versions secret put KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -Fq -- '--var "KFC_CONFIRMATION_SIGNING_KEY_ID:$KFC_CONFIRMATION_SIGNING_KEY_ID"' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
! grep -Fq -- '--var "KFC_CONFIRMATION_SIGNING_SECRET:' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
! grep -Fq -- '--var "KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS:' "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "ALLOW_NON_MAIN_DEPLOY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q "refs/remotes/origin/main" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
main_guard_line="$(grep -n "ALLOW_NON_MAIN_DEPLOY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | head -1 | cut -d: -f1)"
worker_deploy_line="$(grep -n "npx wrangler deploy" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
langsmith_secret_line="$(grep -n "wrangler versions secret put LANGSMITH_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
meta_secret_line="$(grep -n "wrangler versions secret put META_APP_SECRET" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
meta_page_secret_line="$(grep -n "wrangler versions secret put META_PAGE_ACCESS_TOKEN" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
openai_secret_line="$(grep -n "wrangler versions secret put OPENAI_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
google_secret_line="$(grep -n "wrangler versions secret put GOOGLE_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
gateway_secret_line="$(grep -n "wrangler versions secret put KFC_COMMERCE_GATEWAY_TOKEN" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
confirmation_secret_line="$(grep -n "wrangler versions secret put KFC_CONFIRMATION_SIGNING_SECRET" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
confirmation_previous_line="$(grep -n "wrangler versions secret put KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" | cut -d: -f1)"
test "$main_guard_line" -lt "$langsmith_secret_line"
test "$main_guard_line" -lt "$meta_secret_line"
test "$meta_secret_line" -lt "$meta_page_secret_line"
test "$meta_page_secret_line" -lt "$langsmith_secret_line"
test "$langsmith_secret_line" -lt "$confirmation_secret_line"
test "$confirmation_secret_line" -lt "$confirmation_previous_line"
test "$confirmation_previous_line" -lt "$openai_secret_line"
test "$langsmith_secret_line" -lt "$openai_secret_line"
test "$openai_secret_line" -lt "$google_secret_line"
test "$google_secret_line" -lt "$gateway_secret_line"
test "$gateway_secret_line" -lt "$worker_deploy_line"
grep -q "LANGSMITH_ENDPOINT" "$ROOT_DIR/services/kfc-agent-backend/.env.example"
grep -q "LANGSMITH_TRACING_SAMPLING_RATE" "$ROOT_DIR/services/kfc-agent-backend/.env.example"
grep -q '^KFC_AGENT_PROVIDER=google$' "$ROOT_DIR/services/kfc-agent-backend/.env.example"
grep -q '^KFC_AGENT_MODEL=gemini-3.1-flash-lite$' "$ROOT_DIR/services/kfc-agent-backend/.env.example"
! grep -q '^KFC_MONITOR_PROVIDER=' "$ROOT_DIR/services/kfc-agent-backend/.env.example"
! grep -q '^KFC_MONITOR_MODEL=' "$ROOT_DIR/services/kfc-agent-backend/.env.example"
grep -q '^# KFC_MONITOR_PROVIDER=google$' "$ROOT_DIR/services/kfc-agent-backend/.env.example"
grep -q '^# KFC_MONITOR_MODEL=gemini-3.1-flash-lite$' "$ROOT_DIR/services/kfc-agent-backend/.env.example"
grep -q '^GOOGLE_API_KEY=$' "$ROOT_DIR/services/kfc-agent-backend/.env.example"
! grep -q 'TOOL_PLANNER_PROVIDER' "$ROOT_DIR/services/kfc-agent-backend/.env.example"
grep -q "OPENAI_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "GOOGLE_API_KEY" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_AGENT_PROVIDER" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_AGENT_PROFILE_MODE" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_AGENT_MODEL" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_AGENT_MODEL must be" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq 'KFC_MONITOR_PROVIDER="${KFC_MONITOR_PROVIDER:-$KFC_AGENT_PROVIDER}"' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq 'KFC_MONITOR_MODEL="${KFC_MONITOR_MODEL:-}"' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq '"KFC_MONITOR_PROVIDER=$KFC_MONITOR_PROVIDER"' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq '"KFC_MONITOR_MODEL=$KFC_MONITOR_MODEL"' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_MONITOR_PROVIDER must be google or openai" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_MONITOR_MODEL must be" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq 'OPENAI_API_KEY=OPENAI_API_KEY:latest' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq 'GOOGLE_API_KEY=GOOGLE_API_KEY:latest' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq 'KFC_CONFIRMATION_SIGNING_SECRET=$KFC_CONFIRMATION_SIGNING_SECRET_NAME:latest' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq 'KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS=$KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS_SECRET_NAME:latest' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -Fq '"KFC_CONFIRMATION_SIGNING_KEY_ID=$KFC_CONFIRMATION_SIGNING_KEY_ID"' "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "CLOUD_RUN_MIN_INSTANCES" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "/ready" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "META_PAGE_ID" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "Set META_PAGE_ID" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_DEPLOY_PREFLIGHT_ONLY" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
! grep -q "META_PAGE_ID=118976205445198" "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
grep -q "KFC_AGENT_BACKEND_URL" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q "generate-pages-deployment-assets.sh" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q "KFC_PAGES_DEPLOYMENT_ID" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q -- "--build-id" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q -- "--canonical-url" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q -- "--pwa-strategy=none" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q "kfc-ai-chatbot" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q "kfc-ai-live-monitor" "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
grep -q -- "--outdir" "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
grep -q 'KFC_AGENT_PROVIDER=openai KFC_AGENT_MODEL=gpt-4.1-mini RUN_LIVE_AI_INTERRUPTION=1' "$ROOT_DIR/services/kfc-agent-backend/package.json"
! grep -q "run-deployed-browser-proof.ts" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q "run-outcome-judgments.ts" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'npm run test:live:qualification:text' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
test "$(grep -c 'npm run test:live:qualification:text' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh")" -eq 1
canonical_matrix_line="$(grep -n 'npm run test:live:qualification:text' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
matrix_cycle_line="$(grep -n 'for cycle in 1 2 3' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
test "$canonical_matrix_line" -lt "$matrix_cycle_line"
! grep -q 'npm run test:live:small-talk-router' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q 'npm run test:live:direct-catalog' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'npm run test:live:interruption' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
test "$(grep -c 'npm run test:live:interruption' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh")" -eq 1
grep -q 'npm run test:live:genui:integration' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'npm run proof:live:messenger' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'npm run proof:production:latency' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'PRODUCTION_LATENCY_ITERATIONS=20' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'PRODUCTION_GREETING_TARGET_MS=10000' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'PRODUCTION_MENU_TARGET_MS=10000' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'PRODUCTION_OVERALL_TARGET_MS=10000' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -Eq 'PRODUCTION_(GREETING|MENU|OVERALL)_TARGET_MS=(6000|8000)' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'goldenStreak !== 5 || matrixStreak !== 3' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'goldenAffected' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'matrixAffected' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'npm run fixtures:build' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'flutter analyze' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'lib/main_customer.dart' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'lib/main_live.dart' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q -- '--maxWorkers=1' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q -- '--no-file-parallelism' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q -- '--maxWorkers=1' "$ROOT_DIR/.github/workflows/kfc-genui.yml"
! grep -q -- '--no-file-parallelism' "$ROOT_DIR/.github/workflows/kfc-genui.yml"
grep -q 'for attempt in {1..3}' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q 'for _ in {1..30}' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'catalog-hash-conservative-v1' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'schema-bound generated catalog relevance diff' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'KFC_STAGE_EVIDENCE_DIR' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'Five-minute recording' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'Two ordered rehearsals' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'fallbackPlaybackPassed' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'catalogObservationId' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'KFC_ACCEPTANCE_PHASE' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'qualification-gate.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'qualification-digests.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'Qualified artifact or input digest mismatch' "$ROOT_DIR/scripts/lib/kfc-qualification-integrity.mjs"
grep -q 'qualificationGateId' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'allTimes.some((time) => time > now)' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'allTimes.some((time) => now - time > 24' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'time <= orderedTimes\[index - 1\]' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'publication_identity_revalidation' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'Qualified Worker identity changed before publication' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'Qualified Pages identity changed before publication' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q "latency/report.json" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q -- '--maxConcurrency' "$ROOT_DIR/services/kfc-agent-backend/package.json"
grep -q 'rehearsalNumber !== 1' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'final-run.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
test "$(grep -c 'KFC_GENUI_BRANCH_SESSIONS=' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh")" -eq 1
grep -q 'KFC_GENUI_BRANCH_SESSIONS_FILE' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'No maintained canonical producer currently emits the deployed branch-session artifact' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -Fq '[[ ! -f "$GENUI_BRANCH_SESSIONS_FILE" ]]' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q 'KFC_LIVE_SCENARIO_BRANCH_OUTPUT=' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'needs: \[backend, flutter\]' "$ROOT_DIR/.github/workflows/kfc-genui.yml"
grep -q 'durability_post' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'historical_reviewed_destructive_migrations' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q '0006_remove_customer_streaming_rollout.sql' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'publication_hygiene' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'KFC_PROOF_RUN_ID' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'A-Za-z0-9._-' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'JSON.stringify' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
! grep -q 'printf '\''{"gitSha":"%s"'\''' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'scan_acceptance_artifacts_for_secrets' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! grep -q '\. "$ROOT_DIR/.env"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'worker-ready-replacement.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'Replacement Worker release identity mismatch' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'sameAgentRuntimeIdentity(runtime, actual.proof)' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs"
grep -q 'runtime-binding.json.*worker-ready-replacement.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
replacement_ready_line="$(grep -n 'worker-ready-replacement.json' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | head -1 | cut -d: -f1)"
replacement_check_line="$(grep -n 'kfc-acceptance-checks.mjs" check-8' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
test "$replacement_ready_line" -lt "$replacement_check_line"
durability_line="$(grep -n 'PHASE=\"durability_post\"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
publication_line="$(grep -n 'PHASE=\"publication_hygiene\"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
latency_line="$(grep -n 'PHASE=\"production_latency\"' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" | cut -d: -f1)"
test "$durability_line" -lt "$latency_line"
test "$latency_line" -lt "$publication_line"
grep -q 'shasum -a 256 -c SHA256SUMS' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q 'gh release create' "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q "kfc-ai-chatbot.pages.dev" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q "kfc-ai-live-monitor.pages.dev" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
grep -q "gh release create" "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
! rg -q "https://[^[:space:]\"']+\.workers\.dev" \
  "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh" \
  "$ROOT_DIR/apps/kfc_live_monitor_flutter/web/_worker.js"

tmp_dir="$(mktemp -d)"
reused_run_id="deployment-test-reused-$$"
reused_run_dir="$ROOT_DIR/artifacts/kfc-deployed-proof/$reused_run_id"
trap 'rm -rf "$tmp_dir" "$reused_run_dir"' EXIT

deploy_env="$tmp_dir/agent-deploy.env"
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
  'OPENAI_API_KEY=test-openai-key' \
  'GOOGLE_API_KEY=test-google-key' \
  'KFC_COMMERCE_MODE=fixture' \
  'KFC_COMMERCE_ENVIRONMENT=sandbox' \
  > "$deploy_env"

agent_drift_env="$tmp_dir/agent-drift-deploy.env"
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
  'KFC_AGENT_MODEL=gpt-5-mini-2025-08-07' \
  'OPENAI_API_KEY=test-openai-key' \
  'GOOGLE_API_KEY=test-google-key' \
  'KFC_COMMERCE_MODE=fixture' \
  'KFC_COMMERCE_ENVIRONMENT=sandbox' \
  > "$agent_drift_env"

if ALLOW_NON_MAIN_DEPLOY=true \
  ENV_FILE="$agent_drift_env" \
  "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh" \
  >"$tmp_dir/worker-agent-drift.log" 2>&1; then
  echo "Expected Worker deploy to reject agent-model drift." >&2
  exit 1
else
  test "$?" -eq 64
fi
grep -q "KFC_AGENT_MODEL must be gemini-3.1-flash-lite" \
  "$tmp_dir/worker-agent-drift.log"

KFC_DEPLOY_PREFLIGHT_ONLY=true \
  GCP_PROJECT_ID=test-project \
  META_PAGE_ID=test-page \
  KFC_AGENT_PROFILE_MODE=production \
  KFC_AGENT_PROVIDER=google \
  KFC_AGENT_MODEL=gemini-3.1-flash-lite \
  KFC_MONITOR_PROVIDER=openai \
  KFC_MONITOR_MODEL=gpt-5-mini-2025-08-07 \
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh" \
  >"$tmp_dir/cloud-run-explicit-monitor.log" 2>&1
grep -q "Cloud Run deployment profile preflight passed" \
  "$tmp_dir/cloud-run-explicit-monitor.log"

if KFC_DEPLOY_PREFLIGHT_ONLY=true \
  GCP_PROJECT_ID=test-project \
  META_PAGE_ID=test-page \
  KFC_AGENT_PROFILE_MODE=production \
  KFC_AGENT_PROVIDER=google \
  KFC_AGENT_MODEL=gemini-3.1-flash-lite \
  KFC_MONITOR_PROVIDER=openai \
  KFC_MONITOR_MODEL=gpt-4.1 \
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh" \
  >"$tmp_dir/cloud-run-monitor-drift.log" 2>&1; then
  echo "Expected Cloud Run preflight to reject monitor-model drift." >&2
  exit 1
else
  test "$?" -eq 64
fi
grep -q "KFC_MONITOR_MODEL must be gpt-5-mini-2025-08-07" \
  "$tmp_dir/cloud-run-monitor-drift.log"

if KFC_DEPLOY_PREFLIGHT_ONLY=true \
  GCP_PROJECT_ID=test-project \
  META_PAGE_ID=test-page \
  KFC_AGENT_PROFILE_MODE=qualification \
  KFC_AGENT_PROVIDER=google \
  KFC_AGENT_MODEL=gemini-3.5-flash \
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh" \
  >"$tmp_dir/cloud-run-qualification-stronger-google.log" 2>&1; then
  echo "Expected Cloud Run qualification preflight to reject Gemini 3.5 Flash." >&2
  exit 1
else
  test "$?" -eq 64
fi
grep -q "KFC_AGENT_MODEL must be gemini-3.1-flash-lite" \
  "$tmp_dir/cloud-run-qualification-stronger-google.log"

if KFC_DEPLOY_PREFLIGHT_ONLY=true \
  GCP_PROJECT_ID=test-project \
  META_PAGE_ID=test-page \
  KFC_AGENT_PROFILE_MODE=production \
  KFC_AGENT_PROVIDER=google \
  KFC_AGENT_MODEL=gemini-3.5-flash \
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh" \
  >"$tmp_dir/cloud-run-production-expensive-google.log" 2>&1; then
  echo "Expected Cloud Run production preflight to reject Gemini 3.5 Flash." >&2
  exit 1
else
  test "$?" -eq 64
fi
grep -q "KFC_AGENT_MODEL must be gemini-3.1-flash-lite" \
  "$tmp_dir/cloud-run-production-expensive-google.log"

if GCP_PROJECT_ID=test-project \
  META_PAGE_ID=test-page \
  KFC_AGENT_PROVIDER=google \
  KFC_AGENT_MODEL=gpt-5-mini-2025-08-07 \
  "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh" \
  >"$tmp_dir/cloud-run-agent-drift.log" 2>&1; then
  echo "Expected Cloud Run deploy to reject agent-model drift." >&2
  exit 1
else
  test "$?" -eq 64
fi
grep -q "KFC_AGENT_MODEL must be gemini-3.1-flash-lite" \
  "$tmp_dir/cloud-run-agent-drift.log"

identity_dir="$tmp_dir/runtime-identity"
mkdir -p "$identity_dir"
printf '{"gitSha":"qualified","deploymentId":"worker-qualified","releaseBuiltAt":"2026-07-15T00:00:00.000Z","dirty":false}\n' > "$identity_dir/release.json"
printf '{"deployment":{"gitSha":"qualified","deploymentId":"worker-qualified","builtAt":"2026-07-15T00:00:00.000Z","dirty":false},"versions":{"agent":{"provider":"google","model":"gemini-3.1-flash-lite","profile":"google-gemini-3.1-flash-lite-thinking-low"},"toolCatalog":"tools-v1","ranker":"ranker-v1","ledger":"ledger-v1"}}\n' > "$identity_dir/runtime.json"
printf '{"ok":true,"release":{"gitSha":"qualified","deploymentId":"worker-qualified","releaseBuiltAt":"2026-07-15T00:00:00.000Z","dirty":false},"proof":{"deployment":{"gitSha":"qualified","deploymentId":"worker-qualified","builtAt":"2026-07-15T00:00:00.000Z","dirty":false},"versions":{"agent":{"provider":"google","model":"gemini-3.1-flash-lite","profile":"google-gemini-3.1-flash-lite-thinking-low"},"toolCatalog":"tools-v1","ranker":"ranker-v1","ledger":"ledger-v1"}}}\n' > "$identity_dir/matching.json"
printf '{"ok":true,"release":{"gitSha":"qualified","deploymentId":"worker-qualified","releaseBuiltAt":"2026-07-15T00:00:00.000Z","dirty":false},"proof":{"deployment":{"gitSha":"qualified","deploymentId":"worker-qualified","builtAt":"2026-07-15T00:00:00.000Z","dirty":false},"versions":{"agent":{"provider":"openai","model":"gpt-5-mini-2025-08-07","profile":"openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low"},"toolCatalog":"tools-v1","ranker":"ranker-v1","ledger":"ledger-v1"}}}\n' > "$identity_dir/drifted.json"
node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-8 "$identity_dir/release.json" "$identity_dir/runtime.json" "$identity_dir/matching.json"
! node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-8 "$identity_dir/release.json" "$identity_dir/runtime.json" "$identity_dir/drifted.json" >/dev/null 2>&1

latency_validator="$ROOT_DIR/scripts/lib/kfc-production-latency-report.mjs"
test "$(grep -c 'assertCurrentProductionLatencyReport' "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs")" -eq 3
node --input-type=module - "$latency_validator" <<'NODE'
import { pathToFileURL } from 'node:url';

const validatorPath = process.argv[2];
const { assertCurrentProductionLatencyReport } =
  await import(pathToFileURL(validatorPath));
const greetingIds = Array.from(
  { length: 20 },
  (_, index) => `message-latency-test-greeting-${index + 1}`,
);
const menuIds = Array.from(
  { length: 20 },
  (_, index) => `message-latency-test-menu-${index + 1}`,
);
const expectedIds = [...greetingIds, ...menuIds].sort();
const greetingId = greetingIds[0];
const menuId = menuIds[0];
const agentTraceId = (clientMessageId) => `agent-${clientMessageId}`;
const monitorTraceId = (clientMessageId) => `monitor-${clientMessageId}`;
const agentRoots = Object.fromEntries(
  expectedIds.map((clientMessageId) => [
    clientMessageId,
    [agentTraceId(clientMessageId)],
  ]),
);
const monitorRoots = Object.fromEntries(
  expectedIds.map((clientMessageId) => [
    clientMessageId,
    [monitorTraceId(clientMessageId)],
  ]),
);
const greetingAgentTraces = greetingIds.map(agentTraceId);
const menuAgentTraces = menuIds.map(agentTraceId);
const gitSha = 'release-sha';
const releaseBuiltAt = '2026-07-20T00:00:00.000Z';
const workerDeploymentId = 'worker-release';
const openAiIdentity = {
  provider: 'openai',
  model: 'gpt-5-mini-2025-08-07',
  profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
};
const valid = {
  schemaVersion: 4,
  release: {
    gitSha,
    releaseBuiltAt,
    dirty: false,
    deploymentId: 'pages-release',
  },
  readiness: {
    ok: true,
    release: {
      gitSha,
      deploymentId: workerDeploymentId,
      releaseBuiltAt,
      dirty: false,
    },
    checks: {
      agent: { ok: true, configured: true, ...openAiIdentity },
    },
    proof: {
      deployment: {
        gitSha,
        deploymentId: workerDeploymentId,
        builtAt: releaseBuiltAt,
        dirty: false,
      },
      versions: {
        agent: { ...openAiIdentity },
      },
    },
  },
  targets: {
    greetingP95Ms: 10000,
    menuP95Ms: 10000,
    overallP95Ms: 10000,
  },
  latency: {
    ok: true,
    successRate: 1,
    failures: [],
    overall: { count: 40, p95Ms: 2000 },
    byKind: {
      greeting: { count: 20, p95Ms: 1000 },
      menu: { count: 20, p95Ms: 2000 },
    },
  },
  samples: [
    ...greetingIds.map((clientMessageId) => ({
      kind: 'greeting',
      ok: true,
      status: 200,
      responseText: 'Xin chào',
      durationMs: 1000,
      clientMessageId,
      sessionId: `kfc:${clientMessageId}`,
    })),
    ...menuIds.map((clientMessageId) => ({
      kind: 'menu',
      ok: true,
      status: 200,
      responseText: 'Đây là thực đơn',
      durationMs: 2000,
      clientMessageId,
      sessionId: `kfc:${clientMessageId}`,
    })),
  ],
  traces: {
    runtime: 'langgraph-create-agent-workflow-v1',
    ok: true,
    failures: [],
    rootQueryOverflowed: false,
    settle: { completed: true },
    agentTurns: 40,
    monitorTurns: 40,
    rootRuns: 80,
    rootCoverage: {
      expectedClientMessageIds: expectedIds,
      agent: {
        byClientMessageId: agentRoots,
        missingClientMessageIds: [],
        duplicateClientMessageIds: [],
      },
      monitor: {
        byClientMessageId: monitorRoots,
        missingClientMessageIds: [],
        duplicateClientMessageIds: [],
      },
      uncorrelatableRoots: [],
    },
    agentTraceIdsByKind: { greeting: 20, menu: 20 },
    graphNodes: {
      callModel: {
        name: 'model_request',
        runCount: 60,
        traceIds: [
          ...greetingAgentTraces,
          ...menuAgentTraces.flatMap((traceId) => [traceId, traceId]),
        ],
        uncorrelatableSpans: [],
        overflowed: false,
      },
      executeTools: {
        name: 'tools',
        runCount: 20,
        traceIds: menuAgentTraces,
        uncorrelatableSpans: [],
        overflowed: false,
      },
      executeTrustedAction: {
        name: 'execute_trusted_action',
        runCount: 0,
        traceIds: [],
        uncorrelatableSpans: [],
        overflowed: false,
      },
    },
    byKind: {
      greeting: {
        modelSpans: 20,
        toolExecutionSpans: 0,
        trustedActionSpans: 0,
      },
      menu: {
        modelSpans: 40,
        toolExecutionSpans: 20,
        trustedActionSpans: 0,
      },
    },
    expected: {
      agentRoots: 40,
      monitorRoots: 40,
      greetingModelNodesPerTrace: 1,
      menuModelNodesPerTrace: 2,
      lowRiskTrustedActionNodes: 0,
      greetingToolExecutionNodes: 0,
      menuToolExecutionTraceCoverage: 20,
    },
  },
};
assertCurrentProductionLatencyReport(valid);

const expectRejected = (mutate, label) => {
  const candidate = structuredClone(valid);
  mutate(candidate);
  let rejected = false;
  try {
    assertCurrentProductionLatencyReport(candidate);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Expected ${label} report to be rejected`);
};

expectRejected((report) => {
  report.schemaVersion = 1;
  report.traces.graphNodes = {
    router: { name: 'small_talk_router' },
    planner: { name: 'planner_iteration' },
    composer: { name: 'response_compose' },
  };
}, 'legacy v1');
expectRejected((report) => {
  report.traces.runtime = 'retired-planner-runtime';
}, 'forged runtime');
expectRejected((report) => {
  report.traces.rootCoverage.agent.byClientMessageId[greetingId] = [
    'agent-greeting-1',
    'agent-greeting-2',
  ];
  report.traces.rootCoverage.agent.byClientMessageId[menuId] = [];
  report.traces.rootCoverage.agent.missingClientMessageIds = [];
  report.traces.rootCoverage.agent.duplicateClientMessageIds = [];
}, 'forged request/root coverage');
expectRejected((report) => {
  report.traces.rootCoverage.monitor.byClientMessageId[greetingId] = [
    agentTraceId(greetingId),
  ];
}, 'shared agent and monitor trace');
expectRejected((report) => {
  report.samples[1].status = 500;
  report.samples[1].responseText = '';
  report.samples[1].durationMs = 9000;
}, 'forged green sample summary');
expectRejected((report) => {
  report.samples.pop();
}, 'reduced sample coverage');
expectRejected((report) => {
  report.targets.greetingP95Ms = 999999;
  report.targets.menuP95Ms = 999999;
  report.targets.overallP95Ms = 999999;
}, 'weakened release targets');
expectRejected((report) => {
  report.targets.greetingP95Ms = 6000;
  report.targets.menuP95Ms = 8000;
  report.targets.overallP95Ms = 8000;
}, 'retired asymmetric release targets');
expectRejected((report) => {
  report.traces.settle.completed = false;
}, 'unsettled');
expectRejected((report) => {
  report.traces.graphNodes.callModel.runCount -= 1;
  report.traces.graphNodes.callModel.traceIds.shift();
}, 'missing greeting author span');
expectRejected((report) => {
  report.traces.graphNodes.callModel.runCount += 1;
  report.traces.graphNodes.callModel.traceIds.push(
    report.traces.graphNodes.callModel.traceIds.at(-1),
  );
}, 'extra menu author span');
expectRejected((report) => {
  report.readiness.checks.agent.apiKey = 'must-not-be-reported';
}, 'secret-bearing author readiness');
expectRejected((report) => {
  report.traces.failures = ['call_model_trace_coverage'];
}, 'trace failure');
NODE

integrity_dir="$tmp_dir/qualification-integrity"
proof_dir="$integrity_dir/proof"
input_dir="$integrity_dir/input"
mkdir -p "$proof_dir/latency" "$input_dir/cycle-1"
printf '{"gitSha":"qualified"}\n' > "$proof_dir/release.json"
printf '{"completedAt":"2026-07-15T00:30:00.000Z"}\n' > "$proof_dir/latency/report.json"
printf '{"approved":true}\n' > "$input_dir/cycle-1/golden-plan.json"
integrity="$ROOT_DIR/scripts/lib/kfc-qualification-integrity.mjs"
node "$integrity" create-digest "$proof_dir/qualification-digests.json" "$proof_dir" "$input_dir"
node - "$proof_dir/qualification-digests.json" "$proof_dir/qualification-gate.json" <<'NODE'
const fs = require('node:fs');
const [digestPath, gatePath] = process.argv.slice(2);
const digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
fs.writeFileSync(gatePath, JSON.stringify({
  schemaVersion: 1, artifactKind: 'kfc-stage-evidence-gate', gateId: 'gate-test',
  qualificationDigestSha256: digest.sha256, qualificationCompletedAt: '2026-07-15T00:00:00.000Z',
  issuedAt: '2026-07-15T01:00:00.000Z', latencyReport: 'latency/report.json',
}));
NODE
node "$integrity" verify-ages "$proof_dir/qualification-gate.json" "$proof_dir/latency/report.json" '2026-07-15T02:00:00.000Z'
cp "$proof_dir/qualification-gate.json" "$integrity_dir/stale-gate.json"
node - "$integrity_dir/stale-gate.json" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const gate = JSON.parse(fs.readFileSync(path, 'utf8'));
gate.qualificationCompletedAt = '2026-07-12T00:00:00.000Z';
gate.issuedAt = '2026-07-15T01:00:00.000Z';
fs.writeFileSync(path, JSON.stringify(gate));
NODE
! node "$integrity" verify-ages "$integrity_dir/stale-gate.json" "$proof_dir/latency/report.json" '2026-07-15T02:00:00.000Z' >/dev/null 2>&1
printf '{"completedAt":"2026-07-12T00:30:00.000Z"}\n' > "$integrity_dir/stale-latency.json"
! node "$integrity" verify-ages "$proof_dir/qualification-gate.json" "$integrity_dir/stale-latency.json" '2026-07-15T02:00:00.000Z' >/dev/null 2>&1
mkdir -p "$proof_dir/publication-readiness" "$proof_dir/stage"
printf 'retry poll\n' > "$proof_dir/publication-readiness/worker-1.json"
printf 'retry evidence\n' > "$proof_dir/stage/final-run.json"
printf 'publication mutation\n' > "$proof_dir/proof-manifest.json"
node "$integrity" verify-digest "$proof_dir/qualification-gate.json" "$proof_dir/qualification-digests.json" "$proof_dir" "$input_dir"
printf '{"gitSha":"tampered"}\n' > "$proof_dir/release.json"
! node "$integrity" verify-digest "$proof_dir/qualification-gate.json" "$proof_dir/qualification-digests.json" "$proof_dir" "$input_dir" >/dev/null 2>&1
printf '{"gitSha":"qualified"}\n' > "$proof_dir/release.json"
printf 'not a named publication output\n' > "$proof_dir/unexpected-output.txt"
! node "$integrity" verify-digest "$proof_dir/qualification-gate.json" "$proof_dir/qualification-digests.json" "$proof_dir" "$input_dir" >/dev/null 2>&1

for invalid_run_id in '.' '..' '../escape' 'nested/path' $'control\ncharacter'; do
  if KFC_PROOF_RUN_ID="$invalid_run_id" \
    "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" >"$tmp_dir/invalid-run-id.out" 2>"$tmp_dir/invalid-run-id.err"; then
    echo "Expected invalid KFC_PROOF_RUN_ID to be rejected: $invalid_run_id" >&2
    exit 1
  fi
  grep -q 'KFC_PROOF_RUN_ID must match' "$tmp_dir/invalid-run-id.err"
done

mkdir -p "$reused_run_dir"
printf 'stale artifact\n' > "$reused_run_dir/stale.txt"
if KFC_PROOF_RUN_ID="$reused_run_id" \
  "$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh" >"$tmp_dir/reused-run-id.out" 2>"$tmp_dir/reused-run-id.err"; then
  echo "Expected reused KFC_PROOF_RUN_ID to be rejected" >&2
  exit 1
fi
grep -q 'already exists and is not empty' "$tmp_dir/reused-run-id.err"
test "$(<"$reused_run_dir/stale.txt")" = 'stale artifact'

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
printf '\x89PNG\r\n\x1a\n{"authorization":"Bearer live-secret"}\x00' > "$binary_scan_dir/screenshot.png"
source "$ROOT_DIR/scripts/lib/kfc-acceptance-artifacts.sh"
if ! scan_acceptance_artifacts_for_secrets "$binary_scan_dir" "$tmp_dir/binary-scan-findings.txt"; then
  echo "Expected binary screenshot secret to be detected" >&2
  exit 1
fi
grep -q 'Bearer live-secret' "$tmp_dir/binary-scan-findings.txt"

for authorization_json in \
  '{"authorization":"Bearer live-secret"}' \
  '{"Authorization": "Bearer live-secret"}' \
  "{'authorization' : 'bearer live-secret'}"; do
  printf '%s\n' "$authorization_json" > "$binary_scan_dir/authorization.json"
  scan_acceptance_artifacts_for_secrets "$binary_scan_dir" "$tmp_dir/json-authorization-findings.txt"
  grep -q 'live-secret' "$tmp_dir/json-authorization-findings.txt"
done

for surface in chatbot monitor; do
  output_dir="$tmp_dir/$surface"
  project="kfc-ai-$surface"
  canonical_url="https://$project.pages.dev"
  "$ROOT_DIR/scripts/generate-pages-deployment-assets.sh" \
    --surface "$surface" \
    --output-dir "$output_dir" \
    --git-sha "0123456789abcdef" \
    --release-built-at "2026-07-11T08:30:00Z" \
    --build-id "build-0123456789abcdef" \
    --deployment-id "deployment-0123456789abcdef" \
    --canonical-url "$canonical_url" \
    --project "$project" \
    --dirty false
  node - "$output_dir/release.json" "$project" "$canonical_url" <<'NODE'
const fs = require('node:fs');
const [path, project, canonicalUrl] = process.argv.slice(2);
const release = JSON.parse(fs.readFileSync(path, 'utf8'));
if (release.gitSha !== '0123456789abcdef' || release.releaseBuiltAt !== '2026-07-11T08:30:00Z' || release.dirty !== false
    || release.buildId !== 'build-0123456789abcdef' || release.deploymentId !== 'deployment-0123456789abcdef'
    || release.project !== project || release.canonicalUrl !== canonicalUrl) throw new Error('Incomplete Pages release identity');
NODE
  grep -q "env.KFC_AGENT_BACKEND_URL" "$output_dir/_worker.js"
  grep -q "return fetch(target.toString(), init)" "$output_dir/_worker.js"
done

grep -q "'/chat/kfc/message'" "$tmp_dir/chatbot/_worker.js"
grep -q "'/chat/kfc/genui-action'" "$tmp_dir/chatbot/_worker.js"
grep -q "startsWith('/chat/kfc/runs')" "$tmp_dir/chatbot/_worker.js"
! grep -q "startsWith('/dashboard/')" "$tmp_dir/chatbot/_worker.js"

grep -q "startsWith('/dashboard/')" "$tmp_dir/monitor/_worker.js"
! grep -q "'/chat/kfc/message'" "$tmp_dir/monitor/_worker.js"
! grep -q "startsWith('/chat/kfc/runs')" "$tmp_dir/monitor/_worker.js"

grep -q "gitSha" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "releaseBuiltAt" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "dirty.*false" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q '^./scripts/run-kfc-deployed-acceptance.sh$' "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "five golden and three matrix" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "catalog relevance" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q "proof-bundle.tar.gz" "$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"
grep -q 'dist/src/index.js' "$ROOT_DIR/services/kfc-agent-backend/package.json"
test -f "$ROOT_DIR/services/kfc-agent-backend/Dockerfile"

env_resolution_root="$tmp_dir/env-resolution"
env_resolution_main="$env_resolution_root/hackathon"
env_resolution_worktree="$env_resolution_main/.worktrees/judge"
env_resolution_gitdir="$env_resolution_main/.git/worktrees/judge"
mkdir -p "$env_resolution_worktree" "$env_resolution_gitdir"
printf 'OPENAI_API_KEY=main-key\n' > "$env_resolution_main/.env"
printf 'gitdir: %s\n' "$env_resolution_gitdir" > "$env_resolution_worktree/.git"
printf '../..\n' > "$env_resolution_gitdir/commondir"
resolved_env_file="$(cd "$ROOT_DIR/services/kfc-agent-backend" && npx tsx -- scripts/resolve-outcome-judge-env-file.ts --root "$env_resolution_worktree")"
test "$resolved_env_file" = "$env_resolution_main/.env"
