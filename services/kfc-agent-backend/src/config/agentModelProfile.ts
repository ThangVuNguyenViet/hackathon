import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogle } from '@langchain/google';
import { ChatOpenAI } from '@langchain/openai';

export type AgentProvider = 'openai' | 'google';

export type AgentModelProfile =
  | {
      provider: 'openai';
      model: string;
      profile: string;
    }
  | {
      provider: 'google';
      model: string;
      profile: string;
      thinkingLevel: 'LOW';
    };

export type AgentModelIdentity = Readonly<
  Pick<AgentModelProfile, 'provider' | 'model' | 'profile'>
>;

const defaultModels: Record<AgentProvider, string> = {
  openai: 'gpt-4.1-mini',
  google: 'gemini-3.1-flash-lite',
};

export function resolveAgentModelProfile(input: {
  provider: AgentProvider;
  model?: string;
}): AgentModelProfile {
  const model = input.model?.trim() || defaultModels[input.provider];
  if (input.provider === 'openai') {
    return { provider: 'openai', model, profile: `openai:${model}` };
  }
  return {
    provider: 'google',
    model,
    profile: `google:${model}`,
    thinkingLevel: 'LOW',
  };
}

export function createAgentChatModel(input: {
  profile: AgentModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  googleApiKey?: string;
}): BaseChatModel {
  if (input.profile.provider === 'openai') {
    if (!input.openAiApiKey?.trim()) {
      throw new Error('OPENAI_API_KEY is required for the OpenAI KFC agent');
    }
    return new ChatOpenAI({
      apiKey: input.openAiApiKey,
      model: input.profile.model,
      temperature: 0,
      useResponsesApi: true,
      supportsStrictToolCalling: false,
      maxRetries: 1,
      configuration: input.openAiBaseUrl?.trim()
        ? { baseURL: input.openAiBaseUrl.trim() }
        : undefined,
    });
  }

  if (!input.googleApiKey?.trim()) {
    throw new Error('GOOGLE_API_KEY is required for the Google KFC agent');
  }
  return new ChatGoogle({
    apiKey: input.googleApiKey,
    model: input.profile.model,
    maxRetries: 1,
    thinkingLevel: input.profile.thinkingLevel,
  });
}
