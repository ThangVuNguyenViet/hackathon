import { describe, expect, it, vi } from 'vitest';
import { createChatRouteHandlers } from '../../src/api/routeChatHandlers.js';
import type { RouteHandlerContext } from '../../src/api/routeHandlerContext.js';
import {
  kfcGenUiVerifiedStateRevision,
  type KfcGenUiAttachment,
} from '../../src/genui/kfcGenUi.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';

type AgentResponseInput = Parameters<
  RouteHandlerContext['kfcAgentResponse']
>[0];

function actionAttachment(input: {
  sessionId: string;
  customerId: string;
  verifiedRevision: string;
}): KfcGenUiAttachment {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 60_000).toISOString();
  return {
    id: 'trusted-cart-attachment',
    lifecycleStage: 'cart',
    widgetKind: 'cartBuilder',
    status: 'active',
    title: 'Cart',
    data: {
      cart: {
        items: [{
          itemCode: '20751',
          name: 'Combo 99K',
        }],
      },
    },
    actions: [{
      id: 'update_item_quantity',
      label: 'Update quantity',
    }],
    expiresAt,
    authority: {
      schemaVersion: 'kfc-genui-v1',
      sessionId: input.sessionId,
      customerId: input.customerId,
      verifiedRevision: input.verifiedRevision,
      actionLifecycle: 'replayable',
      issuedAt: issuedAt.toISOString(),
      expiresAt,
    },
  };
}

async function actionHandlerHarness(input?: {
  latestVerifiedState?: Record<string, unknown>;
  attachmentFactory?: (input: {
    sessionId: string;
    customerId: string;
    verifiedRevision: string;
  }) => KfcGenUiAttachment;
}) {
  const sessionId = 'kfc:trusted-action-customer';
  const customerId = 'trusted-action-customer';
  const authoritativeState = {};
  const store = new MemoryStore();
  const attachment = (input?.attachmentFactory ?? actionAttachment)({
    sessionId,
    customerId,
    verifiedRevision: kfcGenUiVerifiedStateRevision(authoritativeState),
  });
  const sourceTurn = await store.appendTurn({
    sessionId,
    channel: 'kfc',
    role: 'assistant',
    text: 'Cart',
    externalMessageId: null,
    externalUserId: customerId,
    deliveryStatus: 'sent',
    metadata: { genUi: attachment },
  });
  await store.appendEvent(sessionId, 'graph:verified_state', {
    verifiedState: input?.latestVerifiedState ?? authoritativeState,
  });
  const calls: AgentResponseInput[] = [];
  const kfcAgentResponse = vi.fn(async (agentInput: AgentResponseInput) => {
    calls.push(agentInput);
    return {
      status: 200,
      body: { acceptedByTestBoundary: true },
    };
  });
  const handlers = createChatRouteHandlers({
    store,
    kfcProofAccessContext: async () => controlledCustomerAccess({
      sessionId,
      customerId,
    }),
    kfcAgentResponse,
  } as unknown as RouteHandlerContext);

  return {
    sessionId,
    customerId,
    attachment,
    sourceTurn,
    calls,
    handlers,
  };
}

describe('trusted GenUI action route boundary', () => {
  it('accepts a selected batch from the full menu browser', async () => {
    const harness = await actionHandlerHarness({
      attachmentFactory: ({ sessionId, customerId, verifiedRevision }) => {
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + 60_000).toISOString();
        return {
          id: 'trusted-full-menu-attachment',
          lifecycleStage: 'menu',
          widgetKind: 'fullMenuBrowser',
          status: 'active',
          title: 'Full menu',
          data: {
            items: [{
              code: '20751',
              name: 'Combo 99K',
              available: true,
            }],
          },
          actions: [{ id: 'add_items', label: 'Confirm items' }],
          expiresAt,
          authority: {
            schemaVersion: 'kfc-genui-v1',
            sessionId,
            customerId,
            verifiedRevision,
            actionLifecycle: 'one_shot',
            issuedAt: issuedAt.toISOString(),
            expiresAt,
          },
        };
      },
    });

    const response = await harness.handlers.chatKfcGenUiAction({
      sessionId: harness.sessionId,
      customerId: harness.customerId,
      clientMessageId: 'trusted-full-menu-selection-1',
      action: {
        attachmentId: harness.attachment.id,
        actionId: 'add_items',
        payload: {
          items: [{ itemCode: '20751', quantity: 2 }],
        },
      },
    });

    expect(response).toEqual({
      status: 200,
      body: { acceptedByTestBoundary: true },
    });
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.trustedCustomerAction?.command).toEqual({
      kind: 'cart_batch_update',
      items: [{ itemCode: '20751', quantity: 2 }],
    });
  });

  it('passes provenance and the strict command separately from persisted metadata', async () => {
    const harness = await actionHandlerHarness();
    const response = await harness.handlers.chatKfcGenUiAction({
      sessionId: harness.sessionId,
      customerId: harness.customerId,
      clientMessageId: 'trusted-action-request-1',
      action: {
        attachmentId: harness.attachment.id,
        actionId: 'update_item_quantity',
        value: 'caller-controlled-display-text',
        payload: {
          itemCode: '20751',
          quantity: 2,
        },
      },
    });

    expect(response).toEqual({
      status: 200,
      body: { acceptedByTestBoundary: true },
    });
    expect(harness.calls).toHaveLength(1);
    const call = harness.calls[0]!;
    expect(call.text).toBe('');
    expect(call.metadata).not.toHaveProperty('customerCommand');
    expect(call.metadata.rawEvent).toMatchObject({
      source: 'kfc_genui_action',
      assistantTurnId: harness.sourceTurn.id,
      schemaVersion: 'kfc-genui-v1',
      verifiedRevision: harness.attachment.authority!.verifiedRevision,
      actionDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(call.trustedCustomerAction).toEqual({
      source: 'kfc_genui_action',
      assistantTurnId: harness.sourceTurn.id,
      attachmentId: harness.attachment.id,
      actionDigest: call.metadata.rawEvent!.actionDigest,
      verifiedRevision: harness.attachment.authority!.verifiedRevision,
      lifecycle: 'replayable',
      command: {
        kind: 'cart_update',
        itemCode: '20751',
        quantity: 2,
      },
    });
  });

  it('does not construct authority from legacy customerCommand request metadata', async () => {
    const harness = await actionHandlerHarness();
    const response = await harness.handlers.chatKfcMessage({
      sessionId: harness.sessionId,
      customerId: harness.customerId,
      clientMessageId: 'untrusted-metadata-request-1',
      text: 'ordinary presentation text',
      metadata: {
        source: 'kfc_genui_action',
        customerCommand: { kind: 'confirm_order' },
        trustedCustomerAction: {
          source: 'kfc_genui_action',
          command: { kind: 'confirm_order' },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]!.trustedCustomerAction).toBeUndefined();
    expect(harness.calls[0]!.text).toBe('ordinary presentation text');
    expect(harness.calls[0]!.metadata).not.toHaveProperty('customerCommand');
    expect(harness.calls[0]!.metadata.rawEvent).toEqual({
      source: 'kfc_chat',
    });
  });

  it('rejects unbounded action identifiers and values at the request boundary', async () => {
    const harness = await actionHandlerHarness();
    for (const action of [
      {
        attachmentId: 'a'.repeat(257),
        actionId: 'update_item_quantity',
      },
      {
        attachmentId: harness.attachment.id,
        actionId: 'a'.repeat(257),
      },
      {
        attachmentId: harness.attachment.id,
        actionId: 'update_item_quantity',
        value: 'v'.repeat(1_001),
      },
      {
        attachmentId: harness.attachment.id,
        actionId: 'update_item_quantity',
        trustedCustomerAction: {
          source: 'kfc_genui_action',
          command: { kind: 'confirm_order' },
        },
      },
    ]) {
      const response = await harness.handlers.chatKfcGenUiAction({
        sessionId: harness.sessionId,
        customerId: harness.customerId,
        clientMessageId: crypto.randomUUID(),
        action,
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        errorCode: 'invalid_kfc_genui_action_payload',
      });
    }
    expect(harness.calls).toHaveLength(0);
  });

  it('rejects stale authority before passing an envelope into the runtime', async () => {
    const harness = await actionHandlerHarness({
      latestVerifiedState: {
        cart: {
          id: 'new-cart',
          items: [],
          subtotalVnd: 0,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 0,
          voucherCode: null,
        },
      },
    });
    const response = await harness.handlers.chatKfcGenUiAction({
      sessionId: harness.sessionId,
      customerId: harness.customerId,
      clientMessageId: 'stale-action-request-1',
      action: {
        attachmentId: harness.attachment.id,
        actionId: 'update_item_quantity',
        payload: {
          itemCode: '20751',
          quantity: 2,
        },
      },
    });

    expect(response).toEqual({
      status: 409,
      body: { errorCode: 'stale_action_revision' },
    });
    expect(harness.calls).toHaveLength(0);
  });

  it('rejects missing, excessive, or action-inappropriate quantities before runtime', async () => {
    for (const [suffix, payload] of [
      ['missing', { itemCode: '20751' }],
      ['excessive', { itemCode: '20751', quantity: 100 }],
      ['extra', { itemCode: '20751', quantity: 2, note: 'not allowed' }],
    ] as const) {
      const harness = await actionHandlerHarness();
      const response = await harness.handlers.chatKfcGenUiAction({
        sessionId: harness.sessionId,
        customerId: harness.customerId,
        clientMessageId: `invalid-action-${suffix}`,
        action: {
          attachmentId: harness.attachment.id,
          actionId: 'update_item_quantity',
          payload,
        },
      });

      expect(response).toEqual({
        status: 422,
        body: { errorCode: 'invalid_action_payload' },
      });
      expect(harness.calls).toHaveLength(0);
    }
  });

  it('binds a pre-issued payment action to its exact method while a generic picker remains selectable', async () => {
    const paymentAttachment = (
      preboundMethodId: string | undefined,
    ) => actionHandlerHarness({
      attachmentFactory: ({ sessionId, customerId, verifiedRevision }) => {
        const issuedAt = new Date();
        const expiresAt =
          new Date(issuedAt.getTime() + 60_000).toISOString();
        return {
          id: `payment-${preboundMethodId ?? 'generic'}`,
          lifecycleStage: 'payment_method',
          widgetKind: 'paymentMethodPicker',
          status: 'active',
          title: 'Payment methods',
          data: {
            paymentMethodCollection: {
              collectionKey: 'payment:all',
              collectionRevision: 'collection-revision-1',
              providerRevision: 'provider-revision-1',
            },
            methods: [
              {
                methodId: 'opaque-method-a',
                displayName: 'Method A',
                supported: true,
                supportStatus: 'listed_supported',
              },
              {
                methodId: 'opaque-method-b',
                displayName: 'Method B',
                supported: true,
                supportStatus: 'listed_supported',
              },
            ],
          },
          actions: [{
            id: 'select_payment_method',
            label: 'Select payment method',
            ...(preboundMethodId
              ? { payload: { methodId: preboundMethodId } }
              : {}),
          }],
          expiresAt,
          authority: {
            schemaVersion: 'kfc-genui-v1',
            sessionId,
            customerId,
            verifiedRevision,
            actionLifecycle: 'replayable',
            issuedAt: issuedAt.toISOString(),
            expiresAt,
          },
        };
      },
    });

    const prebound = await paymentAttachment('opaque-method-a');
    await expect(prebound.handlers.chatKfcGenUiAction({
      sessionId: prebound.sessionId,
      customerId: prebound.customerId,
      clientMessageId: 'switched-prebound-payment',
      action: {
        attachmentId: prebound.attachment.id,
        actionId: 'select_payment_method',
        payload: { methodId: 'opaque-method-b' },
      },
    })).resolves.toEqual({
      status: 422,
      body: { errorCode: 'invalid_action_payload' },
    });
    expect(prebound.calls).toHaveLength(0);

    await expect(prebound.handlers.chatKfcGenUiAction({
      sessionId: prebound.sessionId,
      customerId: prebound.customerId,
      clientMessageId: 'exact-prebound-payment',
      action: {
        attachmentId: prebound.attachment.id,
        actionId: 'select_payment_method',
        payload: { methodId: 'opaque-method-a' },
      },
    })).resolves.toMatchObject({ status: 200 });
    expect(prebound.calls[0]?.trustedCustomerAction?.command).toEqual({
      kind: 'select_payment_method',
      selection: {
        methodId: 'opaque-method-a',
        collectionKey: 'payment:all',
        collectionRevision: 'collection-revision-1',
        providerRevision: 'provider-revision-1',
      },
    });

    const generic = await paymentAttachment(undefined);
    await expect(generic.handlers.chatKfcGenUiAction({
      sessionId: generic.sessionId,
      customerId: generic.customerId,
      clientMessageId: 'generic-picker-payment',
      action: {
        attachmentId: generic.attachment.id,
        actionId: 'select_payment_method',
        payload: { methodId: 'opaque-method-b' },
      },
    })).resolves.toMatchObject({ status: 200 });
    expect(generic.calls[0]?.trustedCustomerAction?.command).toMatchObject({
      kind: 'select_payment_method',
      selection: { methodId: 'opaque-method-b' },
    });
  });
});
