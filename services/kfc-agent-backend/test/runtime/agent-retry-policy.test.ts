import { describe, expect, it } from 'vitest';
import {
  isRetryableTransientError,
  resolveAgentModelRetryProfile,
} from '../../src/runtime/agentRetryPolicy.js';

describe('agent retry policy', () => {
  it('uses one bounded provider-neutral profile for every transport', () => {
    const expected = {
      maxRetries: 2,
      initialDelayMs: 200,
      backoffFactor: 2,
      maxDelayMs: 1_000,
      jitter: true,
    };

    expect(resolveAgentModelRetryProfile('openai_responses')).toEqual(expected);
    expect(
      resolveAgentModelRetryProfile('openai_compatible_chat'),
    ).toEqual(expected);
    expect(resolveAgentModelRetryProfile('anthropic_messages')).toEqual(
      expected,
    );
    expect(resolveAgentModelRetryProfile('google_genai')).toEqual(expected);
  });

  it('retries only transient failures, including wrapped transport errors', () => {
    expect(
      isRetryableTransientError(
        Object.assign(new Error('rate limited'), { status: 429 }),
      ),
    ).toBe(true);
    expect(
      isRetryableTransientError(
        new Error('wrapper', {
          cause: Object.assign(new Error('socket reset'), {
            code: 'ECONNRESET',
          }),
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableTransientError(
        Object.assign(new Error('server unavailable'), { statusCode: 503 }),
      ),
    ).toBe(true);
    expect(
      isRetryableTransientError(
        Object.assign(new Error('bad request'), { status: 400 }),
      ),
    ).toBe(false);
    expect(
      isRetryableTransientError(
        Object.assign(new Error('cancelled'), { name: 'AbortError' }),
      ),
    ).toBe(false);
  });
});
