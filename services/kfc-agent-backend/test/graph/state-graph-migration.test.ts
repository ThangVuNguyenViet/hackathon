import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { agentTurnGraph, type AgentTurnInput } from '../../src/graph/buildGraph.js';
import { graphNodeNames } from '../../src/graph/nodes.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { createNoopAgentTracer } from '../../src/observability/agentTracing.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('StateGraph migration', () => {
  it('exposes the real turn topology for LangSmith Studio', () => {
    const graph = agentTurnGraph.getGraph().toJSON();
    const nodeIds = graph.nodes.map((node: { id: string }) => node.id);
    const edges = graph.edges.map((edge: { source: string; target: string; conditional?: boolean }) => ({
      source: edge.source,
      target: edge.target,
      conditional: edge.conditional,
    }));

    expect(nodeIds).toEqual(expect.arrayContaining(['__start__', ...graphNodeNames, '__end__']));
    expect(edges).toEqual(expect.arrayContaining([
      { source: '__start__', target: 'load_context', conditional: false },
      { source: 'load_context', target: 'classify_turn', conditional: false },
      { source: 'classify_turn', target: 'route_turn', conditional: false },
      { source: 'route_turn', target: 'social_response', conditional: true },
      { source: 'route_turn', target: 'structured_action', conditional: true },
      { source: 'route_turn', target: 'plan_tools', conditional: true },
      { source: 'execute_tools', target: 'enforce_invariants', conditional: false },
      { source: 'enforce_invariants', target: 'compose_response', conditional: false },
      { source: 'compose_response', target: 'persist_turn', conditional: false },
      { source: 'persist_turn', target: 'monitor', conditional: false },
      { source: 'monitor', target: '__end__', conditional: false },
    ]));
  });

  it('executes a social turn through StateGraph nodes without entering commerce', async () => {
    const route = vi.fn().mockResolvedValue({
      decision: 'handle_social',
      responseText: 'Xin chào từ social node',
    });
    const input: AgentTurnInput = {
      sessionId: 'kfc:state_graph_social',
      customerId: 'state_graph_customer',
      channel: 'kfc',
      text: 'Xin chào',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      smallTalkRouter: { route },
      toolPlanner: {
        async plan() {
          throw new Error('commerce planner must not run for the social branch');
        },
      },
    };
    const turnTrace = await createNoopAgentTracer().startTurn({
      name: 'state_graph_test',
      inputs: {},
    });
    const updates: Array<Record<string, unknown>> = [];

    for await (const update of await agentTurnGraph.stream(
      {
        sessionId: input.sessionId,
        customerId: input.customerId,
        channel: input.channel,
        text: input.text,
      },
      {
        streamMode: 'updates',
        configurable: {
          agentTurnInput: input,
          agentTurnTrace: turnTrace,
        },
      },
    )) {
      updates.push(update as Record<string, unknown>);
    }

    expect(updates.map((update) => Object.keys(update)[0])).toEqual([
      'load_context',
      'classify_turn',
      'route_turn',
      'social_response',
      'manage_journey',
      'execute_tools',
      'enforce_invariants',
      'compose_response',
      'persist_turn',
      'monitor',
    ]);
    expect(updates.some((update) => 'plan_tools' in update || 'structured_action' in update)).toBe(false);
    expect(updates.find((update) => 'social_response' in update)).toMatchObject({
      social_response: {
        responseSpec: {
          fallbackText: 'Xin chào từ social node',
          replyIntent: 'general_reply',
        },
      },
    });
    expect(updates.find((update) => 'compose_response' in update)).toMatchObject({
      compose_response: {
        output: {
          responseText: 'Xin chào từ social node',
          replyIntent: 'general_reply',
        },
      },
    });
  });

  it('keeps planning, tool execution, composition, and persistence in separate nodes', async () => {
    const store = new MemoryStore();
    const observations: string[] = [];
    const input: AgentTurnInput = {
      sessionId: 'kfc:state_graph_commerce',
      customerId: 'state_graph_customer',
      channel: 'kfc',
      text: 'Pepsi',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      observeRun: async (observation) => { observations.push(observation.kind); },
      toolPlanner: {
        supportsMultiStep: true,
        async plan() {
          return {
            intent: 'ordering' as const,
            entities: { itemText: 'Pepsi', asksClarification: true },
            contextPolicy: { menuSearchResults: 'active' as const },
            toolCalls: [{ toolName: 'searchMenu' as const, arguments: { query: 'Pepsi' } }],
            responseClaims: [],
          };
        },
      },
    };
    const turnTrace = await createNoopAgentTracer().startTurn({ name: 'state_graph_test', inputs: {} });
    const updates: Array<Record<string, any>> = [];

    for await (const update of await agentTurnGraph.stream(
      { sessionId: input.sessionId, customerId: input.customerId, channel: input.channel, text: input.text },
      {
        streamMode: 'updates',
        configurable: { agentTurnInput: input, agentTurnTrace: turnTrace },
      },
    )) updates.push(update as Record<string, any>);

    const planned = updates.find((update) => 'plan_tools' in update)!.plan_tools;
    const executed = updates.find((update) => 'execute_tools' in update)!.execute_tools;
    const composed = updates.find((update) => 'compose_response' in update)!.compose_response;
    const persisted = updates.find((update) => 'persist_turn' in update)!.persist_turn;
    expect(planned.naturalLanguagePlan.toolCalls).toEqual([
      expect.objectContaining({ toolName: 'searchMenu' }),
    ]);
    expect(planned.responseSpec).toBeUndefined();
    expect(executed.responseSpec.currentTurnToolTrace).toEqual([
      expect.objectContaining({ toolName: 'searchMenu', ok: true }),
    ]);
    expect(executed.output).toBeUndefined();
    expect(composed.output.responseText).toEqual(expect.any(String));
    expect(composed.output.assistantTurnId).toBeUndefined();
    expect(persisted.output.assistantTurnId).toEqual(expect.any(String));
    expect((await store.listTurns(input.sessionId)).filter((turn) => turn.role === 'assistant')).toHaveLength(1);
    expect(observations).toEqual(expect.arrayContaining(['planning', 'tool', 'response_composition']));
  });
});
