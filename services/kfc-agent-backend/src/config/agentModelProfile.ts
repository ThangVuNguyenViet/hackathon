import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogle } from '@langchain/google';
import { ChatOpenAI } from '@langchain/openai';

export const agentModelProfiles = {
  openai: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    profile: 'openai-gpt-4.1-mini',
  },
  google: {
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google-gemini-3.1-flash-lite-thinking-low',
    thinkingLevel: 'LOW',
  },
} as const;

export type AgentProvider = keyof typeof agentModelProfiles;
export type AgentModelProfile = (typeof agentModelProfiles)[AgentProvider];
export type AgentModelIdentity = Readonly<
  Pick<AgentModelProfile, 'provider' | 'model' | 'profile'>
>;

export function resolveAgentModelProfile(input: {
  provider: AgentProvider;
  model?: string;
}): AgentModelProfile {
  const profile = agentModelProfiles[input.provider];
  if (input.model?.trim() && input.model.trim() !== profile.model) {
    throw new Error(
      `KFC agent model drift: ${input.provider} must use ${profile.model}, received ${input.model.trim()}`,
    );
  }
  return profile;
}

export function createAgentChatModel(input: {
  profile: AgentModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  googleApiKey?: string;
}): BaseChatModel {
  if (input.profile.provider === 'openai') {
    if (!input.openAiApiKey?.trim()) {
      throw new Error('OPENAI_API_KEY is required for the OpenAI KFC agent profile');
    }
    return new ChatOpenAI({
      apiKey: input.openAiApiKey,
      model: input.profile.model,
      temperature: 0,
      useResponsesApi: true,
      supportsStrictToolCalling: true,
      // Agent-level retries are counted by modelCallLimitMiddleware. Keeping
      // provider retries disabled prevents an SDK retry from becoming an
      // uncounted seventh inference attempt.
      maxRetries: 0,
      configuration: input.openAiBaseUrl?.trim()
        ? { baseURL: input.openAiBaseUrl.trim() }
        : undefined,
    });
  }

  if (!input.googleApiKey?.trim()) {
    throw new Error('GOOGLE_API_KEY is required for the Google KFC agent profile');
  }
  return new ChatGoogle({
    apiKey: input.googleApiKey,
    model: input.profile.model,
    temperature: 0,
    maxRetries: 0,
    thinkingLevel: input.profile.thinkingLevel,
  });
}
