import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { WorkflowRoute } from '../../src/domain/workflow.js';
import type { ToolPlannerInput, ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { runAgentTurn } from '../fixtures/runAgentTurn.js';

const clarificationPlan: ToolPlannerOutput = {
  intent: 'unclear',
  entities: { asksClarification: true },
  toolCalls: [],
  responseClaims: [],
};

describe('workflow-routed agent graph', () => {
  it('uses one workflow router call and scopes tools plus planning context', async () => {
    const clients = createMockClients(createTestFixtures());
    const fulfillmentContext = vi.spyOn(clients.fulfillment, 'getPlanningContext');
    const workflowRoute = vi.fn(async (): Promise<WorkflowRoute> => ({
      primaryWorkflows: ['catalog_cart'],
      capabilities: ['membership'],
      needsClarification: false,
    }));
    const smallTalkRoute = vi.fn();
    let plannerInput: ToolPlannerInput | undefined;

    await runAgentTurn({
      sessionId: 'kfc:workflow_scope',
      customerId: 'workflow_scope',
      channel: 'kfc',
      text: 'Help with my menu and membership',
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      workflowRouter: { route: workflowRoute },
      smallTalkRouter: { route: smallTalkRoute },
      toolPlanner: {
        async plan(input) {
          plannerInput = input;
          return clarificationPlan;
        },
      },
    }, 'Bạn muốn mình hỗ trợ phần menu hay thành viên trước?');

    expect(workflowRoute).toHaveBeenCalledOnce();
    expect(smallTalkRoute).not.toHaveBeenCalled();
    expect(fulfillmentContext).not.toHaveBeenCalled();
    expect(plannerInput?.availableTools).toEqual(expect.arrayContaining([
      'searchMenu',
      'updateCart',
      'getMembershipProfile',
      'listMembershipRewards',
    ]));
    expect(plannerInput?.availableTools).not.toEqual(expect.arrayContaining([
      'quoteFulfillment',
      'placeOrder',
      'getOrderStatus',
      'handoff',
    ]));
  });

  it('uses no tools or provider planning context when routing fails without trusted state', async () => {
    const clients = createMockClients(createTestFixtures());
    const menuContext = vi.spyOn(clients.menu, 'getPlanningContext');
    const fulfillmentContext = vi.spyOn(clients.fulfillment, 'getPlanningContext');
    const store = new MemoryStore();
    let plannerInput: ToolPlannerInput | undefined;

    await runAgentTurn({
      sessionId: 'kfc:workflow_failure',
      customerId: 'workflow_failure',
      channel: 'kfc',
      text: 'Ambiguous request',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      workflowRouter: {
        async route() {
          throw new Error('router unavailable');
        },
      },
      toolPlanner: {
        async plan(input) {
          plannerInput = input;
          return clarificationPlan;
        },
      },
    }, 'Bạn nói rõ phần mình cần hỗ trợ nhé.');

    expect(plannerInput?.availableTools).toEqual([]);
    expect(menuContext).not.toHaveBeenCalled();
    expect(fulfillmentContext).not.toHaveBeenCalled();
    expect(await store.listEvents('kfc:workflow_failure')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'llm:workflow_router_failed',
        payload: expect.objectContaining({
          fallback: {
            primaryWorkflows: [],
            capabilities: [],
            needsClarification: true,
          },
        }),
      }),
    ]));
  });
});
