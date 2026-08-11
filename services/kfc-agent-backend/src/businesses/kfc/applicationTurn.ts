import type { AgentTurnOutput } from './turnContracts.js';
import type {
  CommerceApprovalPrincipal,
  ToolCallRequest,
  ToolTraceEntry,
} from '../../ordering/types.js';
import {
  createAgentTurnExternalCallScope,
  executePortableCommerceCall,
  loadTurnState,
  persistCompletedTurn,
  type SingleAgentRuntimeContext,
} from '../../agent/singleAgentRuntime.js';
import { createAgentToolProfileResolver } from '../../agent/agentToolProfile.js';
import { buildSelectedActionGraphAuthorities } from '../../agent/selectedActionResponseBoundary.js';
import type { SelectedActionResponseReference } from '../../agent/selectedActionResponseAuthority.js';
import { prepareStructuredCustomerAction } from '../../agent/structuredCustomerAction.js';
import { buildCurrentAgentApprovalBinding } from '../../ordering/agentToolExecutor.js';
import { digestCommerceAction } from '../../ordering/approvalReceipt.js';
import {
  authenticatedCommerceApprovalPrincipal,
  guestCheckoutCommerceApprovalPrincipal,
} from '../../ordering/commerceApprovalPrincipal.js';
import {
  traceCanonicalScenarioTurnIndex,
  traceProbeRunId,
  traceScenarioId,
  toolExecutionContext,
  verifiedStateSnapshotSourceType,
} from '../../graph/turnSupport.js';
import { buildVerifiedStateSnapshot } from '../../graph/verifiedState.js';
import type { CreateConfirmationPauseInput } from '../../persistence/contracts.js';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
} from '../../observability/agentTracing.js';
import { KfcAgentPack } from './pack.js';
import type { AgentTurnInput } from './turnContracts.js';

const resolveToolProfile = createAgentToolProfileResolver();
const confirmationPauseTtlMs = 10 * 60_000;

function approvalPrincipal(
  turnInput: AgentTurnInput,
): CommerceApprovalPrincipal {
  if (turnInput.guestCheckoutAuthority) {
    return guestCheckoutCommerceApprovalPrincipal(
      turnInput.guestCheckoutAuthority,
    );
  }
  const access = turnInput.accessContext;
  const evidence = access?.authenticationEvidence;
  if (
    access?.authenticationState !== 'authenticated' ||
    access.kfcSubjectRef !== turnInput.customerId ||
    evidence?.state !== 'verified'
  ) {
    throw new Error('confirmation_principal_authority_missing');
  }
  return authenticatedCommerceApprovalPrincipal({
    sessionId: turnInput.sessionId,
    customerId: turnInput.customerId,
    channel: turnInput.channel,
    authenticatedSubject: access.kfcSubjectRef,
    authenticationEvidenceRef: evidence.evidenceRef,
  });
}

async function canonicalConfirmationPause(input: {
  turnInput: AgentTurnInput;
  runtime: SingleAgentRuntimeContext;
  state: NonNullable<SingleAgentRuntimeContext['state']>;
  sourceTurnId: string;
  pendingAction: ToolCallRequest & { readonly id: string };
}): Promise<CreateConfirmationPauseInput> {
  const action: ToolCallRequest = {
    toolName: input.pendingAction.toolName,
    arguments: structuredClone(input.pendingAction.arguments),
  };
  const principal = approvalPrincipal(input.turnInput);
  const approvalBinding = await buildCurrentAgentApprovalBinding(
    input.turnInput.clients,
    action,
    {
      ...toolExecutionContext(input.turnInput),
      approval: { principal },
      externalCallContext: input.runtime.externalCallContext,
      state: input.state,
      cart: input.state.cart,
      address: input.state.address,
      order: input.state.order,
      orderPreview: input.state.orderPreview,
    },
  );
  if ('ok' in approvalBinding) {
    throw new Error(`confirmation_binding_failed:${approvalBinding.errorCode}`);
  }
  const createdAt = new Date();
  const authorityExpiry =
    input.turnInput.guestCheckoutAuthority?.expiresAt ??
    (input.turnInput.accessContext?.authenticationEvidence.state === 'verified'
      ? input.turnInput.accessContext.authenticationEvidence.expiresAt
      : undefined);
  const expiresAt = new Date(
    Math.min(
      createdAt.getTime() + confirmationPauseTtlMs,
      authorityExpiry ? Date.parse(authorityExpiry) : Number.POSITIVE_INFINITY,
    ),
  );
  if (expiresAt.getTime() <= createdAt.getTime()) {
    throw new Error('confirmation_principal_authority_expired');
  }
  return {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: crypto.randomUUID(),
    sourceTurnId: input.sourceTurnId,
    actionScope: '',
    actionId: input.pendingAction.id,
    sessionId: input.turnInput.sessionId,
    customerId: input.turnInput.customerId,
    channel: input.turnInput.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest: await digestCommerceAction(approvalBinding),
    principal,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

async function persistConfirmationPause(input: {
  turnInput: AgentTurnInput;
  state: NonNullable<SingleAgentRuntimeContext['state']>;
  pause: CreateConfirmationPauseInput;
}): Promise<void> {
  const fence = input.turnInput.runGuard?.commitFence;
  if (fence) {
    const committed =
      await input.turnInput.store.commitConfirmationPauseIfRunCurrent({
        fence,
        notAfter: input.pause.expiresAt,
        stateEvent: {
          sessionId: input.turnInput.sessionId,
          sourceType: verifiedStateSnapshotSourceType,
          payload: {
            verifiedState: buildVerifiedStateSnapshot(input.state),
          },
        },
        pause: input.pause,
      });
    if (committed.status === 'stale') {
      throw new Error('customer_run_cancelled');
    }
    if (committed.status === 'conflict') {
      throw new Error('confirmation_pause_conflict');
    }
    return;
  }
  const created = await input.turnInput.store.createConfirmationPause(
    input.pause,
  );
  if (created.status === 'conflict') {
    throw new Error('confirmation_pause_conflict');
  }
  await input.turnInput.store.appendEvent(
    input.turnInput.sessionId,
    verifiedStateSnapshotSourceType,
    { verifiedState: buildVerifiedStateSnapshot(input.state) },
  );
}

/**
 * Application-owned transaction around one LangChain KFC tool loop.
 * Transcript, authorization, state, effects, fencing and persistence remain
 * outside LangChain and are provided by the existing application boundaries.
 */
export async function runKfcApplicationTurn(
  turnInput: AgentTurnInput,
): Promise<AgentTurnOutput> {
  if (!turnInput.agentModel) throw new Error('kfc_agent_not_configured');
  const tracer = createSafeAgentTracer(
    turnInput.tracer ?? createNoopAgentTracer(),
  );
  const turnTrace = await tracer.startTurn({
    name: 'kfc_langchain_turn',
    inputs: {
      sessionId: turnInput.sessionId,
      channel: turnInput.channel,
    },
    metadata: {
      runtime: 'langchain-create-agent',
      businessId: 'kfc',
      scenarioId: traceScenarioId(turnInput) ?? 'live-agent',
      probeRunId: traceProbeRunId(turnInput) ?? null,
      canonicalScenarioTurnIndex:
        traceCanonicalScenarioTurnIndex(turnInput) ?? null,
    },
    tags: ['business:kfc', 'runtime:langchain-create-agent'],
  });
  const externalCalls = createAgentTurnExternalCallScope(
    turnInput.turnDeadlineMs,
  );
  const runtime: SingleAgentRuntimeContext = {
    turnInput,
    turnTrace,
    externalCallContext: externalCalls.context,
    abortExternalCalls: externalCalls.abort,
    disposeExternalCalls: externalCalls.dispose,
  };
  try {
    const loaded = await loadTurnState(turnInput);
    if (!loaded.currentUserTurn) {
      throw new Error('agent_current_user_turn_missing');
    }
    let state = loaded.state;
    runtime.state = state;
    const currentTurnToolTrace: ToolTraceEntry[] = [];
    let selectedActionResponse: SelectedActionResponseReference | undefined;
    if (turnInput.trustedCustomerAction) {
      const prepared = prepareStructuredCustomerAction({
        envelope: turnInput.trustedCustomerAction,
        revisionValidated: true,
        state,
      });
      if (prepared.kind === 'reject') throw new Error(prepared.errorCode);
      let outcome: 'presentation_ready' | 'tool_succeeded';
      if (prepared.kind === 'present') {
        state = prepared.state;
        runtime.state = state;
        outcome = 'presentation_ready';
      } else {
        const result = await executePortableCommerceCall({
          runtime,
          state,
          call: {
            id: `trusted-action:${loaded.currentUserTurn.id}`,
            ...prepared.call,
          },
          currentTurnToolTrace,
        });
        if (!result.ok) {
          throw new Error(`structured_action_tool_failed:${result.errorCode}`);
        }
        outcome = 'tool_succeeded';
      }
      const authority = buildSelectedActionGraphAuthorities({
        envelope: turnInput.trustedCustomerAction,
        outcome,
        state,
        currentTurnToolTrace,
        approvalDecision: null,
        validatedApprovalActionDigest: null,
      });
      if (!authority.ok) throw new Error(authority.errorCode);
      selectedActionResponse = authority.reference;
    }
    const pack = new KfcAgentPack({
      model: turnInput.agentModel,
      store: turnInput.store,
      loadState: async () => state,
      resolveActiveToolNames: ({ state }) =>
        turnInput.trustedCustomerAction
          ? []
          : resolveToolProfile({
              lifecycle: state,
              accessContext: turnInput.accessContext,
              guestCheckoutAuthority: turnInput.guestCheckoutAuthority,
              runFence: turnInput.runGuard?.commitFence,
              externalMessageId: turnInput.externalMessageId,
              confirmationResume: false,
              providerCapabilities: {
                handoffResolutionSupported:
                  turnInput.clients.providerCapabilities?.handoffResolution ===
                  true,
              },
              now: Date.now(),
            }),
      executeTool: async ({ call, state }) => {
        const result = await executePortableCommerceCall({
          runtime,
          state,
          call,
          currentTurnToolTrace,
        });
        const evidenceId = `tool:${call.id}`;
        return {
          evidenceId,
          result: { ...result, evidenceId },
        };
      },
      selectedActionResponse,
    });
    const result = await pack.runTurn({
      sessionId: turnInput.sessionId,
      customerId: turnInput.customerId,
      channel: turnInput.channel,
      currentUserTurnId: loaded.currentUserTurn.id,
    });
    const confirmationPause = result.pendingConfirmation
      ? await canonicalConfirmationPause({
          turnInput,
          runtime,
          state: result.state,
          sourceTurnId: loaded.currentUserTurn.id,
          pendingAction: result.pendingConfirmation.action,
        })
      : undefined;
    if (confirmationPause) {
      await persistConfirmationPause({
        turnInput,
        state: result.state,
        pause: confirmationPause,
      });
    }
    const output = await persistCompletedTurn({
      turnInput,
      turnTrace,
      state: result.state,
      currentTurnToolTrace,
      responseText: result.responseText,
      responseFactualClaims: result.publication.factualClaims,
    });
    await turnTrace.end({
      status: confirmationPause ? 'paused' : output.status,
      toolCalls: result.toolCalls.length,
    });
    return confirmationPause
      ? {
          ...output,
          status: 'paused',
          pause: {
            capability: confirmationPause.action.toolName,
            requestId: confirmationPause.requestId,
            action: confirmationPause.action,
          },
        }
      : output;
  } catch (error) {
    await turnTrace.fail(error);
    throw error;
  } finally {
    externalCalls.dispose();
  }
}
