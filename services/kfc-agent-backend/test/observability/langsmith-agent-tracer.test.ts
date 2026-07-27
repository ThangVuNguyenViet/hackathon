import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LangSmithAgentTracer,
  privacySafeLangSmithInputs,
  privacySafeLangSmithOutputs,
  type LangSmithRunConfig,
  type LangSmithRunLike,
} from '../../src/observability/langsmithAgentTracer.js';

class FakeRun implements LangSmithRunLike {
  readonly children: FakeRun[] = [];
  ended?: {
    outputs?: Record<string, unknown>;
    error?: string;
  };

  constructor(readonly config: LangSmithRunConfig) {}

  createChild(config: LangSmithRunConfig): LangSmithRunLike {
    const child = new FakeRun(config);
    this.children.push(child);
    return child;
  }

  async postRun(): Promise<void> {}

  async end(outputs?: Record<string, unknown>, error?: string): Promise<void> {
    this.ended = { outputs, error };
  }

  async patchRun(): Promise<void> {}
}

const tracingEnvironmentKeys = [
  'LANGSMITH_TRACING',
  'LANGSMITH_TRACING_V2',
  'LANGCHAIN_TRACING',
  'LANGCHAIN_TRACING_V2',
] as const;
const originalTracingEnvironment = Object.fromEntries(
  tracingEnvironmentKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of tracingEnvironmentKeys) {
    const original = originalTracingEnvironment[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('LangSmith agent tracer boundary', () => {
  it('creates LangChain callbacks without relying on tracing environment variables', async () => {
    for (const key of tracingEnvironmentKeys) delete process.env[key];
    const tracer = new LangSmithAgentTracer({
      projectName: 'test-project',
      apiKey: 'test-api-key',
      apiUrl: 'https://langsmith.invalid',
      fetchImplementation: async () => new Response('{}', { status: 200 }),
    });

    const turn = await tracer.startTurn({
      name: 'kfc_agent_turn',
      inputs: { messageCharacterCount: 4 },
    });

    await expect(turn.langchainCallbacks?.()).resolves.toBeDefined();
  });

  it('publishes only allowlisted correlation, tags, and bounded summaries', async () => {
    const roots: FakeRun[] = [];
    const tracer = new LangSmithAgentTracer({
      projectName: 'test-project',
      createRoot(config) {
        const root = new FakeRun(config);
        roots.push(root);
        return root;
      },
    });
    const privateText =
      'Authorization: Bearer private-token; deliver to 18 Le Loi';
    const turn = await tracer.startTurn({
      name: 'kfc_agent_turn',
      inputs: {
        messageCharacterCount: 42,
        structuredAction: false,
        text: privateText,
        providerPayload: { secret: privateText },
      },
      metadata: {
        session_id: 'kfc:session-1',
        run_id: 'run-1',
        turn_id: 'turn-1',
        pack_id: 'kfc-vietnam',
        pack_version: '1.0.0',
        candidate: 'openai-gpt-4.1-mini',
        profile: 'openai:gpt-4.1-mini:responses',
        transport: 'openai_responses',
        response_profile: 'genui',
        channel: 'kfc',
        scenarioId: 'scenario-03',
        probeRunId: 'probe/run-7',
        session_id_digest: 'a'.repeat(64),
        rawEvent: {
          type: 'record',
          count: 1,
          digest: 'b'.repeat(64),
        },
        address: privateText,
        apiKey: 'sk-private',
      },
      tags: [
        'pack:kfc-vietnam',
        'channel:kfc',
        'profile:genui',
        `customer:${privateText}`,
      ],
    });
    await turn.end({
      toolCalls: 2,
      responseCharacterCount: 81,
      responseText: privateText,
      rawProviderPayload: { secret: privateText },
    });
    await tracer.flush();

    expect(roots).toHaveLength(1);
    expect(roots[0]!.config.inputs).toEqual({
      messageCharacterCount: 42,
      structuredAction: false,
    });
    expect(roots[0]!.config.metadata).toEqual({
      session_id: 'kfc:session-1',
      run_id: 'run-1',
      turn_id: 'turn-1',
      pack_id: 'kfc-vietnam',
      pack_version: '1.0.0',
      candidate: 'openai-gpt-4.1-mini',
      profile: 'openai:gpt-4.1-mini:responses',
      transport: 'openai_responses',
      response_profile: 'genui',
      channel: 'kfc',
      scenarioId: 'scenario-03',
      probeRunId: 'probe/run-7',
    });
    expect(roots[0]!.config.tags).toEqual([
      'pack:kfc-vietnam',
      'channel:kfc',
      'profile:genui',
    ]);
    expect(roots[0]!.ended?.outputs).toEqual({
      toolCallCount: 2,
      responseCharacterCount: 81,
    });
    expect(JSON.stringify(roots)).not.toContain(privateText);
    expect(JSON.stringify(roots)).not.toContain('sk-private');
  });

  it('sanitizes every summary with a strict whitelist', () => {
    const privateText =
      '4111111111111111 Authorization: Bearer private home address';

    expect(
      privacySafeLangSmithInputs({
        messageCharacterCount: 77,
        structuredAction: true,
        historyExchangeCount: 4,
        hasSummary: true,
        text: privateText,
      }),
    ).toEqual({
      messageCharacterCount: 77,
      structuredAction: true,
      historyExchangeCount: 4,
      hasSummary: true,
    });
    expect(
      privacySafeLangSmithOutputs({
        toolCalls: 3,
        responseCharacterCount: 99,
        responseText: privateText,
        authorization: privateText,
        payment: privateText,
        address: privateText,
        providerPayload: { raw: privateText },
      }),
    ).toEqual({
      toolCallCount: 3,
      responseCharacterCount: 99,
    });
  });

  it('publishes bounded recommendation evidence without customer or model feature data', () => {
    const privateText = 'Zinger price 99000 for 4111111111111111 at 18 Le Loi';

    expect(
      privacySafeLangSmithInputs({
        candidateCount: 12,
        customerMessage: privateText,
        productName: 'Zinger',
        endpointUrl: 'https://ranking.example/private',
        featureValues: { affinity: 0.91 },
      }),
    ).toEqual({ candidateCount: 12 });
    expect(
      privacySafeLangSmithOutputs({
        durationMs: 12.345,
        potentialCount: 12,
        eligibleCount: 4,
        ineligibleCount: 8,
        scoredCount: 4,
        displayedCount: 1,
        policyCount: 2,
        reasonCodes: ['popular_here', 'already_in_cart', privateText],
        decisionSource: 'ranked',
        shadowStatus: 'succeeded',
        outputMode: 'baseline',
        eventType: 'impression_rendered',
        persistenceOperation: 'decision_commit',
        recommendationStatus: 'cart_revision_conflict',
        customerMessage: privateText,
        rawError: privateText,
        productName: 'Zinger',
        price: 99_000,
        token: 'private-token',
        featureValues: { affinity: 0.91 },
        featureContributions: [{ name: 'affinity', value: 0.91 }],
      }),
    ).toEqual({
      durationMs: 12.345,
      potentialCount: 12,
      eligibleCount: 4,
      ineligibleCount: 8,
      scoredCount: 4,
      displayedCount: 1,
      policyCount: 2,
      reasonCodes: ['popular_here', 'already_in_cart'],
      recommendationStatus: 'cart_revision_conflict',
      decisionSource: 'ranked',
      shadowStatus: 'succeeded',
      outputMode: 'baseline',
      eventType: 'impression_rendered',
      persistenceOperation: 'decision_commit',
    });
  });

  it('keeps the neutral kernel free of KFC and LangSmith imports', async () => {
    const kernel = await readFile(
      resolve(process.cwd(), 'src/runtime/kernel.ts'),
      'utf8',
    );

    expect(kernel).not.toMatch(/kfc/i);
    expect(kernel).not.toMatch(/langsmith/i);
    expect(kernel).not.toMatch(/observability/i);
  });
});
