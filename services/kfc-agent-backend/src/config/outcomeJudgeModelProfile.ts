import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  agentModelProfiles,
  createAgentChatModel,
  type AgentProvider,
} from './agentModelProfile.js';

export const outcomeJudgeModelProfiles = {
  openai: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    profile: 'openai-gpt-4.1-mini-outcome-judge',
  },
  google: {
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google-gemini-3.1-flash-lite-thinking-low-outcome-judge',
    thinkingLevel: 'LOW',
  },
} as const;

export type OutcomeJudgeProvider = AgentProvider;
export type OutcomeJudgeModelProfile =
  (typeof outcomeJudgeModelProfiles)[OutcomeJudgeProvider];
export type OutcomeJudgeModelIdentity = Readonly<
  Pick<OutcomeJudgeModelProfile, 'provider' | 'model' | 'profile'>
>;

export function resolveOutcomeJudgeModelProfile(input: {
  provider?: string;
  model?: string;
}): OutcomeJudgeModelProfile {
  const provider = input.provider?.trim() || 'openai';
  if (provider !== 'openai' && provider !== 'google') {
    throw new Error('OUTCOME_JUDGE_PROVIDER must be openai or google');
  }
  const profile = outcomeJudgeModelProfiles[provider];
  const configuredModel = input.model?.trim();
  if (configuredModel && configuredModel !== profile.model) {
    throw new Error(
      `KFC outcome judge model drift: ${provider} must use ${profile.model}, received ${configuredModel}`,
    );
  }
  return profile;
}

export function createOutcomeJudgeChatModel(input: {
  profile: OutcomeJudgeModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  googleApiKey?: string;
}): BaseChatModel {
  const providerProfile = agentModelProfiles[input.profile.provider];
  if (providerProfile.model !== input.profile.model) {
    throw new Error('KFC outcome judge runtime profile binding is invalid');
  }
  return createAgentChatModel({
    profile: providerProfile,
    openAiApiKey: input.openAiApiKey,
    openAiBaseUrl: input.openAiBaseUrl,
    googleApiKey: input.googleApiKey,
  });
}
