#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/services/kfc-agent-backend"
CHATBOT_URL="${KFC_CHATBOT_URL:-https://kfc-ai-chatbot.pages.dev}"
MONITOR_URL="${KFC_MONITOR_URL:-https://kfc-ai-live-monitor.pages.dev}"
RUN_ID="${KFC_PROOF_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)}"
OUTPUT_DIR="$ROOT_DIR/artifacts/kfc-deployed-proof/$RUN_ID"
MANIFEST="$OUTPUT_DIR/proof-manifest.json"
PHASE="initialize"
FINALIZED=false

mkdir -p "$OUTPUT_DIR"

finalize_failure() {
  local status=$?
  if [[ "$FINALIZED" == true ]]; then return; fi
  node - "$MANIFEST" "$RUN_ID" "$PHASE" "$status" <<'NODE'
const [path, runId, phase, status] = process.argv.slice(2);
const fs = require('node:fs');
let prior = {};
try { prior = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
fs.writeFileSync(path, JSON.stringify({ ...prior, runId, passed: false, acceptanceStatus: 'failed', failedPhase: phase, exitCode: Number(status), finalizedAt: new Date().toISOString() }, null, 2) + '\n');
NODE
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
printf '{"gitSha":"%s","releaseBuiltAt":"%s","dirty":false}\n' \
  "$GIT_SHA" "$RELEASE_BUILT_AT" > "$OUTPUT_DIR/release.json"
cp "$OUTPUT_DIR/release.json" "$MANIFEST"

PHASE="deterministic_gates"
(
  cd "$BACKEND_DIR"
  npm run build
  npm test -- --maxWorkers=1 --no-file-parallelism
  npm run worker:deploy:dry-run
)
bash "$ROOT_DIR/tests/deployment/deploy_scripts.test.sh"
(
  cd "$ROOT_DIR/apps/kfc_live_monitor_flutter"
  flutter test
)

PHASE="migration_classification"
if rg -n -i '\b(drop|delete|truncate|rename)\b|alter[[:space:]]+table.+drop' \
  "$BACKEND_DIR/migrations"/*.sql > "$OUTPUT_DIR/destructive-migration-findings.txt"; then
  echo "ERROR: Destructive or ambiguous D1 migration requires an explicit operator workflow." >&2
  exit 78
fi

PHASE="worker_deploy"
RELEASE_GIT_SHA="$GIT_SHA" RELEASE_BUILT_AT="$RELEASE_BUILT_AT" \
  DEPLOYMENT_OUTPUT_FILE="$OUTPUT_DIR/worker-initial.json" \
  "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
WORKER_URL="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).workerUrl" "$OUTPUT_DIR/worker-initial.json")"

PHASE="worker_readiness"
worker_ready=false
for _ in {1..30}; do
  if curl -fsS -H 'Cache-Control: no-cache' "$WORKER_URL/ready?deep=1" > "$OUTPUT_DIR/worker-ready-initial.json" && \
    node - "$OUTPUT_DIR/release.json" "$OUTPUT_DIR/worker-ready-initial.json" <<'NODE'
const fs = require('node:fs');
const [expectedPath, actualPath] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(expectedPath));
const actual = JSON.parse(fs.readFileSync(actualPath));
if (!actual.ok || JSON.stringify(actual.release) !== JSON.stringify(expected)) process.exit(1);
NODE
  then
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
KFC_AGENT_BACKEND_URL="$WORKER_URL" RELEASE_BUILT_AT="$RELEASE_BUILT_AT" \
  DEPLOYMENT_OUTPUT_FILE="$OUTPUT_DIR/pages.json" \
  "$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"

PHASE="canonical_pages_provenance"
for base in "$CHATBOT_URL" "$MONITOR_URL"; do
  ready=false
  for _ in {1..30}; do
    if curl -fsS -H 'Cache-Control: no-cache' "$base/release.json" > "$OUTPUT_DIR/$(basename "$base").release.json" && \
      cmp -s "$OUTPUT_DIR/release.json" "$OUTPUT_DIR/$(basename "$base").release.json"; then
      ready=true
      break
    fi
    sleep 2
  done
  [[ "$ready" == true ]] || { echo "ERROR: Canonical Pages release did not converge: $base" >&2; exit 70; }
done

PHASE="browser_scenarios"
(
  cd "$BACKEND_DIR"
  KFC_CHATBOT_URL="$CHATBOT_URL" \
  KFC_MONITOR_URL="$MONITOR_URL" \
  KFC_PROOF_RUN_ID="$RUN_ID" \
  KFC_PROOF_OUTPUT_DIR="$OUTPUT_DIR/browser" \
  KFC_EXPECTED_RELEASE_FILE="$OUTPUT_DIR/release.json" \
  npx tsx scripts/run-deployed-browser-proof.ts
)

PHASE="durability_pre"
DURABILITY_SESSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).scenarios.find(x=>x.scenarioId.startsWith('01-')).sessionId" "$OUTPUT_DIR/browser/browser-proof.json")"
ENCODED_SESSION="$(node -p 'encodeURIComponent(process.argv[1])' "$DURABILITY_SESSION")"
curl -fsS "$MONITOR_URL/dashboard/sessions/$ENCODED_SESSION/turns" > "$OUTPUT_DIR/durability-turns-before.json"
curl -fsS "$MONITOR_URL/dashboard/events/$ENCODED_SESSION" > "$OUTPUT_DIR/durability-events-before.json"

PHASE="worker_same_release_redeploy"
RELEASE_GIT_SHA="$GIT_SHA" RELEASE_BUILT_AT="$RELEASE_BUILT_AT" \
  DEPLOYMENT_OUTPUT_FILE="$OUTPUT_DIR/worker-replacement.json" \
  "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
curl -fsS "$WORKER_URL/ready?deep=1" > "$OUTPUT_DIR/worker-ready-replacement.json"
node - "$OUTPUT_DIR/release.json" "$OUTPUT_DIR/worker-ready-replacement.json" <<'NODE'
const fs = require('node:fs');
const [expectedPath, actualPath] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(expectedPath));
const actual = JSON.parse(fs.readFileSync(actualPath));
if (!actual.ok || JSON.stringify(actual.release) !== JSON.stringify(expected)) {
  throw new Error('Replacement Worker release identity mismatch');
}
NODE

PHASE="durability_post"
curl -fsS "$MONITOR_URL/dashboard/sessions/$ENCODED_SESSION/turns" > "$OUTPUT_DIR/durability-turns-after.json"
curl -fsS "$MONITOR_URL/dashboard/events/$ENCODED_SESSION" > "$OUTPUT_DIR/durability-events-after.json"
cmp -s "$OUTPUT_DIR/durability-turns-before.json" "$OUTPUT_DIR/durability-turns-after.json"
cmp -s "$OUTPUT_DIR/durability-events-before.json" "$OUTPUT_DIR/durability-events-after.json"

PHASE="outcome_judgments"
(
  cd "$BACKEND_DIR"
  caller_outcome_judge_model="${OUTCOME_JUDGE_MODEL-}"
  caller_selected_outcome_judge_model=false
  if [[ -n "${OUTCOME_JUDGE_MODEL+x}" ]]; then
    caller_selected_outcome_judge_model=true
  fi
  set -a
  [ ! -f "$ROOT_DIR/.env" ] || . "$ROOT_DIR/.env"
  set +a
  if [[ "$caller_selected_outcome_judge_model" == true ]]; then
    OUTCOME_JUDGE_MODEL="$caller_outcome_judge_model"
  fi
  JUDGE_MODEL="${OUTCOME_JUDGE_MODEL:-gpt-4.1-mini}"
  OUTCOME_JUDGE_MODEL="$JUDGE_MODEL" \
    npx tsx scripts/run-outcome-judgments.ts \
      --evidence "$OUTPUT_DIR/browser/outcome-evidence.json" \
      --output "$OUTPUT_DIR/outcome-judgments.json" \
      --release-metadata "$OUTPUT_DIR/release.json" \
      --model "$JUDGE_MODEL"
)
node - "$OUTPUT_DIR/outcome-judgments.json" "$OUTPUT_DIR/release.json" <<'NODE'
const fs = require('node:fs');
const [judgmentsPath, releasePath] = process.argv.slice(2);
const judgments = JSON.parse(fs.readFileSync(judgmentsPath, 'utf8'));
const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
const scenarios = Array.isArray(judgments.scenarios) ? judgments.scenarios : [];
if (scenarios.length !== 9 || scenarios.some((entry) => entry?.judgment?.passed !== true)) {
  throw new Error('Outcome judgments must contain exactly nine passing judgments');
}
for (const field of ['gitSha', 'releaseBuiltAt', 'dirty']) {
  if (judgments[field] !== release[field]) throw new Error(`Outcome judgment release mismatch: ${field}`);
}
NODE

PHASE="publication_hygiene"
if rg -n -i '(authorization:[[:space:]]*bearer|api[_-]?key["=: ]+[A-Za-z0-9_-]{16,}|gho_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{16,})' \
  "$OUTPUT_DIR" > "$OUTPUT_DIR/secret-scan-findings.txt"; then
  echo "ERROR: Secret/PII scan found publish-blocking content." >&2
  exit 77
fi
rm -f "$OUTPUT_DIR/secret-scan-findings.txt"

PHASE="finalize_manifest"
node - "$MANIFEST" "$RUN_ID" "$GIT_SHA" "$RELEASE_BUILT_AT" "$WORKER_URL" "$CHATBOT_URL" "$MONITOR_URL" <<'NODE'
const fs = require('node:fs');
const [path, runId, gitSha, releaseBuiltAt, workerUrl, chatbotUrl, monitorUrl] = process.argv.slice(2);
fs.writeFileSync(path, JSON.stringify({ runId, passed: true, acceptanceStatus: 'accepted', gitSha, releaseBuiltAt, dirty: false, workerUrl, chatbotUrl, monitorUrl, finalizedAt: new Date().toISOString() }, null, 2) + '\n');
NODE

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
  "$OUTPUT_DIR/outcome-judgments.json"

FINALIZED=true
trap - EXIT
echo "ACCEPTED manifest=$MANIFEST"
