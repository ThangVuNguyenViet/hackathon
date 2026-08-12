import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { loadBundledPvcfcPublicDataProvider } from '../../src/businesses/pvcfc/public-data/bundledPvcfcPublicDataProvider.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { buildDemoAdminServer } from '../fixtures/demoAdminServer.js';
import {
  signedMessengerWebhook,
  TEST_META_APP_SECRET,
} from '../fixtures/signedMessengerWebhook.js';
import { ScriptedPvcfcChatModel } from '../fixtures/scriptedPvcfcChatModel.js';
import { testAgent } from '../fixtures/testAgent.js';

function evidenceCall(id: string) {
  return new AIMessage({
    content: '',
    tool_calls: [
      {
        id,
        name: 'searchPvcfcRecords',
        args: { query: 'lúa', limit: 3 },
        type: 'tool_call',
      },
    ],
  });
}

describe('PVCFC social-channel business routing', () => {
  it('runs Zalo and Messenger through PVCFC evidence without duplicate turns or KFC state', async () => {
    const store = new MemoryStore();
    const reserveIrreversibleOperation = vi.spyOn(
      store,
      'reserveIrreversibleOperation',
    );
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        evidenceCall('messenger-evidence'),
        new AIMessage(
          'Lúa 7–10 ngày sau sạ có thể tham khảo NPK Cà Mau 20-10-10. Cần kiểm tra tình trạng ruộng trước khi quyết định liều lượng.\nNguồn: https://www.pvcfc.com.vn/npk-ca-mau-phu-hop-ca-vu-lua-thu-hoach-mua-vang',
        ),
        evidenceCall('zalo-evidence'),
        new AIMessage(
          'Lúa 40–45 ngày sau sạ có thể tham khảo NPK Cà Mau 18-6-18. Cần kiểm tra tình trạng ruộng trước khi quyết định liều lượng.\nNguồn: https://www.pvcfc.com.vn/npk-ca-mau-phu-hop-ca-vu-lua-thu-hoach-mua-vang',
        ),
      ],
    });
    // Keep an explicitly configured KFC model in the fixture so this test
    // fails if a PVCFC-bound Messenger turn accidentally falls back to the
    // KFC application runtime. The model has no scripted output on purpose.
    const forbiddenKfcModel = new ScriptedPvcfcChatModel({ outputs: [] });
    const messengerBodies: string[] = [];
    const messengerFetchImpl = vi.fn(
      async (_url: unknown, init?: RequestInit) => {
        if (typeof init?.body === 'string') {
          messengerBodies.push(init.body);
        }
        const body = messengerBodies.at(-1);
        return new Response(
          JSON.stringify(
            body?.includes('"sender_action"')
              ? { recipient_id: 'farmer-messenger' }
              : { message_id: 'messenger-pvcfc-reply' },
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    );
    const zaloBodies: string[] = [];
    const zaloFetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        zaloBodies.push(init.body);
      }
      return new Response(
        JSON.stringify({ error: 0, message_id: 'zalo-pvcfc-reply' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    const server = buildDemoAdminServer({
      store,
      ...testAgent(forbiddenKfcModel),
      pvcfcAgentModel: model,
      pvcfcPublicDataProvider: loadBundledPvcfcPublicDataProvider(),
      messengerBusinessId: 'pvcfc',
      messengerVerifyToken: 'verify',
      metaAppSecret: TEST_META_APP_SECRET,
      metaPageId: 'page-pvcfc',
      messengerPageAccessToken: 'page-token',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
      zaloBusinessId: 'pvcfc',
      zaloOaId: 'oa-pvcfc',
      zaloAccessToken: 'zalo-token',
      zaloApiBaseUrl: 'https://zalo.local',
      zaloFetchImpl,
    });

    const messengerPayload = {
      object: 'page',
      entry: [
        {
          id: 'page-pvcfc',
          messaging: [
            {
              sender: { id: 'farmer-messenger' },
              recipient: { id: 'page-pvcfc' },
              timestamp: 1783323124608,
              message: {
                mid: 'mid-pvcfc-messenger',
                text: 'tư vấn phân bón cho lúa',
              },
            },
          ],
        },
      ],
    } as const;
    const messenger = await server.inject(
      signedMessengerWebhook(messengerPayload),
    );
    const zalo = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        sender: { id: 'farmer-zalo' },
        recipient: { id: 'oa-pvcfc' },
        message: { msg_id: 'mid-pvcfc-zalo', text: 'tư vấn phân bón cho lúa' },
        timestamp: 1783323124609,
      },
    });

    expect(messenger.json()).toMatchObject({ processed: 1, failed: 0 });
    expect(zalo.json()).toMatchObject({ processed: 1, failed: 0 });
    const messengerCallCount = messengerFetchImpl.mock.calls.length;
    const duplicateMessenger = await server.inject(
      signedMessengerWebhook(messengerPayload),
    );
    expect(duplicateMessenger.json()).toMatchObject({
      processed: 0,
      skippedDuplicates: 1,
      failed: 0,
    });
    expect(messengerFetchImpl).toHaveBeenCalledTimes(messengerCallCount);
    for (const sessionId of [
      'messenger:farmer-messenger',
      'zalo:farmer-zalo',
    ]) {
      const turns = await store.listTurns(sessionId);
      expect(turns).toHaveLength(2);
      expect(turns.map(({ role }) => role)).toEqual(['user', 'assistant']);
      expect(turns[1]?.text).not.toContain('Trạng thái nguồn');
      expect(turns[1]?.text).not.toMatch(/(^|\n)#{1,6}\s|\*\*|\[[^\]]+\]\(/u);
      expect(
        (await store.listEvents(sessionId)).some(
          ({ sourceType }) => sourceType === 'graph:verified_state',
        ),
      ).toBe(false);
    }
    expect(reserveIrreversibleOperation).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(4);
    expect(forbiddenKfcModel.calls).toHaveLength(0);
    expect(JSON.stringify(model.calls)).not.toContain('KFC');
    expect(JSON.stringify(messengerBodies)).toContain('NPK Cà Mau 20-10-10');
    expect(JSON.stringify(zaloBodies)).toContain('NPK Cà Mau 18-6-18');
    await server.close();
  }, 15_000);

  it('fails a PVCFC-bound social turn closed when its model is unavailable', async () => {
    const store = new MemoryStore();
    const messengerBodies: string[] = [];
    const messengerFetchImpl = vi.fn(
      async (_url: unknown, init?: RequestInit) => {
        if (typeof init?.body === 'string') {
          messengerBodies.push(init.body);
        }
        return new Response(
          JSON.stringify({ recipient_id: 'farmer-no-model' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    );
    const server = buildDemoAdminServer({
      store,
      pvcfcPublicDataProvider: loadBundledPvcfcPublicDataProvider(),
      messengerBusinessId: 'pvcfc',
      messengerVerifyToken: 'verify',
      metaAppSecret: TEST_META_APP_SECRET,
      metaPageId: 'page-pvcfc',
      messengerPageAccessToken: 'page-token',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
    });

    const response = await server.inject(
      signedMessengerWebhook({
        object: 'page',
        entry: [
          {
            id: 'page-pvcfc',
            messaging: [
              {
                sender: { id: 'farmer-no-model' },
                recipient: { id: 'page-pvcfc' },
                timestamp: 1783323124610,
                message: {
                  mid: 'mid-pvcfc-no-model',
                  text: 'tư vấn phân bón cho lúa',
                },
              },
            ],
          },
        ],
      }),
    );

    expect(response.json()).toMatchObject({ processed: 0, failed: 1 });
    expect(await store.listTurns('messenger:farmer-no-model')).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'tư vấn phân bón cho lúa',
      }),
    ]);
    expect(messengerBodies.some((body) => body.includes('"message"'))).toBe(
      false,
    );
    await server.close();
  });
});
