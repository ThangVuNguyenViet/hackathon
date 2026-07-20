import type { Callbacks } from '@langchain/core/callbacks/manager';
import { describe, expect, it, vi } from 'vitest';
import {
  createSafeAgentTracer,
  createNoopAgentTracer,
  type AgentTraceSpan,
  type AgentTraceSpanInput,
  type AgentTracer,
} from '../../src/observability/agentTracing.js';
import {
  createControlledRetryTraceCapture,
  hasExpectedRetryTraceSequence,
} from './controlledRetryTraceCapture.js';

function delegateFailingRetryEvidence(
  failure: 'failed_attempt_end' | 'retry_node_start',
): AgentTracer {
  let failedAttemptEndPending = true;
  const span = (name: string): AgentTraceSpan => ({
    async startSpan(input) {
      if (
        failure === 'retry_node_start' &&
        input.name === 'record_provider_retry'
      ) {
        throw new Error('delegate_span_start_failed');
      }
      return span(input.name);
    },
    async end() {
      if (
        failure === 'failed_attempt_end' &&
        name === 'agent_model_attempt' &&
        failedAttemptEndPending
      ) {
        failedAttemptEndPending = false;
        throw new Error('delegate_span_end_failed');
      }
    },
    async fail() {
      return undefined;
    },
  });
  return {
    async startTurn(input) {
      return span(input.name);
    },
    async flush() {
      return undefined;
    },
  };
}

async function recordRetrySequence(tracer: AgentTracer): Promise<void> {
  const root = await tracer.startTurn({
    name: 'agent_turn',
    inputs: {},
  });
  const failedAttempt = await root.startSpan({
    name: 'agent_model_attempt',
    runType: 'llm',
    inputs: {},
  });
  await failedAttempt.end({
    outcome: 'error',
    retryable: true,
  });
  await root.startSpan({
    name: 'record_provider_retry',
    runType: 'chain',
    inputs: {},
  });
  await root.startSpan({
    name: 'route:record_provider_retry',
    runType: 'chain',
    inputs: {},
  });
  const recoveredAttempt = await root.startSpan({
    name: 'agent_model_attempt',
    runType: 'llm',
    inputs: {},
  });
  await recoveredAttempt.end({ outcome: 'success' });
}

describe('controlled retry trace capture', () => {
  it('recognizes the ordered graph-owned retry sequence', async () => {
    const capture = createControlledRetryTraceCapture(
      createNoopAgentTracer(),
    );
    const root = await capture.tracer.startTurn({
      name: 'agent_turn',
      inputs: {},
    });
    const failedAttempt = await root.startSpan({
      name: 'agent_model_attempt',
      runType: 'llm',
      inputs: {},
    });
    await failedAttempt.end({
      outcome: 'error',
      retryable: true,
    });
    await root.startSpan({
      name: 'record_provider_retry',
      runType: 'chain',
      inputs: {},
    });
    await root.startSpan({
      name: 'route:record_provider_retry',
      runType: 'chain',
      inputs: {},
    });
    const recoveredAttempt = await root.startSpan({
      name: 'agent_model_attempt',
      runType: 'llm',
      inputs: {},
    });
    await recoveredAttempt.end({ outcome: 'success' });

    expect(capture.hasExpectedRetrySequence()).toBe(true);
  });

  it('rejects missing, non-retryable, and reordered evidence', () => {
    expect(hasExpectedRetryTraceSequence([
      {
        phase: 'end',
        name: 'agent_model_attempt',
        outcome: 'error',
        retryable: false,
      },
      {
        phase: 'start',
        name: 'record_provider_retry',
      },
      {
        phase: 'start',
        name: 'route:record_provider_retry',
      },
      {
        phase: 'end',
        name: 'agent_model_attempt',
        outcome: 'success',
      },
    ])).toBe(false);
    expect(hasExpectedRetryTraceSequence([
      {
        phase: 'start',
        name: 'record_provider_retry',
      },
      {
        phase: 'end',
        name: 'agent_model_attempt',
        outcome: 'error',
        retryable: true,
      },
      {
        phase: 'end',
        name: 'agent_model_attempt',
        outcome: 'success',
      },
    ])).toBe(false);
  });

  it('does not combine retry evidence across root traces', async () => {
    const capture = createControlledRetryTraceCapture(
      createNoopAgentTracer(),
    );
    const failedRoot = await capture.tracer.startTurn({
      name: 'failed_turn',
      inputs: {},
    });
    const failedAttempt = await failedRoot.startSpan({
      name: 'agent_model_attempt',
      runType: 'llm',
      inputs: {},
    });
    await failedAttempt.end({
      outcome: 'error',
      retryable: true,
    });

    const recoveredRoot = await capture.tracer.startTurn({
      name: 'recovered_turn',
      inputs: {},
    });
    await recoveredRoot.startSpan({
      name: 'record_provider_retry',
      runType: 'chain',
      inputs: {},
    });
    await recoveredRoot.startSpan({
      name: 'route:record_provider_retry',
      runType: 'chain',
      inputs: {},
    });
    const recoveredAttempt = await recoveredRoot.startSpan({
      name: 'agent_model_attempt',
      runType: 'llm',
      inputs: {},
    });
    await recoveredAttempt.end({ outcome: 'success' });

    expect(capture.hasExpectedRetrySequence()).toBe(false);
  });

  it.each([
    'failed_attempt_end',
    'retry_node_start',
  ] as const)(
    'rejects evidence when safe tracing swallows a %s forwarding failure',
    async (failure) => {
      const capture = createControlledRetryTraceCapture(
        delegateFailingRetryEvidence(failure),
      );
      const diagnostics: string[] = [];
      const safeTracer = createSafeAgentTracer(
        capture.tracer,
        (code) => diagnostics.push(code),
      );

      await recordRetrySequence(safeTracer);

      expect(diagnostics).toContain(
        failure === 'failed_attempt_end'
          ? 'agent_trace_end_failed'
          : 'agent_trace_span_start_failed',
      );
      expect(capture.hasExpectedRetrySequence()).toBe(false);
    },
  );

  it('forwards the complete tracer contract without changing values or context', async () => {
    const callbacks: Callbacks = [];
    const returnValue = { identity: 'delegate-result' };
    const failure = new Error('application_failure');
    const turnInput = {
      name: 'agent_turn',
      inputs: { turn: 1 },
      metadata: { provider: 'test' },
      tags: ['turn'],
    };
    const spanInput = {
      name: 'agent_model_attempt',
      runType: 'llm' as const,
      inputs: { attempt: 1 },
      metadata: { purpose: 'agent_decision' },
      tags: ['attempt'],
    };
    const outputs = { outcome: 'success' };
    let forwardedTurnInput:
      | Omit<AgentTraceSpanInput, 'runType'>
      | undefined;
    let forwardedSpanInput: AgentTraceSpanInput | undefined;
    let forwardedOutputs: Record<string, unknown> | undefined;
    let forwardedFailure: unknown;
    let active = false;
    const flush = vi.fn(async () => undefined);
    const childSpan: AgentTraceSpan = {
      async startSpan() {
        return childSpan;
      },
      async end(value) {
        forwardedOutputs = value;
      },
      async fail(error) {
        forwardedFailure = error;
      },
      async langchainCallbacks() {
        return callbacks;
      },
      async withActiveTrace(fn) {
        active = true;
        try {
          return await fn();
        } finally {
          active = false;
        }
      },
    };
    const rootSpan: AgentTraceSpan = {
      async startSpan(input) {
        forwardedSpanInput = input;
        return childSpan;
      },
      async end() {
        return undefined;
      },
      async fail() {
        return undefined;
      },
    };
    const delegate: AgentTracer = {
      async startTurn(input) {
        forwardedTurnInput = input;
        return rootSpan;
      },
      flush,
    };
    const capture = createControlledRetryTraceCapture(delegate);

    const root = await capture.tracer.startTurn(turnInput);
    const child = await root.startSpan(spanInput);
    await child.end(outputs);
    await child.fail(failure);
    const forwardedCallbacks = await child.langchainCallbacks?.();
    const forwardedReturnValue = await child.withActiveTrace?.(async () => {
      expect(active).toBe(true);
      return returnValue;
    });
    await capture.tracer.flush();

    expect(forwardedTurnInput).toBe(turnInput);
    expect(forwardedSpanInput).toBe(spanInput);
    expect(forwardedOutputs).toBe(outputs);
    expect(forwardedFailure).toBe(failure);
    expect(forwardedCallbacks).toBe(callbacks);
    expect(forwardedReturnValue).toBe(returnValue);
    expect(active).toBe(false);
    expect(flush).toHaveBeenCalledOnce();
  });
});
