import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogle } from '@langchain/google';
import { ChatOpenAI } from '@langchain/openai';

export const agentModelCandidateIds = Object.freeze([
  'openai-gpt-4.1-mini',
  'deepseek-v4-flash',
  'qwen3.7-max',
  'minimax-m3',
  'google-gemini-3.1-flash-lite',
] as const);

export type AgentModelCandidateId = (typeof agentModelCandidateIds)[number];
export const liveAgentModelCandidateIds = Object.freeze([
  'openai-gpt-4.1-mini',
  'deepseek-v4-flash',
  'qwen3.7-max',
  'minimax-m3',
] as const satisfies readonly AgentModelCandidateId[]);
export type AgentProvider = 'openai' | 'opencode' | 'google';
export type AgentModelTransport =
  | 'openai_responses'
  | 'openai_compatible_chat'
  | 'anthropic_messages'
  | 'google_genai';
export type AgentCredentialEnv =
  'OPENAI_API_KEY' | 'OPENCODE_API_KEY' | 'GOOGLE_API_KEY';

interface AgentModelProfileBase {
  readonly candidateId: AgentModelCandidateId;
  readonly provider: AgentProvider;
  readonly model: string;
  readonly profile: string;
  readonly transport: AgentModelTransport;
  readonly credentialEnv: AgentCredentialEnv;
}

export type AgentModelProfile =
  | (AgentModelProfileBase & {
      readonly provider: 'openai';
      readonly transport: 'openai_responses';
      readonly credentialEnv: 'OPENAI_API_KEY';
    })
  | (AgentModelProfileBase & {
      readonly provider: 'opencode';
      readonly transport: 'openai_compatible_chat';
      readonly credentialEnv: 'OPENCODE_API_KEY';
      readonly thinking: Readonly<{ type: 'disabled' }>;
    })
  | (AgentModelProfileBase & {
      readonly provider: 'opencode';
      readonly transport: 'anthropic_messages';
      readonly credentialEnv: 'OPENCODE_API_KEY';
      readonly maxOutputTokens: number;
      readonly thinking?: Readonly<{ type: 'disabled' }>;
    })
  | (AgentModelProfileBase & {
      readonly provider: 'google';
      readonly transport: 'google_genai';
      readonly credentialEnv: 'GOOGLE_API_KEY';
      readonly thinkingLevel: 'LOW';
    });

export type AgentModelIdentity = Readonly<
  Pick<
    AgentModelProfile,
    'candidateId' | 'provider' | 'model' | 'profile' | 'transport'
  >
>;

const disabledThinking = Object.freeze({ type: 'disabled' } as const);
const openCodeBaseUrl = 'https://opencode.ai/zen/go/v1';
const openAiBaseUrl = 'https://api.openai.com/v1';

const agentModelProfiles: Readonly<
  Record<AgentModelCandidateId, AgentModelProfile>
> = Object.freeze({
  'openai-gpt-4.1-mini': Object.freeze({
    candidateId: 'openai-gpt-4.1-mini',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    profile: 'openai:gpt-4.1-mini:responses',
    transport: 'openai_responses',
    credentialEnv: 'OPENAI_API_KEY',
  }),
  'deepseek-v4-flash': Object.freeze({
    candidateId: 'deepseek-v4-flash',
    provider: 'opencode',
    model: 'deepseek-v4-flash',
    profile: 'opencode:deepseek-v4-flash:chat-completions',
    transport: 'openai_compatible_chat',
    credentialEnv: 'OPENCODE_API_KEY',
    thinking: disabledThinking,
  }),
  'qwen3.7-max': Object.freeze({
    candidateId: 'qwen3.7-max',
    provider: 'opencode',
    model: 'qwen3.7-max',
    profile: 'opencode:qwen3.7-max:anthropic-messages:thinking-disabled',
    transport: 'anthropic_messages',
    credentialEnv: 'OPENCODE_API_KEY',
    maxOutputTokens: 65_536,
    thinking: disabledThinking,
  }),
  'minimax-m3': Object.freeze({
    candidateId: 'minimax-m3',
    provider: 'opencode',
    model: 'minimax-m3',
    profile: 'opencode:minimax-m3:anthropic-messages',
    transport: 'anthropic_messages',
    credentialEnv: 'OPENCODE_API_KEY',
    maxOutputTokens: 131_072,
  }),
  'google-gemini-3.1-flash-lite': Object.freeze({
    candidateId: 'google-gemini-3.1-flash-lite',
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google:gemini-3.1-flash-lite:thinking-low',
    transport: 'google_genai',
    credentialEnv: 'GOOGLE_API_KEY',
    thinkingLevel: 'LOW',
  }),
});

function isAgentModelCandidateId(
  candidateId: string,
): candidateId is AgentModelCandidateId {
  return (agentModelCandidateIds as readonly string[]).includes(candidateId);
}

export function resolveAgentModelProfile(input: {
  candidateId: string;
  assertedModel?: string;
}): AgentModelProfile {
  const candidateId = input.candidateId.trim();
  if (!isAgentModelCandidateId(candidateId)) {
    throw new Error(`Unknown KFC agent candidate: ${candidateId}`);
  }
  const profile = agentModelProfiles[candidateId];
  const assertedModel = input.assertedModel?.trim();
  if (assertedModel && assertedModel !== profile.model) {
    throw new Error(
      `KFC agent candidate ${candidateId} must use ${profile.model}, received ${assertedModel}`,
    );
  }
  return profile;
}

export type AgentChatModelFactoryDescriptor =
  | Readonly<{
      adapter: 'ChatOpenAI';
      model: string;
      transport: 'openai_responses' | 'openai_compatible_chat';
      credentialEnv: 'OPENAI_API_KEY' | 'OPENCODE_API_KEY';
      baseUrl: string;
      configurableBaseUrl: boolean;
      useResponsesApi: boolean;
      thinking?: Readonly<{ type: 'disabled' }>;
    }>
  | Readonly<{
      adapter: 'ChatAnthropic';
      model: string;
      transport: 'anthropic_messages';
      credentialEnv: 'OPENCODE_API_KEY';
      baseUrl: string;
      configurableBaseUrl: false;
      maxOutputTokens: number;
      thinking?: Readonly<{ type: 'disabled' }>;
    }>
  | Readonly<{
      adapter: 'ChatGoogle';
      model: string;
      transport: 'google_genai';
      credentialEnv: 'GOOGLE_API_KEY';
      thinkingLevel: 'LOW';
    }>;

export function describeAgentChatModelFactory(
  profile: AgentModelProfile,
): AgentChatModelFactoryDescriptor {
  if (profile.transport === 'openai_responses') {
    return Object.freeze({
      adapter: 'ChatOpenAI',
      model: profile.model,
      transport: profile.transport,
      credentialEnv: profile.credentialEnv,
      baseUrl: openAiBaseUrl,
      configurableBaseUrl: true,
      useResponsesApi: true,
    });
  }
  if (profile.transport === 'openai_compatible_chat') {
    return Object.freeze({
      adapter: 'ChatOpenAI',
      model: profile.model,
      transport: profile.transport,
      credentialEnv: profile.credentialEnv,
      baseUrl: openCodeBaseUrl,
      configurableBaseUrl: false,
      useResponsesApi: false,
      thinking: profile.thinking,
    });
  }
  if (profile.transport === 'anthropic_messages') {
    return Object.freeze({
      adapter: 'ChatAnthropic',
      model: profile.model,
      transport: profile.transport,
      credentialEnv: profile.credentialEnv,
      baseUrl: openCodeBaseUrl,
      configurableBaseUrl: false,
      maxOutputTokens: profile.maxOutputTokens,
      ...(profile.thinking ? { thinking: profile.thinking } : {}),
    });
  }
  return Object.freeze({
    adapter: 'ChatGoogle',
    model: profile.model,
    transport: profile.transport,
    credentialEnv: profile.credentialEnv,
    thinkingLevel: profile.thinkingLevel,
  });
}

function requiredCredential(
  input: {
    openAiApiKey?: string;
    openCodeApiKey?: string;
    googleApiKey?: string;
  },
  profile: AgentModelProfile,
): string {
  const credential =
    profile.credentialEnv === 'OPENAI_API_KEY'
      ? input.openAiApiKey
      : profile.credentialEnv === 'OPENCODE_API_KEY'
        ? input.openCodeApiKey
        : input.googleApiKey;
  const normalized = credential?.trim();
  if (!normalized) {
    throw new Error(
      `${profile.credentialEnv} is required for candidate ${profile.candidateId}`,
    );
  }
  return normalized;
}

const configuredAgentModelBindingBrand: unique symbol = Symbol(
  'configuredAgentModelBinding',
);
const trustedConfiguredAgentModelBindings = new WeakSet<object>();

export interface ConfiguredAgentModelBinding {
  readonly identity: AgentModelIdentity;
  readonly model: BaseChatModel;
  readonly [configuredAgentModelBindingBrand]: true;
}

function createAgentChatModel(input: {
  profile: AgentModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openCodeApiKey?: string;
  googleApiKey?: string;
}): BaseChatModel {
  const profile = resolveAgentModelProfile({
    candidateId: input.profile.candidateId,
    assertedModel: input.profile.model,
  });
  const apiKey = requiredCredential(input, profile);
  const descriptor = describeAgentChatModelFactory(profile);

  if (descriptor.adapter === 'ChatOpenAI') {
    return new ChatOpenAI({
      apiKey,
      model: descriptor.model,
      temperature: 0,
      useResponsesApi: descriptor.useResponsesApi,
      supportsStrictToolCalling: false,
      maxRetries: 1,
      ...(descriptor.thinking
        ? { modelKwargs: { thinking: descriptor.thinking } }
        : {}),
      configuration: {
        baseURL: descriptor.configurableBaseUrl
          ? input.openAiBaseUrl?.trim() || descriptor.baseUrl
          : descriptor.baseUrl,
      },
    });
  }
  if (descriptor.adapter === 'ChatAnthropic') {
    return new ChatAnthropic({
      apiKey,
      model: descriptor.model,
      temperature: 0,
      maxRetries: 1,
      maxTokens: descriptor.maxOutputTokens,
      ...(descriptor.thinking ? { thinking: descriptor.thinking } : {}),
      clientOptions: { baseURL: descriptor.baseUrl },
    });
  }
  return new ChatGoogle({
    apiKey,
    model: descriptor.model,
    maxRetries: 1,
    thinkingLevel: descriptor.thinkingLevel,
  });
}

export function createConfiguredAgentChatModel(input: {
  profile: AgentModelProfile;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openCodeApiKey?: string;
  googleApiKey?: string;
}): ConfiguredAgentModelBinding {
  const profile = resolveAgentModelProfile({
    candidateId: input.profile.candidateId,
    assertedModel: input.profile.model,
  });
  const binding: ConfiguredAgentModelBinding = Object.freeze({
    [configuredAgentModelBindingBrand]: true as const,
    identity: Object.freeze({
      candidateId: profile.candidateId,
      provider: profile.provider,
      model: profile.model,
      profile: profile.profile,
      transport: profile.transport,
    }),
    model: createAgentChatModel({ ...input, profile }),
  });
  trustedConfiguredAgentModelBindings.add(binding);
  return binding;
}

export function isTrustedConfiguredAgentModelBinding(
  value: unknown,
): value is ConfiguredAgentModelBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    trustedConfiguredAgentModelBindings.has(value)
  );
}
