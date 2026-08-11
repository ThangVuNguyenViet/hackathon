import type { OpenAIClient } from '@kfc/openai-agents-runtime';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';
import { createZaloClient, normalizeZaloWebhook } from '../../src/channels/zalo.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

function sdkResponse(output: unknown[], outputText = '') {
  return {
    id: crypto.randomUUID(),
    object: 'response',
    created_at: 0,
    model: 'gpt-5.6-luna',
    output,
    output_text: outputText,
    usage: { input_tokens: 4, output_tokens: 4, total_tokens: 8 },
  };
}

function pvcfcResponses(text: string) {
  return [
    sdkResponse([{
      id: crypto.randomUUID(),
      type: 'function_call',
      call_id: crypto.randomUUID(),
      name: 'searchPvcfcRecords',
      arguments: JSON.stringify({
        query: 'lúa',
        collections: ['products'],
        limit: 2,
        cursor: null,
      }),
    }]),
    sdkResponse([{
      id: crypto.randomUUID(),
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    }], text),
  ];
}

function pvcfcAgent(text: string) {
  const responses = pvcfcResponses(text);
  return new OpenAiKfcAgent({
    client: {
      responses: {
        create: async () => {
          const response = responses.shift();
          if (!response) throw new Error('unexpected model request');
          return response;
        },
      },
    } as unknown as OpenAIClient,
    model: 'gpt-5.6-luna',
    modelTemperature: null,
    compaction: { enabled: false, thresholdBytes: 98_304 },
  });
}

function deferredTasks() {
  const tasks: Array<() => Promise<void>> = [];
  return {
    defer: (task: () => Promise<void>) => tasks.push(task),
    flush: async () => {
      for (const task of tasks.splice(0)) await task();
    },
  };
}

describe('Zalo webhook adapter', () => {
  it('reports partial optional media delivery per item without collapsing outcomes', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 0, message_id: 'media_1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 429, message: 'quota' }), { status: 429 }));
    const client = createZaloClient({ accessToken: 'token', apiBaseUrl: 'https://zalo.local', fetchImpl });
    const result = await client.sendMedia!('user', [
      { key: 'menu:a:0', imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL', title: 'A' },
      { key: 'menu:b:1', imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=LNN7PL', title: 'B' },
    ]);

    expect(result).toMatchObject({
      status: 'partial',
      items: [
        { key: 'menu:a:0', status: 'sent', messageId: 'media_1' },
        { key: 'menu:b:1', status: 'failed', errorCode: 'zalo_media_send_failed' },
      ],
    });
  });

  it('renders PVCFC agricultural guidance in outbound standalone text', async () => {
    const store = new MemoryStore();
    const deferred = deferredTasks();
    const zaloFetchImpl = vi.fn(async (
      _url: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response(JSON.stringify({ error: 0, message_id: 'zalo_menu_reply_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const server = buildServer({
      store,
      zaloOaId: 'oa_local',
      zaloAccessToken: 'zalo_token_local',
      zaloApiBaseUrl: 'https://zalo.local',
      zaloFetchImpl,
      pvcfcAgent: pvcfcAgent('PVCFC khuyến nghị kiểm tra dinh dưỡng cho cây lúa.'),
      defer: deferred.defer,
    });
    await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        app_id: 'zalo_app_local',
        sender: { id: 'zalo_menu_user' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'zalo_menu_1', text: 'cho tôi xem món ăn' },
      },
    });
    await deferred.flush();

    const outboundBody: unknown = JSON.parse(
      String(zaloFetchImpl.mock.calls[0]?.[1]?.body),
    );
    expect(outboundBody).toMatchObject({
      message: { text: expect.stringContaining('PVCFC') },
    });
    expect(JSON.stringify(outboundBody)).toContain('cây lúa');
    expect(zaloFetchImpl).toHaveBeenCalledTimes(1);
    expect((await store.listTurns('zalo:zalo_menu_user')).at(-1)?.metadata?.genUi).toBeUndefined();
  });

  it('normalizes a Zalo OA text event and runs the agent turn', async () => {
    const deferred = deferredTasks();
    const zaloFetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(JSON.stringify({ error: 0, message_id: 'zalo_reply_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const server = buildServer({
      zaloOaId: 'oa_local',
      zaloAccessToken: 'zalo_token_local',
      zaloApiBaseUrl: 'https://zalo.local',
      zaloFetchImpl,
      pvcfcAgent: pvcfcAgent(
        'PVCFC có thể hỗ trợ tư vấn dinh dưỡng cho cây lúa theo dữ liệu chính thức.',
      ),
      defer: deferred.defer,
    });
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        app_id: 'zalo_app_local',
        sender: { id: 'zalo_user_1' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'zalo_msg_1', text: 'Cho mình 1 Combo 99K' },
        timestamp: 1783323124608,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1, queued: 1 });
    expect(zaloFetchImpl).not.toHaveBeenCalled();
    await deferred.flush();
    expect(zaloFetchImpl).toHaveBeenCalledTimes(1);
    const zaloRequestBodies = zaloFetchImpl.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
    const zaloTextRequest = zaloRequestBodies.find(
      (body) => typeof body.message?.text === 'string',
    );
    expect(zaloTextRequest).toMatchObject({
      message: { text: expect.stringContaining('PVCFC') },
    });

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/zalo:zalo_user_1/turns' });
    expect(turns.json().turns.at(-1)).toMatchObject({
      role: 'assistant',
      text: expect.stringContaining('PVCFC'),
      deliveryStatus: 'sent',
      externalMessageId: 'zalo_reply_1',
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/zalo:zalo_user_1' });
    expect(
      events.json().events.find(
        (event: { type: string }) =>
          event.type === 'assistant_reply_sent',
      ),
    ).toMatchObject({
      type: 'assistant_reply_sent',
      payload: { deliveryStatus: 'sent' },
    });
    expect(JSON.stringify(events.json())).not.toContain('KFC');
  });

  it('records unsupported Zalo events without authoring a reply or running unsafe order actions', async () => {
    const zaloFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: 0, message_id: 'zalo_ack_follow_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const server = buildServer({
      zaloOaId: 'oa_local',
      zaloAccessToken: 'zalo_token_local',
      zaloApiBaseUrl: 'https://zalo.local',
      zaloFetchImpl,
      fixturesRoot: '/tmp/kfc-agent-backend-missing-fixtures',
    });
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'follow',
        sender: { id: 'zalo_user_1' },
        recipient: { id: 'oa_local' },
        timestamp: 1783323124608,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: 1, processed: 1, queued: 0, skippedDuplicates: 0, failed: 0 });
    expect(zaloFetchImpl).not.toHaveBeenCalled();

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/zalo:zalo_user_1/turns' });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({
        role: 'user',
        text: '[Zalo follow]',
        deliveryStatus: 'received',
        metadata: expect.objectContaining({ platformEventName: 'follow' }),
      }),
    ]);

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/zalo:zalo_user_1' });
    expect(events.json().events.find((event: { type: string }) => event.type === 'customer_message_received')).toMatchObject({
      type: 'customer_message_received',
      payload: {
        externalUserId: 'zalo_user_1',
        text: '[Zalo follow]',
        metadata: expect.objectContaining({ platformEventName: 'follow' }),
      },
    });
    expect(events.json().events.find((event: { type: string }) => event.type === 'cart_changed')).toBeUndefined();
  });

  it('records a Zalo image event without running order tools', async () => {
    const zaloFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: 0, message_id: 'zalo_ack_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const server = buildServer({
      zaloOaId: 'oa_local',
      zaloAccessToken: 'zalo_token_local',
      zaloApiBaseUrl: 'https://zalo.local',
      zaloFetchImpl,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_image',
        sender: { id: 'zalo_user_1', name: 'Tran Binh' },
        recipient: { id: 'oa_local' },
        message: {
          msg_id: 'zalo_image_1',
          attachments: [{ type: 'image', payload: { url: 'https://zalo.local/image.jpg' } }],
        },
        timestamp: 1783323124608,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1, processed: 1, skippedDuplicates: 0, failed: 0 });
    expect(zaloFetchImpl).not.toHaveBeenCalled();

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/zalo:zalo_user_1/turns' });
    expect(turns.json().turns[0]).toMatchObject({
      role: 'user',
      text: '[Zalo image]',
      externalUserId: 'zalo_user_1',
      metadata: {
        platformEventName: 'user_send_image',
        attachments: [{ type: 'image', url: 'https://zalo.local/image.jpg' }],
      },
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/zalo:zalo_user_1' });
    expect(events.json().events.find((event: { type: string }) => event.type === 'cart_changed')).toBeUndefined();
  });

  it('preserves inbound Zalo transcript when outbound token is missing', async () => {
    const store = new MemoryStore();
    const deferred = deferredTasks();
    const server = buildServer({
      store,
      zaloOaId: 'oa_local',
      pvcfcAgent: pvcfcAgent('PVCFC có thể hỗ trợ bạn.'),
      defer: deferred.defer,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        sender: { id: 'zalo_missing_token_user', name: 'Tran Binh' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'zalo_missing_token_1', text: 'Cho mình combo 99K' },
        timestamp: 1783323124608,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1, queued: 1, failed: 0 });
    await deferred.flush();
    expect(await store.getWebhookDelivery('zalo', 'zalo_missing_token_1')).toMatchObject({
      status: 'failed',
      lastError: 'missing_zalo_access_token',
    });
    expect(await store.listTurns('zalo:zalo_missing_token_user')).toEqual([
      expect.objectContaining({ role: 'user', text: 'Cho mình combo 99K' }),
      expect.objectContaining({ role: 'assistant', deliveryStatus: 'failed' }),
    ]);
  });

  it('uses Zalo webhook sender name in dashboard session summaries', async () => {
    const deferred = deferredTasks();
    const server = buildServer({
      zaloOaId: 'oa_local',
      zaloAccessToken: 'token',
      zaloInboxUrlTemplate:
        'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}&session={sessionId}',
      pvcfcAgent: pvcfcAgent('Xin chào từ PVCFC!'),
      defer: deferred.defer,
    });
    await deferred.flush();
    await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        sender: { id: 'zalo_user_1', name: 'Tran Binh', avatar: 'https://zalo.local/b.jpg' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'zalo_profile_1', text: 'Hi' },
        timestamp: 1783323124608,
      },
    });

    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
    expect(sessions.json().sessions[0]).toMatchObject({
      sessionId: 'zalo:zalo_user_1',
      displayName: 'Tran Binh',
      externalUserId: 'zalo_user_1',
      avatarUrl: 'https://zalo.local/b.jpg',
      deeplink: {
        status: 'available',
        url: 'https://oa.zalo.me/chatv2?oaid=oa_local&uid=zalo_user_1&session=zalo%3Azalo_user_1',
      },
    });
  });

  it('normalizes Zalo link, file, sticker, audio, location, follow, and unsupported events', async () => {
    const normalized = normalizeZaloWebhook(
      {
        event_name: 'user_send_link',
        sender: { id: 'zalo_user_1', name: 'Tran Binh' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'link_1', text: 'https://kfcvietnam.com.vn' },
        timestamp: 1783323124608,
      },
      'oa_local',
    );

    expect(normalized[0]).toMatchObject({
      eventType: 'attachment',
      text: 'https://kfcvietnam.com.vn',
      platformEventName: 'user_send_link',
      attachments: [],
      shouldRunAgent: false,
    });

    expect(
      normalizeZaloWebhook(
        {
          event_name: 'user_send_file',
          sender: { id: 'zalo_user_1', name: 'Tran Binh' },
          recipient: { id: 'oa_local' },
          message: {
            msg_id: 'file_1',
            attachments: [{ type: 'file', payload: { url: 'https://zalo.local/menu.pdf', name: 'menu.pdf' } }],
          },
          timestamp: 1783323124608,
        },
        'oa_local',
      )[0],
    ).toMatchObject({
      eventType: 'attachment',
      text: '[Zalo file]',
      platformEventName: 'user_send_file',
      attachments: [{ type: 'file', url: 'https://zalo.local/menu.pdf', title: 'menu.pdf' }],
      shouldRunAgent: false,
    });

    expect(
      normalizeZaloWebhook(
        {
          event_name: 'user_send_sticker',
          sender: { id: 'zalo_user_1', name: 'Tran Binh' },
          recipient: { id: 'oa_local' },
          message: { msg_id: 'sticker_1', attachments: [{ type: 'sticker', payload: { id: 'stk_1' } }] },
          timestamp: 1783323124608,
        },
        'oa_local',
      )[0],
    ).toMatchObject({
      eventType: 'attachment',
      text: '[Zalo sticker]',
      platformEventName: 'user_send_sticker',
      attachments: [{ type: 'sticker' }],
      shouldRunAgent: false,
    });

    expect(
      normalizeZaloWebhook(
        {
          event_name: 'user_send_audio',
          sender: { id: 'zalo_user_1', name: 'Tran Binh' },
          recipient: { id: 'oa_local' },
          message: {
            msg_id: 'audio_1',
            attachments: [{ type: 'audio', payload: { url: 'https://zalo.local/audio.m4a' } }],
          },
          timestamp: 1783323124608,
        },
        'oa_local',
      )[0],
    ).toMatchObject({
      eventType: 'attachment',
      text: '[Zalo audio]',
      platformEventName: 'user_send_audio',
      attachments: [{ type: 'audio', url: 'https://zalo.local/audio.m4a' }],
      shouldRunAgent: false,
    });

    expect(
      normalizeZaloWebhook(
        {
          event_name: 'user_send_location',
          sender: { id: 'zalo_user_1', name: 'Tran Binh' },
          recipient: { id: 'oa_local' },
          message: {
            msg_id: 'loc_1',
            attachments: [{ type: 'location', payload: { latitude: 10.77, longitude: 106.7 } }],
          },
          timestamp: 1783323124608,
        },
        'oa_local',
      )[0],
    ).toMatchObject({
      eventType: 'attachment',
      text: '[Zalo location]',
      platformEventName: 'user_send_location',
      attachments: [{ type: 'location', latitude: 10.77, longitude: 106.7 }],
      shouldRunAgent: false,
    });

    expect(
      normalizeZaloWebhook(
        {
          event_name: 'follow',
          sender: { id: 'zalo_user_1', name: 'Tran Binh' },
          recipient: { id: 'oa_local' },
          timestamp: 1783323124608,
        },
        'oa_local',
      )[0],
    ).toMatchObject({
      eventType: 'follow',
      text: '[Zalo follow]',
      platformEventName: 'follow',
      attachments: [],
      shouldRunAgent: false,
    });

    expect(
      normalizeZaloWebhook(
        {
          event_name: 'future_event',
          sender: { id: 'zalo_user_1', name: 'Tran Binh' },
          recipient: { id: 'oa_local' },
          timestamp: 1783323124608,
        },
        'oa_local',
      )[0],
    ).toMatchObject({
      eventType: 'unsupported',
      text: '[Unsupported Zalo event]',
      platformEventName: 'future_event',
      attachments: [],
      shouldRunAgent: false,
    });
  });
});
