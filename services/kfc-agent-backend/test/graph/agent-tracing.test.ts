import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Cart } from '../../src/domain/types.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type { AgentTraceSpan, AgentTraceSpanInput, AgentTracer } from '../../src/observability/agentTracing.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

interface TraceEvent {
  phase: 'start' | 'end' | 'fail';
  name: string;
  payload: Record<string, unknown>;
}

class CaptureSpan implements AgentTraceSpan {
  constructor(
    private readonly name: string,
    private readonly events: TraceEvent[],
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    this.events.push({ phase: 'start', name: input.name, payload: input.inputs });
    return new CaptureSpan(input.name, this.events);
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

class CaptureTracer implements AgentTracer {
  readonly events: TraceEvent[] = [];

  async startTurn(input: Omit<AgentTraceSpanInput, 'runType'>): Promise<AgentTraceSpan> {
    this.events.push({ phase: 'start', name: input.name, payload: input.inputs });
    return new CaptureSpan(input.name, this.events);
  }

  async flush(): Promise<void> {}

  completed(name: string): TraceEvent | undefined {
    return this.events.find((event) => event.phase === 'end' && event.name === name);
  }

  started(name: string): TraceEvent | undefined {
    return this.events.find((event) => event.phase === 'start' && event.name === name);
  }
}

function existingCart(): Cart {
  return {
    id: 'cart_agent_trace',
    items: [{ itemCode: '20751', name: 'Combo Hợp Gu 99K', quantity: 1, unitPriceVnd: 99000 }],
    subtotalVnd: 99000,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 99000,
    voucherCode: null,
  };
}

async function seedCart(store: MemoryStore, sessionId: string): Promise<void> {
  await store.appendEvent(sessionId, 'graph:verified_state', {
    verifiedState: { cart: existingCart(), toolTrace: [] },
  });
}

function planner(output: ToolPlannerOutput) {
  return {
    supportsMultiStep: false,
    async plan(): Promise<ToolPlannerOutput> {
      return output;
    },
  };
}

describe('agent turn tracing', () => {
  it('continues after item discovery when the user explicitly asks to add a named item', async () => {
    const plans: ToolPlannerOutput[] = [
      {
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
        responseClaims: [],
      },
    ];

    const output = await runAgentTurn({
      sessionId: 'kfc:agent_trace_explicit_add',
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'Cho mình 1 Combo Hợp Gu 99K.',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      tracer: new CaptureTracer(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan() {
          return plans.shift() ?? {
            intent: 'ordering',
            contextPolicy: {},
            entities: {},
            toolCalls: [],
            responseClaims: [],
          };
        },
      },
    });

    expect(output.state.cart?.items.map((item) => item.itemCode)).toEqual(['20751']);
  });

  it('keeps the next missing address step in an explicit cart-continuation reply', async () => {
    const sessionId = 'kfc:agent_trace_cart_continuation';
    const store = new MemoryStore();
    await seedCart(store, sessionId);

    const output = await runAgentTurn({
      sessionId,
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'tiếp tục đơn này',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      metadata: { rawEvent: { contextPolicy: { cart: 'active', recentTurns: 'active' } } },
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', recentTurns: 'active' },
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
      responseComposer: {
        async composeResponse() {
          return 'Mình tiếp tục hỗ trợ giỏ hiện tại. Bạn muốn làm gì tiếp?';
        },
      },
    });

    expect(output.responseText.toLowerCase()).toContain('địa chỉ');
  });

  it('does not infer a human handoff from phrase matching when the planner is unavailable', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:agent_trace_explicit_handoff',
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'gặp nhân viên về giỏ hiện tại',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      tracer: new CaptureTracer(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan() {
          throw new Error('planner unavailable');
        },
      },
    });

    expect(output.state.handoff).toBeUndefined();
    expect(output.state.toolTrace ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: 'handoff' })]),
    );
    expect(output.replyIntent).toBe('ask_clarification');
  });

  it('records full planner and composer inputs and outputs for production diagnosis', async () => {
    const tracer = new CaptureTracer();
    const output = await runAgentTurn({
      sessionId: 'kfc:agent_trace_full_payload',
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'Cho mình xem menu gà',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      tracer,
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'gà' } }],
        responseClaims: [],
      }),
      responseComposer: {
        async composeResponse() {
          return 'Mình đã tìm các món gà để bạn chọn.';
        },
      },
    });

    expect(tracer.started('agent_turn')?.payload).toMatchObject({
      sessionId: 'kfc:agent_trace_full_payload',
      customerId: 'agent_trace_customer',
      latestUserMessage: 'Cho mình xem menu gà',
    });
    expect(tracer.started('planner_iteration')?.payload).toMatchObject({
      plannerInput: {
        state: { latestUserMessage: 'Cho mình xem menu gà' },
      },
    });
    expect(tracer.completed('planner_iteration')?.payload).toMatchObject({
      plannerOutput: {
        intent: 'ordering',
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'gà' } }],
      },
    });
    expect(tracer.started('response_compose')?.payload).toMatchObject({
      composerInput: {
        state: { latestUserMessage: 'Cho mình xem menu gà' },
      },
    });
    expect(tracer.completed('response_compose')?.payload).toMatchObject({
      responseText: output.responseText,
    });
  });

  it('traces an ambiguous destructive cart edit as blocked without executing the tool', async () => {
    const sessionId = 'kfc:agent_trace_ambiguous_cart';
    const store = new MemoryStore();
    const tracer = new CaptureTracer();
    await seedCart(store, sessionId);

    const output = await runAgentTurn({
      sessionId,
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'bỏ món đó',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      tracer,
      toolPlanner: planner({
        intent: 'cart_edit',
        contextPolicy: { cart: 'confirm_before_use', recentTurns: 'active' },
        entities: { asksClarification: true, cartMutationConfirmed: false },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
        responseClaims: [],
        directResponse: 'Bạn muốn bỏ Combo Hợp Gu 99K đúng không?',
      }),
    });

    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.state.cart?.items).toHaveLength(1);
    expect(tracer.completed('planner_iteration')?.payload).toMatchObject({
      intent: 'cart_edit',
      proposedToolNames: ['updateCart'],
    });
    expect(tracer.completed('policy_gate')?.payload).toMatchObject({
      allowedToolNames: [],
      blockedReasons: ['cart_mutation_confirmation_required'],
    });
    expect(tracer.events.some((event) => event.name === 'tool_call:updateCart')).toBe(false);
    expect(tracer.completed('agent_turn')?.payload).toMatchObject({ replyIntent: 'ask_clarification' });
  });

  it('traces an allowed cart mutation through policy, tool, state, and response stages', async () => {
    const sessionId = 'kfc:agent_trace_named_cart';
    const store = new MemoryStore();
    const tracer = new CaptureTracer();
    await seedCart(store, sessionId);

    const output = await runAgentTurn({
      sessionId,
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'bỏ Combo Hợp Gu 99K',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      tracer,
      toolPlanner: planner({
        intent: 'cart_edit',
        contextPolicy: { cart: 'active' },
        entities: { cartMutationConfirmed: true },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
        responseClaims: [],
        directResponse: 'Mình đã bỏ Combo Hợp Gu 99K khỏi giỏ hàng.',
      }),
    });

    expect(output.state.cart?.items).toEqual([]);
    expect(tracer.completed('policy_gate')?.payload).toMatchObject({
      allowedToolNames: ['updateCart'],
      blockedReasons: [],
    });
    expect(tracer.completed('tool_call:updateCart')?.payload).toMatchObject({ ok: true });
    expect(tracer.completed('state_update')?.payload).toMatchObject({
      toolName: 'updateCart',
      after: { cartItems: [] },
    });
    expect(tracer.completed('session_intelligence')?.payload).toMatchObject({
      customerTurnCount: 1,
    });
    expect(tracer.completed('response_compose')).toBeUndefined();
    expect(tracer.completed('agent_turn')?.payload).toMatchObject({
      replyIntent: 'general_reply',
      responseText: output.responseText,
    });
  });

  it('infers destructive-cart confirmation when the user names an item already in the cart', async () => {
    const sessionId = 'kfc:agent_trace_named_cart_inferred';
    const store = new MemoryStore();
    const tracer = new CaptureTracer();
    await seedCart(store, sessionId);

    const output = await runAgentTurn({
      sessionId,
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'Bỏ Combo Hợp Gu 99K.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      tracer,
      toolPlanner: planner({
        intent: 'cart_edit',
        contextPolicy: { cart: 'active', recentTurns: 'active' },
        entities: { cartMutationRequested: true },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.cart?.items).toEqual([]);
    expect(tracer.completed('tool_call:updateCart')?.payload).toMatchObject({ ok: true });
  });
});
