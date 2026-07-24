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

describe('KFC GenUI guest actions', () => {
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
