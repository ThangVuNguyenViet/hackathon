#!/usr/bin/env bash
set -euo pipefail

surface=""
output_dir=""
git_sha=""
release_built_at=""
dirty=""

while (($#)); do
  case "$1" in
    --surface) surface="${2:-}"; shift 2 ;;
    --output-dir) output_dir="${2:-}"; shift 2 ;;
    --git-sha) git_sha="${2:-}"; shift 2 ;;
    --release-built-at) release_built_at="${2:-}"; shift 2 ;;
    --dirty) dirty="${2:-}"; shift 2 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 64 ;;
  esac
done

if [[ "$surface" != "chatbot" && "$surface" != "monitor" ]]; then
  echo "ERROR: --surface must be chatbot or monitor." >&2
  exit 64
fi
if [[ -z "$output_dir" || -z "$git_sha" || -z "$release_built_at" ]]; then
  echo "ERROR: --output-dir, --git-sha, and --release-built-at are required." >&2
  exit 64
fi
if [[ "$dirty" != "false" ]]; then
  echo "ERROR: Deployment provenance requires --dirty false." >&2
  exit 65
fi

mkdir -p "$output_dir"
printf '{"gitSha":"%s","releaseBuiltAt":"%s","dirty":false}\n' \
  "$git_sha" "$release_built_at" > "$output_dir/release.json"

if [[ "$surface" == "chatbot" ]]; then
  route_expression="url.pathname === '/ready' || url.pathname === '/chat/kfc/message' || url.pathname === '/chat/kfc/genui-action'"
else
  route_expression="url.pathname === '/ready' || url.pathname.startsWith('/dashboard/')"
fi

cat > "$output_dir/_worker.js" <<EOF
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if ($route_expression) {
      return proxyBackendRequest(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};

function proxyBackendRequest(request, env, url) {
  if (!env.KFC_AGENT_BACKEND_URL) {
    return Response.json(
      { error: 'KFC_AGENT_BACKEND_URL is not configured' },
      { status: 503 },
    );
  }
  const target = new URL(url.pathname + url.search, env.KFC_AGENT_BACKEND_URL);
  return fetch(new Request(target, request));
}
EOF
