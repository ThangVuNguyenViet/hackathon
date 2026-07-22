import { describe, expect, it } from 'vitest';
import { buildPrivacySafeLangSmithMetadata } from '../../src/observability/langsmithDiagnosticMetadata.js';

const privateCustomerText = '18 Le Loi, call me at 0909000000';

describe('privacy-safe LangSmith diagnostic metadata', () => {
  it('publishes bounded provider-attempt facts without provider prose', async () => {
    const input = {
      provider: {
        provider: 'openai',
        model: 'gpt-5-mini-2025-08-07',
        profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
        attempt: 2,
        outcome: 'error',
        httpStatus: 429,
        errorCode: 'rate_limit_exceeded',
        errorParameter: 'messages[0].content',
        retryable: true,
        requestId: 'req_123',
        rawMessage: privateCustomerText,
      },
      rawPrompt: privateCustomerText,
      apiKey: 'sk-private',
    };
    const metadata = await buildPrivacySafeLangSmithMetadata(input);

    expect(metadata).toEqual({
      modelProvider: 'openai',
      model: 'gpt-5-mini-2025-08-07',
      modelProfile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
      providerAttempt: 2,
      providerAttemptOutcome: 'error',
      providerHttpStatus: 429,
      providerErrorCode: 'rate_limit_exceeded',
      providerErrorParameter: 'messages[0].content',
      providerRetryable: true,
      providerRequestId: 'req_123',
    });
    expect(JSON.stringify(metadata)).not.toContain(privateCustomerText);
    expect(JSON.stringify(metadata)).not.toContain('sk-private');
  });

  it('preserves only the existing correlation and probe contract', async () => {
    const metadata = await buildPrivacySafeLangSmithMetadata({
      currentMetadata: {
        session_id: 'kfc:scenario:guest-1',
        scenarioId: 'scenario-03',
        probeRunId: 'probe/run-7',
        canonicalScenarioTurnIndex: 4,
        clientMessageId: 'message_9',
        rawEvent: {
          type: 'record',
          count: 3,
          digest: 'a'.repeat(64),
          customerText: privateCustomerText,
        },
        prompt: privateCustomerText,
        address: privateCustomerText,
        toolPayload: { value: privateCustomerText },
        apiKey: 'sk-private',
      },
    });

    expect(metadata).toEqual({
      session_id: 'kfc:scenario:guest-1',
      scenarioId: 'scenario-03',
      probeRunId: 'probe/run-7',
      canonicalScenarioTurnIndex: 4,
      clientMessageId: 'message_9',
      rawEvent: {
        type: 'record',
        count: 3,
        digest: 'a'.repeat(64),
      },
    });
    expect(JSON.stringify(metadata)).not.toContain(privateCustomerText);
  });

  it('reports active tool names with schema fingerprints, never schemas or payloads', async () => {
    const input = {
      activeTools: [
        {
          name: 'searchMenu',
          schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
          payload: { query: privateCustomerText },
        },
        {
          name: privateCustomerText,
          schema: { default: privateCustomerText },
        },
      ],
      toolPayloadValues: privateCustomerText,
    };
    const metadata = await buildPrivacySafeLangSmithMetadata(input);

    expect(metadata).toEqual({
      activeTools: [
        {
          name: 'searchMenu',
          schemaFingerprint:
            '094ec29d007cce150c65abf0756d79ad5b62a1acfdb6e0841f69f1377ef41761',
        },
      ],
    });
    expect(JSON.stringify(metadata)).not.toContain(privateCustomerText);
    expect(JSON.stringify(metadata)).not.toContain('properties');
  });

  it('reports only the byte size of a model publication', async () => {
    const input = {
      modelPublication: {
        byteSize: 12_345,
        serialized: privateCustomerText,
      },
    };
    const metadata = await buildPrivacySafeLangSmithMetadata(input);

    expect(metadata).toEqual({ modelPublicationBytes: 12_345 });
    expect(JSON.stringify(metadata)).not.toContain(privateCustomerText);
  });

  it('reports bounded searchMenu scope, purpose, and collection counts', async () => {
    const input = {
      searchMenu: {
        scope: 'filtered',
        purpose: 'recommend',
        totalCount: 18,
        returnedCount: 6,
        query: privateCustomerText,
        results: [{ address: privateCustomerText }],
      },
    };
    const metadata = await buildPrivacySafeLangSmithMetadata(input);

    expect(metadata).toEqual({
      searchMenuScope: 'filtered',
      searchMenuPurpose: 'recommend',
      searchMenuTotalCount: 18,
      searchMenuReturnedCount: 6,
    });
    expect(JSON.stringify(metadata)).not.toContain(privateCustomerText);
  });

  it('reports allowlisted GenUI and media-decision facts without presentation data', async () => {
    const input = {
      genUi: {
        selectedKind: 'smartMenuPicker',
        data: { address: privateCustomerText },
      },
      mediaDecision: {
        reason: 'focused_recommendation',
        count: 2,
        media: [{ url: privateCustomerText }],
      },
    };
    const metadata = await buildPrivacySafeLangSmithMetadata(input);

    expect(metadata).toEqual({
      selectedGenUiKind: 'smartMenuPicker',
      mediaDecisionReason: 'focused_recommendation',
      mediaCount: 2,
    });
    expect(JSON.stringify(metadata)).not.toContain(privateCustomerText);
  });

  it('normalizes SDK token usage when the SDK supplies it', async () => {
    const metadata = await buildPrivacySafeLangSmithMetadata({
      sdkTokenUsage: {
        input_tokens: 120,
        output_tokens: 35,
        total_tokens: 155,
        input_token_details: { cache_read: 40 },
        output_token_details: { reasoning: 10 },
        raw_provider_message: privateCustomerText,
      },
    });

    expect(metadata).toEqual({
      inputTokens: 120,
      cachedInputTokens: 40,
      outputTokens: 35,
      reasoningTokens: 10,
      totalTokens: 155,
    });
    expect(JSON.stringify(metadata)).not.toContain(privateCustomerText);
  });

  it('omits out-of-contract values instead of tracing them', async () => {
    const metadata = await buildPrivacySafeLangSmithMetadata({
      currentMetadata: {
        scenarioId: privateCustomerText,
        rawPrompt: privateCustomerText,
      },
      provider: {
        provider: 'unknown-provider',
        model: privateCustomerText,
        profile: 'x'.repeat(129),
        attempt: 7,
        outcome: privateCustomerText,
        httpStatus: 600,
        errorCode: privateCustomerText,
        errorParameter: privateCustomerText,
        retryable: 'yes',
        requestId: 'r'.repeat(257),
      },
      activeTools: [{ name: 'searchMenu' }],
      modelPublication: { byteSize: -1 },
      searchMenu: {
        scope: privateCustomerText,
        purpose: privateCustomerText,
        totalCount: -1,
        returnedCount: 100_001,
      },
      genUi: { selectedKind: privateCustomerText },
      mediaDecision: { reason: privateCustomerText, count: 65 },
      sdkTokenUsage: {
        input_tokens: -1,
        output_tokens: 1_000_000_001,
        total_tokens: privateCustomerText,
      },
    });

    expect(metadata).toEqual({});
  });
});
