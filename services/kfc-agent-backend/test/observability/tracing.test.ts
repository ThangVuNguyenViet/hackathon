import { describe, expect, it } from 'vitest';
import { createTraceRecorder } from '../../src/observability/tracing.js';

describe('createTraceRecorder', () => {
  it('uses no-op tracing when LangSmith credentials are absent', async () => {
    const recorder = createTraceRecorder({ LANGSMITH_API_KEY: '', LANGSMITH_PROJECT: 'local' });
    await recorder.recordScenarioResult({
      scenarioId: 'scenario_08',
      useCases: ['UC-24', 'UC-33', 'UC-50'],
      finalState: 'human_review_required',
    });

    expect(recorder.mode).toBe('noop');
  });
});
