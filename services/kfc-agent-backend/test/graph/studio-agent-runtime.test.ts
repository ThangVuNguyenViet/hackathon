import {
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  KfcAgentGraphInput,
  KfcAgentRuntimeResolver,
} from '../../src/agent/agentStateGraph.js';
import {
  defaultAgentTurnDeadlineMs,
  type SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';

const studioFixture = vi.hoisted(() => ({
  authorModel: Object.freeze({ role: 'author' }),
  configuredModel: undefined as unknown,
  resolver: undefined as unknown,
  startTurn: vi.fn(async () => Object.freeze({ role: 'turn-trace' })),
}));

vi.mock('../../src/agent/agentStateGraph.js', () => ({
  createKfcAgentStateGraph(input: {
    model?: unknown;
    resolveRuntime?: unknown;
  }) {
    studioFixture.configuredModel = input.model;
    studioFixture.resolver = input.resolveRuntime;
    return Object.freeze({ role: 'studio-agent' });
  },
}));

vi.mock('../../src/api/serverOptions.js', () => ({
  buildServerOptionsFromEnv: () => ({
    agent: { model: studioFixture.authorModel },
  }),
}));

vi.mock('../../src/config/env.js', () => ({
  loadEnv: () => ({}),
}));

vi.mock('../../src/fixtures/loadFixtures.js', () => ({
  loadGeneratedFixtures: vi.fn(async () => ({})),
}));

vi.mock('../../src/mock/createMockClients.js', () => ({
  createMockClients: vi.fn(() => Object.freeze({ role: 'clients' })),
}));

vi.mock('../../src/observability/agentTracing.js', () => ({
  createNoopAgentTracer: () => ({
    startTurn: studioFixture.startTurn,
  }),
}));

function studioRuntimeResolver(): KfcAgentRuntimeResolver {
  if (typeof studioFixture.resolver !== 'function') {
    throw new Error('studio_runtime_resolver_not_configured');
  }
  return studioFixture.resolver as KfcAgentRuntimeResolver;
}

function request(externalMessageId: string): KfcAgentGraphInput {
  return {
    sessionId: 'studio-session',
    customerId: 'studio-customer',
    channel: 'kfc',
    text: 'Show me the menu',
    externalMessageId,
    metadata: null,
  };
}

async function resolveRuntime(
  externalMessageId: string,
): Promise<SingleAgentRuntimeContext> {
  return await studioRuntimeResolver()(request(externalMessageId));
}

beforeAll(async () => {
  await import('../../src/graph/studioAgent.js');
});

describe('LangGraph Studio runtime cache', () => {
  it('evicts a resolved runtime when its finite deadline aborts', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
      const first = await resolveRuntime('deadline-retry');
      const firstContext = first.externalCallContext;

      expect(defaultAgentTurnDeadlineMs).toBe(10_000);
      vi.advanceTimersByTime(defaultAgentTurnDeadlineMs - 1);
      expect(firstContext.signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);

      expect(firstContext.signal.aborted).toBe(true);
      expect(firstContext.signal.reason).toEqual(
        expect.objectContaining({ name: 'TimeoutError' }),
      );
      expect(clearTimeoutSpy).toHaveBeenCalled();

      const retry = await resolveRuntime('deadline-retry');

      expect(retry).not.toBe(first);
      expect(retry.externalCallContext).not.toBe(firstContext);
      expect(retry.externalCallContext.signal).not.toBe(firstContext.signal);
      expect(retry.externalCallContext.signal.aborted).toBe(false);
      retry.disposeExternalCalls();
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('evicts a resolved runtime when its scope is explicitly aborted', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const first = await resolveRuntime('abort-retry');
      const firstContext = first.externalCallContext;

      first.abortExternalCalls(
        new DOMException('Customer run cancelled', 'AbortError'),
      );

      expect(firstContext.signal.aborted).toBe(true);
      expect(clearTimeoutSpy).toHaveBeenCalled();

      const retry = await resolveRuntime('abort-retry');

      expect(retry).not.toBe(first);
      expect(retry.externalCallContext).not.toBe(firstContext);
      expect(retry.externalCallContext.signal).not.toBe(firstContext.signal);
      expect(retry.externalCallContext.signal.aborted).toBe(false);
      retry.disposeExternalCalls();
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps a replacement cached if a disposed predecessor aborts later', async () => {
    vi.useFakeTimers();
    try {
      const first = await resolveRuntime('paused-retry');
      first.disposeExternalCalls();

      const replacement = await resolveRuntime('paused-retry');
      first.abortExternalCalls(
        new DOMException('Old run cancelled', 'AbortError'),
      );
      const cachedReplacement = await resolveRuntime('paused-retry');

      expect(cachedReplacement).toBe(replacement);
      expect(replacement.externalCallContext.signal.aborted).toBe(false);
      replacement.disposeExternalCalls();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the configured author model', () => {
    expect(studioFixture.configuredModel).toBe(
      studioFixture.authorModel,
    );
  });
});
