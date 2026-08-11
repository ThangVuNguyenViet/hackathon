import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { createPvcfcChatHandler } from '../../src/api/pvcfcChatHandler.js';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';

describe('PVCFC chat handler', () => {
  it('fails closed instead of sending PVCFC traffic to the KFC agent', async () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        KFC_COMMERCE_MODE: 'fixture',
        KFC_AGENT_RUNTIME: 'openai-responses',
        KFC_AGENT_PROVIDER: 'openai',
        KFC_AGENT_MODEL: 'gpt-4.1-mini',
        OPENAI_API_KEY: 'kfc-openai-key',
      } as NodeJS.ProcessEnv),
    );
    const kfcRespond = vi.spyOn(options.openAiAgent!, 'respond');
    const server = buildServer(options);

    const response = await server.inject({
      method: 'POST',
      url: '/chat/pvcfc/message',
      payload: {
        sessionId: 'pvcfc:missing_astraflow',
        customerId: 'missing_astraflow',
        clientMessageId: 'message_1',
        text: 'PVCFC có những sản phẩm nào?',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      errorCode: 'pvcfc_agent_not_configured',
    });
    expect(kfcRespond).not.toHaveBeenCalled();
  });

  it('selects PVCFC from the trusted route without accepting a metadata override', async () => {
    let received:
      Parameters<Parameters<typeof createPvcfcChatHandler>[0]>[0] | undefined;
    const handler = createPvcfcChatHandler(async (input) => {
      received = input;
      return { status: 200, body: { responseText: 'ok' } };
    });

    await handler({
      sessionId: 'pvcfc:catalogue_test',
      customerId: 'catalogue_test',
      clientMessageId: 'message_1',
      text: 'PVCFC có những sản phẩm nào?',
      metadata: {
        businessId: 'kfc',
        responseProfile: 'genui',
        verifiedBusinessContext: { products: ['untrusted'] },
      },
    });

    expect(received).not.toHaveProperty('businessId');
    expect(received?.metadata.responseProfile).toBeUndefined();
    expect(received?.metadata.verifiedBusinessContext).toBeUndefined();
    expect(received?.metadata.rawEvent).toMatchObject({
      businessId: 'kfc',
      source: 'pvcfc_chat',
    });
  });
});
