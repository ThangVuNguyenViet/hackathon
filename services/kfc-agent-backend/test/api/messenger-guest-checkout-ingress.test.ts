import { createHmac } from 'node:crypto';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  createConfirmationApprovalKeyRing,
} from '../../src/api/confirmationApprovalCapability.js';
import {
  createRouteHandlers,
} from '../../src/api/routeHandlers.js';
import { buildServer } from '../../src/api/server.js';
import {
  mockInventoryProviderRevision,
} from '../../src/mock/mockInventoryAuthority.js';
import {
  exactCartAvailabilityRevision,
} from '../../src/ordering/exactCartAvailabilityAuthority.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  verifyMessengerGuestCheckoutIngress,
} from '../../src/security/guestCheckoutAuthority.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import {
  signedMessengerWebhook,
  TEST_META_APP_SECRET,
} from '../fixtures/signedMessengerWebhook.js';
import { testAgent } from '../fixtures/testAgent.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const pageId = '118976205445198';
const signingSecret =
  'messenger-guest-ingress-approval-secret-32-bytes';

function messengerPayload(input: {
  customerId: string;
  messageId: string;
  text?: string;
  timestamp?: number;
}) {
  const timestamp = input.timestamp ?? Date.now();
  return {
    object: 'page',
    entry: [{
      id: pageId,
      time: timestamp,
      messaging: [{
        sender: { id: input.customerId },
        recipient: { id: pageId },
        timestamp,
        message: {
          mid: input.messageId,
          text: input.text ?? 'Xác nhận đặt đơn này',
        },
      }],
    }],
  };
}

function messengerFetch() {
  return vi.fn(async (
    _url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const body: unknown = JSON.parse(String(init?.body ?? '{}'));
    const senderAction =
      typeof body === 'object' &&
      body !== null &&
      'sender_action' in body &&
      typeof body.sender_action === 'string';
    return new Response(JSON.stringify(
      senderAction
        ? { recipient_id: 'guest-customer' }
        : { message_id: 'guest-assistant-reply' },
    ), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

async function seededGuestStore(customerId: string) {
  const store = new MemoryStore();
  const fixtures = createTestFixtures();
  const cart = {
    id: 'cart-messenger-guest',
    items: [{
      itemCode: '20751',
      name: 'Combo Hợp Gu 99K',
      quantity: 1,
      unitPriceVnd: 99_000,
    }],
    subtotalVnd: 99_000,
    discountVnd: 0,
    deliveryFeeVnd: 18_000,
    totalVnd: 117_000,
    voucherCode: null,
  };
  const observedAt = new Date();
  const inventoryProviderRevision =
    await mockInventoryProviderRevision({
      fixtures,
      profile: {},
    });
  await store.appendEvent(
    `messenger:${customerId}`,
    'graph:verified_state',
    {
      verifiedState: {
        cart,
        address: {
          label: 'Big C Đồng Nai',
          line1: 'Big C Đồng Nai',
          district: 'Biên Hòa',
          city: 'Đồng Nai',
        },
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'KFCVN0002',
          storeName: 'KFC BIG C ĐỒNG NAI',
          feeVnd: 18_000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['20751'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: {
              fixtureMode: 'test_only',
              sourceFile:
                'messenger-guest-checkout-ingress.test.ts',
            },
          },
        },
        orderPreview: {
          id: 'KFC-MOCK-GUEST-PREVIEW',
          cart,
          status: 'previewed',
          paymentStatus: 'not_started',
          assignedStoreId: 'KFCVN0002',
          createdAt: observedAt.toISOString(),
        },
        exactCartAvailabilityObservation: {
          schemaVersion:
            'kfc-exact-cart-availability-observation-v2',
          observationId: 'availability-messenger-guest',
          cartRevision: await exactCartAvailabilityRevision(cart),
          storeId: 'KFCVN0002',
          disposition: 'delivery',
          inventoryProviderRevision: {
            authority: 'inventory_availability',
            revision: inventoryProviderRevision,
          },
          observedAt: observedAt.toISOString(),
          expiresAt: new Date(
            observedAt.getTime() + 5 * 60_000,
          ).toISOString(),
          complete: true,
          rows: [{
            itemCode: '20751',
            quantity: 1,
            status: 'available',
          }],
        },
        toolTrace: [],
      },
    },
  );
  return { store, fixtures };
}

function routeOptions(input: {
  store: MemoryStore;
  fixtures: ReturnType<typeof createTestFixtures>;
  model: ReturnType<typeof fakeModel>;
}) {
  return {
    store: input.store,
    fixtures: input.fixtures,
    confirmationApprovalKeyRing:
      createConfirmationApprovalKeyRing({
        active: {
          keyId: 'messenger-guest-ingress-test',
          secret: signingSecret,
        },
      }),
    metaAppSecret: TEST_META_APP_SECRET,
    messengerBusinessId: 'kfc' as const,
    metaPageId: pageId,
    messengerPageAccessToken: 'page-token',
    messengerGraphApiBaseUrl: 'https://graph.local',
    messengerFetchImpl: messengerFetch(),
    ...testAgent(input.model),
  };
}

async function storedGuestPause(
  store: MemoryStore,
  sessionId: string,
) {
  const pauseEvent = (await store.listEvents(sessionId)).find(
    (event) => event.sourceType === 'confirmation_pause_created',
  );
  const requestId =
    pauseEvent &&
    typeof pauseEvent.payload.requestId === 'string'
      ? pauseEvent.payload.requestId
      : undefined;
  return requestId
    ? store.getConfirmationPause(requestId)
    : undefined;
}

describe('production Messenger guest checkout ingress', () => {
  it('issues exact run-fenced guest authority from signed ingress and persists a placeOrder pause', async () => {
    const customerId = 'guest-signed-order';
    const messageId = 'mid-guest-signed-order';
    const { store, fixtures } = await seededGuestStore(customerId);
    const irreversibleReservation = vi.spyOn(
      store,
      'reserveIrreversibleOperation',
    );
    const server = buildServer(routeOptions({
      store,
      fixtures,
      model: fakeModel()
        .respondWithTools([{
          name: 'placeOrder',
          args: {},
        }])
        .respond(groundedResponseModelReply({
          customerText: 'Please confirm this exact order.',
        })),
    }));

    const response = await server.inject(
      signedMessengerWebhook(messengerPayload({
        customerId,
        messageId,
      })),
    );
    const pause = await storedGuestPause(
      store,
      `messenger:${customerId}`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      received: 1,
      processed: 1,
      failed: 0,
    });
    expect(pause).toMatchObject({
      status: 'pending',
      sessionId: `messenger:${customerId}`,
      customerId,
      channel: 'messenger',
      action: { toolName: 'placeOrder', arguments: {} },
      principal: {
        principalKind: 'guest_checkout',
        channel: 'messenger',
        externalMessageId: messageId,
        sourceRunKind: 'agent_run',
        sessionAuthorityGeneration: 0,
      },
    });
    if (pause?.principal.principalKind !== 'guest_checkout') {
      throw new Error('expected guest checkout pause');
    }
    expect(pause.principal.sourceRunRef).toMatch(/^run_/u);
    expect(irreversibleReservation).toHaveBeenCalledOnce();
    expect(irreversibleReservation.mock.calls[0]?.[0]).toMatchObject({
      operation: 'kfc_synchronous_request',
    });
  });

  it('rejects unsigned ingress before model or provider work', async () => {
    const customerId = 'guest-unsigned-order';
    const { store, fixtures } = await seededGuestStore(customerId);
    const model = fakeModel().respondWithTools([{
      name: 'placeOrder',
      args: {},
    }]);
    const modelInvoke = vi.spyOn(model, 'invoke');
    const irreversibleReservation = vi.spyOn(
      store,
      'reserveIrreversibleOperation',
    );
    const server = buildServer(routeOptions({
      store,
      fixtures,
      model,
    }));

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/messenger',
      payload: messengerPayload({
        customerId,
        messageId: 'mid-guest-unsigned-order',
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(401);
    expect(modelInvoke).not.toHaveBeenCalled();
    expect(irreversibleReservation).not.toHaveBeenCalled();
    expect(
      await storedGuestPause(store, `messenger:${customerId}`),
    ).toBeUndefined();
  });

  it('does not mint guest mutation authority from a mismatched branded ingress', async () => {
    const customerId = 'guest-mismatched-order';
    const messageId = 'mid-guest-mismatched-order';
    const { store, fixtures } = await seededGuestStore(customerId);
    const model = fakeModel()
      .respondWithTools([{
        name: 'placeOrder',
        args: {},
      }])
      .respond(groundedResponseModelReply({
        customerText:
          'I cannot submit an order without verified checkout authority.',
      }));
    const irreversibleReservation = vi.spyOn(
      store,
      'reserveIrreversibleOperation',
    );
    const handlers = createRouteHandlers(routeOptions({
      store,
      fixtures,
      model,
    }));
    const otherPayload = messengerPayload({
      customerId: 'different-customer',
      messageId: 'mid-different-customer',
    });
    const rawOtherPayload = JSON.stringify(otherPayload);
    const mismatchedIngress =
      await verifyMessengerGuestCheckoutIngress({
        rawBody: new TextEncoder().encode(rawOtherPayload),
        signatureHeader: `sha256=${createHmac(
          'sha256',
          TEST_META_APP_SECRET,
        ).update(rawOtherPayload).digest('hex')}`,
        appSecret: TEST_META_APP_SECRET,
        pageId,
      });

    const response = await handlers.messengerWebhook(
      messengerPayload({ customerId, messageId }),
      mismatchedIngress,
    );

    expect(response).toMatchObject({
      status: 200,
      body: { received: 1, failed: 0 },
    });
    expect(irreversibleReservation).toHaveBeenCalledOnce();
    expect(irreversibleReservation.mock.calls[0]?.[0]).toMatchObject({
      operation: 'kfc_synchronous_request',
    });
    expect(
      await storedGuestPause(store, `messenger:${customerId}`),
    ).toBeUndefined();
  });

  it('does not mint guest mutation authority from stale signed ingress', async () => {
    const customerId = 'guest-stale-order';
    const messageId = 'mid-guest-stale-order';
    const { store, fixtures } = await seededGuestStore(customerId);
    const model = fakeModel()
      .respondWithTools([{
        name: 'placeOrder',
        args: {},
      }])
      .respond(groundedResponseModelReply({
        customerText:
          'I cannot submit an order without current checkout authority.',
      }));
    const irreversibleReservation = vi.spyOn(
      store,
      'reserveIrreversibleOperation',
    );
    const server = buildServer(routeOptions({
      store,
      fixtures,
      model,
    }));

    const response = await server.inject(
      signedMessengerWebhook(messengerPayload({
        customerId,
        messageId,
        timestamp: Date.now() - 20 * 60_000,
      })),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      received: 1,
      processed: 1,
      failed: 0,
    });
    expect(irreversibleReservation).toHaveBeenCalledOnce();
    expect(irreversibleReservation.mock.calls[0]?.[0]).toMatchObject({
      operation: 'kfc_synchronous_request',
    });
    expect(
      await storedGuestPause(store, `messenger:${customerId}`),
    ).toBeUndefined();
  });
});
