import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  AgentModelIdentity,
  AgentModelProfile,
} from './agentModelProfile.js';

const capabilityInputSchema = z.object({
  capabilityToken: z.literal('typed-tool-ok'),
});

const capabilityTool = tool(async () => 'acknowledged', {
  name: 'confirm_model_capability',
  description:
    'Confirm support for a typed tool call using the required capability token.',
  schema: capabilityInputSchema,
});

type CapabilityFailure =
  | 'invocation_failed'
  | 'empty_response'
  | 'tool_binding_unsupported'
  | 'tool_call_missing'
  | 'invalid_tool_call';

export interface ModelCapabilityCheck {
  passed: boolean;
  failure?: CapabilityFailure;
}

export interface ModelCapabilityPreflightResult {
  schemaVersion: 'agent-model-capability-preflight-v1';
  identity: AgentModelIdentity;
  ordinaryInvocation: ModelCapabilityCheck;
  typedToolCall: ModelCapabilityCheck;
  passed: boolean;
}

function identityForProfile(profile: AgentModelProfile): AgentModelIdentity {
  return {
    candidateId: profile.candidateId,
    provider: profile.provider,
    model: profile.model,
    profile: profile.profile,
    transport: profile.transport,
  };
}

function hasTextContent(message: AIMessage): boolean {
  if (typeof message.content === 'string') {
    return message.content.trim().length > 0;
  }
  return message.content.some(
    (part) =>
      typeof part === 'object' &&
      part !== null &&
      'text' in part &&
      typeof part.text === 'string' &&
      part.text.trim().length > 0,
  );
}

async function checkOrdinaryInvocation(
  model: BaseChatModel,
): Promise<ModelCapabilityCheck> {
  try {
    const message = await model.invoke(
      'Reply briefly to confirm ordinary text invocation support.',
    );
    return hasTextContent(message)
      ? { passed: true }
      : { passed: false, failure: 'empty_response' };
  } catch {
    return { passed: false, failure: 'invocation_failed' };
  }
}

async function checkTypedToolCall(
  model: BaseChatModel,
): Promise<ModelCapabilityCheck> {
  if (!model.bindTools) {
    return { passed: false, failure: 'tool_binding_unsupported' };
  }
  try {
    const message = await model
      .bindTools([capabilityTool])
      .invoke(
        'Call confirm_model_capability with capabilityToken set to typed-tool-ok.',
      );
    const call = message.tool_calls?.find(
      ({ name }) => name === capabilityTool.name,
    );
    if (!call) return { passed: false, failure: 'tool_call_missing' };
    return capabilityInputSchema.safeParse(call.args).success
      ? { passed: true }
      : { passed: false, failure: 'invalid_tool_call' };
  } catch {
    return { passed: false, failure: 'invocation_failed' };
  }
}

export async function runModelCapabilityPreflight(input: {
  profile: AgentModelProfile;
  model: BaseChatModel;
}): Promise<ModelCapabilityPreflightResult> {
  const ordinaryInvocation = await checkOrdinaryInvocation(input.model);
  const typedToolCall = await checkTypedToolCall(input.model);
  return {
    schemaVersion: 'agent-model-capability-preflight-v1',
    identity: identityForProfile(input.profile),
    ordinaryInvocation,
    typedToolCall,
    passed: ordinaryInvocation.passed && typedToolCall.passed,
  };
}
