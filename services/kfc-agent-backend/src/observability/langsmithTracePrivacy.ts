import { createHash } from 'node:crypto';

export const LANGSMITH_TRACE_FAILURE_ERROR = 'agent_trace_failed_closed';
export const TRACE_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SAFE_CATEGORIES = new Set([
  'agent_loop',
  'graph_node',
  'model',
  'tool',
  'approval',
  'retry',
  'verified_state',
  'genui_projection',
]);
const SAFE_BOUNDARIES = new Set([
  'catalog',
  'pos',
  'store_routing',
  'fulfillment',
  'promotion',
  'membership',
  'customer',
  'content',
  'invoice',
  'oms',
  'payment',
  'handoff',
]);

export function isTraceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isTraceRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function evidenceDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex');
}

export function exactTraceEvidenceMatches(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(canonicalValue(actual)) === JSON.stringify(canonicalValue(expected));
}

export function safeBoundedTraceInteger(
  value: unknown,
  maximum: number,
): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
    ? value
    : undefined;
}

function copyOpaque(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (typeof value === 'string' && OPAQUE_ID_PATTERN.test(value)) {
    target[key] = value;
  }
}

export function privacySafeLangSmithMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of [
    'session_id',
    'scenarioId',
    'probeRunId',
    'executionId',
    'gitSha',
    'runtimeId',
    'provider',
    'model',
    'profile',
    'mode',
    'policyId',
    'inventoryName',
    'inventoryVersion',
    'inventoryDigest',
    'remoteDatasetId',
  ]) {
    copyOpaque(safe, metadata, key);
  }
  if (metadata.probeRunId === null) safe.probeRunId = null;
  if (typeof metadata.category === 'string' && SAFE_CATEGORIES.has(metadata.category)) {
    safe.category = metadata.category;
  }
  const repetition = safeBoundedTraceInteger(metadata.repetition, 100);
  if (repetition !== undefined) safe.repetition = repetition;
  return safe;
}

export function privacySafeLangSmithInputs(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {
    evidenceDigest: evidenceDigest(inputs),
  };
  copyOpaque(safe, inputs, 'toolName');
  copyOpaque(safe, inputs, 'capability');
  const boundary = inputs.boundary;
  if (typeof boundary === 'string' && SAFE_BOUNDARIES.has(boundary)) {
    safe.boundary = boundary;
  }
  const attempt = safeBoundedTraceInteger(inputs.attempt, 100);
  if (attempt !== undefined) safe.attempt = attempt;
  return safe;
}

function safeUsage(value: unknown): Record<string, number> | undefined {
  if (!isTraceRecord(value)) return undefined;
  const inputTokens = safeBoundedTraceInteger(value.inputTokens, 10_000_000);
  const outputTokens = safeBoundedTraceInteger(value.outputTokens, 10_000_000);
  const totalTokens = safeBoundedTraceInteger(value.totalTokens, 20_000_000);
  return inputTokens !== undefined &&
    outputTokens !== undefined &&
    totalTokens === inputTokens + outputTokens &&
    totalTokens > 0
    ? { inputTokens, outputTokens, totalTokens }
    : undefined;
}

function safeCost(value: unknown): { currency: 'USD'; amountUsd: number } | undefined {
  if (!isTraceRecord(value) || value.currency !== 'USD') return undefined;
  const amountUsd = value.amountUsd;
  return typeof amountUsd === 'number' &&
    Number.isFinite(amountUsd) &&
    amountUsd >= 0 &&
    amountUsd <= 10_000
    ? { currency: 'USD', amountUsd }
    : undefined;
}

export function privacySafeLangSmithOutputs(
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {
    evidenceDigest: evidenceDigest(outputs),
  };
  const usageMetadata = safeUsage(outputs.usageMetadata);
  if (usageMetadata) safe.usageMetadata = usageMetadata;
  const costMetadata = safeCost(outputs.costMetadata);
  if (costMetadata) safe.costMetadata = costMetadata;
  if (typeof outputs.genUiKind === 'string' || outputs.genUiKind === null) {
    safe.genUiProjected = typeof outputs.genUiKind === 'string';
  }
  for (const key of ['status', 'destination', 'executionOutcome']) {
    copyOpaque(safe, outputs, key);
  }
  return safe;
}

export function privacySafeLangSmithError(_error: unknown): string {
  return LANGSMITH_TRACE_FAILURE_ERROR;
}
