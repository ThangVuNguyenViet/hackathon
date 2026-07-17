import { OpenAIToolPlanner, type PlannerRequestEvent } from '../llm/toolPlanner.js';

export type ArenaCandidateId =
  | 'openai-gpt-4.1'
  | 'openai-gpt-4.1-mini'
  | 'gemini-2.5-flash-lite'
  | 'qwen3.5-flash'
  | 'deepseek-v4-flash'
  | 'glm-4.7-flashx';

export interface ArenaPriceCard {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  outputUsdPerMillion: number;
  sourceUrl: string;
  retrievedAt: '2026-07-16';
}

export interface ArenaCandidate {
  id: ArenaCandidateId;
  provider: 'openai' | 'google' | 'alibaba' | 'deepseek' | 'zai';
  model: string;
  apiStyle: 'responses' | 'chat_completions';
  baseUrl: string;
  credentialEnv: 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'DASHSCOPE_API_KEY' | 'DEEPSEEK_API_KEY' | 'ZAI_API_KEY';
  productionEligible: boolean;
  governanceNote: string;
  price: ArenaPriceCard;
}

const retrievedAt = '2026-07-16' as const;

export const arenaCandidates: readonly ArenaCandidate[] = [
  {
    id: 'openai-gpt-4.1', provider: 'openai', model: 'gpt-4.1', apiStyle: 'responses',
    baseUrl: 'https://api.openai.com/v1', credentialEnv: 'OPENAI_API_KEY', productionEligible: true,
    governanceNote: 'Current production control.',
    price: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 8, retrievedAt, sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-4.1' },
  },
  {
    id: 'openai-gpt-4.1-mini', provider: 'openai', model: 'gpt-4.1-mini', apiStyle: 'responses',
    baseUrl: 'https://api.openai.com/v1', credentialEnv: 'OPENAI_API_KEY', productionEligible: true,
    governanceNote: 'Same-provider challenger.',
    price: { inputUsdPerMillion: 0.4, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 1.6, retrievedAt, sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini' },
  },
  {
    id: 'gemini-2.5-flash-lite', provider: 'google', model: 'gemini-2.5-flash-lite', apiStyle: 'chat_completions',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', credentialEnv: 'GEMINI_API_KEY', productionEligible: true,
    governanceNote: 'Production eligibility still requires the project data-processing review.',
    price: { inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.01, outputUsdPerMillion: 0.4, retrievedAt, sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing' },
  },
  {
    id: 'qwen3.5-flash', provider: 'alibaba', model: 'qwen3.5-flash', apiStyle: 'chat_completions',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', credentialEnv: 'DASHSCOPE_API_KEY', productionEligible: true,
    governanceNote: 'International endpoint; contract and selected region must be recorded before canary.',
    price: { inputUsdPerMillion: 0.029, outputUsdPerMillion: 0.287, retrievedAt, sourceUrl: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing' },
  },
  {
    id: 'deepseek-v4-flash', provider: 'deepseek', model: 'deepseek-v4-flash', apiStyle: 'chat_completions',
    baseUrl: 'https://api.deepseek.com', credentialEnv: 'DEEPSEEK_API_KEY', productionEligible: false,
    governanceNote: 'Research only until PRC processing/storage is approved.',
    price: { inputUsdPerMillion: 0.14, cachedInputUsdPerMillion: 0.0028, outputUsdPerMillion: 0.28, retrievedAt, sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/' },
  },
  {
    id: 'glm-4.7-flashx', provider: 'zai', model: 'glm-4.7-flashx', apiStyle: 'chat_completions',
    baseUrl: 'https://api.z.ai/api/paas/v4', credentialEnv: 'ZAI_API_KEY', productionEligible: false,
    governanceNote: 'Research only until residency and API data terms are approved.',
    price: { inputUsdPerMillion: 0.07, cachedInputUsdPerMillion: 0.01, outputUsdPerMillion: 0.4, retrievedAt, sourceUrl: 'https://docs.z.ai/guides/overview/pricing' },
  },
] as const;

export function arenaCandidate(id: string): ArenaCandidate {
  const candidate = arenaCandidates.find((entry) => entry.id === id);
  if (!candidate) throw new Error(`Unknown arena candidate: ${id}`);
  return candidate;
}

export function missingArenaCredentials(
  candidates: readonly ArenaCandidate[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [...new Set(candidates.map(({ credentialEnv }) => credentialEnv).filter((key) => !env[key]?.trim()))].sort();
}

export function createArenaPlanner(
  candidate: ArenaCandidate,
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; onRequestEvent?: (event: PlannerRequestEvent) => void } = {},
): OpenAIToolPlanner {
  const env = options.env ?? process.env;
  const apiKey = env[candidate.credentialEnv]?.trim();
  if (!apiKey) throw new Error(`Missing arena credential: ${candidate.credentialEnv}`);
  return new OpenAIToolPlanner({
    apiKey,
    model: candidate.model,
    provider: candidate.provider,
    apiStyle: candidate.apiStyle,
    baseUrl: candidate.baseUrl,
    timeoutMs: options.timeoutMs,
    onRequestEvent: options.onRequestEvent,
  });
}

export function requestCostUsd(event: PlannerRequestEvent, price: ArenaPriceCard): number {
  const uncached = event.uncachedInputTokens ?? Math.max(0, (event.inputTokens ?? 0) - (event.cachedInputTokens ?? 0));
  const cached = event.cachedInputTokens ?? 0;
  const cacheWrite = event.cacheWriteInputTokens ?? 0;
  const output = event.outputTokens ?? 0;
  return (
    uncached * price.inputUsdPerMillion +
    cached * (price.cachedInputUsdPerMillion ?? price.inputUsdPerMillion) +
    cacheWrite * (price.cacheWriteUsdPerMillion ?? price.inputUsdPerMillion) +
    output * price.outputUsdPerMillion
  ) / 1_000_000;
}
