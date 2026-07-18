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

export type StreamingRunObservers = Map<string, { observe: (observation: CustomerRunObservation) => Promise<void>; isCurrent: () => Promise<boolean> }>;

export function createRouteAgentRuntime(input: { options: RouteOptions; store: ConversationStore; dashboard: DashboardEventBus; showcase: ShowcaseService | undefined; streamingRunObservers: StreamingRunObservers } & RouteCommerceRuntime) {
  const { options, store, dashboard, showcase, streamingRunObservers, getFixtures, withConfiguredCommerce, createWebhookClients, createDeliveryClients, dashboardProfileForTarget, createFirstPartyKfcClients, kfcProofAccessContext, latestKfcProofPreconditions } = input;
  async function kfcAgentResponse(input: {
    sessionId: string;
    customerId: string;
    clientMessageId: string;
    text: string;
    metadata: ConversationTurnMetadata;
    observeRun?: (observation: CustomerRunObservation) => Promise<void>;
    runGuard?: { isCurrent(): Promise<boolean> };
  }): Promise<HandlerResponse> {
    const trustedMetadata: ConversationTurnMetadata = {
      ...input.metadata,
      ...(options.readiness?.release ? { release: options.readiness.release } : {}),
    };
    const requestFingerprint = await sha256Fingerprint({
      customerId: input.customerId,
      text: input.text,
      metadata: trustedMetadata,
    });
    const priorRequest = (await store.listEvents(input.sessionId)).find(
      (event) =>
        event.sourceType === "kfc_request_completed" &&
        event.payload.clientMessageId === input.clientMessageId,
    );
    if (priorRequest) {
      if (priorRequest.payload.requestFingerprint !== requestFingerprint) {
        return {
          status: 409,
          body: {
            errorCode: "idempotency_conflict",
            originalRequestFingerprint:
              priorRequest.payload.requestFingerprint ?? null,
            conflictingRequestFingerprint: requestFingerprint,
          },
        };
      }
      const response = priorRequest.payload.response;
      if (isRecord(response)) {
        return { status: 200, body: { ...response, replayed: true } };
      }
    }

    const sessionControl = await store.getSessionControl(input.sessionId);
    if (sessionControl.agentMode === "human_paused") {
      const existingTurn = await store.findTurnByExternalMessage(
        input.sessionId,
        input.clientMessageId,
      );
      if (!existingTurn) {
        const turn = await store.appendTurn({
          sessionId: input.sessionId,
          channel: "kfc",
          role: "user",
          text: input.text,
          externalMessageId: input.clientMessageId,
          externalUserId: input.customerId,
          deliveryStatus: "received",
          metadata: trustedMetadata,
        });
        emitConversationTurnCreatedEvent(turn);
      }
      await store.appendEvent(input.sessionId, "assistant_reply_skipped", {
        reason: "human_paused",
        channel: "kfc",
        externalMessageId: input.clientMessageId,
      });
      return {
        status: 200,
        body: {
          sessionId: input.sessionId,
          responseText: "",
          presentation: textOnlyPresentation("", "kfc"),
          suppressed: true,
          agentMode: sessionControl.agentMode,
        },
      };
    }

    const output = await runAgentTurn({
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: "kfc",
      responseProfile: trustedMetadata.responseProfile,
      text: input.text,
      externalMessageId: input.clientMessageId,
      metadata: trustedMetadata,
      clients: await createFirstPartyKfcClients(input.sessionId, trustedMetadata),
      store,
      dashboard,
      responseComposer: options.responseComposer,
      toolPlanner: options.toolPlanner,
      smallTalkRouter: options.smallTalkRouter,
      workflowRouter: options.workflowRouter,
      monitorJudge: options.monitorJudge,
      tracer: options.agentTracer,
      checkpointer: options.checkpointer,
      accessContext: await kfcProofAccessContext(input.sessionId, input.customerId),
      observeRun: input.observeRun ?? streamingRunObservers.get(input.clientMessageId)?.observe,
      runGuard: input.runGuard ?? (
        streamingRunObservers.get(input.clientMessageId)
          ? { isCurrent: streamingRunObservers.get(input.clientMessageId)!.isCurrent }
          : undefined
      ),
    });

    if (output.assistantTurnId) {
      await store.updateTurnDeliveryStatus(
        output.assistantTurnId,
        "sent",
        null,
      );
      dashboard.emitEvent({
        id: dashboardEventId(input.sessionId, "assistant_reply_sent"),
        sessionId: input.sessionId,
        type: "assistant_reply_sent",
        payload: {
          deliveryStatus: "sent",
          deliveryPath: "kfc_http_response",
          assistantTurnId: output.assistantTurnId,
        },
        createdAt: new Date().toISOString(),
      });
    }

    const userTurn = [...(output.state.recentTurns ?? [])]
      .reverse()
      .find((turn) => turn.externalMessageId === input.clientMessageId);

    if (output.pause) {
      await store.appendEvent(input.sessionId, "confirmation_pause_created", {
        requestId: output.pause.requestId,
        customerId: input.customerId,
        channel: "kfc",
      });
    }

    const responseBody = {
      ...output,
      sessionId: input.sessionId,
      customerId: input.customerId,
      userTurnId: userTurn?.id ?? null,
      assistantTurnId: output.assistantTurnId ?? null,
      replayed: false,
    };
    await store.appendEvent(input.sessionId, "kfc_request_completed", {
      clientMessageId: input.clientMessageId,
      requestFingerprint,
      response: responseBody,
    });

    deferAiMonitorRefinement({
      sessionId: input.sessionId,
      clientMessageId: input.clientMessageId,
      output,
      metadata: input.metadata,
    });

    return {
      status: 200,
      body: responseBody,
    };
  }

  function deferAiMonitorRefinement(input: {
    sessionId: string;
    clientMessageId?: string | null;
    output: Awaited<ReturnType<typeof runAgentTurn>>;
    metadata?: ConversationTurnMetadata;
  }): void {
    if (!options.monitorJudge) return;
    const refineMonitor = async () => {
      let monitorTrace;
      try {
        const turns = await store.listTurns(input.sessionId);
        const monitorStateInput = {
          state: input.output.state,
          dashboardEvents: dashboard.getEvents(input.sessionId),
          customerTurnCount: countCustomerTurns(turns),
        };
        const probeRunId = isRecord(input.metadata?.rawEvent) &&
          typeof input.metadata.rawEvent.probeRunId === "string"
          ? input.metadata.rawEvent.probeRunId
          : undefined;
        monitorTrace = await options.agentTracer?.startTurn({
          name: "post_turn_monitor",
          inputs: monitorStateInput,
          metadata: {
            sessionId: input.sessionId,
            clientMessageId: input.clientMessageId ?? null,
            assistantTurnId: input.output.assistantTurnId ?? null,
            ...(probeRunId ? { probeRunId } : {}),
          },
          tags: ["kfc-post-turn-monitor"],
        });
        const sessionIntelligence = await resolveMonitorSessionIntelligence({
          ...monitorStateInput,
          judge: options.monitorJudge,
        });
        dashboard.emitEvent({
          id: dashboardEventId(input.sessionId, "session_intelligence_updated"),
          sessionId: input.sessionId,
          type: "session_intelligence_updated",
          payload: { sessionIntelligence },
          createdAt: new Date().toISOString(),
        });
        await monitorTrace?.end({ sessionIntelligence });
      } catch (error) {
        await monitorTrace?.fail(error);
        await store.appendEvent(input.sessionId, "llm:monitor_judge_failed", {
          message: error instanceof Error ? error.message : "Unknown monitor judge failure",
        });
      }
    };
    if (options.defer) options.defer(refineMonitor);
    else void refineMonitor();
  }

  async function deliverAssistantReply(input: {
    clients: Pick<ExternalClients, "messenger" | "zalo">;
    sessionId: string;
    externalUserId: string;
    presentation: ChannelPresentationPlan;
    channel: "messenger" | "zalo";
    assistantTurnId?: string | null;
    runGuard?: { isCurrent(): Promise<boolean> };
  }): Promise<{
    ok: boolean;
    suppressed?: boolean;
    externalMessageId?: string | null;
    errorCode?: string;
    errorMessage?: string;
  }> {
    if (input.runGuard && !(await input.runGuard.isCurrent())) {
      dashboard.emitEvent({
        id: `dash_${input.sessionId}_assistant_suppressed_${Date.now()}`,
        sessionId: input.sessionId,
        type: "agent_run_delivery_suppressed",
        payload: {
          reason: "stale_agent_run",
          assistantTurnId: input.assistantTurnId ?? null,
        },
        createdAt: new Date().toISOString(),
      });
      return {
        ok: false,
        suppressed: true,
        errorCode: "stale_agent_run",
        errorMessage: "Agent run is no longer current",
      };
    }

    const turns = input.assistantTurnId
      ? []
      : await store.listTurns(input.sessionId);
    const pendingAssistantTurn = input.assistantTurnId
      ? { id: input.assistantTurnId }
      : [...turns]
          .reverse()
          .find(
            (turn) =>
              turn.role === "assistant" && turn.deliveryStatus === "pending",
          );

    const sendResult =
      input.channel === "messenger"
        ? await input.clients.messenger.sendText(
            input.externalUserId,
            input.presentation.text,
          )
        : await input.clients.zalo.sendText(
            input.externalUserId,
            input.presentation.text,
          );

    if (pendingAssistantTurn) {
      await store.updateTurnDeliveryStatus(
        pendingAssistantTurn.id,
        sendResult.ok ? "sent" : "failed",
        sendResult.value?.messageId ?? null,
      );
    }

    let mediaResult: ChannelMediaDeliveryResult | undefined;
    if (sendResult.ok && input.presentation.media?.length) {
      try {
        mediaResult = input.channel === "messenger"
          ? await input.clients.messenger.sendMedia?.(
              input.externalUserId,
              input.presentation.media,
            )
          : await input.clients.zalo.sendMedia?.(
              input.externalUserId,
              input.presentation.media,
            );
      } catch (error) {
        const errorMessage = error instanceof Error
          ? error.message
          : `${input.channel} media send failed`;
        mediaResult = {
          status: "failed",
          items: input.presentation.media.map((item) => ({
            key: item.key,
            status: "failed",
            errorCode: `${input.channel}_media_send_failed`,
            errorMessage,
          })),
        };
      }
    }
    const mediaDeliveryStatus = input.presentation.media?.length
      ? mediaResult?.status ?? 'failed'
      : 'not_requested';

    dashboard.emitEvent({
      id: `dash_${input.sessionId}_assistant_${Date.now()}`,
      sessionId: input.sessionId,
      type: "assistant_reply_sent",
      payload: {
        deliveryStatus: sendResult.ok ? "sent" : "failed",
        textDeliveryStatus: sendResult.ok ? "sent" : "failed",
        mediaDeliveryStatus,
        mediaItems: mediaResult?.items ?? [],
      },
      createdAt: new Date().toISOString(),
    });

    return {
      ok: sendResult.ok,
      externalMessageId: sendResult.ok
        ? (sendResult.value?.messageId ?? null)
        : null,
      errorCode: sendResult.ok
        ? undefined
        : (sendResult.errorCode ?? "assistant_reply_delivery_failed"),
      errorMessage: sendResult.ok ? undefined : sendResult.message,
    };
  }

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
    role: "user" | "assistant" | "tool" | "system";
    channel: ConversationEvent["channel"];
    deliveryStatus:
      "received" | "pending" | "sent" | "failed" | "not_applicable";
    externalMessageId: string | null;
    externalUserId: string | null;
    text: string;
    metadata?: ConversationTurnMetadata | null;
  }): void {
    dashboard.emitEvent({
      id: dashboardEventId(turn.sessionId, "conversation_turn_created"),
      sessionId: turn.sessionId,
      type: "conversation_turn_created",
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
    updateType: "human_joined" | "human_message_sent" | "ai_resumed";
    agentMode: AgentMode;
    agentId?: string | null;
    text?: string;
  }): void {
    dashboard.emitEvent({
      id: dashboardEventId(input.sessionId, "session_updated"),
      sessionId: input.sessionId,
      type: "session_updated",
      payload: {
        updateType: input.updateType,
        agentMode: input.agentMode,
        agentId: input.agentId ?? null,
        text: input.text,
      },
      createdAt: new Date().toISOString(),
    });
  }

  async function emitSessionControlIntelligence(input: {
    sessionId: string;
    humanJoined?: boolean;
    aiResumed?: boolean;
  }): Promise<void> {
    const target = dashboardSessionTarget(input.sessionId);
    if (!target) {
      throw new Error(`Unsupported conversation source: ${input.sessionId}`);
    }
    const turns = await store.listTurns(input.sessionId);
    const latestUserTurn = [...turns]
      .reverse()
      .find((turn) => turn.role === "user");
    const state: AgentGraphState = {
      sessionId: input.sessionId,
      customerId: target.externalUserId,
      channel: target.channel as Channel,
      latestUserMessage: latestUserTurn?.text ?? "",
      recentTurns: buildBoundedRecentTurns(turns),
      intent: "unclear",
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      toolTrace: [],
    };
    const existing =
      dashboard
        .listSessionSummaries()
        .find((summary) => summary.sessionId === input.sessionId)
        ?.sessionIntelligence ?? null;
    const deterministic = calculateMonitorSessionIntelligence({
      state,
      dashboardEvents: dashboard.getEvents(input.sessionId),
      customerTurnCount:
        turns.length > 0
          ? countCustomerTurns(turns)
          : existing?.evaluatedCustomerTurnCount,
      humanJoined: input.humanJoined,
      aiResumed: input.aiResumed,
    });
    const refreshed =
      turns.length > 0 &&
      options.monitorJudge
        ? await resolveMonitorSessionIntelligence({
            state,
            dashboardEvents: dashboard.getEvents(input.sessionId),
            customerTurnCount: deterministic.evaluatedCustomerTurnCount,
            humanJoined: input.humanJoined,
            aiResumed: input.aiResumed,
            judge: options.monitorJudge,
          })
        : deterministic;
    let sessionIntelligence =
      refreshed.source === "ai_monitor_judge"
        ? refreshed
        : preserveMonitorContext(refreshed, existing);
    if (input.aiResumed && sessionIntelligence.source === "ai_monitor_judge") {
      sessionIntelligence = {
        ...sessionIntelligence,
        contextSummary: resumedOwnershipSummary(
          sessionIntelligence.contextSummary,
        ),
      };
    }
    dashboard.emitEvent({
      id: dashboardEventId(input.sessionId, "session_intelligence_updated"),
      sessionId: input.sessionId,
      type: "session_intelligence_updated",
      payload: { sessionIntelligence },
      createdAt: new Date().toISOString(),
    });
  }

  function resumedOwnershipSummary(summary: string): string {
    const trimmed = summary.trim();
    if (/\bAI\s+(?:đã\s+)?(?:tiếp quản|tiếp tục)/iu.test(trimmed)) {
      return trimmed;
    }
    const detail = trimmed
      .split(/(?<=[.!?])\s+|\s*,\s*/u)
      .filter((clause) => !/(?:nhân viên|human agent|operator)/iu.test(clause))
      .join(", ")
      .replace(/[.!?]+$/u, "")
      .trim();
    const ownership = "AI đã tiếp quản lại phiên hỗ trợ";
    if (!detail) {
      return `${ownership} và đang chờ yêu cầu tiếp theo của khách.`;
    }
    const capitalizedDetail = `${detail[0]?.toLocaleUpperCase("vi-VN") ?? ""}${detail.slice(1)}`;
    return `${ownership}. ${capitalizedDetail}.`.slice(0, 140);
  }

  async function clearPersistedHandoff(sessionId: string): Promise<void> {
    const events = await store.listEvents(sessionId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.sourceType !== "graph:verified_state") continue;
      const value = event.payload.verifiedState;
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value)
      ) {
        return;
      }
      const { handoff: _handoff, ...verifiedState } = value as Record<string, unknown>;
      await store.appendEvent(sessionId, "graph:verified_state", { verifiedState });
      return;
    }
  }

  async function persistedHandoffStatus(
    sessionId: string,
    agentMode: AgentMode,
  ): Promise<"queued" | "joined" | undefined> {
    if (agentMode === "human_paused") return "joined";
    const events = await store.listEvents(sessionId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.sourceType !== "graph:verified_state") continue;
      const verifiedState = event.payload.verifiedState;
      return isRecord(verifiedState) && isRecord(verifiedState.handoff)
        ? "queued"
        : undefined;
    }
    return undefined;
  }

  function shouldEvaluateDashboardMonitorContext(input: {
    existing: MonitorSessionIntelligence | null;
    customerTurnCount: number;
  }): boolean {
    if (input.customerTurnCount === 0) return false;
    const evaluatedCustomerTurnCount =
      input.existing?.evaluatedCustomerTurnCount ?? -1;
    const newCustomerTurns =
      input.customerTurnCount - evaluatedCustomerTurnCount;
    const hasAiContext =
      input.existing?.source === "ai_monitor_judge" &&
      input.existing.contextSummary.trim().length > 0;
    if (
      hasAiContext &&
      newCustomerTurns < monitorContextReevaluationCustomerTurnThreshold
    ) {
      return false;
    }
    if (
      !options.monitorJudge &&
      input.existing &&
      newCustomerTurns < monitorContextReevaluationCustomerTurnThreshold
    ) {
      return false;
    }
    return true;
  }

  async function ensureDashboardMonitorContext(input: {
    sessionId: string;
    existing: MonitorSessionIntelligence | null;
  }): Promise<MonitorSessionIntelligence | null> {
    const target = dashboardSessionTarget(input.sessionId);
    if (target?.channel !== "messenger") return input.existing;

    const turns = await store.listTurns(input.sessionId);
    const customerTurnCount = countCustomerTurns(turns);
    if (
      !shouldEvaluateDashboardMonitorContext({
        existing: input.existing,
        customerTurnCount,
      })
    ) {
      return input.existing;
    }

    const latestUserTurn = [...turns]
      .reverse()
      .find((turn) => turn.role === "user");
    const state: AgentGraphState = {
      sessionId: input.sessionId,
      customerId: target.externalUserId,
      channel: "messenger",
      latestUserMessage: latestUserTurn?.text ?? "",
      recentTurns: buildBoundedRecentTurns(turns),
      intent: "unclear",
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      toolTrace: [],
    };
    const sessionIntelligence = await resolveMonitorSessionIntelligence({
      state,
      dashboardEvents: dashboard.getEvents(input.sessionId),
      customerTurnCount,
      judge: options.monitorJudge,
    });
    dashboard.emitEvent({
      id: dashboardEventId(input.sessionId, "session_intelligence_updated"),
      sessionId: input.sessionId,
      type: "session_intelligence_updated",
      payload: { sessionIntelligence },
      createdAt: new Date().toISOString(),
    });
    return sessionIntelligence;
  }

  async function persistNonAgentInboundEvent(
    sessionId: string,
    event: ConversationEvent,
  ): Promise<void> {
    const turn = await store.appendTurn({
      sessionId,
      channel: event.channel,
      role: "user",
      text: event.text,
      externalMessageId: event.rawEventId,
      externalUserId: event.externalUserId,
      deliveryStatus: "received",
      metadata: turnMetadataFor(event),
    });
    dashboard.emitEvent({
      id: dashboardEventId(sessionId, "customer_message_received"),
      sessionId,
      type: "customer_message_received",
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
    if (control.agentMode !== "human_paused") return false;
    await persistNonAgentInboundEvent(sessionId, event);
    dashboard.emitEvent({
      id: dashboardEventId(sessionId, "assistant_reply_skipped"),
      sessionId,
      type: "assistant_reply_skipped",
      payload: {
        reason: "human_paused",
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
    turns: Awaited<ReturnType<ConversationStore["listTurns"]>>,
  ) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.role === "assistant") return null;
      if (turn.role === "user") return turn;
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

    const clients = await createWebhookClients(sessionId);
    const output = await runAgentTurn({
      sessionId,
      customerId: pendingTurn.externalUserId ?? target.externalUserId,
      channel: pendingTurn.channel,
      text: pendingTurn.text,
      externalMessageId: pendingTurn.externalMessageId,
      metadata: pendingTurn.metadata,
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
    const delivery = await deliverAssistantReply({
      clients,
      sessionId,
      externalUserId: pendingTurn.externalUserId ?? target.externalUserId,
      presentation: output.presentation,
      channel: target.channel,
    });
    if (delivery.ok) {
      deferAiMonitorRefinement({
        sessionId,
        clientMessageId: pendingTurn.externalMessageId,
        output,
      });
    }
    return {
      replied: delivery.ok,
      turnId: pendingTurn.id,
      errorCode: delivery.errorCode,
      errorMessage: delivery.errorMessage,
    };
  }


  return { kfcAgentResponse, deferAiMonitorRefinement, deliverAssistantReply, persistEventProfile, turnMetadataFor, emitConversationTurnCreatedEvent, emitSessionModeEvent, emitSessionControlIntelligence, resumedOwnershipSummary, clearPersistedHandoff, persistedHandoffStatus, shouldEvaluateDashboardMonitorContext, ensureDashboardMonitorContext, persistNonAgentInboundEvent, pauseIfHumanJoined, latestUnansweredCustomerTurn, replyToLatestUnansweredCustomerTurn };
}

export type RouteAgentRuntime = ReturnType<typeof createRouteAgentRuntime>;
