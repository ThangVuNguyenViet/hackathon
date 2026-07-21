import { Command } from '@langchain/langgraph';
import type {
  AgentTurnInput,
  AgentTurnOutput,
} from '../graph/agentTurnState.js';
import {
  isRunStillCurrent,
  toolExecutionContext,
  traceStateSummary,
} from '../graph/turnSupport.js';
import {
  digestCommerceAction,
  commerceApprovalReceiptSchema,
} from '../ordering/approvalReceipt.js';
import {
  commerceApprovalExecutionFenceSchema,
} from '../ordering/approvalExecutionFence.js';
import {
  buildCurrentAgentApprovalBinding,
} from '../ordering/agentToolExecutor.js';
import type {
  CommerceApprovalPrincipal,
  ToolCallRequest,
} from '../ordering/types.js';
import {
  authenticatedCommerceApprovalPrincipal,
  guestCheckoutCommerceApprovalPrincipal,
  isGuestCheckoutPrincipal,
} from '../ordering/commerceApprovalPrincipal.js';
import {
  authorizeGuestCheckout,
} from '../security/guestCheckoutAuthority.js';
import { buildChannelPresentation } from '../presentation/channelPresentation.js';
import {
  persistVerifiedStateSnapshot,
} from '../graph/verifiedState.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import type { CreateConfirmationPauseInput } from '../persistence/contracts.js';
import {
  agentCheckpointThreadBelongsToSession,
  agentCheckpointThreadId,
} from '../session/sessionContext.js';
import type {
  KfcAgentStateGraph,
  KfcAgentStateGraphUpdate,
} from './agentStateGraph.js';
import {
  verifiedGuestApprovalAuthorityMatchesPrincipal,
} from '../api/confirmationApprovalCapability.js';
import {
  createAgentTurnExternalCallScope,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';
import { providerFailureReportCode } from './agentModelInvocation.js';
import {
  checkpointSafeApprovalMatchesCall,
  parseCheckpointSafeApprovalInterrupt,
  type CheckpointSafeApproval,
} from './checkpointSafeApproval.js';

const confirmationPauseTtlMs = 10 * 60_000;

interface AgentCheckpoint {
  threadId: string;
  namespace: string;
}

interface AgentCheckpointConfig {
  configurable: {
    thread_id: string;
    checkpoint_ns?: string;
    checkpoint_id?: string;
  };
}

interface AgentStateGraphTurnInput {
  graph: KfcAgentStateGraph;
  turnInput: AgentTurnInput;
  turnTrace: AgentTraceSpan;
  checkpoint: AgentCheckpoint;
}

function approvalActionFromInterruptions(
  interruptions: ReadonlyArray<{ value?: unknown }>,
): CheckpointSafeApproval {
  if (interruptions.length !== 1) {
    throw new Error('agent_approval_interrupt_invalid');
  }
  return parseCheckpointSafeApprovalInterrupt(interruptions[0]?.value);
}

export { agentCheckpointThreadId };

export function agentCheckpointConfigForTurn(input: {
  checkpoint: AgentCheckpoint;
  confirmationResume?: AgentTurnInput['confirmationResume'];
}): AgentCheckpointConfig {
  const resumeCheckpoint = input.confirmationResume?.checkpoint;
  if (input.confirmationResume) {
    if (
      !resumeCheckpoint ||
      !resumeCheckpoint.threadId.trim() ||
      !resumeCheckpoint.checkpointId.trim()
    ) {
      throw new Error('agent_confirmation_checkpoint_required');
    }
    if (
      resumeCheckpoint.namespace !== '' ||
      !agentCheckpointThreadBelongsToSession(
        resumeCheckpoint.threadId,
        input.checkpoint.threadId,
      )
    ) {
      throw new Error('agent_confirmation_checkpoint_mismatch');
    }
    const executionFence =
      input.confirmationResume.executionFence;
    if (
      executionFence &&
      (
        executionFence.checkpointThreadId !==
          resumeCheckpoint.threadId ||
        executionFence.checkpointNamespace !==
          resumeCheckpoint.namespace ||
        executionFence.checkpointId !==
          resumeCheckpoint.checkpointId
      )
    ) {
      throw new Error('agent_confirmation_checkpoint_mismatch');
    }
    return {
      configurable: {
        thread_id: resumeCheckpoint.threadId,
        checkpoint_ns: resumeCheckpoint.namespace,
        checkpoint_id: resumeCheckpoint.checkpointId,
      },
    };
  }
  const expectedThreadId = agentCheckpointThreadId(input.checkpoint);
  return {
    configurable: {
      // checkpoint_ns is reserved for LangGraph subgraphs and is not an
      // independent top-level run key. Encode the request namespace into the
      // thread identity so concurrent turns cannot overwrite one another.
      thread_id: expectedThreadId,
    },
  };
}

async function approvalPrincipal(
  input: AgentTurnInput,
  action: ToolCallRequest,
): Promise<CommerceApprovalPrincipal> {
  const access = input.accessContext;
  const evidence = access?.authenticationEvidence;
  if (
    access?.authenticationState === 'authenticated' &&
    evidence?.state === 'verified' &&
    access.kfcSubjectRef
  ) {
    return authenticatedCommerceApprovalPrincipal({
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
      authenticatedSubject: access.kfcSubjectRef,
      authenticationEvidenceRef: evidence.evidenceRef,
    });
  }
  const guestDecision = authorizeGuestCheckout(
    input.guestCheckoutAuthority,
    {
      channel: input.channel,
      sessionId: input.sessionId,
      customerId: input.customerId,
      externalMessageId: input.externalMessageId,
      surfaceSubjectRef: input.customerId,
      runFence: input.runGuard?.commitFence,
      confirmationResume: input.confirmationResume !== undefined,
    },
  );
  if (
    guestDecision.allowed &&
    input.guestCheckoutAuthority
  ) {
    return guestCheckoutCommerceApprovalPrincipal(
      input.guestCheckoutAuthority,
    );
  }
  const resume = input.confirmationResume;
  const verified = resume?.verifiedGuestAuthority;
  const verifiedPrincipal = verified?.principal;
  const sessionAuthorityGeneration =
    input.runGuard?.commitFence?.sessionAuthorityGeneration;
  if (
    resume &&
    resume.checkpoint &&
    verified &&
    verifiedPrincipal &&
    sessionAuthorityGeneration !== undefined &&
    verifiedPrincipal.principalKind === 'guest_checkout' &&
    resume.requestId === verified.requestId &&
    verified.toolName === 'placeOrder' &&
    action.toolName === 'createPaymentLink' &&
    Date.parse(verifiedPrincipal.expiresAt) > Date.now() &&
    await verifiedGuestApprovalAuthorityMatchesPrincipal(
      verified,
      {
        principal: verifiedPrincipal,
        sessionId: input.sessionId,
        customerId: input.customerId,
        channel: input.channel,
        sessionGeneration: sessionAuthorityGeneration,
        checkpointThreadId: resume.checkpoint.threadId,
        checkpointNamespace: resume.checkpoint.namespace,
      },
    )
  ) {
    return verifiedPrincipal;
  }
  if (!guestDecision.allowed) {
    throw new Error(
      input.guestCheckoutAuthority
        ? guestDecision.errorCode
        : 'agent_approval_authenticated_principal_missing',
    );
  }
  throw new Error('agent_guest_checkout_authority_missing');
}

async function canonicalConfirmationRecord(input: {
  turnInput: AgentTurnInput;
  runtime: SingleAgentRuntimeContext;
  graphState: NonNullable<KfcAgentStateGraphUpdate['domainState']>;
  checkpointThreadId: string;
  requestId: string;
  action: ToolCallRequest;
}): Promise<CreateConfirmationPauseInput> {
  const principal = await approvalPrincipal(
    input.turnInput,
    input.action,
  );
  const approvalBinding = await buildCurrentAgentApprovalBinding(
    input.turnInput.clients,
    input.action,
    {
      ...toolExecutionContext(input.turnInput),
      approval: {
        principal,
        ...(input.turnInput.confirmationResume
          ?.verifiedGuestAuthority
          ? {
              confirmationRequestId:
                input.turnInput.confirmationResume.requestId,
              verifiedGuestAuthority:
                input.turnInput.confirmationResume
                  .verifiedGuestAuthority,
            }
          : {}),
      },
      externalCallContext: input.runtime.externalCallContext,
      state: input.graphState,
      cart: input.graphState.cart,
      address: input.graphState.address,
      order: input.graphState.order,
      orderPreview: input.graphState.orderPreview,
    },
  );
  if ('ok' in approvalBinding) {
    throw new Error(
      `agent_approval_binding_failed:${
        approvalBinding.errorCode ?? 'unknown'
      }`,
    );
  }
  if (!(await isRunStillCurrent(input.turnInput))) {
    input.runtime.abortExternalCalls(new DOMException(
      'Customer run was cancelled',
      'AbortError',
    ));
    throw new Error('customer_run_cancelled');
  }

  const checkpointTuple = await input.turnInput.checkpointer?.getTuple({
    configurable: {
      thread_id: input.checkpointThreadId,
      checkpoint_ns: '',
    },
  });
  const checkpointId = checkpointTuple?.checkpoint.id;
  const storedConfig = checkpointTuple?.config.configurable;
  if (
    !checkpointId ||
    storedConfig?.thread_id !== input.checkpointThreadId ||
    (storedConfig.checkpoint_ns ?? '') !== '' ||
    storedConfig.checkpoint_id !== checkpointId
  ) {
    throw new Error('agent_approval_checkpoint_missing');
  }
  const exactCheckpointTuple = await input.turnInput.checkpointer?.getTuple({
    configurable: {
      thread_id: input.checkpointThreadId,
      checkpoint_ns: '',
      checkpoint_id: checkpointId,
    },
  });
  const exactStoredConfig = exactCheckpointTuple?.config.configurable;
  if (
    exactCheckpointTuple?.checkpoint.id !== checkpointId ||
    exactStoredConfig?.thread_id !== input.checkpointThreadId ||
    (exactStoredConfig.checkpoint_ns ?? '') !== '' ||
    exactStoredConfig.checkpoint_id !== checkpointId
  ) {
    throw new Error('agent_approval_checkpoint_missing');
  }

  const createdAt = new Date();
  const evidence =
    input.turnInput.accessContext?.authenticationEvidence;
  const principalExpiry = isGuestCheckoutPrincipal(principal)
    ? Date.parse(principal.expiresAt)
    : evidence?.state === 'verified'
      ? Date.parse(evidence.expiresAt)
      : Number.NaN;
  const expiresAt = Math.min(
    createdAt.getTime() + confirmationPauseTtlMs,
    principalExpiry,
  );
  if (!Number.isFinite(expiresAt) || expiresAt <= createdAt.getTime()) {
    throw new Error('agent_approval_authentication_expired');
  }
  const actionDigest = await digestCommerceAction(input.action);
  return {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: input.requestId,
    checkpointThreadId: input.checkpointThreadId,
    checkpointNamespace: '',
    checkpointId,
    sessionId: input.turnInput.sessionId,
    customerId: input.turnInput.customerId,
    channel: input.turnInput.channel,
    action: input.action,
    actionDigest,
    approvalBinding,
    approvalBindingDigest:
      await digestCommerceAction(approvalBinding),
    principal,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function pauseWithCanonicalRecord(
  record: CreateConfirmationPauseInput,
): NonNullable<AgentTurnOutput['pause']> {
  const pause: NonNullable<AgentTurnOutput['pause']> = {
    capability: record.action.toolName,
    requestId: record.requestId,
    action: record.action,
  };
  Object.defineProperty(pause, 'confirmationRecord', {
    configurable: false,
    enumerable: false,
    value: record,
    writable: false,
  });
  return pause;
}

function externalCallScopeForTurn(
  input: AgentTurnInput,
): ReturnType<typeof createAgentTurnExternalCallScope> {
  const resume = input.confirmationResume;
  if (!resume) {
    return createAgentTurnExternalCallScope(input.turnDeadlineMs);
  }
  const receipt = commerceApprovalReceiptSchema.safeParse(
    resume.commerceReceipt,
  );
  const fence = commerceApprovalExecutionFenceSchema.safeParse(
    resume.executionFence,
  );
  const context = resume.externalCallContext;
  if (
    !receipt.success ||
    !fence.success ||
    !context ||
    !Object.isFrozen(context) ||
    typeof resume.abortExternalCalls !== 'function' ||
    resume.signingSecret === undefined
  ) {
    throw new Error('agent_confirmation_resume_authority_required');
  }
  if (
    receipt.data.receiptId !== resume.requestId ||
    fence.data.requestId !== resume.requestId ||
    resume.approved !== (receipt.data.decision === 'approve')
  ) {
    throw new Error('agent_confirmation_resume_authority_mismatch');
  }
  if (
    context.signal.aborted ||
    !Number.isFinite(context.deadlineAt) ||
    context.deadlineAt <= Date.now()
  ) {
    throw new Error('agent_turn_deadline_exceeded');
  }
  return {
    context,
    abort: resume.abortExternalCalls,
    // The coordinator owns the timer and disposes it only after durable
    // completion/unknown handling. The nested graph runner must not clear it.
    dispose: () => undefined,
  };
}

async function persistApprovalPauseState(input: {
  turnInput: AgentTurnInput;
  state: NonNullable<KfcAgentStateGraphUpdate['domainState']>;
}): Promise<void> {
  const { runGuard } = input.turnInput;
  if (!runGuard) {
    await persistVerifiedStateSnapshot(
      input.turnInput.store,
      input.state,
    );
    return;
  }
  if (!runGuard.commitFence) {
    throw new Error('agent_run_commit_fence_missing');
  }
  // The route-level canonical pause boundary atomically commits this state
  // with the private pause record and its bounded audit event.
}

export async function runKfcAgentStateGraphTurn(
  input: AgentStateGraphTurnInput,
): Promise<AgentTurnOutput> {
  const externalCallScope = externalCallScopeForTurn(input.turnInput);
  const runtime: SingleAgentRuntimeContext = {
    turnInput: input.turnInput,
    turnTrace: input.turnTrace,
    externalCallContext: externalCallScope.context,
    abortExternalCalls: externalCallScope.abort,
    // The runner owns the complete graph + checkpoint + pause-binding
    // deadline. Graph nodes may signal local completion, but only this
    // function's finally block may clear the shared timer.
    disposeExternalCalls: () => undefined,
  };
  try {
    if (!(await isRunStillCurrent(input.turnInput))) {
      externalCallScope.abort(new DOMException(
        'Customer run was cancelled',
        'AbortError',
      ));
      throw new Error('customer_run_cancelled');
    }

    const checkpointConfig = agentCheckpointConfigForTurn({
      checkpoint: input.checkpoint,
      confirmationResume: input.turnInput.confirmationResume,
    });
    const checkpointThreadId =
      checkpointConfig.configurable.thread_id;
    const agentConfig = {
      ...checkpointConfig,
      context: { runtime },
      recursionLimit: 64,
    };
    const invocation = input.turnInput.confirmationResume
      ? new Command<unknown, KfcAgentStateGraphUpdate, never>({
        resume: { requestId: input.turnInput.confirmationResume.requestId },
        update: {
          turnDeadlineAt: externalCallScope.context.deadlineAt,
        },
      })
      : {
        sessionId: input.turnInput.sessionId,
        customerId: input.turnInput.customerId,
        channel: input.turnInput.channel,
        externalMessageId: input.turnInput.externalMessageId ?? null,
      };
    const result = await input.graph.invoke(invocation, {
      ...agentConfig,
      // Disable LangGraph/LangChain's implicit tracing. Its generic runtime
      // serialization includes the injected turn context, which intentionally
      // holds transient customer prose. Privacy-safe explicit agent spans are
      // emitted through turnTrace instead.
      callbacks: [],
    });

    const graphResult = result as typeof result & {
      __interrupt__?: ReadonlyArray<{ value?: unknown }>;
    };
    const interruptions = graphResult.__interrupt__ ?? [];
    const graphState = graphResult.domainState;
    if (!graphState) throw new Error('agent_domain_state_missing');
    if (interruptions.length > 0) {
      const approval = approvalActionFromInterruptions(interruptions);
      const pendingToolCalls = graphResult.pendingToolCalls ?? [];
      const actionRequest = pendingToolCalls[0];
      if (
        pendingToolCalls.length !== 1 ||
        !actionRequest ||
        graphResult.checkpointSafeApproval?.requestId !==
          approval.requestId ||
        graphResult.checkpointSafeApproval?.actionDigest !==
          approval.actionDigest ||
        !(await checkpointSafeApprovalMatchesCall({
          approval,
          call: actionRequest,
        }))
      ) {
        throw new Error('agent_approval_interrupt_invalid');
      }
      const actionName = actionRequest.toolName;
      const requestId = approval.requestId;
      if (!requestId) {
        throw new Error('agent_approval_request_id_missing');
      }
      const confirmationRecord = await canonicalConfirmationRecord({
        turnInput: input.turnInput,
        runtime,
        graphState,
        checkpointThreadId,
        requestId,
        action: {
          toolName: actionRequest.toolName,
          arguments: actionRequest.arguments,
        },
      });
      await persistApprovalPauseState({
        turnInput: input.turnInput,
        state: graphState,
      });
      const approvalSpan = await input.turnTrace.startSpan({
        name: 'agent_approval',
        runType: 'chain',
        inputs: {
          capability: actionName,
          actionDigest: confirmationRecord.actionDigest,
          approvalBindingDigest:
            confirmationRecord.approvalBindingDigest,
        },
        metadata: { component: 'LangGraphInterrupt' },
        tags: ['agent-approval'],
      });
      await approvalSpan.end({ status: 'paused' });
      await input.turnTrace.end({
        status: 'paused',
        capability: actionName,
        state: traceStateSummary(graphState),
      });
      return {
        state: graphState,
        responseText: '',
        presentation: buildChannelPresentation({
          channel: input.turnInput.channel,
          responseProfile: input.turnInput.responseProfile,
          graphResponseText: '',
        }),
        replyIntent: 'general_reply',
        status: 'paused',
        pause: pauseWithCanonicalRecord(confirmationRecord),
      };
    }

    if (graphResult.failure) {
      throw new Error(providerFailureReportCode(
        graphResult.failure,
        graphResult.providerFailureDiagnostic,
      ));
    }
    const output = graphResult.output;
    if (!output) throw new Error('agent_output_missing');
    await input.turnTrace.end({
      replyIntent: output.replyIntent,
      genUiKind: output.genUi?.widgetKind ?? null,
      state: traceStateSummary(output.state),
      responseText: output.responseText,
      customerTurnCount: graphResult.customerTurnCount,
    });
    return output;
  } finally {
    externalCallScope.dispose();
  }
}
