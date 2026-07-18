import { describe, expect, it } from 'vitest';
import { customerCommandFromVerifiedAction } from '../../src/domain/customerCommand.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../fixtures/runAgentTurn.js';
import type { ToolPlanner, ToolPlannerInput, ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

class RecordingMenuPlanner implements ToolPlanner {
  inputs: ToolPlannerInput[] = [];

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    this.inputs.push(input);
    return {
      intent: 'ordering',
      contextPolicy: { menuSearchResults: 'active' },
      entities: { keepMenuSurface: true },
      toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
      responseClaims: [],
      directResponse: 'Mình đã tìm thấy lựa chọn phù hợp.',
    };
  }
}

describe('response profile isolation', () => {
  it('keeps commerce outcomes equivalent while emitting profile-exclusive presentations', async () => {
    const fixtures = createTestFixtures();
    const kfcPlanner = new RecordingMenuPlanner();
    const socialPlanner = new RecordingMenuPlanner();
    const kfcStore = new MemoryStore();
    const socialStore = new MemoryStore();
    const common = {
      text: 'Cho mình xem Combo Hợp Gu 99K',
      clients: createMockClients(fixtures),
      dashboard: new DashboardEventBus(),
    };

    const kfc = await runAgentTurn({
      ...common,
      sessionId: 'kfc:profile_parity',
      customerId: 'profile_parity',
      channel: 'kfc',
      store: kfcStore,
      toolPlanner: kfcPlanner,
      responseComposer: {
        async composeResponse() { return 'Mình đã tìm thấy lựa chọn phù hợp.'; },
        async composeGenUiCompanion() { return 'Mình đã tìm thấy lựa chọn phù hợp.'; },
      },
    });
    const social = await runAgentTurn({
      ...common,
      sessionId: 'messenger:profile_parity',
      customerId: 'profile_parity',
      channel: 'messenger',
      store: socialStore,
      toolPlanner: socialPlanner,
      responseComposer: {
        async composeResponse() { return 'Combo Hợp Gu 99K có giá 99.000đ. Bạn muốn chọn món này không?'; },
        async composeStandaloneSocial() { return 'Combo Hợp Gu 99K có giá 99.000đ. Bạn muốn chọn món này không?'; },
      },
    });

    expect(kfc.state.menuSearchResults).toEqual(social.state.menuSearchResults);
    expect(kfc.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(social.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(kfc.presentation.profile).toBe('genui');
    expect(kfc.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(social.presentation.profile).toBe('social');
    expect(social.genUi).toBeUndefined();
    expect((await socialStore.listTurns('messenger:profile_parity')).at(-1)?.metadata?.genUi).toBeUndefined();
  });

  it('keeps the shared planner channel-blind and excludes assistant presentation prose', async () => {
    const planner = new RecordingMenuPlanner();
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'messenger:planner_blind', channel: 'messenger', role: 'assistant', text: 'Old social style',
      externalMessageId: null, externalUserId: 'planner_blind', deliveryStatus: 'sent', metadata: null,
    });

    await runAgentTurn({
      sessionId: 'messenger:planner_blind', customerId: 'planner_blind', channel: 'messenger',
      text: 'Cho mình xem combo', clients: createMockClients(createTestFixtures()), store,
      dashboard: new DashboardEventBus(), toolPlanner: planner,
    });

    expect(planner.inputs).toHaveLength(1);
    expect(planner.inputs[0]?.state).not.toHaveProperty('channel');
    expect(planner.inputs[0]?.state).not.toHaveProperty('recentTurns');
    expect(planner.inputs[0]?.recentTurns.every((turn) => turn.role === 'user')).toBe(true);
  });

  it('rejects a session that attempts to cross response profiles', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'shared_session', channel: 'kfc', role: 'user', text: 'hello', externalMessageId: 'kfc_1',
      externalUserId: 'customer', deliveryStatus: 'received', metadata: null,
    });

    await expect(runAgentTurn({
      sessionId: 'shared_session', customerId: 'customer', channel: 'messenger', text: 'hello again',
      clients: createMockClients(createTestFixtures()), store, dashboard: new DashboardEventBus(),
    })).rejects.toThrow('session_response_profile_mismatch');
  });

  it('normalizes trusted UI actions into channel-neutral commands', () => {
    expect(customerCommandFromVerifiedAction({
      actionId: 'add_items',
      payload: { items: [{ itemCode: '20751', quantity: 2 }] },
    })).toEqual({ kind: 'cart_batch_update', items: [{ itemCode: '20751', quantity: 2 }] });
    expect(customerCommandFromVerifiedAction({
      actionId: 'customize_item:drink:large',
      payload: { itemCode: '20751', groupId: 'drink', modifierId: 'large' },
    })).toEqual({ kind: 'modifier_selection', itemCode: '20751', groupId: 'drink', modifierId: 'large' });
    expect(customerCommandFromVerifiedAction({ actionId: 'confirm_order' })).toEqual({ kind: 'confirm_order' });
  });
});
