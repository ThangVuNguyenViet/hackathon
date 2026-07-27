import type {
  AgentTraceRunType,
  AgentTraceSpan,
  AgentTracer,
} from '../../observability/agentTracing.js';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
} from '../../observability/agentTracing.js';

export interface RecommendationSpanInput {
  name: string;
  runType?: AgentTraceRunType;
  inputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

type TraceSummary<T> = (value: T) => Record<string, unknown>;

function durationSince(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 1_000) / 1_000;
}

function safeSummary<T>(
  summarize: TraceSummary<T>,
  value: T,
): Record<string, unknown> {
  try {
    return summarize(value);
  } catch {
    return {};
  }
}

export class RecommendationTrace {
  constructor(private readonly parentSpan: AgentTraceSpan) {}

  async span<T>(
    input: RecommendationSpanInput,
    operation: () => Promise<T>,
    summarize: TraceSummary<T>,
  ): Promise<T> {
    const child = await this.parentSpan.startSpan({
      name: input.name,
      runType: input.runType ?? 'chain',
      inputs: input.inputs,
      metadata: input.metadata,
    });
    const startedAt = performance.now();
    try {
      const value = await operation();
      await child.end({
        ...safeSummary(summarize, value),
        durationMs: durationSince(startedAt),
      });
      return value;
    } catch (error) {
      await child.fail(error);
      throw error;
    }
  }
}

export async function runRecommendationTrace<T>(input: {
  tracer?: AgentTracer;
  name: string;
  inputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  run: (trace: RecommendationTrace) => Promise<T>;
  summarize: TraceSummary<T>;
}): Promise<T> {
  const tracer = input.tracer
    ? createSafeAgentTracer(input.tracer)
    : createNoopAgentTracer();
  const root = await tracer.startTurn({
    name: input.name,
    inputs: input.inputs,
    metadata: input.metadata,
  });
  const startedAt = performance.now();
  try {
    const value = await input.run(new RecommendationTrace(root));
    await root.end({
      ...safeSummary(input.summarize, value),
      durationMs: durationSince(startedAt),
    });
    return value;
  } catch (error) {
    await root.fail(error);
    throw error;
  }
}
