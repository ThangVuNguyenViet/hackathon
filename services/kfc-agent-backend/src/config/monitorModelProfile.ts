import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createConfiguredAgentChatModel,
  resolveAgentModelProfile,
  type AgentModelProfile,
} from './agentModelProfile.js';

export type MonitorModelProfile = AgentModelProfile;
export type MonitorModelIdentity = Readonly<
  Pick<
    MonitorModelProfile,
    'candidateId' | 'provider' | 'model' | 'profile' | 'transport'
  >
>;

export function resolveMonitorModelProfile(input: {
  agentCandidateId: string;
  candidateId?: string;
}): MonitorModelProfile {
  const profile = resolveAgentModelProfile({
    candidateId: input.candidateId ?? input.agentCandidateId,
  });
  return Object.freeze({
    ...profile,
    profile: `monitor:${profile.profile}`,
  });
}

export function createMonitorChatModel(input: {
  profile: MonitorModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openCodeApiKey?: string;
  googleApiKey?: string;
}): BaseChatModel {
  return createConfiguredAgentChatModel({
    ...input,
    profile: resolveAgentModelProfile({
      candidateId: input.profile.candidateId,
      assertedModel: input.profile.model,
    }),
  }).model;
}
