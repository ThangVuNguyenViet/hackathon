#!/usr/bin/env bash
set -euo pipefail

: "${QUALIFIED_BUNDLE_ROOT:?required}"
: "${QUALIFIED_BUNDLE_DIGEST:?required}"
: "${TRUSTED_CATALOG_FILE:?required}"
: "${TRUSTED_CATALOG_DIGEST:?required}"
: "${MAIN_IMAGE_TAG:?required}"
: "${SCORER_IMAGE_TAG:?required}"

catalog_context="$(mktemp -d)"
trap 'rm -rf "$catalog_context"' EXIT
cp "$TRUSTED_CATALOG_FILE" "$catalog_context/catalog.json"
echo "$TRUSTED_CATALOG_DIGEST  $catalog_context/catalog.json" | sha256sum -c -

docker buildx build --load \
  --build-context "qualified_bundle=$QUALIFIED_BUNDLE_ROOT" \
  --build-context "trusted_catalog=$catalog_context" \
  --build-arg "QUALIFIED_BUNDLE_DIGEST=$QUALIFIED_BUNDLE_DIGEST" \
  --build-arg "TRUSTED_CATALOG_DIGEST=$TRUSTED_CATALOG_DIGEST" \
  --tag "$MAIN_IMAGE_TAG" services/kfc-agent-backend

docker buildx build --load \
  --build-context "qualified_bundle=$QUALIFIED_BUNDLE_ROOT" \
  --build-arg "QUALIFIED_BUNDLE_DIGEST=$QUALIFIED_BUNDLE_DIGEST" \
  --tag "$SCORER_IMAGE_TAG" services/kfc-recommendation-scorer
