import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createAgentChatModel,
  resolveAgentModelProfile,
  type AgentProvider,
} from './agentModelProfile.js';

export type MonitorProvider = AgentProvider;
export interface MonitorModelProfile {
  provider: MonitorProvider;
  model: string;
  profile: string;
}
export type MonitorModelIdentity = Readonly<MonitorModelProfile>;

export function resolveMonitorModelProfile(input: {
  agentProvider: AgentProvider;
  provider?: MonitorProvider;
  model?: string;
}): MonitorModelProfile {
  const provider = input.provider ?? input.agentProvider;
  const agentProfile = resolveAgentModelProfile({
    provider,
    model: input.model,
  });
  return {
    provider,
    model: agentProfile.model,
    profile: `monitor:${provider}:${agentProfile.model}`,
  };
}

export function createMonitorChatModel(input: {
  profile: MonitorModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  googleApiKey?: string;
}): BaseChatModel {
  return createAgentChatModel({
    profile: resolveAgentModelProfile(input.profile),
    openAiApiKey: input.openAiApiKey,
    openAiBaseUrl: input.openAiBaseUrl,
    googleApiKey: input.googleApiKey,
  });
}
