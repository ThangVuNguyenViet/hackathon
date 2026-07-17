import { describe, expect, it } from 'vitest';
import {
  arenaCandidate,
  arenaCandidates,
  createArenaPlanner,
  missingArenaCredentials,
  requestCostUsd,
  type PlannerRequestEvent,
} from '../../src/evaluation/modelArena.js';

describe('model arena', () => {
  it('registers six candidates and reports only missing credential names', () => {
    expect(arenaCandidates).toHaveLength(6);
    expect(missingArenaCredentials(arenaCandidates, { OPENAI_API_KEY: 'configured' })).toEqual([
      'GEMINI_API_KEY', 'OPENCODE_API_KEY',
    ]);
  });

  it('adapts Responses requests to Chat Completions and retains usage evidence', async () => {
    let requestUrl = '';
    let requestBody: any;
    const events: PlannerRequestEvent[] = [];
    const planner = createArenaPlanner(arenaCandidate('deepseek-v4-flash'), {
      env: { OPENCODE_API_KEY: 'test' },
      onRequestEvent: (event) => events.push(event),
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            intent: 'voucher', entities: {},
            toolCalls: [{ toolName: 'searchPromotions', arguments: {} }], responseClaims: [],
          }) } }],
          usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40, completion_tokens: 20, total_tokens: 120 },
        }), { status: 200 });
      },
    });
    const output = await planner.plan({
      state: { sessionId: 's', customerId: 'c', latestUserMessage: 'Có ưu đãi gì?', intent: 'unclear', userConfirmedOrder: false, escalationReasons: [], retrievedEvidence: [] },
      availableTools: ['searchPromotions'], recentTurns: [],
    });

    expect(requestUrl).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(requestBody).toMatchObject({
      model: 'deepseek-v4-flash', max_tokens: 640,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system' }, { role: 'user' }],
    });
    expect(output.toolCalls).toEqual([{ toolName: 'searchPromotions', arguments: { query: '' } }]);
    expect(events).toEqual([expect.objectContaining({
      outcome: 'success', inputTokens: 100, cachedInputTokens: 60, uncachedInputTokens: 40,
      outputTokens: 20, rawJsonValid: true, rawSchemaValid: true, normalizedSchemaValid: true,
    })]);
  });

  it('prices each token class independently', () => {
    expect(requestCostUsd({
      provider: 'openai', model: 'gpt-4.1', component: 'tool planning', apiStyle: 'responses', attempt: 1,
      latencyMs: 1, outcome: 'success', rawJsonValid: true, rawSchemaValid: true, normalizedSchemaValid: true,
      uncachedInputTokens: 1_000_000, cachedInputTokens: 1_000_000,
      cacheWriteInputTokens: 1_000_000, outputTokens: 1_000_000,
    }, arenaCandidate('openai-gpt-4.1').price)).toBe(12.5);
  });

  it('adapts Qwen to the OpenCode Go Messages endpoint', async () => {
    let requestUrl = '';
    let requestBody: any;
    let requestHeaders: Headers | undefined;
    const events: PlannerRequestEvent[] = [];
    const planner = createArenaPlanner(arenaCandidate('qwen3.7-plus'), {
      env: { OPENCODE_API_KEY: 'test' },
      onRequestEvent: (event) => events.push(event),
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        requestHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify({ intent: 'unclear', entities: {}, toolCalls: [], responseClaims: [] }) }],
          usage: { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 60, cache_creation_input_tokens: 5 },
        }), { status: 200 });
      },
    });

    await planner.plan({
      state: { sessionId: 's', customerId: 'c', latestUserMessage: 'Xin chào', intent: 'unclear', userConfirmedOrder: false, escalationReasons: [], retrievedEvidence: [] },
      availableTools: [], recentTurns: [],
    });

    expect(requestUrl).toBe('https://opencode.ai/zen/go/v1/messages');
    expect(requestBody).toMatchObject({ model: 'qwen3.7-plus', max_tokens: 640, system: expect.any(String), messages: [{ role: 'user' }] });
    expect(requestBody.response_format).toBeUndefined();
    expect(requestHeaders?.get('x-api-key')).toBe('test');
    expect(requestHeaders?.get('authorization')).toBeNull();
    expect(events).toEqual([expect.objectContaining({
      outcome: 'success', uncachedInputTokens: 40, cachedInputTokens: 60,
      cacheWriteInputTokens: 5, outputTokens: 10,
    })]);
  });
});
