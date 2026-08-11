import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { createPvcfcChatHandler } from '../../src/api/pvcfcChatHandler.js';
import { loadBundledPvcfcPublicDataProvider } from '../../src/businesses/pvcfc/public-data/bundledPvcfcPublicDataProvider.js';

describe('PVCFC chat handler', () => {
  it('fails only PVCFC execution when fixtures exist without model credentials', async () => {
    const server = buildServer({
      pvcfcPublicDataProvider: loadBundledPvcfcPublicDataProvider(),
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/pvcfc/message',
      payload: {
        sessionId: 'pvcfc:missing-model',
        customerId: 'missing-model',
        clientMessageId: 'message-1',
        text: 'PVCFC có những sản phẩm nào?',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      errorCode: 'pvcfc_agent_not_configured',
    });
  });

  it('keeps customer metadata as audit data instead of trusted pack input', async () => {
    let received:
      Parameters<Parameters<typeof createPvcfcChatHandler>[0]>[0] | undefined;
    const handler = createPvcfcChatHandler(async (input) => {
      received = input;
      return { status: 200, body: { responseText: 'ok' } };
    });

    await handler({
      sessionId: 'pvcfc:trusted-route',
      customerId: 'trusted-route',
      clientMessageId: 'message-1',
      text: 'PVCFC có những sản phẩm nào?',
      metadata: {
        businessId: 'kfc',
        customerCommand: { kind: 'cart_update' },
        responseProfile: 'genui',
      },
    });

    expect(received).not.toHaveProperty('businessId');
    expect(received?.metadata.responseProfile).toBeUndefined();
    expect(received?.metadata.customerCommand).toBeUndefined();
    expect(received?.metadata.rawEvent).toMatchObject({
      businessId: 'kfc',
      customerCommand: { kind: 'cart_update' },
      source: 'pvcfc_chat',
    });
  });
});
