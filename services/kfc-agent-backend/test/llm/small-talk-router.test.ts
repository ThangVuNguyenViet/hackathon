import { describe, expect, it, vi } from 'vitest';
import { OpenAISmallTalkRouter } from '../../src/llm/smallTalkRouter.js';

const input = {
  latestUserMessage: 'social test input',
  channel: 'kfc' as const,
  hasStructuredAction: false,
};

describe('OpenAISmallTalkRouter', () => {
  it('returns model-written social text and sends the constrained request', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            decision: 'handle_social',
            responseText: 'model social reply',
          }),
        }),
        { status: 200 },
      );
    });
    const router = new OpenAISmallTalkRouter({
      apiKey: 'test_key',
      baseUrl: 'https://openai.local/v1/',
      fetchImpl,
    });

    await expect(router.route(input)).resolves.toEqual({
      decision: 'handle_social',
      responseText: 'model social reply',
    });
    expect(router.model).toBe('gpt-4.1-nano');
    expect(router.promptVersion).toBe('small-talk-router-v1');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://openai.local/v1/responses');
    expect(requestBody).toMatchObject({ model: 'gpt-4.1-nano', temperature: 0 });
    expect(JSON.stringify(requestBody)).not.toContain('toolCatalog');
    expect(String(requestBody?.instructions)).toContain('uncertainty');
    expect(String(requestBody?.instructions)).toContain('continue_to_planner');
  });

  it('returns the planner decision from nested Responses API text', async () => {
    const router = new OpenAISmallTalkRouter({
      apiKey: 'test_key',
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    text: JSON.stringify({ decision: 'continue_to_planner' }),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    });

    await expect(
      router.route({
        latestUserMessage: 'commerce test input',
        channel: 'kfc',
        hasStructuredAction: false,
      }),
    ).resolves.toEqual({ decision: 'continue_to_planner' });
  });

  it('bypasses the model for structured actions', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const router = new OpenAISmallTalkRouter({ apiKey: 'test_key', fetchImpl });

    await expect(router.route({ ...input, hasStructuredAction: true })).resolves.toEqual({
      decision: 'continue_to_planner',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an empty social response', async () => {
    const router = new OpenAISmallTalkRouter({
      apiKey: 'test_key',
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              decision: 'handle_social',
              responseText: '   ',
            }),
          }),
          { status: 200 },
        ),
      ),
    });

    await expect(router.route(input)).rejects.toThrow();
  });

  it('rejects planner decisions that include response text', async () => {
    const router = new OpenAISmallTalkRouter({
      apiKey: 'test_key',
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              decision: 'continue_to_planner',
              responseText: 'unexpected',
            }),
          }),
          { status: 200 },
        ),
      ),
    });

    await expect(router.route(input)).rejects.toThrow();
  });

  it('reports non-OK Responses API status codes', async () => {
    const router = new OpenAISmallTalkRouter({
      apiKey: 'test_key',
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
          status: 503,
          statusText: 'Service Unavailable',
        }),
      ),
    });

    await expect(router.route(input)).rejects.toThrow('HTTP 503');
  });

  it('aborts requests after the configured timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
    );
    const router = new OpenAISmallTalkRouter({
      apiKey: 'test_key',
      timeoutMs: 5,
      fetchImpl,
    });

    await expect(router.route(input)).rejects.toThrow();
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toMatchObject({ aborted: true });
  });
});
