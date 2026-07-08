import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';

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
    const server = buildServer({ zaloOaId: 'oa_local', fixturesRoot: '/tmp/kfc-agent-backend-missing-fixtures' });
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
    expect(response.json()).toEqual({ received: 0, processed: 0, skippedDuplicates: 0, failed: 0 });
  });
});
