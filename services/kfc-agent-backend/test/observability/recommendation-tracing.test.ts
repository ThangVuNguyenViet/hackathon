import { describe, expect, it } from 'vitest';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
  AgentTracer,
} from '../../src/observability/agentTracing.js';
import {
  LangSmithAgentTracer,
  type LangSmithRunConfig,
  type LangSmithRunLike,
} from '../../src/observability/langsmithAgentTracer.js';
import { runRecommendationTrace } from '../../src/recommendations/observability/recommendation-tracing.js';

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

describe('recommendation tracing boundary', () => {
  it('keeps stage spans nested under one sanitized correlated decision', async () => {
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
      'Zinger at 99000 for 4111111111111111, deliver to 18 Le Loi';

    const result = await runRecommendationTrace({
      tracer,
      name: 'recommendation.decide',
      inputs: {
        candidateCount: 3,
        customerMessage: privateText,
      },
      metadata: {
        session_id: 'session-observability-1',
        order_flow_id: 'order-flow-observability-1',
        request_id: 'request-observability-1',
        request_digest: 'a'.repeat(64),
        customerMessage: privateText,
      },
      run: (trace) =>
        trace.span(
          {
            name: 'recommendation.enumeration',
            inputs: { candidateCount: 3, productName: 'Zinger' },
            metadata: {
              request_id: 'request-observability-1',
              endpointUrl: 'https://ranking.example/private',
            },
          },
          async () => ({ count: 3 }),
          (value) => ({
            candidateCount: value.count,
            productName: 'Zinger',
          }),
        ),
      summarize: (value) => ({
        recommendationStatus: 'recommended',
        potentialCount: value.count,
        rawResponse: privateText,
      }),
    });
    await tracer.flush();

    expect(result).toEqual({ count: 3 });
    expect(roots).toHaveLength(1);
    expect(roots[0]!.config).toMatchObject({
      name: 'recommendation.decide',
      inputs: { candidateCount: 3 },
      metadata: {
        session_id: 'session-observability-1',
        order_flow_id: 'order-flow-observability-1',
        request_id: 'request-observability-1',
        request_digest: 'a'.repeat(64),
      },
    });
    expect(roots[0]!.ended?.outputs).toMatchObject({
      recommendationStatus: 'recommended',
      potentialCount: 3,
    });
    expect(roots[0]!.children).toHaveLength(1);
    expect(roots[0]!.children[0]!.config).toMatchObject({
      name: 'recommendation.enumeration',
      inputs: { candidateCount: 3 },
      metadata: { request_id: 'request-observability-1' },
    });
    expect(roots[0]!.children[0]!.ended?.outputs).toMatchObject({
      candidateCount: 3,
    });
    expect(JSON.stringify(roots)).not.toContain(privateText);
    expect(JSON.stringify(roots)).not.toContain('Zinger');
    expect(JSON.stringify(roots)).not.toContain('ranking.example');
  });

  it('never changes recommendation behavior when tracing throws', async () => {
    const unavailableSpan: AgentTraceSpan = {
      async startSpan(_input: AgentTraceSpanInput) {
        throw new Error('private tracer child failure');
      },
      async end() {
        throw new Error('private tracer end failure');
      },
      async fail() {
        throw new Error('private tracer fail failure');
      },
    };
    const unavailableTracer: AgentTracer = {
      async startTurn() {
        return unavailableSpan;
      },
      async flush() {
        throw new Error('private tracer flush failure');
      },
    };

    await expect(
      runRecommendationTrace({
        tracer: unavailableTracer,
        name: 'recommendation.decide',
        inputs: {},
        metadata: { request_id: 'request-observability-2' },
        run: (trace) =>
          trace.span(
            {
              name: 'recommendation.enumeration',
              inputs: {},
            },
            async () => 'same-recommendation',
            () => ({ candidateCount: 1 }),
          ),
        summarize: () => ({ recommendationStatus: 'recommended' }),
      }),
    ).resolves.toBe('same-recommendation');

    await expect(
      runRecommendationTrace({
        tracer: {
          async startTurn() {
            throw new Error('private tracer root failure');
          },
          async flush() {
            throw new Error('private tracer flush failure');
          },
        },
        name: 'recommendation.outcome',
        inputs: {},
        metadata: { recommendation_id: 'recommendation-observability-2' },
        run: async () => 'same-outcome',
        summarize: () => ({ recommendationStatus: 'recorded' }),
      }),
    ).resolves.toBe('same-outcome');
  });
});
