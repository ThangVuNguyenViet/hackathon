#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ASSET_GENERATOR="$ROOT_DIR/scripts/generate-pages-deployment-assets.sh"
PAGES_DEPLOY="$ROOT_DIR/scripts/deploy-dashboard-cloudflare-pages.sh"
ACCEPTANCE_RUNNER="$ROOT_DIR/scripts/run-kfc-deployed-acceptance.sh"
ARTIFACT_HELPERS="$ROOT_DIR/scripts/lib/kfc-acceptance-artifacts.sh"
QUALIFICATION_INTEGRITY="$ROOT_DIR/scripts/lib/kfc-qualification-integrity.mjs"
PROVENANCE_RUNBOOK="$ROOT_DIR/docs/deployment/two-pages-provenance-runbook.md"

for file in \
  "$ASSET_GENERATOR" \
  "$PAGES_DEPLOY" \
  "$ACCEPTANCE_RUNNER" \
  "$ARTIFACT_HELPERS" \
  "$QUALIFICATION_INTEGRITY" \
  "$PROVENANCE_RUNBOOK"; do
  test -f "$file"
done

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

chatbot_dir="$tmp_dir/chatbot"
monitor_dir="$tmp_dir/monitor"
mkdir -p "$chatbot_dir" "$monitor_dir"
printf '<html>chatbot</html>\n' >"$chatbot_dir/index.html"
printf '<html>monitor</html>\n' >"$monitor_dir/index.html"

common_args=(
  --git-sha test-sha
  --release-built-at 2026-08-12T00:00:00Z
  --build-id test-build
  --deployment-id test-pages
  --dirty false
)
"$ASSET_GENERATOR" \
  --surface chatbot \
  --output-dir "$chatbot_dir" \
  --canonical-url https://kfc-ai-chatbot.pages.dev \
  --project kfc-ai-chatbot \
  "${common_args[@]}"
"$ASSET_GENERATOR" \
  --surface monitor \
  --output-dir "$monitor_dir" \
  --canonical-url https://kfc-ai-live-monitor.pages.dev \
  --project kfc-ai-live-monitor \
  "${common_args[@]}"

grep -q "url.pathname === '/chat/kfc/message'" "$chatbot_dir/_worker.js"
! grep -q "url.pathname.startsWith('/dashboard/')" "$chatbot_dir/_worker.js"
grep -q "url.pathname.startsWith('/dashboard/')" "$monitor_dir/_worker.js"
! grep -q "url.pathname === '/chat/kfc/message'" "$monitor_dir/_worker.js"
! grep -Eq "https://[^[:space:]\"']+\\.workers\\.dev" \
  "$chatbot_dir/_worker.js" \
  "$monitor_dir/_worker.js" \
  "$PAGES_DEPLOY"

node - "$chatbot_dir/release.json" "$monitor_dir/release.json" <<'NODE'
const fs = require('node:fs');
const [chatbotPath, monitorPath] = process.argv.slice(2);
const chatbot = JSON.parse(fs.readFileSync(chatbotPath, 'utf8'));
const monitor = JSON.parse(fs.readFileSync(monitorPath, 'utf8'));
if (chatbot.gitSha !== 'test-sha' || monitor.gitSha !== 'test-sha') process.exit(1);
if (chatbot.releaseBuiltAt !== monitor.releaseBuiltAt || chatbot.dirty || monitor.dirty) process.exit(1);
if (chatbot.project === monitor.project || chatbot.canonicalUrl === monitor.canonicalUrl) process.exit(1);
NODE

grep -q "lib/main_customer.dart kfc-ai-chatbot" "$PAGES_DEPLOY"
grep -q "lib/main_live.dart kfc-ai-live-monitor" "$PAGES_DEPLOY"
grep -q -- "--pwa-strategy=none" "$PAGES_DEPLOY"
grep -q "same .*gitSha.*releaseBuiltAt" "$PROVENANCE_RUNBOOK"
grep -q "dirty.*false" "$PROVENANCE_RUNBOOK"

proof_dir="$tmp_dir/proof"
input_dir="$tmp_dir/input"
mkdir -p "$proof_dir/catalog" "$input_dir"
printf '{"catalog":"approved"}\n' >"$proof_dir/catalog/observation.json"
printf '{"input":"approved"}\n' >"$input_dir/cycle.json"
digest_path="$tmp_dir/qualification-digests.json"
gate_path="$tmp_dir/qualification-gate.json"
latency_path="$tmp_dir/latency.json"
node "$QUALIFICATION_INTEGRITY" create-digest "$digest_path" "$proof_dir" "$input_dir"
node - "$digest_path" "$gate_path" "$latency_path" <<'NODE'
const fs = require('node:fs');
const [digestPath, gatePath, latencyPath] = process.argv.slice(2);
const digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
fs.writeFileSync(gatePath, JSON.stringify({
  qualificationDigestSha256: digest.sha256,
  issuedAt: '2026-08-12T00:30:00.000Z',
  qualificationCompletedAt: '2026-08-12T00:10:00.000Z',
}));
fs.writeFileSync(latencyPath, JSON.stringify({
  completedAt: '2026-08-12T00:20:00.000Z',
}));
NODE
node "$QUALIFICATION_INTEGRITY" verify-digest "$gate_path" "$digest_path" "$proof_dir" "$input_dir"
node "$QUALIFICATION_INTEGRITY" verify-ages "$gate_path" "$latency_path" 2026-08-12T01:00:00.000Z
printf '{"input":"tampered"}\n' >"$input_dir/cycle.json"
if node "$QUALIFICATION_INTEGRITY" verify-digest "$gate_path" "$digest_path" "$proof_dir" "$input_dir" >/dev/null 2>&1; then
  echo "Expected qualification digest verification to reject tampering." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ARTIFACT_HELPERS"
artifact_dir="$tmp_dir/artifacts"
mkdir -p "$artifact_dir"
printf '{"ok":true}\n' >"$artifact_dir/safe.json"
set +e
scan_acceptance_artifacts_for_secrets "$artifact_dir" "$tmp_dir/safe-findings.txt"
safe_scan_status=$?
set -e
test "$safe_scan_status" -eq 1
printf 'api_key=abcdefghijklmnop\n' >"$artifact_dir/leak.txt"
scan_acceptance_artifacts_for_secrets "$artifact_dir" "$tmp_dir/leak-findings.txt"
grep -q "api_key" "$tmp_dir/leak-findings.txt"

manifest="$artifact_dir/proof-manifest.json"
atomic_write_json_file "$manifest" '{"runId":"proof-run","passed":true}'
printf 'old checksum\n' >"$artifact_dir/SHA256SUMS"
printf 'old bundle\n' >"$artifact_dir/proof-bundle.tar.gz"
finalize_acceptance_failure "$manifest" "$artifact_dir" proof-run deployment_test 7
test ! -e "$artifact_dir/SHA256SUMS"
test ! -e "$artifact_dir/proof-bundle.tar.gz"
node - "$manifest" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (manifest.passed !== false || manifest.acceptanceStatus !== 'failed') process.exit(1);
if (manifest.failedPhase !== 'deployment_test' || manifest.exitCode !== 7) process.exit(1);
NODE

grep -q "scan_acceptance_artifacts_for_secrets" "$ACCEPTANCE_RUNNER"
! grep -q '\. "$ROOT_DIR/.env"' "$ACCEPTANCE_RUNNER"
grep -q "qualification-gate.json" "$ACCEPTANCE_RUNNER"
grep -q "qualification-digests.json" "$ACCEPTANCE_RUNNER"
grep -q "publication_identity_revalidation" "$ACCEPTANCE_RUNNER"
grep -q "Qualified Worker identity changed before publication" "$ACCEPTANCE_RUNNER"
grep -q "Qualified Pages identity changed before publication" "$ACCEPTANCE_RUNNER"
grep -q "shasum -a 256 -c SHA256SUMS" "$ACCEPTANCE_RUNNER"
grep -q "gh release create" "$ACCEPTANCE_RUNNER"
grep -q "A-Za-z0-9._-" "$ACCEPTANCE_RUNNER"

durability_line="$(grep -n 'PHASE="durability_post"' "$ACCEPTANCE_RUNNER" | cut -d: -f1)"
latency_line="$(grep -n 'PHASE="production_latency"' "$ACCEPTANCE_RUNNER" | cut -d: -f1)"
publication_line="$(grep -n 'PHASE="publication_hygiene"' "$ACCEPTANCE_RUNNER" | cut -d: -f1)"
test "$durability_line" -lt "$latency_line"
test "$latency_line" -lt "$publication_line"

echo "Deployment integrity safeguards passed."
