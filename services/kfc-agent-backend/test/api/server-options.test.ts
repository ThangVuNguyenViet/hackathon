import { describe, expect, it } from 'vitest';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';
import { buildServer } from '../../src/api/server.js';

describe('buildServerOptionsFromEnv', () => {
  it('exposes release, runtime, graph, and version bindings only in deep readiness proof metadata', async () => {
    const options = buildServerOptionsFromEnv(loadEnv({ PORT: '18090', KFC_COMMERCE_MODE: 'fixture', RELEASE_GIT_SHA: 'release-1', RELEASE_DEPLOYMENT_ID: 'deployment-1', RELEASE_BUILT_AT: '2026-07-15T00:00:00Z', RELEASE_DIRTY: 'false' } as NodeJS.ProcessEnv));
    const server = buildServer(options);
    expect((await server.inject({ method: 'GET', url: '/ready' })).json()).not.toHaveProperty('proof');
    expect((await server.inject({ method: 'GET', url: '/ready?deep=1' })).json()).toMatchObject({
      release: { gitSha: 'release-1', deploymentId: 'deployment-1', builtAt: '2026-07-15T00:00:00Z', dirty: false },
      proof: {
        deployment: { gitSha: 'release-1', deploymentId: 'deployment-1' },
        graph: { runtime: 'langchain-create-agent-v1' },
        versions: {
          agent: {
            provider: 'google',
            model: 'gemini-3.1-flash-lite',
            profile: 'google-gemini-3.1-flash-lite-thinking-low',
          },
          ledger: 'kfc-scenario-ledger-v1',
        },
      },
    });
  });
  it('uses one affordable agent profile and a separate monitor model by default', () => {
    const env = loadEnv({ PORT: '18090' } as NodeJS.ProcessEnv);

    expect(env.KFC_AGENT_PROVIDER).toBe('google');
    expect(env.KFC_AGENT_MODEL).toBe('');
    expect(env.OPENAI_MONITOR_JUDGE_MODEL).toBe('gpt-4.1-nano');
  });

  it('maps channel environment variables into route options', () => {
    const env = loadEnv({
      PORT: '18090',
      OPENAI_API_KEY: 'openai_key_local',
      KFC_AGENT_PROVIDER: 'openai',
      KFC_AGENT_MODEL: 'gpt-4.1-mini',
      OPENAI_BASE_URL: 'https://openai.local/v1',
      LANGSMITH_API_KEY: 'langsmith_key_local',
      LANGSMITH_PROJECT: 'kfc-agent-backend-local',
      LANGSMITH_ENDPOINT: 'https://apac.api.smith.langchain.com',
      LANGSMITH_TRACING_SAMPLING_RATE: '1',
      MESSENGER_VERIFY_TOKEN: 'verify_local',
      META_APP_SECRET: 'meta_app_secret_local',
      META_PAGE_ID: '118976205445198',
      META_PAGE_ACCESS_TOKEN: 'page_token_local',
      META_INBOX_URL_TEMPLATE: 'https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}',
      MESSENGER_GRAPH_API_BASE_URL: 'https://graph.local',
      ZALO_OA_ID: 'oa_local',
      ZALO_ACCESS_TOKEN: 'zalo_token_local',
      ZALO_INBOX_URL_TEMPLATE: 'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}',
      ZALO_API_BASE_URL: 'https://zalo.local',
      KFC_DEMO_ADMIN_TOKEN: 'demo_admin_local',
      KFC_COMMERCE_MODE: 'fixture',
    } as NodeJS.ProcessEnv);

    expect(buildServerOptionsFromEnv(env)).toMatchObject({
      messengerVerifyToken: 'verify_local',
      metaAppSecret: 'meta_app_secret_local',
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
      demoAdminToken: 'demo_admin_local',
      agent: {
        identity: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          profile: 'openai-gpt-4.1-mini',
        },
        model: expect.any(Object),
      },
      mockClientOptions: {
        contentSemanticRanker: expect.any(Object),
      },
      agentTracer: expect.any(Object),
    });
  });

  it('does not silently fall back when the selected agent credential is absent', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
    } as NodeJS.ProcessEnv);

    expect(buildServerOptionsFromEnv(env).agent).toBeUndefined();
    expect(buildServerOptionsFromEnv(env).mockClientOptions).toBeUndefined();
    expect(buildServerOptionsFromEnv(env).agentTracer).toBeUndefined();
  });

  it('creates the official Edge Google adapter from the pinned Google profile', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      KFC_AGENT_PROVIDER: 'google',
      KFC_AGENT_MODEL: 'gemini-3.1-flash-lite',
      GOOGLE_API_KEY: 'google_key_local',
    } as NodeJS.ProcessEnv);

    expect(buildServerOptionsFromEnv(env)).toMatchObject({
      agent: {
        identity: {
          provider: 'google',
          model: 'gemini-3.1-flash-lite',
          profile: 'google-gemini-3.1-flash-lite-thinking-low',
        },
        model: expect.any(Object),
      },
      readiness: {
        agentConfigured: true,
        runtime: {
          agent: {
            provider: 'google',
            model: 'gemini-3.1-flash-lite',
          },
        },
      },
    });
  });

  it('fails closed when a configured model drifts from its profile', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      KFC_AGENT_PROVIDER: 'openai',
      KFC_AGENT_MODEL: 'gpt-4.1',
      OPENAI_API_KEY: 'openai_key_local',
    } as NodeJS.ProcessEnv);

    expect(() => buildServerOptionsFromEnv(env)).toThrow('KFC agent model drift');
  });

  it('parses LangSmith endpoint and sampling configuration', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      LANGSMITH_ENDPOINT: 'https://apac.api.smith.langchain.com',
      LANGSMITH_TRACING_SAMPLING_RATE: '0.25',
    } as NodeJS.ProcessEnv);

    expect(env.LANGSMITH_ENDPOINT).toBe('https://apac.api.smith.langchain.com');
    expect(env.LANGSMITH_TRACING_SAMPLING_RATE).toBe(0.25);
  });

  it('does not default Meta page id in runtime env parsing', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
    } as NodeJS.ProcessEnv);

    expect(env.META_PAGE_ID).toBe('');
    expect(buildServerOptionsFromEnv(env).metaPageId).toBeUndefined();
  });

  it('keeps deployed GenUI proof preconditions out of runtime environment options', () => {
    const options = buildServerOptionsFromEnv(loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
    } as NodeJS.ProcessEnv));

    expect(options.mockClientOptions?.initialOrders).toBeUndefined();
    expect(options.mockClientOptions?.recentOrderProvider).toBeUndefined();
    expect(options.mockClientOptions?.paymentStatusProvider).toBeUndefined();
    expect(options.mockClientOptions?.fulfillmentQuoteProvider).toBeUndefined();
  });

  it('fails closed when the default gateway provider is not configured', () => {
    expect(() => buildServerOptionsFromEnv(loadEnv({ PORT: '18090' } as NodeJS.ProcessEnv))).toThrow(
      'KFC_COMMERCE_GATEWAY_BASE_URL, KFC_COMMERCE_GATEWAY_TOKEN, KFC_MENU_API_URL, and KFC_COMMERCE_ENVIRONMENT are required',
    );
  });

  it('bounds and maps the catalog freshness fallback', () => {
    const options = buildServerOptionsFromEnv(loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'gateway',
      KFC_COMMERCE_ENVIRONMENT: 'sandbox',
      KFC_MENU_API_URL: 'https://catalog.example/menu',
      KFC_COMMERCE_GATEWAY_BASE_URL: 'https://commerce.example',
      KFC_COMMERCE_GATEWAY_TOKEN: 'token',
      CATALOG_TTL_SECONDS: '600',
    } as NodeJS.ProcessEnv));

    expect(options.catalog?.fallbackTtlSeconds).toBe(600);
    expect(options.readiness?.commerce?.requiredCapabilities).toEqual(['orders', 'payment']);
    expect(() => loadEnv({ CATALOG_TTL_SECONDS: '3601' } as NodeJS.ProcessEnv)).toThrow();
  });
});
