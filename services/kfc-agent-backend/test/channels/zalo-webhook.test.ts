import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { normalizeZaloWebhook } from '../../src/channels/zalo.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('Zalo webhook adapter', () => {
  it('normalizes a Zalo OA text event and runs the agent turn', async () => {
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
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          ],
          responseClaims: [],
        },
      ]),
      responseComposer: {
        async composeResponse() {
          return 'Dạ mình đã thêm Combo 99K vào giỏ Zalo.';
        },
      },
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
    expect(response.json()).toMatchObject({ received: 1 });
    expect(zaloFetchImpl).toHaveBeenCalledOnce();
    const zaloRequestInit = zaloFetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(zaloRequestInit?.body))).toMatchObject({
      message: { text: 'Dạ mình đã thêm Combo 99K vào giỏ Zalo.' },
    });

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/zalo:zalo_user_1/turns' });
    expect(turns.json().turns.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'Dạ mình đã thêm Combo 99K vào giỏ Zalo.',
      deliveryStatus: 'sent',
      externalMessageId: 'zalo_reply_1',
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/zalo:zalo_user_1' });
    expect(events.json().events.at(-1)).toMatchObject({
      type: 'assistant_reply_sent',
      payload: { deliveryStatus: 'sent' },
    });
    expect(
      events
        .json()
        .events.find((event: { type: string }) => event.type === 'cart_changed'),
    ).toMatchObject({
      type: 'cart_changed',
      payload: {
        cart: {
          items: [expect.objectContaining({ itemCode: '20751', name: 'Combo Hợp Gu 99K' })],
        },
      },
    });
  });

  it('acknowledges unsupported Zalo events without running unsafe order actions', async () => {
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
    expect(response.json()).toEqual({ received: 1, processed: 1, skippedDuplicates: 0, failed: 0 });
    expect(zaloFetchImpl).toHaveBeenCalledOnce();

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/zalo:zalo_user_1/turns' });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({
        role: 'user',
        text: '[Zalo follow]',
        deliveryStatus: 'received',
        metadata: expect.objectContaining({ platformEventName: 'follow' }),
      }),
      expect.objectContaining({
        role: 'assistant',
        text: 'Mình đã nhận được nội dung bạn gửi. Bạn mô tả yêu cầu đặt món bằng tin nhắn chữ giúp mình nhé.',
        deliveryStatus: 'sent',
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
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'should not run' },
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
          responseClaims: [],
        },
      ]),
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
    expect(zaloFetchImpl).toHaveBeenCalledOnce();

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
    const server = buildServer({
      store,
      zaloOaId: 'oa_local',
      toolPlanner: new StaticToolPlanner([{ intent: 'ordering', entities: {}, toolCalls: [], responseClaims: [] }]),
      responseComposer: {
        async composeResponse() {
          return 'Dạ KFC hỗ trợ bạn.';
        },
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        sender: { id: 'zalo_user_1', name: 'Tran Binh' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'zalo_missing_token_1', text: 'Cho mình combo 99K' },
        timestamp: 1783323124608,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1, processed: 0, failed: 1 });
    expect(await store.listTurns('zalo:zalo_user_1')).toEqual([
      expect.objectContaining({ role: 'user', text: 'Cho mình combo 99K' }),
      expect.objectContaining({ role: 'assistant', deliveryStatus: 'failed' }),
    ]);
    expect(await store.getWebhookDelivery('zalo', 'zalo_missing_token_1')).toMatchObject({
      status: 'failed',
      lastError: 'missing_zalo_access_token',
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
