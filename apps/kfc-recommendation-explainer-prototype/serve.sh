#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
if [[ ! -x node_modules/.bin/wrangler ]]; then
  npm install
fi

./node_modules/.bin/wrangler d1 execute \
  kfc-recommendation-workbench-prototype \
  --local \
  --file schema.sql

exec ./node_modules/.bin/wrangler dev \
  --local \
  --port "${KFC_RECOMMENDATION_EXPLAINER_PORT:-8512}"
