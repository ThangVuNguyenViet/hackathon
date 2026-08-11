import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogle } from '@langchain/google';
import { ChatOpenAI } from '@langchain/openai';

const openAiAgentProfile = {
  provider: 'openai',
  model: 'gpt-5-mini-2025-08-07',
  profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
} as const;

export const agentModelProfiles = {
  openai: openAiAgentProfile,
  google: {
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google-gemini-3.1-flash-lite-thinking-low',
    thinkingLevel: 'LOW',
  },
} as const;

export const qualificationAgentModelProfiles = {
  openai: openAiAgentProfile,
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
export type AgentModelIdentity = Readonly<{
  provider: AgentProvider;
  model: string;
  profile: string;
}>;

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

export function resolveRuntimeAgentIdentity(input: {
  provider: AgentProvider;
  model?: string;
  mode?: AgentProfileMode;
}): AgentModelIdentity {
  return resolveAgentModelProfile(input);
}

export function createAgentChatModel(input: {
  profile: AgentModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  googleApiKey?: string;
}): BaseChatModel {
  if (input.profile.provider === 'openai') {
    if (!input.openAiApiKey?.trim()) {
      throw new Error(
        'OPENAI_API_KEY is required for the OpenAI KFC agent profile',
      );
    }
    return new ChatOpenAI({
      apiKey: input.openAiApiKey,
      model: input.profile.model,
      useResponsesApi: true,
      reasoning: { effort: 'low' },
      verbosity: 'low',
      service_tier: 'priority',
      supportsStrictToolCalling: true,
      // Agent middleware owns and counts every retry. SDK retries would
      // otherwise become uncounted inference attempts.
      maxRetries: 0,
      configuration: input.openAiBaseUrl?.trim()
        ? { baseURL: input.openAiBaseUrl.trim() }
        : undefined,
    });
  }

  if (!input.googleApiKey?.trim()) {
    throw new Error(
      'GOOGLE_API_KEY is required for the Google KFC agent profile',
    );
  }
  return new ChatGoogle({
    apiKey: input.googleApiKey,
    model: input.profile.model,
    maxRetries: 0,
    thinkingLevel: input.profile.thinkingLevel,
  });
}
