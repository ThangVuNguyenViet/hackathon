import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type {
  ExternalCallContext,
  ExternalClients,
} from '../clients/interfaces.js';
import type {
  ConversationTurn,
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../domain/types.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type { AgentGraphState } from '../graph/state.js';
import { loadPriorVerifiedState } from '../graph/verifiedState.js';
import type { AgentTracer } from '../observability/agentTracing.js';
import { digestCommerceAction } from '../ordering/approvalReceipt.js';
import {
  buildCurrentAgentApprovalBinding,
} from '../ordering/agentToolExecutor.js';
import { approvalCapabilityScopes } from '../ordering/toolBoundaries.js';
import type {
  CommerceApprovalPrincipal,
  ToolTraceEntry,
} from '../ordering/types.js';
import {
  commerceApprovalPrincipalsMatch,
} from '../ordering/commerceApprovalPrincipal.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../persistence/contracts.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import {
  confirmationPauseForPublicResponse,
  confirmationPausePointerForDurableEvent,
  persistCanonicalConfirmationPause,
} from './confirmationPausePersistence.js';
import {
  verifyConfirmationApprovalCapability,
  type ConfirmationApprovalKeyRing,
} from './confirmationApprovalCapability.js';
import {
  createConfirmationResumeCoordinator,
  type ConfirmationResumeRequest,
  type ConfirmationResumeResponse,
  type ConfirmationResumeStoredResult,
} from './confirmationResumeAuthority.js';
import {
  createConversationStoreConfirmationResumeRepository,
} from './confirmationResumeRepository.js';

export interface ProductionConfirmationResumeRequest
  extends ConfirmationResumeRequest {
  approvalCapability: string;
}

export interface ProductionConfirmationResumeOptions {
  store: ConversationStore;
  dashboard: DashboardEventBus;
  keyRing: ConfirmationApprovalKeyRing | undefined;
  checkpointer: BaseCheckpointSaver | undefined;
  agentModel: BaseChatModel | undefined;
  responseVerifierModel: BaseChatModel | undefined;
  tracer?: AgentTracer;
  accessContext(
    sessionId: string,
    customerId: string,
  ): Promise<CustomerAccessContext | undefined>;
  createClients(
    sessionId: string,
    metadata: ConversationTurnMetadata,
  ): Promise<ExternalClients>;
}

function safeError(
  status: number,
  errorCode: string,
): ConfirmationResumeResponse {
  return { status, body: { errorCode } };
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

async function exactPausedCustomerTurn(input: {
  store: ConversationStore;
  checkpointer: BaseCheckpointSaver;
  sessionId: string;
  customerId: string;
  channel: ConversationTurn['channel'];
  checkpointThreadId: string;
  checkpointNamespace: string;
  checkpointId: string;
}): Promise<ConversationTurn> {
  const tuple = await input.checkpointer.getTuple({
    configurable: {
      thread_id: input.checkpointThreadId,
      checkpoint_ns: input.checkpointNamespace,
      checkpoint_id: input.checkpointId,
    },
  });
  const storedConfig = tuple?.config.configurable;
  const values: unknown = tuple?.checkpoint.channel_values;
  const currentTurnId =
    isRecord(values) &&
    typeof values.currentTurnId === 'string'
      ? values.currentTurnId
      : undefined;
  const turn = currentTurnId
    ? (await input.store.listTurns(input.sessionId))
        .find(({ id }) => id === currentTurnId)
    : undefined;
  if (
    !tuple ||
    tuple.checkpoint.id !== input.checkpointId ||
    storedConfig?.thread_id !== input.checkpointThreadId ||
    (storedConfig.checkpoint_ns ?? '') !==
      input.checkpointNamespace ||
    !turn ||
    turn.role !== 'user' ||
    turn.sessionId !== input.sessionId ||
    turn.externalUserId !== input.customerId ||
    turn.channel !== input.channel
  ) {
    throw new Error('confirmation_resume_customer_turn_missing');
  }
  return turn;
}

async function currentState(input: {
  store: ConversationStore;
  turn: ConversationTurn;
  sessionId: string;
  customerId: string;
  channel: ConversationTurn['channel'];
}): Promise<AgentGraphState> {
  const prior = await loadPriorVerifiedState(
    input.store,
    input.sessionId,
  );
  return {
    ...prior,
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    latestUserMessage: input.turn.text,
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

function approvalContext(input: {
  state: AgentGraphState;
  principal: CommerceApprovalPrincipal;
  accessContext: CustomerAccessContext | undefined;
  externalCallContext: ExternalCallContext;
  clientMessageId: string;
}) {
  return {
    accessContext: input.accessContext,
    sessionId: input.state.sessionId,
    clientMessageId: input.clientMessageId,
    commerceTraceId: crypto.randomUUID(),
    commerceScenarioId: 'confirmation-resume',
    approval: { principal: input.principal },
    externalCallContext: input.externalCallContext,
    state: input.state,
    cart: input.state.cart,
    address: input.state.address,
    order: input.state.order,
    orderPreview: input.state.orderPreview,
  };
}

function exactTraceDelta(
  before: readonly ToolTraceEntry[],
  after: readonly ToolTraceEntry[],
): ToolTraceEntry[] {
  if (
    after.length < before.length ||
    !before.every(
      (entry, index) =>
        JSON.stringify(entry) === JSON.stringify(after[index]),
    )
  ) {
    throw new Error('confirmation_resume_tool_trace_not_contiguous');
  }
  return after.slice(before.length);
}

async function approvalActionOutcome(input: {
  decision: 'approve' | 'reject';
  expectedActionDigest: string;
  expectedToolName: string;
  before: readonly ToolTraceEntry[];
  after: readonly ToolTraceEntry[];
}): Promise<'succeeded' | 'failed'> {
  const approvalEntries = exactTraceDelta(
    input.before,
    input.after,
  ).filter(({ toolName }) =>
    Object.hasOwn(approvalCapabilityScopes, toolName)
  );
  if (input.decision === 'reject') {
    if (approvalEntries.length !== 0) {
      throw new Error('confirmation_rejection_side_effect_detected');
    }
    return 'failed';
  }
  if (
    approvalEntries.length !== 1 ||
    approvalEntries[0]?.toolName !== input.expectedToolName ||
    await digestCommerceAction({
      toolName: approvalEntries[0].toolName,
      arguments: approvalEntries[0].arguments,
    }) !== input.expectedActionDigest
  ) {
    throw new Error('confirmation_resume_side_effect_identity_invalid');
  }
  return approvalEntries[0].ok ? 'succeeded' : 'failed';
}

function operationLeaseFence(input: {
  requestId: string;
  bindingFingerprint: string;
  attempt: number;
  leaseToken: string;
  sessionAuthorityGeneration: number;
}): RunCommitFence {
  return {
    kind: 'operation_lease',
    requestId: input.requestId,
    operation: 'confirmation_resume',
    bindingFingerprint: input.bindingFingerprint,
    attempt: input.attempt,
    leaseToken: input.leaseToken,
    sessionAuthorityGeneration:
      input.sessionAuthorityGeneration,
  };
}

export function createProductionConfirmationResumeHandler(
  options: ProductionConfirmationResumeOptions,
): (
  request: ProductionConfirmationResumeRequest,
) => Promise<ConfirmationResumeResponse> {
  const repository =
    createConversationStoreConfirmationResumeRepository(options.store);
  return async (request) => {
    try {
      const keyRing = options.keyRing;
      const checkpointer = options.checkpointer;
      const agentModel = options.agentModel;
      if (!keyRing || !checkpointer || !agentModel) {
        return safeError(
          503,
          'agent_approval_authority_unconfigured',
        );
      }
      const snapshot =
        await options.store.getConfirmationPauseStorageSnapshot(
          request.requestId,
        );
      if (!snapshot) {
        return safeError(404, 'confirmation_not_found');
      }
      const capability = await verifyConfirmationApprovalCapability({
        approvalCapability: request.approvalCapability,
        snapshot,
        keyRing,
      });
      if (!capability.ok) {
        return safeError(
          capability.errorCode === 'approval_capability_expired'
            ? 410
            : 403,
          capability.errorCode,
        );
      }
      const coordinator = createConfirmationResumeCoordinator({
        repository,
        signingSecret: capability.signingSecret,
        rejectCompletedReplay: true,
        ...(capability.guestAuthority
          ? { verifiedGuestAuthority: capability.guestAuthority }
          : {}),
        accessContext: async (pause) =>
          options.accessContext(pause.sessionId, pause.customerId),
        revalidate: async (pause, externalCallContext) => {
          const turn = await exactPausedCustomerTurn({
            store: options.store,
            checkpointer,
            sessionId: pause.sessionId,
            customerId: pause.customerId,
            channel: pause.channel,
            checkpointThreadId: pause.checkpointThreadId,
            checkpointNamespace: pause.checkpointNamespace,
            checkpointId: pause.checkpointId,
          });
          const [accessContext, clients] = await Promise.all([
            options.accessContext(pause.sessionId, pause.customerId),
            options.createClients(
              pause.sessionId,
              turn.metadata ?? {},
            ),
          ]);
          const state = await currentState({
            store: options.store,
            turn,
            sessionId: pause.sessionId,
            customerId: pause.customerId,
            channel: pause.channel,
          });
          const binding = await buildCurrentAgentApprovalBinding(
            clients,
            pause.action,
            {
              ...approvalContext({
                state,
                principal: pause.principal,
                accessContext,
                externalCallContext,
                clientMessageId:
                  turn.externalMessageId ?? pause.requestId,
              }),
              ...(capability.guestAuthority
                ? {
                    approval: {
                      principal: pause.principal,
                      confirmationRequestId:
                        pause.requestId,
                      verifiedGuestAuthority:
                        capability.guestAuthority,
                    },
                    confirmationResume: true,
                  }
                : {}),
            },
          );
          return {
            ok:
              !('ok' in binding) &&
              await digestCommerceAction(binding) ===
                pause.approvalBindingDigest,
          };
        },
        execute: async (execution) => {
          const accessContext = await options.accessContext(
            execution.pause.sessionId,
            execution.pause.customerId,
          );
          const turn = await exactPausedCustomerTurn({
            store: options.store,
            checkpointer,
            sessionId: execution.pause.sessionId,
            customerId: execution.pause.customerId,
            channel: execution.pause.channel,
            checkpointThreadId:
              execution.pause.checkpointThreadId,
            checkpointNamespace:
              execution.pause.checkpointNamespace,
            checkpointId: execution.pause.checkpointId,
          });
          const clients = await options.createClients(
            execution.pause.sessionId,
            turn.metadata ?? {},
          );
          const before = await currentState({
            store: options.store,
            turn,
            sessionId: execution.pause.sessionId,
            customerId: execution.pause.customerId,
            channel: execution.pause.channel,
          });
          const fence = operationLeaseFence({
            requestId: execution.pause.requestId,
            bindingFingerprint:
              execution.executionFence.bindingFingerprint,
            attempt: execution.attempt,
            leaseToken: execution.executionFence.leaseToken,
            sessionAuthorityGeneration:
              execution.executionFence.sessionAuthorityGeneration,
          });
          const isCurrent = () =>
            options.store.isRunCommitFenceCurrent({
              sessionId: execution.pause.sessionId,
              fence,
              notAfter: execution.pause.expiresAt,
            });
          const output = await runAgentTurn({
            sessionId: execution.pause.sessionId,
            customerId: execution.pause.customerId,
            channel: execution.pause.channel,
            responseProfile: turn.metadata?.responseProfile,
            text: turn.text,
            externalMessageId: turn.externalMessageId,
            metadata: turn.metadata,
            clients,
            store: options.store,
            dashboard: options.dashboard,
            agentModel,
            responseVerifierModel: options.responseVerifierModel,
            tracer: options.tracer,
            accessContext,
            checkpointer,
            runGuard: { isCurrent, commitFence: fence },
            confirmationResume: {
              requestId: execution.pause.requestId,
              approved: execution.receipt.decision === 'approve',
              action: execution.pause.action,
              checkpoint: execution.checkpoint,
              commerceReceipt: execution.receipt,
              executionFence: execution.executionFence,
              ...(capability.guestAuthority
                ? {
                    verifiedGuestAuthority:
                      capability.guestAuthority,
                  }
                : {}),
              signingSecret: execution.signingSecret,
              externalCallContext: execution.externalCallContext,
              abortExternalCalls: execution.abortExternalCalls,
            },
          });
          const actionOutcome = await approvalActionOutcome({
            decision: execution.receipt.decision,
            expectedActionDigest: execution.pause.actionDigest,
            expectedToolName: execution.pause.action.toolName,
            before: before.toolTrace ?? [],
            after: output.state.toolTrace ?? [],
          });
          if (output.status === 'paused' && output.pause) {
            await persistCanonicalConfirmationPause({
              store: options.store,
              sessionId: execution.pause.sessionId,
              customerId: execution.pause.customerId,
              channel: execution.pause.channel,
              pause: output.pause,
              accessContext,
              ...(capability.guestAuthority
                ? {
                    verifiedGuestAuthority:
                      capability.guestAuthority,
                  }
                : {}),
              checkpointer,
              runCommit: { fence, state: output.state },
            });
            const next =
              await confirmationPausePointerForDurableEvent({
                pause: output.pause,
                store: options.store,
              });
            return {
              actionOutcome,
              continuation: 'approval_required',
              requestId: next.requestId,
              responseText: output.responseText,
              approvalPause: next,
              orderId: output.state.order?.id ?? null,
            };
          }
          return {
            actionOutcome,
            continuation: 'turn_completed',
            requestId: execution.pause.requestId,
            responseText: output.responseText,
            orderId: output.state.order?.id ?? null,
          };
        },
        projectResult: async (
          result: ConfirmationResumeStoredResult,
        ) => {
          if (result.continuation === 'turn_completed') {
            return result;
          }
          const nextSnapshot =
            await options.store.getConfirmationPauseStorageSnapshot(
              result.approvalPause.requestId,
            );
          if (
            !nextSnapshot ||
            nextSnapshot.record.sessionId !== capability.payload.sessionId ||
            nextSnapshot.record.customerId !== capability.payload.customerId ||
            nextSnapshot.record.channel !== capability.payload.channel ||
            nextSnapshot.record.checkpointThreadId !==
              snapshot.record.checkpointThreadId ||
            nextSnapshot.record.checkpointNamespace !==
              snapshot.record.checkpointNamespace ||
            !commerceApprovalPrincipalsMatch(
              nextSnapshot.record.principal,
              snapshot.record.principal,
            )
          ) {
            throw new Error(
              'confirmation_next_approval_authority_mismatch',
            );
          }
          const next = await confirmationPauseForPublicResponse({
            pause: result.approvalPause,
            store: options.store,
            accessContext: await options.accessContext(
              nextSnapshot.record.sessionId,
              nextSnapshot.record.customerId,
            ),
            ...(capability.guestAuthority
              ? {
                  verifiedGuestContinuationAuthority:
                    capability.guestAuthority,
                }
              : {}),
            keyRing,
          });
          return {
            actionOutcome: result.actionOutcome,
            continuation: result.continuation,
            requestId: result.requestId,
            responseText: result.responseText,
            ...(result.orderId !== undefined
              ? { orderId: result.orderId }
              : {}),
            capability: next.capability,
            approvalCapability: next.approvalCapability,
            expiresAt: next.expiresAt,
          };
        },
      });
      return await coordinator({
        requestId: request.requestId,
        decision: request.decision,
      });
    } catch {
      return safeError(503, 'confirmation_authority_unavailable');
    }
  };
}
