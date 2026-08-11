import { describe, expect, it } from 'vitest';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';
import { buildServer } from '../../src/api/server.js';
import { ModelMonitorJudge } from '../../src/llm/monitorJudge.js';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';

describe('buildServerOptionsFromEnv', () => {
  it('isolates the PVCFC AstraFlow client from the KFC OpenAI client', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        PORT: '18090',
        KFC_COMMERCE_MODE: 'fixture',
        KFC_AGENT_RUNTIME: 'openai-responses',
        KFC_AGENT_PROVIDER: 'openai',
        KFC_AGENT_MODEL: 'gpt-4.1-mini',
        OPENAI_API_KEY: 'kfc-openai-key',
        OPENAI_BASE_URL: 'https://api.openai.test/v1',
        PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-astraflow-key',
        PVCFC_ASTRAFLOW_BASE_URL: 'https://api-sg.umodelverse.ai/v1',
        PVCFC_ASTRAFLOW_MODEL: 'gpt-5.6-luna',
      } as NodeJS.ProcessEnv),
    );

    expect(options.openAiAgent).toBeInstanceOf(OpenAiKfcAgent);
    expect(options.pvcfcAgent).toBeInstanceOf(OpenAiKfcAgent);
    expect(Reflect.get(options.openAiAgent!, 'model')).toBe('gpt-4.1-mini');
    expect(Reflect.get(options.pvcfcAgent!, 'model')).toBe('gpt-5.6-luna');
    expect(Reflect.get(options.pvcfcAgent!, 'compaction')).toEqual({
      enabled: false,
      thresholdBytes: 98304,
    });

    const kfcClient: unknown = Reflect.get(options.openAiAgent!, 'client');
    const pvcfcClient: unknown = Reflect.get(options.pvcfcAgent!, 'client');
    expect(kfcClient).not.toBe(pvcfcClient);
    expect(kfcClient).toMatchObject({
      baseURL: 'https://api.openai.test/v1',
      apiKey: 'kfc-openai-key',
    });
    expect(pvcfcClient).toMatchObject({
      baseURL: 'https://api-sg.umodelverse.ai/v1',
      apiKey: 'pvcfc-astraflow-key',
    });
  });

  it('does not create a PVCFC agent from the KFC OpenAI credential', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        PORT: '18090',
        KFC_COMMERCE_MODE: 'fixture',
        KFC_AGENT_RUNTIME: 'openai-responses',
        KFC_AGENT_PROVIDER: 'openai',
        KFC_AGENT_MODEL: 'gpt-4.1-mini',
        OPENAI_API_KEY: 'kfc-openai-key',
      } as NodeJS.ProcessEnv),
    );

    expect(options.openAiAgent).toBeInstanceOf(OpenAiKfcAgent);
    expect(options.pvcfcAgent).toBeUndefined();
  });

  it('configures SDK compaction explicitly for the direct runtime', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        PORT: '18090',
        KFC_AGENT_RUNTIME: 'openai-responses',
        KFC_AGENT_PROVIDER: 'openai',
        KFC_AGENT_MODEL: 'gpt-4.1-mini',
        OPENAI_API_KEY: 'test-openai-key',
        KFC_AGENT_COMPACTION_ENABLED: 'true',
        KFC_AGENT_COMPACTION_THRESHOLD_BYTES: '131072',
        KFC_AGENT_COMPACTION_MODEL: 'gpt-4.1-mini',
        KFC_COMMERCE_MODE: 'fixture',
      } as NodeJS.ProcessEnv),
    );

    expect(Reflect.get(options.openAiAgent!, 'compaction')).toEqual({
      enabled: true,
      thresholdBytes: 131072,
      model: 'gpt-4.1-mini',
    });
  });

  it('enables verified SDK compaction by default with a conservative threshold', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        PORT: '18090',
        KFC_AGENT_RUNTIME: 'openai-responses',
        KFC_AGENT_PROVIDER: 'openai',
        KFC_AGENT_MODEL: 'gpt-4.1-mini',
        OPENAI_API_KEY: 'test-openai-key',
        KFC_COMMERCE_MODE: 'fixture',
      } as NodeJS.ProcessEnv),
    );

    expect(Reflect.get(options.openAiAgent!, 'compaction')).toEqual({
      enabled: true,
      thresholdBytes: 98304,
    });
  });

  it('exposes release, runtime, graph, and version bindings only in deep readiness proof metadata', async () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        PORT: '18090',
        KFC_COMMERCE_MODE: 'fixture',
        RELEASE_GIT_SHA: 'release-1',
        RELEASE_DEPLOYMENT_ID: 'deployment-1',
        RELEASE_BUILT_AT: '2026-07-15T00:00:00Z',
        RELEASE_DIRTY: 'false',
      } as NodeJS.ProcessEnv),
    );
    const server = buildServer(options);
    const shallow = await server.inject({ method: 'GET', url: '/ready' });
    expect(shallow.statusCode).toBe(503);
    expect(shallow.json()).toMatchObject({
      checks: {
        monitor: {
          ok: true,
          required: false,
          configured: false,
          provider: 'google',
          model: 'gemini-3.1-flash-lite',
        },
      },
    });
    expect(shallow.json()).not.toHaveProperty('proof');
    expect(
      (await server.inject({ method: 'GET', url: '/ready?deep=1' })).json(),
    ).toMatchObject({
      release: {
        gitSha: 'release-1',
        deploymentId: 'deployment-1',
        builtAt: '2026-07-15T00:00:00Z',
        dirty: false,
      },
      proof: {
        deployment: { gitSha: 'release-1', deploymentId: 'deployment-1' },
        graph: { runtime: 'langgraph-create-agent-workflow-v1' },
        versions: {
          agent: {
            provider: 'google',
            model: 'gemini-3.1-flash-lite',
            profile: 'google-gemini-3.1-flash-lite-thinking-low',
          },
          monitor: {
            provider: 'google',
            model: 'gemini-3.1-flash-lite',
            profile: 'google-gemini-3.1-flash-lite-thinking-low-monitor',
          },
          ledger: 'kfc-scenario-ledger-v1',
        },
      },
    });
  });
  it('uses affordable provider-aligned agent and monitor profiles by default', () => {
    const env = loadEnv({ PORT: '18090' } as NodeJS.ProcessEnv);

    expect(env.KFC_AGENT_PROFILE_MODE).toBe('production');
    expect(env.KFC_AGENT_PROVIDER).toBe('google');
    expect(env.KFC_AGENT_MODEL).toBe('');
    expect(env.KFC_MONITOR_PROVIDER).toBeUndefined();
    expect(env.KFC_MONITOR_MODEL).toBe('');
  });

  it('maps channel environment variables into route options', () => {
    const env = loadEnv({
      PORT: '18090',
      OPENAI_API_KEY: 'openai_key_local',
      KFC_AGENT_PROVIDER: 'openai',
      KFC_AGENT_MODEL: 'gpt-5-mini-2025-08-07',
      OPENAI_BASE_URL: 'https://openai.local/v1',
      LANGSMITH_API_KEY: 'langsmith_key_local',
      LANGSMITH_PROJECT: 'kfc-agent-backend-local',
      LANGSMITH_ENDPOINT: 'https://apac.api.smith.langchain.com',
      LANGSMITH_TRACING_SAMPLING_RATE: '1',
      MESSENGER_VERIFY_TOKEN: 'verify_local',
      META_APP_SECRET: 'meta_app_secret_local',
      META_PAGE_ID: '118976205445198',
      META_PAGE_ACCESS_TOKEN: 'page_token_local',
      META_INBOX_URL_TEMPLATE:
        'https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}',
      MESSENGER_GRAPH_API_BASE_URL: 'https://graph.local',
      ZALO_OA_ID: '4225933857518051795',
      ZALO_ACCESS_TOKEN: 'zalo_token_local',
      ZALO_INBOX_URL_TEMPLATE:
        'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}',
      ZALO_API_BASE_URL: 'https://zalo.local',
      KFC_DEMO_ADMIN_TOKEN: 'demo_admin_local',
      KFC_COMMERCE_MODE: 'fixture',
    } as NodeJS.ProcessEnv);

    const options = buildServerOptionsFromEnv(env);

    expect(options).toMatchObject({
      messengerVerifyToken: 'verify_local',
      metaAppSecret: 'meta_app_secret_local',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      metaInboxUrlTemplate:
        'https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}',
      messengerGraphApiBaseUrl: 'https://graph.local',
      zaloOaId: '4225933857518051795',
      zaloAccessToken: 'zalo_token_local',
      zaloInboxUrlTemplate:
        'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}',
      zaloApiBaseUrl: 'https://zalo.local',
      demoAdminToken: 'demo_admin_local',
      agent: {
        identity: {
          provider: 'openai',
          model: 'gpt-5-mini-2025-08-07',
          profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
        },
        model: expect.any(Object),
      },
      monitorJudge: expect.any(Object),
      agentTracer: expect.any(Object),
      readiness: {
        monitorConfigured: true,
        runtime: {
          monitor: {
            provider: 'openai',
            model: 'gpt-5-mini-2025-08-07',
            profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
          },
        },
      },
    });
    expect(options).not.toHaveProperty('responseComposer');
    expect(options).not.toHaveProperty('toolPlanner');
    expect(options).not.toHaveProperty('smallTalkRouter');
    expect(options.mockClientOptions).toBeUndefined();
    expect(options.monitorJudge).toBeInstanceOf(ModelMonitorJudge);
    expect((options.monitorJudge as ModelMonitorJudge).identity).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini-2025-08-07',
      profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
    });
  });

  it('does not silently fall back when the selected agent credential is absent', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      OPENAI_API_KEY: 'unrelated_openai_key',
    } as NodeJS.ProcessEnv);

    expect(buildServerOptionsFromEnv(env).agent).toBeUndefined();
    expect(buildServerOptionsFromEnv(env).monitorJudge).toBeUndefined();
    expect(buildServerOptionsFromEnv(env).readiness?.monitorConfigured).toBe(
      false,
    );
    expect(buildServerOptionsFromEnv(env).mockClientOptions).toBeUndefined();
    expect(buildServerOptionsFromEnv(env).agentTracer).toBeUndefined();
  });

  it('configures only the direct agent for the Responses runtime', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        PORT: '18090',
        KFC_COMMERCE_MODE: 'fixture',
        KFC_AGENT_RUNTIME: 'openai-responses',
        KFC_AGENT_PROVIDER: 'openai',
        KFC_AGENT_MODEL: 'gpt-4.1-mini',
        OPENAI_API_KEY: 'openai_key_local',
      } as NodeJS.ProcessEnv),
    );

    expect(options.agent).toBeUndefined();
    expect(options.openAiAgent).toBeInstanceOf(OpenAiKfcAgent);
    expect(options.readiness?.agentConfigured).toBe(true);
  });

  it('uses affordable deep thinking by default in explicit qualification mode', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      KFC_AGENT_PROFILE_MODE: 'qualification',
      KFC_AGENT_PROVIDER: 'google',
      GOOGLE_API_KEY: 'google_key_local',
      OPENAI_API_KEY: 'openai_key_local',
    } as NodeJS.ProcessEnv);

    expect(buildServerOptionsFromEnv(env)).toMatchObject({
      agent: {
        identity: {
          provider: 'google',
          model: 'gemini-3.1-flash-lite',
          profile: 'google-gemini-3.1-flash-lite-thinking-high-qualification',
        },
      },
      readiness: {
        agentConfigured: true,
        runtime: {
          agentProfileMode: 'qualification',
        },
      },
    });
  });

  it('rejects expensive Gemini overrides in qualification and production', () => {
    const qualificationEnv = {
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      KFC_AGENT_PROFILE_MODE: 'qualification',
      KFC_AGENT_PROVIDER: 'google',
      KFC_AGENT_MODEL: 'gemini-3.5-flash',
      GOOGLE_API_KEY: 'google_key_local',
      OPENAI_API_KEY: 'openai_key_local',
    } as NodeJS.ProcessEnv;

    expect(() => buildServerOptionsFromEnv(loadEnv(qualificationEnv))).toThrow(
      'KFC qualification agent model drift',
    );
    expect(() =>
      buildServerOptionsFromEnv(
        loadEnv({
          ...qualificationEnv,
          KFC_AGENT_PROFILE_MODE: 'production',
        }),
      ),
    ).toThrow('KFC production agent model drift');
  });

  it('creates the official Edge Google adapter from the pinned Google profile', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      KFC_AGENT_PROVIDER: 'google',
      KFC_AGENT_MODEL: 'gemini-3.1-flash-lite',
      GOOGLE_API_KEY: 'google_key_local',
    } as NodeJS.ProcessEnv);

    const options = buildServerOptionsFromEnv(env);
    expect(options).toMatchObject({
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
    expect(options.monitorJudge).toBeInstanceOf(ModelMonitorJudge);
    expect((options.monitorJudge as ModelMonitorJudge).identity).toMatchObject({
      provider: 'google',
      model: 'gemini-3.1-flash-lite',
      profile: 'google-gemini-3.1-flash-lite-thinking-low-monitor',
    });
  });

  it('allows a cross-provider monitor only through explicit pinned configuration', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      KFC_AGENT_PROVIDER: 'google',
      GOOGLE_API_KEY: 'google_key_local',
      KFC_MONITOR_PROVIDER: 'openai',
      KFC_MONITOR_MODEL: 'gpt-5-mini-2025-08-07',
      OPENAI_API_KEY: 'openai_key_local',
    } as NodeJS.ProcessEnv);

    const options = buildServerOptionsFromEnv(env);
    expect((options.monitorJudge as ModelMonitorJudge).identity).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini-2025-08-07',
      profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
    });
  });

  it('fails explicit monitor configuration closed on model drift or missing credentials', () => {
    const base = {
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      KFC_AGENT_PROVIDER: 'google',
      GOOGLE_API_KEY: 'google_key_local',
      KFC_MONITOR_PROVIDER: 'openai',
    } as NodeJS.ProcessEnv;

    expect(() =>
      buildServerOptionsFromEnv(
        loadEnv({
          ...base,
          KFC_MONITOR_MODEL: 'gpt-4.1',
          OPENAI_API_KEY: 'openai_key_local',
        }),
      ),
    ).toThrow('KFC monitor model drift');
    expect(() =>
      buildServerOptionsFromEnv(
        loadEnv({
          ...base,
          KFC_MONITOR_MODEL: 'gpt-5-mini-2025-08-07',
        }),
      ),
    ).toThrow(
      'OPENAI_API_KEY is required for the explicitly configured KFC monitor provider',
    );
  });

  it('fails closed when a configured model drifts from its profile', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      KFC_AGENT_PROVIDER: 'openai',
      KFC_AGENT_MODEL: 'gpt-4.1',
      OPENAI_API_KEY: 'openai_key_local',
    } as NodeJS.ProcessEnv);

    expect(() => buildServerOptionsFromEnv(env)).toThrow(
      'KFC production agent model drift',
    );
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

  it('normalizes optional credentials and drops whitespace-only secrets', () => {
    const env = loadEnv({
      PORT: '18090',
      KFC_COMMERCE_MODE: 'fixture',
      META_PAGE_ACCESS_TOKEN: '   ',
      ZALO_ACCESS_TOKEN: '\t  ',
      KFC_DEMO_ADMIN_TOKEN: '  demo-admin-token  ',
    } as NodeJS.ProcessEnv);

    const options = buildServerOptionsFromEnv(env);
    expect(options.messengerPageAccessToken).toBeUndefined();
    expect(options.zaloAccessToken).toBeUndefined();
    expect(options.demoAdminToken).toBe('demo-admin-token');
  });

  it('keeps deployed GenUI proof preconditions out of runtime environment options', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        PORT: '18090',
        KFC_COMMERCE_MODE: 'fixture',
      } as NodeJS.ProcessEnv),
    );

    expect(options.mockClientOptions?.initialOrders).toBeUndefined();
    expect(options.mockClientOptions?.recentOrderProvider).toBeUndefined();
    expect(options.mockClientOptions?.paymentStatusProvider).toBeUndefined();
    expect(options.mockClientOptions?.fulfillmentQuoteProvider).toBeUndefined();
  });

  it('fails closed when the default gateway provider is not configured', () => {
    expect(() =>
      buildServerOptionsFromEnv(
        loadEnv({ PORT: '18090' } as NodeJS.ProcessEnv),
      ),
    ).toThrow(
      'KFC_COMMERCE_GATEWAY_BASE_URL, KFC_COMMERCE_GATEWAY_TOKEN, KFC_MENU_API_URL, and KFC_COMMERCE_ENVIRONMENT are required',
    );
  });

  it('bounds and maps the catalog freshness fallback', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        PORT: '18090',
        KFC_COMMERCE_MODE: 'gateway',
        KFC_COMMERCE_ENVIRONMENT: 'sandbox',
        KFC_MENU_API_URL: 'https://catalog.example/menu',
        KFC_COMMERCE_GATEWAY_BASE_URL: 'https://commerce.example',
        KFC_COMMERCE_GATEWAY_TOKEN: 'token',
        CATALOG_TTL_SECONDS: '600',
      } as NodeJS.ProcessEnv),
    );

    expect(options.catalog?.fallbackTtlSeconds).toBe(600);
    expect(options.readiness?.commerce?.requiredCapabilities).toEqual([
      'orders',
      'payment',
      'handoff_resolution',
    ]);
    expect(options.readiness?.commerce?.implementedCapabilities).toEqual([
      'orders',
      'payment',
    ]);
    expect(() =>
      loadEnv({ CATALOG_TTL_SECONDS: '3601' } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});
