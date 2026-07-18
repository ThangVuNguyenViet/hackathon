import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  arenaCandidate,
  arenaCandidates,
  createArenaPlanner,
  missingArenaCredentials,
  requestCostUsd,
  type PlannerRequestEvent,
} from '../../src/evaluation/modelArena.js';
import type { ToolPlannerInput } from '../../src/llm/toolPlanner.js';

describe('model arena', () => {
  it('registers only executable affordable candidates and reports missing credential names', () => {
    expect(arenaCandidates).toHaveLength(5);
    expect(() => arenaCandidate('openai-gpt-4.1')).toThrow('Unknown arena candidate');
    expect(missingArenaCredentials(arenaCandidates, { OPENAI_API_KEY: 'configured' })).toEqual([
      'OPENCODE_API_KEY', 'VERTEX_SERVICE_ACCOUNT_JSON',
    ]);
  });

  it('runs Gemini 3.1 through the production Vertex transport', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const serviceAccount = JSON.stringify({
      client_email: 'planner@example-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      project_id: 'example-project',
      token_uri: 'https://oauth.example/token',
    });
    const providerRequests: Array<{ url: string; body: any }> = [];
    const events: PlannerRequestEvent[] = [];
    const planner = createArenaPlanner(arenaCandidate('gemini-3.1-flash-lite'), {
      env: { VERTEX_SERVICE_ACCOUNT_JSON: serviceAccount, VERTEX_LOCATION: 'global' },
      onRequestEvent: (event) => events.push(event),
      fetchImpl: async (input, init) => {
        if (String(input) === 'https://oauth.example/token') {
          return Response.json({ access_token: 'vertex-token', expires_in: 3600 });
        }
        const requestBody = JSON.parse(String(init?.body));
        providerRequests.push({ url: String(input), body: requestBody });
        const schemaName = requestBody.response_format?.json_schema?.name;
        const compactPlanner = schemaName === 'compact_planner_output';
        const abnormalOrder = requestBody.messages?.[1]?.content.includes('200 combo');
        return Response.json({
          choices: [{ message: { content: JSON.stringify(schemaName === 'fast_catalog_evidence_decision'
            ? {
                decision: 'full_planning',
                discoveryTool: null,
                query: null,
                commerceMutationRequested: true,
                foodContentEvidenceRequirement: 'not-required',
              }
            : compactPlanner
              ? { i: 'unclear', e: { asksClarification: true }, t: [], r: [] }
              : abnormalOrder
                ? {
                    intent: 'handoff',
                    entities: {
                      abnormalLargeOrder: true,
                      abnormalLargeOrderQuantity: 200,
                    },
                    toolCalls: [{
                      toolName: 'handoff',
                      arguments: { reasons: ['abnormal_large_order', 'human_review_required'] },
                    }],
                    responseClaims: [],
                  }
                : {
                intent: 'voucher', entities: {},
                toolCalls: [{ toolName: 'searchPromotions', arguments: {} }], responseClaims: [],
              }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });
      },
    });

    await planner.plan({
      state: { sessionId: 's', customerId: 'c', latestUserMessage: 'Có ưu đãi gì?', intent: 'unclear', userConfirmedOrder: false, escalationReasons: [], retrievedEvidence: [] },
      availableTools: ['searchPromotions'], recentTurns: [],
    });
    await expect(planner.plan({
      state: { sessionId: 's', customerId: 'c', latestUserMessage: 'Đặt 200 combo gà.', intent: 'unclear', userConfirmedOrder: false, escalationReasons: [], retrievedEvidence: [] },
      availableTools: ['handoff'], recentTurns: [],
    })).resolves.toMatchObject({
      intent: 'handoff',
      entities: { abnormalLargeOrderQuantity: 200 },
      toolCalls: [{ toolName: 'handoff', arguments: { reasons: ['abnormal_large_order', 'human_review_required'] } }],
    });
    await expect(planner.plan({
      state: { sessionId: 's', customerId: 'c', latestUserMessage: 'Địa chỉ còn thiếu gì?', intent: 'unclear', userConfirmedOrder: false, escalationReasons: [], retrievedEvidence: [] },
      availableTools: ['handoff'], recentTurns: [], planningProfile: 'active_checkout',
    })).resolves.toMatchObject({
      intent: 'unclear',
      entities: { asksClarification: true },
      toolCalls: [],
    });

    const canonicalPlannerRequest = providerRequests.find(({ body }) =>
      body.response_format?.json_schema?.name === 'planner_output'
    );
    const compactPlannerRequest = providerRequests.find(({ body }) =>
      body.response_format?.json_schema?.name === 'compact_planner_output'
    );
    expect(canonicalPlannerRequest).toEqual(expect.objectContaining({
      url: 'https://aiplatform.googleapis.com/v1/projects/example-project/locations/global/endpoints/openapi/chat/completions',
      body: expect.objectContaining({
        model: 'google/gemini-3.1-flash-lite',
        google: { thinking_config: { thinking_level: 'minimal' } },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'planner_output',
            strict: true,
            schema: expect.objectContaining({
              type: 'object',
              required: ['intent', 'entities', 'toolCalls', 'responseClaims'],
              additionalProperties: true,
            }),
          },
        },
      }),
    }));
    expect(canonicalPlannerRequest?.body.temperature).toBeUndefined();
    expect(canonicalPlannerRequest?.body.max_tokens).toBeUndefined();
    expect(compactPlannerRequest?.body.response_format).toMatchObject({
      json_schema: {
        name: 'compact_planner_output',
        schema: { required: ['i', 'e', 't', 'r'] },
      },
    });
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
      provider: 'google', apiStyle: 'chat_completions', outcome: 'success',
      inputTokens: 100, outputTokens: 20,
      rawJsonValid: true, rawSchemaValid: true, normalizedSchemaValid: true,
    })]));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
      component: 'tool planning',
      outcome: 'success',
      rawJsonValid: true, rawSchemaValid: true, normalizedSchemaValid: true,
    })]));
  });

  it('records only bounded validation paths and codes for normalized schema failures', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const serviceAccount = JSON.stringify({
      client_email: 'planner@example-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      project_id: 'example-project',
      token_uri: 'https://oauth.example/token',
    });
    const events: PlannerRequestEvent[] = [];
    const planner = createArenaPlanner(arenaCandidate('gemini-3.1-flash-lite'), {
      env: { VERTEX_SERVICE_ACCOUNT_JSON: serviceAccount, VERTEX_LOCATION: 'global' },
      onRequestEvent: (event) => events.push(event),
      fetchImpl: async (input) => {
        if (String(input) === 'https://oauth.example/token') {
          return Response.json({ access_token: 'vertex-token', expires_in: 3600 });
        }
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify({
                i: 'unclear',
                e: {},
                p: { unexpected: 'value' },
                t: [],
                r: [],
              }),
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });
      },
    });

    await planner.plan({
      state: {
        sessionId: 's',
        customerId: 'c',
        latestUserMessage: 'Xin chào',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: [],
      recentTurns: [],
      planningProfile: 'active_checkout',
    });

    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
      component: 'tool planning',
      outcome: 'invalid_schema',
      rawJsonValid: true,
      rawSchemaValid: true,
      normalizedSchemaValid: false,
      normalizedValidationIssues: [{
        path: 'pendingDecisions',
        code: 'unrecognized_keys',
      }],
    })]));
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

  it('records an intentionally superseded primary plan separately from provider failure', async () => {
    const events: PlannerRequestEvent[] = [];
    const planner = createArenaPlanner(arenaCandidate('deepseek-v4-flash'), {
      env: { OPENCODE_API_KEY: 'test' },
      onRequestEvent: (event) => events.push(event),
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          response_format?: { json_schema?: { name?: string } };
        };
        if (body.response_format?.json_schema?.name === 'active_handoff_followup') {
          return Response.json({
            choices: [{ message: { content: JSON.stringify({ relationship: 'explanation' }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort);
        });
      },
    });
    const input: ToolPlannerInput = {
      state: {
        sessionId: 's',
        customerId: 'c',
        latestUserMessage: 'Why was I transferred?',
        intent: 'handoff' as const,
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
        handoff: { escalationId: 'esc-1', reasons: ['abnormal_large_order'] },
      },
      availableTools: ['handoff'],
      recentTurns: [],
    };

    await planner.plan(input);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        component: 'tool planning',
        outcome: 'network_error',
        networkErrorType: 'superseded',
      }),
    ]));
  });

  it('prices each token class independently', () => {
    expect(requestCostUsd({
      provider: 'openai', model: 'gpt-4.1-mini', component: 'tool planning', apiStyle: 'responses', attempt: 1,
      latencyMs: 1, outcome: 'success', rawJsonValid: true, rawSchemaValid: true, normalizedSchemaValid: true,
      uncachedInputTokens: 1_000_000, cachedInputTokens: 1_000_000,
      cacheWriteInputTokens: 1_000_000, outputTokens: 1_000_000,
    }, arenaCandidate('openai-gpt-4.1-mini').price)).toBe(2.5);
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
