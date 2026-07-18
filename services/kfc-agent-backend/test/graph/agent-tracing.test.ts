import { describe, expect, it, vi } from 'vitest';
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
  it('reuses the safe fallback for a verified planner clarification without a second AI call', async () => {
    const composeResponse = vi.fn().mockResolvedValue('unnecessary composer reply');

    const output = await runAgentTurn({
      sessionId: 'kfc:agent_trace_planner_clarification',
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'ambiguous reference',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        entities: { asksClarification: true },
        toolCalls: [],
        responseClaims: [],
      }),
      responseComposer: { composeResponse },
    });

    expect(output.responseText).toBeTruthy();
    expect(output.state.entities?.asksClarification).toBe(true);
    expect(composeResponse).not.toHaveBeenCalled();
  });

  it('returns the model-written social reply without planner, composer, or GenUI', async () => {
    const tracer = new CaptureTracer();
    const route = vi.fn().mockResolvedValue({ decision: 'handle_social', responseText: 'model social reply' });
    const plan = vi.fn().mockResolvedValue({
      intent: 'ordering',
      contextPolicy: {},
      entities: {},
      toolCalls: [],
      responseClaims: [],
    });
    const composeResponse = vi.fn().mockResolvedValue('composer reply');

    const output = await runAgentTurn({
      sessionId: 'kfc:agent_trace_social_fast_path',
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'social router input',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      tracer,
      smallTalkRouter: { route },
      toolPlanner: { supportsMultiStep: false, plan },
      responseComposer: { composeResponse },
    });

    expect(output.responseText).toBe('model social reply');
    expect(output.state.entities).toEqual({ smallTalk: true, suppressGenUi: true });
    expect(route).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
    expect(composeResponse).not.toHaveBeenCalled();
    expect(output.genUi).toBeUndefined();
    expect(tracer.started('small_talk_router')?.payload).toEqual({
      routerInput: {
        latestUserMessage: 'social router input',
        channel: 'kfc',
        hasStructuredAction: false,
      },
    });
    expect(tracer.completed('small_talk_router')?.payload).toEqual({
      routerOutput: { decision: 'handle_social', responseText: 'model social reply' },
    });
    expect(tracer.started('planner_iteration')).toBeUndefined();
    expect(tracer.started('response_compose')).toBeUndefined();
  });

  it('continues to the existing planner and tool path when the router rejects the turn', async () => {
    const tracer = new CaptureTracer();
    const route = vi.fn().mockResolvedValue({ decision: 'continue_to_planner' });
    const plan = vi.fn().mockResolvedValue({
      intent: 'ordering',
      contextPolicy: {},
      entities: { itemText: 'Combo Hợp Gu 99K', cartMutationConfirmed: true },
      toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
      responseClaims: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:agent_trace_router_commerce',
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'commerce router input',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      tracer,
      smallTalkRouter: { route },
      toolPlanner: { supportsMultiStep: false, plan },
    });

    expect(route).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(output.state.cart?.items.map((item) => item.itemCode)).toEqual(['20751']);
    expect(tracer.started('planner_iteration')).toBeDefined();
    expect(tracer.completed('tool_call:updateCart')?.payload).toMatchObject({ ok: true });
  });

  it('records router failures and continues to the planner', async () => {
    const store = new MemoryStore();
    const plan = vi.fn().mockResolvedValue({
      intent: 'unclear',
      contextPolicy: {},
      entities: {},
      toolCalls: [],
      responseClaims: [],
    });

    await runAgentTurn({
      sessionId: 'kfc:agent_trace_router_failure',
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'router failure input',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      smallTalkRouter: {
        async route() {
          throw new Error('router unavailable');
        },
      },
      toolPlanner: { supportsMultiStep: false, plan },
    });

    expect(plan).toHaveBeenCalledTimes(1);
    expect(await store.listEvents('kfc:agent_trace_router_failure')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'llm:small_talk_router_failed',
          payload: { message: 'router unavailable' },
        }),
      ]),
    );
  });

  it('starts routing before the context turn list finishes loading', async () => {
    let startContextLoad!: () => void;
    let releaseContextLoad!: () => void;
    const contextLoadStarted = new Promise<void>((resolve) => {
      startContextLoad = resolve;
    });
    const contextLoadReleased = new Promise<void>((resolve) => {
      releaseContextLoad = resolve;
    });
    class ContextGatedMemoryStore extends MemoryStore {
      override async listTurns(sessionId: string) {
        startContextLoad();
        await contextLoadReleased;
        return super.listTurns(sessionId);
      }
    }
    const route = vi.fn().mockResolvedValue({ decision: 'continue_to_planner' });
    const store = new ContextGatedMemoryStore();

    const turnPromise = runAgentTurn({
      sessionId: 'kfc:agent_trace_router_concurrent',
      customerId: 'agent_trace_customer',
      channel: 'kfc',
      text: 'overlap input',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      smallTalkRouter: { route },
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });
    await contextLoadStarted;

    expect(route).toHaveBeenCalledTimes(1);
    releaseContextLoad();
    await turnPromise;
  });

  it('continues after item discovery when the user explicitly asks to add a named item', async () => {
    const plans: ToolPlannerOutput[] = [
      {
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: { cartMutationRequested: true },
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: { cartMutationConfirmed: true },
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
        contextPolicy: { cart: 'active', fulfillment: 'active', recentTurns: 'active' },
        entities: {
          asksClarification: true,
          fulfillmentMethod: 'delivery',
          preferFulfillmentSurface: true,
        },
        toolCalls: [],
        responseClaims: [],
      }),
      responseComposer: {
        async composeResponse() {
          return 'Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình tiếp tục nhé.';
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

  it('executes a destructive cart edit only when the planner confirms it', async () => {
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
        entities: { cartMutationRequested: true, cartMutationConfirmed: true },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
        responseClaims: [],
      }),
    });

    expect(output.state.cart?.items).toEqual([]);
    expect(tracer.completed('tool_call:updateCart')?.payload).toMatchObject({ ok: true });
  });
});
