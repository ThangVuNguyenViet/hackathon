import {
  AIMessage,
  isSystemMessage,
  type BaseMessage,
  type ToolCall,
} from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import type { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
} from '../../src/agent/responseGrounding.js';
import {
  selectedActionResponseReferenceSchema,
  type SelectedActionResponseReference,
} from '../../src/agent/selectedActionResponseAuthority.js';
import {
  STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
} from '../../src/agent/structuredCustomerAction.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  customerCommandFromVerifiedAction,
  createTrustedCustomerActionEnvelope,
} from '../../src/domain/customerCommand.js';
import type { Address, Cart, Order } from '../../src/domain/types.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import {
  digestTrustedKfcGenUiAction,
  kfcGenUiVerifiedStateRevision,
} from '../../src/genui/kfcGenUi.js';
import { runAgentTurn } from '../fixtures/runAgentTurn.js';
import { runScenario } from '../../src/scenarios/runner.js';
import type { ScenarioScript } from '../../src/scenarios/scenarioScript.js';
import { loadPriorVerifiedState } from '../../src/graph/verifiedState.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  mockConfirmationProviderRevision,
} from '../../src/mock/mockConfirmationAuthority.js';
import {
  agentToolArgumentSchemas,
} from '../../src/ordering/toolCatalog.js';
import type { ToolName } from '../../src/ordering/types.js';
import {
  buildVerifiedCollectionSnapshot,
} from '../../src/ordering/verifiedCollections.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function cart(items: Cart['items'] = [
  { itemCode: '20751', name: 'Combo Hợp Gu 99K', quantity: 1, unitPriceVnd: 99_000 },
]): Cart {
  const subtotalVnd = items.reduce((total, item) => total + item.quantity * item.unitPriceVnd, 0);
  return {
    id: 'cart_live_regression',
    items,
    subtotalVnd,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: subtotalVnd,
    voucherCode: null,
  };
}

function pendingOrder(): Order {
  return {
    id: 'KFC-MOCK-1001',
    cart: cart(),
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFCVN0002',
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}

function authoredToolCall<Name extends ToolName>(
  name: Name,
  args: z.input<(typeof agentToolArgumentSchemas)[Name]>,
): ToolCall {
  return {
    name,
    args: agentToolArgumentSchemas[name].parse(args),
  };
}

function authoredModel(input: {
  tools?: ToolCall[][];
  customerText: string;
}) {
  const model = fakeModel();
  for (const calls of input.tools ?? []) {
    model.respondWithTools(calls);
  }
  return model.respond(groundedResponseModelReply({
    customerText: input.customerText,
  }));
}

function transientTimeoutModel(customerText: string) {
  const error = new Error('transient provider timeout');
  error.name = 'TimeoutError';
  return fakeModel()
    .respond(error)
    .respond(groundedResponseModelReply({ customerText }));
}

function agentRuntime(model: ReturnType<typeof fakeModel>) {
  return {
    checkpointer: new MemorySaver(),
    agentModel: model,
  };
}

function customerAccessForCurrentTurn(input: {
  sessionId: string;
  customerId: string;
  channel?: 'kfc' | 'messenger' | 'messenger_mock';
}) {
  const access = controlledCustomerAccess(input);
  return {
    ...access,
    surfaceSubjectRef:
      input.channel?.startsWith('messenger')
        ? input.customerId
        : access.surfaceSubjectRef,
  };
}

async function savedAddressCustomerRunGuard(input: {
  store: MemoryStore;
  sessionId: string;
  customerId: string;
  externalMessageId: string;
}) {
  const runId = `saved-address-regression-run:${input.externalMessageId}`;
  const run = await input.store.createCustomerRun({
    id: runId,
    schemaVersion: 1,
    sessionId: input.sessionId,
    customerId: input.customerId,
    clientMessageId: input.externalMessageId,
    requestFingerprint: `${runId}:fingerprint`,
    generation: 1,
    status: 'running',
    phase: 'read_only_tool',
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    terminalAt: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
  return {
    isCurrent: async () => true,
    commitFence: {
      kind: 'customer_run' as const,
      runId,
      sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    },
  };
}

function structuredActionReference(
  messages: BaseMessage[],
): SelectedActionResponseReference {
  const authorityMessage = messages.find(
    (message) =>
      isSystemMessage(message) &&
      message.id === STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
  );
  if (!authorityMessage || typeof authorityMessage.content !== 'string') {
    throw new Error('structured_action_reference_message_missing');
  }
  const parsed: unknown = JSON.parse(authorityMessage.content);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('selectedActionResponse' in parsed)
  ) {
    throw new Error('structured_action_reference_message_invalid');
  }
  return selectedActionResponseReferenceSchema.parse(
    parsed.selectedActionResponse,
  );
}

function structuredGroundedResponse(
  messages: BaseMessage[],
  customerText: string,
): AIMessage {
  return groundedResponseModelReply({
    customerText,
    selectedActionResponse: structuredActionReference(messages),
  })(messages);
}

function bindPlanningAndStructuredResponseModels(input: {
  baseModel: ReturnType<typeof fakeModel>;
  planningModel: ReturnType<typeof fakeModel>;
  responseModel: ReturnType<typeof fakeModel>;
}): void {
  vi.spyOn(input.baseModel, 'bindTools').mockImplementation((tools) => {
    const names = (tools as Array<{ name?: string }>).flatMap(
      ({ name }) => name ? [name] : [],
    );
    return (
      names.length === 1 &&
      names[0] === GROUNDED_RESPONSE_TOOL_NAME
        ? input.responseModel
        : input.planningModel
    ) as ReturnType<NonNullable<typeof input.baseModel.bindTools>>;
  });
}

async function seed(
  store: MemoryStore,
  sessionId: string,
  verifiedState: Record<string, unknown>,
): Promise<void> {
  await store.appendEvent(sessionId, 'graph:verified_state', { verifiedState });
}

describe('recent live conversation regressions', () => {
  it('starts a fresh active cart while preserving submitted order history', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'kfc:live_new_order_regression';
    await seed(store, sessionId, {
      cart: cart(),
      order: pendingOrder(),
      paymentAttempt: {
        orderId: 'KFC-MOCK-1001',
        method: 'zalopay',
        status: 'pending',
        paymentUrl: 'https://pay.mock/zalopay/KFC-MOCK-1001',
      },
      toolTrace: [],
    });
    const model = authoredModel({
      tools: [[
        authoredToolCall('searchMenu', {
          scope: 'filtered',
          query: 'Combo Đẫy Đà 129K',
        }),
        authoredToolCall('updateCart', {
          changes: [
            {
              itemCode: '20751',
              quantity: 0,
              modifiers: [],
            },
            {
              itemCode: '20752',
              quantity: 1,
              modifiers: [],
            },
          ],
        }),
      ]],
      customerText: 'Combo Đẫy Đà 129K is now in your cart.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'live_new_order_regression',
      channel: 'kfc',
      text: 'I want Combo Đẫy Đà 129K',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      ...agentRuntime(model),
    });

    expect.soft(output.state.cart?.items).toEqual([
      expect.objectContaining({ itemCode: '20752', quantity: 1 }),
    ]);
    expect.soft(output.state.order).toMatchObject({
      id: 'KFC-MOCK-1001',
      status: 'created',
    });
    expect.soft(output.state.orderPreview).toBeUndefined();
    expect.soft(output.state.paymentAttempt).toMatchObject({
      method: 'zalopay',
      status: 'pending',
    });
    expect.soft(output.genUi?.widgetKind).toBe('cartBuilder');
    expect.soft(output.responseText).not.toContain('KFC-MOCK-1001');
    const activePublication = model.calls
      .at(-1)
      ?.messages.map(({ text }) => text)
      .join('\n') ?? '';
    expect.soft(activePublication).not.toContain('KFC-MOCK-1001');
    expect.soft(activePublication).not.toContain(
      'https://pay.mock/zalopay/KFC-MOCK-1001',
    );
  });

  it('shows current Pepsi choices instead of the existing cart', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'kfc:live_pepsi_picker_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });
    const model = authoredModel({
      tools: [[authoredToolCall('searchMenu', {
        scope: 'filtered',
        query: 'Pepsi',
      })]],
      customerText: 'Please choose from the current Pepsi options.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'live_pepsi_picker_regression',
      channel: 'kfc',
      text: 'I want some pepsi',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      ...agentRuntime(model),
    });

    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(output.genUi?.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.stringContaining('Pepsi') })]),
    );
  });

  it('uses current catalog planning instead of an active cart for a menu question', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const activeItem = fixtures.menuItems.find((item) => item.code === '20694');
    expect(activeItem).toBeDefined();
    const store = new MemoryStore();
    const sessionId = 'kfc:live_menu_question_with_cart';
    await seed(store, sessionId, {
      cart: cart([{
        itemCode: activeItem!.code,
        name: activeItem!.name,
        quantity: 1,
        unitPriceVnd: activeItem!.priceVnd,
      }]),
      toolTrace: [],
    });
    const model = authoredModel({
      tools: [[authoredToolCall('searchMenu', {
        scope: 'filtered',
        query: 'Combo Gà Rôm Rả 245k',
      })]],
      customerText: 'Combo Gà Rôm Rả 245k có thể chọn gà cay.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'live_menu_question_with_cart',
      channel: 'messenger_mock',
      text: 'Có combo nào có gà cay không?',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      ...agentRuntime(model),
    });

    expect(model.callCount).toBe(2);
    expect(output.state.cart?.items).toEqual([
      expect.objectContaining({ itemCode: activeItem!.code, quantity: 1 }),
    ]);
    expect(output.state.menuSearchResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: '20711', name: 'Combo Gà Rôm Rả 245k' }),
    ]));
    expect(output.state.menuSearchResults?.some((item) => item.code === activeItem!.code)).toBe(false);
    expect(output.responseText).toContain('Combo Gà Rôm Rả 245k');
    expect(output.responseText).not.toContain(activeItem!.name);
  });

  it('does not replace checkout with incidental catalog suggestions on a delivery-note and invoice turn', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'kfc:checkout_note_invoice_regression';
    await seed(store, sessionId, {
      cart: cart(),
      address: { line1: '23 Nguyễn Hữu Thọ', district: 'Quận 7', city: 'Hồ Chí Minh' },
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0318',
        storeName: 'KFC PHẠM VĂN NGHỊ',
        feeVnd: 18_000,
        etaMinutes: 25,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'test_only', sourceFile: 'test' },
        },
      },
      toolTrace: [],
    });
    const model = authoredModel({
      customerText:
        'Đã ghi chú yêu cầu giao hàng. Vui lòng cung cấp thông tin xuất hóa đơn.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'checkout_note_invoice_regression',
      channel: 'kfc',
      text: 'Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa.',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      ...agentRuntime(model),
    });

    expect(output.state.cart).toBeDefined();
    expect(output.state.fulfillment).toBeDefined();
    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('keeps a generic multi-variant catalog request in the picker until the model receives a selection', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const model = authoredModel({
      tools: [[authoredToolCall('searchMenu', {
        scope: 'filtered',
        query: 'pepsi',
      })]],
      customerText: 'Please choose the Pepsi variant you want.',
    });
    const output = await runAgentTurn({
      sessionId: 'kfc:ambiguous_catalog_variant_regression',
      customerId: 'ambiguous_catalog_variant_regression',
      channel: 'kfc',
      text: 'tôi muốn pepsi',
      clients: createMockClients(fixtures),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      ...agentRuntime(model),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('suggests compact deterministic combos for an ambiguous spicy-combo request without selecting one', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const model = authoredModel({
      tools: [[authoredToolCall('searchMenu', {
        scope: 'filtered',
        query: 'combo gà cay',
      })]],
      customerText: 'Please choose a spicy-chicken combo.',
    });
    const output = await runAgentTurn({
      sessionId: 'kfc:spicy_combo_modifier_search',
      customerId: 'spicy_combo_modifier_search',
      channel: 'kfc',
      text: 'Cho mình 1 combo gà cay',
      clients: createMockClients(fixtures),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      ...agentRuntime(model),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
    const genUiItems = output.genUi?.data.items as Array<Record<string, unknown> & { name: string; category: string }>;
    expect(genUiItems.length).toBeGreaterThan(0);
    expect(genUiItems.every((item) =>
      `${item.name} ${item.category}`.toLowerCase().includes('combo'),
    )).toBe(true);
    expect(genUiItems.every((item) => !('modifierGroups' in item))).toBe(true);
  });

  it('uses current modifier-aware catalog evidence for a social menu question instead of stale order results', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'messenger_mock:spicy_combo_after_order';
    await seed(store, sessionId, {
      cart: cart(),
      order: pendingOrder(),
      menuSearchResults: [{
        code: '20752',
        itemId: '20752',
        productCode: 'DAYDA',
        category: 'Ưu Đãi',
        name: 'Combo Đẫy Đà 129K',
        description: 'stale result',
        priceVnd: 129_000,
        originalPriceVnd: null,
        available: true,
      }],
      toolTrace: [],
    });
    const model = authoredModel({
      tools: [
        [authoredToolCall('searchMenu', {
          scope: 'filtered',
          query: 'combo gà cay',
        })],
        [authoredToolCall('getModifierOptions', { code: '20711' })],
      ],
      customerText:
        'Combo Gà Rôm Rả 245k có thể chọn gà giòn cay. Bạn muốn thêm combo này vào giỏ hàng không?',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'spicy_combo_after_order',
      channel: 'messenger_mock',
      text: 'Có combo nào có gà cay không?',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      ...agentRuntime(model),
    });

    expect(output.responseText).toContain('Combo Gà Rôm Rả 245k');
    expect(output.responseText).toMatch(/gà giòn cay/i);
    expect(output.responseText).not.toContain('Combo Đẫy Đà 129K');
    expect(output.responseText).not.toContain('KFC-MOCK-1001');
  });

  it('asks an anonymous customer for an address without invoking semantic planning', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:anon_customer_live_address_regression';
    const verifiedState = { cart: cart(), toolTrace: [] };
    await seed(store, sessionId, verifiedState);
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'Tiếp tục giao hàng',
      externalMessageId: 'anon-address-user-turn',
      externalUserId: 'anon_customer_live_address_regression',
      deliveryStatus: 'received',
      metadata: null,
    });
    const planningModel = fakeModel().respond(
      new AIMessage('semantic planning must not run'),
    );
    const responseModel = fakeModel().respond((messages) => {
      return structuredGroundedResponse(
        messages,
        'Bạn vui lòng cung cấp địa chỉ giao hàng.',
      );
    });
    const baseModel = fakeModel();
    bindPlanningAndStructuredResponseModels({
      baseModel,
      planningModel,
      responseModel,
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'anon_customer_live_address_regression',
      channel: 'kfc',
      text: 'Tiếp tục giao hàng',
      metadata: {
        customerCommand: { kind: 'start_fulfillment' },
        rawEvent: { source: 'kfc_genui_action' },
      },
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      ...agentRuntime(baseModel),
      trustedCustomerAction: createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: 'anon-address-assistant-turn',
        attachmentId: 'anon-address-cart',
        actionDigest: 'a'.repeat(64),
        verifiedRevision:
          kfcGenUiVerifiedStateRevision(verifiedState),
        lifecycle: 'one_shot',
        command: { kind: 'start_fulfillment' },
      }),
    });

    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.state.orderPreview).toBeUndefined();
    expect(output.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: { addressStatus: 'missing' },
    });
    expect(output.responseText.toLowerCase()).toContain('địa chỉ');
  });

  it('persists a composed assistant response when planning times out', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:live_planner_timeout_regression';
    const model = transientTimeoutModel(
      'Bạn vui lòng cho biết mã đơn hoặc vấn đề đơn hàng cần hỗ trợ.',
    );

    const output = await runAgentTurn({
      sessionId,
      customerId: 'live_planner_timeout_regression',
      channel: 'messenger',
      text: 'Tôi cần hỗ trợ đơn hàng',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 250,
      ...agentRuntime(model),
    });

    expect(output.responseText).not.toBe('');
    expect(output.assistantTurnId).toBeTruthy();
    expect(await store.listTurns(sessionId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: output.responseText })]),
    );
    expect((await store.listEvents(sessionId)).map((event) => event.sourceType)).not.toContain(
      'agent:recovery_response',
    );
  });

  it('applies the whole-turn deadline across durable context loading and the model call', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:planner_deadline_excludes_context_loading';
    const listTurns = store.listTurns.bind(store);
    let delayedDurableLoad = false;
    const loadTurns = vi.spyOn(store, 'listTurns')
      .mockImplementation(async (loadedSessionId) => {
        if (!delayedDurableLoad) {
          delayedDurableLoad = true;
          await new Promise((resolve) => setTimeout(resolve, 70));
        }
        return listTurns(loadedSessionId);
      });

    const model = fakeModel();
    const delayedResponse = RunnableLambda.from(
      async (messages: BaseMessage[]) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return groundedResponseModelReply({
          customerText:
            'Bạn vui lòng cung cấp địa chỉ giao hàng đầy đủ ở Quận 7.',
        })(messages);
      },
    );
    vi.spyOn(model, 'bindTools').mockReturnValue(
      // The test intentionally replaces a bound chat model with a delayed
      // runnable that preserves the same invoke contract.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      delayedResponse as unknown as ReturnType<
        NonNullable<typeof model.bindTools>
      >,
    );

    await expect(runAgentTurn({
      sessionId,
      customerId: 'planner_deadline_excludes_context_loading',
      channel: 'kfc',
      text: 'Giao về Quận 7.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 100,
      ...agentRuntime(model),
    })).rejects.toThrow('agent_turn_deadline_exceeded');

    expect(loadTurns).toHaveBeenCalled();
    expect((await store.listEvents(sessionId)).map(
      (event) => event.sourceType,
    )).toContain('agent:failed_closed');
  });

  it('does not fabricate a provider-verified district when the model times out', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:planner_timeout_preserves_fulfillment_location';
    const model = transientTimeoutModel(
      'Bạn vui lòng cung cấp địa chỉ giao hàng đầy đủ ở Quận 7.',
    );

    const output = await runAgentTurn({
      sessionId,
      customerId: 'planner_timeout_preserves_fulfillment_location',
      channel: 'kfc',
      text: 'Cho mình một combo, giao về Quận 7.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 250,
      ...agentRuntime(model),
    });

    expect(output.state.addressDraft).toBeUndefined();
  });

  it('does not turn exact-quantity words into a cart mutation when planning times out', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'kfc:exact_quantity_timeout_recovery';
    const model = transientTimeoutModel(
      'Bạn muốn xem món bán chạy hay thêm số lượng món cụ thể vào giỏ?',
    );

    const output = await runAgentTurn({
      sessionId,
      customerId: 'exact_quantity_timeout_recovery',
      channel: 'kfc',
      text: 'Món gà nào bán chạy? Nếu gọi lẻ thì cho mình 10 miếng gà rán và 4 Pepsi tiêu chuẩn.',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 250,
      ...agentRuntime(model),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.state).not.toHaveProperty('comboConversionProposal');
    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).not.toContain('updateCart');
    expect(await store.listEvents(sessionId)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'agent:recovery_response' }),
    ]));
  });

  it('does not infer checkout confirmation or invoice fields when planning times out', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:order_confirmation_timeout_recovery';
    const address: Address = {
      label: 'Sunrise City',
      line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const fixtures = createTestFixtures();
    const selectedMethod = fixtures.paymentMethods.find(
      ({ methodId }) => methodId === 'zalopay_wallet',
    );
    if (!selectedMethod) {
      throw new Error('selected payment fixture missing');
    }
    const paymentCollection =
      await buildVerifiedCollectionSnapshot({
        items: [selectedMethod],
        scope: { scope: 'all' },
        providerRevision: mockConfirmationProviderRevision(undefined),
      });
    const selectedPaymentMethod = {
      methodId: selectedMethod.methodId,
      collectionKey: paymentCollection.key,
      collectionRevision: paymentCollection.revision,
      providerRevision: paymentCollection.providerRevision,
    };
    await seed(store, sessionId, {
      cart: { ...cart(), deliveryFeeVnd: 18_000, totalVnd: 117_000 },
      address,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC Test',
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'test_only', sourceFile: 'live-conversation-regressions.test.ts' },
        },
      },
      paymentMethodEvidence: [selectedMethod],
      verifiedCollections: {
        listPaymentMethods: {
          [paymentCollection.key]: paymentCollection,
        },
      },
      activeCollectionKeys: {
        listPaymentMethods: paymentCollection.key,
      },
      selectedPaymentMethod,
      toolTrace: [],
    });
    const model = transientTimeoutModel(
      'Tôi chưa thể xác nhận đơn khi yêu cầu mô hình trước đó thất bại.',
    );

    const output = await runAgentTurn({
      sessionId,
      customerId: 'order_confirmation_timeout_recovery',
      channel: 'kfc',
      text: 'Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 250,
      ...agentRuntime(model),
    });

    expect(output.state.invoiceRequest).toBeUndefined();
    expect(output.state.selectedPaymentMethod).toEqual(
      selectedPaymentMethod,
    );
    expect(output.state.order).toBeUndefined();
    expect(output.state.paymentAttempt).toBeUndefined();
    expect(output.state.toolTrace ?? []).toEqual([]);
    expect((await store.listEvents(sessionId)).some(
      (event) => event.sourceType === 'agent:recovery_response' &&
        event.payload.responseMode === 'verified_order_confirmation',
    )).toBe(false);
  });

  it('recovers a selected payment method from its verified lookup when creating the order later', async () => {
    const scenarioId = 'verified-payment-lookup-recovery';
    const methodId =
      `provider/支払?account=α#${'長'.repeat(32)}!()[]{};,:@&=+$`;
    const userTurn = {
      index: 1,
      speaker: 'User' as const,
      text: 'Xác nhận đơn và tiếp tục với ZaloPay.',
      useCases: ['verified-payment-lookup-recovery'],
    };
    const script: ScenarioScript = {
      id: scenarioId,
      title: 'Verified payment lookup recovery',
      channel: 'kfc',
      goal:
        'Create an order and payment link from one verified payment collection',
      useCases: userTurn.useCases,
      finalState: 'order_created',
      turns: [userTurn],
      userTurns: [userTurn],
      expectations: [],
    };
    const claims = groundedResponseClaims({
      evidenceReferences: [
        {
          evidenceId: 'order',
          claimKinds: ['order_id', 'status'],
        },
        {
          evidenceId: 'payment_attempt',
          claimKinds: ['payment', 'status'],
        },
      ],
    });
    const model = fakeModel()
      .respondWithTools([authoredToolCall('listPaymentMethods', {
        query: null,
        paymentSurface: null,
      }), authoredToolCall('checkStoreAvailability', {
        storeId: 'KFCVN0002',
        disposition: 'delivery',
      })])
      .respondWithTools([authoredToolCall('previewOrder', {})])
      .respondWithTools([authoredToolCall('placeOrder', {})])
      .respondWithTools([authoredToolCall('createPaymentLink', {
        methodId,
      })])
      .respond(groundedResponseModelReply({
        customerText:
          'The verified order and payment link are ready.',
        ...claims,
        publicationDeclaration: {
          semanticRelevance: 'aligned',
          privateDataDisclosure: 'authorized',
          disclosureAuthorities: [
            { kind: 'publication_evidence', evidenceId: 'order' },
            {
              kind: 'publication_evidence',
              evidenceId: 'payment_attempt',
            },
          ],
          disclosesInternalMetadata: false,
        },
      }));
    const result = await runScenario(script, {
      agentModel: model,
      accessContext: customerAccessForCurrentTurn({
        sessionId: `replay_${scenarioId}`,
        customerId: 'scenario_customer',
      }),
      initialVerifiedState: {
        cart: {
          ...cart(),
          deliveryFeeVnd: 18_000,
          totalVnd: 117_000,
        },
        address: {
          label: 'Sunrise City',
          line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'KFCVN0002',
          storeName: 'KFC Test',
          feeVnd: 18_000,
          etaMinutes: 35,
          availability: {
            ok: true,
            checkedItemIds: ['20751'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: {
              fixtureMode: 'test_only',
              sourceFile: 'live-conversation-regressions.test.ts',
            },
          },
        },
      },
      transformFixtures: (fixtures) => {
        const supportedMethod = fixtures.paymentMethods.find(
          (method) =>
            method.supported &&
            method.supportStatus === 'listed_supported' &&
            method.category !== 'cash_on_delivery',
        );
        if (!supportedMethod) {
          throw new Error('supported payment fixture missing');
        }
        return {
          ...fixtures,
          paymentMethods: [{
            ...supportedMethod,
            methodId,
            displayName: 'Opaque provider method',
          }],
        };
      },
      autoApproveConfirmations: true,
      confirmationSigningSecret:
        'verified-payment-recovery-secret-at-least-thirty-two-bytes',
    });

    expect(result.order).toMatchObject({ status: 'created' });
    const finalState = result.finalAgentState;
    if (!finalState) throw new Error('final agent state missing');
    const collectionKey =
      finalState.activeCollectionKeys?.listPaymentMethods;
    const paymentCollection = collectionKey
      ? finalState.verifiedCollections
        ?.listPaymentMethods?.[collectionKey]
      : undefined;
    expect(paymentCollection?.result.items.map(
      (method) => method.methodId,
    )).toEqual([methodId]);
    expect(finalState.selectedPaymentMethod).toEqual({
      methodId,
      collectionKey,
      collectionRevision: paymentCollection?.revision,
      providerRevision: paymentCollection?.providerRevision,
    });
    expect(finalState.paymentAttempt).toMatchObject({
      method: methodId,
      status: 'pending',
    });
    expect(result.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolName: 'createPaymentLink',
        arguments: { methodId },
        ok: true,
      }),
    ]));
    expect(result.turnEvidence[0]?.approvalResumes.map(
      ({ capability }) => capability,
    )).toEqual(['placeOrder', 'createPaymentLink']);
  });

  it('does not infer saved-address acceptance when planning times out', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:saved_address_timeout_recovery';
    const savedAddress: Address = {
      label: 'Địa chỉ cũ',
      line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    await seed(store, sessionId, {
      cart: cart(),
      customerContext: { savedAddresses: [savedAddress], favorites: [], recentOrders: [] },
      toolTrace: [],
    });
    await store.appendTurn({
      sessionId,
      channel: 'messenger',
      role: 'assistant',
      text: 'Mình tìm thấy địa chỉ 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7, Hồ Chí Minh. Bạn xác nhận nhé.',
      externalMessageId: null,
      externalUserId: 'saved_address_timeout_recovery',
      deliveryStatus: 'sent',
      metadata: {
        genUi: {
          id: 'saved_address_candidate',
          lifecycleStage: 'fulfillment',
          widgetKind: 'addressFulfillmentCheck',
          status: 'active',
          title: 'Kiểm tra giao hàng',
          data: { address: savedAddress, addressStatus: 'candidate', fulfillment: null },
          actions: [{ id: 'accept_fulfillment', label: 'Giao đến địa chỉ này' }],
        },
      },
    });
    const model = transientTimeoutModel(
      'Bạn vui lòng xác nhận rõ địa chỉ giao hàng muốn sử dụng.',
    );

    const output = await runAgentTurn({
      sessionId,
      customerId: 'saved_address_timeout_recovery',
      channel: 'messenger',
      accessContext: customerAccessForCurrentTurn({
        sessionId,
        customerId: 'saved_address_timeout_recovery',
        channel: 'messenger',
      }),
      text: 'Đúng rồi',
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18_000, etaMinutes: 45 },
          message: 'timeout_recovery_quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 250,
      ...agentRuntime(model),
    });

    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.state.toolTrace ?? []).toEqual([]);
    expect(output.responseText).not.toBe('');
    expect((await store.listEvents(sessionId)).some(
      (event) => event.sourceType === 'agent:recovery_response' &&
        event.payload.responseMode === 'verified_fulfillment_confirmation',
    )).toBe(false);
  });

  it('presents a saved address as an unconfirmed candidate', async () => {
    const savedAddress: Address = {
      label: 'Nhà',
      line1: 'Sunrise City',
      district: 'Quận 7',
      city: 'TP.HCM',
    };
    const store = new MemoryStore();
    const sessionId = 'kfc:saved_address_confirmation_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider: () => ({
        ok: true,
        value: [savedAddress],
        message: 'saved_addresses',
      }),
      fulfillmentQuoteProvider: () => ({
        ok: true,
        value: { feeVnd: 18_000, etaMinutes: 30 },
        message: 'quote',
      }),
    });
    const checkpointer = new MemorySaver();
    const planningModel = fakeModel()
      .respondWithTools([authoredToolCall('getSavedAddresses', {})])
      .respond(groundedResponseModelReply({
        customerText: 'Please review the available delivery option.',
      }));
    const responseModel = fakeModel().respond((messages) =>
      structuredGroundedResponse(
        messages,
        'The selected delivery address is ready.',
      ));
    const baseModel = fakeModel();
    bindPlanningAndStructuredResponseModels({
      baseModel,
      planningModel,
      responseModel,
    });
    const output = await runAgentTurn({
      sessionId,
      customerId: 'saved_address_confirmation_regression',
      channel: 'kfc',
      responseProfile: 'genui',
      accessContext: customerAccessForCurrentTurn({
        sessionId,
        customerId: 'saved_address_confirmation_regression',
      }),
      text: 'Tiếp tục giao hàng',
      externalMessageId: 'saved-address-candidate-message',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      agentModel: baseModel,
      runGuard: await savedAddressCustomerRunGuard({
        store,
        sessionId,
        customerId: 'saved_address_confirmation_regression',
        externalMessageId: 'saved-address-candidate-message',
      }),
    });

    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: { address: savedAddress, addressStatus: 'candidate' },
      actions: expect.arrayContaining([expect.objectContaining({ id: 'accept_fulfillment' })]),
    });
    if (!output.genUi?.authority || !output.assistantTurnId) {
      throw new Error('saved_address_candidate_authority_missing');
    }
    const selectedAction = {
      attachmentId: output.genUi.id,
      actionId: 'accept_fulfillment',
      value: output.genUi.actions.find(
        ({ id }) => id === 'accept_fulfillment',
      )?.value,
    };
    const selectedCommand =
      customerCommandFromVerifiedAction(selectedAction);
    if (
      selectedCommand?.kind !== 'accept_fulfillment' ||
      !selectedCommand.savedAddressRef
    ) {
      throw new Error('saved_address_candidate_ref_missing');
    }
    const actionDigest = await digestTrustedKfcGenUiAction({
      attachment: output.genUi,
      assistantTurnId: output.assistantTurnId,
      action: selectedAction,
    });
    const accepted = await runAgentTurn({
      sessionId,
      customerId: 'saved_address_confirmation_regression',
      channel: 'kfc',
      accessContext: customerAccessForCurrentTurn({
        sessionId,
        customerId: 'saved_address_confirmation_regression',
      }),
      text: '',
      externalMessageId: 'saved-address-accept-message',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      checkpointer,
      agentModel: baseModel,
      runGuard: await savedAddressCustomerRunGuard({
        store,
        sessionId,
        customerId: 'saved_address_confirmation_regression',
        externalMessageId: 'saved-address-accept-message',
      }),
      trustedCustomerAction: createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: output.assistantTurnId,
        attachmentId: output.genUi.id,
        actionDigest,
        verifiedRevision: output.genUi.authority.verifiedRevision,
        lifecycle: 'one_shot',
        command: selectedCommand,
      }),
    });

    const providerResolvedSavedAddress: Address = {
      ...savedAddress,
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    expect(accepted.state.address).toEqual(
      providerResolvedSavedAddress,
    );
    expect(accepted.state.fulfillment).toBeDefined();
    expect(accepted.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: providerResolvedSavedAddress,
        addressStatus: 'confirmed',
        fulfillment: expect.any(Object),
      },
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'accept_fulfillment' }),
      ]),
    });
  });

  it('keeps repeated delivery requests at the address step without placing an order', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:repeated_delivery_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });
    const customerId = 'repeated_delivery_regression';
    const accessContext = customerAccessForCurrentTurn({
      sessionId,
      customerId,
    });
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider: () => ({
        ok: true,
        value: [],
        message: 'no_saved_addresses',
      }),
    });

    for (const text of ['giao hàng cho tôi', 'giao hàng cho tôi']) {
      const model = authoredModel({
        tools: [[authoredToolCall('getSavedAddresses', {})]],
        customerText: 'Bạn vui lòng cung cấp địa chỉ giao hàng.',
      });
      const output = await runAgentTurn({
        sessionId,
        customerId,
        channel: 'kfc',
        accessContext,
        text,
        clients,
        store,
        dashboard: new DashboardEventBus(),
        responseProfile: 'genui',
        ...agentRuntime(model),
      });
      expect(output.state.address).toBeUndefined();
      expect(output.state.orderPreview).toBeUndefined();
      expect(output.state.order).toBeUndefined();
      expect(output.genUi?.widgetKind).toBe('addressFulfillmentCheck');
      expect(output.state.toolTrace?.map((entry) => entry.toolName)).not.toEqual(
        expect.arrayContaining(['previewOrder', 'placeOrder']),
      );
    }
  });

  it('does not substitute a partial typed address with a saved address', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:partial_address_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });
    const model = authoredModel({
      customerText:
        'Bạn vui lòng cung cấp quận cho địa chỉ 54/2 Nguyễn Hồng Đào.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'partial_address_regression',
      channel: 'messenger',
      accessContext: customerAccessForCurrentTurn({
        sessionId,
        customerId: 'partial_address_regression',
        channel: 'messenger',
      }),
      text: 'giao hàng qua cho 54/2 Nguyễn Hồng Đào',
      clients: createMockClients(createTestFixtures(), {
        savedAddressesProvider: () => ({
          ok: true,
          value: [{ label: 'Cũ', line1: 'Sunrise City', district: 'Quận 7', city: 'TP.HCM' }],
          message: 'saved_addresses',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      ...agentRuntime(model),
    });

    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.responseText).toContain('quận');
    expect(output.responseText).not.toContain('Sunrise City');
  });

  it('fails closed before carrying a confirmed street into a different partial address draft', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:different_partial_address_regression';
    const oldAddress: Address = {
      label: 'Địa chỉ cũ',
      line1: '123 Nguyễn Trãi',
      district: 'Quận 5',
      city: 'Hồ Chí Minh',
    };
    await seed(store, sessionId, {
      cart: cart(),
      address: oldAddress,
      addressDraft: oldAddress,
      customerContext: { savedAddresses: [oldAddress], favorites: [], recentOrders: [] },
      toolTrace: [],
    });
    const model = authoredModel({
      tools: [[authoredToolCall('quoteFulfillment', {
        address: {
          label: oldAddress.label,
          line1: oldAddress.line1,
          district: 'Quận 3',
          city: oldAddress.city,
        },
        method: 'delivery',
      })]],
      customerText:
        'Bạn vui lòng cung cấp đường cụ thể cho địa chỉ mới ở Quận 3.',
    });
    const clients = createMockClients(createTestFixtures());
    const quoteFulfillment = vi.spyOn(
      clients.fulfillment,
      'quoteFulfillment',
    );

    await expect(runAgentTurn({
      sessionId,
      customerId: 'different_partial_address_regression',
      channel: 'kfc',
      accessContext: customerAccessForCurrentTurn({
        sessionId,
        customerId: 'different_partial_address_regression',
      }),
      text: 'Đổi địa chỉ giao qua Quận 3 được không?',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      ...agentRuntime(model),
    })).rejects.toThrow('agent_address_authority_mismatch');

    expect(quoteFulfillment).not.toHaveBeenCalled();
    const durableState = await loadPriorVerifiedState(store, sessionId);
    expect(durableState.address).toEqual(oldAddress);
    expect(durableState.addressDraft).toEqual(oldAddress);
    expect(durableState.fulfillment).toBeUndefined();
    expect(durableState.toolTrace?.some(
      (entry) => entry.toolName === 'quoteFulfillment' && entry.ok,
    )).toBe(false);
  });

  it('quotes a specific typed address through the model-planned fulfillment tool', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:typed_address_quote_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'Giao về Quận 7',
      externalMessageId: null,
      externalUserId: 'typed_address_quote_regression',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Bạn gửi địa chỉ cụ thể giúp mình nhé.',
      externalMessageId: null,
      externalUserId: 'typed_address_quote_regression',
      deliveryStatus: 'sent',
      metadata: null,
    });
    const model = authoredModel({
      tools: [[authoredToolCall('quoteFulfillment', {
        address: {
          label: 'Chung cư Sunrise City',
          line1:
            'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
        method: 'delivery',
      })]],
      customerText: 'Phí giao hàng là 18.000đ.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'typed_address_quote_regression',
      channel: 'kfc',
      text: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7, Hồ Chí Minh. Phí ship bao nhiêu?',
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18_000, etaMinutes: 25 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      responseProfile: 'genui',
      ...agentRuntime(model),
    });

    expect(model.callCount).toBe(2);
    expect(output.state.address).toMatchObject({
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    });
    expect(output.state.fulfillment).toMatchObject({ feeVnd: 18_000, etaMinutes: 25 });
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['quoteFulfillment']);
    expect(output.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: expect.objectContaining({
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        }),
        addressStatus: 'confirmed',
        fulfillment: expect.objectContaining({
          feeVnd: 18_000,
          etaMinutes: 25,
        }),
      },
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'accept_fulfillment' }),
      ]),
    });
  });

  it('rechecks active-cart inventory before advancing an existing checkout', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:checkout_inventory_recheck_regression';
    const address: Address = {
      label: 'Home',
      line1: 'Big C Đồng Nai',
      district: 'Biên Hòa',
      city: 'ĐỒNG NAI',
    };
    await seed(store, sessionId, {
      cart: { ...cart(), deliveryFeeVnd: 18_000, totalVnd: 117_000 },
      address,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC BIG C ĐỒNG NAI',
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'public_crawl_seed', sourceFile: 'availability.json' },
        },
      },
      toolTrace: [],
    });
    const model = authoredModel({
      tools: [[authoredToolCall('checkStoreAvailability', {
        storeId: 'KFCVN0002',
        disposition: 'delivery',
      })]],
      customerText:
        'Combo Hợp Gu 99K is unavailable at the current store.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'checkout_inventory_recheck_regression',
      channel: 'kfc',
      text: 'Tiếp tục nhé',
      clients: createMockClients(createTestFixtures(), {
        mockedUpstreamApiProvider: () => ({ unavailableItemCodes: ['20751'] }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      ...agentRuntime(model),
    });

    expect(output.state.toolTrace).toEqual([
      expect.objectContaining({ toolName: 'checkStoreAvailability', ok: true }),
    ]);
    expect(output.state.fulfillment).toMatchObject({
      storeId: 'KFCVN0002',
      disposition: 'delivery',
      availability: {
        ok: false,
        checkedItemIds: ['20751'],
        unavailableItemIds: ['20751'],
        source: {
          fixtureMode: 'provider_runtime',
        },
      },
    });
    expect(output.state.cart).toMatchObject({
      deliveryFeeVnd: 18_000,
      totalVnd: 117_000,
    });
    expect(output.state.order).toBeUndefined();
    expect(output.state.orderPreview).toBeUndefined();
    expect(output.responseText).toContain('Combo Hợp Gu 99K');
  });

  it('does not substitute ZaloPay when MoMo is requested', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:momo_regression';
    await seed(store, sessionId, { order: pendingOrder(), cart: cart(), toolTrace: [] });
    const model = authoredModel({
      tools: [
        [authoredToolCall('listPaymentMethods', {
          query: 'MoMo',
          paymentSurface: null,
        })],
        [authoredToolCall('createPaymentLink', {
          methodId: 'zalopay_wallet',
        })],
      ],
      customerText: 'MoMo không được hỗ trợ cho đơn KFC-MOCK-1001.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'momo_regression',
      channel: 'kfc',
      text: 'Thanh toán bằng MoMo',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      ...agentRuntime(model),
    });

    expect(output.state.toolTrace).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: 'listPaymentMethods', ok: true })]),
    );
    expect(output.state.toolTrace?.filter((entry) => entry.toolName === 'createPaymentLink')).toEqual([]);
    expect(output.state.paymentAttempt?.paymentUrl).toBeUndefined();
    expect(output.responseText).toContain('MoMo');
    expect(output.responseText).not.toContain('pay.mock/zalopay');
  });

  it('checks payment status when the customer says they paid', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:payment_status_regression';
    await seed(store, sessionId, {
      order: pendingOrder(),
      cart: cart(),
      paymentAttempt: {
        method: 'zalopay',
        status: 'pending',
        paymentUrl: 'https://pay.mock/zalopay/KFC-MOCK-1001',
      },
      toolTrace: [],
    });
    const model = authoredModel({
      tools: [[authoredToolCall('checkPaymentStatus', {})]],
      customerText: 'Đơn KFC-MOCK-1001 vẫn đang chờ thanh toán.',
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'payment_status_regression',
      channel: 'messenger',
      accessContext: customerAccessForCurrentTurn({
        sessionId,
        customerId: 'payment_status_regression',
        channel: 'messenger',
      }),
      text: 'okay tôi thanh toán rồi',
      clients: createMockClients(createTestFixtures(), {
        paymentStatusProvider: () => ({ ok: true, value: { status: 'pending' }, message: 'pending' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      ...agentRuntime(model),
    });

    expect(output.state.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolName: 'checkPaymentStatus',
        arguments: { orderId: 'KFC-MOCK-1001' },
        ok: true,
      }),
    ]));
    expect(output.state.paymentAttempt?.status).toBe('pending');
    expect(output.responseText.toLowerCase()).toContain('chờ thanh toán');
  });
});
