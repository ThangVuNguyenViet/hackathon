FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY packages/openai-agents-runtime ./packages/openai-agents-runtime
RUN npm ci

COPY tsconfig.json ./
COPY tsconfig.runtime.json ./
COPY src ./src
COPY fixtures ./fixtures
COPY knowledge ./knowledge

# Release builds must provide immutable local build contexts. There is no
# fallback QMB or catalog in the production image.
COPY --from=qualified_bundle / /opt/kfc/bundle/
COPY --from=trusted_catalog /catalog.json /opt/kfc/catalog/catalog.json
ARG QUALIFIED_BUNDLE_DIGEST
ARG TRUSTED_CATALOG_DIGEST
RUN test -n "$QUALIFIED_BUNDLE_DIGEST" \
    && test -n "$TRUSTED_CATALOG_DIGEST" \
    && test -s /opt/kfc/bundle/bundle-manifest.json \
    && test -s /opt/kfc/catalog/catalog.json \
    && echo "$TRUSTED_CATALOG_DIGEST  /opt/kfc/catalog/catalog.json" | sha256sum -c -

RUN NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.runtime.json
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
ENV QUALIFIED_BUNDLE_PATH=/opt/kfc/bundle \
    TRUSTED_CATALOG_PATH=/opt/kfc/catalog/catalog.json
EXPOSE 8080

CMD ["node", "dist/src/recommendations/serving/aws-main.js"]
