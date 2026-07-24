import { describe, expect, it } from 'vitest';
import { customerRunStartRequestSchema } from '../../src/customerRuns/contracts.js';
import { fingerprintFor } from '../../src/customerRuns/runtime.js';

const request = {
  schemaVersion: 1,
  sessionId: 'kfc:customer-1',
  customerId: 'customer-1',
  clientMessageId: 'message-1',
  input: { kind: 'text' as const, text: 'Xin chào' },
};

describe('customer run model candidate contract', () => {
  it.each([
    'openai-gpt-4.1-mini',
    'deepseek-v4-flash',
    'qwen3.7-max',
    'minimax-m3',
  ])('accepts the qualified live candidate %s', (candidateId) => {
    expect(
      customerRunStartRequestSchema.parse({ ...request, candidateId }),
    ).toMatchObject({ candidateId });
  });

  it('rejects candidates outside the qualified demo roster', () => {
    expect(() =>
      customerRunStartRequestSchema.parse({
        ...request,
        candidateId: 'google-gemini-3.1-flash-lite',
      }),
    ).toThrow();
    expect(() =>
      customerRunStartRequestSchema.parse({
        ...request,
        candidateId: 'untrusted-model',
      }),
    ).toThrow();
  });

  it('binds idempotency to the candidate captured by the request', async () => {
    const openAi = customerRunStartRequestSchema.parse({
      ...request,
      candidateId: 'openai-gpt-4.1-mini',
    });
    const qwen = customerRunStartRequestSchema.parse({
      ...request,
      candidateId: 'qwen3.7-max',
    });

    await expect(fingerprintFor(openAi)).resolves.not.toBe(
      await fingerprintFor(qwen),
    );
  });
});
