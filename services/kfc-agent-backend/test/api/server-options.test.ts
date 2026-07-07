import { describe, expect, it } from 'vitest';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';

describe('buildServerOptionsFromEnv', () => {
  it('maps channel environment variables into route options', () => {
    const env = loadEnv({
      PORT: '18090',
      MESSENGER_VERIFY_TOKEN: 'verify_local',
      META_PAGE_ID: '118976205445198',
      META_PAGE_ACCESS_TOKEN: 'page_token_local',
      MESSENGER_GRAPH_API_BASE_URL: 'https://graph.local',
      ZALO_OA_ID: 'oa_local',
      ZALO_ACCESS_TOKEN: 'zalo_token_local',
      ZALO_API_BASE_URL: 'https://zalo.local',
    } as NodeJS.ProcessEnv);

    expect(buildServerOptionsFromEnv(env)).toMatchObject({
      messengerVerifyToken: 'verify_local',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      zaloOaId: 'oa_local',
      zaloAccessToken: 'zalo_token_local',
      zaloApiBaseUrl: 'https://zalo.local',
    });
  });
});
