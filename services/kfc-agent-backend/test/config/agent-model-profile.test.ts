import { describe, expect, it } from 'vitest';
import {
  agentModelCandidateIds,
  createAgentChatModel,
  describeAgentChatModelFactory,
  liveAgentModelCandidateIds,
  resolveAgentModelProfile,
  type AgentModelProfile,
} from '../../src/config/agentModelProfile.js';

describe('KFC agent model candidates', () => {
  it('publishes only the trusted immutable candidate roster', () => {
    expect(agentModelCandidateIds).toEqual([
      'openai-gpt-4.1-mini',
      'deepseek-v4-flash',
      'qwen3.7-max',
      'minimax-m3',
      'google-gemini-3.1-flash-lite',
    ]);

    for (const candidateId of agentModelCandidateIds) {
      expect(
        Object.isFrozen(resolveAgentModelProfile({ candidateId })),
      ).toBe(true);
    }
  });

  it('keeps Google supported but outside the live qualification matrix', () => {
    expect(liveAgentModelCandidateIds).toEqual([
      'openai-gpt-4.1-mini',
      'deepseek-v4-flash',
      'qwen3.7-max',
      'minimax-m3',
    ]);
    expect(liveAgentModelCandidateIds).not.toContain(
      'google-gemini-3.1-flash-lite',
    );
    expect(Object.isFrozen(liveAgentModelCandidateIds)).toBe(true);
  });

  it('pins the OpenAI Responses control and preserves Google support', () => {
    expect(
      resolveAgentModelProfile({ candidateId: 'openai-gpt-4.1-mini' }),
    ).toEqual({
      candidateId: 'openai-gpt-4.1-mini',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      profile: 'openai:gpt-4.1-mini:responses',
      transport: 'openai_responses',
      credentialEnv: 'OPENAI_API_KEY',
    });
    expect(
      resolveAgentModelProfile({
        candidateId: 'google-gemini-3.1-flash-lite',
      }),
    ).toEqual({
      candidateId: 'google-gemini-3.1-flash-lite',
      provider: 'google',
      model: 'gemini-3.1-flash-lite',
      profile: 'google:gemini-3.1-flash-lite:thinking-low',
      transport: 'google_genai',
      credentialEnv: 'GOOGLE_API_KEY',
      thinkingLevel: 'LOW',
    });
  });

  it('pins the three OpenCode candidates to their verified transports', () => {
    expect(
      resolveAgentModelProfile({ candidateId: 'deepseek-v4-flash' }),
    ).toEqual({
      candidateId: 'deepseek-v4-flash',
      provider: 'opencode',
      model: 'deepseek-v4-flash',
      profile: 'opencode:deepseek-v4-flash:chat-completions',
      transport: 'openai_compatible_chat',
      credentialEnv: 'OPENCODE_API_KEY',
      thinking: { type: 'disabled' },
    });
    expect(
      resolveAgentModelProfile({ candidateId: 'qwen3.7-max' }),
    ).toEqual({
      candidateId: 'qwen3.7-max',
      provider: 'opencode',
      model: 'qwen3.7-max',
      profile: 'opencode:qwen3.7-max:anthropic-messages:thinking-disabled',
      transport: 'anthropic_messages',
      credentialEnv: 'OPENCODE_API_KEY',
      maxOutputTokens: 65_536,
      thinking: { type: 'disabled' },
    });
    expect(resolveAgentModelProfile({ candidateId: 'minimax-m3' })).toEqual({
      candidateId: 'minimax-m3',
      provider: 'opencode',
      model: 'minimax-m3',
      profile: 'opencode:minimax-m3:anthropic-messages',
      transport: 'anthropic_messages',
      credentialEnv: 'OPENCODE_API_KEY',
      maxOutputTokens: 32_768,
    });
  });

  it('fails closed on unknown candidates and model drift', () => {
    expect(() =>
      resolveAgentModelProfile({ candidateId: 'unknown-model' }),
    ).toThrow('Unknown KFC agent candidate: unknown-model');
    expect(() =>
      resolveAgentModelProfile({
        candidateId: 'deepseek-v4-flash',
        assertedModel: 'deepseek-v4-pro',
      }),
    ).toThrow(
      'KFC agent candidate deepseek-v4-flash must use deepseek-v4-flash',
    );
  });
});

describe('createAgentChatModel', () => {
  it('describes exact adapter construction without exposing credentials', () => {
    expect(
      describeAgentChatModelFactory(
        resolveAgentModelProfile({ candidateId: 'openai-gpt-4.1-mini' }),
      ),
    ).toEqual({
      adapter: 'ChatOpenAI',
      model: 'gpt-4.1-mini',
      transport: 'openai_responses',
      credentialEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://api.openai.com/v1',
      configurableBaseUrl: true,
      useResponsesApi: true,
    });
    expect(
      describeAgentChatModelFactory(
        resolveAgentModelProfile({ candidateId: 'deepseek-v4-flash' }),
      ),
    ).toEqual({
      adapter: 'ChatOpenAI',
      model: 'deepseek-v4-flash',
      transport: 'openai_compatible_chat',
      credentialEnv: 'OPENCODE_API_KEY',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      configurableBaseUrl: false,
      useResponsesApi: false,
      thinking: { type: 'disabled' },
    });
    expect(
      describeAgentChatModelFactory(
        resolveAgentModelProfile({ candidateId: 'qwen3.7-max' }),
      ),
    ).toEqual({
      adapter: 'ChatAnthropic',
      model: 'qwen3.7-max',
      transport: 'anthropic_messages',
      credentialEnv: 'OPENCODE_API_KEY',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      configurableBaseUrl: false,
      maxOutputTokens: 65_536,
      thinking: { type: 'disabled' },
    });
    expect(
      describeAgentChatModelFactory(
        resolveAgentModelProfile({ candidateId: 'minimax-m3' }),
      ),
    ).toEqual({
      adapter: 'ChatAnthropic',
      model: 'minimax-m3',
      transport: 'anthropic_messages',
      credentialEnv: 'OPENCODE_API_KEY',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      configurableBaseUrl: false,
      maxOutputTokens: 32_768,
    });
  });

  it('constructs the maintained adapters with the pinned transport settings', () => {
    const openai = createAgentChatModel({
      profile: resolveAgentModelProfile({
        candidateId: 'openai-gpt-4.1-mini',
      }),
      openAiApiKey: 'test-openai',
    });
    const deepseek = createAgentChatModel({
      profile: resolveAgentModelProfile({
        candidateId: 'deepseek-v4-flash',
      }),
      openCodeApiKey: 'test-opencode',
    });
    const qwen = createAgentChatModel({
      profile: resolveAgentModelProfile({ candidateId: 'qwen3.7-max' }),
      openCodeApiKey: 'test-opencode',
    });
    const minimax = createAgentChatModel({
      profile: resolveAgentModelProfile({ candidateId: 'minimax-m3' }),
      openCodeApiKey: 'test-opencode',
    });
    const google = createAgentChatModel({
      profile: resolveAgentModelProfile({
        candidateId: 'google-gemini-3.1-flash-lite',
      }),
      googleApiKey: 'test-google',
    });

    expect(openai._llmType()).toBe('openai');
    expect(Reflect.get(openai, 'useResponsesApi')).toBe(true);
    expect(deepseek._llmType()).toBe('openai');
    expect(Reflect.get(deepseek, 'useResponsesApi')).toBe(false);
    expect(Reflect.get(deepseek, 'modelKwargs')).toEqual({
      thinking: { type: 'disabled' },
    });
    expect(Reflect.get(deepseek, 'clientConfig')).toMatchObject({
      baseURL: 'https://opencode.ai/zen/go/v1',
    });
    expect(qwen._llmType()).toBe('anthropic');
    expect(Reflect.get(qwen, 'maxTokens')).toBe(65_536);
    expect(Reflect.get(qwen, 'thinking')).toEqual({ type: 'disabled' });
    expect(Reflect.get(minimax, 'maxTokens')).toBe(32_768);
    expect(google._llmType()).toBe('google');
  });

  it('requires the credential owned by the selected candidate without fallback', () => {
    expect(() =>
      createAgentChatModel({
        profile: resolveAgentModelProfile({
          candidateId: 'openai-gpt-4.1-mini',
        }),
        openCodeApiKey: 'wrong-provider',
      }),
    ).toThrow(
      'OPENAI_API_KEY is required for candidate openai-gpt-4.1-mini',
    );
    expect(() =>
      createAgentChatModel({
        profile: resolveAgentModelProfile({
          candidateId: 'deepseek-v4-flash',
        }),
        openAiApiKey: 'wrong-provider',
      }),
    ).toThrow(
      'OPENCODE_API_KEY is required for candidate deepseek-v4-flash',
    );
    expect(() =>
      createAgentChatModel({
        profile: resolveAgentModelProfile({
          candidateId: 'google-gemini-3.1-flash-lite',
        }),
        openAiApiKey: 'wrong-provider',
      }),
    ).toThrow(
      'GOOGLE_API_KEY is required for candidate google-gemini-3.1-flash-lite',
    );
  });

  it('rejects a forged profile instead of constructing an unknown model', () => {
    const forgedProfile = {
      ...resolveAgentModelProfile({ candidateId: 'deepseek-v4-flash' }),
      model: 'deepseek-v4-pro',
    } as AgentModelProfile;

    expect(() =>
      createAgentChatModel({
        profile: forgedProfile,
        openCodeApiKey: 'test-opencode',
      }),
    ).toThrow(
      'KFC agent candidate deepseek-v4-flash must use deepseek-v4-flash',
    );
  });
});
