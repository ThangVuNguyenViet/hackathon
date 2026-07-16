#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/services/kfc-agent-backend"
CHATBOT_URL="${KFC_CHATBOT_URL:-https://kfc-ai-chatbot.pages.dev}"
MONITOR_URL="${KFC_MONITOR_URL:-https://kfc-ai-live-monitor.pages.dev}"
ACCEPTANCE_PHASE="${KFC_ACCEPTANCE_PHASE:-qualification}"
if [[ "$ACCEPTANCE_PHASE" != "qualification" && "$ACCEPTANCE_PHASE" != "publish" ]]; then
  echo "ERROR: KFC_ACCEPTANCE_PHASE must be qualification or publish." >&2
  exit 64
fi
if [[ "$ACCEPTANCE_PHASE" == "publish" && -z "${KFC_PROOF_RUN_ID+x}" ]]; then
  echo "ERROR: KFC_PROOF_RUN_ID is required when resuming the publish phase." >&2
  exit 64
fi
if [[ -n "${KFC_PROOF_RUN_ID+x}" ]]; then
  RUN_ID="$KFC_PROOF_RUN_ID"
else
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
fi
if [[ "$RUN_ID" == "." || "$RUN_ID" == ".." || ! "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "ERROR: KFC_PROOF_RUN_ID must match [A-Za-z0-9._-]+." >&2
  exit 64
fi
OUTPUT_DIR="$ROOT_DIR/artifacts/kfc-deployed-proof/$RUN_ID"
MANIFEST="$OUTPUT_DIR/proof-manifest.json"
PHASE="initialize"
FINALIZED=false

if [[ "$ACCEPTANCE_PHASE" == "qualification" && -d "$OUTPUT_DIR" ]] && [[ -n "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "ERROR: Proof run directory already exists and is not empty: $OUTPUT_DIR" >&2
  exit 66
fi
if [[ "$ACCEPTANCE_PHASE" == "publish" && ! -f "$OUTPUT_DIR/qualification-gate.json" ]]; then
  echo "ERROR: Qualification gate is missing for proof run: $RUN_ID" >&2
  exit 66
fi
mkdir -p "$OUTPUT_DIR"
source "$ROOT_DIR/scripts/lib/kfc-acceptance-artifacts.sh"

finalize_failure() {
  local status=$?
  if [[ "$FINALIZED" == true ]]; then return; fi
  finalize_acceptance_failure "$MANIFEST" "$OUTPUT_DIR" "$RUN_ID" "$PHASE" "$status"
  echo "FAILED phase=$PHASE manifest=$MANIFEST" >&2
}
trap finalize_failure EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: Required command not found: $1" >&2
    exit 69
  }
}

for command in git node npm npx flutter curl gh shasum; do require_command "$command"; done

if [[ "$ACCEPTANCE_PHASE" == "qualification" ]]; then
PHASE="git_preflight"
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
UPSTREAM="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')"
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "ERROR: Acceptance requires a clean checkout." >&2
  exit 65
fi
git -C "$ROOT_DIR" fetch "${UPSTREAM%%/*}" --quiet
if ! git -C "$ROOT_DIR" merge-base --is-ancestor "$GIT_SHA" "$UPSTREAM"; then
  echo "ERROR: HEAD is not pushed to $UPSTREAM." >&2
  exit 65
fi
RELEASE_BUILT_AT="${RELEASE_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
RELEASE_DEPLOYMENT_ID="worker-${RUN_ID}"
PAGES_DEPLOYMENT_ID="pages-${RUN_ID}"
node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-1 "$OUTPUT_DIR/release.json" "$GIT_SHA" "$RELEASE_BUILT_AT" "$RELEASE_DEPLOYMENT_ID"
atomic_write_json_file "$MANIFEST" "$(<"$OUTPUT_DIR/release.json")"

PHASE="qualification_inputs"
QUALIFICATION_INPUT_DIR="${KFC_QUALIFICATION_INPUT_DIR:?KFC_QUALIFICATION_INPUT_DIR is required}"
GENUI_DEVICE="${KFC_GENUI_FLUTTER_DEVICE:?KFC_GENUI_FLUTTER_DEVICE is required}"
KFC_PROOF_ADMIN_TOKEN="${KFC_PROOF_ADMIN_TOKEN:?KFC_PROOF_ADMIN_TOKEN is required}"
KFC_MESSENGER_DUPLICATE_SIGNATURE="${KFC_MESSENGER_DUPLICATE_SIGNATURE:?KFC_MESSENGER_DUPLICATE_SIGNATURE is required}"
MESSENGER_EXPECTATIONS="${KFC_MESSENGER_EXPECTATIONS_FILE:?KFC_MESSENGER_EXPECTATIONS_FILE is required}"
MESSENGER_DUPLICATE_FILE="${KFC_MESSENGER_DUPLICATE_WEBHOOK_FILE:?KFC_MESSENGER_DUPLICATE_WEBHOOK_FILE is required}"
for pass in 1 2 3; do
  test -f "$QUALIFICATION_INPUT_DIR/cycle-$pass/golden-plan.json"
  test -f "$QUALIFICATION_INPUT_DIR/cycle-$pass/messenger-session-id"
done
for pass in 4 5; do
  test -f "$QUALIFICATION_INPUT_DIR/golden-$pass/golden-plan.json"
done
PHASE="deterministic_gates"
(
  cd "$BACKEND_DIR"
  npm run check:architecture
  npm run fixtures:build
  npm run build
  npm test
  npm run worker:deploy:dry-run
)
bash "$ROOT_DIR/tests/deployment/deploy_scripts.test.sh"
(
  cd "$ROOT_DIR/apps/kfc_live_monitor_flutter"
  flutter analyze
  flutter test
  flutter build web --release --pwa-strategy=none --target lib/main_customer.dart
  flutter build web --release --pwa-strategy=none --target lib/main_live.dart
)

PHASE="migration_classification"
historical_reviewed_destructive_migrations=(
  "0006_remove_customer_streaming_rollout.sql"
)
unreviewed_migrations=()
for migration in "$BACKEND_DIR"/migrations/*.sql; do
  reviewed=false
  for historical in "${historical_reviewed_destructive_migrations[@]}"; do
    if [[ "$(basename "$migration")" == "$historical" ]]; then reviewed=true; break; fi
  done
  [[ "$reviewed" == true ]] || unreviewed_migrations+=("$migration")
done
if rg -n -i '\b(drop|delete|truncate|rename)\b|alter[[:space:]]+table.+drop' \
  "${unreviewed_migrations[@]}" > "$OUTPUT_DIR/destructive-migration-findings.txt"; then
  echo "ERROR: Destructive or ambiguous D1 migration requires an explicit operator workflow." >&2
  exit 78
fi

PHASE="worker_deploy"
RELEASE_GIT_SHA="$GIT_SHA" RELEASE_DEPLOYMENT_ID="$RELEASE_DEPLOYMENT_ID" RELEASE_BUILT_AT="$RELEASE_BUILT_AT" \
  DEPLOYMENT_OUTPUT_FILE="$OUTPUT_DIR/worker-initial.json" \
  "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
WORKER_URL="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).workerUrl" "$OUTPUT_DIR/worker-initial.json")"

PHASE="worker_readiness"
worker_ready=false
for attempt in {1..3}; do
  poll_file="$OUTPUT_DIR/worker-ready-poll-$attempt.json"
  if curl -fsS -H 'Cache-Control: no-cache' "$WORKER_URL/ready?deep=1" > "$poll_file" && \
    node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-2 "$OUTPUT_DIR/release.json" "$poll_file"
  then
    cp "$poll_file" "$OUTPUT_DIR/worker-ready-initial.json"
    worker_ready=true
    break
  fi
  sleep 2
done
[[ "$worker_ready" == true ]] || {
  echo "ERROR: Worker release identity did not converge: $WORKER_URL" >&2
  exit 70
}

PHASE="pages_deploy"
KFC_AGENT_BACKEND_URL="$WORKER_URL" KFC_PAGES_DEPLOYMENT_ID="$PAGES_DEPLOYMENT_ID" RELEASE_BUILT_AT="$RELEASE_BUILT_AT" \
  DEPLOYMENT_OUTPUT_FILE="$OUTPUT_DIR/pages.json" \
  "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"

PHASE="canonical_pages_provenance"
for base in "$CHATBOT_URL" "$MONITOR_URL"; do
  ready=false
  for attempt in {1..3}; do
    poll_file="$OUTPUT_DIR/$(basename "$base").release-poll-$attempt.json"
    if curl -fsS -H 'Cache-Control: no-cache' "$base/release.json" > "$poll_file" && \
      node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-3 "$OUTPUT_DIR/release.json" "$poll_file" "$base" "$PAGES_DEPLOYMENT_ID"
    then
      cp "$poll_file" "$OUTPUT_DIR/$(basename "$base").release.json"
      ready=true
      break
    fi
    sleep 2
  done
  [[ "$ready" == true ]] || { echo "ERROR: Canonical Pages release did not converge: $base" >&2; exit 70; }
done

node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-4 "$OUTPUT_DIR/worker-ready-initial.json" "$OUTPUT_DIR/runtime-binding.json"
node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-5 "$OUTPUT_DIR/$(basename "$CHATBOT_URL").release.json" "$OUTPUT_DIR/flutter-release.json" "$CHATBOT_URL"

record_catalog_observation() {
  local label="$1"
  local current="$OUTPUT_DIR/catalog/$label.json"
  mkdir -p "$OUTPUT_DIR/catalog"
  curl -fsS -H 'Cache-Control: no-cache' "$WORKER_URL/ready?deep=1" > "$current"
  node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-6 "$OUTPUT_DIR/runtime-binding.json" "$current"
}

write_catalog_relevance_diff() {
  local before="$1"
  local after="$2"
  local output="$3"
  node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-7 "$before" "$after" "$output"
}

PHASE="live_matrix_qualification"
(
  cd "$BACKEND_DIR"
  set -a
  source "$ROOT_DIR/.env"
  set +a
  for cycle in 1 2 3; do
    record_catalog_observation "cycle-$cycle"
    if ((cycle > 1)); then
      write_catalog_relevance_diff "$OUTPUT_DIR/catalog/cycle-$((cycle - 1)).json" "$OUTPUT_DIR/catalog/cycle-$cycle.json" "$OUTPUT_DIR/catalog/cycle-$cycle-relevance.json"
    fi
    KFC_AGENT_BACKEND_URL="$WORKER_URL" \
    KFC_PROOF_ADMIN_TOKEN="$KFC_PROOF_ADMIN_TOKEN" \
    KFC_LIVE_SCENARIO_BRANCH_OUTPUT="$OUTPUT_DIR/live-scenarios/cycle-$cycle-branches.json" \
    npm run test:live:scenarios
    npm run test:live:small-talk-router
    npm run test:live:direct-catalog
    npm run test:live:interruption
    KFC_PROOF_RUN_ID="$RUN_ID" \
    KFC_PROOF_OUTPUT_DIR="$OUTPUT_DIR/kfc/cycle-$cycle" \
    KFC_AGENT_BACKEND_URL="$WORKER_URL" \
    KFC_PROOF_ADMIN_TOKEN="$KFC_PROOF_ADMIN_TOKEN" \
    KFC_EXPECTED_RUNTIME_BINDING_FILE="$OUTPUT_DIR/runtime-binding.json" \
    KFC_EXPECTED_FLUTTER_RELEASE_FILE="$OUTPUT_DIR/flutter-release.json" \
    KFC_GENUI_BRANCH_SESSIONS="$OUTPUT_DIR/live-scenarios/cycle-$cycle-branches.json" \
    KFC_GENUI_GOLDEN_PLAN="$QUALIFICATION_INPUT_DIR/cycle-$cycle/golden-plan.json" \
    KFC_GENUI_FLUTTER_DEVICE="$GENUI_DEVICE" \
    npm run test:live:genui:integration
    KFC_AGENT_BACKEND_URL="$WORKER_URL" \
    KFC_PROOF_ADMIN_TOKEN="$KFC_PROOF_ADMIN_TOKEN" \
    KFC_MESSENGER_SESSION_ID="$(<"$QUALIFICATION_INPUT_DIR/cycle-$cycle/messenger-session-id")" \
    KFC_MESSENGER_OUTPUT_DIR="$OUTPUT_DIR/messenger/cycle-$cycle" \
    KFC_EXPECTED_RUNTIME_BINDING_FILE="$OUTPUT_DIR/runtime-binding.json" \
    KFC_MESSENGER_EXPECTATIONS_FILE="$MESSENGER_EXPECTATIONS" \
    KFC_MESSENGER_DUPLICATE_WEBHOOK_FILE="$MESSENGER_DUPLICATE_FILE" \
    KFC_MESSENGER_DUPLICATE_SIGNATURE="$KFC_MESSENGER_DUPLICATE_SIGNATURE" \
    npm run proof:live:messenger
  done
  for pass in 4 5; do
    record_catalog_observation "golden-$pass"
    previous="$OUTPUT_DIR/catalog/$([[ "$pass" == 4 ]] && echo cycle-3 || echo golden-$((pass - 1))).json"
    write_catalog_relevance_diff "$previous" "$OUTPUT_DIR/catalog/golden-$pass.json" "$OUTPUT_DIR/catalog/golden-$pass-relevance.json"
    KFC_GENUI_PROOF_MODE=golden-only \
    KFC_GENUI_REUSED_BRANCHES_FILE="$OUTPUT_DIR/kfc/cycle-3/persisted-branches.json" \
    KFC_PROOF_RUN_ID="$RUN_ID" \
    KFC_PROOF_OUTPUT_DIR="$OUTPUT_DIR/kfc/golden-$pass" \
    KFC_AGENT_BACKEND_URL="$WORKER_URL" \
    KFC_PROOF_ADMIN_TOKEN="$KFC_PROOF_ADMIN_TOKEN" \
    KFC_EXPECTED_RUNTIME_BINDING_FILE="$OUTPUT_DIR/runtime-binding.json" \
    KFC_EXPECTED_FLUTTER_RELEASE_FILE="$OUTPUT_DIR/flutter-release.json" \
    KFC_GENUI_GOLDEN_PLAN="$QUALIFICATION_INPUT_DIR/golden-$pass/golden-plan.json" \
    KFC_GENUI_FLUTTER_DEVICE="$GENUI_DEVICE" \
    npm run test:live:genui:integration
  done
)

PHASE="durability_pre"
DURABILITY_SESSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).golden.sessionId" "$OUTPUT_DIR/kfc/cycle-1/manifest.json")"
ENCODED_SESSION="$(node -p 'encodeURIComponent(process.argv[1])' "$DURABILITY_SESSION")"
curl -fsS "$MONITOR_URL/dashboard/sessions/$ENCODED_SESSION/turns" > "$OUTPUT_DIR/durability-turns-before.json"
curl -fsS "$MONITOR_URL/dashboard/events/$ENCODED_SESSION" > "$OUTPUT_DIR/durability-events-before.json"

PHASE="worker_same_release_redeploy"
RELEASE_GIT_SHA="$GIT_SHA" RELEASE_DEPLOYMENT_ID="$RELEASE_DEPLOYMENT_ID" RELEASE_BUILT_AT="$RELEASE_BUILT_AT" \
  DEPLOYMENT_OUTPUT_FILE="$OUTPUT_DIR/worker-replacement.json" \
  "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
curl -fsS "$WORKER_URL/ready?deep=1" > "$OUTPUT_DIR/worker-ready-replacement.json"
node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-8 "$OUTPUT_DIR/release.json" "$OUTPUT_DIR/worker-ready-replacement.json"

PHASE="durability_post"
curl -fsS "$MONITOR_URL/dashboard/sessions/$ENCODED_SESSION/turns" > "$OUTPUT_DIR/durability-turns-after.json"
curl -fsS "$MONITOR_URL/dashboard/events/$ENCODED_SESSION" > "$OUTPUT_DIR/durability-events-after.json"
cmp -s "$OUTPUT_DIR/durability-turns-before.json" "$OUTPUT_DIR/durability-turns-after.json"
cmp -s "$OUTPUT_DIR/durability-events-before.json" "$OUTPUT_DIR/durability-events-after.json"

PHASE="production_latency"
(
  cd "$BACKEND_DIR"
  PRODUCTION_CHAT_URL="$CHATBOT_URL" npm run proof:production:latency
)
LATENCY_REPORT="$(find "$ROOT_DIR/artifacts/production-latency" -type f -name 'latency-*.json' -print0 | xargs -0 ls -t | head -1)"
mkdir -p "$OUTPUT_DIR/latency"
cp "$LATENCY_REPORT" "$OUTPUT_DIR/latency/report.json"
LATENCY_REPORT="$OUTPUT_DIR/latency/report.json"

PHASE="qualification_digest_manifest"
node "$ROOT_DIR/scripts/lib/kfc-qualification-integrity.mjs" create-digest \
  "$OUTPUT_DIR/qualification-digests.json" "$OUTPUT_DIR" "$QUALIFICATION_INPUT_DIR"

PHASE="qualification_gate"
node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-9 "$OUTPUT_DIR/qualification-gate.json" "$OUTPUT_DIR" "$GIT_SHA" "$RELEASE_DEPLOYMENT_ID" "$WORKER_URL" "$CHATBOT_URL" "$MONITOR_URL" "$LATENCY_REPORT" "$OUTPUT_DIR/qualification-digests.json" "$OUTPUT_DIR/$(basename "$CHATBOT_URL").release.json"
node "$ROOT_DIR/scripts/lib/kfc-qualification-integrity.mjs" verify-ages \
  "$OUTPUT_DIR/qualification-gate.json" "$LATENCY_REPORT"
FINALIZED=true
trap - EXIT
echo "QUALIFIED run=$RUN_ID gate=$OUTPUT_DIR/qualification-gate.json"
echo "Capture the recording, rehearsals, preflight, and final run with this gate ID, then resume with KFC_ACCEPTANCE_PHASE=publish KFC_PROOF_RUN_ID=$RUN_ID."
exit 0
fi

PHASE="publication_resume"
QUALIFICATION_INPUT_DIR="${KFC_QUALIFICATION_INPUT_DIR:?KFC_QUALIFICATION_INPUT_DIR is required}"
STAGE_EVIDENCE_DIR="${KFC_STAGE_EVIDENCE_DIR:?KFC_STAGE_EVIDENCE_DIR is required}"
GIT_SHA="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).gitSha" "$OUTPUT_DIR/qualification-gate.json")"
RELEASE_DEPLOYMENT_ID="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).deploymentId" "$OUTPUT_DIR/qualification-gate.json")"
WORKER_URL="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).workerUrl" "$OUTPUT_DIR/qualification-gate.json")"
CHATBOT_URL="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).chatbotUrl" "$OUTPUT_DIR/qualification-gate.json")"
MONITOR_URL="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).monitorUrl" "$OUTPUT_DIR/qualification-gate.json")"
LATENCY_REPORT="$OUTPUT_DIR/$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).latencyReport" "$OUTPUT_DIR/qualification-gate.json")"
RELEASE_BUILT_AT="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).releaseBuiltAt" "$OUTPUT_DIR/release.json")"

PHASE="qualification_integrity"
node "$ROOT_DIR/scripts/lib/kfc-qualification-integrity.mjs" verify-ages \
  "$OUTPUT_DIR/qualification-gate.json" "$LATENCY_REPORT"
node "$ROOT_DIR/scripts/lib/kfc-qualification-integrity.mjs" verify-digest \
  "$OUTPUT_DIR/qualification-gate.json" "$OUTPUT_DIR/qualification-digests.json" "$OUTPUT_DIR" "$QUALIFICATION_INPUT_DIR"
if [[ "$(git -C "$ROOT_DIR" rev-parse HEAD)" != "$GIT_SHA" ]] || [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "ERROR: Publication must resume from the clean qualified commit $GIT_SHA." >&2
  exit 65
fi
for evidence in recording-manifest.json rehearsal-1.json rehearsal-2.json final-run.json stage-preflight.json; do
  test -f "$STAGE_EVIDENCE_DIR/$evidence"
done

PHASE="publication_identity_revalidation"
mkdir -p "$OUTPUT_DIR/publication-readiness"
worker_current=false
for attempt in {1..3}; do
  poll_file="$OUTPUT_DIR/publication-readiness/worker-$attempt.json"
  if curl -fsS -H 'Cache-Control: no-cache' "$WORKER_URL/ready?deep=1" > "$poll_file" && \
    node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-10 "$OUTPUT_DIR/release.json" "$poll_file"
  then worker_current=true; break; fi
  sleep 2
done
[[ "$worker_current" == true ]] || { echo "ERROR: Qualified Worker identity changed before publication." >&2; exit 70; }
for base in "$CHATBOT_URL" "$MONITOR_URL"; do
  expected="$OUTPUT_DIR/$(basename "$base").release.json"
  current=false
  for attempt in {1..3}; do
    poll_file="$OUTPUT_DIR/publication-readiness/$(basename "$base")-$attempt.json"
    if curl -fsS -H 'Cache-Control: no-cache' "$base/release.json" > "$poll_file" && cmp -s "$expected" "$poll_file"; then
      current=true
      break
    fi
    sleep 2
  done
  [[ "$current" == true ]] || { echo "ERROR: Qualified Pages identity changed before publication: $base" >&2; exit 70; }
done

PHASE="stage_evidence"
node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-11 "$STAGE_EVIDENCE_DIR" "$OUTPUT_DIR/stage" "$OUTPUT_DIR/runtime-binding.json" "$OUTPUT_DIR/qualification-gate.json" "$GIT_SHA" "$RELEASE_DEPLOYMENT_ID"

PHASE="publication_hygiene"
if scan_acceptance_artifacts_for_secrets "$OUTPUT_DIR" "$OUTPUT_DIR/secret-scan-findings.txt"; then
  echo "ERROR: Secret/PII scan found publish-blocking content." >&2
  exit 77
fi
rm -f "$OUTPUT_DIR/secret-scan-findings.txt"

PHASE="finalize_manifest"
manifest_content="$(node "$ROOT_DIR/scripts/lib/kfc-acceptance-checks.mjs" check-12 "$RUN_ID" "$GIT_SHA" "$RELEASE_BUILT_AT" "$WORKER_URL" "$CHATBOT_URL" "$MONITOR_URL" "$OUTPUT_DIR" "$LATENCY_REPORT"
)"
atomic_write_json_file "$MANIFEST" "$manifest_content"

PHASE="checksums"
(
  cd "$OUTPUT_DIR"
  find . -type f ! -name 'SHA256SUMS' ! -name 'proof-bundle.tar.gz' -print0 \
    | sort -z | xargs -0 shasum -a 256 > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
  tar -czf proof-bundle.tar.gz --exclude=proof-bundle.tar.gz .
)

PHASE="github_release"
gh release create "kfc-proof-$RUN_ID" \
  --target "$GIT_SHA" \
  --title "KFC deployed proof $RUN_ID" \
  --notes "Deployed-only KFC acceptance evidence for $GIT_SHA" \
  "$MANIFEST" "$OUTPUT_DIR/SHA256SUMS" "$OUTPUT_DIR/proof-bundle.tar.gz" \
  "$OUTPUT_DIR/runtime-binding.json" "$OUTPUT_DIR/flutter-release.json"

FINALIZED=true
trap - EXIT
echo "ACCEPTED manifest=$MANIFEST"
