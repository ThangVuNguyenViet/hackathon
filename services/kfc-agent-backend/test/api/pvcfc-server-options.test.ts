import { ChatOpenAI } from '@langchain/openai';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { TinyFishClient } from '../../src/web/tinyFishClient.js';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { buildServer } from '../../src/api/server.js';
import { loadEnv } from '../../src/config/env.js';

function env(overrides: NodeJS.ProcessEnv = {}) {
  return loadEnv({
    PORT: '18090',
    KFC_COMMERCE_MODE: 'fixture',
    ...overrides,
  });
}

describe('PVCFC server composition', () => {
  it('requires an explicit business binding for every configured social channel', () => {
    expect(() =>
      buildServerOptionsFromEnv(
        env({ ZALO_OA_ID: 'oa-pvcfc', ZALO_ACCESS_TOKEN: 'token' }),
      ),
    ).toThrow('ZALO_BUSINESS_ID is required');
    expect(() =>
      buildServerOptionsFromEnv(
        env({ META_PAGE_ID: 'page-pvcfc', META_PAGE_ACCESS_TOKEN: 'token' }),
      ),
    ).toThrow('MESSENGER_BUSINESS_ID is required');
    expect(() => env({ ZALO_BUSINESS_ID: 'inferred' })).toThrow();
  });

  it('projects explicit PVCFC channel bindings without inferring from credentials', () => {
    const options = buildServerOptionsFromEnv(
      env({
        PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-key',
        PVCFC_PUBLIC_DATA_MODE: 'fixture',
        ZALO_OA_ID: 'oa-pvcfc',
        ZALO_ACCESS_TOKEN: 'token',
        ZALO_BUSINESS_ID: 'pvcfc',
        META_PAGE_ID: 'page-pvcfc',
        META_PAGE_ACCESS_TOKEN: 'token',
        MESSENGER_BUSINESS_ID: 'pvcfc',
      }),
    );

    expect(options.zaloBusinessId).toBe('pvcfc');
    expect(options.messengerBusinessId).toBe('pvcfc');
  });

  it('reports the trusted business and target-agent readiness for each channel', async () => {
    const options = buildServerOptionsFromEnv(
      env({
        PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-key',
        PVCFC_PUBLIC_DATA_MODE: 'fixture',
        ZALO_BUSINESS_ID: 'pvcfc',
        ZALO_OA_ID: 'oa-pvcfc',
        ZALO_ACCESS_TOKEN: 'zalo-token',
        ZALO_INBOX_URL_TEMPLATE: 'https://oa.zalo.me/{externalUserId}',
        MESSENGER_BUSINESS_ID: 'pvcfc',
        MESSENGER_VERIFY_TOKEN: 'verify',
        META_APP_SECRET: 'app-secret',
        META_PAGE_ID: 'page-pvcfc',
        META_PAGE_ACCESS_TOKEN: 'page-token',
        META_INBOX_URL_TEMPLATE:
          'https://business.facebook.com/{externalUserId}',
      }),
    );
    const server = buildServer({
      ...options,
      readiness: {
        ...options.readiness,
        database: async () => ({ ok: true }),
        messengerRequired: false,
        zaloRequired: false,
      },
    });

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      checks: {
        messenger: {
          businessId: 'pvcfc',
          agentConfigured: true,
        },
        zalo: {
          businessId: 'pvcfc',
          agentConfigured: true,
        },
      },
    });
    await server.close();
  });

  it('creates ChatOpenAI against the configured AstraFlow-compatible endpoint', () => {
    const options = buildServerOptionsFromEnv(
      env({
        PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-key',
        PVCFC_ASTRAFLOW_BASE_URL: 'https://api-sg.umodelverse.ai/v1',
        PVCFC_ASTRAFLOW_MODEL: 'gpt-5.6-luna',
        PVCFC_PUBLIC_DATA_MODE: 'fixture',
      }),
    );

    expect(options.pvcfcAgentModel).toBeInstanceOf(ChatOpenAI);
    expect(Reflect.get(options.pvcfcAgentModel!, 'model')).toBe('gpt-5.6-luna');
    expect(Reflect.get(options.pvcfcAgentModel!, 'clientConfig')).toMatchObject(
      {
        apiKey: 'pvcfc-key',
        baseURL: 'https://api-sg.umodelverse.ai/v1',
      },
    );
    expect(options.pvcfcPublicDataProvider).toBeDefined();
  });

  it('keeps PVCFC-only deployment readiness healthy without a KFC model key', async () => {
    const options = buildServerOptionsFromEnv(
      env({
        PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-key',
        PVCFC_ASTRAFLOW_MODEL: 'gpt-5.6-luna',
        PVCFC_PUBLIC_DATA_MODE: 'fixture',
      }),
    );
    const server = buildServer({
      ...options,
      readiness: {
        ...options.readiness,
        database: async () => ({ ok: true }),
        messengerRequired: false,
        zaloRequired: false,
      },
    });

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      checks: {
        agent: { ok: true, required: false, configured: false },
        pvcfcAgent: {
          ok: true,
          required: false,
          configured: true,
          provider: 'astraflow',
          model: 'gpt-5.6-luna',
        },
      },
    });
    await server.close();
  });

  it('composes fixture data independently of model credentials', () => {
    const options = buildServerOptionsFromEnv(
      env({ PVCFC_PUBLIC_DATA_MODE: 'fixture' }),
    );

    expect(options.pvcfcPublicDataProvider).toBeDefined();
    expect(options.pvcfcAgentModel).toBeUndefined();
    expect(options.pvcfcWebEvidenceClient).toBeUndefined();
    expect(options.kfcWebEvidenceClient).toBeUndefined();
    expect(options.readiness?.webSearch).toEqual({
      configured: false,
      provider: 'tinyfish',
      mode: 'search-fetch',
    });
  });

  it('optionally composes a bounded TinyFish client without exposing its secret', () => {
    const secret = 'tinyfish-secret-that-must-not-leak';
    const options = buildServerOptionsFromEnv(
      env({
        PVCFC_PUBLIC_DATA_MODE: 'fixture',
        TINYFISH_API_KEY: secret,
      }),
    );

    expect(options.pvcfcWebEvidenceClient).toBeDefined();
    expect(options.kfcWebEvidenceClient).toBe(options.pvcfcWebEvidenceClient);
    expect(options.readiness?.webSearch).toEqual({
      configured: true,
      provider: 'tinyfish',
      mode: 'search-fetch',
    });
    expect(JSON.stringify(options.readiness)).not.toContain(secret);
    expect(JSON.stringify(options.pvcfcWebEvidenceClient)).not.toContain(
      secret,
    );
    expect(JSON.stringify(options.kfcWebEvidenceClient)).not.toContain(secret);
  });

  it('constructs TinyFish with a four-second zero-retry adapter envelope', () => {
    const client: TinyFishClient = {
      search: vi.fn(async () => []),
      fetch: vi.fn(async ({ url }) => ({
        sourceUrl: url,
        finalUrl: url,
        title: '',
        text: '',
        retrievedAt: '2026-08-12T00:00:00.000Z',
      })),
    };
    const tinyFishClientFactory = vi.fn(() => client);

    const options = buildServerOptionsFromEnv(
      env({
        PVCFC_PUBLIC_DATA_MODE: 'fixture',
        TINYFISH_API_KEY: 'bounded-key',
      }),
      { tinyFishClientFactory },
    );

    expect(tinyFishClientFactory).toHaveBeenCalledWith({
      apiKey: 'bounded-key',
      timeoutMs: 4_000,
    });
    expect(options.pvcfcWebEvidenceClient).toBe(client);
    expect(options.kfcWebEvidenceClient).toBe(client);
  });

  it('treats a blank TinyFish key as unavailable rather than constructing a client', () => {
    const options = buildServerOptionsFromEnv(
      env({ PVCFC_PUBLIC_DATA_MODE: 'fixture', TINYFISH_API_KEY: '   ' }),
    );

    expect(options.pvcfcWebEvidenceClient).toBeUndefined();
    expect(options.kfcWebEvidenceClient).toBeUndefined();
    expect(options.readiness?.webSearch?.configured).toBe(false);
  });

  it('fails closed for a model without provider mode and for unsupported API mode', () => {
    expect(() =>
      buildServerOptionsFromEnv(env({ PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-key' })),
    ).toThrow('PVCFC_PUBLIC_DATA_MODE is required');
    expect(() =>
      buildServerOptionsFromEnv(env({ PVCFC_PUBLIC_DATA_MODE: 'api' })),
    ).toThrow('PVCFC public data API provider is not configured');
  });
});
