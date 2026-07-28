#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
exec python3 -m http.server "${KFC_RECOMMENDATION_EXPLAINER_PORT:-8512}" \
  --bind 127.0.0.1
