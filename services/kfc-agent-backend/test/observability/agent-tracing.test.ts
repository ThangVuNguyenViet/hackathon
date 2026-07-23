import { describe, expect, it } from 'vitest';
import { RunTree } from 'langsmith';
import { getCurrentRunTree } from 'langsmith/traceable';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
  type AgentTraceSpan,
  type AgentTraceSpanInput,
  type AgentTracer,
} from '../../src/observability/agentTracing.js';
import {
  LangSmithAgentTracer,
  type LangSmithRunConfig,
  type LangSmithRunLike,
} from '../../src/observability/langsmithAgentTracer.js';

interface CapturedEvent {
  phase: 'start' | 'end' | 'fail';
  name: string;
  payload?: Record<string, unknown>;
}

class CapturingSpan implements AgentTraceSpan {
  constructor(
    private readonly name: string,
    private readonly events: CapturedEvent[],
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    this.events.push({
      phase: 'start',
      name: input.name,
      payload: input.inputs,
    });
    return new CapturingSpan(input.name, this.events);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    this.events.push({ phase: 'end', name: this.name, payload: outputs });
  }

  async fail(error: unknown): Promise<void> {
    this.events.push({
      phase: 'fail',
      name: this.name,
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

class CapturingAgentTracer implements AgentTracer {
  readonly events: CapturedEvent[] = [];

  async startTurn(
    input: Omit<AgentTraceSpanInput, 'runType'>,
  ): Promise<AgentTraceSpan> {
    this.events.push({
      phase: 'start',
      name: input.name,
      payload: input.inputs,
    });
    return new CapturingSpan(input.name, this.events);
  }

  async flush(): Promise<void> {}
}

class ThrowingAgentTracer implements AgentTracer {
  async startTurn(): Promise<AgentTraceSpan> {
    throw new Error('LangSmith unavailable');
  }

  async flush(): Promise<void> {
    throw new Error('LangSmith flush unavailable');
  }
}

class FakeLangSmithRun implements LangSmithRunLike {
  readonly children: FakeLangSmithRun[] = [];
  posted = false;
  patched = false;
  outputs?: Record<string, unknown>;
  error?: string;

  constructor(readonly config: LangSmithRunConfig) {}

  createChild(config: LangSmithRunConfig): LangSmithRunLike {
    const child = new FakeLangSmithRun(config);
    this.children.push(child);
    return child;
  }

  async postRun(): Promise<void> {
    this.posted = true;
  }

  async end(outputs?: Record<string, unknown>, error?: string): Promise<void> {
    this.outputs = outputs;
    this.error = error;
  }

  async patchRun(): Promise<void> {
    this.patched = true;
  }
}

describe('agent tracing', () => {
  it('records ordered child spans under one agent turn', async () => {
    const capture = new CapturingAgentTracer();
    const turn = await capture.startTurn({
      name: 'agent_turn',
      inputs: { sessionId: 'demo' },
    });
    const modelCall = await turn.startSpan({
      name: 'call_model',
      runType: 'llm',
      inputs: { iteration: 1 },
    });

    await modelCall.end({ intent: 'cart_edit' });
    await turn.end({ replyIntent: 'general_reply' });

    expect(
      capture.events.map((event) => `${event.phase}:${event.name}`),
    ).toEqual([
      'start:agent_turn',
      'start:call_model',
      'end:call_model',
      'end:agent_turn',
    ]);
  });

  it('provides a no-op tracer that accepts nested spans', async () => {
    const tracer = createNoopAgentTracer();
    const turn = await tracer.startTurn({ name: 'agent_turn', inputs: {} });
    const tool = await turn.startSpan({
      name: 'tool_call:updateCart',
      runType: 'tool',
      inputs: {},
    });

    await tool.end({ ok: true });
    await turn.end({ responseText: 'ok' });
    await tracer.flush();
  });

  it('swallows delegate start failures and reports a stable local diagnostic', async () => {
    const diagnostics: string[] = [];
    const safe = createSafeAgentTracer(new ThrowingAgentTracer(), (code) =>
      diagnostics.push(code),
    );

    const turn = await safe.startTurn({ name: 'agent_turn', inputs: {} });
    const tool = await turn.startSpan({
      name: 'tool_call:updateCart',
      runType: 'tool',
      inputs: {},
    });
    await tool.end({ ok: true });
    await turn.end({ responseText: 'still delivered' });
    await safe.flush();

    expect(diagnostics).toEqual([
      'agent_trace_start_failed',
      'agent_trace_flush_failed',
    ]);
  });

  it('preserves native callbacks and active trace delegation through the safe wrapper', async () => {
    const callbacks: Callbacks = [];
    const events: string[] = [];
    const delegateSpan: AgentTraceSpan = {
      async startSpan() {
        return this;
      },
      async end() {},
      async fail() {},
      async langchainCallbacks() {
        events.push('callbacks');
        return callbacks;
      },
      async withActiveTrace(fn) {
        events.push('active:start');
        const result = await fn();
        events.push('active:end');
        return result;
      },
    };
    const safe = createSafeAgentTracer({
      async startTurn() {
        return delegateSpan;
      },
      async flush() {},
    });

    const turn = await safe.startTurn({ name: 'agent_turn', inputs: {} });

    expect(turn.langchainCallbacks).toBeTypeOf('function');
    expect(await turn.langchainCallbacks?.()).toBe(callbacks);
    expect(turn.withActiveTrace).toBeTypeOf('function');
    await expect(
      turn.withActiveTrace?.(async () => {
        events.push('application');
        return 'completed';
      }),
    ).resolves.toBe('completed');
    expect(events).toEqual([
      'callbacks',
      'active:start',
      'application',
      'active:end',
    ]);
  });

  it('falls back safely when optional tracing integrations fail', async () => {
    const diagnostics: string[] = [];
    let applicationCalls = 0;
    const delegateSpan: AgentTraceSpan = {
      async startSpan() {
        return this;
      },
      async end() {},
      async fail() {},
      async langchainCallbacks() {
        throw new Error('callback bridge unavailable');
      },
      async withActiveTrace(fn) {
        const result = await fn();
        throw new Error(`active trace cleanup failed after ${String(result)}`);
      },
    };
    const safe = createSafeAgentTracer(
      {
        async startTurn() {
          return delegateSpan;
        },
        async flush() {},
      },
      (code) => diagnostics.push(code),
    );

    const turn = await safe.startTurn({ name: 'agent_turn', inputs: {} });

    await expect(turn.langchainCallbacks?.()).resolves.toBeUndefined();
    await expect(
      turn.withActiveTrace?.(async () => {
        applicationCalls += 1;
        return 'completed';
      }),
    ).resolves.toBe('completed');
    expect(applicationCalls).toBe(1);
    expect(diagnostics).toEqual([
      'agent_trace_callbacks_failed',
      'agent_trace_active_context_failed',
    ]);
  });

  it('does not swallow application failures raised inside an active trace', async () => {
    const diagnostics: string[] = [];
    const applicationError = new Error('application failed');
    const delegateSpan: AgentTraceSpan = {
      async startSpan() {
        return this;
      },
      async end() {},
      async fail() {},
      async withActiveTrace(fn) {
        return fn();
      },
    };
    const safe = createSafeAgentTracer(
      {
        async startTurn() {
          return delegateSpan;
        },
        async flush() {},
      },
      (code) => diagnostics.push(code),
    );
    const turn = await safe.startTurn({ name: 'agent_turn', inputs: {} });

    await expect(
      turn.withActiveTrace?.(async () => {
        throw applicationError;
      }),
    ).rejects.toBe(applicationError);
    expect(diagnostics).toEqual([]);
  });

  it('runs application work when the active trace delegate omits the callback', async () => {
    const diagnostics: string[] = [];
    let applicationCalls = 0;
    const delegateSpan: AgentTraceSpan = {
      async startSpan() {
        return this;
      },
      async end() {},
      async fail() {},
      async withActiveTrace<T>() {
        return 'trace-returned-without-callback' as T;
      },
    };
    const safe = createSafeAgentTracer(
      {
        async startTurn() {
          return delegateSpan;
        },
        async flush() {},
      },
      (code) => diagnostics.push(code),
    );
    const turn = await safe.startTurn({ name: 'agent_turn', inputs: {} });

    await expect(
      turn.withActiveTrace?.(async () => {
        applicationCalls += 1;
        return 'application-result';
      }),
    ).resolves.toBe('application-result');
    expect(applicationCalls).toBe(1);
    expect(diagnostics).toEqual(['agent_trace_active_context_failed']);
  });

  it('propagates an application failure swallowed by the active trace delegate', async () => {
    const diagnostics: string[] = [];
    const applicationError = new Error('application failed');
    let applicationCalls = 0;
    const delegateSpan: AgentTraceSpan = {
      async startSpan() {
        return this;
      },
      async end() {},
      async fail() {},
      async withActiveTrace<T>(fn: () => Promise<T>) {
        try {
          return await fn();
        } catch {
          return 'trace-swallowed-application-error' as T;
        }
      },
    };
    const safe = createSafeAgentTracer(
      {
        async startTurn() {
          return delegateSpan;
        },
        async flush() {},
      },
      (code) => diagnostics.push(code),
    );
    const turn = await safe.startTurn({ name: 'agent_turn', inputs: {} });

    await expect(
      turn.withActiveTrace?.(async () => {
        applicationCalls += 1;
        throw applicationError;
      }),
    ).rejects.toBe(applicationError);
    expect(applicationCalls).toBe(1);
    expect(diagnostics).toEqual([]);
  });

  it('maps root and child spans to LangSmith runs without mutating environment configuration', async () => {
    const beforeApiKey = process.env.LANGSMITH_API_KEY;
    const beforeProject = process.env.LANGSMITH_PROJECT;
    let root: FakeLangSmithRun | undefined;
    const tracer = new LangSmithAgentTracer({
      projectName: 'kfc-agentic-proof-test',
      flush: async () => {
        flushCalls += 1;
      },
      createRoot(config) {
        root = new FakeLangSmithRun(config);
        return root;
      },
    });
    let flushCalls = 0;

    const turn = await tracer.startTurn({
      name: 'agent_turn',
      inputs: { scenarioId: 'demo' },
      metadata: { commit: 'abc123' },
      tags: ['agentic-proof'],
    });
    const modelCall = await turn.startSpan({
      name: 'call_model',
      runType: 'llm',
      inputs: { iteration: 1 },
      tags: ['model-attempt'],
    });
    await modelCall.end({ intent: 'ordering' });
    await turn.end({ replyIntent: 'general_reply' });
    expect(root?.outputs).toEqual({ replyIntent: 'general_reply' });
    expect(root?.children[0]?.outputs).toEqual({ intent: 'ordering' });
    expect(flushCalls).toBe(0);
    expect(root).toMatchObject({ posted: false, patched: false });
    expect(root?.children[0]).toMatchObject({ posted: false, patched: false });
    await tracer.flush();

    expect(root?.posted).toBe(true);
    expect(root?.config).toMatchObject({
      name: 'agent_turn',
      run_type: 'chain',
      project_name: 'kfc-agentic-proof-test',
      tags: ['agentic-proof'],
      tracingEnabled: true,
    });
    expect(root?.children).toHaveLength(1);
    expect(root?.children[0]).toMatchObject({
      posted: true,
      patched: true,
      outputs: { intent: 'ordering' },
      config: {
        name: 'call_model',
        run_type: 'llm',
        tags: ['model-attempt'],
      },
    });
    expect(root).toMatchObject({
      patched: true,
      outputs: { replyIntent: 'general_reply' },
    });
    expect(flushCalls).toBe(1);
    expect(process.env.LANGSMITH_API_KEY).toBe(beforeApiKey);
    expect(process.env.LANGSMITH_PROJECT).toBe(beforeProject);
  });

  it('passes ordinary metadata and failures through to custom run adapters', async () => {
    const sentinel = 'CUSTOM-TRACE-SENTINEL-1d9f';
    let root: FakeLangSmithRun | undefined;
    const tracer = new LangSmithAgentTracer({
      projectName: 'kfc-agentic-proof-native-trace-test',
      createRoot(config) {
        root = new FakeLangSmithRun(config);
        return root;
      },
    });
    const metadata = {
      session_id: 'safe-session',
      scenarioId: 'safe-scenario',
      probeRunId: 'safe-probe',
      canonicalScenarioTurnIndex: 15,
      rawEvent: {
        type: 'record',
        count: 1,
        digest: 'a'.repeat(64),
        value: sentinel,
      },
      value: sentinel,
    };
    const turn = await tracer.startTurn({
      name: 'agent_turn',
      inputs: { value: sentinel },
      metadata,
    });
    const child = await turn.startSpan({
      name: 'native_child',
      runType: 'chain',
      inputs: { value: sentinel },
      metadata: { value: sentinel },
    });
    await child.end({ value: sentinel });
    await turn.fail(new Error(sentinel));
    await tracer.flush();

    expect(root?.config.inputs).toEqual({ value: sentinel });
    expect(root?.config.metadata).toEqual(metadata);
    expect(root?.children[0]?.config.inputs).toEqual({ value: sentinel });
    expect(root?.children[0]?.config.metadata).toEqual({ value: sentinel });
    expect(root?.children[0]?.outputs).toEqual({ value: sentinel });
    expect(root?.error).toContain(sentinel);
  });

  it('hands the active LangSmith run to native LangChain callbacks', async () => {
    const tracer = new LangSmithAgentTracer({
      projectName: 'kfc-agentic-proof-test',
      createRoot(config) {
        return new RunTree({ ...config, tracingEnabled: true });
      },
    });
    const turn = await tracer.startTurn({
      name: 'agent_turn',
      inputs: { scenarioId: 'demo' },
    });

    const callbacks = await turn.langchainCallbacks?.();
    expect(
      callbacks &&
        'handlers' in callbacks &&
        callbacks.handlers.some(
          (handler) => handler?.name === 'langchain_tracer',
        ),
    ).toBe(true);
    await turn.withActiveTrace?.(async () => {
      expect(getCurrentRunTree(true)?.name).toBe('agent_turn');
    });
  });

  it('uses native LangSmith transport without custom masking', async () => {
    const sentinel = 'LANGSMITH-NATIVE-SENTINEL-a82dc4';
    const requestBodies: string[] = [];
    const priorTracing = process.env.LANGSMITH_TRACING;
    process.env.LANGSMITH_TRACING = 'true';
    const fetchImplementation: typeof fetch = async (_input, init) => {
      if (init?.body !== undefined && init.body !== null) {
        requestBodies.push(await new Response(init.body).text());
      }
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      const tracer = new LangSmithAgentTracer({
        projectName: 'kfc-agentic-proof-native-trace-test',
        apiKey: 'test-api-key',
        apiUrl: 'https://langsmith.invalid',
        autoBatchTracing: false,
        fetchImplementation,
      });
      const turn = await tracer.startTurn({
        name: 'agent_turn',
        inputs: { value: sentinel },
        metadata: {
          scenarioId: 'safe-scenario',
          canonicalScenarioTurnIndex: 15,
          value: sentinel,
        },
      });
      const child = await turn.startSpan({
        name: 'native_child',
        runType: 'chain',
        inputs: { value: sentinel },
        metadata: { value: sentinel },
      });
      await child.end({ value: sentinel });
      await turn.fail(new Error(sentinel));
      await tracer.flush();
    } finally {
      if (priorTracing === undefined) {
        delete process.env.LANGSMITH_TRACING;
      } else {
        process.env.LANGSMITH_TRACING = priorTracing;
      }
    }

    expect(requestBodies.length).toBeGreaterThan(0);
    expect(requestBodies.join('\n')).toContain(sentinel);
  });
});
