import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  AgentModelIdentity,
  ConfiguredAgentModelBinding,
} from './agentModelProfile.js';
import { isTrustedConfiguredAgentModelBinding } from './agentModelProfile.js';

export type { ConfiguredAgentModelBinding } from './agentModelProfile.js';

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

export async function checkModelCapabilities(
  model: BaseChatModel,
): Promise<
  Pick<
    ModelCapabilityPreflightResult,
    'ordinaryInvocation' | 'typedToolCall' | 'passed'
  >
> {
  const ordinaryInvocation = await checkOrdinaryInvocation(model);
  const typedToolCall = await checkTypedToolCall(model);
  return {
    ordinaryInvocation,
    typedToolCall,
    passed: ordinaryInvocation.passed && typedToolCall.passed,
  };
}

export async function runModelCapabilityPreflight(
  binding: ConfiguredAgentModelBinding,
): Promise<ModelCapabilityPreflightResult> {
  if (!isTrustedConfiguredAgentModelBinding(binding)) {
    throw new Error('Untrusted configured agent model binding');
  }
  const capabilities = await checkModelCapabilities(binding.model);
  return {
    schemaVersion: 'agent-model-capability-preflight-v1',
    identity: binding.identity,
    ...capabilities,
  };
}
