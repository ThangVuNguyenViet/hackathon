import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createVertexAccessTokenProvider,
  createVertexPlannerFetch,
} from '../../src/llm/vertexPlannerTransport.js';
import { OpenAIToolPlanner } from '../../src/llm/toolPlanner.js';

function serviceAccount(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    client_email: 'planner@example-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    project_id: 'example-project',
    token_uri: 'https://oauth.example/token',
  });
}

describe('Vertex planner transport', () => {
  it('maps strict Responses output to Vertex Chat Completions and normalizes text and usage', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (String(input) === 'https://oauth.example/token') {
        return Response.json({ access_token: 'vertex-token', expires_in: 3600 });
      }
      return Response.json({
        choices: [{ message: { content: '{"decision":"other"}' } }],
        usage: {
          prompt_tokens: 40,
          completion_tokens: 8,
          total_tokens: 48,
          prompt_tokens_details: { cached_tokens: 10 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      });
    });
    const transport = createVertexPlannerFetch({
      serviceAccountJson: serviceAccount(),
      model: 'google/gemini-3.1-flash-lite',
      location: 'global',
      fetchImpl,
    });
    const controller = new AbortController();

    const response = await transport('https://vertex-planner.invalid/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-client-request-id': 'request-1' },
      body: JSON.stringify({
        temperature: 0,
        max_output_tokens: 24,
        instructions: 'Classify.',
        input: 'Customer text',
        text: {
          format: {
            type: 'json_schema',
            name: 'decision',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { decision: { type: 'string' } },
              required: ['decision'],
            },
          },
        },
      }),
    });

    expect(requests[1]?.url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/example-project/locations/global/endpoints/openapi/chat/completions',
    );
    expect(requests[0]?.init?.signal).toBe(controller.signal);
    expect(new Headers(requests[1]?.init?.headers).get('authorization')).toBe('Bearer vertex-token');
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      model: 'google/gemini-3.1-flash-lite',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'decision',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { decision: { type: 'string' } },
            required: ['decision'],
          },
        },
      },
      messages: [
        { role: 'system', content: 'Classify.' },
        { role: 'user', content: 'Customer text' },
      ],
      google: { thinking_config: { thinking_level: 'minimal' } },
    });
    expect(await response.json()).toEqual({
      output_text: '{"decision":"other"}',
      usage: {
        input_tokens: 40,
        input_tokens_details: { cached_tokens: 10 },
        output_tokens: 8,
        output_tokens_details: { reasoning_tokens: 2 },
        total_tokens: 48,
      },
    });
  });

  it('caches valid access tokens and refreshes expired tokens', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'expired', expires_in: 0 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'fresh', expires_in: 3600 }));
    const getAccessToken = createVertexAccessTokenProvider(serviceAccount(), fetchImpl, () => 1_000_000);

    expect(await getAccessToken()).toBe('expired');
    expect(await getAccessToken()).toBe('fresh');
    expect(await getAccessToken()).toBe('fresh');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('normalizes Vertex array errors without exposing credentials', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === 'https://oauth.example/token'
        ? Response.json({ access_token: 'vertex-token', expires_in: 3600 })
        : Response.json(
            [{ error: { message: 'Model unavailable', status: 'UNAVAILABLE' } }],
            { status: 503 },
          ),
    );
    const transport = createVertexPlannerFetch({
      serviceAccountJson: serviceAccount(),
      model: 'google/gemini-3.1-flash-lite',
      fetchImpl,
    });

    const response = await transport('https://vertex-planner.invalid/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ instructions: '', input: '', text: { format: { type: 'json_object' } } }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { message: 'Model unavailable', type: 'vertex_error', code: 'UNAVAILABLE' },
    });
  });

  it('preserves the shared planner output contract end to end', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === 'https://oauth.example/token'
        ? Response.json({ access_token: 'vertex-token', expires_in: 3600 })
        : Response.json({
            choices: [{
              message: {
                content: JSON.stringify({
                  intent: 'voucher',
                  entities: {},
                  toolCalls: [{ toolName: 'searchPromotions', arguments: {} }],
                  responseClaims: [],
                }),
              },
            }],
          }),
    );
    const planner = new OpenAIToolPlanner({
      apiKey: '',
      model: 'google/gemini-3.1-flash-lite',
      baseUrl: 'https://vertex-planner.invalid/v1',
      fetchImpl: createVertexPlannerFetch({
        serviceAccountJson: serviceAccount(),
        model: 'google/gemini-3.1-flash-lite',
        fetchImpl,
      }),
    });

    await expect(planner.plan({
      state: {
        sessionId: 'session-1',
        customerId: 'customer-1',
        latestUserMessage: 'Có ưu đãi gì?',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: ['searchPromotions'],
      recentTurns: [],
    })).resolves.toMatchObject({
      intent: 'voucher',
      toolCalls: [{ toolName: 'searchPromotions', arguments: { query: '' } }],
    });
  });

  it('rejects malformed credentials before sending a request', () => {
    expect(() =>
      createVertexPlannerFetch({
        serviceAccountJson: '{"private_key":"secret"}',
        model: 'google/gemini-3.1-flash-lite',
      }),
    ).toThrow('VERTEX_SERVICE_ACCOUNT_JSON');
  });
});
