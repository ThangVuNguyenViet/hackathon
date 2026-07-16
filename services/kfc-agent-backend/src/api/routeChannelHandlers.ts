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

export function createChannelRouteHandlers(context: RouteHandlerContext) {
  const { options, store, dashboard, showcase, streamingRunObservers, customerRuns, getFixtures, withConfiguredCommerce, createWebhookClients, createDeliveryClients, dashboardProfileForTarget, createFirstPartyKfcClients, kfcProofAccessContext, latestKfcProofPreconditions, kfcAgentResponse, deferAiMonitorRefinement, deliverAssistantReply, persistEventProfile, turnMetadataFor, emitConversationTurnCreatedEvent, emitSessionModeEvent, emitSessionControlIntelligence, resumedOwnershipSummary, clearPersistedHandoff, persistedHandoffStatus, shouldEvaluateDashboardMonitorContext, ensureDashboardMonitorContext, persistNonAgentInboundEvent, pauseIfHumanJoined, latestUnansweredCustomerTurn, replyToLatestUnansweredCustomerTurn, processMessengerEventInternal, recoverStaleMessengerDeliveriesInternal, processMessengerAgentRunInternal } = context;
  return {
    messengerVerify(query: Record<string, unknown>) {
      const result = verifyMessengerChallenge(
        query,
        options.messengerVerifyToken ?? "",
      );
      return {
        status: result.statusCode,
        body: result.body,
        contentType: "text/plain",
      };
    },
    async messengerWebhook(body: unknown) {
      const events = normalizeMessengerWebhook(body, options.metaPageId ?? "");
      const stats = {
        received: events.length,
        processed: 0,
        skippedDuplicates: 0,
        failed: 0,
      };
      if (events.length === 0) return { status: 200, body: stats };

      for (const event of events) {
        const sessionId = sessionIdForConversationEvent(event);
        if (
          await store.findTurnByExternalMessage(sessionId, event.rawEventId)
        ) {
          stats.skippedDuplicates += 1;
          continue;
        }
        const reservation = await store.reserveWebhookDelivery({
          channel: "messenger",
          externalEventId: event.rawEventId,
          externalThreadId: event.externalThreadId,
          externalUserId: event.externalUserId,
          sessionId,
          receivedAt: event.receivedAt,
          payload: {
            eventType: event.eventType,
            text: event.text,
            receivedAt: event.receivedAt,
          },
        });
        if (!reservation.reserved) {
          stats.skippedDuplicates += 1;
          continue;
        }

        const result = await processMessengerEventInternal(event);
        if (result.status === "processed") stats.processed += 1;
        else if (result.status === "skipped") stats.skippedDuplicates += 1;
        else stats.failed += 1;
      }

      return { status: 200, body: stats };
    },
    async processMessengerEvent(event: ConversationEvent) {
      return processMessengerEventInternal(event);
    },
    async recoverStaleMessengerDeliveries(body?: unknown) {
      return recoverStaleMessengerDeliveriesInternal(body);
    },
    async processMessengerAgentRun(runId: string) {
      return processMessengerAgentRunInternal(runId);
    },
    async zaloWebhook(body: unknown) {
      const events = normalizeZaloWebhook(body, options.zaloOaId);
      const stats = {
        received: events.length,
        processed: 0,
        skippedDuplicates: 0,
        failed: 0,
      };
      if (events.length === 0) return { status: 200, body: stats };

      let clients: ExternalClients | undefined;

      for (const event of events) {
        const sessionId = sessionIdForConversationEvent(event);
        if (
          await store.findTurnByExternalMessage(sessionId, event.rawEventId)
        ) {
          stats.skippedDuplicates += 1;
          continue;
        }
        const reservation = await store.reserveWebhookDelivery({
          channel: "zalo",
          externalEventId: event.rawEventId,
          externalThreadId: event.externalThreadId,
          externalUserId: event.externalUserId,
          sessionId,
          receivedAt: event.receivedAt,
          payload: {
            eventType: event.eventType,
            text: event.text,
            receivedAt: event.receivedAt,
          },
        });
        if (!reservation.reserved) {
          stats.skippedDuplicates += 1;
          continue;
        }

        try {
          await persistEventProfile(event);

          if (!event.shouldRunAgent) {
            await persistNonAgentInboundEvent(sessionId, event);
            const deliveryClients = createDeliveryClients();
            const acknowledgement = event.acknowledgementText;
            if (acknowledgement) {
              const assistantTurn = await store.appendTurn({
                sessionId,
                channel: event.channel,
                role: "assistant",
                text: acknowledgement,
                externalMessageId: null,
                externalUserId: event.externalUserId,
                deliveryStatus: "pending",
                metadata: null,
              });
              emitConversationTurnCreatedEvent(assistantTurn);
              const delivery = await deliverAssistantReply({
                clients: deliveryClients,
                sessionId,
                externalUserId: event.externalUserId,
                presentation: textOnlyPresentation(acknowledgement, event.channel),
                channel: "zalo",
              });
              if (!delivery.ok) {
                await store.markWebhookDeliveryFailed(
                  "zalo",
                  event.rawEventId,
                  delivery.errorCode ?? "assistant_reply_delivery_failed",
                );
                stats.failed += 1;
                continue;
              }
            }
            await store.markWebhookDeliveryProcessed("zalo", event.rawEventId);
            stats.processed += 1;
            continue;
          }

          if (await pauseIfHumanJoined(sessionId, event)) {
            await store.markWebhookDeliveryProcessed("zalo", event.rawEventId);
            stats.processed += 1;
            continue;
          }

          clients ??= await createWebhookClients(sessionId);
          const output = await runAgentTurn({
            sessionId,
            customerId: event.externalUserId,
            channel: event.channel,
            text: event.text,
            externalMessageId: event.rawEventId,
            metadata: turnMetadataFor(event),
            clients,
            store,
            dashboard,
            responseComposer: options.responseComposer,
            toolPlanner: options.toolPlanner,
            smallTalkRouter: options.smallTalkRouter,
            monitorJudge: options.monitorJudge,
            tracer: options.agentTracer,
            checkpointer: options.checkpointer,
          });
          const delivery = await deliverAssistantReply({
            clients,
            sessionId,
            externalUserId: event.externalUserId,
            presentation: output.presentation,
            channel: "zalo",
          });
          if (delivery.ok) {
            deferAiMonitorRefinement({
              sessionId,
              clientMessageId: event.rawEventId,
              output,
            });
            await store.markWebhookDeliveryProcessed("zalo", event.rawEventId);
            stats.processed += 1;
          } else {
            await store.markWebhookDeliveryFailed(
              "zalo",
              event.rawEventId,
              delivery.errorCode ?? "assistant_reply_delivery_failed",
            );
            stats.failed += 1;
          }
        } catch (error) {
          await store.markWebhookDeliveryFailed(
            "zalo",
            event.rawEventId,
            error instanceof Error
              ? error.message
              : "Unknown Zalo webhook failure",
          );
          stats.failed += 1;
        }
      }

      return { status: 200, body: stats };
    },
    async messengerHistorySync(body: unknown) {
      if (!options.messengerHistorySync) {
        return {
          status: 503,
          body: { errorCode: "messenger_history_sync_not_configured" },
        };
      }
      const parsed = messengerHistorySyncPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            errorCode: "invalid_messenger_history_sync_payload",
            issues: parsed.error.issues,
          },
        };
      }
      return {
        status: 200,
        body: await options.messengerHistorySync.sync(parsed.data ?? {}),
      };
    },
    messengerHistorySyncStatus() {
      return {
        status: 200,
        body: options.messengerHistorySync?.getStatus() ?? {
          running: false,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastError: "Messenger history sync is not configured",
          lastResult: null,
        },
      };
    },

  };
}
