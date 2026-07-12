import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { ToolPlannerInput } from '../../src/llm/toolPlanner.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type { ResponseComposerInput } from '../../src/llm/responseComposer.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('agent response modes', () => {
  it('keeps the full tool catalog and verified behavior identical across surfaces', async () => {
    const fixtures = createTestFixtures();
    const availableToolsByMode: string[][] = [];

    const createPlanner = () => ({
      supportsMultiStep: false,
      async plan(input: ToolPlannerInput) {
        availableToolsByMode.push(input.availableTools);
        return {
          intent: 'ordering' as const,
          contextPolicy: { menuSearchResults: 'active' as const },
          entities: {},
          toolCalls: [{ toolName: 'searchMenu' as const, arguments: { query: 'gà' } }],
          responseClaims: [],
          directResponse: 'Mình đã tìm các món phù hợp trong menu đã xác minh.',
        };
      },
    });

    const kfcOutput = await runAgentTurn({
      sessionId: 'kfc:response_mode',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Cho mình vài món gà',
      clients: createMockClients(fixtures),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: createPlanner(),
    });
    const messengerOutput = await runAgentTurn({
      sessionId: 'messenger_mock:response_mode',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình vài món gà',
      clients: createMockClients(fixtures),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: createPlanner(),
    });

    expect(availableToolsByMode).toEqual([toolNames, toolNames]);
    expect(kfcOutput.responseType).toBe('genui');
    expect(kfcOutput.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(messengerOutput.responseType).toBe('text');
    expect(messengerOutput.genUi).toBeUndefined();
    expect(kfcOutput.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(messengerOutput.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
  });

  it.each(['messenger', 'zalo'] as const)(
    'composes a standalone verified text plan for %s without persisting hidden GenUI',
    async (channel) => {
      const store = new MemoryStore();
      const composerInputs: ResponseComposerInput[] = [];
      const output = await runAgentTurn({
        sessionId: `${channel}:verified_text_plan`,
        customerId: 'customer_1',
        channel,
        text: 'Cho mình xem combo 99K',
        clients: createMockClients(createTestFixtures()),
        store,
        dashboard: new DashboardEventBus(),
        toolPlanner: {
          supportsMultiStep: false,
          async plan() {
            return {
              intent: 'ordering' as const,
              contextPolicy: { menuSearchResults: 'active' as const },
              entities: {},
              toolCalls: [{ toolName: 'searchMenu' as const, arguments: { query: 'Combo Hợp Gu 99K' } }],
              responseClaims: [],
              directResponse: 'Mình đã tìm thấy combo phù hợp.',
            };
          },
        },
        responseComposer: {
          async composeResponse(input) {
            composerInputs.push(input);
            const menuFact = input.verifiedPlan.facts.find((fact) => fact.kind === 'menu_choices');
            const firstItem = menuFact?.kind === 'menu_choices' ? menuFact.items[0] : undefined;
            return `${firstItem?.name}: ${firstItem?.priceVnd.toLocaleString('vi-VN')}đ.`;
          },
        },
      });

      expect(composerInputs).toHaveLength(1);
      expect(composerInputs[0]?.verifiedPlan).toMatchObject({
        responseMode: 'text',
        presentation: 'standalone_text',
        structuredUiAvailable: false,
      });
      expect(composerInputs[0]?.verifiedPlan.facts).toContainEqual(
        expect.objectContaining({ kind: 'menu_choices' }),
      );
      expect(output.responseType).toBe('text');
      expect(output.responseText).toContain('99.000đ');
      expect(output.genUi).toBeUndefined();
      const assistantTurn = (await store.listTurns(`${channel}:verified_text_plan`)).at(-1);
      expect(assistantTurn?.metadata).toBeNull();
    },
  );
});
