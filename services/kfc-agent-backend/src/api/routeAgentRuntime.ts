import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { KfcDirectTurnService } from '../agent/kfcDirectTurnService.js';
import { selectKfcOpenAiGenUi } from '../agent/kfcOpenAiGenUi.js';
import {
  directAgentToolArguments,
  type KfcToolSession,
} from '../agent/kfcOpenAiTools.js';
import { prepareStructuredCustomerAction } from '../agent/structuredCustomerAction.js';
import type {
  ExternalClients,
  MessengerClient,
  MessengerSenderAction,
} from '../clients/interfaces.js';
import type { KfcCommerceGatewayClients } from '../clients/kfcCommerceGateway.js';
import {
  LifecycleError,
  type CreateLifecycleInput,
  type LifecycleBinding,
  type LifecycleInstance,
  type LifecycleTransition,
  type MutationContext,
  type SandboxLifecycleControls,
  projectLifecycleCommerceClients,
} from '../commerce/lifecycleProvider.js';
import { createCatalogObservationClients } from '../clients/catalogObservationClients.js';
import {
  fetchCatalogObservation,
  type CatalogObservation,
  type CommerceEnvironment,
} from '../catalog/catalogObservation.js';
import type { ConversationEvent } from '../channels/conversationEvent.js';
import type { MessengerHistorySyncCoordinator } from '../channels/messengerHistory.js';
import {
  createMessengerClient,
  normalizeMessengerWebhook,
  verifyMessengerChallenge,
} from '../channels/messenger.js';
import { createZaloClient, normalizeZaloWebhook } from '../channels/zalo.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type {
  AgentMode,
  ConversationProfile,
  ConversationTurn,
  ConversationTurnMetadata,
  CustomerAccessContext,
  ToolResult,
} from '../domain/types.js';
import type { TrustedCustomerActionEnvelope } from '../domain/customerCommand.js';
import {
  isKfcGenUiAttachment,
  kfcGenUiAttachmentForPersistence,
  type KfcGenUiAttachment,
} from '../genui/kfcGenUi.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type { AgentTurnOutput } from '../graph/agentTurnState.js';
import type { AgentGraphState } from '../graph/state.js';
import type { AgentTracer } from '../observability/agentTracing.js';
import {
  createMockClients,
  type MockClientOptions,
} from '../mock/createMockClients.js';
import {
  applyMockedUpstreamFixtureOverrides,
  mockedUpstreamApiProfileSchema,
  mockedUpstreamClientOptions,
} from '../mock/mockedUpstreamProfile.js';
import type { ToolName } from '../ordering/types.js';
import {
  CustomerRunCoordinator,
  type CustomerRunObservation,
} from '../customerRuns/runtime.js';
import {
  kfcSessionMatchesCustomer,
  type CustomerRunStartRequest,
} from '../customerRuns/contracts.js';
import {
  MemoryStore,
  type ConversationStore,
  type RunCommitFence,
  type WebhookDelivery,
} from '../persistence/memoryStore.js';
import { sessionIdForConversationEvent } from '../session/sessionContext.js';
import {
  buildChannelPresentation,
  textOnlyPresentation,
  type ChannelPresentationPlan,
} from '../presentation/channelPresentation.js';
import {
  ShowcaseService,
  ShowcaseValidationError,
  type ShowcaseScenarioSource,
} from '../showcase/showcase.js';
import {
  isRecord,
  canonicalJson,
  sha256Fingerprint,
  kfcSessionIdSchema,
  kfcChatPayloadSchema,
  kfcGenUiActionPayloadSchema,
  kfcSmartMenuBatchPayloadSchema,
  messengerHistorySyncPayloadSchema,
  staleMessengerRecoveryPayloadSchema,
  sessionControlPayloadSchema,
  dashboardSessionDefaultLookbackMs,
  humanMessagePayloadSchema,
  lifecycleTransitionSchema,
  lifecycleEventPayloadSchema,
  confirmationResumePayloadSchema,
  kfcProofPreconditionsSchema,
  lifecycleErrorResponse,
  ReadinessCheckResult,
  ReadinessOptions,
  RouteOptions,
  HandlerResponse,
  MessengerWebhookEventProcessingResult,
  StaleMessengerDeliveryRecoveryResult,
  RouteHandlers,
  defaultFixturesRoot,
} from './routeHandlerContracts.js';
import {
  messengerDeliveryFailureForStorage,
  eventFromMessengerDelivery,
  sendMessengerSenderAction,
  dashboardEventId,
  checkCommerceGatewayReadiness,
  checkCatalogReadiness,
  runReadinessCheck,
  checkFixtures,
  checkMessengerConfig,
  checkZaloConfig,
  deeplinkForSession,
  renderInboxUrlTemplate,
  ChannelProfileTarget,
  channelTargetForSession,
  humanChannelTargetForSession,
} from './routeHandlerSupport.js';

import type { RouteCommerceRuntime } from './routeCommerceRuntime.js';
import {
  confirmationApprovalPausePointerSchema,
  confirmationPauseForPublicResponse,
  confirmationPausePointerForDurableEvent,
  persistCanonicalConfirmationPause,
  type ConfirmationApprovalPausePointer,
} from './confirmationPausePersistence.js';
import { createRouteMonitorRuntime } from './routeMonitorRuntime.js';
import { reserveKfcSynchronousRequest } from './synchronousRequestReservation.js';
import {
  deliverChannelAssistantReply,
  type DeliverChannelAssistantReplyInput,
} from './agentRunTextDeliveryRuntime.js';

export interface StreamingRunObserver {
  observe: (observation: CustomerRunObservation) => Promise<void>;
  isCurrent: () => Promise<boolean>;
  commitFence: RunCommitFence;
}

export type StreamingRunObservers = Map<string, StreamingRunObserver>;

export function streamingRunObserverKey(
  sessionId: string,
  clientMessageId: string,
): string {
  return JSON.stringify([sessionId, clientMessageId]);
}

export function releaseStreamingRunObserver(
  observers: StreamingRunObservers,
  key: string,
  owner: StreamingRunObserver,
): void {
  if (observers.get(key) === owner) observers.delete(key);
}

interface DurableKfcAgentResponseBody {
  responseText: string;
  presentation: ChannelPresentationPlan;
  replyIntent: AgentTurnOutput['replyIntent'];
  genUi?: KfcGenUiAttachment;
  status?: AgentTurnOutput['status'];
  pause?: ConfirmationApprovalPausePointer;
  sessionId: string;
  customerId: string;
  userTurnId: string | null;
  assistantTurnId: string | null;
  replayed: false;
}

function persistenceSafePresentation(
  presentation: ChannelPresentationPlan,
): ChannelPresentationPlan {
  if (presentation.profile !== 'genui' || !presentation.genUi) {
    return structuredClone(presentation);
  }
  return {
    ...structuredClone(presentation),
    genUi: kfcGenUiAttachmentForPersistence(presentation.genUi),
  };
}

function durableKfcAgentResponseBody(input: {
  output: AgentTurnOutput;
  pause?: ConfirmationApprovalPausePointer;
  sessionId: string;
  customerId: string;
  userTurnId: string | null;
}): DurableKfcAgentResponseBody {
  return {
    responseText: input.output.responseText,
    presentation: persistenceSafePresentation(input.output.presentation),
    replyIntent: input.output.replyIntent,
    ...(input.output.genUi
      ? {
          genUi: kfcGenUiAttachmentForPersistence(input.output.genUi),
        }
      : {}),
    ...(input.output.status ? { status: input.output.status } : {}),
    ...(input.pause ? { pause: input.pause } : {}),
    sessionId: input.sessionId,
    customerId: input.customerId,
    userTurnId: input.userTurnId,
    assistantTurnId: input.output.assistantTurnId ?? null,
    replayed: false,
  };
}

function currentOwnerKfcAgentResponse(input: {
  completion: {
    response: HandlerResponse;
    completedByOwner: boolean;
  };
  transientGenUi?: KfcGenUiAttachment;
}): HandlerResponse {
  const { response, completedByOwner } = input.completion;
  if (!completedByOwner || !input.transientGenUi || !isRecord(response.body)) {
    return response;
  }
  return {
    ...response,
    body: {
      ...response.body,
      genUi: structuredClone(input.transientGenUi),
    },
  };
}

export function createRouteAgentRuntime(
  input: {
    options: RouteOptions;
    store: ConversationStore;
    dashboard: DashboardEventBus;
    showcase: ShowcaseService | undefined;
    streamingRunObservers: StreamingRunObservers;
  } & RouteCommerceRuntime,
) {
  const {
    options,
    store,
    dashboard,
    showcase,
    streamingRunObservers,
    getFixtures,
    withConfiguredCommerce,
    createWebhookClients,
    createDeliveryClients,
    dashboardProfileForTarget,
    createFirstPartyKfcClients,
    kfcProofAccessContext,
    latestKfcProofPreconditions,
  } = input;
  const locallyActiveSynchronousRequests = new Set<string>();
  const directTurnService = options.openAiAgent
    ? new KfcDirectTurnService({
        store,
        openAiAgent: options.openAiAgent,
        getFixtures,
        createClients: createFirstPartyKfcClients,
        getAccessContext: kfcProofAccessContext,
      })
    : undefined;
  const {
    deferAiMonitorRefinement,
    emitSessionControlIntelligence,
    ensureDashboardMonitorContext,
    resumedOwnershipSummary,
    shouldEvaluateDashboardMonitorContext,
  } = createRouteMonitorRuntime({ options, store, dashboard });
  async function kfcAgentResponse(input: {
    sessionId: string;
    customerId: string;
    clientMessageId: string;
    text: string;
    metadata: ConversationTurnMetadata;
    trustedCustomerAction?: TrustedCustomerActionEnvelope;
    observeRun?: (observation: CustomerRunObservation) => Promise<void>;
    runGuard?: {
      isCurrent(): Promise<boolean>;
      commitFence: RunCommitFence;
    };
  }): Promise<HandlerResponse> {
    const trustedMetadata: ConversationTurnMetadata = {
      ...input.metadata,
      ...(options.readiness?.release
        ? { release: options.readiness.release }
        : {}),
    };
    const requestFingerprint = await sha256Fingerprint({
      customerId: input.customerId,
      text: input.text,
      metadata: trustedMetadata,
      trustedCustomerAction: input.trustedCustomerAction ?? null,
    });
    if (
      !options.openAiAgent &&
      !options.agent &&
      process.env.NODE_ENV !== 'test'
    ) {
      return {
        status: 503,
        body: { errorCode: 'kfc_agent_not_configured' },
      };
    }
    const initialControl = await store.getSessionControl(input.sessionId);
    if (initialControl.agentMode === 'human_paused') {
      if (input.trustedCustomerAction) {
        return {
          status: 409,
          body: {
            errorCode: 'trusted_genui_action_requires_ai_active_session',
            agentMode: initialControl.agentMode,
          },
        };
      }
      const existingTurn = await store.findTurnByExternalMessage(
        input.sessionId,
        input.clientMessageId,
      );
      if (!existingTurn) {
        const turn = await store.appendTurn({
          sessionId: input.sessionId,
          channel: 'kfc',
          role: 'user',
          text: input.text,
          externalMessageId: input.clientMessageId,
          externalUserId: input.customerId,
          deliveryStatus: 'received',
          metadata: trustedMetadata,
        });
        emitConversationTurnCreatedEvent(turn);
      }
      const currentControl = await store.getSessionControl(input.sessionId);
      if (currentControl.agentMode === 'human_paused') {
        if (!existingTurn) {
          await store.appendEvent(input.sessionId, 'assistant_reply_skipped', {
            reason: 'human_paused',
            channel: 'kfc',
            externalMessageId: input.clientMessageId,
          });
        }
        return {
          status: 200,
          body: {
            sessionId: input.sessionId,
            responseText: '',
            presentation: textOnlyPresentation('', 'kfc'),
            suppressed: true,
            agentMode: currentControl.agentMode,
            ...(existingTurn ? { replayed: true } : {}),
          },
        };
      }
    }
    const streamingObserver = streamingRunObservers.get(
      streamingRunObserverKey(input.sessionId, input.clientMessageId),
    );
    const isStreamingRun =
      input.runGuard !== undefined || streamingObserver !== undefined;
    const reservation = await reserveKfcSynchronousRequest({
      store,
      sessionId: input.sessionId,
      clientMessageId: input.clientMessageId,
      bindingFingerprint: requestFingerprint,
      locallyActiveRequestIds: locallyActiveSynchronousRequests,
      ...(!isStreamingRun
        ? {
            projectResponse: async (
              response: HandlerResponse,
            ): Promise<HandlerResponse> => {
              if (!isRecord(response.body)) return response;
              const rawPause = response.body.pause;
              if (rawPause === undefined) return response;
              const pointer =
                confirmationApprovalPausePointerSchema.safeParse(rawPause);
              if (!pointer.success) {
                return {
                  status: 503,
                  body: {
                    errorCode: 'agent_approval_authority_unavailable',
                  },
                };
              }
              if (!options.confirmationApprovalKeyRing) {
                return {
                  status: 503,
                  body: {
                    errorCode: 'agent_approval_authority_unconfigured',
                  },
                };
              }
              try {
                const publicPause = await confirmationPauseForPublicResponse({
                  pause: pointer.data,
                  store,
                  accessContext: await kfcProofAccessContext(
                    input.sessionId,
                    input.customerId,
                  ),
                  keyRing: options.confirmationApprovalKeyRing,
                });
                return {
                  ...response,
                  body: {
                    ...response.body,
                    pause: publicPause,
                  },
                };
              } catch {
                return {
                  status: 503,
                  body: {
                    errorCode: 'agent_approval_authority_unavailable',
                  },
                };
              }
            },
          }
        : {}),
    });
    if (reservation.status === 'response') return reservation.response;

    try {
      const accessContext = await kfcProofAccessContext(
        input.sessionId,
        input.customerId,
      );
      const runGuard =
        input.runGuard ??
        (streamingObserver
          ? {
              isCurrent: streamingObserver.isCurrent,
              commitFence: streamingObserver.commitFence,
            }
          : reservation.fence.runGuard);
      if (!(await runGuard.isCurrent())) {
        await reservation.fence.fail('agent_run_superseded');
        return {
          status: 409,
          body: {
            errorCode: 'agent_run_superseded',
            sessionId: input.sessionId,
            suppressed: true,
          },
        };
      }
      if (options.openAiAgent && directTurnService) {
        const directMetadata = input.trustedCustomerAction
          ? {
              ...trustedMetadata,
              customerCommand: input.trustedCustomerAction.command,
            }
          : trustedMetadata;
        let requiredToolCalls:
          | Array<{
              name: string;
              arguments: Record<string, unknown>;
            }>
          | undefined;
        let selectedPaymentMethod:
          KfcToolSession['selectedPaymentMethod'] | undefined;
        if (input.trustedCustomerAction) {
          const verifiedStateEvent = [
            ...(await store.listEvents(input.sessionId)),
          ]
            .reverse()
            .find(({ sourceType }) => sourceType === 'graph:verified_state');
          const verifiedState = verifiedStateEvent?.payload.verifiedState;
          if (!isRecord(verifiedState)) {
            return {
              status: 409,
              body: { errorCode: 'trusted_genui_state_unavailable' },
            };
          }
          const command = input.trustedCustomerAction.command;
          if (command.kind === 'submit_address' && command.address) {
            requiredToolCalls = [
              {
                name: 'quoteFulfillment',
                arguments: {
                  method: 'delivery',
                  address: command.address,
                },
              },
            ];
          } else {
            const preparation = prepareStructuredCustomerAction({
              envelope: input.trustedCustomerAction,
              revisionValidated: false,
              state: verifiedState as unknown as AgentGraphState,
            });
            if (preparation.kind === 'reject') {
              return {
                status: 422,
                body: { errorCode: preparation.errorCode },
              };
            }
            if (
              preparation.kind === 'present' &&
              command.kind === 'select_payment_method' &&
              preparation.state.selectedPaymentMethod
            ) {
              selectedPaymentMethod = preparation.state.selectedPaymentMethod;
            }
            if (preparation.kind === 'execute') {
              requiredToolCalls = [
                {
                  name: preparation.call.toolName,
                  arguments: directAgentToolArguments(
                    preparation.call.toolName,
                    preparation.call.arguments,
                  ),
                },
                ...(command.kind === 'confirm_order' &&
                preparation.call.toolName === 'previewOrder' &&
                preparation.afterTool === 'prepare'
                  ? [{ name: 'placeOrder', arguments: {} }]
                  : []),
              ];
            }
          }
        }
        const directOutput = await directTurnService.run({
          sessionId: input.sessionId,
          customerId: input.customerId,
          channel: 'kfc',
          text: input.text,
          externalMessageId: input.clientMessageId,
          metadata: directMetadata,
          fence: runGuard.commitFence,
          prepareSession: (session) => {
            return {
              session: selectedPaymentMethod
                ? { ...session, selectedPaymentMethod }
                : session,
              requiredToolCalls,
              allowModelToolCalls: !input.trustedCustomerAction,
            };
          },
          ...(directMetadata.responseProfile === 'social'
            ? {}
            : {
                selectGenUi: (result, session) =>
                  selectKfcOpenAiGenUi({
                    session,
                    latestUserMessage: input.text,
                    toolCalls: result.toolCalls,
                    customerCommand: directMetadata.customerCommand,
                  }),
              }),
        });
        if (directOutput.stateCommit === 'stale') {
          await reservation.fence.fail('agent_run_superseded');
          return {
            status: 409,
            body: {
              errorCode: 'agent_run_superseded',
              sessionId: input.sessionId,
              suppressed: true,
            },
          };
        }
        const presentation = buildChannelPresentation({
          channel: 'kfc',
          responseProfile: directMetadata.responseProfile,
          graphResponseText: directOutput.responseText,
          genUi: directOutput.genUi,
        });
        const responseBody = {
          agentRuntime: 'openai-responses',
          status: 'completed',
          sessionId: input.sessionId,
          customerId: input.customerId,
          userTurnId: directOutput.userTurnId,
          assistantTurnId: directOutput.assistantTurnId,
          responseText: directOutput.responseText,
          presentation,
          ...(directOutput.genUi ? { genUi: directOutput.genUi } : {}),
          usage: directOutput.usage,
          replayed: false,
        };
        const completion = await reservation.fence.complete({
          status: 200,
          body: responseBody,
        });
        await store.updateTurnDeliveryStatus(
          directOutput.assistantTurnId,
          completion.completedByOwner ? 'sent' : 'failed',
          null,
        );
        if (completion.completedByOwner) {
          dashboard.emitEvent({
            id: dashboardEventId(input.sessionId, 'assistant_reply_sent'),
            sessionId: input.sessionId,
            type: 'assistant_reply_sent',
            payload: {
              deliveryStatus: 'sent',
              deliveryPath: 'kfc_http_response',
              assistantTurnId: directOutput.assistantTurnId,
            },
            createdAt: new Date().toISOString(),
          });
        }
        return completion.response;
      }
      const output = await runAgentTurn({
        sessionId: input.sessionId,
        customerId: input.customerId,
        channel: 'kfc',
        responseProfile: trustedMetadata.responseProfile,
        text: input.text,
        externalMessageId: input.clientMessageId,
        metadata: trustedMetadata,
        trustedCustomerAction: input.trustedCustomerAction,
        clients: await createFirstPartyKfcClients(
          input.sessionId,
          trustedMetadata,
        ),
        store,
        dashboard,
        agentModel: options.agent?.model,
        tracer: options.agentTracer,
        checkpointer: options.checkpointer,
        accessContext,
        observeRun: input.observeRun ?? streamingObserver?.observe,
        runGuard,
      });

      if (output.suppressed || !(await runGuard.isCurrent())) {
        if (output.assistantTurnId) {
          await store.updateTurnDeliveryStatus(
            output.assistantTurnId,
            'failed',
            null,
          );
        }
        await reservation.fence.fail('agent_run_superseded');
        return {
          status: 409,
          body: {
            errorCode: 'agent_run_superseded',
            sessionId: input.sessionId,
            suppressed: true,
          },
        };
      }

      const userTurn = [...(output.state.recentTurns ?? [])]
        .reverse()
        .find((turn) => turn.externalMessageId === input.clientMessageId);

      let publicPause:
        | Awaited<ReturnType<typeof confirmationPausePointerForDurableEvent>>
        | undefined;
      if (output.pause) {
        await persistCanonicalConfirmationPause({
          store,
          sessionId: input.sessionId,
          customerId: input.customerId,
          channel: 'kfc',
          pause: output.pause,
          accessContext,
          checkpointer: options.checkpointer,
          ...(runGuard
            ? {
                runCommit: {
                  fence: runGuard.commitFence,
                  state: output.state,
                },
              }
            : {}),
        });
        publicPause = await confirmationPausePointerForDurableEvent({
          pause: output.pause,
          store,
        });
      }

      const responseBody = durableKfcAgentResponseBody({
        output,
        ...(publicPause ? { pause: publicPause } : {}),
        sessionId: input.sessionId,
        customerId: input.customerId,
        userTurnId: userTurn?.id ?? null,
      });

      const completion = await reservation.fence.complete({
        status: 200,
        body: responseBody,
      });
      const completedResponse = completion.response;
      if (completedResponse.status !== 200) {
        if (output.assistantTurnId) {
          await store.updateTurnDeliveryStatus(
            output.assistantTurnId,
            'failed',
            null,
          );
        }
        return completedResponse;
      }

      if (output.assistantTurnId) {
        await store.updateTurnDeliveryStatus(
          output.assistantTurnId,
          'sent',
          null,
        );
        dashboard.emitEvent({
          id: dashboardEventId(input.sessionId, 'assistant_reply_sent'),
          sessionId: input.sessionId,
          type: 'assistant_reply_sent',
          payload: {
            deliveryStatus: 'sent',
            deliveryPath: 'kfc_http_response',
            assistantTurnId: output.assistantTurnId,
          },
          createdAt: new Date().toISOString(),
        });
      }

      deferAiMonitorRefinement({
        sessionId: input.sessionId,
        clientMessageId: input.clientMessageId,
        output,
        metadata: input.metadata,
      });

      return currentOwnerKfcAgentResponse({
        completion,
        transientGenUi: output.genUi,
      });
    } catch (error) {
      await reservation.fence.fail(error);
      if (
        error instanceof Error &&
        error.message === 'customer_run_cancelled'
      ) {
        return {
          status: 409,
          body: {
            errorCode: 'agent_run_superseded',
            sessionId: input.sessionId,
            suppressed: true,
          },
        };
      }
      throw error;
    }
  }

  const deliverAssistantReply = (delivery: DeliverChannelAssistantReplyInput) =>
    deliverChannelAssistantReply({ store, dashboard, delivery });

  async function persistEventProfile(event: ConversationEvent): Promise<void> {
    if (event.profile?.displayName || event.profile?.avatarUrl) {
      await store.upsertProfile(event.profile);
    }
  }

  function turnMetadataFor(
    event: ConversationEvent,
  ): ConversationTurnMetadata | null {
    if (
      !event.platformEventName &&
      !event.attachments?.length &&
      !event.rawEvent
    )
      return null;
    return {
      platformEventName: event.platformEventName,
      attachments: event.attachments,
      rawEvent: event.rawEvent,
    };
  }

  function emitConversationTurnCreatedEvent(turn: {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    channel: ConversationEvent['channel'];
    deliveryStatus: ConversationTurn['deliveryStatus'];
    externalMessageId: string | null;
    externalUserId: string | null;
    text: string;
    metadata?: ConversationTurnMetadata | null;
  }): void {
    dashboard.emitEvent({
      id: dashboardEventId(turn.sessionId, 'conversation_turn_created'),
      sessionId: turn.sessionId,
      type: 'conversation_turn_created',
      payload: {
        turnId: turn.id,
        role: turn.role,
        channel: turn.channel,
        deliveryStatus: turn.deliveryStatus,
        externalMessageId: turn.externalMessageId,
        externalUserId: turn.externalUserId,
        text: turn.text,
        metadata: turn.metadata ?? null,
      },
      createdAt: new Date().toISOString(),
    });
  }

  function emitSessionModeEvent(input: {
    sessionId: string;
    updateType: 'human_joined' | 'human_message_sent' | 'ai_resumed';
    agentMode: AgentMode;
    agentId?: string | null;
    text?: string;
  }): void {
    dashboard.emitEvent({
      id: dashboardEventId(input.sessionId, 'session_updated'),
      sessionId: input.sessionId,
      type: 'session_updated',
      payload: {
        updateType: input.updateType,
        agentMode: input.agentMode,
        agentId: input.agentId ?? null,
        text: input.text,
      },
      createdAt: new Date().toISOString(),
    });
  }

  async function clearPersistedHandoff(sessionId: string): Promise<void> {
    const events = await store.listEvents(sessionId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.sourceType !== 'graph:verified_state') continue;
      const value = event.payload.verifiedState;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return;
      }
      const { handoff: _handoff, ...verifiedState } = value as Record<
        string,
        unknown
      >;
      await store.appendEvent(sessionId, 'graph:verified_state', {
        verifiedState,
      });
      return;
    }
  }

  async function persistedHandoffStatus(
    sessionId: string,
    agentMode: AgentMode,
  ): Promise<'queued' | 'joined' | undefined> {
    if (agentMode === 'human_paused') return 'joined';
    const events = await store.listEvents(sessionId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.sourceType !== 'graph:verified_state') continue;
      const verifiedState = event.payload.verifiedState;
      return isRecord(verifiedState) && isRecord(verifiedState.handoff)
        ? 'queued'
        : undefined;
    }
    return undefined;
  }

  async function persistNonAgentInboundEvent(
    sessionId: string,
    event: ConversationEvent,
  ): Promise<void> {
    const turn = await store.appendTurn({
      sessionId,
      channel: event.channel,
      role: 'user',
      text: event.text,
      externalMessageId: event.rawEventId,
      externalUserId: event.externalUserId,
      deliveryStatus: 'received',
      metadata: turnMetadataFor(event),
    });
    dashboard.emitEvent({
      id: dashboardEventId(sessionId, 'customer_message_received'),
      sessionId,
      type: 'customer_message_received',
      payload: {
        turnId: turn.id,
        channel: turn.channel,
        externalMessageId: turn.externalMessageId,
        externalUserId: turn.externalUserId,
        text: turn.text,
        metadata: turn.metadata,
      },
      createdAt: new Date().toISOString(),
    });
    emitConversationTurnCreatedEvent(turn);
  }

  async function pauseIfHumanJoined(
    sessionId: string,
    event: ConversationEvent,
  ): Promise<boolean> {
    const control = await store.getSessionControl(sessionId);
    if (control.agentMode !== 'human_paused') return false;
    await persistNonAgentInboundEvent(sessionId, event);
    dashboard.emitEvent({
      id: dashboardEventId(sessionId, 'assistant_reply_skipped'),
      sessionId,
      type: 'assistant_reply_skipped',
      payload: {
        reason: 'human_paused',
        agentMode: control.agentMode,
        agentId: control.assignedAgentId,
        channel: event.channel,
        externalMessageId: event.rawEventId,
        externalUserId: event.externalUserId,
        text: event.text,
      },
      createdAt: new Date().toISOString(),
    });
    return true;
  }

  function latestUnansweredCustomerTurn(
    turns: Awaited<ReturnType<ConversationStore['listTurns']>>,
  ) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.role === 'assistant') return null;
      if (turn.role === 'user') return turn;
    }
    return null;
  }

  async function replyToLatestUnansweredCustomerTurn(
    sessionId: string,
  ): Promise<{
    replied: boolean;
    turnId?: string;
    errorCode?: string;
    errorMessage?: string;
  }> {
    const pendingTurn = latestUnansweredCustomerTurn(
      await store.listTurns(sessionId),
    );
    if (!pendingTurn) return { replied: false };

    const target = channelTargetForSession(sessionId);
    if (!target) return { replied: false };

    return {
      replied: false,
      turnId: pendingTurn.id,
      errorCode: 'agent_run_execution_required',
      errorMessage: `AI resume for ${target.channel} requires a claimed AgentRun`,
    };
  }

  return {
    runDirectKfcTurn: directTurnService?.run.bind(directTurnService),
    kfcAgentResponse,
    deferAiMonitorRefinement,
    deliverAssistantReply,
    persistEventProfile,
    turnMetadataFor,
    emitConversationTurnCreatedEvent,
    emitSessionModeEvent,
    emitSessionControlIntelligence,
    resumedOwnershipSummary,
    clearPersistedHandoff,
    persistedHandoffStatus,
    shouldEvaluateDashboardMonitorContext,
    ensureDashboardMonitorContext,
    persistNonAgentInboundEvent,
    pauseIfHumanJoined,
    latestUnansweredCustomerTurn,
    replyToLatestUnansweredCustomerTurn,
  };
}

export type RouteAgentRuntime = ReturnType<typeof createRouteAgentRuntime>;
