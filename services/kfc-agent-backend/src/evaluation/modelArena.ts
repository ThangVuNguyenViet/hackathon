import { z } from 'zod';
import { OpenAIToolPlanner } from '../llm/toolPlanner.js';
import {
  normalizePlannerOutputEnvelope,
  pendingDecisionSchema,
  plannerOutputSchema,
  savedAddressReferenceSchema,
} from '../llm/toolPlannerNormalization.js';
import {
  createVertexPlannerFetch,
  mapResponsesRequestToChatCompletions,
  type ResponsesRequest,
} from '../llm/vertexPlannerTransport.js';
import {
  plannerSemanticViolationCodes,
  type PlannerSemanticViolationCode,
} from '../llm/toolPlannerSemanticContract.js';

export type ArenaCandidateId =
  | 'openai-gpt-4.1-mini'
  | 'gemini-3.1-flash-lite'
  | 'qwen3.7-plus'
  | 'deepseek-v4-flash'
  | 'glm-5.1';

export interface PlannerRequestEvent {
  requestId?: string;
  provider: string;
  model: string;
  component: string;
  apiStyle: 'responses' | 'chat_completions' | 'messages';
  attempt: number;
  latencyMs: number;
  httpStatus?: number;
  outcome: 'success' | 'http_error' | 'network_error' | 'invalid_json' | 'invalid_schema';
  networkErrorType?: 'aborted' | 'superseded' | 'vertex_token_refresh' | 'network';
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  uncachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  rawJsonValid: boolean;
  rawSchemaValid: boolean;
  normalizedSchemaValid: boolean;
  normalizedValidationIssues?: Array<{
    path: string;
    code: string;
  }>;
  activeCartModifierDecision?: {
    operation: 'apply_change' | 'information' | 'other';
    subjectMatch: 'active_item' | 'other' | 'unknown';
    optionMatch: 'supplied_option' | 'none' | 'unknown';
    additionalRequest: 'none' | 'membership' | 'other' | 'unclear';
  };
  semanticReviewViolations?: PlannerSemanticViolationCode[];
}

export interface ArenaPriceCard {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  outputUsdPerMillion: number;
  sourceUrl: string;
  retrievedAt: '2026-07-16' | '2026-07-18';
}

export interface ArenaCandidate {
  id: ArenaCandidateId;
  provider: 'openai' | 'google' | 'alibaba' | 'opencode' | 'zai';
  model: string;
  apiStyle: 'responses' | 'chat_completions' | 'messages';
  baseUrl: string;
  credentialEnv: 'OPENAI_API_KEY' | 'VERTEX_SERVICE_ACCOUNT_JSON' | 'DASHSCOPE_API_KEY' | 'OPENCODE_API_KEY' | 'ZAI_API_KEY';
  productionEligible: boolean;
  governanceNote: string;
  price: ArenaPriceCard;
}

const retrievedAt = '2026-07-16' as const;
export const arenaCandidates: readonly ArenaCandidate[] = [
  { id: 'openai-gpt-4.1-mini', provider: 'openai', model: 'gpt-4.1-mini', apiStyle: 'responses', baseUrl: 'https://api.openai.com/v1', credentialEnv: 'OPENAI_API_KEY', productionEligible: true, governanceNote: 'Current OpenAI production control and fallback.', price: { inputUsdPerMillion: 0.4, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 1.6, retrievedAt, sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini' } },
  { id: 'gemini-3.1-flash-lite', provider: 'google', model: 'google/gemini-3.1-flash-lite', apiStyle: 'chat_completions', baseUrl: 'https://vertex-planner.invalid/v1', credentialEnv: 'VERTEX_SERVICE_ACCOUNT_JSON', productionEligible: true, governanceNote: 'Production Vertex global route; requires approved project data-processing terms.', price: { inputUsdPerMillion: 0.25, cachedInputUsdPerMillion: 0.025, outputUsdPerMillion: 1.5, retrievedAt: '2026-07-18', sourceUrl: 'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing' } },
  { id: 'qwen3.7-plus', provider: 'opencode', model: 'qwen3.7-plus', apiStyle: 'messages', baseUrl: 'https://opencode.ai/zen/go/v1', credentialEnv: 'OPENCODE_API_KEY', productionEligible: true, governanceNote: 'OpenCode Go international route; record workspace terms before canary.', price: { inputUsdPerMillion: 0.4, cachedInputUsdPerMillion: 0.04, cacheWriteUsdPerMillion: 0.5, outputUsdPerMillion: 1.6, retrievedAt, sourceUrl: 'https://opencode.ai/docs/go/' } },
  { id: 'deepseek-v4-flash', provider: 'opencode', model: 'deepseek-v4-flash', apiStyle: 'chat_completions', baseUrl: 'https://opencode.ai/zen/go/v1', credentialEnv: 'OPENCODE_API_KEY', productionEligible: true, governanceNote: 'OpenCode Go international route; record workspace terms before canary.', price: { inputUsdPerMillion: 0.14, cachedInputUsdPerMillion: 0.0028, outputUsdPerMillion: 0.28, retrievedAt, sourceUrl: 'https://opencode.ai/docs/go/' } },
  { id: 'glm-5.1', provider: 'opencode', model: 'glm-5.1', apiStyle: 'chat_completions', baseUrl: 'https://opencode.ai/zen/go/v1', credentialEnv: 'OPENCODE_API_KEY', productionEligible: true, governanceNote: 'OpenCode Go international route; record workspace terms before canary.', price: { inputUsdPerMillion: 1.4, cachedInputUsdPerMillion: 0.26, outputUsdPerMillion: 4.4, retrievedAt, sourceUrl: 'https://opencode.ai/docs/go/' } },
] as const;

export function arenaCandidate(id: string): ArenaCandidate {
  const candidate = arenaCandidates.find((entry) => entry.id === id);
  if (!candidate) throw new Error(`Unknown arena candidate: ${id}`);
  return candidate;
}

export function missingArenaCredentials(candidates: readonly ArenaCandidate[], env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set(candidates.map(({ credentialEnv }) => credentialEnv).filter((key) => !env[key]?.trim()))].sort();
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueAt(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function responsesRequest(value: Record<string, unknown>): ResponsesRequest {
  const format = valueAt(value, 'text', 'format');
  return {
    temperature: typeof value.temperature === 'number' ? value.temperature : undefined,
    max_output_tokens: typeof value.max_output_tokens === 'number' ? value.max_output_tokens : undefined,
    instructions: typeof value.instructions === 'string' ? value.instructions : undefined,
    input: typeof value.input === 'string' ? value.input : undefined,
    text: isRecord(format) ? {
      format: {
        type: typeof format.type === 'string' ? format.type : undefined,
        name: typeof format.name === 'string' ? format.name : undefined,
        strict: typeof format.strict === 'boolean' ? format.strict : undefined,
        schema: format.schema,
      },
    } : undefined,
  };
}

function usage(body: unknown, style: ArenaCandidate['apiStyle']) {
  const inputTokens = count(style === 'chat_completions'
    ? valueAt(body, 'usage', 'prompt_tokens')
    : valueAt(body, 'usage', 'input_tokens'));
  const cachedInputTokens = count(style === 'chat_completions'
    ? valueAt(body, 'usage', 'prompt_cache_hit_tokens') ?? valueAt(body, 'usage', 'prompt_tokens_details', 'cached_tokens')
    : valueAt(body, 'usage', 'cache_read_input_tokens') ?? valueAt(body, 'usage', 'input_tokens_details', 'cached_tokens'));
  const explicitMiss = count(valueAt(body, 'usage', 'prompt_cache_miss_tokens'));
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens: count(
      valueAt(body, 'usage', 'cache_creation_input_tokens')
      ?? valueAt(body, 'usage', 'input_tokens_details', 'cache_write_tokens')
      ?? valueAt(body, 'usage', 'prompt_tokens_details', 'cache_write_tokens'),
    ),
    uncachedInputTokens: style === 'messages'
      ? inputTokens
      : explicitMiss ?? (inputTokens === undefined ? undefined : Math.max(0, inputTokens - (cachedInputTokens ?? 0))),
    outputTokens: count(style === 'chat_completions'
      ? valueAt(body, 'usage', 'completion_tokens')
      : valueAt(body, 'usage', 'output_tokens')),
    reasoningTokens: count(
      valueAt(body, 'usage', 'output_tokens_details', 'reasoning_tokens')
      ?? valueAt(body, 'usage', 'completion_tokens_details', 'reasoning_tokens'),
    ),
    totalTokens: count(valueAt(body, 'usage', 'total_tokens')),
  };
}

function responseText(body: unknown, style: ArenaCandidate['apiStyle']): string | undefined {
  if (style === 'chat_completions') {
    const choices = valueAt(body, 'choices');
    const content = Array.isArray(choices) ? valueAt(choices[0], 'message', 'content') : undefined;
    return typeof content === 'string' ? content : undefined;
  }
  if (style === 'messages') {
    const entries = valueAt(body, 'content');
    const textEntry = Array.isArray(entries)
      ? entries.find((entry) => valueAt(entry, 'type') === 'text')
      : undefined;
    const content = valueAt(textEntry, 'text');
    return typeof content === 'string' ? content : undefined;
  }
  const outputText = valueAt(body, 'output_text');
  if (typeof outputText === 'string') return outputText;
  const outputs = valueAt(body, 'output');
  for (const output of Array.isArray(outputs) ? outputs : []) {
    const contents = valueAt(output, 'content');
    for (const content of Array.isArray(contents) ? contents : []) {
      const text = valueAt(content, 'text');
      if (typeof text === 'string') return text;
    }
  }
  return undefined;
}

function requestComponent(request: unknown, cacheKey: string): string {
  if (cacheKey.includes('pending-decision')) return 'planner pending-decision classification';
  if (cacheKey.includes('saved-address')) return 'planner saved-address classification';
  const name = valueAt(request, 'text', 'format', 'name');
  if (typeof name === 'string') return `planner ${name.replaceAll('_', '-')} classification`;
  return Number(valueAt(request, 'max_output_tokens')) <= 64 ? 'planner auxiliary classification' : 'tool planning';
}

function networkErrorType(error: unknown, signal?: AbortSignal | null): NonNullable<PlannerRequestEvent['networkErrorType']> {
  if (signal?.aborted && signal.reason === 'superseded') return 'superseded';
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  if (error instanceof Error && error.message.startsWith('Vertex access-token refresh failed')) {
    return 'vertex_token_refresh';
  }
  return 'network';
}

const compactPlannerOutputSchema = z.object({
  i: z.enum(['ordering', 'cart_edit', 'voucher', 'payment', 'order_status', 'complaint', 'feedback', 'handoff', 'safety', 'unclear']),
  e: z.record(z.unknown()),
  t: z.array(z.object({
    n: z.string(),
    a: z.record(z.unknown()),
  })),
  r: z.array(z.enum(['promotion', 'payment_success', 'allergen_certainty'])).optional(),
});

const activeCartModifierDecisionSchema = z.object({
  operation: z.enum(['apply_change', 'information', 'other']),
  subjectMatch: z.enum(['active_item', 'other', 'unknown']),
  optionMatch: z.enum(['supplied_option', 'none', 'unknown']),
  additionalRequest: z.enum(['none', 'membership', 'other', 'unclear']),
});

function requestsCompactPlannerOutput(request: unknown): boolean {
  try {
    const input = JSON.parse(String(valueAt(request, 'input') ?? '')) as { outputSchema?: Record<string, unknown> };
    return input.outputSchema?.i !== undefined && input.outputSchema.intent === undefined;
  } catch {
    return false;
  }
}

function activeCartModifierDecision(raw: unknown): PlannerRequestEvent['activeCartModifierDecision'] {
  const decision = activeCartModifierDecisionSchema.safeParse(raw);
  return decision.success ? decision.data : undefined;
}

function semanticReviewViolations(request: unknown): PlannerSemanticViolationCode[] | undefined {
  try {
    const input = JSON.parse(String(valueAt(request, 'input') ?? '')) as { semanticViolations?: unknown };
    if (!Array.isArray(input.semanticViolations)) return undefined;
    const allowed = new Set<string>(plannerSemanticViolationCodes);
    const violations = input.semanticViolations.filter(
      (value): value is PlannerSemanticViolationCode => typeof value === 'string' && allowed.has(value),
    );
    return violations.length > 0 ? violations : undefined;
  } catch {
    return undefined;
  }
}

function contract(text: string | undefined, request: unknown, cacheKey: string) {
  if (!text) return { rawJsonValid: false, rawSchemaValid: false, normalizedSchemaValid: false };
  try {
    const raw = JSON.parse(text) as unknown;
    const schemaName = valueAt(request, 'text', 'format', 'name');
    const schema = schemaName === 'active_cart_modifier_change'
      ? activeCartModifierDecisionSchema
      : cacheKey.includes('pending-decision')
        ? pendingDecisionSchema
        : cacheKey.includes('saved-address') ||
          (Number(valueAt(request, 'max_output_tokens')) <= 64 && String(valueAt(request, 'input')).includes('"savedAddresses"'))
          ? savedAddressReferenceSchema
          : requestComponent(request, cacheKey) === 'tool planning'
            ? plannerOutputSchema
            : undefined;
    if (!schema) {
      const objectValid = typeof raw === 'object' && raw !== null && !Array.isArray(raw);
      return { rawJsonValid: true, rawSchemaValid: objectValid, normalizedSchemaValid: objectValid };
    }
    const compactPlannerContract = schema === plannerOutputSchema && requestsCompactPlannerOutput(request);
    const normalize = schema === plannerOutputSchema ? normalizePlannerOutputEnvelope : (value: unknown) => value;
    const normalized = schema.safeParse(normalize(raw));
    return {
      rawJsonValid: true,
      rawSchemaValid: compactPlannerContract
        ? compactPlannerOutputSchema.safeParse(raw).success
        : schema.safeParse(raw).success,
      normalizedSchemaValid: normalized.success,
      normalizedValidationIssues: normalized.success
        ? undefined
        : normalized.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path.map(String).join('.'),
            code: issue.code,
          })),
      activeCartModifierDecision:
        schemaName === 'active_cart_modifier_change'
          ? activeCartModifierDecision(raw)
          : undefined,
    };
  } catch {
    return { rawJsonValid: false, rawSchemaValid: false, normalizedSchemaValid: false };
  }
}

function compatibleFetch(
  candidate: ArenaCandidate,
  apiKey: string,
  onRequestEvent?: (event: PlannerRequestEvent) => void,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const attempts = new Map<string, number>();
  return async (input, init) => {
    const parsedRequest: unknown = JSON.parse(String(init?.body ?? '{}'));
    const rawRequest = isRecord(parsedRequest) ? parsedRequest : {};
    const cacheKey = String(rawRequest.prompt_cache_key ?? 'tool-planning');
    const requestKey = new Headers(init?.headers).get('x-client-request-id') ?? cacheKey;
    const attempt = (attempts.get(requestKey) ?? 0) + 1;
    attempts.set(requestKey, attempt);
    const component = requestComponent(rawRequest, cacheKey);
    const startedAt = Date.now();
    try {
      const url = candidate.apiStyle === 'responses'
        ? input
        : `${candidate.baseUrl}/${candidate.apiStyle === 'messages' ? 'messages' : 'chat/completions'}`;
      const body = candidate.apiStyle === 'responses'
        ? rawRequest
        : candidate.apiStyle === 'messages'
          ? {
              model: candidate.model,
              temperature: rawRequest.temperature,
              max_tokens: rawRequest.max_output_tokens,
              system: rawRequest.instructions,
              messages: [{ role: 'user', content: rawRequest.input }],
            }
          : {
              ...mapResponsesRequestToChatCompletions(responsesRequest(rawRequest), candidate.model, true),
            };
      const headers = new Headers(init?.headers);
      headers.set('content-type', 'application/json');
      if (candidate.apiStyle === 'messages') {
        headers.delete('authorization');
        headers.set('x-api-key', apiKey);
        headers.set('anthropic-version', '2023-06-01');
      } else {
        headers.set('authorization', `Bearer ${apiKey}`);
      }
      const response = await fetchImpl(url, {
        ...init,
        headers,
        body: JSON.stringify(body),
      });
      const providerBody: unknown = await response.clone().json().catch(() => ({}));
      const text = responseText(providerBody, candidate.apiStyle);
      const shape = contract(text, rawRequest, cacheKey);
      const normalizedUsage = usage(providerBody, candidate.apiStyle);
      onRequestEvent?.({
        requestId: requestKey,
        provider: candidate.provider, model: candidate.model, component, apiStyle: candidate.apiStyle,
        attempt, latencyMs: Date.now() - startedAt, httpStatus: response.status,
        outcome: !response.ok ? 'http_error' : !shape.rawJsonValid ? 'invalid_json' : !shape.normalizedSchemaValid ? 'invalid_schema' : 'success',
        ...normalizedUsage, ...shape,
        semanticReviewViolations: semanticReviewViolations(rawRequest),
      });
      attempts.delete(requestKey);
      if (candidate.apiStyle === 'responses') return response;
      const syntheticBody = response.ok ? {
        output_text: text,
        usage: {
          input_tokens: normalizedUsage.inputTokens,
          input_tokens_details: {
            cached_tokens: normalizedUsage.cachedInputTokens,
            cache_write_tokens: normalizedUsage.cacheWriteInputTokens,
          },
          output_tokens: normalizedUsage.outputTokens,
          output_tokens_details: { reasoning_tokens: normalizedUsage.reasoningTokens },
          total_tokens: normalizedUsage.totalTokens,
        },
      } : providerBody;
      return new Response(JSON.stringify(syntheticBody), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      onRequestEvent?.({
        requestId: requestKey,
        provider: candidate.provider, model: candidate.model, component, apiStyle: candidate.apiStyle,
        attempt, latencyMs: Date.now() - startedAt, outcome: 'network_error',
        networkErrorType: networkErrorType(error, init?.signal),
        rawJsonValid: false, rawSchemaValid: false, normalizedSchemaValid: false,
      });
      throw error;
    }
  };
}

function vertexCompatibleFetch(
  candidate: ArenaCandidate,
  serviceAccountJson: string,
  env: NodeJS.ProcessEnv,
  onRequestEvent?: (event: PlannerRequestEvent) => void,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const transport = createVertexPlannerFetch({
    serviceAccountJson,
    model: candidate.model,
    location: env.VERTEX_LOCATION,
    fetchImpl,
  });
  const attempts = new Map<string, number>();
  return async (input, init) => {
    const parsedRequest: unknown = JSON.parse(String(init?.body ?? '{}'));
    const request = isRecord(parsedRequest) ? parsedRequest : {};
    const cacheKey = String(request.prompt_cache_key ?? 'tool-planning');
    const requestKey = new Headers(init?.headers).get('x-client-request-id') ?? cacheKey;
    const attempt = (attempts.get(requestKey) ?? 0) + 1;
    attempts.set(requestKey, attempt);
    const component = requestComponent(request, cacheKey);
    const startedAt = Date.now();
    try {
      const response = await transport(input, init);
      const body: unknown = await response.clone().json().catch(() => ({}));
      const shape = contract(responseText(body, 'responses'), request, cacheKey);
      const normalizedUsage = usage(body, 'responses');
      onRequestEvent?.({
        requestId: requestKey,
        provider: candidate.provider, model: candidate.model, component, apiStyle: candidate.apiStyle,
        attempt, latencyMs: Date.now() - startedAt, httpStatus: response.status,
        outcome: !response.ok ? 'http_error' : !shape.rawJsonValid ? 'invalid_json' : !shape.normalizedSchemaValid ? 'invalid_schema' : 'success',
        ...normalizedUsage, ...shape,
        semanticReviewViolations: semanticReviewViolations(request),
      });
      attempts.delete(requestKey);
      return response;
    } catch (error) {
      onRequestEvent?.({
        requestId: requestKey,
        provider: candidate.provider, model: candidate.model, component, apiStyle: candidate.apiStyle,
        attempt, latencyMs: Date.now() - startedAt, outcome: 'network_error',
        networkErrorType: networkErrorType(error, init?.signal),
        rawJsonValid: false, rawSchemaValid: false, normalizedSchemaValid: false,
      });
      throw error;
    }
  };
}

export function createArenaPlanner(candidate: ArenaCandidate, options: {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onRequestEvent?: (event: PlannerRequestEvent) => void;
  fetchImpl?: typeof fetch;
} = {}): OpenAIToolPlanner {
  const env = options.env ?? process.env;
  const apiKey = env[candidate.credentialEnv]?.trim();
  if (!apiKey) throw new Error(`Missing arena credential: ${candidate.credentialEnv}`);
  const vertex = candidate.id === 'gemini-3.1-flash-lite';
  return new OpenAIToolPlanner({
    apiKey: vertex ? '' : apiKey,
    model: candidate.model,
    fastModel: vertex ? candidate.model : undefined,
    statusModel: vertex ? candidate.model : undefined,
    baseUrl: vertex || candidate.apiStyle === 'responses' ? candidate.baseUrl : 'https://arena-adapter.invalid/v1',
    timeoutMs: options.timeoutMs,
    diagnosticContext: vertex ? { provider: 'vertex' } : undefined,
    fetchImpl: vertex
      ? vertexCompatibleFetch(candidate, apiKey, env, options.onRequestEvent, options.fetchImpl)
      : compatibleFetch(candidate, apiKey, options.onRequestEvent, options.fetchImpl),
  });
}

export function requestCostUsd(event: PlannerRequestEvent, price: ArenaPriceCard): number {
  const uncached = event.uncachedInputTokens ?? Math.max(0, (event.inputTokens ?? 0) - (event.cachedInputTokens ?? 0));
  return (
    uncached * price.inputUsdPerMillion +
    (event.cachedInputTokens ?? 0) * (price.cachedInputUsdPerMillion ?? price.inputUsdPerMillion) +
    (event.cacheWriteInputTokens ?? 0) * (price.cacheWriteUsdPerMillion ?? price.inputUsdPerMillion) +
    (event.outputTokens ?? 0) * price.outputUsdPerMillion
  ) / 1_000_000;
}
