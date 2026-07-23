import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  agentModelProfiles,
  createAgentChatModel,
  type AgentProvider,
} from './agentModelProfile.js';

export const monitorModelProfiles = {
  openai: agentModelProfiles.openai,
  google: {
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google-gemini-3.1-flash-lite-thinking-low-monitor',
    thinkingLevel: 'LOW',
  },
} as const;

export type MonitorProvider = AgentProvider;
export type MonitorModelProfile =
  (typeof monitorModelProfiles)[MonitorProvider];
export type MonitorModelIdentity = Readonly<
  Pick<MonitorModelProfile, 'provider' | 'model' | 'profile'>
>;

export function resolveMonitorModelProfile(input: {
  agentProvider: AgentProvider;
  provider?: MonitorProvider;
  model?: string;
}): MonitorModelProfile {
  const provider = input.provider ?? input.agentProvider;
  const profile = monitorModelProfiles[provider];
  const configuredModel = input.model?.trim();
  if (configuredModel && configuredModel !== profile.model) {
    throw new Error(
      `KFC monitor model drift: ${provider} must use ${profile.model}, received ${configuredModel}`,
    );
  }
  return profile;
}

export function createMonitorChatModel(input: {
  profile: MonitorModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  googleApiKey?: string;
}): BaseChatModel {
  const providerProfile = agentModelProfiles[input.profile.provider];
  if (providerProfile.model !== input.profile.model) {
    throw new Error('KFC monitor runtime profile binding is invalid');
  }
  return createAgentChatModel({
    profile: providerProfile,
    openAiApiKey: input.openAiApiKey,
    openAiBaseUrl: input.openAiBaseUrl,
    googleApiKey: input.googleApiKey,
  });
}
