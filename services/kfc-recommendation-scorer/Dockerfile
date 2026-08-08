FROM python:3.11.14-slim-bookworm

RUN addgroup --system scorer && adduser --system --ingroup scorer scorer
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
COPY --from=qualified_bundle / /opt/kfc/bundle/
ARG QUALIFIED_BUNDLE_DIGEST
RUN test -n "$QUALIFIED_BUNDLE_DIGEST" && test -s /opt/kfc/bundle/bundle-manifest.json
RUN pip install --no-cache-dir .

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SCORER_PORT=8081 \
    QUALIFIED_BUNDLE_PATH=/opt/kfc/bundle
USER scorer
EXPOSE 8081
CMD ["python", "-m", "kfc_recommendation_scorer"]
