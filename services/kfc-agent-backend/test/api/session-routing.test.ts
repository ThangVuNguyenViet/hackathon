import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { buildDemoAdminServer as createServer } from '../fixtures/demoAdminServer.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { signedMessengerWebhook, TEST_META_APP_SECRET } from '../fixtures/signedMessengerWebhook.js';
import { testAgent } from '../fixtures/testAgent.js';

const buildServer = (options: Parameters<typeof createServer>[0] = {}) =>
  createServer({
    metaAppSecret: TEST_META_APP_SECRET,
    ...options,
  });

describe('webhook session routing', () => {
  it('keeps Messenger and Zalo sessions separate when external thread IDs match', async () => {
    const store = new MemoryStore();
    const messengerFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message_id: 'messenger_reply_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const zaloFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: 0, message_id: 'zalo_reply_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const server = buildServer({
      store,
      ...testAgent(
        fakeModel()
          .respond(groundedResponseModelReply({
            customerText: 'Messenger channel response.',
          }))
          .respond(groundedResponseModelReply({
            customerText: 'Zalo channel response.',
          })),
      ),
      messengerVerifyToken: 'local_verify',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
      zaloOaId: 'oa_local',
      zaloAccessToken: 'zalo_token_local',
      zaloApiBaseUrl: 'https://zalo.local',
      zaloFetchImpl,
    });

    const messenger = await server.inject(signedMessengerWebhook({
        object: 'page',
        entry: [
          {
            id: '118976205445198',
            messaging: [
              {
                sender: { id: 'shared_user' },
                recipient: { id: '118976205445198' },
                timestamp: 1783323124608,
                message: { mid: 'mid_shared_messenger', text: 'Messenger KFC' },
              },
            ],
          },
        ],
    }));
    const zalo = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        sender: { id: 'shared_user' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'mid_shared_zalo', text: 'Zalo KFC' },
        timestamp: 1783323124608,
      },
    });

    expect(messenger.json()).toMatchObject({ processed: 1, failed: 0 });
    expect(zalo.json()).toMatchObject({ processed: 1, failed: 0 });
    expect(await store.listTurns('messenger:shared_user')).toHaveLength(2);
    expect(await store.listTurns('zalo:shared_user')).toHaveLength(2);
    expect(await store.listTurns('shared_user')).toHaveLength(0);
  });
});
