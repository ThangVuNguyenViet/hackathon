import { KFC_GENUI_WIDGET_KINDS } from '../genui/kfcGenUi.js';
import { TOOL_NAMES } from '../ordering/types.js';
import { boundedCanonicalScenarioTurnIndex } from './canonicalScenarioTrace.js';

export const LANGSMITH_PROVIDER_ATTEMPT_OUTCOMES = [
  'error',
  'invalid_response',
  'success',
] as const;

export const LANGSMITH_SEARCH_MENU_PURPOSES = ['browse', 'recommend'] as const;

export const LANGSMITH_SEARCH_MENU_SCOPES = ['all', 'filtered'] as const;

export const LANGSMITH_MEDIA_DECISION_REASONS = [
  'full_menu_suppressed',
  'broad_browse_suppressed',
  'focused_recommendation',
  'item_detail',
  'modifier_parent',
  'add_on_recommendation',
  'no_verified_media',
  'stale_or_uncited',
] as const;

type ProviderAttemptOutcome =
  (typeof LANGSMITH_PROVIDER_ATTEMPT_OUTCOMES)[number];

export interface LangSmithProviderDiagnosticInput {
  provider?: unknown;
  model?: unknown;
  profile?: unknown;
  attempt?: unknown;
  outcome?: unknown;
  httpStatus?: unknown;
  errorCode?: unknown;
  errorParameter?: unknown;
  retryable?: unknown;
  requestId?: unknown;
}

export interface PrivacySafeLangSmithMetadataInput {
  activeTools?: readonly LangSmithActiveToolInput[];
  currentMetadata?: Readonly<Record<string, unknown>>;
  genUi?: LangSmithGenUiDiagnosticInput;
  mediaDecision?: LangSmithMediaDecisionDiagnosticInput;
  modelPublication?: LangSmithModelPublicationDiagnosticInput;
  provider?: LangSmithProviderDiagnosticInput;
  sdkTokenUsage?: unknown;
  searchMenu?: LangSmithSearchMenuDiagnosticInput;
}

export interface LangSmithActiveToolInput {
  name?: unknown;
  schema?: unknown;
}

export interface LangSmithModelPublicationDiagnosticInput {
  byteSize?: unknown;
}

export interface LangSmithSearchMenuDiagnosticInput {
  scope?: unknown;
  purpose?: unknown;
  totalCount?: unknown;
  returnedCount?: unknown;
}

export interface LangSmithGenUiDiagnosticInput {
  selectedKind?: unknown;
}

export interface LangSmithMediaDecisionDiagnosticInput {
  reason?: unknown;
  count?: unknown;
}

export type PrivacySafeLangSmithMetadata = Record<string, unknown>;

const providers = new Set(['google', 'openai']);
const genUiKinds = new Set<unknown>(KFC_GENUI_WIDGET_KINDS);
const mediaDecisionReasons = new Set<unknown>(LANGSMITH_MEDIA_DECISION_REASONS);
const toolNames = new Set<unknown>(TOOL_NAMES);
const providerAttemptOutcomes = new Set<unknown>(
  LANGSMITH_PROVIDER_ATTEMPT_OUTCOMES,
);
const searchMenuPurposes = new Set<unknown>(LANGSMITH_SEARCH_MENU_PURPOSES);
const searchMenuScopes = new Set<unknown>(LANGSMITH_SEARCH_MENU_SCOPES);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const diagnosticTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/u;
const parameterPathPattern = /^[A-Za-z][A-Za-z0-9_.\[\]-]{0,95}$/u;
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const opaqueCorrelationPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

function boundedString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isProviderAttemptOutcome(
  value: unknown,
): value is ProviderAttemptOutcome {
  return providerAttemptOutcomes.has(value);
}

function providerMetadata(
  input: LangSmithProviderDiagnosticInput | undefined,
): PrivacySafeLangSmithMetadata {
  if (!input) return {};
  const provider =
    typeof input.provider === 'string' && providers.has(input.provider)
      ? input.provider
      : undefined;
  const model = boundedString(input.model, identifierPattern);
  const profile = boundedString(input.profile, identifierPattern);
  const attempt = boundedInteger(input.attempt, 1, 6);
  const outcome = isProviderAttemptOutcome(input.outcome)
    ? input.outcome
    : undefined;
  const httpStatus = boundedInteger(input.httpStatus, 100, 599);
  const errorCode = boundedString(input.errorCode, diagnosticTokenPattern);
  const errorParameter = boundedString(
    input.errorParameter,
    parameterPathPattern,
  );
  const requestId = boundedString(input.requestId, requestIdPattern);
  return {
    ...(provider ? { modelProvider: provider } : {}),
    ...(model ? { model } : {}),
    ...(profile ? { modelProfile: profile } : {}),
    ...(attempt === undefined ? {} : { providerAttempt: attempt }),
    ...(outcome ? { providerAttemptOutcome: outcome } : {}),
    ...(httpStatus === undefined ? {} : { providerHttpStatus: httpStatus }),
    ...(errorCode ? { providerErrorCode: errorCode } : {}),
    ...(errorParameter ? { providerErrorParameter: errorParameter } : {}),
    ...(typeof input.retryable === 'boolean'
      ? { providerRetryable: input.retryable }
      : {}),
    ...(requestId ? { providerRequestId: requestId } : {}),
  };
}

function traceRawEvent(value: unknown): Record<string, unknown> | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const count = boundedInteger(candidate.count, 0, 1_024);
  const digest = boundedString(candidate.digest, sha256Pattern);
  return candidate.type === 'record' && count !== undefined && digest
    ? { type: 'record', count, digest }
    : undefined;
}

function correlationMetadata(
  current: Readonly<Record<string, unknown>> | undefined,
): PrivacySafeLangSmithMetadata {
  if (!current) return {};
  const sessionId = boundedString(current.session_id, opaqueCorrelationPattern);
  const sessionIdDigest = boundedString(
    current.session_id_digest,
    sha256Pattern,
  );
  const scenarioId = boundedString(
    current.scenarioId,
    opaqueCorrelationPattern,
  );
  const probeRunId =
    current.probeRunId === null
      ? null
      : boundedString(current.probeRunId, opaqueCorrelationPattern);
  const canonicalScenarioTurnIndex = boundedCanonicalScenarioTurnIndex(
    current.canonicalScenarioTurnIndex,
  );
  const clientMessageId = boundedString(
    current.clientMessageId,
    opaqueCorrelationPattern,
  );
  const clientMessageIdDigest = boundedString(
    current.clientMessageIdDigest,
    sha256Pattern,
  );
  const rawEvent = traceRawEvent(current.rawEvent);
  return {
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(sessionIdDigest ? { session_id_digest: sessionIdDigest } : {}),
    ...(scenarioId ? { scenarioId } : {}),
    ...(probeRunId === null || probeRunId ? { probeRunId } : {}),
    ...(canonicalScenarioTurnIndex === undefined
      ? {}
      : { canonicalScenarioTurnIndex }),
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(clientMessageIdDigest ? { clientMessageIdDigest } : {}),
    ...(rawEvent ? { rawEvent } : {}),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function fingerprintLangSmithToolSchema(
  schema: unknown,
): Promise<string | undefined> {
  if (!record(schema)) return undefined;
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalJson(schema)),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return undefined;
  }
}

async function activeToolMetadata(
  tools: readonly LangSmithActiveToolInput[] | undefined,
): Promise<PrivacySafeLangSmithMetadata> {
  if (!tools) return {};
  const seen = new Set<unknown>();
  const activeTools = (
    await Promise.all(
      tools.slice(0, TOOL_NAMES.length).map(async ({ name, schema }) => {
        if (!toolNames.has(name) || seen.has(name)) return undefined;
        seen.add(name);
        const schemaFingerprint = await fingerprintLangSmithToolSchema(schema);
        return schemaFingerprint ? { name, schemaFingerprint } : undefined;
      }),
    )
  ).filter((tool) => tool !== undefined);
  return activeTools.length > 0 ? { activeTools } : {};
}

function modelPublicationMetadata(
  input: LangSmithModelPublicationDiagnosticInput | undefined,
): PrivacySafeLangSmithMetadata {
  const byteSize = boundedInteger(input?.byteSize, 0, 16 * 1_024 * 1_024);
  return byteSize === undefined ? {} : { modelPublicationBytes: byteSize };
}

function searchMenuMetadata(
  input: LangSmithSearchMenuDiagnosticInput | undefined,
): PrivacySafeLangSmithMetadata {
  if (!input) return {};
  const totalCount = boundedInteger(input.totalCount, 0, 100_000);
  const returnedCount = boundedInteger(input.returnedCount, 0, 100_000);
  return {
    ...(searchMenuScopes.has(input.scope)
      ? { searchMenuScope: input.scope }
      : {}),
    ...(searchMenuPurposes.has(input.purpose)
      ? { searchMenuPurpose: input.purpose }
      : {}),
    ...(totalCount === undefined ? {} : { searchMenuTotalCount: totalCount }),
    ...(returnedCount === undefined
      ? {}
      : { searchMenuReturnedCount: returnedCount }),
  };
}

function presentationMetadata(input: {
  genUi?: LangSmithGenUiDiagnosticInput;
  mediaDecision?: LangSmithMediaDecisionDiagnosticInput;
}): PrivacySafeLangSmithMetadata {
  const mediaCount = boundedInteger(input.mediaDecision?.count, 0, 64);
  return {
    ...(genUiKinds.has(input.genUi?.selectedKind)
      ? { selectedGenUiKind: input.genUi?.selectedKind }
      : {}),
    ...(mediaDecisionReasons.has(input.mediaDecision?.reason)
      ? { mediaDecisionReason: input.mediaDecision?.reason }
      : {}),
    ...(mediaCount === undefined ? {} : { mediaCount }),
  };
}

function sdkTokenUsageMetadata(value: unknown): PrivacySafeLangSmithMetadata {
  const usage = record(value);
  if (!usage) return {};
  const inputDetails = record(usage.input_token_details);
  const outputDetails = record(usage.output_token_details);
  const inputTokens = boundedInteger(usage.input_tokens, 0, 1_000_000_000);
  const cachedInputTokens = boundedInteger(
    inputDetails?.cache_read,
    0,
    1_000_000_000,
  );
  const outputTokens = boundedInteger(usage.output_tokens, 0, 1_000_000_000);
  const reasoningTokens = boundedInteger(
    outputDetails?.reasoning,
    0,
    1_000_000_000,
  );
  const totalTokens = boundedInteger(usage.total_tokens, 0, 1_000_000_000);
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

/**
 * Builds diagnostic-only LangSmith span metadata from an explicit allowlist.
 * Unknown fields are ignored rather than serialized.
 */
export async function buildPrivacySafeLangSmithMetadata(
  input: PrivacySafeLangSmithMetadataInput,
): Promise<PrivacySafeLangSmithMetadata> {
  return {
    ...correlationMetadata(input.currentMetadata),
    ...providerMetadata(input.provider),
    ...(await activeToolMetadata(input.activeTools)),
    ...modelPublicationMetadata(input.modelPublication),
    ...searchMenuMetadata(input.searchMenu),
    ...presentationMetadata(input),
    ...sdkTokenUsageMetadata(input.sdkTokenUsage),
  };
}
