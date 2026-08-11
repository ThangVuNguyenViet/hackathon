import { describe, expect, it } from 'vitest';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';

function baseEnv() {
  return loadEnv({
    PORT: '18090',
    KFC_COMMERCE_MODE: 'fixture',
    KFC_AGENT_RUNTIME: 'openai-responses',
    KFC_AGENT_PROVIDER: 'openai',
    KFC_AGENT_MODEL: 'gpt-4.1-mini',
    OPENAI_API_KEY: 'kfc-openai-key',
    OPENAI_BASE_URL: 'https://api.openai.test/v1',
  } as NodeJS.ProcessEnv);
}

describe('PVCFC server model isolation', () => {
  it('creates a dedicated AstraFlow-backed agent without reusing the KFC client', () => {
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
        PVCFC_PUBLIC_DATA_MODE: 'fixture',
      } as NodeJS.ProcessEnv),
    );

    expect(options.openAiAgent).toBeInstanceOf(OpenAiKfcAgent);
    expect(options.pvcfcAgent).toBeInstanceOf(OpenAiKfcAgent);
    expect(options.pvcfcPublicDataProvider).toBeDefined();
    expect(Reflect.get(options.openAiAgent!, 'model')).toBe('gpt-4.1-mini');
    expect(Reflect.get(options.pvcfcAgent!, 'model')).toBe('gpt-5.6-luna');
    expect(Reflect.get(options.pvcfcAgent!, 'compaction')).toEqual({
      enabled: false,
      thresholdBytes: 98_304,
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
    const options = buildServerOptionsFromEnv(baseEnv());

    expect(options.openAiAgent).toBeInstanceOf(OpenAiKfcAgent);
    expect(options.pvcfcAgent).toBeUndefined();
    expect(options.pvcfcPublicDataProvider).toBeUndefined();
  });

  it('fails closed when the PVCFC model has no explicit public-data mode', () => {
    expect(() =>
      buildServerOptionsFromEnv(
        loadEnv({
          PORT: '18090',
          KFC_COMMERCE_MODE: 'fixture',
          PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-astraflow-key',
        } as NodeJS.ProcessEnv),
      ),
    ).toThrow('PVCFC_PUBLIC_DATA_MODE is required');
  });

  it('fails closed when API mode has no configured provider adapter', () => {
    expect(() =>
      buildServerOptionsFromEnv(
        loadEnv({
          PORT: '18090',
          KFC_COMMERCE_MODE: 'fixture',
          PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-astraflow-key',
          PVCFC_PUBLIC_DATA_MODE: 'api',
        } as NodeJS.ProcessEnv),
      ),
    ).toThrow('PVCFC public data API provider is not configured');
  });
});
