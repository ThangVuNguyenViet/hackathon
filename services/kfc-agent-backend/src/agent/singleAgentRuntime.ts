import { z } from 'zod';
import type { ExternalCallContext } from '../clients/interfaces.js';
import {
  type AgentToolResultForModel,
} from '../graph/orderStatusEvidenceProjection.js';
import {
  approvalCapabilityScopes,
  getToolBoundary,
} from '../ordering/toolBoundaries.js';
import {
  agentToolArgumentSchemas,
  toolNames,
} from '../ordering/toolCatalog.js';
import {
  buildCurrentAgentApprovalBinding,
  executeAgentToolCall,
} from '../ordering/agentToolExecutor.js';
import {
  verifyCommerceApprovalExecutionFence,
} from '../ordering/approvalExecutionFence.js';
import {
  verifyCommerceApprovalReceipt,
} from '../ordering/approvalReceipt.js';
import {
  externalCallCancelledErrorCode,
} from '../ordering/toolExecutor.js';
import {
  agentToolCallDisposition,
} from '../ordering/toolCallDisposition.js';
import type {
  AgentToolCallResult,
  CommerceApprovalCapability,
  ToolCallResult,
  ToolCallRequest,
  ToolName,
  ToolTraceEntry,
} from '../ordering/types.js';
import { projectToolProgressFamily } from '../customerRuns/progressProjection.js';
import { resolveResponseProfile } from '../presentation/responseProfile.js';
import {
  ensureCartForTool,
} from '../graph/commerceExecution.js';
import type {
  AgentTurnInput,
} from '../graph/agentTurnState.js';
import type { ConversationTurn, Order } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  emitSessionUpdate,
  isRecord,
  isRunStillCurrent,
  stateRevision,
  toolExecutionContext,
  traceStateSummary,
} from '../graph/turnSupport.js';
import {
  applyAgentCollectionToVerifiedState,
  applyToolResultToState,
  loadPriorVerifiedState,
} from '../graph/verifiedState.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import { approvalExecutionForResume } from './approvalResumeExecution.js';
import {
  assembleLoadedTurnState,
  type LoadedAgentTurnState,
} from './agentTurnStateHydration.js';
import {
  semanticConversationTurns,
} from './trustedActionConversation.js';
import {
  persistVerifiedStateForCurrentRun,
} from './agentVerifiedStateCommit.js';
import {
  isAgentCollectionToolName,
  projectAgentToolResultForModelCall,
} from './agentToolResultProjection.js';
import {
  privacySafeAgentToolSpanInputs,
  privacySafeAgentToolSpanOutputs,
  privacySafeAgentToolSpanFailure,
} from './agentToolTracePrivacy.js';
import {
  loadOrAppendAgentCurrentUserTurn,
} from './agentTurnIntake.js';
export {
  freshMessages,
  messageText,
} from './agentConversationMessages.js';
export {
  persistCompletedTurn,
} from './agentTurnPersistence.js';
export {
  commerceToolDefinitions,
} from './agentToolDefinitions.js';
export {
  createAgentTurnExternalCallScope,
  defaultAgentTurnDeadlineMs,
  type AgentTurnExternalCallScope,
} from './agentExternalCallScope.js';

export interface SingleAgentRuntimeContext {
  turnInput: AgentTurnInput;
  turnTrace: AgentTraceSpan;
  externalCallContext: ExternalCallContext;
  abortExternalCalls(reason: unknown): void;
  disposeExternalCalls(): void;
  state?: AgentGraphState;
  validatedApprovalActionDigest?: string;
}

export type AgentExternalCallFailure =
  | 'agent_turn_deadline_exceeded'
  | 'customer_run_cancelled';

export type AgentDispatchFailure =
  | AgentExternalCallFailure
  | 'agent_run_current_check_failed';

export function runtimeExternalCallFailure(
  runtime: SingleAgentRuntimeContext,
): AgentExternalCallFailure | null {
  const { deadlineAt, signal } = runtime.externalCallContext;
  if (!signal.aborted && Date.now() < deadlineAt) return null;
  return Date.now() >= deadlineAt ||
    (signal.reason instanceof Error &&
      signal.reason.name === 'TimeoutError')
    ? 'agent_turn_deadline_exceeded'
    : 'customer_run_cancelled';
}

export async function runtimeDispatchFailure(
  runtime: SingleAgentRuntimeContext,
): Promise<AgentDispatchFailure | null> {
  const initialFailure = runtimeExternalCallFailure(runtime);
  if (initialFailure) return initialFailure;
  let currentRun: boolean;
  try {
    currentRun = await isRunStillCurrent(runtime.turnInput);
  } catch {
    return runtimeExternalCallFailure(runtime) ??
      'agent_run_current_check_failed';
  }
  const completedFailure = runtimeExternalCallFailure(runtime);
  if (completedFailure) return completedFailure;
  if (currentRun) return null;
  runtime.abortExternalCalls(new DOMException(
    'customer_run_cancelled',
    'AbortError',
  ));
  return 'customer_run_cancelled';
}

function assertRuntimeExternalCallActive(
  runtime: SingleAgentRuntimeContext,
): void {
  const failure = runtimeExternalCallFailure(runtime);
  if (failure) throw new Error(failure);
}

export const runtimeContextSchema = z.object({
  runtime: z.custom<SingleAgentRuntimeContext>().optional(),
});

export interface PendingToolCall {
  id: string;
  toolName: ToolName;
  /**
   * Server-resolved arguments used only for provider dispatch and verified
   * state application.
   */
  arguments: Record<string, unknown>;
  /**
   * Canonical authorized arguments retained for privacy-safe audit and
   * evaluation when provider dispatch needs a private server-side expansion.
   */
  auditArguments?: Record<string, unknown>;
}

const toolNameSet = new Set<string>(toolNames);
const protectedAgentToolNames = new Set<ToolName>([
  'updateCart',
  'collectInvoice',
]);

export function isApprovalCapability(
  toolName: ToolName,
): toolName is CommerceApprovalCapability {
  return toolName in approvalCapabilityScopes;
}

export function toolCallRequiresApproval(
  call: Pick<PendingToolCall, 'toolName' | 'arguments'>,
): boolean {
  const disposition = agentToolCallDisposition(
    call.toolName,
    call.arguments,
  );
  return disposition.success &&
    disposition.data.effect === 'irreversible_mutation';
}

function projectedToolArguments(
  call: PendingToolCall,
  state: AgentGraphState,
  currentTurnStatusOrder?: Order,
): Record<string, unknown> {
  if (
    call.toolName === 'getOrderStatus' ||
    call.toolName === 'checkPaymentStatus'
  ) {
    const order = state.order ?? currentTurnStatusOrder;
    return order ? { orderId: order.id } : call.arguments;
  }
  if (call.toolName === 'checkStoreAvailability') {
    const parsed =
      agentToolArgumentSchemas.checkStoreAvailability.parse(call.arguments);
    if (!parsed.disposition) return call.arguments;
    return {
      storeId: parsed.storeId,
      itemCodes: [
        ...new Set(state.cart?.items.map(({ itemCode }) => itemCode) ?? []),
      ],
      disposition: parsed.disposition,
    };
  }
  if (call.toolName === 'resolveHandoff') {
    return state.handoff
      ? { escalationId: state.handoff.escalationId }
      : call.arguments;
  }
  if (call.toolName !== 'quoteFulfillment') return call.arguments;
  const parsed = agentToolArgumentSchemas.quoteFulfillment.parse(call.arguments);
  if (!('address' in parsed)) {
    throw new Error('saved_address_ref_must_be_resolved_by_graph');
  }
  return {
    address: parsed.address,
    method: parsed.method,
    itemCodes: state.cart?.items.map((item) => item.itemCode) ?? [],
  };
}

async function applyAgentToolResult(input: {
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  call: PendingToolCall;
  result: AgentToolCallResult;
  currentTurnToolTrace: ToolTraceEntry[];
  currentTurnStatusOrder?: Order;
}): Promise<void> {
  const before = traceStateSummary(input.state);
  const stateSpan = await input.runtime.turnTrace.startSpan({
    name: 'state_update',
    runType: 'chain',
    inputs: { toolName: input.call.toolName, before },
  });
  try {
    assertRuntimeExternalCallActive(input.runtime);
    if (
      input.result.ok &&
      isAgentCollectionToolName(input.result.toolName)
    ) {
      if (!input.result.verifiedCollection) {
        throw new Error('agent_verified_collection_missing');
      }
      const trace: ToolTraceEntry = {
        toolName: input.result.toolName,
        arguments:
          input.call.auditArguments ?? input.call.arguments,
        ok: true,
        resultSummary: input.result.message,
        provenance: input.result.provenance,
      };
      input.state.toolTrace = [...(input.state.toolTrace ?? []), trace];
      input.currentTurnToolTrace.push(trace);
      applyAgentCollectionToVerifiedState(input.state, input.result);
      emitSessionUpdate(input.runtime.turnInput, {
        updateType: 'tool_called',
        toolName: input.result.toolName,
        boundary: getToolBoundary(input.result.toolName),
        ok: true,
        resultSummary: input.result.message,
        provenance: input.result.provenance,
      });
      if (input.result.toolName === 'searchPromotions') {
        emitSessionUpdate(input.runtime.turnInput, {
          updateType: 'promotion_answered',
        });
      }
      if (
        input.result.toolName === 'answerAllergenQuestion' &&
        input.result.verifiedCollection.result.items.length > 0
      ) {
        emitSessionUpdate(input.runtime.turnInput, {
          updateType: 'content_evidence_found',
          kind: 'allergen',
        });
      }
    } else {
      applyToolResultToState(
        input.runtime.turnInput,
        input.state,
        input.result as ToolCallResult,
        projectedToolArguments(
          input.call,
          input.state,
          input.currentTurnStatusOrder,
        ),
        input.currentTurnToolTrace,
        {
          traceArguments: input.call.auditArguments,
        },
      );
    }
    if (input.result.ok) {
      await input.runtime.turnInput.observeRun?.({ kind: 'verified_state' });
    }
    await stateSpan.end({
      toolName: input.call.toolName,
      before,
      after: traceStateSummary(input.state),
    });
  } catch (error) {
    await stateSpan.fail(error);
    throw error;
  }
}

export async function executePortableCommerceCall(input: {
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  call: PendingToolCall;
  currentTurnToolTrace: ToolTraceEntry[];
  currentTurnStatusOrder?: Order;
}): Promise<AgentToolResultForModel> {
  const rawRequest: ToolCallRequest = {
    toolName: input.call.toolName,
    arguments: input.call.arguments,
  };
  const initialFailure = await runtimeDispatchFailure(input.runtime);
  if (initialFailure) throw new Error(initialFailure);
  const disposition = agentToolCallDisposition(
    rawRequest.toolName,
    rawRequest.arguments,
  );
  const request: ToolCallRequest = disposition.success
    ? {
        toolName: disposition.data.toolName,
        arguments: disposition.data.arguments,
      }
    : rawRequest;
  const approvalCapability =
    disposition.success &&
      disposition.data.effect === 'irreversible_mutation' &&
      isApprovalCapability(request.toolName)
      ? request.toolName
      : undefined;
  const requiresApproval = approvalCapability !== undefined;
  const approval = approvalCapability
    ? approvalExecutionForResume(
        input.runtime.turnInput.confirmationResume,
        approvalCapability,
      )
    : undefined;
  if (requiresApproval && !approval) {
    return {
      toolName: request.toolName,
      ok: false,
      errorCode: 'agent_approval_authority_unconfigured',
      message: 'Signed commerce approval authority is not configured',
      provenance: [],
    };
  }
  await input.runtime.turnInput.observeRun?.({
    kind: 'tool',
    protected:
      approval !== undefined ||
      protectedAgentToolNames.has(request.toolName),
    irreversible: requiresApproval,
    progressFamily: projectToolProgressFamily(request),
  });
  const observationFailure = await runtimeDispatchFailure(input.runtime);
  if (observationFailure) throw new Error(observationFailure);
  if (
    input.runtime.turnInput.runGuard &&
    !input.runtime.turnInput.runGuard.commitFence
  ) {
    throw new Error('agent_run_commit_fence_missing');
  }
  const cartInitialization = await ensureCartForTool(
    input.runtime.turnInput,
    input.state,
    request,
    input.runtime.externalCallContext,
  );
  if (!cartInitialization.ok) {
    if (
      cartInitialization.errorCode === externalCallCancelledErrorCode
    ) {
      assertRuntimeExternalCallActive(input.runtime);
      throw new Error(externalCallCancelledErrorCode);
    }
    return {
      toolName: request.toolName,
      ok: false,
      errorCode: cartInitialization.errorCode,
      message: 'Cart initialization failed',
      provenance: [],
    };
  }
  assertRuntimeExternalCallActive(input.runtime);
  const toolSpan = await input.runtime.turnTrace.startSpan({
    name: `tool_call:${request.toolName}`,
    runType: 'tool',
    inputs: await privacySafeAgentToolSpanInputs({
      request,
      auditArguments: input.call.auditArguments,
    }),
    metadata: {
      component: 'executeAgentToolCall',
      toolName: request.toolName,
      boundary: getToolBoundary(request.toolName),
    },
    tags: ['agent-tool', `tool:${request.toolName}`],
  });
  let result: AgentToolCallResult;
  try {
    const spanFailure = await runtimeDispatchFailure(input.runtime);
    if (spanFailure) throw new Error(spanFailure);
    result = await executeAgentToolCall(
      input.runtime.turnInput.clients,
      request,
      {
        ...toolExecutionContext(input.runtime.turnInput),
        externalCallContext: input.runtime.externalCallContext,
        state: input.state,
        cart: input.state.cart,
        address: input.state.address,
        order: input.state.order,
        orderPreview: input.state.orderPreview,
        currentTurnStatusOrder: input.currentTurnStatusOrder,
        ...(approval ? { approval } : {}),
        ...(approval?.preclaimedExecution
          ? {
              providerMutationIdentity: {
                idempotencyKey:
                  approval.preclaimedExecution.providerIdempotencyKey,
                bindingFingerprint:
                  approval.preclaimedExecution.bindingFingerprint,
              },
            }
          : {}),
      },
    );
    assertRuntimeExternalCallActive(input.runtime);
    if (
      !result.ok &&
      result.errorCode === externalCallCancelledErrorCode
    ) {
      throw new Error(externalCallCancelledErrorCode);
    }
    const resultFailure = await runtimeDispatchFailure(input.runtime);
    if (resultFailure) throw new Error(resultFailure);
    await applyAgentToolResult({
      ...input,
      call: { ...input.call, arguments: request.arguments },
      result,
      currentTurnStatusOrder: input.currentTurnStatusOrder,
    });
    const stateFailure = await runtimeDispatchFailure(input.runtime);
    if (stateFailure) throw new Error(stateFailure);
    await toolSpan.end(await privacySafeAgentToolSpanOutputs({
      result,
      auditArguments:
        input.call.auditArguments ?? request.arguments,
    }));
  } catch (error) {
    await toolSpan.fail(
      privacySafeAgentToolSpanFailure(request.toolName, error),
    );
    throw error;
  }
  const completionFailure = await runtimeDispatchFailure(input.runtime);
  if (completionFailure) throw new Error(completionFailure);
  if (result.ok) {
    await persistVerifiedStateForCurrentRun(input);
  }
  return projectAgentToolResultForModelCall(result, input.call);
}

/**
 * Dispatches one prevalidated independent provider read against an immutable
 * snapshot. It deliberately does not mutate runtime state, emit graph state
 * events, append trace entries, or persist; the parallel batch coordinator
 * owns one ordered projection after every sibling read has settled.
 */
export async function executePortableCommerceReadOnly(input: {
  runtime: SingleAgentRuntimeContext;
  stateSnapshot: AgentGraphState;
  call: PendingToolCall;
  externalCallContext: ExternalCallContext;
}): Promise<AgentToolCallResult> {
  const initialFailure = await runtimeDispatchFailure(input.runtime);
  if (initialFailure) throw new Error(initialFailure);
  const disposition = agentToolCallDisposition(
    input.call.toolName,
    input.call.arguments,
  );
  if (
    !disposition.success ||
    disposition.data.effect !== 'provider_read'
  ) {
    throw new Error('agent_parallel_read_dispatch_invalid');
  }
  const request: ToolCallRequest = {
    toolName: disposition.data.toolName,
    arguments: disposition.data.arguments,
  };
  const result = await executeAgentToolCall(
    input.runtime.turnInput.clients,
    request,
    {
      ...toolExecutionContext(input.runtime.turnInput),
      externalCallContext: input.externalCallContext,
      state: input.stateSnapshot,
      cart: input.stateSnapshot.cart,
      address: input.stateSnapshot.address,
      order: input.stateSnapshot.order,
      orderPreview: input.stateSnapshot.orderPreview,
    },
  );
  assertRuntimeExternalCallActive(input.runtime);
  return result;
}

/**
 * Publishes tool progress and rechecks ownership before a concurrent provider
 * read batch starts. The coordinator calls this for every proposed read before
 * dispatching any of them, so an observer cancellation cannot leave a
 * partially-started batch.
 */
export async function preflightPortableCommerceRead(input: {
  runtime: SingleAgentRuntimeContext;
  call: PendingToolCall;
}): Promise<PendingToolCall> {
  const initialFailure = await runtimeDispatchFailure(input.runtime);
  if (initialFailure) throw new Error(initialFailure);
  const disposition = agentToolCallDisposition(
    input.call.toolName,
    input.call.arguments,
  );
  if (
    !disposition.success ||
    disposition.data.effect !== 'provider_read'
  ) {
    throw new Error('agent_parallel_read_dispatch_invalid');
  }
  const request: ToolCallRequest = {
    toolName: disposition.data.toolName,
    arguments: disposition.data.arguments,
  };
  await input.runtime.turnInput.observeRun?.({
    kind: 'tool',
    protected: false,
    irreversible: false,
    progressFamily: projectToolProgressFamily(request),
  });
  const observationFailure = await runtimeDispatchFailure(input.runtime);
  if (observationFailure) throw new Error(observationFailure);
  return {
    id: input.call.id,
    toolName: request.toolName,
    arguments: request.arguments,
    ...(input.call.auditArguments
      ? {
          auditArguments:
            structuredClone(input.call.auditArguments),
        }
      : {}),
  };
}

export function projectPortableCommerceReadResult(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  call: PendingToolCall;
  result: AgentToolCallResult;
  currentTurnToolTrace: ToolTraceEntry[];
}): void {
  if (
    input.result.ok &&
    isAgentCollectionToolName(input.result.toolName)
  ) {
    if (!input.result.verifiedCollection) {
      throw new Error('agent_verified_collection_missing');
    }
    const trace: ToolTraceEntry = {
      toolName: input.result.toolName,
      arguments:
        input.call.auditArguments ?? input.call.arguments,
      ok: true,
      resultSummary: input.result.message,
      provenance: input.result.provenance,
    };
    input.state.toolTrace = [...(input.state.toolTrace ?? []), trace];
    input.currentTurnToolTrace.push(trace);
    applyAgentCollectionToVerifiedState(input.state, input.result);
    return;
  }
  applyToolResultToState(
    input.turnInput,
    input.state,
    input.result as ToolCallResult,
    projectedToolArguments(input.call, input.state),
    input.currentTurnToolTrace,
    {
      emitEvents: false,
      traceArguments: input.call.auditArguments,
    },
  );
}

export async function emitPortableCommerceReadResult(input: {
  runtime: SingleAgentRuntimeContext;
  result: AgentToolCallResult;
}): Promise<void> {
  if (!input.result.ok) return;
  emitSessionUpdate(input.runtime.turnInput, {
    updateType: 'tool_called',
    toolName: input.result.toolName,
    boundary: getToolBoundary(input.result.toolName),
    ok: true,
    resultSummary: input.result.message,
    provenance: input.result.provenance,
  });
  if (input.result.toolName === 'searchPromotions') {
    emitSessionUpdate(input.runtime.turnInput, {
      updateType: 'promotion_answered',
    });
  }
  if (
    input.result.toolName === 'answerAllergenQuestion' &&
    input.result.verifiedCollection?.result.items.length
  ) {
    emitSessionUpdate(input.runtime.turnInput, {
      updateType: 'content_evidence_found',
      kind: 'allergen',
    });
  }
  await input.runtime.turnInput.observeRun?.({ kind: 'verified_state' });
}
export async function verifiedApprovalStateRevision(
  state: AgentGraphState,
): Promise<string> {
  return stateRevision({
    cart: state.cart ?? null,
    fulfillment: state.fulfillment ?? null,
    orderPreview: state.orderPreview ?? null,
    order: state.order ?? null,
    paymentAttempt: state.paymentAttempt ?? null,
    selectedPaymentMethod: state.selectedPaymentMethod ?? null,
  });
}

export async function loadTurnState(
  input: AgentTurnInput,
  options: {
    currentUserTurnId?: string;
  } = {},
): Promise<LoadedAgentTurnState> {
  const responseProfile = resolveResponseProfile(input);
  let currentUserTurn = await loadOrAppendAgentCurrentUserTurn(
    input,
    responseProfile,
  );

  const prior = await loadPriorVerifiedState(input.store, input.sessionId);
  const allTurns = await input.store.listTurns(input.sessionId);
  let visibleTurns = allTurns;
  const exactCurrentTurnId = options.currentUserTurnId?.trim();
  if (exactCurrentTurnId) {
    const exactCurrentTurnIndex = allTurns.findIndex(
      (turn) => turn.id === exactCurrentTurnId,
    );
    const exactCurrentTurn = allTurns[exactCurrentTurnIndex];
    if (
      exactCurrentTurnIndex < 0 ||
      !exactCurrentTurn ||
      exactCurrentTurn.role !== 'user'
    ) {
      throw new Error('agent_current_user_turn_missing');
    }
    currentUserTurn = exactCurrentTurn;
    visibleTurns = allTurns.slice(0, exactCurrentTurnIndex + 1);
  } else if (!input.confirmationResume && !input.trustedCustomerAction) {
    if (!currentUserTurn || currentUserTurn.role !== 'user') {
      throw new Error('agent_current_user_turn_missing');
    }
    const currentTurnIndex = allTurns.findIndex(
      (turn) => turn.id === currentUserTurn?.id,
    );
    if (currentTurnIndex < 0) {
      throw new Error('agent_current_user_turn_missing');
    }
    visibleTurns = allTurns.slice(0, currentTurnIndex + 1);
  }
  const semanticTurns = semanticConversationTurns(visibleTurns);
  if (
    !currentUserTurn &&
    (input.confirmationResume || input.trustedCustomerAction)
  ) {
    currentUserTurn = semanticTurns
      .filter((turn) => turn.role === 'user')
      .at(-1);
  }
  return assembleLoadedTurnState({
    turnInput: input,
    prior,
    semanticTurns,
    currentUserTurn,
  });
}

export function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && toolNameSet.has(value);
}

export async function validateApprovalResume(
  runtime: SingleAgentRuntimeContext,
  action: ToolCallRequest,
): Promise<string> {
  const initialFailure = await runtimeDispatchFailure(runtime);
  if (initialFailure) throw new Error(initialFailure);
  const resume = runtime.turnInput.confirmationResume;
  const receipt = resume?.commerceReceipt;
  const fence = resume?.executionFence;
  if (!resume || !receipt || !fence || !resume.signingSecret) {
    throw new Error('authenticated_agent_approval_receipt_required');
  }
  const state = runtime.state;
  if (!state) throw new Error('agent_domain_state_missing');
  const binding = await buildCurrentAgentApprovalBinding(
    runtime.turnInput.clients,
    action,
    {
      ...toolExecutionContext(runtime.turnInput),
      approval: {
        principal: receipt.binding.principal,
        confirmationRequestId: resume.requestId,
        ...(resume.verifiedGuestAuthority
          ? {
              verifiedGuestAuthority:
                resume.verifiedGuestAuthority,
            }
          : {}),
      },
      externalCallContext: runtime.externalCallContext,
      state,
      cart: state.cart,
      address: state.address,
      order: state.order,
      orderPreview: state.orderPreview,
    },
  );
  if ('ok' in binding) {
    throw new Error('agent_approval_receipt_binding_mismatch');
  }
  const verified = await verifyCommerceApprovalReceipt({
    receipt,
    expectedBinding: binding,
    secret: resume.signingSecret,
  });
  const verifiedFence = verified.ok
    ? await verifyCommerceApprovalExecutionFence({
        fence,
        receipt: verified.receipt,
        binding,
        secret: resume.signingSecret,
      })
    : undefined;
  if (
    !verified.ok ||
    !verifiedFence ||
    receipt.receiptId !== resume.requestId ||
    resume.approved !== (receipt.decision === 'approve')
  ) {
    throw new Error('agent_approval_receipt_binding_mismatch');
  }
  const resultFailure = await runtimeDispatchFailure(runtime);
  if (resultFailure) throw new Error(resultFailure);
  return binding.actionDigest;
}
