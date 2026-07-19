import { describe, expect, it } from 'vitest';
import { RunTree } from 'langsmith';
import { getCurrentRunTree } from 'langsmith/traceable';
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
    this.events.push({ phase: 'start', name: input.name, payload: input.inputs });
    return new CapturingSpan(input.name, this.events);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    this.events.push({ phase: 'end', name: this.name, payload: outputs });
  }

  async fail(error: unknown): Promise<void> {
    this.events.push({
      phase: 'fail',
      name: this.name,
      payload: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

class CapturingAgentTracer implements AgentTracer {
  readonly events: CapturedEvent[] = [];

  async startTurn(input: Omit<AgentTraceSpanInput, 'runType'>): Promise<AgentTraceSpan> {
    this.events.push({ phase: 'start', name: input.name, payload: input.inputs });
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
    const turn = await capture.startTurn({ name: 'agent_turn', inputs: { sessionId: 'demo' } });
    const planner = await turn.startSpan({
      name: 'planner_iteration',
      runType: 'llm',
      inputs: { iteration: 1 },
    });

    await planner.end({ intent: 'cart_edit' });
    await turn.end({ replyIntent: 'general_reply' });

    expect(capture.events.map((event) => `${event.phase}:${event.name}`)).toEqual([
      'start:agent_turn',
      'start:planner_iteration',
      'end:planner_iteration',
      'end:agent_turn',
    ]);
  });

  it('provides a no-op tracer that accepts nested spans', async () => {
    const tracer = createNoopAgentTracer();
    const turn = await tracer.startTurn({ name: 'agent_turn', inputs: {} });
    const tool = await turn.startSpan({ name: 'tool_call:updateCart', runType: 'tool', inputs: {} });

    await tool.end({ ok: true });
    await turn.end({ responseText: 'ok' });
    await tracer.flush();
  });

  it('swallows delegate start failures and reports a stable local diagnostic', async () => {
    const diagnostics: string[] = [];
    const safe = createSafeAgentTracer(new ThrowingAgentTracer(), (code) => diagnostics.push(code));

    const turn = await safe.startTurn({ name: 'agent_turn', inputs: {} });
    const tool = await turn.startSpan({ name: 'tool_call:updateCart', runType: 'tool', inputs: {} });
    await tool.end({ ok: true });
    await turn.end({ responseText: 'still delivered' });
    await safe.flush();

    expect(diagnostics).toEqual(['agent_trace_start_failed', 'agent_trace_flush_failed']);
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
    const planner = await turn.startSpan({
      name: 'planner_iteration',
      runType: 'llm',
      inputs: { iteration: 1 },
    });
    await planner.end({ intent: 'ordering' });
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
    });
    expect(root?.children).toHaveLength(1);
    expect(root?.children[0]).toMatchObject({
      posted: true,
      patched: true,
      outputs: { intent: 'ordering' },
      config: { name: 'planner_iteration', run_type: 'llm' },
    });
    expect(root).toMatchObject({ patched: true, outputs: { replyIntent: 'general_reply' } });
    expect(flushCalls).toBe(1);
    expect(process.env.LANGSMITH_API_KEY).toBe(beforeApiKey);
    expect(process.env.LANGSMITH_PROJECT).toBe(beforeProject);
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
      callbacks && 'handlers' in callbacks &&
        callbacks.handlers.some((handler) => handler?.name === 'langchain_tracer'),
    ).toBe(true);
    await turn.withActiveTrace?.(async () => {
      expect(getCurrentRunTree(true)?.name).toBe('agent_turn');
    });
  });
});
