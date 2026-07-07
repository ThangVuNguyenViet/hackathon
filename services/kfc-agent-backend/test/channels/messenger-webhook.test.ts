import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';

describe('Messenger webhook adapter', () => {
  it('returns the raw Meta challenge when verify token matches', async () => {
    const server = buildServer({ messengerVerifyToken: 'local_verify', metaPageId: '118976205445198' });
    const response = await server.inject({
      method: 'GET',
      url: '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=local_verify&hub.challenge=CHALLENGE_123',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('CHALLENGE_123');
  });

  it('rejects a mismatched verify token', async () => {
    const server = buildServer({ messengerVerifyToken: 'local_verify', metaPageId: '118976205445198' });
    const response = await server.inject({
      method: 'GET',
      url: '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE_123',
    });

    expect(response.statusCode).toBe(403);
  });

  it('normalizes a page text message and runs the agent turn', async () => {
    const messengerFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message_id: 'messenger_reply_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const server = buildServer({
      messengerVerifyToken: 'local_verify',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
    });
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/messenger',
      payload: {
        object: 'page',
        entry: [
          {
            id: '118976205445198',
            time: 1783323124608,
            messaging: [
              {
                sender: { id: 'psid_user_1' },
                recipient: { id: '118976205445198' },
                timestamp: 1783323124608,
                message: { mid: 'mid_1', text: 'Cho mình 1 Combo 99K' },
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1 });
    expect(messengerFetchImpl).toHaveBeenCalledOnce();

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/messenger:psid_user_1/turns' });
    expect(turns.json().turns.at(-1)).toMatchObject({
      role: 'assistant',
      deliveryStatus: 'sent',
      externalMessageId: 'messenger_reply_1',
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/messenger:psid_user_1' });
    expect(events.json().events.at(-1)).toMatchObject({
      type: 'assistant_reply_sent',
      payload: { deliveryStatus: 'sent' },
    });
  });
});
