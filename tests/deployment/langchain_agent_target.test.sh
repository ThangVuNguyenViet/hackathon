#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

assert_fails_with_agent_target() {
  local output_file="$1"
  shift

  set +e
  "$@" >"$output_file" 2>&1
  local exit_code=$?
  set -e

  test "$exit_code" -eq 64
  grep -Fq 'KFC_AGENT_MODEL must be gemini-3.1-flash-lite' "$output_file"
}

run_cloud_run_preflight() {
  KFC_DEPLOY_PREFLIGHT_ONLY=true \
    GCP_PROJECT_ID=test-project \
    META_PAGE_ID=test-page \
    KFC_AGENT_PROFILE_MODE=production \
    KFC_AGENT_PROVIDER=google \
    KFC_AGENT_MODEL="$1" \
    KFC_MONITOR_PROVIDER=google \
    KFC_MONITOR_MODEL=gemini-3.1-flash-lite \
    "$ROOT_DIR/scripts/deploy-backend-cloud-run.sh"
}

worker_env_file="$tmp_dir/worker.env"
cat >"$worker_env_file" <<'EOF'
LANGSMITH_API_KEY=test-langsmith-key
LANGSMITH_PROJECT=test-project
LANGSMITH_ENDPOINT=https://example.test/langsmith
META_APP_SECRET=test-meta-secret
META_PAGE_ACCESS_TOKEN=test-page-access-token
KFC_CONFIRMATION_SIGNING_KEY_ID=test-active
KFC_CONFIRMATION_SIGNING_SECRET=test-confirmation-signing-secret-32-bytes-minimum
KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS=[]
KFC_AGENT_PROVIDER=google
KFC_AGENT_MODEL=gemini-3.1-flash-lite
KFC_MONITOR_PROVIDER=google
KFC_MONITOR_MODEL=gemini-3.1-flash-lite
GOOGLE_API_KEY=test-google-key
KFC_COMMERCE_MODE=fixture
KFC_COMMERCE_ENVIRONMENT=sandbox
EOF

run_worker_preflight() {
  local agent_model="$1"
  local env_file="$tmp_dir/worker-${agent_model}.env"
  sed "s/^KFC_AGENT_MODEL=.*/KFC_AGENT_MODEL=${agent_model}/" "$worker_env_file" >"$env_file"

  ALLOW_NON_MAIN_DEPLOY=true \
    KFC_DEPLOY_PREFLIGHT_ONLY=true \
    ENV_FILE="$env_file" \
    "$ROOT_DIR/scripts/deploy-backend-cloudflare-worker.sh"
}

run_cloud_run_preflight gemini-3.1-flash-lite
assert_fails_with_agent_target \
  "$tmp_dir/cloud-run-invalid.out" \
  run_cloud_run_preflight gpt-4.1-mini

run_worker_preflight gemini-3.1-flash-lite
assert_fails_with_agent_target \
  "$tmp_dir/worker-invalid.out" \
  run_worker_preflight gpt-4.1-mini

fake_bin="$tmp_dir/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/gcloud" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$GCLOUD_CAPTURE_FILE"
if [[ "$*" == run\ services\ describe* ]]; then
  printf '%s\n' 'https://kfc-langchain.example.test'
fi
EOF
cat >"$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '{"ok":true}\n'
EOF
chmod +x "$fake_bin/gcloud" "$fake_bin/curl"

GCLOUD_CAPTURE_FILE="$tmp_dir/gcloud-args.log" \
PATH="$fake_bin:$PATH" \
GCP_PROJECT_ID=test-project \
META_PAGE_ID=test-page \
KFC_AGENT_PROFILE_MODE=production \
KFC_AGENT_PROVIDER=google \
KFC_AGENT_MODEL=gemini-3.1-flash-lite \
KFC_MONITOR_PROVIDER=google \
KFC_MONITOR_MODEL=gemini-3.1-flash-lite \
CLOUD_RUN_IMAGE_URI=asia-southeast1-docker.pkg.dev/test-project/hackathon/kfc-agent-backend:test-sha \
"$ROOT_DIR/scripts/deploy-backend-cloud-run.sh" >"$tmp_dir/cloud-run-deploy.out"

grep -Fq "builds submit $ROOT_DIR --project test-project --config $ROOT_DIR/services/kfc-agent-backend/cloudbuild.cloud-run.yaml --substitutions _IMAGE_URI=asia-southeast1-docker.pkg.dev/test-project/hackathon/kfc-agent-backend:test-sha" "$tmp_dir/gcloud-args.log"
grep -Fq "run deploy kfc-agent-backend --project test-project --region asia-southeast1 --image asia-southeast1-docker.pkg.dev/test-project/hackathon/kfc-agent-backend:test-sha" "$tmp_dir/gcloud-args.log"
! grep -Fq -- "--source" "$tmp_dir/gcloud-args.log"

echo "LangChain agent target tests passed."
