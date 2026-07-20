import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type { AgentTraceSpan, AgentTraceSpanInput, AgentTracer } from '../../src/observability/agentTracing.js';
import {
  ShowcaseService,
  ShowcaseValidationError,
  type ShowcaseScenarioSource,
} from '../../src/showcase/showcase.js';

const scenario = {
  id: 'scenario-01',
  title: 'Order lunch',
  goal: 'Complete a small order',
  useCases: ['UC-01'],
  acceptanceCriteria: ['Wait for confirmation'],
  turns: [
    { index: 1, text: 'Cho mình một combo.', useCases: ['UC-01'] },
    { index: 3, text: 'Xác nhận.', useCases: ['UC-01'] },
  ],
};

class CapturingSpan implements AgentTraceSpan {
  readonly children: CapturingSpan[] = [];
  outputs?: Record<string, unknown>;

  constructor(readonly input: AgentTraceSpanInput) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    const child = new CapturingSpan(input);
    this.children.push(child);
    return child;
  }

  async end(outputs?: Record<string, unknown>): Promise<void> {
    this.outputs = outputs;
  }

  async fail(): Promise<void> {}
}

class CapturingTracer implements AgentTracer {
  readonly roots: CapturingSpan[] = [];
  flushCount = 0;

  async startTurn(input: Omit<AgentTraceSpanInput, 'runType'>): Promise<AgentTraceSpan> {
    const root = new CapturingSpan({ ...input, runType: 'chain' });
    this.roots.push(root);
    return root;
  }

  async flush(): Promise<void> {
    this.flushCount += 1;
  }
}

describe('ShowcaseService', () => {
  it('promotes only a complete fixed-turn replay and preserves it after a failed attempt', async () => {
    const store = new MemoryStore();
    const tracer = new CapturingTracer();
    const source: ShowcaseScenarioSource = {
      async listScenarios() { return [scenario]; },
      async traceUrlForSession() { return 'https://smith.langchain.com/trace/example'; },
    };
    const service = new ShowcaseService({
      source,
      store,
      releaseSha: 'abc123',
      agent: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        profile: 'openai-gpt-4.1-mini',
      },
      tracer,
    });
    const completeSession = 'kfc:showcase_scenario_01_text_complete';
    for (const [index, turn] of scenario.turns.entries()) {
      await store.appendTurn({
        sessionId: completeSession,
        channel: 'kfc',
        role: 'user',
        text: turn.text,
        externalMessageId: `user_${index}`,
        externalUserId: 'showcase_scenario_01_text_complete',
        deliveryStatus: 'received',
        metadata: { responseProfile: 'social' },
      });
      await store.appendTurn({
        sessionId: completeSession,
        channel: 'kfc',
        role: 'assistant',
        text: `AI ${index + 1}`,
        externalMessageId: null,
        externalUserId: 'showcase_scenario_01_text_complete',
        deliveryStatus: 'sent',
        metadata: { responseProfile: 'social' },
      });
    }

    const promoted = await service.complete({ scenarioId: scenario.id, mode: 'text', sessionId: completeSession });
    expect(promoted).toMatchObject({
      releaseSha: 'abc123',
      agent: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        profile: 'openai-gpt-4.1-mini',
      },
      langsmithTraceUrl: 'https://smith.langchain.com/trace/example',
    });
    expect(tracer.flushCount).toBe(1);
    expect(tracer.roots).toHaveLength(1);
    expect(tracer.roots[0]).toMatchObject({
      input: {
        name: 'showcase_replay',
        metadata: {
          session_id: completeSession,
          scenarioId: scenario.id,
          showcaseMode: 'text',
          releaseSha: 'abc123',
          agentProvider: 'openai',
          agentModel: 'gpt-4.1-mini',
          agentProfile: 'openai-gpt-4.1-mini',
        },
      },
      outputs: { status: 'completed', turnCount: 2 },
    });
    expect(tracer.roots[0]?.children.map((child) => ({ input: child.input, outputs: child.outputs }))).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ name: 'showcase_turn', inputs: expect.objectContaining({ text: scenario.turns[0]!.text }) }), outputs: expect.objectContaining({ text: 'AI 1' }) }),
      expect.objectContaining({ input: expect.objectContaining({ name: 'showcase_turn', inputs: expect.objectContaining({ text: scenario.turns[1]!.text }) }), outputs: expect.objectContaining({ text: 'AI 2' }) }),
    ]);

    const incompleteSession = 'kfc:showcase_scenario_01_text_incomplete';
    await store.appendTurn({
      sessionId: incompleteSession,
      channel: 'kfc',
      role: 'user',
      text: scenario.turns[0]!.text,
      externalMessageId: 'incomplete_1',
      externalUserId: 'showcase_scenario_01_text_incomplete',
      deliveryStatus: 'received',
      metadata: { responseProfile: 'social' },
    });
    await expect(service.complete({ scenarioId: scenario.id, mode: 'text', sessionId: incompleteSession }))
      .rejects.toEqual(expect.objectContaining<Partial<ShowcaseValidationError>>({ code: 'showcase_replay_incomplete' }));
    expect(tracer.roots).toHaveLength(1);
    expect((await service.catalog()).scenarios[0]?.results.text?.sessionId).toBe(completeSession);
  });
});
