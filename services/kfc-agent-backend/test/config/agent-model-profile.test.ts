import { describe, expect, it } from 'vitest';
import { resolveAgentModelProfile } from '../../src/config/agentModelProfile.js';

describe('resolveAgentModelProfile', () => {
  it('uses a stable OpenAI identity when no explicit model is supplied', () => {
    expect(resolveAgentModelProfile({ provider: 'openai' })).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      profile: 'openai:gpt-4.1-mini',
    });
  });

  it('normalizes an explicit Google model into its portable identity', () => {
    expect(
      resolveAgentModelProfile({
        provider: 'google',
        model: '  gemini-3.1-pro  ',
      }),
    ).toEqual({
      provider: 'google',
      model: 'gemini-3.1-pro',
      profile: 'google:gemini-3.1-pro',
      thinkingLevel: 'LOW',
    });
  });
});
