import { fakeModel } from '@langchain/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoAdminServer as createServer } from '../fixtures/demoAdminServer.js';
import type { MessengerClient, ZaloClient } from '../../src/clients/interfaces.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { signedMessengerWebhook, TEST_META_APP_SECRET } from '../fixtures/signedMessengerWebhook.js';
import { testAgent } from '../fixtures/testAgent.js';

const buildServer = (options: Parameters<typeof createServer>[0] = {}) =>
  createServer({ metaAppSecret: TEST_META_APP_SECRET, ...options });

const deliveryClients = vi.hoisted(() => ({
  messenger: null as MessengerClient | null,
  zalo: null as ZaloClient | null,
}));

vi.mock('../../src/channels/messenger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/channels/messenger.js')>();
  return {
    ...actual,
    createMessengerClient: vi.fn((options) =>
      deliveryClients.messenger ?? actual.createMessengerClient(options),
    ),
  };
});

vi.mock('../../src/channels/zalo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/channels/zalo.js')>();
  return {
    ...actual,
    createZaloClient: vi.fn((options) =>
      deliveryClients.zalo ?? actual.createZaloClient(options),
    ),
  };
});

function menuAuthorModel() {
  return fakeModel()
    .respondWithTools([{
      name: 'searchMenu',
      args: { scope: 'filtered', query: 'Combo Hợp Gu 99K' , purpose: 'browse'},
    }])
    .respondWithTools([{
      name: 'getItemDetails',
      args: { code: '20751' },
    }])
    .respond(groundedResponseModelReply({
      customerText: 'Combo Hợp Gu 99K đang có giá 99.000đ.',
      evidenceReferences: (publication) => publication.evidence
        .filter(({ evidenceId }) =>
          evidenceId.startsWith('current:getItemDetails:'))
        .map(({ evidenceId }) => ({
          evidenceId,
          claimKinds: ['product', 'price'],
        })),
    }));
}

describe('channel media throw delivery isolation', () => {
  beforeEach(() => {
    deliveryClients.messenger = null;
    deliveryClients.zalo = null;
  });

  it('keeps Messenger text sent and records failed media items when sendMedia throws', async () => {
    const store = new MemoryStore();
    const providerSentinel =
      'MESSENGER_MEDIA_SECRET bearer=private-provider-token';
    let turnDuringMedia: Awaited<ReturnType<MemoryStore['listTurns']>>[number] | undefined;
    deliveryClients.messenger = {
      async sendText() {
        return { ok: true, value: { messageId: 'messenger_text_before_throw' }, message: 'sent' };
      },
      async sendTextWithOutcome() {
        return {
          status: 'confirmed_sent',
          messageId: 'messenger_text_before_throw',
        };
      },
      async sendMedia() {
        turnDuringMedia = (await store.listTurns('messenger:psid_media_throw')).at(-1);
        throw new Error(providerSentinel);
      },
      async sendSenderAction(recipientId) {
        return { ok: true, value: { recipientId }, message: 'sent' };
      },
      async getProfile() {
        return { ok: false, errorCode: 'profile_unavailable', message: 'not needed' };
      },
    };
    const server = buildServer({
      store,
      messengerVerifyToken: 'local_verify',
      metaPageId: '118976205445198',
      ...testAgent(menuAuthorModel()),
    });

    const response = await server.inject(signedMessengerWebhook({
        object: 'page',
        entry: [{
          id: '118976205445198',
          messaging: [{
            sender: { id: 'psid_media_throw' },
            recipient: { id: '118976205445198' },
            message: { mid: 'mid_media_throw', text: 'xem menu' },
          }],
        }],
    }));

    expect(response.json()).toMatchObject({ processed: 1, failed: 0 });
    expect(turnDuringMedia).toMatchObject({
      deliveryStatus: 'sent',
      externalMessageId: 'messenger_text_before_throw',
    });
    expect((await store.listTurns('messenger:psid_media_throw')).at(-1)).toMatchObject({
      deliveryStatus: 'sent',
      externalMessageId: 'messenger_text_before_throw',
    });
    const eventsResponse = await server.inject({
      method: 'GET',
      url: '/dashboard/events/messenger:psid_media_throw',
    });
    expect(eventsResponse.json().events).toEqual(
      expect.arrayContaining([expect.objectContaining({
        type: 'assistant_reply_sent',
        payload: expect.objectContaining({
          deliveryStatus: 'sent',
          textDeliveryStatus: 'sent',
          mediaDeliveryStatus: 'failed',
          mediaItems: expect.arrayContaining([expect.objectContaining({
            status: 'failed',
            errorCode: 'messenger_media_send_failed',
            errorMessage: 'messenger media delivery failed',
          })]),
        }),
      })]),
    );
    expect(eventsResponse.body).not.toContain(providerSentinel);
  });

  it('keeps Zalo text sent and records failed media items when sendMedia throws', async () => {
    const store = new MemoryStore();
    const providerSentinel =
      'ZALO_MEDIA_SECRET bearer=private-provider-token';
    let turnDuringMedia: Awaited<ReturnType<MemoryStore['listTurns']>>[number] | undefined;
    deliveryClients.zalo = {
      async sendText() {
        return { ok: true, value: { messageId: 'zalo_text_before_throw' }, message: 'sent' };
      },
      async sendTextWithOutcome() {
        return {
          status: 'confirmed_sent',
          messageId: 'zalo_text_before_throw',
        };
      },
      async sendMedia() {
        turnDuringMedia = (await store.listTurns('zalo:zalo_media_throw')).at(-1);
        throw new Error(providerSentinel);
      },
      async getProfile() {
        return { ok: false, errorCode: 'profile_unavailable', message: 'not needed' };
      },
    };
    const server = buildServer({
      store,
      zaloOaId: 'oa_local',
      ...testAgent(menuAuthorModel()),
    });

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        sender: { id: 'zalo_media_throw' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'zalo_mid_media_throw', text: 'xem menu' },
      },
    });

    expect(response.json()).toMatchObject({ received: 1, processed: 1, failed: 0 });
    expect(turnDuringMedia).toMatchObject({
      deliveryStatus: 'sent',
      externalMessageId: 'zalo_text_before_throw',
    });
    expect((await store.listTurns('zalo:zalo_media_throw')).at(-1)).toMatchObject({
      deliveryStatus: 'sent',
      externalMessageId: 'zalo_text_before_throw',
    });
    const eventsResponse = await server.inject({
      method: 'GET',
      url: '/dashboard/events/zalo:zalo_media_throw',
    });
    expect(eventsResponse.json().events).toEqual(
      expect.arrayContaining([expect.objectContaining({
        type: 'assistant_reply_sent',
        payload: expect.objectContaining({
          deliveryStatus: 'sent',
          textDeliveryStatus: 'sent',
          mediaDeliveryStatus: 'failed',
          mediaItems: expect.arrayContaining([expect.objectContaining({
            status: 'failed',
            errorCode: 'zalo_media_send_failed',
            errorMessage: 'zalo media delivery failed',
          })]),
        }),
      })]),
    );
    expect(eventsResponse.body).not.toContain(providerSentinel);
  });

  it('preserves partial media polarity while redacting returned provider failures', async () => {
    const store = new MemoryStore();
    const providerSentinel =
      'RETURNED_MEDIA_SECRET bearer=private-provider-token';
    const providerCodeSentinel = 'private_provider_error_code';
    deliveryClients.messenger = {
      async sendText() {
        return {
          ok: true,
          value: { messageId: 'messenger_text_before_partial' },
          message: 'sent',
        };
      },
      async sendTextWithOutcome() {
        return {
          status: 'confirmed_sent',
          messageId: 'messenger_text_before_partial',
        };
      },
      async sendMedia(_recipientId, media) {
        const sentItem = media[0];
        if (!sentItem) {
          throw new Error('test_media_fixture_missing');
        }
        return {
          status: 'partial',
          items: [
            {
              key: sentItem.key,
              status: 'sent',
              messageId: 'provider-media-sent',
            },
            {
              key: media[1]?.key ?? `${sentItem.key}-failed`,
              status: 'failed',
              errorCode: providerCodeSentinel,
              errorMessage: providerSentinel,
            },
          ],
        };
      },
      async sendSenderAction(recipientId) {
        return {
          ok: true,
          value: { recipientId },
          message: 'sent',
        };
      },
      async getProfile() {
        return {
          ok: false,
          errorCode: 'profile_unavailable',
          message: 'not needed',
        };
      },
    };
    const server = buildServer({
      store,
      messengerVerifyToken: 'local_verify',
      metaPageId: '118976205445198',
      ...testAgent(menuAuthorModel()),
    });

    const response = await server.inject(signedMessengerWebhook({
      object: 'page',
      entry: [{
        id: '118976205445198',
        messaging: [{
          sender: { id: 'psid_media_partial' },
          recipient: { id: '118976205445198' },
          message: {
            mid: 'mid_media_partial',
            text: 'xem menu',
          },
        }],
      }],
    }));

    expect(response.json()).toMatchObject({
      processed: 1,
      failed: 0,
    });
    expect(
      (await store.listTurns('messenger:psid_media_partial')).at(-1),
    ).toMatchObject({
      deliveryStatus: 'sent',
      externalMessageId: 'messenger_text_before_partial',
    });
    const eventsResponse = await server.inject({
      method: 'GET',
      url: '/dashboard/events/messenger:psid_media_partial',
    });
    expect(eventsResponse.json().events).toEqual(
      expect.arrayContaining([expect.objectContaining({
        type: 'assistant_reply_sent',
        payload: expect.objectContaining({
          deliveryStatus: 'sent',
          textDeliveryStatus: 'sent',
          mediaDeliveryStatus: 'partial',
          mediaItems: expect.arrayContaining([
            expect.objectContaining({
              status: 'sent',
              messageId: 'provider-media-sent',
            }),
            expect.objectContaining({
              status: 'failed',
              errorCode: 'messenger_media_send_failed',
              errorMessage: 'messenger media delivery failed',
            }),
          ]),
        }),
      })]),
    );
    expect(eventsResponse.body).not.toContain(providerSentinel);
    expect(eventsResponse.body).not.toContain(
      providerCodeSentinel,
    );
  });
});
