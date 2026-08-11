import type { ExternalCallContext, ExternalClients } from '../clients/interfaces.js';
import type {
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../domain/types.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import {
  createAgentTurnExternalCallScope,
  executePortableCommerceCall,
  persistCompletedTurn,
  validateApprovalResume,
  type SingleAgentRuntimeContext,
} from '../agent/singleAgentRuntime.js';
import { rehydrateExactTurnStateReadOnly } from '../agent/agentTurnStateHydration.js';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
  type AgentTracer,
} from '../observability/agentTracing.js';
import { buildCurrentAgentApprovalBinding } from '../ordering/agentToolExecutor.js';
import { digestCommerceAction } from '../ordering/approvalReceipt.js';
import { commerceApprovalPrincipalsMatch } from '../ordering/commerceApprovalPrincipal.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../persistence/contracts.js';
import { toolExecutionContext } from '../graph/turnSupport.js';
import type { AgentTurnInput } from '../businesses/kfc/turnContracts.js';
import {
  confirmationPauseForPublicResponse,
} from './confirmationPausePersistence.js';
import {
  verifyConfirmationApprovalCapability,
  type ConfirmationApprovalKeyRing,
} from './confirmationApprovalCapability.js';
import {
  createConfirmationResumeCoordinator,
  type ConfirmationResumeRequest,
  type ConfirmationResumeResponse,
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
    sessionAuthorityGeneration: input.sessionAuthorityGeneration,
  };
}

function responseText(input: {
  decision: 'approve' | 'reject';
  toolName: string;
  succeeded?: boolean;
}): string {
  if (input.decision === 'reject') {
    return 'Đã hủy thao tác theo yêu cầu của bạn.';
  }
  return input.succeeded
    ? 'Thao tác đã được xác nhận và hoàn tất.'
    : `Không thể hoàn tất thao tác ${input.toolName}. Vui lòng thử lại.`;
}

async function resumeTurnInput(input: {
  options: ProductionConfirmationResumeOptions;
  pause: {
    sessionId: string;
    customerId: string;
    channel: AgentTurnInput['channel'];
    sourceTurnId: string;
  };
  accessContext: CustomerAccessContext | undefined;
  clients: ExternalClients;
  fence?: RunCommitFence;
  confirmationResume?: AgentTurnInput['confirmationResume'];
}): Promise<AgentTurnInput> {
  const source = (await input.options.store.listTurns(input.pause.sessionId))
    .find(({ id }) => id === input.pause.sourceTurnId);
  if (
    !source ||
    source.role !== 'user' ||
    source.externalUserId !== input.pause.customerId ||
    source.channel !== input.pause.channel
  ) {
    throw new Error('confirmation_resume_source_turn_missing');
  }
  return {
    sessionId: input.pause.sessionId,
    customerId: input.pause.customerId,
    channel: input.pause.channel,
    responseProfile: source.metadata?.responseProfile,
    text: source.text,
    externalMessageId: source.externalMessageId,
    metadata: source.metadata,
    clients: input.clients,
    store: input.options.store,
    dashboard: input.options.dashboard,
    tracer: input.options.tracer,
    accessContext: input.accessContext,
    ...(input.fence
      ? {
          runGuard: {
            commitFence: input.fence,
            isCurrent: () =>
              input.options.store.isRunCommitFenceCurrent({
                sessionId: input.pause.sessionId,
                fence: input.fence!,
              }),
          },
        }
      : {}),
    ...(input.confirmationResume
      ? { confirmationResume: input.confirmationResume }
      : {}),
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
      if (!options.keyRing) {
        return safeError(503, 'agent_approval_authority_unconfigured');
      }
      const snapshot =
        await options.store.getConfirmationPauseStorageSnapshot(
          request.requestId,
        );
      if (!snapshot) return safeError(404, 'confirmation_not_found');
      const capability = await verifyConfirmationApprovalCapability({
        approvalCapability: request.approvalCapability,
        snapshot,
        keyRing: options.keyRing,
      });
      if (!capability.ok) {
        return safeError(
          capability.errorCode === 'approval_capability_expired' ? 410 : 403,
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
        accessContext: (pause) =>
          options.accessContext(pause.sessionId, pause.customerId),
        revalidate: async (pause, externalCallContext) => {
          const [accessContext, clients] = await Promise.all([
            options.accessContext(pause.sessionId, pause.customerId),
            options.createClients(pause.sessionId, {}),
          ]);
          const turnInput = await resumeTurnInput({
            options,
            pause,
            accessContext,
            clients,
          });
          const loaded = await rehydrateExactTurnStateReadOnly(
            turnInput,
            pause.sourceTurnId,
          );
          const binding = await buildCurrentAgentApprovalBinding(
            clients,
            pause.action,
            {
              ...toolExecutionContext({
                ...turnInput,
                confirmationResume: {
                  requestId: pause.requestId,
                  approved: true,
                  ...(capability.guestAuthority
                    ? {
                        verifiedGuestAuthority:
                          capability.guestAuthority,
                      }
                    : {}),
                },
              }),
              approval: {
                principal: pause.principal,
                confirmationRequestId: pause.requestId,
                ...(capability.guestAuthority
                  ? {
                      verifiedGuestAuthority:
                        capability.guestAuthority,
                    }
                  : {}),
              },
              confirmationResume: true,
              externalCallContext,
              state: loaded.state,
              cart: loaded.state.cart,
              address: loaded.state.address,
              order: loaded.state.order,
              orderPreview: loaded.state.orderPreview,
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
          const [accessContext, clients] = await Promise.all([
            options.accessContext(
              execution.pause.sessionId,
              execution.pause.customerId,
            ),
            options.createClients(execution.pause.sessionId, {}),
          ]);
          const fence = operationLeaseFence({
            requestId: execution.pause.requestId,
            bindingFingerprint:
              execution.executionFence.bindingFingerprint,
            attempt: execution.attempt,
            leaseToken: execution.executionFence.leaseToken,
            sessionAuthorityGeneration:
              execution.executionFence.sessionAuthorityGeneration,
          });
          const confirmationResume = {
            requestId: execution.pause.requestId,
            approved: execution.receipt.decision === 'approve',
            action: execution.pause.action,
            commerceReceipt: execution.receipt,
            executionFence: execution.executionFence,
            ...(capability.guestAuthority
              ? { verifiedGuestAuthority: capability.guestAuthority }
              : {}),
            signingSecret: execution.signingSecret,
            externalCallContext: execution.externalCallContext,
            abortExternalCalls: execution.abortExternalCalls,
          } satisfies NonNullable<AgentTurnInput['confirmationResume']>;
          const turnInput = await resumeTurnInput({
            options,
            pause: execution.pause,
            accessContext,
            clients,
            fence,
            confirmationResume,
          });
          const loaded = await rehydrateExactTurnStateReadOnly(
            turnInput,
            execution.pause.sourceTurnId,
          );
          const tracer = createSafeAgentTracer(
            options.tracer ?? createNoopAgentTracer(),
          );
          const turnTrace = await tracer.startTurn({
            name: 'kfc_confirmation_resume',
            inputs: { requestId: execution.pause.requestId },
            metadata: {
              runtime: 'application-confirmation-resume',
              businessId: 'kfc',
            },
            tags: ['business:kfc', 'confirmation-resume'],
          });
          const calls = createAgentTurnExternalCallScope();
          const runtime: SingleAgentRuntimeContext = {
            turnInput,
            turnTrace,
            state: loaded.state,
            externalCallContext: execution.externalCallContext,
            abortExternalCalls: execution.abortExternalCalls,
            disposeExternalCalls: calls.dispose,
          };
          const currentTurnToolTrace: ToolTraceEntry[] = [];
          let succeeded = false;
          try {
            if (execution.receipt.decision === 'approve') {
              await validateApprovalResume(runtime, execution.pause.action);
              const result = await executePortableCommerceCall({
                runtime,
                state: loaded.state,
                call: {
                  id: execution.pause.actionId,
                  ...execution.pause.action,
                },
                currentTurnToolTrace,
              });
              succeeded = result.ok;
            }
            const output = await persistCompletedTurn({
              turnInput,
              turnTrace,
              state: loaded.state,
              currentTurnToolTrace,
              responseText: responseText({
                decision: execution.receipt.decision,
                toolName: execution.pause.action.toolName,
                succeeded,
              }),
            });
            await turnTrace.end({
              decision: execution.receipt.decision,
              succeeded,
            });
            return {
              actionOutcome: succeeded ? 'succeeded' : 'failed',
              continuation: 'turn_completed',
              requestId: execution.pause.requestId,
              responseText: output.responseText,
              orderId: output.state.order?.id ?? null,
            };
          } catch (error) {
            await turnTrace.fail(error);
            throw error;
          } finally {
            calls.dispose();
          }
        },
      });
      return coordinator({
        requestId: request.requestId,
        decision: request.decision,
      });
    } catch {
      return safeError(503, 'confirmation_authority_unavailable');
    }
  };
}
