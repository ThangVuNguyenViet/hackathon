import { ToolMessage } from '@langchain/core/messages';
import type { Runtime } from '@langchain/langgraph';
import {
  approvalExecutionMatchesPendingCall,
} from './agentApprovalRouting.js';
import {
  classifyToolExecutionFailure,
} from './agentBoundaryPolicy.js';
import {
  requiredDomainState,
} from './agentStateGraphContracts.js';
import type {
  KfcAgentStateUpdate,
  KfcAgentStateValue,
} from './agentStateSchema.js';
import {
  executePublicationToolBatch,
  publicationAuthority,
} from './agentPublicationRuntime.js';
import {
  executeAgentParallelReadBatch,
} from './agentParallelReadExecution.js';
import {
  parallelReadBatchEligibility,
} from './parallelReadBatch.js';
import {
  runtimeDispatchFailure,
  runtimeExternalCallFailure,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';
import {
  rehydrateExactTurnStateReadOnly,
} from './agentTurnStateHydration.js';
import {
  checkpointSafeApprovalFor,
} from './checkpointSafeApproval.js';

type AgentRuntime = Runtime<{ runtime?: SingleAgentRuntimeContext }>;

export type AgentRuntimeResolver = (
  state: KfcAgentStateValue,
  runtime: AgentRuntime,
) => Promise<SingleAgentRuntimeContext>;

export async function executeAgentToolNode(input: {
  state: KfcAgentStateValue;
  graphRuntime: AgentRuntime;
  resolveRuntime: AgentRuntimeResolver;
}): Promise<KfcAgentStateUpdate> {
  const { state } = input;
  const runtime = await input.resolveRuntime(state, input.graphRuntime);
  const cancellationFailure = await runtimeDispatchFailure(runtime);
  if (cancellationFailure) return { failure: cancellationFailure };
  if (!approvalExecutionMatchesPendingCall(
    state,
    runtime.turnInput.confirmationResume?.commerceReceipt,
  )) {
    return { failure: 'agent_approval_authority_unconfigured' };
  }
  try {
    const authority = publicationAuthority(state);
    runtime.validatedApprovalActionDigest =
      state.validatedApprovalActionDigest ?? undefined;
    const executionStart = state.graphExecutedToolResults.length;
    const receiptStart = state.toolEvidenceReceipts.length;
    const batchInput = {
      authority,
      runtime,
      state: requiredDomainState(state),
      calls: state.pendingToolCalls,
      currentTurnToolTrace: state.currentTurnToolTrace,
      executions: state.graphExecutedToolResults,
      evidence: state.currentTurnResponseEvidence,
      receipts: state.toolEvidenceReceipts,
    };
    const batch = parallelReadBatchEligibility(state.pendingToolCalls).ok
      ? await executeAgentParallelReadBatch(batchInput)
      : await executePublicationToolBatch(batchInput);
    const messages: ToolMessage[] = [];
    if (!state.structuredAction) {
      for (const [index, call] of state.pendingToolCalls.entries()) {
        const execution = batch.executions[executionStart + index];
        const receipt = batch.receipts[receiptStart + index];
        if (!execution || !receipt) {
          throw new Error('agent_publication_batch_result_missing');
        }
        messages.push(new ToolMessage({
          content: JSON.stringify(receipt),
          tool_call_id: call.id,
          name: call.toolName,
          status: execution.result.ok ? 'success' : 'error',
        }));
      }
    }
    const [nextCall, ...remainingCalls] = state.queuedToolCalls;
    const pendingToolCalls = nextCall ? [nextCall] : [];
    return {
      domainState: batch.state,
      currentTurnToolTrace: batch.currentTurnToolTrace,
      modelPublicationAuthority: authority,
      modelPublicationBundle: batch.bundle,
      graphExecutedToolResults: batch.executions,
      currentTurnResponseEvidence: batch.evidence,
      toolEvidenceReceipts: batch.receipts,
      messages,
      pendingToolCalls,
      queuedToolCalls: remainingCalls,
      checkpointSafeApproval:
        await checkpointSafeApprovalFor(runtime, pendingToolCalls),
      approvalDecision: null,
      validatedApprovalActionDigest: null,
      ...(batch.failed && state.structuredAction
        ? { failure: 'structured_action_tool_execution_failed' }
        : {}),
      validationError:
        batch.failed && !state.structuredAction
          ? 'tool_execution_failed'
          : null,
      ...(state.structuredAction && !batch.failed
        ? { structuredActionOutcome: 'tool_succeeded' as const }
        : {}),
      correctionMessagesNeeded: false,
    };
  } catch (error) {
    const failure =
      runtimeExternalCallFailure(runtime) ??
      classifyToolExecutionFailure(error);
    if (
      (failure === 'customer_run_cancelled' ||
        failure === 'agent_turn_deadline_exceeded') &&
      state.currentTurnId
    ) {
      try {
        const committed = await rehydrateExactTurnStateReadOnly(
          runtime.turnInput,
          state.currentTurnId,
        );
        runtime.state = committed.state;
        return {
          domainState: committed.state,
          currentTurnToolTrace:
            (committed.state.toolTrace ?? []).slice(
              state.turnToolTraceStartIndex,
            ),
          failure,
        };
      } catch {
        // Preserve the original cancellation/deadline classification. A
        // best-effort result rehydration must never replace the turn failure.
      }
    }
    return {
      failure,
    };
  }
}
