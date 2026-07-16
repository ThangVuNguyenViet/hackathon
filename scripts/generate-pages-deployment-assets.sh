#!/usr/bin/env bash
set -euo pipefail

surface=""
output_dir=""
git_sha=""
release_built_at=""
dirty=""
build_id=""
deployment_id=""
canonical_url=""
project=""

while (($#)); do
  case "$1" in
    --surface) surface="${2:-}"; shift 2 ;;
    --output-dir) output_dir="${2:-}"; shift 2 ;;
    --git-sha) git_sha="${2:-}"; shift 2 ;;
    --release-built-at) release_built_at="${2:-}"; shift 2 ;;
    --dirty) dirty="${2:-}"; shift 2 ;;
    --build-id) build_id="${2:-}"; shift 2 ;;
    --deployment-id) deployment_id="${2:-}"; shift 2 ;;
    --canonical-url) canonical_url="${2:-}"; shift 2 ;;
    --project) project="${2:-}"; shift 2 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 64 ;;
  esac
done

if [[ "$surface" != "chatbot" && "$surface" != "monitor" ]]; then
  echo "ERROR: --surface must be chatbot or monitor." >&2
  exit 64
fi
if [[ -z "$output_dir" || -z "$git_sha" || -z "$release_built_at" || -z "$build_id" || -z "$deployment_id" || -z "$canonical_url" || -z "$project" ]]; then
  echo "ERROR: release identity arguments are required." >&2
  exit 64
fi
if [[ "$dirty" != "false" ]]; then
  echo "ERROR: Deployment provenance requires --dirty false." >&2
  exit 65
fi

mkdir -p "$output_dir"
node - "$output_dir/release.json" "$git_sha" "$release_built_at" "$build_id" "$deployment_id" "$canonical_url" "$project" <<'NODE'
const fs = require('node:fs');
const [path, gitSha, releaseBuiltAt, buildId, deploymentId, canonicalUrl, project] = process.argv.slice(2);
const url = new URL(canonicalUrl);
if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error('canonicalUrl must be an HTTPS origin');
fs.writeFileSync(path, `${JSON.stringify({ gitSha, releaseBuiltAt, dirty: false, buildId, deploymentId, canonicalUrl: url.origin, project })}\n`);
NODE

if [[ "$surface" == "chatbot" ]]; then
  route_expression="url.pathname === '/ready' || url.pathname.startsWith('/showcase/') || url.pathname === '/chat/kfc/message' || url.pathname === '/chat/kfc/genui-action' || url.pathname.startsWith('/chat/kfc/runs')"
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

async function proxyBackendRequest(request, env, url) {
  if (!env.KFC_AGENT_BACKEND_URL) {
    return Response.json(
      { error: 'KFC_AGENT_BACKEND_URL is not configured' },
      { status: 503 },
    );
  }
  try {
    const target = new URL(url.pathname + url.search, env.KFC_AGENT_BACKEND_URL);
    const init = {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }
    return fetch(target.toString(), init);
  } catch (error) {
    return Response.json(
      {
        error: 'backend proxy failed',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
EOF
