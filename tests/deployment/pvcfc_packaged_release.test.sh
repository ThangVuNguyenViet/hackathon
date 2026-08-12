#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/services/kfc-agent-backend"
RUNBOOK="$ROOT_DIR/docs/wayfinder/pvcfc-scloud-deployment/issues/05-deploy-runbook.md"

test -f "$BACKEND_DIR/Dockerfile.pvcfc"
test -f "$BACKEND_DIR/Dockerfile.pvcfc.dockerignore"
grep -q 'COPY dist ./dist' "$BACKEND_DIR/Dockerfile.pvcfc"
grep -q 'npm run build' "$RUNBOOK"
grep -q 'dist/client/index.html' "$RUNBOOK"
grep -q 'Dockerfile.pvcfc' "$RUNBOOK"
grep -q 'PVCFC_ASTRAFLOW_API_KEY' "$RUNBOOK"
grep -q '^MESSENGER_BUSINESS_ID=pvcfc$' "$RUNBOOK"
grep -q '^ZALO_BUSINESS_ID=pvcfc$' "$RUNBOOK"
! grep -q 'dist/scripts/serve-demo-agent-server.js' "$RUNBOOK"

echo "PVCFC packaged release contract passed."
