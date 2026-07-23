import { describe, expect, it } from 'vitest';
import {
  createOutcomeJudgeChatModel,
  outcomeJudgeModelProfiles,
  resolveOutcomeJudgeModelProfile,
} from '../../src/config/outcomeJudgeModelProfile.js';
import { outcomeJudgmentSchema } from '../../src/evaluation/outcomeJudge.js';

describe('KFC outcome judge model profile', () => {
  it('pins one affordable provider-neutral judgment model per provider', () => {
    expect(resolveOutcomeJudgeModelProfile({})).toBe(
      outcomeJudgeModelProfiles.openai,
    );
    expect(resolveOutcomeJudgeModelProfile({
      provider: 'google',
    })).toMatchObject({
      provider: 'google',
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: 'LOW',
    });
  });

  it('fails closed on provider and model drift', () => {
    expect(() => resolveOutcomeJudgeModelProfile({
      provider: 'anthropic',
    })).toThrow('OUTCOME_JUDGE_PROVIDER must be openai or google');
    expect(() => resolveOutcomeJudgeModelProfile({
      provider: 'openai',
      model: 'gpt-4.1',
    })).toThrow('KFC outcome judge model drift');
    expect(() => resolveOutcomeJudgeModelProfile({
      provider: 'google',
      model: 'gemini-3.5-flash',
    })).toThrow('KFC outcome judge model drift');
  });

  it('uses the existing official provider model factory without credential fallback', () => {
    const openai = createOutcomeJudgeChatModel({
      profile: outcomeJudgeModelProfiles.openai,
      openAiApiKey: 'test-openai-key',
    });
    const google = createOutcomeJudgeChatModel({
      profile: outcomeJudgeModelProfiles.google,
      googleApiKey: 'test-google-key',
    });

    expect(openai._llmType()).toBe('openai');
    expect(google._llmType()).toBe('google');
    expect(Reflect.get(openai.caller, 'maxRetries')).toBe(0);
    expect(Reflect.get(google.caller, 'maxRetries')).toBe(0);
    expect(() => openai.withStructuredOutput(outcomeJudgmentSchema, {
      name: 'judgeKfcCustomerOutcome',
    })).not.toThrow();
    expect(() => google.withStructuredOutput(outcomeJudgmentSchema, {
      name: 'judgeKfcCustomerOutcome',
    })).not.toThrow();
    expect(() => createOutcomeJudgeChatModel({
      profile: outcomeJudgeModelProfiles.openai,
    })).toThrow('OPENAI_API_KEY is required');
    expect(() => createOutcomeJudgeChatModel({
      profile: outcomeJudgeModelProfiles.google,
    })).toThrow('GOOGLE_API_KEY is required');
  });
});
