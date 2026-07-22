import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
  AgentTracer,
} from '../../src/observability/agentTracing.js';

interface RetryTraceEvent {
  phase: 'end' | 'start';
  name: string;
  outcome?: 'error' | 'invalid_response' | 'success';
  retryable?: boolean;
}

export interface ControlledRetryTraceCapture {
  tracer: AgentTracer;
  hasExpectedRetrySequence(): boolean;
  hasOrderedSpanStarts(names: readonly string[]): boolean;
  hasSpanStart(name: string): boolean;
}

const modelAttemptOutcomes = new Set(['error', 'invalid_response', 'success']);

function modelAttemptOutcome(value: unknown): RetryTraceEvent['outcome'] {
  if (value === 'error') return value;
  if (value === 'invalid_response') return value;
  if (value === 'success') return value;
  return undefined;
}

function capturedEndEvent(
  name: string,
  outputs: Record<string, unknown>,
): RetryTraceEvent {
  const outcome = modelAttemptOutcome(outputs.outcome);
  return {
    phase: 'end',
    name,
    ...(outcome && modelAttemptOutcomes.has(outcome) ? { outcome } : {}),
    ...(typeof outputs.retryable === 'boolean'
      ? { retryable: outputs.retryable }
      : {}),
  };
}

class CapturingForwardSpan implements AgentTraceSpan {
  constructor(
    private readonly delegate: AgentTraceSpan,
    private readonly name: string,
    private readonly events: RetryTraceEvent[],
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    const delegate = await this.delegate.startSpan(input);
    this.events.push({
      phase: 'start',
      name: input.name,
    });
    return new CapturingForwardSpan(delegate, input.name, this.events);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    await this.delegate.end(outputs);
    this.events.push(capturedEndEvent(this.name, outputs));
  }

  async fail(error: unknown): Promise<void> {
    await this.delegate.fail(error);
  }

  async langchainCallbacks() {
    return this.delegate.langchainCallbacks?.();
  }

  async withActiveTrace<Value>(fn: () => Promise<Value>): Promise<Value> {
    return this.delegate.withActiveTrace
      ? this.delegate.withActiveTrace(fn)
      : fn();
  }
}

function indexAfter(
  events: readonly RetryTraceEvent[],
  priorIndex: number,
  predicate: (event: RetryTraceEvent) => boolean,
): number {
  for (let index = priorIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event && predicate(event)) return index;
  }
  return -1;
}

export function hasOrderedSpanStartSequence(
  events: readonly RetryTraceEvent[],
  names: readonly string[],
): boolean {
  let priorIndex = -1;
  for (const name of names) {
    priorIndex = indexAfter(
      events,
      priorIndex,
      (event) => event.phase === 'start' && event.name === name,
    );
    if (priorIndex < 0) return false;
  }
  return true;
}

export function hasExpectedRetryTraceSequence(
  events: readonly RetryTraceEvent[],
): boolean {
  const failedAttempt = indexAfter(
    events,
    -1,
    (event) =>
      event.phase === 'end' &&
      event.name === 'agent_model_attempt' &&
      event.outcome === 'error' &&
      event.retryable === true,
  );
  const retryNode = indexAfter(
    events,
    failedAttempt,
    (event) =>
      event.phase === 'start' && event.name === 'record_provider_retry',
  );
  const retryRoute = indexAfter(
    events,
    retryNode,
    (event) =>
      event.phase === 'start' && event.name === 'route:record_provider_retry',
  );
  const recoveredAttempt = indexAfter(
    events,
    retryRoute,
    (event) =>
      event.phase === 'end' &&
      event.name === 'agent_model_attempt' &&
      event.outcome === 'success',
  );
  return (
    failedAttempt >= 0 &&
    retryNode > failedAttempt &&
    retryRoute > retryNode &&
    recoveredAttempt > retryRoute
  );
}

export function createControlledRetryTraceCapture(
  delegate: AgentTracer,
): ControlledRetryTraceCapture {
  const traces: RetryTraceEvent[][] = [];
  return {
    tracer: {
      async startTurn(input) {
        const events: RetryTraceEvent[] = [];
        traces.push(events);
        return new CapturingForwardSpan(
          await delegate.startTurn(input),
          input.name,
          events,
        );
      },
      async flush() {
        await delegate.flush();
      },
    },
    hasExpectedRetrySequence() {
      return traces.some((events) => hasExpectedRetryTraceSequence(events));
    },
    hasOrderedSpanStarts(names) {
      return traces.some((events) =>
        hasOrderedSpanStartSequence(events, names),
      );
    },
    hasSpanStart(name) {
      return traces.some((events) =>
        events.some((event) => event.phase === 'start' && event.name === name),
      );
    },
  };
}
