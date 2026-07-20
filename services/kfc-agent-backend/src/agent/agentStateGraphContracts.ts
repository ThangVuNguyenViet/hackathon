import type { BaseMessage, ToolCall } from '@langchain/core/messages';
import { isAIMessage } from '@langchain/core/messages';
import type { AgentTurnInput } from '../graph/agentTurnState.js';
import type { AgentGraphState } from '../graph/state.js';
import type {
  SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

export type KfcAgentGraphInput = Pick<
  AgentTurnInput,
  'sessionId' | 'customerId' | 'channel' | 'text' | 'externalMessageId' |
  'metadata'
>;

export type KfcAgentRuntimeResolver = (input: KfcAgentGraphInput) =>
  SingleAgentRuntimeContext | Promise<SingleAgentRuntimeContext>;

export const KFC_AGENT_GRAPH_NODE_NAMES = [
  'load_context',
  'prepare_structured_action',
  'call_model',
  'call_response_model',
  'validate_tool_calls',
  'record_semantic_correction',
  'request_approval',
  'revalidate_approval',
  'execute_tools',
  'execute_trusted_action',
  'record_provider_retry',
  'verify_response',
  'finalize_response',
  'persist_and_project',
  'fail_closed',
] as const;

export function graphInput(
  state: KfcAgentGraphInput,
  options: { allowMissingUntrackedText?: boolean } = {},
): KfcAgentGraphInput {
  const text = typeof state.text === 'string' ? state.text : undefined;
  if (
    !state.sessionId?.trim() ||
    !state.customerId?.trim() ||
    !state.channel ||
    (!text && !options.allowMissingUntrackedText)
  ) {
    throw new Error('agent_graph_input_invalid');
  }
  return {
    sessionId: state.sessionId,
    customerId: state.customerId,
    channel: state.channel,
    // Customer prose is intentionally untracked. Only the runtime scope may
    // opt into the empty lookup value after LangGraph marks an actual
    // checkpoint resume; ordinary graph input cannot self-assert that state.
    text: text ?? '',
    externalMessageId: state.externalMessageId ?? null,
    metadata: state.metadata ?? null,
  };
}

export function requiredDomainState(state: {
  domainState: AgentGraphState | null;
}): AgentGraphState {
  if (!state.domainState) throw new Error('agent_domain_state_missing');
  return state.domainState;
}

export function lastToolCalls(messages: BaseMessage[]): ToolCall[] {
  const last = messages.at(-1);
  return last && isAIMessage(last) ? (last.tool_calls ?? []) : [];
}
