import { ChatOpenAI } from '@langchain/openai';
import { describe, expect, it } from 'vitest';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';

function env(overrides: NodeJS.ProcessEnv = {}) {
  return loadEnv({
    PORT: '18090',
    KFC_COMMERCE_MODE: 'fixture',
    ...overrides,
  });
}

describe('PVCFC server composition', () => {
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

  it('composes fixture data independently of model credentials', () => {
    const options = buildServerOptionsFromEnv(
      env({ PVCFC_PUBLIC_DATA_MODE: 'fixture' }),
    );

    expect(options.pvcfcPublicDataProvider).toBeDefined();
    expect(options.pvcfcAgentModel).toBeUndefined();
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
