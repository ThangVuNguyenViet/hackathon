import { isDeepStrictEqual } from 'node:util';
import type { AgentGraphState } from '../graph/state.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import {
  agentToolCallDisposition,
  type AgentToolCallEffect,
} from '../ordering/toolCallDisposition.js';
import type { ToolName, ToolTraceEntry } from '../ordering/types.js';
import { executeAgentParallelReadBatch } from './agentParallelReadExecution.js';
import {
  executePublicationToolBatch,
  type PublicationToolBatchResult,
} from './agentPublicationRuntime.js';
import type { GraphExecutedToolResult } from './graphExecutedToolResult.js';
import type { ModelPublicationAuthority } from './modelPublicationAuthority.js';
import type {
  CheckpointSafeToolEvidenceReceipt,
  CurrentTurnResponseEvidence,
  ModelPublicationBundle,
} from './modelPublicationProjection.js';
import { parallelReadBatchEligibility } from './parallelReadBatch.js';
import {
  canonicalToolCallSignature,
  classifyToolCallSignature,
  recordSuccessfulToolCall,
  relevantToolState,
} from './agentToolCallLedger.js';
import type { KfcCreateAgentRuntime } from './kfcCreateAgentRuntime.js';
import type {
  PendingToolCall,
  SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

export interface KfcCreateAgentCoordinatedToolResult {
  receipt: CheckpointSafeToolEvidenceReceipt;
  ok: boolean;
}

export interface KfcAcceptedToolCall extends PendingToolCall {
  signatureDigest: string;
  effect: AgentToolCallEffect;
  handling:
    | { kind: 'execute' }
    | {
        kind: 'cached';
        receipt: CheckpointSafeToolEvidenceReceipt;
      };
}

export interface KfcCreateAgentToolCoordinator {
  acceptBatch(calls: readonly KfcAcceptedToolCall[]): void;
  execute(call: PendingToolCall): Promise<KfcCreateAgentCoordinatedToolResult>;
  snapshot(): PublicationToolBatchResult;
}

interface ToolWaiter {
  resolve(value: KfcCreateAgentCoordinatedToolResult): void;
  reject(error: unknown): void;
}

interface AcceptedBatch {
  calls: KfcAcceptedToolCall[];
  arrivals: Map<string, ToolWaiter>;
  running: boolean;
}

export interface KfcCreateAgentToolCoordinatorInput {
  authority: ModelPublicationAuthority;
  runtime: SingleAgentRuntimeContext;
  createAgentRuntime: KfcCreateAgentRuntime;
  state: AgentGraphState;
  currentTurnToolTrace: readonly ToolTraceEntry[];
  executions: readonly GraphExecutedToolResult[];
  evidence: readonly CurrentTurnResponseEvidence[];
  receipts: readonly CheckpointSafeToolEvidenceReceipt[];
  bundle: ModelPublicationBundle;
  resolveActiveToolNames?(
    projection: PublicationToolBatchResult,
  ): readonly ToolName[];
  executeParallel?: typeof executeAgentParallelReadBatch;
  executeSequential?: typeof executePublicationToolBatch;
}

function plainCall(call: PendingToolCall): PendingToolCall {
  return {
    id: call.id,
    toolName: call.toolName,
    arguments: structuredClone(call.arguments),
  };
}

function cloneAcceptedCall(call: KfcAcceptedToolCall): KfcAcceptedToolCall {
  return {
    ...plainCall(call),
    signatureDigest: call.signatureDigest,
    effect: call.effect,
    handling: structuredClone(call.handling),
  };
}

function isAcceptedToolCall(
  call: PendingToolCall,
): call is KfcAcceptedToolCall {
  return (
    'signatureDigest' in call &&
    typeof call.signatureDigest === 'string' &&
    'effect' in call &&
    (call.effect === 'provider_read' ||
      call.effect === 'reversible_mutation' ||
      call.effect === 'irreversible_mutation') &&
    'handling' in call &&
    typeof call.handling === 'object' &&
    call.handling !== null &&
    'kind' in call.handling &&
    (call.handling.kind === 'execute' || call.handling.kind === 'cached')
  );
}

function validateAcceptedCalls(calls: readonly KfcAcceptedToolCall[]): void {
  const ids = new Set<string>();
  if (
    calls.length === 0 ||
    calls.some(
      ({ id, signatureDigest, handling }) =>
        !id ||
        ids.has(id) ||
        !ids.add(id) ||
        !/^[0-9a-f]{64}$/u.test(signatureDigest) ||
        (handling.kind === 'cached' && calls.length !== 1),
    )
  ) {
    throw new Error('kfc_create_agent_tool_batch_invalid');
  }
}

export function createKfcCreateAgentToolCoordinator(
  input: KfcCreateAgentToolCoordinatorInput,
): KfcCreateAgentToolCoordinator {
  const executeParallel =
    input.executeParallel ?? executeAgentParallelReadBatch;
  const executeSequential =
    input.executeSequential ?? executePublicationToolBatch;
  let projection: PublicationToolBatchResult = {
    state: structuredClone(input.state),
    currentTurnToolTrace: [...input.currentTurnToolTrace],
    executions: [...input.executions],
    evidence: [...input.evidence],
    receipts: [...input.receipts],
    bundle: input.bundle,
    failed: false,
  };
  let accepted: AcceptedBatch | null = null;

  const reconstructApprovedResumeCall = async (
    call: PendingToolCall,
  ): Promise<KfcAcceptedToolCall | null> => {
    const resume = input.runtime.turnInput.confirmationResume;
    const action = resume?.action;
    if (
      !resume?.approved ||
      !action ||
      !input.resolveActiveToolNames ||
      action.toolName !== call.toolName ||
      !isDeepStrictEqual(action.arguments, call.arguments)
    ) {
      return null;
    }
    const disposition = agentToolCallDisposition(call.toolName, call.arguments);
    if (
      !disposition.success ||
      disposition.data.effect !== 'irreversible_mutation'
    ) {
      return null;
    }
    const activeToolNames = input.resolveActiveToolNames(projection);
    if (!activeToolNames.includes(disposition.data.toolName)) return null;
    const signatureDigest = await canonicalToolCallSignature({
      sessionId: projection.state.sessionId,
      customerId: projection.state.customerId,
      channel: projection.state.channel,
      toolName: disposition.data.toolName,
      arguments: disposition.data.arguments,
      activeToolNames,
      relevantState: relevantToolState(
        disposition.data.toolName,
        projection.state,
      ),
    });
    const handling = classifyToolCallSignature({
      entries: input.createAgentRuntime.toolCallLedger,
      signatureDigest,
      toolName: disposition.data.toolName,
      effect: disposition.data.effect,
    });
    if (handling.kind === 'no_progress') return null;
    return {
      id: call.id,
      toolName: disposition.data.toolName,
      arguments: disposition.data.arguments,
      signatureDigest,
      effect: disposition.data.effect,
      handling,
    };
  };

  const executeAcceptedBatch = async (batch: AcceptedBatch): Promise<void> => {
    const executionStart = projection.executions.length;
    const receiptStart = projection.receipts.length;
    const calls = batch.calls.map(plainCall);
    const classification = parallelReadBatchEligibility(calls).ok
      ? 'parallel'
      : 'sequential';
    let batchSpan: AgentTraceSpan | null = null;
    try {
      batchSpan = await input.runtime.turnTrace.startSpan({
        name: 'agent_coordinated_tool_batch',
        runType: 'chain',
        inputs: {
          stage: 'coordinated_tool_batch',
          toolCallCount: calls.length,
          classification,
        },
        metadata: {},
        tags: ['agent-tool-batch'],
      });
    } catch {
      // Diagnostics are best-effort and never control tool execution.
    }
    try {
      const cached = batch.calls[0]?.handling;
      if (batch.calls.length === 1 && cached?.kind === 'cached') {
        const call = batch.calls[0]!;
        const waiter = batch.arrivals.get(call.id);
        if (!waiter) {
          throw new Error('kfc_create_agent_tool_batch_result_invalid');
        }
        waiter.resolve({ receipt: cached.receipt, ok: true });
        await batchSpan?.end({
          stage: 'coordinated_tool_batch',
          toolCallCount: 1,
          classification: 'cached',
          failed: false,
        });
        return;
      }

      const executeBatch =
        classification === 'parallel' ? executeParallel : executeSequential;
      const result = await executeBatch({
        authority: input.authority,
        runtime: input.runtime,
        state: structuredClone(projection.state),
        calls,
        currentTurnToolTrace: projection.currentTurnToolTrace,
        executions: projection.executions,
        evidence: projection.evidence,
        receipts: projection.receipts,
      });
      const completed = batch.calls.map((call, index) => {
        const execution = result.executions[executionStart + index];
        const receipt = result.receipts[receiptStart + index];
        const waiter = batch.arrivals.get(call.id);
        if (
          !execution ||
          !receipt ||
          !waiter ||
          execution.toolCallId !== call.id ||
          execution.result.toolName !== call.toolName ||
          receipt.toolCallId !== call.id ||
          receipt.toolName !== call.toolName
        ) {
          throw new Error('kfc_create_agent_tool_batch_result_invalid');
        }
        return { call, execution, receipt, waiter };
      });
      projection = result;
      for (const { call, execution, receipt, waiter } of completed) {
        if (execution.result.ok && receipt.executionOutcome === 'success') {
          const ledgerReceipt =
            call.effect === 'provider_read' ? null : receipt;
          input.createAgentRuntime.toolCallLedger = recordSuccessfulToolCall(
            input.createAgentRuntime.toolCallLedger,
            {
              signatureDigest: call.signatureDigest,
              toolName: call.toolName,
              effect: call.effect,
              receipt: ledgerReceipt,
            },
          );
          if (ledgerReceipt && input.resolveActiveToolNames) {
            const postSignatureDigest = await canonicalToolCallSignature({
              sessionId: input.authority.sessionId,
              customerId: input.authority.customerId,
              channel: input.authority.channel,
              toolName: call.toolName,
              arguments: call.arguments,
              activeToolNames: input.resolveActiveToolNames(result),
              relevantState: relevantToolState(call.toolName, result.state),
            });
            input.createAgentRuntime.toolCallLedger = recordSuccessfulToolCall(
              input.createAgentRuntime.toolCallLedger,
              {
                signatureDigest: postSignatureDigest,
                toolName: call.toolName,
                effect: call.effect,
                receipt: ledgerReceipt,
              },
            );
          }
        }
        waiter.resolve({ receipt, ok: execution.result.ok });
      }
      await batchSpan?.end({
        stage: 'coordinated_tool_batch',
        toolCallCount: calls.length,
        classification,
        failed: result.failed,
      });
    } catch (error) {
      await batchSpan?.fail(error);
      for (const waiter of batch.arrivals.values()) waiter.reject(error);
    } finally {
      if (accepted === batch) accepted = null;
    }
  };

  return {
    acceptBatch(calls) {
      if (accepted) {
        throw new Error('kfc_create_agent_tool_batch_in_progress');
      }
      validateAcceptedCalls(calls);
      accepted = {
        calls: calls.map(cloneAcceptedCall),
        arrivals: new Map(),
        running: false,
      };
    },
    async execute(call) {
      if (!accepted) {
        const acceptedCall = isAcceptedToolCall(call)
          ? call
          : await reconstructApprovedResumeCall(call);
        if (!acceptedCall) {
          throw new Error('kfc_create_agent_tool_call_binding_missing');
        }
        validateAcceptedCalls([acceptedCall]);
        accepted = {
          calls: [cloneAcceptedCall(acceptedCall)],
          arrivals: new Map(),
          running: false,
        };
      }
      const batch = accepted;
      const expected = batch.calls.find(({ id }) => id === call.id);
      if (
        !expected ||
        expected.toolName !== call.toolName ||
        !isDeepStrictEqual(expected.arguments, call.arguments) ||
        batch.arrivals.has(call.id)
      ) {
        throw new Error('kfc_create_agent_tool_call_mismatch');
      }
      const result = new Promise<KfcCreateAgentCoordinatedToolResult>(
        (resolve, reject) => {
          batch.arrivals.set(call.id, { resolve, reject });
        },
      );
      if (!batch.running && batch.arrivals.size === batch.calls.length) {
        batch.running = true;
        void executeAcceptedBatch(batch);
      }
      return result;
    },
    snapshot() {
      return projection;
    },
  };
}
