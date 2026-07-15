const workerName = process.env.OPENAI_GEO_CANARY_WORKER_NAME ?? 'kfc-agent-backend-demo';
const workerUrl = (process.env.OPENAI_GEO_CANARY_WORKER_URL?.trim() ||
  'https://kfc-agent-backend-demo.thangvnv0806.workers.dev').replace(/\/$/, '');
const versionId = process.env.OPENAI_GEO_CANARY_VERSION_ID?.trim();
const endAt = process.env.OPENAI_GEO_CANARY_END_AT?.trim();
const useVersionOverride = process.env.OPENAI_GEO_CANARY_USE_VERSION_OVERRIDE !== 'false';
const canaryToken = process.env.OPENAI_GEO_CANARY_TOKEN?.trim();

if (!versionId) throw new Error('OPENAI_GEO_CANARY_VERSION_ID is required');
if (!canaryToken) throw new Error('OPENAI_GEO_CANARY_TOKEN is required');
if (!endAt || !Number.isFinite(Date.parse(endAt))) {
  throw new Error('OPENAI_GEO_CANARY_END_AT must be an ISO timestamp');
}

if (Date.now() >= Date.parse(endAt)) {
  console.info(JSON.stringify({ event: 'openai_geo_canary_skipped', reason: 'window_complete', endAt }));
  process.exit(0);
}

const override = `${workerName}="${versionId}"`;
const headers: Record<string, string> = useVersionOverride
  ? { 'Cloudflare-Workers-Version-Overrides': override }
  : {};
const healthResponse = await fetch(`${workerUrl}/health`, { headers });
const health = await healthResponse.json().catch(() => ({})) as {
  workerVersionId?: string;
  executionColo?: string;
  placement?: string;
};

if (!healthResponse.ok || health.workerVersionId !== versionId) {
  console.info(JSON.stringify({
    event: 'openai_geo_canary_failure',
    reason: 'version_override_not_applied',
    timestamp: new Date().toISOString(),
    expectedVersionId: versionId,
    observedVersionId: health.workerVersionId,
    httpStatus: healthResponse.status,
  }));
  process.exit(1);
}

const startedAt = performance.now();
const response = await fetch(`${workerUrl}/diagnostics/openai-geo-canary`, {
  method: 'POST',
  headers: { ...headers, authorization: `Bearer ${canaryToken}` },
});
const body = await response.json().catch(() => ({})) as { ok?: unknown };
const openAiSucceeded = response.ok && body.ok === true;
console.info(JSON.stringify({
  event: openAiSucceeded ? 'openai_geo_canary_success' : 'openai_geo_canary_failure',
  timestamp: new Date().toISOString(),
  workerVersionId: versionId,
  executionColo: health.executionColo,
  placement: health.placement ?? healthResponse.headers.get('cf-placement') ?? undefined,
  httpStatus: response.status,
  durationMs: Math.round(performance.now() - startedAt),
  cfRay: response.headers.get('cf-ray') ?? undefined,
}));

if (!openAiSucceeded) process.exit(1);
