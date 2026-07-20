import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentRunCoordinator } from "../agentRuns/coordinator.js";
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
} from "../genui/kfcGenUi.js";
import { runAgentTurn } from "../graph/buildGraph.js";
import type { AgentGraphState } from "../graph/state.js";
import {
  calculateMonitorSessionIntelligence,
  preserveMonitorContext,
  countCustomerTurns,
  monitorContextReevaluationCustomerTurnThreshold,
  resolveMonitorSessionIntelligence,
} from "../monitor/sessionIntelligence.js";
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
  type AgentRunPatch,
  type ConversationStore,
  type WebhookDelivery,
} from "../persistence/memoryStore.js";
import {
  AGENT_RUN_EXECUTION_LEASE_TTL_MS,
  agentRunExecutionFence,
} from "../persistence/agentRunExecutionLease.js";
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
import { eventFromMessengerDelivery, sendMessengerSenderAction, dashboardEventId, checkCommerceGatewayReadiness, checkCatalogReadiness, runReadinessCheck, checkFixtures, checkMessengerConfig, checkZaloConfig, deeplinkForSession, renderInboxUrlTemplate, ChannelProfileTarget, channelTargetForSession, humanChannelTargetForSession } from './routeHandlerSupport.js';

import type { RouteCommerceRuntime } from './routeCommerceRuntime.js';
import type { RouteAgentRuntime } from './routeAgentRuntime.js';
import {
  persistCanonicalConfirmationPause,
} from './confirmationPausePersistence.js';
import {
  messengerGuestAuthorityForClaimedRun,
} from './routeMessengerGuestAuthority.js';
import type {
  VerifiedMessengerGuestCheckoutIngress,
} from '../security/guestCheckoutAuthority.js';

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

      if (!event.shouldRunAgent) {
        await persistNonAgentInboundEvent(sessionId, event);
        await store.markWebhookDeliveryProcessed(
          "messenger",
          event.rawEventId,
        );
        return { status: "processed" };
      }

      if (await pauseIfHumanJoined(sessionId, event)) {
        await store.markWebhookDeliveryProcessed("messenger", event.rawEventId);
        return { status: "processed" };
      }
      const errorCode = "agent_run_execution_required";
      await store.markWebhookDeliveryFailed(
        "messenger",
        event.rawEventId,
        errorCode,
      );
      return {
        status: "failed",
        errorCode,
        errorMessage:
          "AI-bearing Messenger events require a claimed AgentRun",
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

      const activeAgentEvent =
        event.shouldRunAgent &&
        (await store.getSessionControl(
          sessionIdForConversationEvent(event),
        )).agentMode === "ai_active";
      let deliveryResult: MessengerWebhookEventProcessingResult;
      if (activeAgentEvent) {
        const coordinator = new AgentRunCoordinator({
          store,
          dashboard,
        });
        const wakeup = await coordinator.recordPendingTurn(
          event,
          sessionIdForConversationEvent(event),
        );
        const claim = await coordinator.claimWakeupRun(wakeup);
        deliveryResult =
          claim.dispatch && claim.runId
            ? await processMessengerAgentRunInternal(claim.runId)
            : {
                status: "skipped",
                errorCode:
                  claim.reason ?? "agent_run_not_dispatched",
              };
      } else {
        deliveryResult =
          await processMessengerEventInternal(event);
      }
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
    verifiedIngress?: readonly VerifiedMessengerGuestCheckoutIngress[],
  ): Promise<MessengerWebhookEventProcessingResult> {
    const storedRun = await store.getAgentRun(runId);
    if (!storedRun)
      return { status: "skipped", errorCode: "agent_run_not_found" };
    if (storedRun.status === "completed") return { status: "skipped" };
    if (storedRun.status === "superseded")
      return { status: "skipped", errorCode: "stale_agent_run" };
    if (storedRun.status === "reconciliation_required") {
      return {
        status: "skipped",
        errorCode: storedRun.errorCode ?? "agent_run_reconciliation_required",
      };
    }
    const claimedAt = new Date();
    const execution = await store.claimAgentRunExecution({
      runId: storedRun.id,
      sessionId: storedRun.sessionId,
      generation: storedRun.generation,
      sessionAuthorityGeneration: storedRun.sessionAuthorityGeneration,
      claimedAt: claimedAt.toISOString(),
      executionLeaseToken: crypto.randomUUID(),
      executionLeaseExpiresAt: new Date(
        claimedAt.getTime() + AGENT_RUN_EXECUTION_LEASE_TTL_MS,
      ).toISOString(),
    });
    if (execution.status !== "claimed") {
      const errorCode = execution.reason === "attempts_exhausted"
        ? "agent_run_execution_attempts_exhausted"
        : execution.reason === "irreversible_outcome_unknown"
          ? "agent_run_outcome_unknown"
          : execution.reason === "lease_active"
            ? "agent_run_execution_lease_active"
            : "agent_run_execution_stale";
      return { status: "skipped", errorCode };
    }
    const run = execution.run;
    const commitFence = agentRunExecutionFence(run);

    const isCurrentRun = async () => {
      const [current, control] = await Promise.all([
        store.isRunCommitFenceCurrent({
          sessionId: run.sessionId,
          fence: commitFence,
        }),
        store.getSessionControl(run.sessionId),
      ]);
      return current && control.agentMode === "ai_active";
    };
    const updateExecutingRun = (patch: AgentRunPatch) =>
      store.updateAgentRunIfExecutionCurrent({
        sessionId: run.sessionId,
        fence: commitFence,
        patch,
      });
    const suppressRun = async (reason: string) => {
      const completedAt = new Date().toISOString();
      const currentSuppression = await updateExecutingRun({
        status: "superseded",
        deliveryStatus: "suppressed",
        errorCode: "stale_agent_run",
        errorMessage: reason,
        completedAt,
      });
      const suppressed =
        currentSuppression.status === "committed"
          ? true
          : (
              await store.supersedeAgentRunExecutionIfNoLongerCurrent({
                sessionId: run.sessionId,
                fence: commitFence,
                errorMessage: reason,
                completedAt,
              })
            ).status === "superseded";
      if (!suppressed) return false;
      dashboard.emitEvent({
        id: `dash_${run.sessionId}_${run.id}_delivery_suppressed`,
        sessionId: run.sessionId,
        type: "agent_run_delivery_suppressed",
        payload: { runId: run.id, generation: run.generation, reason },
        createdAt: new Date().toISOString(),
      });
      return true;
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
      const failed = await updateExecutingRun({
        status: "failed",
        deliveryStatus: "not_applicable",
        errorCode: "agent_run_no_linked_turns",
        errorMessage: "No linked pending customer turns found for agent run",
        completedAt: new Date().toISOString(),
      });
      if (failed.status !== "committed") {
        return { status: "skipped", errorCode: "stale_agent_run" };
      }
      return { status: "failed", errorCode: "agent_run_no_linked_turns" };
    }
    const guestCheckoutAuthority =
      await messengerGuestAuthorityForClaimedRun({
        run,
        firstLinkedTurn: linkedTurns[0]!,
        commitFence,
        verifiedIngress,
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
        const profileResult = await clients.messenger.getProfile(
          run.externalUserId,
        );
        if (profileResult.ok) {
          const profile = profileResult.value;
          await store.upsertProfile({
            channel: "messenger",
            externalUserId: run.externalUserId,
            displayName: profile?.displayName ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
            profileSource:
              profile?.profileSource ?? "messenger_profile_api",
            profileUpdatedAt: new Date().toISOString(),
          });
        }
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
        commitFence,
        recordIrreversibleBoundary: async (toolName: ToolName) => {
          const boundary = await updateExecutingRun({
            irreversibleSideEffectAt: new Date().toISOString(),
            irreversibleToolName: toolName,
          });
          if (boundary.status !== "committed") {
            throw new Error("agent_run_execution_lease_stale");
          }
        },
      };
      const resumableDelivery =
        await store.getAgentRunTextDelivery(run.id);
      let output:
        | Awaited<ReturnType<typeof runAgentTurn>>
        | undefined;
      let presentation: ChannelPresentationPlan;
      let deliveryAssistantTurnId: string;
      if (
        resumableDelivery &&
        resumableDelivery.assistantTurnId !== run.assistantTurnId
      ) {
        const reconciled =
          await store.reconcileAgentRunTextDelivery({
            execution: {
              runId: commitFence.runId,
              executionAttempt: commitFence.executionAttempt,
              executionLeaseToken:
                commitFence.executionLeaseToken,
            },
            outcomeCode:
              "agent_run_text_delivery_assistant_authority_mismatch",
            updatedAt: new Date().toISOString(),
          });
        return {
          status: "failed",
          errorCode:
            reconciled.status === "reconciliation_blocked"
              ? `agent_run_text_delivery_${reconciled.reason}`
              : reconciled.record.outcomeCode,
        };
      }
      if (run.assistantTurnId) {
        const assistantTurn = (await store.listTurns(run.sessionId))
          .find(
            (turn) =>
              turn.id === run.assistantTurnId &&
              turn.sessionId === run.sessionId &&
              turn.channel === run.channel &&
              turn.role === "assistant",
          );
        if (!assistantTurn) {
          if (!resumableDelivery) {
            const failed = await updateExecutingRun({
              status: "failed",
              deliveryStatus: "failed",
              errorCode:
                "agent_run_text_delivery_assistant_turn_missing",
              errorMessage:
                "AgentRun assistant authority does not name a valid channel assistant turn",
              completedAt: new Date().toISOString(),
            });
            return failed.status === "committed"
              ? {
                  status: "failed",
                  errorCode:
                    "agent_run_text_delivery_assistant_turn_missing",
                }
              : { status: "skipped", errorCode: "stale_agent_run" };
          }
          const reconciled = await store.reconcileAgentRunTextDelivery({
            execution: {
              runId: commitFence.runId,
              executionAttempt: commitFence.executionAttempt,
              executionLeaseToken:
                commitFence.executionLeaseToken,
            },
            outcomeCode:
              "agent_run_text_delivery_assistant_turn_missing",
            updatedAt: new Date().toISOString(),
          });
          return {
            status: "failed",
            errorCode:
              reconciled.status === "reconciliation_blocked"
                ? `agent_run_text_delivery_${reconciled.reason}`
                : reconciled.record.outcomeCode,
          };
        }
        presentation = textOnlyPresentation(
          assistantTurn.text,
          run.channel,
        );
        deliveryAssistantTurnId = assistantTurn.id;
      } else {
        output = await runAgentTurn({
          sessionId: run.sessionId,
          customerId: run.externalUserId,
          channel: run.channel,
          text: run.coalescedInputText,
          externalMessageId: linkedTurns[0]!.externalMessageId,
          metadata: null,
          clients,
          store,
          dashboard,
          agentModel: options.agent?.model,
          responseVerifierModel: options.responseVerifier?.model,
          guestCheckoutAuthority,
          runGuard,
          tracer: options.agentTracer,
          checkpointer: options.checkpointer,
        });
        if (output.suppressed || !(await isCurrentRun())) {
          await suppressRun("run_not_current_before_delivery");
          return { status: "skipped", errorCode: "stale_agent_run" };
        }
        if (output.pause) {
          await persistCanonicalConfirmationPause({
            store,
            sessionId: run.sessionId,
            customerId: run.externalUserId,
            channel: run.channel,
            pause: output.pause,
            accessContext: undefined,
            guestCheckoutAuthority,
            checkpointer: options.checkpointer,
            runCommit: {
              fence: commitFence,
              state: output.state,
            },
          });
          const finalized = await updateExecutingRun({
            status: 'completed',
            deliveryStatus: 'not_applicable',
            errorCode: null,
            errorMessage: null,
            completedAt: new Date().toISOString(),
          });
          if (finalized.status !== 'committed') {
            return {
              status: 'skipped',
              errorCode: 'stale_agent_run',
            };
          }
          for (const turn of linkedTurns) {
            await store.markPendingCustomerTurnClaimed(
              turn.turnId,
              run.id,
            );
            await store.markWebhookDeliveryProcessed(
              run.channel,
              turn.externalMessageId,
            );
          }
          return { status: 'processed' };
        }
        presentation = output.presentation;
        if (!output.assistantTurnId) {
          const failed = await updateExecutingRun({
            status: "failed",
            deliveryStatus: "failed",
            errorCode: "agent_run_assistant_turn_missing",
            errorMessage:
              "Agent run produced no durable assistant turn",
            completedAt: new Date().toISOString(),
          });
          return failed.status === "committed"
            ? {
                status: "failed",
                errorCode: "agent_run_assistant_turn_missing",
              }
            : { status: "skipped", errorCode: "stale_agent_run" };
        }
        deliveryAssistantTurnId = output.assistantTurnId;
        const outputAssistantTurn = (
          await store.listTurns(run.sessionId)
        ).find(
          (turn) =>
            turn.id === deliveryAssistantTurnId &&
            turn.sessionId === run.sessionId &&
            turn.channel === run.channel &&
            turn.role === "assistant",
        );
        if (!outputAssistantTurn) {
          const failed = await updateExecutingRun({
            status: "failed",
            deliveryStatus: "failed",
            errorCode: "agent_run_assistant_turn_missing",
            errorMessage:
              "Agent run produced no valid durable assistant turn",
            completedAt: new Date().toISOString(),
          });
          return failed.status === "committed"
            ? {
                status: "failed",
                errorCode: "agent_run_assistant_turn_missing",
              }
            : { status: "skipped", errorCode: "stale_agent_run" };
        }
      }
      if (!deliveryAssistantTurnId) {
        const failed = await updateExecutingRun({
          status: "failed",
          deliveryStatus: "failed",
          errorCode: "agent_run_assistant_turn_missing",
          errorMessage:
            "Agent run produced no durable assistant turn",
          completedAt: new Date().toISOString(),
        });
        return failed.status === "committed"
          ? {
              status: "failed",
              errorCode: "agent_run_assistant_turn_missing",
            }
          : { status: "skipped", errorCode: "stale_agent_run" };
      }
      const assistantAuthority = await updateExecutingRun({
        assistantTurnId: deliveryAssistantTurnId,
      });
      if (assistantAuthority.status !== "committed") {
        await suppressRun("run_not_current_before_delivery_authority");
        return { status: "skipped", errorCode: "stale_agent_run" };
      }
      const delivery = await deliverAssistantReply({
        clients,
        sessionId: run.sessionId,
        externalUserId: run.externalUserId,
        presentation,
        channel: run.channel,
        assistantTurnId: deliveryAssistantTurnId,
        runGuard,
      });
      if (delivery.suppressed) {
        await suppressRun("run_not_current_before_delivery");
        return { status: "skipped", errorCode: "stale_agent_run" };
      }
      if (delivery.ok && output) {
        deferAiMonitorRefinement({
          sessionId: run.sessionId,
          clientMessageId: linkedTurns[0]!.externalMessageId,
          output,
        });
      }
      const assistantTurnId = deliveryAssistantTurnId;
      const postDeliveryRun = await store.getAgentRun(run.id);
      if (
        postDeliveryRun?.status === "reconciliation_required"
      ) {
        const errorCode =
          postDeliveryRun.errorCode ??
          delivery.errorCode ??
          "agent_run_delivery_outcome_unknown";
        const errorMessage =
          postDeliveryRun.errorMessage ??
          delivery.errorMessage ??
          "Assistant reply delivery outcome requires reconciliation";
        for (const turn of linkedTurns) {
          await store.markWebhookDeliveryFailed(
            run.channel,
            turn.externalMessageId,
            errorMessage,
          );
        }
        return {
          status: "failed",
          errorCode,
          errorMessage,
        };
      }

      const deliveryAlreadyProjected =
        delivery.ok && postDeliveryRun?.status === "completed";
      if (!deliveryAlreadyProjected) {
        const finalized = await updateExecutingRun({
          status: delivery.ok ? "completed" : "failed",
          assistantTurnId,
          deliveryStatus: delivery.ok ? "sent" : "failed",
          deliveryExternalMessageId:
            delivery.externalMessageId ?? null,
          errorCode: delivery.ok
            ? null
            : "assistant_reply_delivery_failed",
          errorMessage: delivery.ok
            ? null
            : "Assistant reply delivery failed",
          completedAt: new Date().toISOString(),
        });
        if (finalized.status !== "committed") {
          return {
            status: "skipped",
            errorCode: "stale_agent_run",
          };
        }
      }
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
    } catch {
      const errorMessage = "Agent run processing failed";
      const failed = await updateExecutingRun({
        status: "failed",
        deliveryStatus: "failed",
        errorCode: "agent_run_processing_failed",
        errorMessage,
        completedAt: new Date().toISOString(),
      });
      if (failed.status !== "committed") {
        return { status: "skipped", errorCode: "stale_agent_run" };
      }
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
