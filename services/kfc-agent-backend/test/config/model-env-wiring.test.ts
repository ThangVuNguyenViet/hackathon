import { describe, expect, it } from 'vitest';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { isTrustedConfiguredAgentModelBinding } from '../../src/config/agentModelProfile.js';
import { loadEnv } from '../../src/config/env.js';

describe('model candidate environment wiring', () => {
  it('defaults the runtime to the OpenAI control candidate', () => {
    expect(loadEnv({}).KFC_AGENT_CANDIDATE).toBe(
      'openai-gpt-4.1-mini',
    );
  });

  it('parses only trusted candidate identifiers', () => {
    expect(
      loadEnv({
        KFC_AGENT_CANDIDATE: 'deepseek-v4-flash',
        KFC_MONITOR_CANDIDATE: 'openai-gpt-4.1-mini',
      }),
    ).toMatchObject({
      KFC_AGENT_CANDIDATE: 'deepseek-v4-flash',
      KFC_MONITOR_CANDIDATE: 'openai-gpt-4.1-mini',
    });
    expect(() =>
      loadEnv({ KFC_AGENT_CANDIDATE: 'untrusted-model' }),
    ).toThrow();
  });

  it('constructs the selected server model without applying an arbitrary OpenAI base URL to OpenCode', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        KFC_AGENT_CANDIDATE: 'deepseek-v4-flash',
        OPENCODE_API_KEY: 'test-opencode',
        OPENAI_BASE_URL: 'https://untrusted.example/v1',
        KFC_COMMERCE_MODE: 'fixture',
      }),
    );

    expect(options.agent?.identity).toMatchObject({
      candidateId: 'deepseek-v4-flash',
      provider: 'opencode',
      model: 'deepseek-v4-flash',
      transport: 'openai_compatible_chat',
    });
    expect(Reflect.get(options.agent?.model ?? {}, 'clientConfig')).toMatchObject(
      {
        baseURL: 'https://opencode.ai/zen/go/v1',
      },
    );
    expect(isTrustedConfiguredAgentModelBinding(options.agent)).toBe(true);
    expect(options.readiness?.runtime?.agent).toEqual(options.agent?.identity);
  });

  it('keeps an explicitly selected monitor pinned to its own candidate', () => {
    const options = buildServerOptionsFromEnv(
      loadEnv({
        KFC_AGENT_CANDIDATE: 'qwen3.7-max',
        KFC_MONITOR_CANDIDATE: 'minimax-m3',
        OPENCODE_API_KEY: 'test-opencode',
        KFC_COMMERCE_MODE: 'fixture',
      }),
    );

    expect(options.agent?.identity.candidateId).toBe('qwen3.7-max');
    expect(options.readiness?.runtime?.monitor).toMatchObject({
      candidateId: 'minimax-m3',
      model: 'minimax-m3',
      transport: 'anthropic_messages',
    });
    expect(options.monitorJudge).toBeDefined();
  });
});
