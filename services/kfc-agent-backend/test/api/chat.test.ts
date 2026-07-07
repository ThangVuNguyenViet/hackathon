import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

describe('chat mock API', () => {
  it('accepts a chat turn and emits dashboard events', async () => {
    const server = buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'session_api',
        customerId: 'customer_api',
        channel: 'messenger_mock',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      replyIntent: 'ask_fulfillment_method',
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/session_api' });
    expect(events.statusCode).toBe(200);
    expect(events.json().events[0].type).toBe('cart_changed');

    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().sessions[0]).toMatchObject({
      sessionId: 'session_api',
      latestEventType: 'cart_changed',
    });

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/session_api/turns' });
    expect(turns.statusCode).toBe(200);
    expect(turns.json().turns.map((turn: { role: string }) => turn.role)).toEqual(['user', 'assistant']);
  });

  it('returns 400 for live channel names on the mock chat route', async () => {
    const server = buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'session_invalid',
        customerId: 'customer_api',
        channel: 'messenger',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errorCode: 'invalid_chat_payload' });
  });

  it('returns text composed by the configured response composer', async () => {
    const server = buildServer({
      responseComposer: {
        async composeResponse() {
          return 'Dạ mình đã thêm Combo 99K vào giỏ. Bạn muốn nhận tại cửa hàng hay giao hàng ạ?';
        },
      },
    });
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'session_api_composer',
        customerId: 'customer_api',
        channel: 'messenger_mock',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      responseText: 'Dạ mình đã thêm Combo 99K vào giỏ. Bạn muốn nhận tại cửa hàng hay giao hàng ạ?',
    });
  });

  it('does not eagerly load fixtures for non-chat routes', async () => {
    const server = buildServer({ fixturesRoot: join(process.cwd(), '../..') });
    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
  });
});
