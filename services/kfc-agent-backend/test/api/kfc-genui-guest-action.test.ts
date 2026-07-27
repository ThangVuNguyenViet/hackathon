import { describe, expect, it, vi } from 'vitest';
import { createChatRouteHandlers } from '../../src/api/routeChatHandlers.js';
import type { RouteHandlerContext } from '../../src/api/routeHandlerContext.js';
import { kfcVietnamPack } from '../../src/businessPacks/kfcVietnam/kfcVietnamPack.js';
import {
  kfcGenUiVerifiedStateRevision,
  type KfcGenUiAttachment,
} from '../../src/genui/kfcGenUi.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createPackStateEnvelope } from '../../src/runtime/businessPack.js';
import { recommendationCartRevision } from '../../src/recommendations/application/tool-execution.js';

describe('KFC GenUI guest actions', () => {
  it('derives ID-only recommendation select/dismiss commands and replays once', async () => {
    const sessionId = 'kfc:recommendation-action-demo';
    const customerId = 'recommendation-action-demo';
    const store = new MemoryStore();
    const cart = {
      id: 'cart-recommendation-1',
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    };
    const cartRevision = await recommendationCartRevision(cart);
    const verifiedState = { cart };
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        state: verifiedState,
      }),
    );
    const attachment: KfcGenUiAttachment = {
      id: 'recommendation-attachment-1',
      lifecycleStage: 'recommendation',
      widgetKind: 'recommendationOffer',
      status: 'active',
      title: 'Gợi ý dành cho bạn',
      data: {
        recommendationId: 'recommendation-1',
        cartRevision,
        actionDigest: 'b'.repeat(64),
        decisionDigest: 'c'.repeat(64),
        versionBindingDigest: 'd'.repeat(64),
        offers: [
          {
            recommendationActionId: 'recommendation-action-1',
            kind: 'product',
            name: 'Gà giòn cay',
            imageUrl: null,
            price: { amount: 49_000, currency: 'VND' },
            priceImpact: { amount: 49_000, currency: 'VND' },
          },
        ],
      },
      actions: [
        {
          id: 'recommendation_select:recommendation-action-1',
          label: 'Thêm vào đơn',
        },
        { id: 'recommendation_dismiss', label: 'Không, cảm ơn' },
      ],
      expiresAt: '2099-01-01T00:00:00.000Z',
      authority: {
        schemaVersion: 'kfc-genui-v1',
        sessionId,
        customerId,
        verifiedRevision: kfcGenUiVerifiedStateRevision(verifiedState),
        actionLifecycle: 'one_shot',
        issuedAt: '2026-07-27T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    };
    const sourceTurn = await store.appendTurn({
      id: 'recommendation-turn-1',
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Mình có một gợi ý cho bạn.',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });
    const kfcAgentResponse = vi.fn(async () => ({
      status: 200,
      body: { responseText: 'Đã thêm món.' },
    }));
    const binding = {
      recommendationId: 'recommendation-1',
      assistantTurnId: sourceTurn.id,
      attachmentId: attachment.id,
      renderedActions: [
        { actionId: 'recommendation-action-1', position: 1 },
      ],
      actionDigest: 'b'.repeat(64),
      decisionDigest: 'c'.repeat(64),
      versionBindingDigest: 'd'.repeat(64),
      sessionId,
      customerId,
      cartRevision,
    };
    const handlers = createChatRouteHandlers({
      store,
      kfcAgentResponse,
      recommendations: {
        application: {
          resolveTrustedAction: vi.fn(async () => ({
            status: 'resolved' as const,
            action: {
              type: 'add_product' as const,
              actionId: 'recommendation-action-1',
              sellableItemId: 'item-1' as never,
              quantity: 1,
              priceImpact: { amount: 49_000, currency: 'VND' as const },
              cartRevision,
            },
            presentation: {
              response: {} as never,
              binding,
            },
          })),
        },
      },
    } as unknown as RouteHandlerContext);

    const request = {
      sessionId,
      customerId,
      clientMessageId: 'recommendation-action-client-1',
      action: {
        attachmentId: attachment.id,
        actionId: 'recommendation_select:recommendation-action-1',
      },
    };
    const selected = await handlers.chatKfcGenUiAction(request);
    expect(selected.status).toBe(200);
    expect(kfcAgentResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        trustedCustomerAction: {
          source: 'kfc_genui_action',
          assistantTurnId: sourceTurn.id,
          attachmentId: attachment.id,
          actionDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          verifiedRevision: attachment.authority!.verifiedRevision,
          lifecycle: 'one_shot',
          command: {
            kind: 'recommendation_select',
            recommendationId: 'recommendation-1',
            recommendationActionId: 'recommendation-action-1',
          },
        },
      }),
    );

    await expect(handlers.chatKfcGenUiAction(request)).resolves.toMatchObject({
      status: 200,
      body: { replayed: true },
    });
    expect(kfcAgentResponse).toHaveBeenCalledOnce();
    await expect(
      handlers.chatKfcGenUiAction({
        ...request,
        clientMessageId: 'recommendation-action-client-forged',
        action: {
          attachmentId: attachment.id,
          actionId: 'recommendation_select:forged-action',
        },
      }),
    ).resolves.toMatchObject({
      status: 404,
      body: { errorCode: 'action_not_found' },
    });
  });

  it('durably replays a committed recommendation action when later model work throws', async () => {
    const sessionId = 'kfc:recommendation-action-model-failure';
    const customerId = 'recommendation-action-model-failure';
    const store = new MemoryStore();
    const cart = {
      id: 'cart-recommendation-model-failure',
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    };
    const cartRevision = await recommendationCartRevision(cart);
    const verifiedState = { cart };
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        state: verifiedState,
      }),
    );
    const attachment: KfcGenUiAttachment = {
      id: 'recommendation-attachment-model-failure',
      lifecycleStage: 'recommendation',
      widgetKind: 'recommendationOffer',
      status: 'active',
      title: 'Gợi ý dành cho bạn',
      data: {
        recommendationId: 'recommendation-model-failure',
        cartRevision,
        actionDigest: 'a'.repeat(64),
        decisionDigest: 'b'.repeat(64),
        versionBindingDigest: 'c'.repeat(64),
        offers: [
          {
            recommendationActionId: 'recommendation-action-model-failure',
          },
        ],
      },
      actions: [
        {
          id: 'recommendation_select:recommendation-action-model-failure',
          label: 'Thêm vào đơn',
        },
      ],
      authority: {
        schemaVersion: 'kfc-genui-v1',
        sessionId,
        customerId,
        verifiedRevision: kfcGenUiVerifiedStateRevision(verifiedState),
        actionLifecycle: 'one_shot',
        issuedAt: '2026-07-27T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const turn = await store.appendTurn({
      id: 'recommendation-turn-model-failure',
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Mình có một gợi ý cho bạn.',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });
    const kfcAgentResponse = vi.fn(
      async (input: {
        completeTrustedCustomerAction?: (receipt: {
          status: 'succeeded' | 'failed' | 'dismissed';
          recommendationId: string;
          recommendationActionId: string | null;
        }) => Promise<void>;
      }) => {
        await input.completeTrustedCustomerAction?.({
          status: 'succeeded',
          recommendationId: 'recommendation-model-failure',
          recommendationActionId: 'recommendation-action-model-failure',
        });
        throw new Error('model unavailable after committed mutation');
      },
    );
    const handlers = createChatRouteHandlers({
      store,
      kfcAgentResponse,
      recommendations: {
        application: {
          resolveTrustedAction: vi.fn(async () => ({
            status: 'resolved' as const,
            action: {
              type: 'add_product' as const,
              actionId: 'recommendation-action-model-failure',
              sellableItemId: 'item-1' as never,
              quantity: 1,
              priceImpact: { amount: 49_000, currency: 'VND' as const },
              cartRevision,
            },
            presentation: {
              response: {} as never,
              binding: {
                recommendationId: 'recommendation-model-failure',
                assistantTurnId: turn.id,
                attachmentId: attachment.id,
                renderedActions: [
                  {
                    actionId: 'recommendation-action-model-failure',
                    position: 1,
                  },
                ],
                actionDigest: 'a'.repeat(64),
                decisionDigest: 'b'.repeat(64),
                versionBindingDigest: 'c'.repeat(64),
                sessionId,
                customerId,
                cartRevision,
              },
            },
          })),
        },
      },
    } as unknown as RouteHandlerContext);
    const request = {
      sessionId,
      customerId,
      clientMessageId: 'recommendation-model-failure-client',
      action: {
        attachmentId: attachment.id,
        actionId:
          'recommendation_select:recommendation-action-model-failure',
      },
    };

    await expect(handlers.chatKfcGenUiAction(request)).resolves.toMatchObject({
      status: 200,
      body: {
        trustedActionResult: {
          status: 'succeeded',
          recommendationId: 'recommendation-model-failure',
        },
      },
    });
    await expect(handlers.chatKfcGenUiAction(request)).resolves.toMatchObject({
      status: 200,
      body: {
        replayed: true,
        trustedActionResult: { status: 'succeeded' },
      },
    });
    expect(kfcAgentResponse).toHaveBeenCalledOnce();
  });

  it('accepts a server-authorized anonymous menu selection without customer authentication', async () => {
    const sessionId = 'kfc:anonymous-demo-customer';
    const customerId = 'anonymous-demo-customer';
    const store = new MemoryStore();
    const verifiedState = {};
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        state: verifiedState,
      }),
    );

    const attachment: KfcGenUiAttachment = {
      id: 'genui-menu-1',
      lifecycleStage: 'menu',
      widgetKind: 'smartMenuPicker',
      status: 'active',
      title: 'Menu',
      data: {
        items: [{ code: 'item-1', name: 'Gà rán' }],
      },
      actions: [{ id: 'add_items', label: 'Xác nhận món' }],
      expiresAt: '2099-01-01T00:00:00.000Z',
      authority: {
        schemaVersion: 'kfc-genui-v1',
        sessionId,
        customerId,
        verifiedRevision: kfcGenUiVerifiedStateRevision(verifiedState),
        actionLifecycle: 'one_shot',
        issuedAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    };
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Menu',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });

    const kfcAgentResponse = vi.fn(async () => ({
      status: 200,
      body: { responseText: 'Đã thêm món.' },
    }));
    const handlers = createChatRouteHandlers({
      store,
      kfcAgentResponse,
    } as unknown as RouteHandlerContext);

    const response = await handlers.chatKfcGenUiAction({
      sessionId,
      customerId,
      clientMessageId: 'client-action-1',
      action: {
        attachmentId: attachment.id,
        actionId: 'add_items',
        payload: {
          items: [{ itemCode: 'item-1', quantity: 1 }],
        },
      },
    });

    expect(response.status).toBe(200);
    expect(kfcAgentResponse).toHaveBeenCalledOnce();
  });

  it('accepts one active modifier draft and rejects inactive nested groups', async () => {
    const sessionId = 'kfc:atomic-modifier-demo';
    const customerId = 'atomic-modifier-demo';
    const store = new MemoryStore();
    const verifiedState = {};
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        state: verifiedState,
      }),
    );
    const attachment: KfcGenUiAttachment = {
      id: 'genui-modifier-1',
      lifecycleStage: 'modifier',
      widgetKind: 'modifierPicker',
      status: 'active',
      title: 'Tùy chỉnh',
      data: {
        modifierTree: {
          itemCode: 'combo',
          modifierGroups: [
            {
              groupId: 'main',
              min: 1,
              options: [
                {
                  modifierId: 'burger',
                  name: 'Burger',
                  modifierGroups: [
                    {
                      groupId: 'spice',
                      min: 1,
                      options: [{ modifierId: 'mild', name: 'Không cay' }],
                    },
                  ],
                },
                {
                  modifierId: 'chicken',
                  name: 'Gà',
                  modifierGroups: [],
                },
              ],
            },
          ],
        },
      },
      actions: [{ id: 'apply_modifiers', label: 'Áp dụng' }],
      expiresAt: '2099-01-01T00:00:00.000Z',
      authority: {
        schemaVersion: 'kfc-genui-v1',
        sessionId,
        customerId,
        verifiedRevision: kfcGenUiVerifiedStateRevision(verifiedState),
        actionLifecycle: 'one_shot',
        issuedAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    };
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Tùy chỉnh',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });
    const receivedInputs: unknown[] = [];
    const kfcAgentResponse = vi.fn(async (input: unknown) => {
      receivedInputs.push(input);
      return {
        status: 200,
        body: { responseText: 'Đã áp dụng.' },
      };
    });
    const handlers = createChatRouteHandlers({
      store,
      kfcAgentResponse,
    } as unknown as RouteHandlerContext);

    const accepted = await handlers.chatKfcGenUiAction({
      sessionId,
      customerId,
      clientMessageId: 'modifier-action-1',
      action: {
        attachmentId: attachment.id,
        actionId: 'apply_modifiers',
        payload: {
          itemCode: 'combo',
          selections: [
            { groupId: 'main', modifierId: 'burger' },
            { groupId: 'spice', modifierId: 'mild' },
          ],
        },
      },
    });
    expect(accepted.status).toBe(200);
    expect(receivedInputs[0]).toMatchObject({
      trustedCustomerAction: {
        lifecycle: 'one_shot',
        command: {
          kind: 'modifier_batch_selection',
          itemCode: 'combo',
          selections: [
            { groupId: 'main', modifierId: 'burger' },
            { groupId: 'spice', modifierId: 'mild' },
          ],
        },
      },
    });

    const rejected = await handlers.chatKfcGenUiAction({
      sessionId,
      customerId,
      clientMessageId: 'modifier-action-2',
      action: {
        attachmentId: attachment.id,
        actionId: 'apply_modifiers',
        payload: {
          itemCode: 'combo',
          selections: [
            { groupId: 'main', modifierId: 'chicken' },
            { groupId: 'spice', modifierId: 'mild' },
          ],
        },
      },
    });
    expect(rejected.status).toBe(422);
  });
});
