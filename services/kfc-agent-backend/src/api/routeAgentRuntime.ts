import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
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
import { runAgentTurn } from '../agent/kfcAgent.js';
import {
  loadVerifiedStateProjection,
  persistVerifiedStateProjection,
} from '../agent/verifiedState.js';
import { kfcVietnamPack } from '../businessPacks/kfcVietnam/kfcVietnamPack.js';
import type { AgentTurnOutput } from '../agent/agentTurn.js';
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
    if (!options.agent && process.env.NODE_ENV !== 'test') {
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
    const reservation = await reserveKfcSynchronousRequest({
      store,
      sessionId: input.sessionId,
      clientMessageId: input.clientMessageId,
      bindingFingerprint: requestFingerprint,
      locallyActiveRequestIds: locallyActiveSynchronousRequests,
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
        agentModelIdentity: options.agent?.identity,
        tracer: options.agentTracer,
        deferTrace: options.defer,
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

      const responseBody = durableKfcAgentResponseBody({
        output,
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
    const state = await loadVerifiedStateProjection({
      store,
      sessionId,
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      parseState: kfcVietnamPack.parseState,
    });
    if (!state?.handoff) return;
    const { handoff: _handoff, ...withoutHandoff } = state;
    await persistVerifiedStateProjection({
      store,
      sessionId,
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: withoutHandoff,
    });
  }

  async function persistedHandoffStatus(
    sessionId: string,
    agentMode: AgentMode,
  ): Promise<'queued' | 'joined' | undefined> {
    if (agentMode === 'human_paused') return 'joined';
    const state = await loadVerifiedStateProjection({
      store,
      sessionId,
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      parseState: kfcVietnamPack.parseState,
    });
    return state?.handoff ? 'queued' : undefined;
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
