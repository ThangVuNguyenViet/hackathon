import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoAdminServer as createServer } from '../fixtures/demoAdminServer.js';
import type { MessengerClient, ZaloClient } from '../../src/clients/interfaces.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { signedMessengerWebhook, TEST_META_APP_SECRET } from '../fixtures/signedMessengerWebhook.js';

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

const menuPlanner = new StaticToolPlanner([
  {
    intent: 'ordering',
    entities: {},
    toolCalls: [{ toolName: 'searchMenu', arguments: { query: '' } }],
    responseClaims: [],
  },
]);

describe('channel media throw delivery isolation', () => {
  beforeEach(() => {
    deliveryClients.messenger = null;
    deliveryClients.zalo = null;
  });

  it('keeps Messenger text sent and records failed media items when sendMedia throws', async () => {
    const store = new MemoryStore();
    let turnDuringMedia: Awaited<ReturnType<MemoryStore['listTurns']>>[number] | undefined;
    deliveryClients.messenger = {
      async sendText() {
        return { ok: true, value: { messageId: 'messenger_text_before_throw' }, message: 'sent' };
      },
      async sendMedia() {
        turnDuringMedia = (await store.listTurns('messenger:psid_media_throw')).at(-1);
        throw new Error('messenger media transport exploded');
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
      toolPlanner: menuPlanner,
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
    await expect(server.inject({ method: 'GET', url: '/dashboard/events/messenger:psid_media_throw' }).then((result) => result.json().events.at(-1))).resolves.toMatchObject({
      type: 'assistant_reply_sent',
      payload: {
        deliveryStatus: 'sent',
        textDeliveryStatus: 'sent',
        mediaDeliveryStatus: 'failed',
        mediaItems: expect.arrayContaining([expect.objectContaining({
          status: 'failed',
          errorCode: 'messenger_media_send_failed',
          errorMessage: 'messenger media transport exploded',
        })]),
      },
    });
  });

  it('keeps Zalo text sent and records failed media items when sendMedia throws', async () => {
    const store = new MemoryStore();
    let turnDuringMedia: Awaited<ReturnType<MemoryStore['listTurns']>>[number] | undefined;
    deliveryClients.zalo = {
      async sendText() {
        return { ok: true, value: { messageId: 'zalo_text_before_throw' }, message: 'sent' };
      },
      async sendMedia() {
        turnDuringMedia = (await store.listTurns('zalo:zalo_media_throw')).at(-1);
        throw new Error('zalo media transport exploded');
      },
      async getProfile() {
        return { ok: false, errorCode: 'profile_unavailable', message: 'not needed' };
      },
    };
    const server = buildServer({
      store,
      zaloOaId: 'oa_local',
      toolPlanner: menuPlanner,
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
    await expect(server.inject({ method: 'GET', url: '/dashboard/events/zalo:zalo_media_throw' }).then((result) => result.json().events.at(-1))).resolves.toMatchObject({
      type: 'assistant_reply_sent',
      payload: {
        deliveryStatus: 'sent',
        textDeliveryStatus: 'sent',
        mediaDeliveryStatus: 'failed',
        mediaItems: expect.arrayContaining([expect.objectContaining({
          status: 'failed',
          errorCode: 'zalo_media_send_failed',
          errorMessage: 'zalo media transport exploded',
        })]),
      },
    });
  });
});
