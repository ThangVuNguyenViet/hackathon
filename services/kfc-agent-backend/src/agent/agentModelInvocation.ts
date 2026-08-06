import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { isAIMessage } from '@langchain/core/messages';
import { mergeConfigs } from '@langchain/core/runnables';
import { getConfig } from '@langchain/langgraph';
import type { AgentTurnInput } from '../graph/agentTurnState.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import { MODEL_PRESENTATION_CONTEXT_INSTRUCTION } from './agentPresentationContext.js';
import { APPROVAL_BATCH_MODEL_INSTRUCTION } from './agentApprovalBatchShape.js';
import {
  classifyProviderFailure,
  type ProviderErrorClass,
  type ProviderFailure,
  type ProviderFailureDiagnostic,
} from './agentBoundaryPolicy.js';
import { GROUNDED_RESPONSE_TOOL_NAME } from './responseGrounding.js';
import {
  runtimeDispatchFailure,
  toolCallRequiresApproval,
  type PendingToolCall,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

export const MAXIMUM_AGENT_PROVIDER_CALLS = 6;
export const MAXIMUM_AGENT_PROVIDER_RETRIES = 1;
type BoundChatModel = ReturnType<NonNullable<BaseChatModel['bindTools']>>;

interface RequiredAgentToolChoice {
  type: 'allowed_tools';
  mode: 'required';
  tools: Array<{ type: 'function'; name: string }>;
}

// OpenAI Responses requires allowed_tools; Google intentionally normalizes it to ANY.
export function requiredAgentToolChoice(
  toolNames: readonly string[],
): RequiredAgentToolChoice {
  return {
    type: 'allowed_tools',
    mode: 'required',
    tools: toolNames.map((name) => ({
      type: 'function',
      name,
    })),
  };
}

export const AGENT_SYSTEM_PROMPT = [
  '# Role',
  'You are an AI ordering and advisory assistant. Freely use any available tools to look up information, verify facts, perform calculations, and fulfill customer requests.',
  '',
  '# Tool Usage & Capabilities',
  'You are free to call any relevant tools whenever needed to gather current facts and complete the customer request in the same turn.',
  'Inspect returned tool results and use them as authoritative ground truth for customer answers.',
  'When additional information is needed to fulfill a request, invoke the appropriate tools freely.',
  '',
  '# Grounding & Responses',
  'Base all customer-facing factual claims on current tool results or verified business state.',
  'Translate tool evidence into natural, customer-friendly prose in the requested language.',
  'Provide clear outcomes and helpful next steps with warmth and clarity.',
  APPROVAL_BATCH_MODEL_INSTRUCTION,
  MODEL_PRESENTATION_CONTEXT_INSTRUCTION,
  `When ready to answer, call ${GROUNDED_RESPONSE_TOOL_NAME} exactly once instead of returning plain text.`,
].join('\n');

export const AGENT_MODEL_DESTINATIONS = {
  fail_closed: 'fail_closed',
  record_provider_retry: 'record_provider_retry',
  validate_tool_calls: 'validate_tool_calls',
  finalize_response: 'finalize_response',
} as const;

export function routeAgentModelResult(state: {
  failure: string | null;
  providerFailure: ProviderFailure | null;
  messages: BaseMessage[];
}) {
  if (state.failure) return 'fail_closed';
  if (state.providerFailure) return 'record_provider_retry';
  const last = state.messages.at(-1);
  return last && isAIMessage(last) && (last.tool_calls?.length ?? 0) > 0
    ? 'validate_tool_calls'
    : 'finalize_response';
}

export const AGENT_AFTER_NORMAL_TOOL_DESTINATIONS = {
  fail_closed: 'fail_closed',
  record_semantic_correction: 'record_semantic_correction',
  request_approval: 'request_approval',
  execute_tools: 'execute_tools',
  call_model: 'call_model',
} as const;

export function routeAfterNormalTool(state: {
  failure: string | null;
  validationError: string | null;
  pendingToolCalls: PendingToolCall[];
}) {
  if (state.failure) return 'fail_closed';
  if (state.validationError) return 'record_semantic_correction';
  const nextCall = state.pendingToolCalls[0];
  if (nextCall) {
    return toolCallRequiresApproval(nextCall)
      ? 'request_approval'
      : 'execute_tools';
  }
  return 'call_model';
}

export const AGENT_AFTER_TRUSTED_TOOL_DESTINATIONS = {
  fail_closed: 'fail_closed',
  prepare_structured_action: 'prepare_structured_action',
  semantic_agent: 'semantic_agent',
} as const;

export function routeAfterTrustedTool(state: {
  failure: string | null;
  structuredActionAfterTool: 'prepare' | 'respond' | null;
}) {
  if (state.failure) return 'fail_closed';
  return state.structuredActionAfterTool === 'prepare'
    ? 'prepare_structured_action'
    : 'semantic_agent';
}

export interface ProviderAttemptEvidence {
  attempt: number;
  outcome: 'error' | 'invalid_response' | 'success';
  errorClass?: ProviderErrorClass;
  retryable?: boolean;
  purpose: 'agent_decision' | 'response_composition';
}

export interface AgentModelInvocationState {
  providerAttempts: number;
  providerAttemptEvidence: ProviderAttemptEvidence[];
  turnDeadlineAt: number;
}

export interface AgentModelInvocationUpdate {
  messages?: BaseMessage[];
  providerAttempts?: number;
  providerAttemptEvidence?: ProviderAttemptEvidence[];
  providerFailure?: ProviderFailure | null;
  providerFailureDiagnostic?: ProviderFailureDiagnostic | null;
  validationError?: string | null;
  failure?: string;
}

const noopModelAttemptSpan: Pick<AgentTraceSpan, 'end'> = {
  async end() {
    return undefined;
  },
};

async function startModelAttemptSpan(input: {
  attempt: number;
  purpose: ProviderAttemptEvidence['purpose'];
  runtime: SingleAgentRuntimeContext;
}): Promise<Pick<AgentTraceSpan, 'end'>> {
  try {
    return await input.runtime.turnTrace.startSpan({
      name: 'agent_model_attempt',
      runType: 'llm',
      inputs: {
        attempt: input.attempt,
        purpose: input.purpose,
      },
      metadata: {},
      tags: ['agent-model-attempt'],
    });
  } catch {
    return noopModelAttemptSpan;
  }
}

async function endModelAttemptSpan(
  span: Pick<AgentTraceSpan, 'end'>,
  outputs: {
    attempt: number;
    purpose: ProviderAttemptEvidence['purpose'];
    outcome: ProviderAttemptEvidence['outcome'];
    errorClass?: ProviderErrorClass;
    retryable?: boolean;
    diagnostic?: ProviderFailureDiagnostic;
    toolCallCount: number;
  },
): Promise<void> {
  try {
    await span.end(outputs);
  } catch {
    // Observability is diagnostic-only and must never change agent behavior.
  }
}

export async function invokeAgentModel(input: {
  model: BoundChatModel;
  messages: BaseMessage[] | (() => Promise<BaseMessage[]>);
  observation: { kind: 'planning' } | { kind: 'response_composition' };
  runtime: SingleAgentRuntimeContext;
  state: AgentModelInvocationState;
}): Promise<AgentModelInvocationUpdate> {
  if (input.state.providerAttempts >= MAXIMUM_AGENT_PROVIDER_CALLS) {
    return { failure: 'agent_provider_call_limit_exceeded' };
  }
  const initialFailure = await runtimeDispatchFailure(input.runtime);
  if (initialFailure) return { failure: initialFailure };
  try {
    await input.runtime.turnInput.observeRun?.(input.observation);
  } catch {
    return { failure: 'agent_run_observer_failed' };
  }
  const observationFailure = await runtimeDispatchFailure(input.runtime);
  if (observationFailure) return { failure: observationFailure };

  let messages: BaseMessage[];
  try {
    messages =
      typeof input.messages === 'function'
        ? await input.messages()
        : input.messages;
  } catch {
    return { failure: 'agent_model_publication_authority_invalid' };
  }
  const messageConstructionFailure = await runtimeDispatchFailure(
    input.runtime,
  );
  if (messageConstructionFailure) {
    return { failure: messageConstructionFailure };
  }
  const attempt = input.state.providerAttempts + 1;
  const purpose =
    input.observation.kind === 'planning'
      ? 'agent_decision'
      : 'response_composition';
  const attemptSpan = await startModelAttemptSpan({
    attempt,
    purpose,
    runtime: input.runtime,
  });
  try {
    const remainingMs = Math.max(
      1,
      input.runtime.externalCallContext.deadlineAt - Date.now(),
    );
    const invocationConfig = {
      ...mergeConfigs(getConfig(), { timeout: remainingMs }),
      signal: input.runtime.externalCallContext.signal,
    };
    const response = await input.model.invoke(messages, invocationConfig);
    if (!isAIMessage(response)) {
      await endModelAttemptSpan(attemptSpan, {
        attempt,
        purpose,
        outcome: 'invalid_response',
        toolCallCount: 0,
      });
      return {
        providerAttempts: attempt,
        providerAttemptEvidence: [
          ...input.state.providerAttemptEvidence,
          { attempt, outcome: 'invalid_response', purpose },
        ],
        failure: 'agent_model_response_invalid',
      };
    }
    await endModelAttemptSpan(attemptSpan, {
      attempt,
      purpose,
      outcome: 'success',
      toolCallCount: response.tool_calls?.length ?? 0,
    });
    return {
      messages: [response],
      providerAttempts: attempt,
      providerAttemptEvidence: [
        ...input.state.providerAttemptEvidence,
        { attempt, outcome: 'success', purpose },
      ],
      providerFailure: null,
      providerFailureDiagnostic: null,
      validationError: null,
    };
  } catch (error) {
    const classified = classifyProviderFailure(error);
    const failure: ProviderFailure = {
      errorClass: classified.errorClass,
      retryable: classified.retryable,
    };
    await endModelAttemptSpan(attemptSpan, {
      attempt,
      purpose,
      outcome: 'error',
      errorClass: failure.errorClass,
      retryable: failure.retryable,
      diagnostic: classified.diagnostic,
      toolCallCount: 0,
    });
    return {
      providerAttempts: attempt,
      providerAttemptEvidence: [
        ...input.state.providerAttemptEvidence,
        {
          attempt,
          outcome: 'error',
          errorClass: failure.errorClass,
          retryable: failure.retryable,
          purpose,
        },
      ],
      providerFailure: failure,
      providerFailureDiagnostic: classified.diagnostic,
    };
  }
}

export function providerFailureReportCode(
  failure: string,
  diagnostic: ProviderFailureDiagnostic | null | undefined,
): string {
  if (
    !failure.startsWith('agent_provider_call_failed:') ||
    !diagnostic ||
    (diagnostic.httpStatus === undefined && diagnostic.errorType === undefined)
  ) {
    return failure;
  }
  return [
    failure,
    ...(diagnostic.httpStatus === undefined
      ? []
      : [`http_${diagnostic.httpStatus}`]),
    ...(diagnostic.errorType === undefined ? [] : [diagnostic.errorType]),
    diagnostic.stage,
  ].join(':');
}

export function providerRetryUpdate(state: {
  providerFailure: ProviderFailure | null;
  providerRetries: number;
  providerAttempts: number;
  turnDeadlineAt: number;
}): {
  providerRetries?: number;
  providerFailure?: null;
  failure?: string;
} {
  if (
    state.providerFailure?.retryable &&
    state.providerRetries < MAXIMUM_AGENT_PROVIDER_RETRIES &&
    state.providerAttempts < MAXIMUM_AGENT_PROVIDER_CALLS &&
    Date.now() < state.turnDeadlineAt
  ) {
    return {
      providerRetries: state.providerRetries + 1,
      providerFailure: null,
    };
  }
  return {
    failure: state.providerFailure
      ? `agent_provider_call_failed:${state.providerFailure.errorClass}`
      : 'agent_provider_call_failed',
  };
}
