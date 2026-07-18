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
} from '../llm/vertexPlannerTransport.js';

export type ArenaCandidateId =
  | 'openai-gpt-4.1-mini'
  | 'gemini-3.1-flash-lite'
  | 'qwen3.7-plus'
  | 'deepseek-v4-flash'
  | 'glm-5.1';

export interface PlannerRequestEvent {
  provider: string;
  model: string;
  component: string;
  apiStyle: 'responses' | 'chat_completions' | 'messages';
  attempt: number;
  latencyMs: number;
  httpStatus?: number;
  outcome: 'success' | 'http_error' | 'network_error' | 'invalid_json' | 'invalid_schema';
  networkErrorType?: 'aborted' | 'vertex_token_refresh' | 'network';
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

function usage(body: any, style: ArenaCandidate['apiStyle']) {
  const source = body?.usage ?? {};
  const inputTokens = count(style === 'chat_completions' ? source.prompt_tokens : source.input_tokens);
  const cachedInputTokens = count(style === 'chat_completions'
    ? source.prompt_cache_hit_tokens ?? source.prompt_tokens_details?.cached_tokens
    : source.cache_read_input_tokens ?? source.input_tokens_details?.cached_tokens);
  const explicitMiss = count(source.prompt_cache_miss_tokens);
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens: count(source.cache_creation_input_tokens ?? source.input_tokens_details?.cache_write_tokens ?? source.prompt_tokens_details?.cache_write_tokens),
    uncachedInputTokens: style === 'messages'
      ? inputTokens
      : explicitMiss ?? (inputTokens === undefined ? undefined : Math.max(0, inputTokens - (cachedInputTokens ?? 0))),
    outputTokens: count(style === 'chat_completions' ? source.completion_tokens : source.output_tokens),
    reasoningTokens: count(source.output_tokens_details?.reasoning_tokens ?? source.completion_tokens_details?.reasoning_tokens),
    totalTokens: count(source.total_tokens),
  };
}

function responseText(body: any, style: ArenaCandidate['apiStyle']): string | undefined {
  if (style === 'chat_completions') {
    const content = body?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : undefined;
  }
  if (style === 'messages') {
    const content = body?.content?.find((entry: any) => entry?.type === 'text')?.text;
    return typeof content === 'string' ? content : undefined;
  }
  if (typeof body?.output_text === 'string') return body.output_text;
  for (const output of body?.output ?? []) {
    for (const content of output?.content ?? []) if (typeof content?.text === 'string') return content.text;
  }
  return undefined;
}

function requestComponent(request: any, cacheKey: string): string {
  if (cacheKey.includes('pending-decision')) return 'planner pending-decision classification';
  if (cacheKey.includes('saved-address')) return 'planner saved-address classification';
  const name = request?.text?.format?.name;
  if (typeof name === 'string') return `planner ${name.replaceAll('_', '-')} classification`;
  return Number(request?.max_output_tokens) <= 64 ? 'planner auxiliary classification' : 'tool planning';
}

function networkErrorType(error: unknown): NonNullable<PlannerRequestEvent['networkErrorType']> {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  if (error instanceof Error && error.message.startsWith('Vertex access-token refresh failed')) {
    return 'vertex_token_refresh';
  }
  return 'network';
}

function contract(text: string | undefined, request: any, cacheKey: string) {
  if (!text) return { rawJsonValid: false, rawSchemaValid: false, normalizedSchemaValid: false };
  try {
    const raw = JSON.parse(text) as unknown;
    const schema = cacheKey.includes('pending-decision')
      ? pendingDecisionSchema
      : cacheKey.includes('saved-address') ||
          (Number(request?.max_output_tokens) <= 64 && String(request?.input).includes('"savedAddresses"'))
        ? savedAddressReferenceSchema
        : requestComponent(request, cacheKey) === 'tool planning'
          ? plannerOutputSchema
          : undefined;
    if (!schema) {
      const objectValid = typeof raw === 'object' && raw !== null && !Array.isArray(raw);
      return { rawJsonValid: true, rawSchemaValid: objectValid, normalizedSchemaValid: objectValid };
    }
    const normalize = schema === plannerOutputSchema ? normalizePlannerOutputEnvelope : (value: unknown) => value;
    return {
      rawJsonValid: true,
      rawSchemaValid: schema.safeParse(raw).success,
      normalizedSchemaValid: schema.safeParse(normalize(raw)).success,
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
    const responsesRequest = JSON.parse(String(init?.body ?? '{}')) as any;
    const cacheKey = String(responsesRequest.prompt_cache_key ?? 'tool-planning');
    const requestKey = new Headers(init?.headers).get('x-client-request-id') ?? cacheKey;
    const attempt = (attempts.get(requestKey) ?? 0) + 1;
    attempts.set(requestKey, attempt);
    const component = requestComponent(responsesRequest, cacheKey);
    const startedAt = Date.now();
    try {
      const url = candidate.apiStyle === 'responses'
        ? input
        : `${candidate.baseUrl}/${candidate.apiStyle === 'messages' ? 'messages' : 'chat/completions'}`;
      const body = candidate.apiStyle === 'responses'
        ? responsesRequest
        : candidate.apiStyle === 'messages'
          ? {
              model: candidate.model,
              temperature: responsesRequest.temperature,
              max_tokens: responsesRequest.max_output_tokens,
              system: responsesRequest.instructions,
              messages: [{ role: 'user', content: responsesRequest.input }],
            }
          : {
              ...mapResponsesRequestToChatCompletions(responsesRequest, candidate.model, true),
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
      const providerBody = await response.clone().json().catch(() => ({})) as any;
      const text = responseText(providerBody, candidate.apiStyle);
      const shape = contract(text, responsesRequest, cacheKey);
      const normalizedUsage = usage(providerBody, candidate.apiStyle);
      onRequestEvent?.({
        provider: candidate.provider, model: candidate.model, component, apiStyle: candidate.apiStyle,
        attempt, latencyMs: Date.now() - startedAt, httpStatus: response.status,
        outcome: !response.ok ? 'http_error' : !shape.rawJsonValid ? 'invalid_json' : !shape.normalizedSchemaValid ? 'invalid_schema' : 'success',
        ...normalizedUsage, ...shape,
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
        provider: candidate.provider, model: candidate.model, component, apiStyle: candidate.apiStyle,
        attempt, latencyMs: Date.now() - startedAt, outcome: 'network_error',
        networkErrorType: networkErrorType(error),
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
    const request = JSON.parse(String(init?.body ?? '{}')) as any;
    const cacheKey = String(request.prompt_cache_key ?? 'tool-planning');
    const requestKey = new Headers(init?.headers).get('x-client-request-id') ?? cacheKey;
    const attempt = (attempts.get(requestKey) ?? 0) + 1;
    attempts.set(requestKey, attempt);
    const component = requestComponent(request, cacheKey);
    const startedAt = Date.now();
    try {
      const response = await transport(input, init);
      const body = await response.clone().json().catch(() => ({})) as any;
      const shape = contract(responseText(body, 'responses'), request, cacheKey);
      const normalizedUsage = usage(body, 'responses');
      onRequestEvent?.({
        provider: candidate.provider, model: candidate.model, component, apiStyle: candidate.apiStyle,
        attempt, latencyMs: Date.now() - startedAt, httpStatus: response.status,
        outcome: !response.ok ? 'http_error' : !shape.rawJsonValid ? 'invalid_json' : !shape.normalizedSchemaValid ? 'invalid_schema' : 'success',
        ...normalizedUsage, ...shape,
      });
      attempts.delete(requestKey);
      return response;
    } catch (error) {
      onRequestEvent?.({
        provider: candidate.provider, model: candidate.model, component, apiStyle: candidate.apiStyle,
        attempt, latencyMs: Date.now() - startedAt, outcome: 'network_error',
        networkErrorType: networkErrorType(error),
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
