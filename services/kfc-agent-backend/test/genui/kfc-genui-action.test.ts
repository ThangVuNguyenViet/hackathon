import {
  isSystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { KFC_GENUI_WIDGET_KINDS, isKfcGenUiAttachment } from '../../src/genui/kfcGenUi.js';
import {
  selectedActionResponseReferenceSchema,
} from '../../src/agent/selectedActionResponseAuthority.js';
import {
  createConfirmationApprovalKeyRing,
} from '../../src/api/confirmationApprovalCapability.js';
import {
  STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
} from '../../src/agent/structuredCustomerAction.js';
import { loadPriorVerifiedState } from '../../src/graph/verifiedState.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function sandboxIdentityLifecycle() {
  const unavailable = async (): Promise<never> => {
    throw new Error('Lifecycle mutation is not used by GenUI identity tests');
  };
  return {
    environment: 'sandbox' as const,
    controls: {
      create: unavailable,
      get: unavailable,
      transition: unavailable,
    },
    createInput: unavailable,
    binding: unavailable,
  };
}

async function authenticateKfcAction(
  server: Pick<ReturnType<typeof buildServer>, 'inject'>,
  sessionId: string,
  customerId: string,
): Promise<void> {
  const response = await server.inject({
    method: 'POST',
    url: `/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/preconditions`,
    payload: { customerId, authenticated: true },
  });
  expect(response.statusCode, response.body).toBe(201);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function selectedActionResponse(
  customerText: string,
): (messages: BaseMessage[]) => ReturnType<
  ReturnType<typeof groundedResponseModelReply>
> {
  return (messages) => {
    const authorityMessage = messages.find(
      (message) =>
        isSystemMessage(message) &&
        message.id === STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
    );
    if (
      !authorityMessage ||
      typeof authorityMessage.content !== 'string'
    ) {
      throw new Error('structured_action_reference_message_missing');
    }
    const parsed: unknown = JSON.parse(authorityMessage.content);
    if (!isRecord(parsed)) {
      throw new Error('structured_action_reference_message_invalid');
    }
    return groundedResponseModelReply({
      customerText,
      selectedActionResponse:
        selectedActionResponseReferenceSchema.parse(
          parsed.selectedActionResponse,
        ),
    })(messages);
  };
}

describe('KFC GenUI contract', () => {
  it('defines the MVP widget kinds', () => {
    expect(KFC_GENUI_WIDGET_KINDS).toEqual([
      'smartMenuPicker',
      'fullMenuBrowser',
      'productDetailCard',
      'modifierPicker',
      'promotionGallery',
      'allergenEvidence',
      'cartBuilder',
      'addressFulfillmentCheck',
      'orderReviewConfirm',
      'paymentOrderStatus',
      'orderTrackingStatus',
      'supportHandoff',
      'paymentMethodPicker',
    ]);
  });

  it('rejects unknown widget kinds from transcript metadata', () => {
    expect(
      isKfcGenUiAttachment({
        id: 'att_bad',
        lifecycleStage: 'ordering',
        widgetKind: 'unknownWidget',
        status: 'active',
        title: 'Bad',
        data: {},
        actions: [],
      }),
    ).toBe(false);
  });
});

describe('POST /chat/kfc/genui-action', () => {
  it('rejects direct-add attempts for unavailable or modifier-required full-menu items', async () => {
    const store = new MemoryStore();
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
      ...testAgent(
        fakeModel()
          .respondWithTools([{
            name: 'searchMenu',
            args: { scope: 'all', query: null, purpose: 'browse' },
          }])
          .respond(groundedResponseModelReply({
            customerText: 'Đây là toàn bộ thực đơn hiện có.',
          })),
      ),
    });
    const sessionId = 'kfc:blocked_full_menu_item';
    await authenticateKfcAction(server, sessionId, 'blocked_full_menu_item');

    const menuResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'blocked_full_menu_item',
        clientMessageId: 'blocked_full_menu_item_menu',
        text: 'Menu có gì?',
      },
    });
    expect(menuResponse.statusCode, menuResponse.body).toBe(200);
    const menu = menuResponse.json().genUi as {
      id: string;
      widgetKind: string;
      data: { items: Array<Record<string, unknown>> };
    };
    expect(menu.widgetKind).toBe('fullMenuBrowser');
    const blockedItem = menu.data.items.find((item) =>
      item.available !== true ||
      item.isCustomize === true ||
      item.hasModifiers === true ||
      (Array.isArray(item.modifierGroups) && item.modifierGroups.length > 0));
    expect(blockedItem).toBeDefined();

    const actionResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'blocked_full_menu_item',
        clientMessageId: 'blocked_full_menu_item_action',
        action: {
          attachmentId: menu.id,
          actionId: 'add_items',
          payload: {
            items: [{ itemCode: blockedItem!.code, quantity: 1 }],
          },
        },
      },
    });

    expect(actionResponse.statusCode).toBe(422);
    expect(actionResponse.json()).toEqual({
      errorCode: 'invalid_action_payload',
    });
    expect((await loadPriorVerifiedState(store, sessionId)).cart).toBeUndefined();
  });

  it('applies trusted modifier selections by group and preserves previous selections', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: {
          scope: 'filtered',
          query: 'Combo Đẫy Đà 129K',
          purpose: 'recommend',
        },
      }])
      .respondWithTools([
        {
          name: 'updateCart',
          args: {
            changes: [{
              itemCode: '20752',
              quantity: 2,
              modifiers: [],
            }],
          },
        },
      ])
      .respondWithTools([
        {
          name: 'getModifierOptions',
          args: { code: '20752' },
        },
      ])
      .respondWithTools([{
        name: 'previewCart',
        args: {},
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Bạn có thể chọn nước cho Combo Đẫy Đà 129K.',
      }))
      .respond(selectedActionResponse('Đã chọn Pepsi (Đại).'))
      .respond(selectedActionResponse('Đã cập nhật lựa chọn nước.'))
      .respond(selectedActionResponse('Đã cập nhật lựa chọn nước.'));
    const store = new MemoryStore();
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
      fixtures: await loadGeneratedFixtures(process.cwd()),
      ...testAgent(model),
    });
    const sessionId = 'kfc:customer_1';
    await authenticateKfcAction(server, sessionId, 'customer_1');

    const modifierResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_modifier_message_1',
        text: 'Cho mình 2 Combo Đẫy Đà và tùy chỉnh nước',
      },
    });

    expect(modifierResponse.statusCode, modifierResponse.body).toBe(200);
    expect(
      modifierResponse.json().genUi,
      modifierResponse.body,
    ).toMatchObject({ widgetKind: 'modifierPicker' });
    const select = async (
      sourceAttachment: {
        id: string;
        actions: Array<{
          id: string;
          payload?: { groupId: string; modifierId: string };
        }>;
      },
      groupId: string,
      modifierId: string,
      clientMessageId: string,
    ) => {
      const actions = sourceAttachment.actions;
      const action = actions.find(
        (candidate) =>
          candidate.payload?.groupId === groupId &&
          candidate.payload.modifierId === modifierId,
      );
      expect(action).toBeDefined();
      return server.inject({
        method: 'POST',
        url: '/chat/kfc/genui-action',
        payload: {
          sessionId,
          customerId: 'customer_1',
          clientMessageId,
          action: {
            attachmentId: sourceAttachment.id,
            actionId: action!.id,
          },
        },
      });
    };

    const firstDrink = await select(
      modifierResponse.json().genUi,
      '2',
      '41091',
      'kfc_genui_modifier_action_1',
    );
    expect(firstDrink.statusCode, firstDrink.body).toBe(200);
    expect(firstDrink.json().responseText).toContain('Pepsi (Đại)');
    expect(firstDrink.json()).not.toHaveProperty('state');
    expect((await loadPriorVerifiedState(store, sessionId)).cart).toMatchObject({
      items: [{
        itemCode: '20752',
        quantity: 2,
        unitPriceVnd: 136000,
        modifiers: [{ groupId: '2', modifierId: '41091', priceDeltaVnd: 7000 }],
      }],
      totalVnd: 272000,
    });

    const secondDrink = await select(
      firstDrink.json().genUi,
      '3',
      '41091',
      'kfc_genui_modifier_action_2',
    );
    expect(secondDrink.statusCode, secondDrink.body).toBe(200);
    expect(secondDrink.json()).not.toHaveProperty('state');
    expect((await loadPriorVerifiedState(store, sessionId)).cart).toMatchObject({
      items: [{
        itemCode: '20752',
        quantity: 2,
        unitPriceVnd: 143000,
        modifiers: [
          { groupId: '2', modifierId: '41091', priceDeltaVnd: 7000 },
          { groupId: '3', modifierId: '41091', priceDeltaVnd: 7000 },
        ],
      }],
      totalVnd: 286000,
    });

    const changeFirstDrink = await select(
      secondDrink.json().genUi,
      '2',
      '41090',
      'kfc_genui_modifier_action_3',
    );
    expect(changeFirstDrink.statusCode, changeFirstDrink.body).toBe(200);
    expect(changeFirstDrink.json()).not.toHaveProperty('state');
    const changedState = await loadPriorVerifiedState(store, sessionId);
    expect(changedState.cart).toMatchObject({
      items: [{
        itemCode: '20752',
        quantity: 2,
        unitPriceVnd: 140000,
        modifiers: expect.arrayContaining([
          expect.objectContaining({
            groupId: '2',
            modifierId: '41090',
            priceDeltaVnd: 4000,
          }),
          expect.objectContaining({
            groupId: '3',
            modifierId: '41091',
            priceDeltaVnd: 7000,
          }),
        ]),
      }],
      totalVnd: 280000,
    });
    expect(
      changedState.cart?.items[0]?.modifiers,
    ).toHaveLength(2);
    expect(changedState.toolTrace?.at(-1)).toMatchObject({
      toolName: 'updateCart',
      ok: true,
    });
  });

  it('places the ready order when confirm_order GenUI action is submitted', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: {
          scope: 'filtered',
          query: 'Combo Hợp Gu 99K',
          purpose: 'recommend',
        },
      }])
      .respondWithTools([
        {
          name: 'updateCart',
          args: {
            changes: [{
              itemCode: '20751',
              quantity: 1,
              modifiers: [],
            }],
          },
        },
      ])
      .respond(groundedResponseModelReply({
        customerText: 'Đã chuẩn bị Combo Hợp Gu 99K.',
      }))
      .respondWithTools([{
        name: 'quoteFulfillment',
        args: {
          address: {
            label: null,
            line1: 'Big C Đồng Nai',
            district: 'Biên Hòa',
            city: 'Đồng Nai',
          },
          savedAddressRef: null,
          method: 'delivery',
        },
      }])
      .respondWithTools([{
        name: 'checkStoreAvailability',
        args: {
          storeId: 'KFCVN0002',
          disposition: 'delivery',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Thông tin giao hàng đã được kiểm tra.',
      }))
      .respond(selectedActionResponse(
        'Thông tin giao hàng đã được xác nhận.',
      ));
    const baseFixtures = createTestFixtures();
    const store = new MemoryStore();
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
      confirmationApprovalKeyRing:
        createConfirmationApprovalKeyRing({
          active: {
            keyId: 'genui-confirm-order',
            secret:
              'genui-confirm-order-approval-test-secret-32-bytes',
          },
        }),
      fixtures: createTestFixtures({
        menuItems: baseFixtures.menuItems.map((item) =>
          item.code === '20751'
            ? { ...item, isCustomize: false }
            : item),
        menuModifiers: [],
      }),
      checkpointer: new MemorySaver(),
      mockClientOptions: {
        fulfillmentQuoteProvider: async (input) => ({
          ok: true,
          value: {
            storeId: input.storeId,
            feeVnd: 31000,
            etaMinutes: 42,
          },
          message: 'quoted',
        }),
      },
      ...testAgent(model),
    });
    const sessionId = 'kfc:customer_1';
    await authenticateKfcAction(server, sessionId, 'customer_1');

    await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_message_1',
        text: 'Cho mình 1 Combo Hợp Gu 99K',
      },
    });
    const fulfillmentResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_message_2',
        text: 'Giao tới Big C Đồng Nai, Biên Hòa, Đồng Nai',
      },
    });

    expect(
      fulfillmentResponse.json().genUi,
      fulfillmentResponse.body,
    ).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
    });

    const acceptedFulfillmentResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_accept_fulfillment_1',
        action: {
          attachmentId: fulfillmentResponse.json().genUi.id,
          actionId: 'accept_fulfillment',
          value: 'accepted',
        },
      },
    });
    expect(
      acceptedFulfillmentResponse.statusCode,
      acceptedFulfillmentResponse.body,
    ).toBe(200);
    expect(acceptedFulfillmentResponse.json().genUi).toMatchObject({
      widgetKind: 'orderReviewConfirm',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_action_1',
        action: {
          attachmentId: acceptedFulfillmentResponse.json().genUi.id,
          actionId: 'confirm_order',
          value: 'confirmed',
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      status: 'paused',
      pause: { capability: 'placeOrder', requestId: expect.any(String) },
    });
    expect(body).not.toHaveProperty('state');
    const pausedState = await loadPriorVerifiedState(
      store,
      sessionId,
    );
    expect(pausedState.order).toBeUndefined();
    expect(
      pausedState.toolTrace?.map(({ toolName }) => toolName),
    ).not.toContain('placeOrder');
  });

  it('adds the selected menu quantities from one trusted smartMenuPicker confirmation', async () => {
    const baseFixtures = createTestFixtures();
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: {
          scope: 'filtered',
          query: 'Combo Hợp Gu 99K',
          purpose: 'recommend',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Đây là combo phù hợp.',
      }))
      .respond(selectedActionResponse(
        'Đã thêm 2 Combo Hợp Gu 99K vào giỏ.',
      ));
    const store = new MemoryStore();
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
      fixtures: createTestFixtures({
        menuItems: baseFixtures.menuItems.map((item) =>
          item.code === '20751'
            ? { ...item, isCustomize: false }
            : item),
        menuModifiers: [],
      }),
      ...testAgent(model),
    });
    const sessionId = 'kfc:customer_1';
    await authenticateKfcAction(server, sessionId, 'customer_1');

    const menuResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_menu_1',
        text: 'Gợi ý combo',
      },
    });

    expect(menuResponse.statusCode).toBe(200);
    expect(menuResponse.json().genUi).toMatchObject({
      widgetKind: 'smartMenuPicker',
    });

    const actionResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_menu_action_1',
        action: {
          attachmentId: menuResponse.json().genUi.id,
          actionId: 'add_items',
          payload: {
            items: [{ itemCode: '20751', quantity: 2 }],
          },
        },
      },
    });

    expect(actionResponse.statusCode, actionResponse.body).toBe(200);
    const body = actionResponse.json();
    expect(body).not.toHaveProperty('state');
    expect((await loadPriorVerifiedState(store, sessionId)).cart?.items).toEqual([
      expect.objectContaining({
        itemCode: '20751',
        name: 'Combo Hợp Gu 99K',
        quantity: 2,
        imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      }),
    ]);
    expect(body.genUi).toMatchObject({
      widgetKind: 'cartBuilder',
      data: {
        cart: {
          items: [
            expect.objectContaining({
              itemCode: '20751',
              imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
            }),
          ],
        },
      },
    });
    expect(
      (await loadPriorVerifiedState(store, sessionId)).toolTrace?.map(
        ({ toolName }) => toolName,
      ),
    ).toContain('updateCart');
  });

  it('acknowledges only the trusted menu selection instead of an unrelated composed cart summary', async () => {
    const baseFixtures = createTestFixtures();
    const fixtures = createTestFixtures({
      menuItems: [
        ...baseFixtures.menuItems,
        {
          ...baseFixtures.menuItems[0]!,
          code: '41174',
          itemId: '41174',
          posItemId: '150080',
          productCode: 'BUCKET-5-COB_HDE',
          name: 'Xô Zòn Zã 179K',
          description: 'Xô 5 Miếng Gà',
          priceVnd: 179000,
          imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-5-COB_HDE.jpg?v=LNN7PL',
          productUrlSlug: 'xozonza5co_179',
          builderUrl: 'https://www.kfcvietnam.com.vn/order/delivery/hot-deal/xozonza5co_179/builder',
          isCustomize: false,
          isQuickCombo: false,
        },
      ],
    });
    const store = new MemoryStore();
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
      fixtures,
      ...testAgent(
        fakeModel()
          .respondWithTools([{
            name: 'searchMenu',
            args: {
              scope: 'all',
              query: null,
              purpose: 'browse',
            },
          }])
          .respond(groundedResponseModelReply({
            customerText: 'Đây là toàn bộ thực đơn hiện có.',
          }))
          .respond(selectedActionResponse(
            'Đã thêm 2 Xô Zòn Zã 179K vào giỏ.',
          )),
      ),
    });
    const sessionId = 'kfc:customer_1';
    await authenticateKfcAction(server, sessionId, 'customer_1');

    const menuResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_exact_menu_1',
        text: 'Cho tôi xem menu',
      },
    });

    expect(menuResponse.statusCode).toBe(200);
    expect(menuResponse.json().genUi).toMatchObject({
      widgetKind: 'fullMenuBrowser',
    });

    const actionResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_exact_menu_action_1',
        action: {
          attachmentId: menuResponse.json().genUi.id,
          actionId: 'add_items',
          payload: {
            items: [{ itemCode: '41174', quantity: 2 }],
          },
        },
      },
    });

    expect(actionResponse.statusCode, actionResponse.body).toBe(200);
    expect(actionResponse.json().responseText).toContain('Xô Zòn Zã 179K');
    expect(actionResponse.json().responseText).not.toContain('Xô Zui Zẻ');
    expect(actionResponse.json()).not.toHaveProperty('state');
    expect((await loadPriorVerifiedState(store, sessionId)).cart?.items).toEqual([
      expect.objectContaining({ itemCode: '41174', name: 'Xô Zòn Zã 179K', quantity: 2 }),
    ]);
  });
});
