import {
  agentToolResultForModel,
  type AgentToolResultForModel,
} from '../graph/orderStatusEvidenceProjection.js';
import type { Order } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  agentToolCallDisposition,
} from '../ordering/toolCallDisposition.js';
import type {
  AgentToolCallResult,
  PaymentAttempt,
} from '../ordering/types.js';
import {
  validateModelPublicationAccessContext,
  validateModelPublicationAuthority,
  type ModelPublicationAuthority,
} from './modelPublicationAuthority.js';
import {
  executePortableCommerceCall,
  type PendingToolCall,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

const issuedGraphExecutedToolResults = new WeakSet<object>();

export interface GraphExecutedToolResult {
  authorityDigest: string;
  toolCallId: string;
  result: AgentToolResultForModel;
}

export type CurrentTurnPaymentStatusPresentation =
  | {
      executionOutcome: 'success';
      status: PaymentAttempt['status'];
    }
  | {
      executionOutcome: 'error';
      errorCode: 'payment_failed' | 'payment_status_check_failed';
    };

/**
 * Projects the latest issued payment-status result into presentation-only
 * evidence. A failed check must not overwrite the durable payment attempt,
 * but the current response still needs to describe that observed failure.
 */
export function currentTurnPaymentStatusFromIssuedExecutions(input: {
  authority: ModelPublicationAuthority;
  executions: readonly GraphExecutedToolResult[];
}): CurrentTurnPaymentStatusPresentation | undefined {
  for (let index = input.executions.length - 1; index >= 0; index -= 1) {
    const execution = input.executions[index];
    if (
      !execution ||
      execution.authorityDigest !== input.authority.authorityDigest ||
      execution.result.toolName !== 'checkPaymentStatus' ||
      !issuedGraphExecutedToolResults.has(execution)
    ) {
      continue;
    }
    if (execution.result.ok) {
      return {
        executionOutcome: 'success',
        status: execution.result.value.status,
      };
    }
    const errorCode =
      execution.result.errorCode === 'payment_failed'
        ? 'payment_failed'
        : 'payment_status_check_failed';
    return {
      executionOutcome: 'error',
      errorCode,
    };
  }
  return undefined;
}

/**
 * Returns the latest authenticated recent-order observation from this exact
 * model-publication turn. Failed/null reads intentionally revoke an earlier
 * observation instead of silently falling back to stale private evidence.
 */
export function currentTurnRecentOrderFromIssuedExecutions(input: {
  authority: ModelPublicationAuthority;
  executions: readonly GraphExecutedToolResult[];
}): Order | undefined {
  for (let index = input.executions.length - 1; index >= 0; index -= 1) {
    const execution = input.executions[index];
    if (
      !execution ||
      execution.authorityDigest !== input.authority.authorityDigest ||
      execution.result.toolName !== 'getRecentOrder' ||
      !issuedGraphExecutedToolResults.has(execution)
    ) {
      continue;
    }
    return execution.result.ok && execution.result.value
      ? structuredClone(execution.result.value)
      : undefined;
  }
  return undefined;
}

function deepFreeze<Value>(value: Value): Value {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export async function executeGraphToolCallForPublication(input: {
  authority: ModelPublicationAuthority;
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  call: PendingToolCall;
  currentTurnExecutions?: readonly GraphExecutedToolResult[];
  currentTurnToolTrace: Parameters<
    typeof executePortableCommerceCall
  >[0]['currentTurnToolTrace'];
}): Promise<GraphExecutedToolResult> {
  if (
    input.runtime.state !== input.state ||
    input.runtime.turnInput.sessionId !== input.state.sessionId ||
    input.runtime.turnInput.customerId !== input.state.customerId ||
    input.runtime.turnInput.channel !== input.state.channel ||
    input.call.id.length === 0 ||
    !(await validateModelPublicationAccessContext({
      authority: input.authority,
      accessContext: input.runtime.turnInput.accessContext,
      guestCheckoutAuthority:
        input.runtime.turnInput.guestCheckoutAuthority,
      verifiedGuestAuthority:
        input.runtime.turnInput.confirmationResume
          ?.verifiedGuestAuthority,
      runFence: input.runtime.turnInput.runGuard?.commitFence,
      confirmationResume:
        input.runtime.turnInput.confirmationResume !== undefined,
    })) ||
    !(await validateModelPublicationAuthority({
      authority: input.authority,
      state: input.state,
    }))
  ) {
    throw new Error('graph_executed_tool_result_authority_invalid');
  }

  const result = await executePortableCommerceCall({
    runtime: input.runtime,
    state: input.state,
    call: input.call,
    currentTurnToolTrace: input.currentTurnToolTrace,
    currentTurnStatusOrder:
      currentTurnRecentOrderFromIssuedExecutions({
        authority: input.authority,
        executions: input.currentTurnExecutions ?? [],
      }),
  });
  if (
    result.toolName !== input.call.toolName ||
    !(await validateModelPublicationAccessContext({
      authority: input.authority,
      accessContext: input.runtime.turnInput.accessContext,
      guestCheckoutAuthority:
        input.runtime.turnInput.guestCheckoutAuthority,
      verifiedGuestAuthority:
        input.runtime.turnInput.confirmationResume
          ?.verifiedGuestAuthority,
      runFence: input.runtime.turnInput.runGuard?.commitFence,
      confirmationResume:
        input.runtime.turnInput.confirmationResume !== undefined,
    })) ||
    !(await validateModelPublicationAuthority({
      authority: input.authority,
      state: input.state,
    }))
  ) {
    throw new Error('graph_executed_tool_result_invalid');
  }

  const execution = deepFreeze({
    authorityDigest: input.authority.authorityDigest,
    toolCallId: input.call.id,
    result: structuredClone(result),
  });
  issuedGraphExecutedToolResults.add(execution);
  return execution;
}

export async function issueGraphReadResultForPublication(input: {
  authority: ModelPublicationAuthority;
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  call: PendingToolCall;
  result: AgentToolCallResult;
}): Promise<GraphExecutedToolResult> {
  const disposition = agentToolCallDisposition(
    input.call.toolName,
    input.call.arguments,
  );
  if (
    !disposition.success ||
    disposition.data.effect !== 'provider_read' ||
    input.call.id.length === 0 ||
    input.result.toolName !== input.call.toolName ||
    input.runtime.state !== input.state ||
    !(await validateModelPublicationAccessContext({
      authority: input.authority,
      accessContext: input.runtime.turnInput.accessContext,
      guestCheckoutAuthority:
        input.runtime.turnInput.guestCheckoutAuthority,
      verifiedGuestAuthority:
        input.runtime.turnInput.confirmationResume
          ?.verifiedGuestAuthority,
      runFence: input.runtime.turnInput.runGuard?.commitFence,
      confirmationResume:
        input.runtime.turnInput.confirmationResume !== undefined,
    })) ||
    !(await validateModelPublicationAuthority({
      authority: input.authority,
      state: input.state,
    }))
  ) {
    throw new Error('graph_executed_read_result_invalid');
  }
  const execution = deepFreeze({
    authorityDigest: input.authority.authorityDigest,
    toolCallId: input.call.id,
    result: structuredClone(agentToolResultForModel(input.result)),
  });
  issuedGraphExecutedToolResults.add(execution);
  return execution;
}

export function isIssuedGraphExecutedToolResult(
  value: GraphExecutedToolResult,
): boolean {
  return issuedGraphExecutedToolResults.has(value);
}
