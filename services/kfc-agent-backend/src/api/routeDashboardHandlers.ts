import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type {
  ChannelMediaDeliveryResult,
  ExternalClients,
  MessengerClient,
  MessengerSenderAction,
} from "../clients/interfaces.js";
import type { KfcCommerceGatewayClients } from "../clients/kfcCommerceGateway.js";
import {
  LifecycleError,
  type CreateLifecycleInput,
  type LifecycleBinding,
  type LifecycleInstance,
  type LifecycleTransition,
  type MutationContext,
  type SandboxLifecycleControls,
  projectLifecycleCommerceClients,
} from "../commerce/lifecycleProvider.js";
import { createCatalogObservationClients } from "../clients/catalogObservationClients.js";
import {
  fetchCatalogObservation,
  type CatalogObservation,
  type CommerceEnvironment,
} from "../catalog/catalogObservation.js";
import type { ConversationEvent } from "../channels/conversationEvent.js";
import type { MessengerHistorySyncCoordinator } from "../channels/messengerHistory.js";
import {
  createMessengerClient,
  normalizeMessengerWebhook,
  verifyMessengerChallenge,
} from "../channels/messenger.js";
import { createZaloClient, normalizeZaloWebhook } from "../channels/zalo.js";
import { DashboardEventBus } from "../dashboard/eventBus.js";
import { dashboardSessionTarget } from "../dashboard/sessionVisibility.js";
import type { GeneratedFixtures } from "../fixtures/schema.js";
import { loadGeneratedFixtures } from "../fixtures/loadFixtures.js";
import type {
  AgentMode,
  Channel,
  ConversationProfile,
  ConversationTurnMetadata,
  CustomerAccessContext,
  MonitorSessionIntelligence,
  ToolResult,
} from "../domain/types.js";
import { customerCommandFromVerifiedAction } from "../domain/customerCommand.js";
import {
  isKfcGenUiAttachment,
  normalizeGenUiActionToText,
} from "../genui/kfcGenUi.js";
import { runAgentTurn } from "../graph/buildGraph.js";
import type { AgentGraphState } from "../graph/state.js";
import {
  calculateMonitorSessionIntelligence,
  preserveMonitorContext,
  countCustomerTurns,
  monitorContextReevaluationCustomerTurnThreshold,
  resolveMonitorSessionIntelligence,
  type MonitorSessionIntelligenceJudge,
} from "../monitor/sessionIntelligence.js";
import type { ResponseComposer } from "../llm/responseComposer.js";
import type { SmallTalkRouter } from "../llm/smallTalkRouter.js";
import type { ToolPlanner } from "../llm/toolPlanner.js";
import type { AgentTracer } from "../observability/agentTracing.js";
import {
  createMockClients,
  type MockClientOptions,
} from "../mock/createMockClients.js";
import {
  applyMockedUpstreamFixtureOverrides,
  mockedUpstreamApiProfileSchema,
  mockedUpstreamClientOptions,
} from "../mock/mockedUpstreamProfile.js";
import type { ToolName } from "../ordering/types.js";
import { CustomerRunCoordinator, type CustomerRunObservation } from "../customerRuns/runtime.js";
import {
  kfcSessionMatchesCustomer,
  type CustomerRunStartRequest,
} from "../customerRuns/contracts.js";
import {
  MemoryStore,
  type ConversationStore,
  type WebhookDelivery,
} from "../persistence/memoryStore.js";
import {
  buildBoundedRecentTurns,
  sessionIdForConversationEvent,
} from "../session/sessionContext.js";
import {
  textOnlyPresentation,
  type ChannelPresentationPlan,
} from "../presentation/channelPresentation.js";
import {
  ShowcaseService,
  ShowcaseValidationError,
  type ShowcaseScenarioSource,
} from "../showcase/showcase.js";
import { isRecord, canonicalJson, sha256Fingerprint, kfcSessionIdSchema, kfcChatPayloadSchema, kfcGenUiActionPayloadSchema, kfcSmartMenuBatchPayloadSchema, messengerHistorySyncPayloadSchema, staleMessengerRecoveryPayloadSchema, sessionControlPayloadSchema, dashboardSessionDefaultLookbackMs, humanMessagePayloadSchema, lifecycleTransitionSchema, lifecycleEventPayloadSchema, confirmationResumePayloadSchema, kfcProofPreconditionsSchema, lifecycleErrorResponse, ReadinessCheckResult, ReadinessOptions, RouteOptions, HandlerResponse, MessengerWebhookEventProcessingResult, StaleMessengerDeliveryRecoveryResult, RouteHandlers, defaultFixturesRoot } from './routeHandlerContracts.js';
import { messengerDeliveryFailureForStorage, eventFromMessengerDelivery, sendMessengerSenderAction, dashboardEventId, checkCommerceGatewayReadiness, checkCatalogReadiness, runReadinessCheck, checkFixtures, checkMessengerConfig, checkZaloConfig, deeplinkForSession, renderInboxUrlTemplate, ChannelProfileTarget, channelTargetForSession, humanChannelTargetForSession } from './routeHandlerSupport.js';

import type { RouteHandlerContext } from './routeHandlerContext.js';

export function createDashboardRouteHandlers(context: RouteHandlerContext) {
  const { options, store, dashboard, showcase, streamingRunObservers, customerRuns, getFixtures, withConfiguredCommerce, createWebhookClients, createDeliveryClients, dashboardProfileForTarget, createFirstPartyKfcClients, kfcProofAccessContext, latestKfcProofPreconditions, kfcAgentResponse, deferAiMonitorRefinement, deliverAssistantReply, persistEventProfile, turnMetadataFor, emitConversationTurnCreatedEvent, emitSessionModeEvent, emitSessionControlIntelligence, resumedOwnershipSummary, clearPersistedHandoff, persistedHandoffStatus, shouldEvaluateDashboardMonitorContext, ensureDashboardMonitorContext, persistNonAgentInboundEvent, pauseIfHumanJoined, latestUnansweredCustomerTurn, replyToLatestUnansweredCustomerTurn, processMessengerEventInternal, recoverStaleMessengerDeliveriesInternal, processMessengerAgentRunInternal } = context;
  async function syncMessengerHistoryForDashboard(
    since?: string,
  ): Promise<void> {
    if (!options.messengerHistorySync) return;
    try {
      await options.messengerHistorySync.sync(since ? { since } : undefined);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Messenger history sync is already running"
      )
        return;
      throw error;
    }
  }

  return {
    async dashboardHumanJoin(sessionId: string, body: unknown) {
      const parsed = sessionControlPayloadSchema.safeParse(body);
      if (!parsed.success)
        return {
          status: 400,
          body: {
            errorCode: "invalid_session_control_payload",
            issues: parsed.error.issues,
          },
        };

      const control = await store.setSessionControl(sessionId, {
        agentMode: "human_paused",
        assignedAgentId: parsed.data.agentId ?? null,
      });
      emitSessionModeEvent({
        sessionId,
        updateType: "human_joined",
        agentMode: control.agentMode,
        agentId: control.assignedAgentId,
      });
      await emitSessionControlIntelligence({ sessionId, humanJoined: true });
      return { status: 200, body: control };
    },
    async dashboardHumanMessage(sessionId: string, body: unknown) {
      const parsed = humanMessagePayloadSchema.safeParse(body);
      if (!parsed.success)
        return {
          status: 400,
          body: {
            errorCode: "invalid_human_message_payload",
            issues: parsed.error.issues,
          },
        };

      const channelTarget = humanChannelTargetForSession(sessionId);
      if (!channelTarget)
        return {
          status: 400,
          body: { errorCode: "unsupported_human_message_session" },
        };

      const turn = await store.appendTurn({
        sessionId,
        channel: channelTarget.channel,
        role: "assistant",
        text: parsed.data.text,
        externalMessageId: null,
        externalUserId: channelTarget.externalUserId,
        deliveryStatus: "pending",
        metadata: { authorType: "human_agent", agentId: parsed.data.agentId },
      });
      emitConversationTurnCreatedEvent(turn);

      const delivery = channelTarget.channel === "kfc"
        ? { ok: true as const }
        : await deliverAssistantReply({
            clients: createDeliveryClients(),
            sessionId,
            externalUserId: channelTarget.externalUserId,
            presentation: textOnlyPresentation(parsed.data.text, channelTarget.channel),
            channel: channelTarget.channel,
          });
      if (channelTarget.channel === "kfc") {
        await store.updateTurnDeliveryStatus(turn.id, "sent", null);
      }
      if (!delivery.ok) {
        return {
          status: 502,
          body: {
            errorCode: delivery.errorCode ?? "human_message_delivery_failed",
            errorMessage: delivery.errorMessage,
          },
        };
      }

      emitSessionModeEvent({
        sessionId,
        updateType: "human_message_sent",
        agentMode: (await store.getSessionControl(sessionId)).agentMode,
        agentId: parsed.data.agentId,
        text: parsed.data.text,
      });
      await emitSessionControlIntelligence({
        sessionId,
        humanJoined:
          (await store.getSessionControl(sessionId)).agentMode ===
          "human_paused",
      });
      return { status: 200, body: { ok: true, turnId: turn.id } };
    },
    async dashboardResumeAi(sessionId: string, body: unknown) {
      const parsed = sessionControlPayloadSchema.safeParse(body);
      if (!parsed.success)
        return {
          status: 400,
          body: {
            errorCode: "invalid_session_control_payload",
            issues: parsed.error.issues,
          },
        };

      await clearPersistedHandoff(sessionId);
      const control = await store.setSessionControl(sessionId, {
        agentMode: "ai_active",
        assignedAgentId: null,
      });
      emitSessionModeEvent({
        sessionId,
        updateType: "ai_resumed",
        agentMode: control.agentMode,
        agentId: parsed.data.agentId ?? null,
      });
      await emitSessionControlIntelligence({ sessionId, aiResumed: true });
      if (dashboardSessionTarget(sessionId)?.channel === "kfc") {
        return { status: 200, body: { ...control, recoveredUnanswered: false } };
      }
      const recovery = await replyToLatestUnansweredCustomerTurn(sessionId);
      if (recovery.errorCode) {
        return {
          status: 502,
          body: {
            ...control,
            recoveredUnanswered: false,
            errorCode: recovery.errorCode,
            errorMessage: recovery.errorMessage,
          },
        };
      }
      return {
        status: 200,
        body: { ...control, recoveredUnanswered: recovery.replied },
      };
    },
    async dashboardSessionControl(sessionId: string) {
      return { status: 200, body: await store.getSessionControl(sessionId) };
    },
    dashboardEvents(sessionId: string) {
      return { status: 200, body: { events: dashboard.getEvents(sessionId) } };
    },
    async dashboardSessions() {
      const updatedSince = new Date(
        Date.now() - dashboardSessionDefaultLookbackMs,
      ).toISOString();
      await syncMessengerHistoryForDashboard();
      const summaries = await Promise.all(
        dashboard
          .listSessionSummaries({ updatedSince })
          .filter(
            (summary) =>
              dashboardSessionTarget(summary.sessionId) !== undefined,
          )
          .map(async (summary) => {
            const target = dashboardSessionTarget(summary.sessionId);
            const profileTarget = channelTargetForSession(summary.sessionId);
            const [profile, control, sessionIntelligence] = await Promise.all([
              profileTarget
                ? dashboardProfileForTarget(profileTarget)
                : Promise.resolve(undefined),
              store.getSessionControl(summary.sessionId),
              ensureDashboardMonitorContext({
                sessionId: summary.sessionId,
                existing: summary.sessionIntelligence,
              }),
            ]);
            return {
              ...summary,
              sessionIntelligence,
              agentMode: control.agentMode,
              assignedAgentId: control.assignedAgentId,
              controlUpdatedAt: control.updatedAt,
              externalUserId: target?.externalUserId ?? null,
              displayName: profile?.displayName ?? null,
              avatarUrl: profile?.avatarUrl ?? null,
              deeplink: deeplinkForSession(summary.sessionId, {
                metaPageId: options.metaPageId,
                metaInboxUrlTemplate: options.metaInboxUrlTemplate,
                zaloOaId: options.zaloOaId,
                zaloInboxUrlTemplate: options.zaloInboxUrlTemplate,
              }),
            };
          }),
      );
      return { status: 200, body: { sessions: summaries } };
    },
    async dashboardTurns(sessionId: string) {
      let turns = await store.listTurns(sessionId);
      if (sessionId.startsWith("messenger:") && turns.length === 0) {
        const updatedSince = new Date(
          Date.now() - dashboardSessionDefaultLookbackMs,
        ).toISOString();
        await syncMessengerHistoryForDashboard();
        turns = await store.listTurns(sessionId);
      }
      return { status: 200, body: { turns } };
    },
  };
}
