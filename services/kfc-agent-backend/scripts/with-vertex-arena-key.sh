#!/bin/sh
set -eu

service_account="${VERTEX_ARENA_SERVICE_ACCOUNT:-kfc-planner-worker@kfc-model-arena-gemini.iam.gserviceaccount.com}"
existing_keys="$(gcloud iam service-accounts keys list \
  --iam-account="$service_account" \
  --managed-by=user \
  --format='value(name)')"
[ -z "$existing_keys" ] || {
  echo "Refusing to create a Vertex arena key while a user-managed key already exists." >&2
  exit 1
}

key_dir="$(mktemp -d "${TMPDIR:-/tmp}/kfc-gemini-live-key.XXXXXX")"
key_file="$key_dir/key.json"
key_id=

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ -z "$key_id" ] && [ -s "$key_file" ]; then
    key_id="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).private_key_id || '')" "$key_file" 2>/dev/null || true)"
  fi
  rm -f "$key_file"
  rmdir "$key_dir" 2>/dev/null || true
  remaining_keys=unknown
  zero_reads=0
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if [ -n "$key_id" ]; then
      gcloud iam service-accounts keys delete "$key_id" \
        --iam-account="$service_account" \
        --quiet >/dev/null 2>&1 || true
    fi
    if remaining_keys="$(gcloud iam service-accounts keys list \
      --iam-account="$service_account" \
      --managed-by=user \
      --format='value(name)' 2>/dev/null)"; then
      if [ -z "$remaining_keys" ]; then
        zero_reads=$((zero_reads + 1))
        [ "$zero_reads" -eq 3 ] && break
      else
        zero_reads=0
      fi
    else
      remaining_keys=unknown
      zero_reads=0
    fi
    [ "$attempt" -eq 15 ] || sleep 2
  done
  if [ "$zero_reads" -ne 3 ]; then
    echo "Vertex arena key cleanup failed; user-managed keys remain." >&2
    status=1
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

gcloud iam service-accounts keys create "$key_file" \
  --iam-account="$service_account" \
  --quiet >/dev/null 2>&1
key_id="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).private_key_id || '')" "$key_file")"
[ -n "$key_id" ] || {
  echo "Created Vertex key JSON did not contain private_key_id." >&2
  exit 1
}
key_visible=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  listed_key_ids="$(gcloud iam service-accounts keys list \
    --iam-account="$service_account" \
    --managed-by=user \
    --format='value(name.basename())')"
  if printf '%s\n' "$listed_key_ids" | grep -Fx "$key_id" >/dev/null; then
    key_visible=true
    break
  fi
  [ "$attempt" -eq 10 ] || sleep 2
done
[ "$key_visible" = true ] || {
  echo "Created Vertex arena key did not become visible before the timeout." >&2
  exit 1
}

VERTEX_SERVICE_ACCOUNT_JSON="$(node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))))" "$key_file")"
export VERTEX_SERVICE_ACCOUNT_JSON
"$@"
