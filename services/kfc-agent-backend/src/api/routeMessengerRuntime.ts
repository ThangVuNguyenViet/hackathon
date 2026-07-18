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

import type { RouteCommerceRuntime } from './routeCommerceRuntime.js';
import type { RouteAgentRuntime } from './routeAgentRuntime.js';

export function createRouteMessengerRuntime(input: { options: RouteOptions; store: ConversationStore; dashboard: DashboardEventBus } & RouteCommerceRuntime & RouteAgentRuntime) {
  const { options, store, dashboard, getFixtures, withConfiguredCommerce, createWebhookClients, createDeliveryClients, dashboardProfileForTarget, createFirstPartyKfcClients, kfcProofAccessContext, latestKfcProofPreconditions, kfcAgentResponse, deferAiMonitorRefinement, deliverAssistantReply, persistEventProfile, turnMetadataFor, emitConversationTurnCreatedEvent, emitSessionModeEvent, emitSessionControlIntelligence, resumedOwnershipSummary, clearPersistedHandoff, persistedHandoffStatus, shouldEvaluateDashboardMonitorContext, ensureDashboardMonitorContext, persistNonAgentInboundEvent, pauseIfHumanJoined, latestUnansweredCustomerTurn, replyToLatestUnansweredCustomerTurn } = input;
  async function processMessengerEventInternal(
    event: ConversationEvent,
  ): Promise<MessengerWebhookEventProcessingResult> {
    const sessionId = sessionIdForConversationEvent(event);
    const delivery = await store.getWebhookDelivery(
      "messenger",
      event.rawEventId,
    );
    if (delivery?.status === "processed") {
      return { status: "skipped" };
    }

    let clients: ExternalClients | undefined;
    let typingStarted = false;
    try {
      await persistEventProfile(event);
      clients = await createWebhookClients(sessionId);
      await sendMessengerSenderAction(
        clients.messenger,
        event.externalUserId,
        "mark_seen",
        event.rawEventId,
      );
      typingStarted = await sendMessengerSenderAction(
        clients.messenger,
        event.externalUserId,
        "typing_on",
        event.rawEventId,
      );
      const profileResult = await clients.messenger.getProfile(
        event.externalUserId,
      );
      if (profileResult.ok) {
        const profile = profileResult.value;
        await store.upsertProfile({
          channel: "messenger",
          externalUserId: event.externalUserId,
          displayName: profile?.displayName ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          profileSource: profile?.profileSource ?? "messenger_profile_api",
          profileUpdatedAt: new Date().toISOString(),
        });
      }

      if (await pauseIfHumanJoined(sessionId, event)) {
        await store.markWebhookDeliveryProcessed("messenger", event.rawEventId);
        return { status: "processed" };
      }

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
        workflowRouter: options.workflowRouter,
        monitorJudge: options.monitorJudge,
        tracer: options.agentTracer,
        checkpointer: options.checkpointer,
      });
      const deliveryResult = await deliverAssistantReply({
        clients,
        sessionId,
        externalUserId: event.externalUserId,
        presentation: output.presentation,
        channel: "messenger",
      });
      if (deliveryResult.ok) {
        deferAiMonitorRefinement({
          sessionId,
          clientMessageId: event.rawEventId,
          output,
        });
        await store.markWebhookDeliveryProcessed("messenger", event.rawEventId);
        return { status: "processed" };
      }

      await store.markWebhookDeliveryFailed(
        "messenger",
        event.rawEventId,
        messengerDeliveryFailureForStorage(deliveryResult),
      );
      return {
        status: "failed",
        errorCode:
          deliveryResult.errorCode ?? "assistant_reply_delivery_failed",
        errorMessage: deliveryResult.errorMessage,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown Messenger webhook failure";
      await store.markWebhookDeliveryFailed(
        "messenger",
        event.rawEventId,
        errorMessage,
      );
      return {
        status: "failed",
        errorCode: "messenger_webhook_processing_failed",
        errorMessage,
      };
    } finally {
      if (typingStarted && clients) {
        await sendMessengerSenderAction(
          clients.messenger,
          event.externalUserId,
          "typing_off",
          event.rawEventId,
        );
      }
    }
  }

  async function recoverStaleMessengerDeliveriesInternal(
    body?: unknown,
  ): Promise<HandlerResponse<StaleMessengerDeliveryRecoveryResult>> {
    const parsed = staleMessengerRecoveryPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: {
          scanned: 0,
          processed: 0,
          failed: 0,
          skipped: 0,
          cutoff: new Date().toISOString(),
          deliveries: [],
        },
      };
    }

    const olderThanMs = parsed.data?.olderThanMs ?? 60_000;
    const limit = parsed.data?.limit ?? 25;
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const staleDeliveries = await store.listStaleWebhookDeliveries(
      "messenger",
      cutoff,
      limit,
    );
    const result: StaleMessengerDeliveryRecoveryResult = {
      scanned: staleDeliveries.length,
      processed: 0,
      failed: 0,
      skipped: 0,
      cutoff,
      deliveries: [],
    };

    for (const delivery of staleDeliveries) {
      const event = eventFromMessengerDelivery(delivery);
      if (!event) {
        await store.markWebhookDeliveryFailed(
          "messenger",
          delivery.externalEventId,
          "messenger_delivery_recovery_invalid_payload",
        );
        result.failed += 1;
        result.deliveries.push({
          externalEventId: delivery.externalEventId,
          sessionId: delivery.sessionId,
          status: "invalid",
          errorCode: "messenger_delivery_recovery_invalid_payload",
        });
        continue;
      }

      const deliveryResult = await processMessengerEventInternal(event);
      if (deliveryResult.status === "processed") result.processed += 1;
      else if (deliveryResult.status === "skipped") result.skipped += 1;
      else result.failed += 1;
      result.deliveries.push({
        externalEventId: delivery.externalEventId,
        sessionId: delivery.sessionId,
        status: deliveryResult.status,
        errorCode: deliveryResult.errorCode,
        errorMessage: deliveryResult.errorMessage,
      });
    }

    return { status: 200, body: result };
  }

  async function processMessengerAgentRunInternal(
    runId: string,
  ): Promise<MessengerWebhookEventProcessingResult> {
    const run = await store.getAgentRun(runId);
    if (!run) return { status: "skipped", errorCode: "agent_run_not_found" };
    if (run.status === "completed") return { status: "skipped" };
    if (run.status === "superseded")
      return { status: "skipped", errorCode: "stale_agent_run" };

    const isCurrentRun = async () => {
      const state = await store.getSessionAgentState(run.sessionId);
      const latestRun = await store.getAgentRun(run.id);
      return (
        state.currentRunId === run.id &&
        state.generation === run.generation &&
        latestRun !== undefined &&
        (latestRun.status === "scheduled" || latestRun.status === "running")
      );
    };
    const suppressRun = async (reason: string) => {
      await store.updateAgentRun(run.id, {
        status: "superseded",
        deliveryStatus: "suppressed",
        errorCode: "stale_agent_run",
        errorMessage: reason,
        completedAt: new Date().toISOString(),
      });
      dashboard.emitEvent({
        id: `dash_${run.sessionId}_${run.id}_delivery_suppressed`,
        sessionId: run.sessionId,
        type: "agent_run_delivery_suppressed",
        payload: { runId: run.id, generation: run.generation, reason },
        createdAt: new Date().toISOString(),
      });
    };

    if (!(await isCurrentRun())) {
      await suppressRun("run_not_current_before_start");
      return { status: "skipped", errorCode: "stale_agent_run" };
    }

    const links = await store.listAgentRunTurns(run.id);
    const pendingTurns = await store.listPendingCustomerTurns(run.sessionId);
    const linkedTurns = links
      .map((link) => pendingTurns.find((turn) => turn.turnId === link.turnId))
      .filter((turn): turn is NonNullable<typeof turn> => Boolean(turn));
    if (linkedTurns.length === 0) {
      await store.updateAgentRun(run.id, {
        status: "failed",
        deliveryStatus: "not_applicable",
        errorCode: "agent_run_no_linked_turns",
        errorMessage: "No linked pending customer turns found for agent run",
        completedAt: new Date().toISOString(),
      });
      return { status: "failed", errorCode: "agent_run_no_linked_turns" };
    }

    await store.updateAgentRun(run.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    dashboard.emitEvent({
      id: `dash_${run.sessionId}_${run.id}_started`,
      sessionId: run.sessionId,
      type: "agent_run_started",
      payload: {
        runId: run.id,
        generation: run.generation,
        includedTurnCount: linkedTurns.length,
      },
      createdAt: new Date().toISOString(),
    });
    let clients: ExternalClients | undefined;
    let typingStarted = false;
    try {
      await persistEventProfile({
        channel: run.channel,
        eventType: "message",
        rawEventId: linkedTurns[0]!.externalMessageId,
        externalThreadId: run.externalUserId,
        externalUserId: run.externalUserId,
        text: linkedTurns[0]!.text,
        receivedAt: linkedTurns[0]!.receivedAt,
        shouldRunAgent: true,
      });

      for (const [index, turn] of linkedTurns.entries()) {
        const existing = await store.findTurnByExternalMessage(
          run.sessionId,
          turn.externalMessageId,
        );
        if (existing) continue;
        const createdAt = new Date(
          Date.parse(turn.receivedAt) + index,
        ).toISOString();
        const conversationTurn = await store.appendTurn({
          sessionId: run.sessionId,
          channel: run.channel,
          role: "user",
          text: turn.text,
          externalMessageId: turn.externalMessageId,
          externalUserId: turn.externalUserId,
          deliveryStatus: "received",
          metadata: null,
          createdAt,
        });
        dashboard.emitEvent({
          id: dashboardEventId(run.sessionId, "customer_message_received"),
          sessionId: run.sessionId,
          type: "customer_message_received",
          payload: {
            turnId: conversationTurn.id,
            channel: conversationTurn.channel,
            externalMessageId: conversationTurn.externalMessageId,
            externalUserId: conversationTurn.externalUserId,
            text: conversationTurn.text,
            metadata: conversationTurn.metadata,
          },
          createdAt: new Date().toISOString(),
        });
        emitConversationTurnCreatedEvent(conversationTurn);
      }

      clients = await createWebhookClients(run.sessionId);
      if (run.channel === "messenger") {
        await sendMessengerSenderAction(
          clients.messenger,
          run.externalUserId,
          "mark_seen",
          linkedTurns[0]!.externalMessageId,
        );
        typingStarted = await sendMessengerSenderAction(
          clients.messenger,
          run.externalUserId,
          "typing_on",
          linkedTurns[0]!.externalMessageId,
        );
      }
      const runGuard = {
        isCurrent: isCurrentRun,
        recordIrreversibleBoundary: async (toolName: ToolName) => {
          await store.updateAgentRun(run.id, {
            irreversibleSideEffectAt: new Date().toISOString(),
            irreversibleToolName: toolName,
          });
        },
      };
      const output = await runAgentTurn({
        sessionId: run.sessionId,
        customerId: run.externalUserId,
        channel: run.channel,
        text: run.coalescedInputText,
        externalMessageId: linkedTurns[0]!.externalMessageId,
        metadata: null,
        clients,
        store,
        dashboard,
        responseComposer: options.responseComposer,
        toolPlanner: options.toolPlanner,
        smallTalkRouter: options.smallTalkRouter,
        workflowRouter: options.workflowRouter,
        runGuard,
        monitorJudge: options.monitorJudge,
        tracer: options.agentTracer,
        checkpointer: options.checkpointer,
      });
      if (output.suppressed || !(await isCurrentRun())) {
        await suppressRun("run_not_current_before_delivery");
        return { status: "skipped", errorCode: "stale_agent_run" };
      }
      const delivery = await deliverAssistantReply({
        clients,
        sessionId: run.sessionId,
        externalUserId: run.externalUserId,
        presentation: output.presentation,
        channel: run.channel,
        assistantTurnId: output.assistantTurnId ?? null,
        runGuard,
      });
      if (delivery.suppressed) {
        await suppressRun("run_not_current_before_delivery");
        return { status: "skipped", errorCode: "stale_agent_run" };
      }
      if (delivery.ok) {
        deferAiMonitorRefinement({
          sessionId: run.sessionId,
          clientMessageId: linkedTurns[0]!.externalMessageId,
          output,
        });
      }
      const assistantTurnId =
        output.assistantTurnId ??
        [...(await store.listTurns(run.sessionId))]
          .reverse()
          .find((turn) => turn.role === "assistant")?.id ??
        null;

      await store.updateAgentRun(run.id, {
        status: delivery.ok ? "completed" : "failed",
        assistantTurnId,
        deliveryStatus: delivery.ok ? "sent" : "failed",
        deliveryExternalMessageId: delivery.externalMessageId ?? null,
        errorCode: delivery.ok
          ? null
          : (delivery.errorCode ?? "assistant_reply_delivery_failed"),
        errorMessage: delivery.ok
          ? null
          : (delivery.errorMessage ?? "Assistant reply delivery failed"),
        completedAt: new Date().toISOString(),
      });
      dashboard.emitEvent({
        id: `dash_${run.sessionId}_${run.id}_delivered`,
        sessionId: run.sessionId,
        type: "agent_run_delivered",
        payload: {
          runId: run.id,
          generation: run.generation,
          includedTurnCount: linkedTurns.length,
          assistantTurnId,
          deliveryStatus: delivery.ok ? "sent" : "failed",
        },
        createdAt: new Date().toISOString(),
      });
      for (const turn of linkedTurns) {
        if (delivery.ok) {
          await store.markPendingCustomerTurnClaimed(turn.turnId, run.id);
          await store.markWebhookDeliveryProcessed(
            run.channel,
            turn.externalMessageId,
          );
        } else {
          await store.markWebhookDeliveryFailed(
            run.channel,
            turn.externalMessageId,
            delivery.errorMessage ??
              delivery.errorCode ??
              "assistant_reply_delivery_failed",
          );
        }
      }

      return delivery.ok
        ? { status: "processed" }
        : {
            status: "failed",
            errorCode: delivery.errorCode ?? "assistant_reply_delivery_failed",
            errorMessage: delivery.errorMessage,
          };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown agent run processing failure";
      await store.updateAgentRun(run.id, {
        status: "failed",
        deliveryStatus: "failed",
        errorCode: "agent_run_processing_failed",
        errorMessage,
        completedAt: new Date().toISOString(),
      });
      return {
        status: "failed",
        errorCode: "agent_run_processing_failed",
        errorMessage,
      };
    } finally {
      if (typingStarted && clients) {
        await sendMessengerSenderAction(
          clients.messenger,
          run.externalUserId,
          "typing_off",
          linkedTurns[0]?.externalMessageId,
        );
      }
    }
  }


  return { processMessengerEventInternal, recoverStaleMessengerDeliveriesInternal, processMessengerAgentRunInternal };
}

export type RouteMessengerRuntime = ReturnType<typeof createRouteMessengerRuntime>;
