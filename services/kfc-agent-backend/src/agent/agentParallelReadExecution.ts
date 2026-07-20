import {
  buildVerifiedStateSnapshot,
  persistVerifiedStateSnapshot,
} from '../graph/verifiedState.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  verifiedStateSnapshotSourceType,
} from '../graph/turnSupport.js';
import type { AgentToolCallResult } from '../ordering/types.js';
import {
  issueGraphReadResultForPublication,
} from './graphExecutedToolResult.js';
import {
  buildCurrentTurnResponseEvidence,
  checkpointSafeToolEvidenceReceipt,
  type CurrentTurnResponseEvidence,
} from './modelPublicationProjection.js';
import {
  executeParallelReadBatch,
  projectParallelReadResultsInOrder,
  type DeepReadonly,
  type IndexedParallelReadResult,
} from './parallelReadBatch.js';
import {
  emitPortableCommerceReadResult,
  executePortableCommerceReadOnly,
  preflightPortableCommerceRead,
  projectPortableCommerceReadResult,
  runtimeDispatchFailure,
  type PendingToolCall,
} from './singleAgentRuntime.js';
import {
  isPrivateEvidenceToolName,
  privacySafeAgentToolCallIdentity,
  privacySafeAgentToolSpanFailure,
  privacySafeAgentToolSpanInputs,
  privacySafeAgentToolSpanOutputs,
} from './agentToolTracePrivacy.js';
import {
  bindCheckpointSafeToolEvidenceReceipt,
  rebuildPublicationBundle,
  type PublicationToolBatchResult,
} from './agentPublicationRuntime.js';
import type { ModelPublicationAuthority } from './modelPublicationAuthority.js';
import {
  validateModelPublicationAccessContext,
  validateModelPublicationAuthority,
} from './modelPublicationAuthority.js';
import type { GraphExecutedToolResult } from './graphExecutedToolResult.js';
import type { CheckpointSafeToolEvidenceReceipt } from './modelPublicationProjection.js';
import type { SingleAgentRuntimeContext } from './singleAgentRuntime.js';
import type { ToolTraceEntry } from '../ordering/types.js';

interface ReadProjection {
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}

function pendingCall(
  entry: Pick<
    IndexedParallelReadResult<AgentToolCallResult>,
    'id' | 'request'
  >,
): PendingToolCall {
  return {
    id: entry.id,
    toolName: entry.request.toolName,
    arguments: { ...entry.request.arguments },
  };
}

function executableSnapshot(
  snapshot: DeepReadonly<AgentGraphState>,
): AgentGraphState {
  // Eligibility guarantees provider reads, the only executor path that never
  // mutates context.state. The shared object remains recursively frozen.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return snapshot as AgentGraphState;
}

async function assertRuntimeActive(
  runtime: SingleAgentRuntimeContext,
): Promise<void> {
  const failure = await runtimeDispatchFailure(runtime);
  if (failure) throw new Error(failure);
}

async function assertPublicationAuthorityActive(input: {
  authority: ModelPublicationAuthority;
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
}): Promise<void> {
  if (
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
    throw new Error('agent_model_publication_authority_invalid');
  }
}

async function commitProjectedState(input: {
  authority: ModelPublicationAuthority;
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
}): Promise<void> {
  const guard = input.runtime.turnInput.runGuard;
  if (!guard) {
    await persistVerifiedStateSnapshot(
      input.runtime.turnInput.store,
      input.state,
    );
    return;
  }
  if (!guard.commitFence) {
    throw new Error('agent_run_commit_fence_missing');
  }
  const committed =
    await input.runtime.turnInput.store.appendEventIfRunCurrent({
      sessionId: input.state.sessionId,
      sourceType: verifiedStateSnapshotSourceType,
      payload: {
        verifiedState: buildVerifiedStateSnapshot(input.state),
      },
      fence: guard.commitFence,
      ...(input.authority.privateAccess.state === 'authenticated'
        ? {
            notAfter:
              input.authority.privateAccess.authenticationExpiresAt,
          }
        : input.authority.privateAccess.state === 'guest_checkout'
          ? {
              notAfter:
                input.authority.privateAccess.authorityExpiresAt,
            }
        : {}),
    });
  if (committed.status === 'committed') return;
  input.runtime.abortExternalCalls(new DOMException(
    'Customer run was superseded before commit',
    'AbortError',
  ));
  throw new Error('customer_run_cancelled');
}

async function executeObservedParallelReads(input: {
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  calls: readonly PendingToolCall[];
}): Promise<readonly IndexedParallelReadResult<AgentToolCallResult>[]> {
  const safeBatchCalls = await Promise.all(
    input.calls.map(async ({ id, toolName }, index) => ({
      index,
      toolName,
      ...await privacySafeAgentToolCallIdentity(toolName, id),
    })),
  );
  const batchSpan = await input.runtime.turnTrace.startSpan({
    name: 'agent_parallel_provider_reads',
    runType: 'chain',
    inputs: { calls: safeBatchCalls },
  });
  const childSpans = await Promise.all(
    input.calls.map(async (call, index) =>
      batchSpan.startSpan({
        name: 'agent_parallel_provider_read',
        runType: 'tool',
        inputs: {
          index,
          ...await privacySafeAgentToolCallIdentity(
            call.toolName,
            call.id,
          ),
          ...await privacySafeAgentToolSpanInputs({
            request: {
              toolName: call.toolName,
              arguments: { ...call.arguments },
            },
          }),
        },
      })),
  );
  try {
    const results = await executeParallelReadBatch<
      AgentGraphState,
      AgentToolCallResult
    >({
      calls: input.calls,
      stateSnapshot: input.state,
      externalCallContext: input.runtime.externalCallContext,
      execute: async (entry) => {
        const childSpan = childSpans[entry.index];
        if (!childSpan) {
          throw new Error('agent_parallel_read_span_missing');
        }
        try {
          const result = await executePortableCommerceReadOnly({
            runtime: input.runtime,
            stateSnapshot: executableSnapshot(entry.stateSnapshot),
            call: {
              id: entry.id,
              toolName: entry.request.toolName,
              arguments: { ...entry.request.arguments },
            },
            externalCallContext: entry.externalCallContext,
          });
          const safeOutputs =
            await privacySafeAgentToolSpanOutputs({
              result,
              auditArguments: { ...entry.request.arguments },
            });
          await childSpan.end({
            index: entry.index,
            ...await privacySafeAgentToolCallIdentity(
              result.toolName,
              entry.id,
            ),
            toolName: result.toolName,
            executionOutcome: result.ok ? 'success' : 'error',
            ...(isPrivateEvidenceToolName(result.toolName)
              ? safeOutputs
              : !result.ok
              ? {
                  errorCode:
                    result.errorCode ?? 'tool_execution_failed',
                }
              : {}),
          });
          return result;
        } catch (error) {
          await childSpan.fail(privacySafeAgentToolSpanFailure(
            entry.request.toolName,
            error,
          ));
          throw error;
        }
      },
    });
    const outcomes = await Promise.all(results.map(async (entry) => ({
      index: entry.index,
      ...await privacySafeAgentToolCallIdentity(
        entry.result.toolName,
        entry.id,
      ),
      toolName: entry.result.toolName,
      executionOutcome: entry.result.ok ? 'success' : 'error',
      ...(isPrivateEvidenceToolName(entry.result.toolName)
        ? await privacySafeAgentToolSpanOutputs({
            result: entry.result,
            auditArguments: { ...entry.request.arguments },
          })
        : !entry.result.ok
          ? {
              errorCode:
                entry.result.errorCode ?? 'tool_execution_failed',
            }
          : {}),
    })));
    await batchSpan.end({ outcomes });
    return results;
  } catch (error) {
    const privateCall = input.calls.find(({ toolName }) =>
      isPrivateEvidenceToolName(toolName));
    await batchSpan.fail(
      privateCall
        ? new Error('private_tool_batch_failed')
        : error,
    );
    throw error;
  }
}

export async function executeAgentParallelReadBatch(input: {
  authority: ModelPublicationAuthority;
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  calls: readonly PendingToolCall[];
  currentTurnToolTrace: readonly ToolTraceEntry[];
  executions: readonly GraphExecutedToolResult[];
  evidence: readonly CurrentTurnResponseEvidence[];
  receipts: readonly CheckpointSafeToolEvidenceReceipt[];
}): Promise<PublicationToolBatchResult> {
  const calls: PendingToolCall[] = [];
  for (const call of input.calls) {
    calls.push(await preflightPortableCommerceRead({
      runtime: input.runtime,
      call,
    }));
  }
  await assertRuntimeActive(input.runtime);
  if (
    input.runtime.turnInput.runGuard &&
    !input.runtime.turnInput.runGuard.commitFence
  ) {
    throw new Error('agent_run_commit_fence_missing');
  }
  const rawResults = await executeObservedParallelReads({
    runtime: input.runtime,
    state: input.state,
    calls,
  });
  const projected = await projectParallelReadResultsInOrder<
    AgentToolCallResult,
    ReadProjection
  >({
    results: rawResults,
    initialAccumulator: {
      state: input.state,
      currentTurnToolTrace: [...input.currentTurnToolTrace],
    },
    externalCallContext: input.runtime.externalCallContext,
    assertActive: () => assertRuntimeActive(input.runtime),
    project: (draft, entry) => {
      projectPortableCommerceReadResult({
        turnInput: input.runtime.turnInput,
        state: draft.state,
        call: pendingCall(entry),
        result: entry.result,
        currentTurnToolTrace: draft.currentTurnToolTrace,
      });
    },
  });

  await assertRuntimeActive(input.runtime);
  const previousRuntimeState = input.runtime.state;
  input.runtime.state = projected.state;
  try {
    const executions = [...input.executions];
    const evidence = [...input.evidence];
    const receipts = [...input.receipts];
    const currentTurnTraceStart =
      projected.currentTurnToolTrace.length - rawResults.length;
    const durableTraceStart =
      (projected.state.toolTrace?.length ?? 0) - rawResults.length;
    for (const entry of rawResults) {
      const execution = await issueGraphReadResultForPublication({
        authority: input.authority,
        runtime: input.runtime,
        state: projected.state,
        call: pendingCall(entry),
        result: entry.result,
      });
      const currentEvidence = await buildCurrentTurnResponseEvidence({
        authority: input.authority,
        execution,
      });
      if (!currentEvidence) {
        throw new Error('agent_tool_publication_evidence_missing');
      }
      const receipt =
        checkpointSafeToolEvidenceReceipt(currentEvidence);
      await bindCheckpointSafeToolEvidenceReceipt({
        authority: input.authority,
        state: projected.state,
        currentTurnToolTrace: projected.currentTurnToolTrace,
        currentTurnTraceIndex: currentTurnTraceStart + entry.index,
        traceIndex: durableTraceStart + entry.index,
        evidence: currentEvidence,
        receipt,
      });
      executions.push(execution);
      evidence.push(currentEvidence);
      receipts.push(receipt);
    }
    const bundle = await rebuildPublicationBundle({
      state: projected.state,
      authority: input.authority,
      evidence,
    });
    await assertRuntimeActive(input.runtime);
    await assertPublicationAuthorityActive({
      authority: input.authority,
      runtime: input.runtime,
      state: projected.state,
    });
    await commitProjectedState({
      authority: input.authority,
      runtime: input.runtime,
      state: projected.state,
    });

    // Customer-safe progress is post-commit observability. A telemetry sink
    // cannot roll back or reinterpret the already committed verified state.
    for (const entry of rawResults) {
      try {
        await emitPortableCommerceReadResult({
          runtime: input.runtime,
          result: entry.result,
        });
      } catch {
        // The durable graph event is the source of truth; telemetry is
        // intentionally best-effort until a transactional outbox owns it.
      }
    }
    return {
      state: projected.state,
      currentTurnToolTrace: projected.currentTurnToolTrace,
      executions,
      evidence,
      receipts,
      bundle,
      failed: rawResults.some(({ result }) => !result.ok),
    };
  } catch (error) {
    input.runtime.state = previousRuntimeState;
    throw error;
  }
}
