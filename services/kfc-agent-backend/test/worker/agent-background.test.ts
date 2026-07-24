import { describe, expect, it, vi } from 'vitest';
import { createNoopAgentTracer } from '../../src/observability/agentTracing.js';
import {
  scheduleAgentBackground,
  type WorkerExecutionContext,
} from '../../src/worker.js';

describe('Worker agent background diagnostics', () => {
  it('never logs trace flush error messages', async () => {
    const privateFailure = 'Authorization: Bearer trace-secret';
    const diagnostics = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let background: Promise<unknown> | undefined;
    const context: WorkerExecutionContext = {
      waitUntil(promise) {
        background = promise;
      },
    };
    const tracer = {
      ...createNoopAgentTracer(),
      async flush() {
        throw new Error(privateFailure);
      },
    };

    try {
      scheduleAgentBackground(context, [], tracer);
      await background;

      expect(diagnostics).toHaveBeenCalledWith('agent_background_failed', {
        errorClass: 'Error',
      });
      expect(JSON.stringify(diagnostics.mock.calls)).not.toContain(
        privateFailure,
      );
    } finally {
      diagnostics.mockRestore();
    }
  });
});
