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

export const qualificationAgentModelProfiles = {
  openai: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    profile: 'openai-gpt-4.1-mini-qualification',
  },
  google: {
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google-gemini-3.1-flash-lite-thinking-high-qualification',
    thinkingLevel: 'HIGH',
  },
} as const;

export type AgentProvider = keyof typeof agentModelProfiles;
export type AgentProfileMode = 'production' | 'qualification';
export type AgentModelProfile =
  | (typeof agentModelProfiles)[AgentProvider]
  | (typeof qualificationAgentModelProfiles)[AgentProvider];
export type AgentModelIdentity = Readonly<
  Pick<AgentModelProfile, 'provider' | 'model' | 'profile'>
>;

function modelProfilesForMode(mode: AgentProfileMode) {
  return mode === 'qualification'
    ? qualificationAgentModelProfiles
    : agentModelProfiles;
}

function modelProfileForInput(input: {
  provider: AgentProvider;
  mode: AgentProfileMode;
}): AgentModelProfile {
  return modelProfilesForMode(input.mode)[input.provider];
}

export function resolveAgentModelProfile(input: {
  provider: AgentProvider;
  model?: string;
  mode?: AgentProfileMode;
}): AgentModelProfile {
  const mode = input.mode ?? 'production';
  const profile = modelProfileForInput({
    provider: input.provider,
    mode,
  });
  if (input.model?.trim() && input.model.trim() !== profile.model) {
    throw new Error(
      `KFC ${mode} agent model drift: ${input.provider} must use ${profile.model}, received ${input.model.trim()}`,
    );
  }
  return profile;
}

export function resolveResponseVerifierModelProfile(input: {
  agentProvider: AgentProvider;
  provider?: AgentProvider;
  model?: string;
  mode?: AgentProfileMode;
}): AgentModelProfile | undefined {
  const mode = input.mode ?? 'production';
  const configuredModel = input.model?.trim();
  if (!input.provider) {
    if (configuredModel) {
      throw new Error(
        'KFC_RESPONSE_VERIFIER_PROVIDER is required when KFC_RESPONSE_VERIFIER_MODEL is set',
      );
    }
    return undefined;
  }
  if (input.provider === input.agentProvider) {
    throw new Error(
      'KFC response verifier provider must differ from KFC agent provider',
    );
  }
  const profile = modelProfileForInput({
    provider: input.provider,
    mode,
  });
  if (configuredModel && configuredModel !== profile.model) {
    throw new Error(
      `KFC ${mode} response verifier model drift: ${input.provider} must use ${profile.model}, received ${configuredModel}`,
    );
  }
  return profile;
}

export function createAgentChatModel(input: {
  profile: AgentModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  googleApiKey?: string;
  role?: 'agent' | 'response_verifier';
}): BaseChatModel {
  const role = input.role === 'response_verifier'
    ? 'KFC response verifier profile'
    : 'KFC agent profile';
  if (input.profile.provider === 'openai') {
    if (!input.openAiApiKey?.trim()) {
      throw new Error(`OPENAI_API_KEY is required for the OpenAI ${role}`);
    }
    return new ChatOpenAI({
      apiKey: input.openAiApiKey,
      model: input.profile.model,
      temperature: 0,
      useResponsesApi: true,
      supportsStrictToolCalling: true,
      // The StateGraph owns and counts every retry. SDK retries would
      // otherwise become uncounted inference attempts.
      maxRetries: 0,
      configuration: input.openAiBaseUrl?.trim()
        ? { baseURL: input.openAiBaseUrl.trim() }
        : undefined,
    });
  }

  if (!input.googleApiKey?.trim()) {
    throw new Error(`GOOGLE_API_KEY is required for the Google ${role}`);
  }
  return new ChatGoogle({
    apiKey: input.googleApiKey,
    model: input.profile.model,
    maxRetries: 0,
    thinkingLevel: input.profile.thinkingLevel,
  });
}
