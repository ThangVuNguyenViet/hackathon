import { describe, expect, it } from 'vitest';
import {
  createNoopAgentTracer,
} from '../../src/observability/agentTracing.js';
import {
  createControlledRetryTraceCapture,
  hasExpectedRetryTraceSequence,
} from './controlledRetryTraceCapture.js';

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
});
