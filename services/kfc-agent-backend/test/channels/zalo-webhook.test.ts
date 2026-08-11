import { describe, expect, it, vi } from 'vitest';
import { createZaloClient, normalizeZaloWebhook } from '../../src/channels/zalo.js';

describe('Zalo maintained webhook behavior', () => {
  it('reports per-item optional media outcomes without collapsing partial delivery', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 0, message_id: 'media-1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 429 }), { status: 429 }));
    const client = createZaloClient({
      accessToken: 'token',
      apiBaseUrl: 'https://zalo.test',
      fetchImpl,
    });

    await expect(client.sendMedia!('user-1', [
      { key: 'menu:a:0', imageUrl: 'https://static.kfcvietnam.com.vn/a.jpg', title: 'A' },
      { key: 'menu:b:1', imageUrl: 'https://static.kfcvietnam.com.vn/b.jpg', title: 'B' },
    ])).resolves.toMatchObject({
      status: 'partial',
      items: [
        { key: 'menu:a:0', status: 'sent', messageId: 'media-1' },
        { key: 'menu:b:1', status: 'failed', errorCode: 'zalo_media_send_failed' },
      ],
    });
  });

  it('normalizes text for agent execution and keeps unsupported events inert', () => {
    const text = normalizeZaloWebhook({
      event_name: 'user_send_text',
      sender: { id: 'user-1', name: 'Tran Binh' },
      recipient: { id: 'oa-1' },
      message: { msg_id: 'message-1', text: 'Cho minh mot combo' },
      timestamp: 1783323124608,
    }, 'oa-1')[0];
    const unsupported = normalizeZaloWebhook({
      event_name: 'future_event',
      sender: { id: 'user-1', name: 'Tran Binh' },
      recipient: { id: 'oa-1' },
      timestamp: 1783323124608,
    }, 'oa-1')[0];

    expect(text).toMatchObject({
      eventType: 'message',
      text: 'Cho minh mot combo',
      shouldRunAgent: true,
    });
    expect(unsupported).toMatchObject({
      eventType: 'unsupported',
      text: '[Unsupported Zalo event]',
      shouldRunAgent: false,
    });
  });

  it('preserves bounded file and location evidence without running the order agent', () => {
    const file = normalizeZaloWebhook({
      event_name: 'user_send_file',
      sender: { id: 'user-1' },
      recipient: { id: 'oa-1' },
      message: {
        msg_id: 'file-1',
        attachments: [{ type: 'file', payload: { url: 'https://zalo.test/menu.pdf', name: 'menu.pdf' } }],
      },
    }, 'oa-1')[0];
    const location = normalizeZaloWebhook({
      event_name: 'user_send_location',
      sender: { id: 'user-1' },
      recipient: { id: 'oa-1' },
      message: {
        msg_id: 'location-1',
        attachments: [{ type: 'location', payload: { latitude: 10.77, longitude: 106.7 } }],
      },
    }, 'oa-1')[0];

    expect(file).toMatchObject({
      eventType: 'attachment',
      attachments: [{ type: 'file', url: 'https://zalo.test/menu.pdf', title: 'menu.pdf' }],
      shouldRunAgent: false,
    });
    expect(location).toMatchObject({
      eventType: 'attachment',
      attachments: [{ type: 'location', latitude: 10.77, longitude: 106.7 }],
      shouldRunAgent: false,
    });
  });
});
