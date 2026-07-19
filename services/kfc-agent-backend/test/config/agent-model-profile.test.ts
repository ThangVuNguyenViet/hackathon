import { describe, expect, it } from 'vitest';
import {
  agentModelProfiles,
  createAgentChatModel,
  resolveAgentModelProfile,
} from '../../src/config/agentModelProfile.js';

describe('KFC agent model profile', () => {
  it('pins one affordable model per provider and fails on drift', () => {
    expect(agentModelProfiles.openai.model).toBe('gpt-4.1-mini');
    expect(agentModelProfiles.google).toMatchObject({
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: 'LOW',
    });
    expect(() => resolveAgentModelProfile({
      provider: 'openai',
      model: 'gpt-4.1',
    })).toThrow('KFC agent model drift');
    expect(() => resolveAgentModelProfile({
      provider: 'google',
      model: 'gemini-3.5-flash',
    })).toThrow('KFC agent model drift');
  });

  it('uses official provider adapters without silent credential fallback', () => {
    expect(createAgentChatModel({
      profile: agentModelProfiles.openai,
      openAiApiKey: 'test-openai',
    })._llmType()).toBe('openai');
    expect(createAgentChatModel({
      profile: agentModelProfiles.google,
      googleApiKey: 'test-google',
    })._llmType()).toBe('google');
    expect(() => createAgentChatModel({
      profile: agentModelProfiles.openai,
    })).toThrow('OPENAI_API_KEY is required');
    expect(() => createAgentChatModel({
      profile: agentModelProfiles.google,
    })).toThrow('GOOGLE_API_KEY is required');
  });
});
