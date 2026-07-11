import { describe, expect, it } from 'vitest';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';

describe('buildServerOptionsFromEnv', () => {
  it('maps channel environment variables into route options', () => {
    const env = loadEnv({
      PORT: '18090',
      OPENAI_API_KEY: 'openai_key_local',
      OPENAI_MODEL: 'gpt-4.1',
      OPENAI_TOOL_PLANNER_MODEL: 'gpt-4.1-mini',
      OPENAI_RESPONSE_MODEL: 'gpt-4.1-mini',
      OPENAI_BASE_URL: 'https://openai.local/v1',
      MESSENGER_VERIFY_TOKEN: 'verify_local',
      META_PAGE_ID: '118976205445198',
      META_PAGE_ACCESS_TOKEN: 'page_token_local',
      META_INBOX_URL_TEMPLATE: 'https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}',
      MESSENGER_GRAPH_API_BASE_URL: 'https://graph.local',
      ZALO_OA_ID: 'oa_local',
      ZALO_ACCESS_TOKEN: 'zalo_token_local',
      ZALO_INBOX_URL_TEMPLATE: 'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}',
      ZALO_API_BASE_URL: 'https://zalo.local',
    } as NodeJS.ProcessEnv);

    expect(buildServerOptionsFromEnv(env)).toMatchObject({
      messengerVerifyToken: 'verify_local',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      metaInboxUrlTemplate:
        'https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}',
      messengerGraphApiBaseUrl: 'https://graph.local',
      zaloOaId: 'oa_local',
      zaloAccessToken: 'zalo_token_local',
      zaloInboxUrlTemplate:
        'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}',
      zaloApiBaseUrl: 'https://zalo.local',
      responseComposer: expect.any(Object),
      toolPlanner: expect.any(Object),
      mockClientOptions: {
        fulfillmentQuoteProvider: expect.any(Function),
      },
    });
  });

  it('does not create OpenAI-backed components without an OpenAI key', () => {
    const env = loadEnv({
      PORT: '18090',
    } as NodeJS.ProcessEnv);

    expect(buildServerOptionsFromEnv(env).responseComposer).toBeUndefined();
    expect(buildServerOptionsFromEnv(env).toolPlanner).toBeUndefined();
  });

  it('does not default Meta page id in runtime env parsing', () => {
    const env = loadEnv({
      PORT: '18090',
    } as NodeJS.ProcessEnv);

    expect(env.META_PAGE_ID).toBe('');
    expect(buildServerOptionsFromEnv(env).metaPageId).toBeUndefined();
  });

  it('seeds post-order preconditions only for deployed GenUI proof customers', async () => {
    const options = buildServerOptionsFromEnv(loadEnv({ PORT: '18090' } as NodeJS.ProcessEnv));
    const recentOrderProvider = options.mockClientOptions?.recentOrderProvider;

    expect(recentOrderProvider).toBeTypeOf('function');
    if (!recentOrderProvider) throw new Error('recentOrderProvider missing');
    await expect(Promise.resolve(recentOrderProvider('anon_customer_integration_04-sau-khi-dat-don_1'))).resolves.toMatchObject({
      ok: true,
      value: { id: 'KFC-1024', paymentStatus: 'paid' },
    });
    await expect(
      Promise.resolve(recentOrderProvider('anon_customer_integration_08-thanh-toan-loi-va-don-bat-thuong_1')),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: 'KFC-MOCK-1001', paymentStatus: 'pending' },
    });
    await expect(Promise.resolve(recentOrderProvider('regular_customer'))).resolves.toMatchObject({ ok: true, value: null });
  });
});
