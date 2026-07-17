import { describe, expect, it } from 'vitest';
import {
  arenaCandidate,
  arenaCandidates,
  missingArenaCredentials,
  requestCostUsd,
} from '../../src/evaluation/modelArena.js';

describe('model arena registry', () => {
  it('contains the six fixed candidates and fails preflight by variable name only', () => {
    expect(arenaCandidates.map(({ id }) => id)).toEqual([
      'openai-gpt-4.1',
      'openai-gpt-4.1-mini',
      'gemini-2.5-flash-lite',
      'qwen3.5-flash',
      'deepseek-v4-flash',
      'glm-4.7-flashx',
    ]);
    expect(missingArenaCredentials(arenaCandidates, { OPENAI_API_KEY: 'configured' })).toEqual([
      'DASHSCOPE_API_KEY',
      'DEEPSEEK_API_KEY',
      'GEMINI_API_KEY',
      'ZAI_API_KEY',
    ]);
  });

  it('prices cached, uncached, cache-write, and output tokens independently', () => {
    const price = arenaCandidate('openai-gpt-4.1').price;
    expect(requestCostUsd({
      provider: 'openai', model: 'gpt-4.1', component: 'tool planning', apiStyle: 'responses',
      attempts: 1, latencyMs: 10, outcome: 'success', rawJsonValid: true, rawSchemaValid: true,
      normalizedSchemaValid: true, uncachedInputTokens: 1_000_000, cachedInputTokens: 1_000_000,
      cacheWriteInputTokens: 1_000_000, outputTokens: 1_000_000,
    }, price)).toBe(12.5);
  });
});
