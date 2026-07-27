import { describe, expect, it } from 'vitest';
import {
  privacySafeLangSmithError,
  privacySafeLangSmithInputs,
  privacySafeLangSmithMetadata,
  privacySafeLangSmithOutputs,
} from '../../src/observability/langsmithTracePrivacy.js';

const digest = /^[0-9a-f]{64}$/u;

describe('LangSmith trace privacy', () => {
  it('replaces raw inputs with safe control fields and an evidence digest', () => {
    const safe = privacySafeLangSmithInputs({
      toolName: 'placeOrder',
      boundary: 'oms',
      latestUserMessage: 'private customer prose',
      arguments: { phone: '+84-secret', address: 'private address' },
    });

    expect(safe).toMatchObject({
      toolName: 'placeOrder',
      boundary: 'oms',
      evidenceDigest: expect.stringMatching(digest),
    });
    expect(JSON.stringify(safe)).not.toContain('private');
    expect(JSON.stringify(safe)).not.toContain('+84-secret');
  });

  it('keeps only reviewed metadata identities', () => {
    const safe = privacySafeLangSmithMetadata({
      executionId: '00000000-0000-4000-8000-000000000001',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      profile: 'openai-qualification',
      category: 'model',
      apiKey: 'secret-key',
      prompt: 'private prompt',
    });

    expect(safe).toEqual({
      executionId: '00000000-0000-4000-8000-000000000001',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      profile: 'openai-qualification',
      category: 'model',
    });
  });

  it('preserves bounded usage and provider-reported USD cost without results', () => {
    const safe = privacySafeLangSmithOutputs({
      result: { orderId: 'private-order', phone: '+84-secret' },
      usageMetadata: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      costMetadata: { currency: 'USD', amountUsd: 0.0042 },
      genUiKind: 'order_summary',
    });

    expect(safe).toEqual({
      evidenceDigest: expect.stringMatching(digest),
      usageMetadata: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      costMetadata: { currency: 'USD', amountUsd: 0.0042 },
      genUiProjected: true,
    });
    expect(JSON.stringify(safe)).not.toContain('private-order');
  });

  it('maps raw errors to one stable fail-closed value', () => {
    expect(privacySafeLangSmithError(new Error('secret provider body'))).toBe(
      'agent_trace_failed_closed',
    );
  });
});
