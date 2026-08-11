import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

function signedZaloBody(payload: Record<string, unknown>, secret: string) {
  const body = JSON.stringify(payload);
  const signature = createHash('sha256')
    .update(
      `${String(payload.app_id)}${body}${String(payload.timestamp)}${secret}`,
    )
    .digest('hex');
  return { body, signature };
}

describe('Zalo webhook ingress security', () => {
  const secret = 'oa-secret-for-tests';
  const payload = {
    app_id: 'pvcfc-app',
    event_name: 'user_send_text',
    sender: { id: 'zalo-user' },
    recipient: { id: 'oa-pvcfc' },
    message: { msg_id: 'zalo-message-1', text: 'Lúa bị vàng lá' },
    timestamp: '1783323124608',
  };

  it('rejects unsigned requests before persistence', async () => {
    const store = new MemoryStore();
    const server = buildServer({
      store,
      zaloOaId: 'oa-pvcfc',
      zaloWebhookSecret: secret,
    });
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(401);
    await expect(
      store.getWebhookDelivery('zalo', 'zalo-message-1'),
    ).resolves.toBeUndefined();
  });

  it('accepts the exact signed raw body and rejects a changed body', async () => {
    const store = new MemoryStore();
    const server = buildServer({
      store,
      zaloOaId: 'oa-pvcfc',
      zaloWebhookSecret: secret,
    });
    const signed = signedZaloBody(payload, secret);
    const accepted = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      headers: {
        'content-type': 'application/json',
        'x-zevent-signature': signed.signature,
      },
      payload: signed.body,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ received: 1 });

    const changed = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      headers: {
        'content-type': 'application/json',
        'x-zevent-signature': signed.signature,
      },
      payload: signed.body.replace('vàng', 'cháy'),
    });
    expect(changed.statusCode).toBe(401);
  });

  it('rejects a signed event addressed to a different OA before persistence', async () => {
    const store = new MemoryStore();
    const server = buildServer({
      store,
      zaloOaId: 'oa-pvcfc',
      zaloWebhookSecret: secret,
    });
    const wrongRecipient = signedZaloBody(
      { ...payload, recipient: { id: 'oa-other' } },
      secret,
    );
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      headers: {
        'content-type': 'application/json',
        'x-zevent-signature': wrongRecipient.signature,
      },
      payload: wrongRecipient.body,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ errorCode: 'wrong_zalo_oa_recipient' });
    await expect(
      store.getWebhookDelivery('zalo', 'zalo-message-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects oversized input before persistence or model execution', async () => {
    const store = new MemoryStore();
    const server = buildServer({
      store,
      zaloOaId: 'oa-pvcfc',
      zaloWebhookSecret: secret,
    });
    const oversized = signedZaloBody(
      {
        ...payload,
        message: { msg_id: 'oversized', text: 'x'.repeat(1_000_001) },
      },
      secret,
    );
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      headers: {
        'content-type': 'application/json',
        'x-zevent-signature': oversized.signature,
      },
      payload: oversized.body,
    });

    expect(response.statusCode).toBe(413);
    await expect(
      store.getWebhookDelivery('zalo', 'oversized'),
    ).resolves.toBeUndefined();
  });
});
