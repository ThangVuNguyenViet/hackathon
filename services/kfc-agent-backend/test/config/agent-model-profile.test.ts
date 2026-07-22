import { describe, expect, it } from 'vitest';
import {
  agentModelProfiles,
  createAgentChatModel,
  qualificationAgentModelProfiles,
  resolveAgentModelProfile,
  resolveRuntimeAgentIdentity,
} from '../../src/config/agentModelProfile.js';
import { groundedResponseToolDefinition } from '../../src/agent/responseGrounding.js';
import { commerceToolDefinitions } from '../../src/agent/singleAgentRuntime.js';

describe('KFC agent model profile', () => {
  it('allows the direct Responses runtime to use its configured OpenAI model', () => {
    expect(
      resolveRuntimeAgentIdentity({
        runtime: 'openai-responses',
        provider: 'openai',
        model: 'gpt-4.1-mini',
      }),
    ).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      profile: 'openai-responses-gpt-4.1-mini',
    });
  });

  it('pins one affordable production model per provider and fails on drift', () => {
    expect(agentModelProfiles.openai).toMatchObject({
      provider: 'openai',
      model: 'gpt-5-mini-2025-08-07',
      profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
    });
    expect(agentModelProfiles.google).toMatchObject({
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: 'LOW',
    });
    expect(() =>
      resolveAgentModelProfile({
        provider: 'openai',
        model: 'gpt-4.1',
      }),
    ).toThrow('KFC production agent model drift');
    expect(() =>
      resolveAgentModelProfile({
        provider: 'google',
        model: 'gemini-3.5-flash',
      }),
    ).toThrow('KFC production agent model drift');
  });

  it('keeps qualification on affordable pinned models with deeper Google thinking', () => {
    expect(
      resolveAgentModelProfile({
        provider: 'google',
        mode: 'qualification',
      }),
    ).toBe(qualificationAgentModelProfiles.google);
    expect(qualificationAgentModelProfiles.google).toMatchObject({
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: 'HIGH',
    });
    expect(() =>
      resolveAgentModelProfile({
        provider: 'google',
        model: 'gemini-3.5-flash',
        mode: 'qualification',
      }),
    ).toThrow('KFC qualification agent model drift');
    expect(
      resolveAgentModelProfile({
        provider: 'openai',
        mode: 'qualification',
      }),
    ).toBe(qualificationAgentModelProfiles.openai);
    expect(qualificationAgentModelProfiles.openai).toMatchObject({
      provider: 'openai',
      model: 'gpt-5-mini-2025-08-07',
      profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
    });
    expect(() =>
      resolveAgentModelProfile({
        provider: 'google',
        model: 'gemini-3.1-pro-preview',
        mode: 'qualification',
      }),
    ).toThrow('KFC qualification agent model drift');
  });

  it('uses official provider adapters without silent credential fallback', () => {
    const toolDefinitions = [
      ...commerceToolDefinitions(),
      groundedResponseToolDefinition,
    ];
    const openai = createAgentChatModel({
      profile: agentModelProfiles.openai,
      openAiApiKey: 'test-openai',
    });
    const qualificationOpenai = createAgentChatModel({
      profile: qualificationAgentModelProfiles.openai,
      openAiApiKey: 'test-openai',
      openAiBaseUrl: 'https://example.test/v1',
    });
    const google = createAgentChatModel({
      profile: agentModelProfiles.google,
      googleApiKey: 'test-google',
    });
    const qualificationGoogle = createAgentChatModel({
      profile: qualificationAgentModelProfiles.google,
      googleApiKey: 'test-google',
    });
    expect(openai._llmType()).toBe('openai');
    expect(Reflect.get(openai, 'model')).toBe('gpt-5-mini-2025-08-07');
    expect(Reflect.get(openai, 'useResponsesApi')).toBe(true);
    expect(Reflect.get(openai, 'reasoning')).toEqual({ effort: 'low' });
    expect(Reflect.get(openai, 'verbosity')).toBe('low');
    expect(Reflect.get(openai, 'service_tier')).toBe('priority');
    expect(Reflect.get(openai, 'supportsStrictToolCalling')).toBe(true);
    expect(Reflect.get(openai, 'temperature')).toBeUndefined();
    expect(Reflect.get(qualificationOpenai, 'model')).toBe(
      'gpt-5-mini-2025-08-07',
    );
    expect(Reflect.get(qualificationOpenai, 'reasoning')).toEqual({
      effort: 'low',
    });
    expect(Reflect.get(qualificationOpenai, 'verbosity')).toBe('low');
    expect(Reflect.get(qualificationOpenai, 'clientConfig')).toMatchObject({
      baseURL: 'https://example.test/v1',
    });
    expect(google._llmType()).toBe('google');
    expect(toolDefinitions).not.toHaveLength(0);
    expect(toolDefinitions).toContain(groundedResponseToolDefinition);
    for (const definition of toolDefinitions) {
      expect(Object.keys(definition).sort()).toEqual([
        'description',
        'name',
        'schema',
      ]);
    }
    expect(() => openai.bindTools?.(toolDefinitions)).not.toThrow();
    expect(() => google.bindTools?.(toolDefinitions)).not.toThrow();
    expect(Reflect.get(openai.caller, 'maxRetries')).toBe(0);
    expect(Reflect.get(google.caller, 'maxRetries')).toBe(0);
    expect(Reflect.get(google, 'temperature')).toBeUndefined();
    expect(
      Reflect.get(
        Reflect.get(qualificationGoogle, 'lc_kwargs') as object,
        'thinkingLevel',
      ),
    ).toBe('HIGH');
    expect(() =>
      createAgentChatModel({
        profile: agentModelProfiles.openai,
      }),
    ).toThrow('OPENAI_API_KEY is required');
    expect(() =>
      createAgentChatModel({
        profile: agentModelProfiles.google,
      }),
    ).toThrow('GOOGLE_API_KEY is required');
  });
});
