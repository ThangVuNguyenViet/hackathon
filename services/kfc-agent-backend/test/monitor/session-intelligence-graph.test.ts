import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('monitor intelligence graph events', () => {
  it('emits deterministic intelligence after verified business events', async () => {
    const sessionId = 'session-monitor-graph';
    const dashboard = new DashboardEventBus();
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'filtered', query: 'combo' , purpose: 'browse'},
      }])
      .respondWithTools([{
        name: 'updateCart',
        args: {
          changes: [{
            itemCode: '20751',
            quantity: 1,
            modifiers: [],
          }],
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The verified item is in your cart.',
        evidenceReferences: [{
          evidenceId: 'cart',
          claimKinds: ['product'],
        }],
      }));

    await runAgentTurn({
      sessionId,
      customerId: 'customer-1',
      channel: 'kfc',
      text: 'Add a combo',
      externalMessageId: 'monitor-graph-message',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard,
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    const events = dashboard.getEvents(sessionId);
    const eventTypes = events.map((event) => event.type);
    const cartChangedIndex = eventTypes.indexOf('cart_changed');
    const intelligenceIndex = eventTypes.indexOf(
      'session_intelligence_updated',
    );
    const assistantTurnIndex = events.findIndex(
      (event) =>
        event.type === 'conversation_turn_created' &&
        event.payload.role === 'assistant',
    );

    expect(cartChangedIndex).toBeGreaterThanOrEqual(0);
    expect(assistantTurnIndex).toBeGreaterThan(cartChangedIndex);
    expect(intelligenceIndex).toBeGreaterThan(assistantTurnIndex);
    expect(events[intelligenceIndex]?.payload).toMatchObject({
      sessionIntelligence: {
        schemaVersion: 1,
        orderStage: 'fulfillment_pending',
        aiAutomationConfidencePercent: 65,
        riskLevel: 'medium',
        reasons: expect.arrayContaining([
          'cart_verified',
          'missing_fulfillment',
        ]),
        evidence: {
          dashboardEventTypes: expect.arrayContaining(['cart_changed']),
          toolNames: expect.arrayContaining(['searchMenu', 'updateCart']),
        },
        source: 'runtime_rule_fallback',
      },
    });
  });
});
