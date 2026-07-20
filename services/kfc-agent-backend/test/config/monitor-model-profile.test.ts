import { describe, expect, it } from 'vitest';
import {
  createMonitorChatModel,
  monitorModelProfiles,
  resolveMonitorModelProfile,
} from '../../src/config/monitorModelProfile.js';

describe('KFC monitor model profile', () => {
  it('defaults to the agent provider without changing the approved production models', () => {
    expect(resolveMonitorModelProfile({
      agentProvider: 'openai',
    })).toBe(monitorModelProfiles.openai);
    expect(resolveMonitorModelProfile({
      agentProvider: 'google',
    })).toBe(monitorModelProfiles.google);
    expect(monitorModelProfiles.openai.model).toBe('gpt-4.1-mini');
    expect(monitorModelProfiles.google).toMatchObject({
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: 'LOW',
    });
  });

  it('allows only the pinned model for an explicitly selected provider', () => {
    expect(resolveMonitorModelProfile({
      agentProvider: 'google',
      provider: 'openai',
      model: 'gpt-4.1-mini',
    })).toBe(monitorModelProfiles.openai);
    expect(() => resolveMonitorModelProfile({
      agentProvider: 'google',
      provider: 'openai',
      model: 'gpt-4.1',
    })).toThrow('KFC monitor model drift');
    expect(() => resolveMonitorModelProfile({
      agentProvider: 'openai',
      provider: 'openai',
      model: 'gpt-4.1-nano',
    })).toThrow('KFC monitor model drift');
  });

  it('uses official adapters without credential fallback or SDK retries', () => {
    const openai = createMonitorChatModel({
      profile: monitorModelProfiles.openai,
      openAiApiKey: 'test-openai',
    });
    const google = createMonitorChatModel({
      profile: monitorModelProfiles.google,
      googleApiKey: 'test-google',
    });

    expect(openai._llmType()).toBe('openai');
    expect(google._llmType()).toBe('google');
    expect(Reflect.get(openai.caller, 'maxRetries')).toBe(0);
    expect(Reflect.get(google.caller, 'maxRetries')).toBe(0);
    expect(Reflect.get(google, 'temperature')).toBeUndefined();
    expect(() => createMonitorChatModel({
      profile: monitorModelProfiles.openai,
    })).toThrow('OPENAI_API_KEY is required');
    expect(() => createMonitorChatModel({
      profile: monitorModelProfiles.google,
    })).toThrow('GOOGLE_API_KEY is required');
  });
});
