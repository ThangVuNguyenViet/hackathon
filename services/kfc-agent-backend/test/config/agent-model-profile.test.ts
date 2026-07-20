import { describe, expect, it } from 'vitest';
import {
  agentModelProfiles,
  createAgentChatModel,
  qualificationAgentModelProfiles,
  resolveAgentModelProfile,
  resolveResponseVerifierModelProfile,
} from '../../src/config/agentModelProfile.js';
import { commerceToolDefinitions } from '../../src/agent/singleAgentRuntime.js';

describe('KFC agent model profile', () => {
  it('pins one affordable production model per provider and fails on drift', () => {
    expect(agentModelProfiles.openai.model).toBe('gpt-4.1-mini');
    expect(agentModelProfiles.google).toMatchObject({
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: 'LOW',
    });
    expect(() => resolveAgentModelProfile({
      provider: 'openai',
      model: 'gpt-4.1',
    })).toThrow('KFC production agent model drift');
    expect(() => resolveAgentModelProfile({
      provider: 'google',
      model: 'gemini-3.5-flash',
    })).toThrow('KFC production agent model drift');
  });

  it('keeps qualification on affordable pinned models with deeper Google thinking', () => {
    expect(resolveAgentModelProfile({
      provider: 'google',
      mode: 'qualification',
    })).toBe(qualificationAgentModelProfiles.google);
    expect(qualificationAgentModelProfiles.google).toMatchObject({
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: 'HIGH',
    });
    expect(() => resolveAgentModelProfile({
      provider: 'google',
      model: 'gemini-3.5-flash',
      mode: 'qualification',
    })).toThrow('KFC qualification agent model drift');
    expect(resolveAgentModelProfile({
      provider: 'openai',
      mode: 'qualification',
    })).toBe(qualificationAgentModelProfiles.openai);
    expect(() => resolveAgentModelProfile({
      provider: 'google',
      model: 'gemini-3.1-pro-preview',
      mode: 'qualification',
    })).toThrow('KFC qualification agent model drift');
  });

  it('requires opposite-provider verification in every profile mode', () => {
    expect(resolveResponseVerifierModelProfile({
      agentProvider: 'google',
      provider: 'openai',
      model: 'gpt-4.1-mini',
    })).toBe(agentModelProfiles.openai);
    expect(resolveResponseVerifierModelProfile({
      agentProvider: 'openai',
      provider: 'google',
      model: 'gemini-3.1-flash-lite',
    })).toBe(agentModelProfiles.google);
    expect(() => resolveResponseVerifierModelProfile({
      agentProvider: 'google',
      provider: 'google',
    })).toThrow('response verifier provider must differ');
    expect(resolveResponseVerifierModelProfile({
      agentProvider: 'google',
    })).toBeUndefined();
    expect(() => resolveResponseVerifierModelProfile({
      agentProvider: 'google',
      provider: 'google',
      mode: 'qualification',
    })).toThrow('response verifier provider must differ');
    expect(resolveResponseVerifierModelProfile({
      agentProvider: 'google',
      mode: 'qualification',
    })).toBeUndefined();
    expect(resolveResponseVerifierModelProfile({
      agentProvider: 'openai',
      provider: 'google',
      mode: 'qualification',
    })).toBe(qualificationAgentModelProfiles.google);
    expect(() => resolveResponseVerifierModelProfile({
      agentProvider: 'openai',
      provider: 'google',
      model: 'gemini-3.5-flash',
      mode: 'qualification',
    })).toThrow('KFC qualification response verifier model drift');
    expect(() => resolveResponseVerifierModelProfile({
      agentProvider: 'google',
      provider: 'openai',
      model: 'gpt-4.1',
    })).toThrow('KFC production response verifier model drift');
    expect(() => resolveResponseVerifierModelProfile({
      agentProvider: 'google',
      model: 'gpt-4.1-mini',
    })).toThrow('KFC_RESPONSE_VERIFIER_PROVIDER is required');
  });

  it('uses official provider adapters without silent credential fallback', () => {
    const toolDefinitions = commerceToolDefinitions();
    const openai = createAgentChatModel({
      profile: agentModelProfiles.openai,
      openAiApiKey: 'test-openai',
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
    expect(google._llmType()).toBe('google');
    expect(toolDefinitions).not.toHaveLength(0);
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
    expect(() => createAgentChatModel({
      profile: agentModelProfiles.openai,
    })).toThrow('OPENAI_API_KEY is required');
    expect(() => createAgentChatModel({
      profile: agentModelProfiles.google,
    })).toThrow('GOOGLE_API_KEY is required');
  });
});
