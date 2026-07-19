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

export function createSystemRouteHandlers(context: RouteHandlerContext) {
  const { options, store, dashboard, showcase, streamingRunObservers, customerRuns, getFixtures, withConfiguredCommerce, createWebhookClients, createDeliveryClients, dashboardProfileForTarget, createFirstPartyKfcClients, kfcProofAccessContext, latestKfcProofPreconditions, kfcAgentResponse, deferAiMonitorRefinement, deliverAssistantReply, persistEventProfile, turnMetadataFor, emitConversationTurnCreatedEvent, emitSessionModeEvent, emitSessionControlIntelligence, resumedOwnershipSummary, clearPersistedHandoff, persistedHandoffStatus, shouldEvaluateDashboardMonitorContext, ensureDashboardMonitorContext, persistNonAgentInboundEvent, pauseIfHumanJoined, latestUnansweredCustomerTurn, replyToLatestUnansweredCustomerTurn, processMessengerEventInternal, recoverStaleMessengerDeliveriesInternal, processMessengerAgentRunInternal } = context;
  return {
    health() {
      return { status: 200, body: { ok: true, service: "kfc-agent-backend" } };
    },
    async ready(deep = false) {
      const database = await runReadinessCheck(
        options.readiness?.database ?? (async () => ({ ok: true })),
      );
      const fixtures = options.fixtures
        ? {
            ok:
              options.fixtures.menuItems.length > 0 &&
              options.fixtures.stores.length > 0,
          }
        : await checkFixtures(
            options.readiness?.fixturesRoot ??
              options.fixturesRoot ??
              defaultFixturesRoot(),
          );
      const messenger = checkMessengerConfig(options);
      const messengerToken = options.readiness?.messengerToken
        ? await runReadinessCheck(options.readiness.messengerToken)
        : undefined;
      const zalo = checkZaloConfig(options);
      const openai = {
        ok: options.readiness?.openAiRequired
          ? Boolean(options.readiness.openAiConfigured)
          : true,
        required: options.readiness?.openAiRequired ?? false,
        configured:
          options.readiness?.openAiConfigured ??
          Boolean(options.responseComposer && options.toolPlanner),
      };
      const runtimeAgent = options.readiness?.runtime?.agent;
      const agent = {
        ok: options.readiness?.agentConfigured ?? Boolean(options.agent),
        required: false,
        configured: options.readiness?.agentConfigured ?? Boolean(options.agent),
        provider: runtimeAgent?.provider ?? "unconfigured",
        model: runtimeAgent?.model ?? "unconfigured",
        profile: runtimeAgent?.profile ?? "unconfigured",
      };
      const observability = {
        ok: true,
        langsmith: options.readiness?.langsmith ?? {
          configured: Boolean(options.agentTracer),
          project: null,
          endpoint: null,
          samplingRate: 0,
        },
      };
      const commerceEnvironment = options.readiness?.runtime?.commerceEnvironment;
      const commerceConfig = options.readiness?.commerce ?? (
        commerceEnvironment === "sandbox" || commerceEnvironment === "production"
          ? undefined
          : { mode: "fixture" as const }
      );
      const commerce =
        !commerceConfig
          ? {
              ok: false,
              mode: "unconfigured",
              configured: false,
              message: `Missing commerce provider configuration for ${commerceEnvironment}`,
            }
        : commerceConfig.mode === "fixture"
          ? {
              ok: true,
              mode: "fixture",
              configured: true,
              production: false,
              message:
                "Fixture commerce is enabled for local development and proof only",
            }
          : !commerceConfig.baseUrl || !commerceConfig.token
            ? await checkCommerceGatewayReadiness(commerceConfig)
          : !options.kfcCommerceGateway
            ? {
                ok: false,
                mode: "gateway",
                configured: false,
                message: "Gateway order and payment clients are required",
              }
            : await checkCommerceGatewayReadiness(commerceConfig);
      const catalog = commerceConfig?.mode === "gateway"
        ? await checkCatalogReadiness(options.catalog)
        : { ok: true, configured: false, required: false };
      const posConfig = options.readiness?.pos ?? { mode: "disabled" as const };
      const pos =
        posConfig.mode === "disabled"
          ? {
              ok: true,
              mode: "disabled",
              configured: false,
              simulated: false,
              message: "POS integration is disabled",
            }
          : !posConfig.baseUrl
            ? {
                ok: false,
                mode: "http",
                configured: false,
                simulated: posConfig.simulated ?? false,
                message: "Missing KFC_POS_BASE_URL",
              }
            : !posConfig.token
              ? {
                  ok: false,
                  mode: "http",
                  configured: false,
                  simulated: posConfig.simulated ?? false,
                  message: "Missing KFC_POS_TOKEN",
                }
              : {
                  ok: true,
                  mode: "http",
                  configured: true,
                  simulated: posConfig.simulated ?? false,
                };
      const checks = messengerToken
        ? {
            database,
            fixtures,
            messenger,
            messengerToken,
            zalo,
            openai,
            agent,
            observability,
            catalog,
            commerce,
            pos,
          }
        : { database, fixtures, messenger, zalo, openai, agent, observability, catalog, commerce, pos };
      const ok = Object.values(checks).every((check) => check.ok);

      return {
        status: ok ? 200 : 503,
        body: {
          ok,
          service: "kfc-agent-backend",
          checks,
          ...(options.readiness?.release ? { release: options.readiness.release } : {}),
          ...(deep ? {
            proof: {
              deployment: options.readiness?.release ?? null,
              commerceEnvironment: options.readiness?.runtime?.commerceEnvironment ?? null,
              providerFingerprint: catalog.observation?.providerFingerprint ?? null,
              catalogObservation: catalog.observation ? {
                id: catalog.observation.id,
                sha256: catalog.observation.sha256,
                observedAt: catalog.observation.observedAt,
                expiresAt: catalog.observation.expiresAt ?? null,
                itemCount: catalog.observation.itemCount,
                modifierTreeCount: catalog.observation.modifierTreeCount,
              } : null,
              lifecycle: { provider: options.lifecycle?.environment === "sandbox" ? "d1" : null, controlsRegistered: options.lifecycle?.environment === "sandbox" },
              graph: { runtime: "langchain-create-agent-v1", checkpoint: options.checkpointer ? "configured-v1" : "memory-v1" },
              versions: {
                agent: runtimeAgent ?? {
                  provider: "unconfigured",
                  model: "unconfigured",
                  profile: "unconfigured",
                },
                toolCatalog: "typed-commerce-tools-v1",
                ranker: "deterministic-safety-rerank-v1",
                ledger: "kfc-scenario-ledger-v1",
              },
            },
          } : {}),
          timestamp: new Date().toISOString(),
        },
      };
    },
    async lifecycleCreate(sessionId: string) {
      if (!options.lifecycle || options.lifecycle.environment !== "sandbox") {
        return { status: 404, body: { errorCode: "not_found" } };
      }
      try {
        return { status: 201, body: await options.lifecycle.controls.create(await options.lifecycle.createInput(sessionId)) };
      } catch (error) {
        return lifecycleErrorResponse(error);
      }
    },
    async lifecycleGet(instanceId: string) {
      if (!options.lifecycle || options.lifecycle.environment !== "sandbox") {
        return { status: 404, body: { errorCode: "not_found" } };
      }
      try {
        return { status: 200, body: await options.lifecycle.controls.get(await options.lifecycle.binding(instanceId)) };
      } catch (error) {
        return lifecycleErrorResponse(error);
      }
    },
    async lifecycleEvent(instanceId: string, body: unknown) {
      if (!options.lifecycle || options.lifecycle.environment !== "sandbox") {
        return { status: 404, body: { errorCode: "not_found" } };
      }
      const parsed = lifecycleEventPayloadSchema.safeParse(body);
      if (!parsed.success) return { status: 400, body: { errorCode: "invalid_lifecycle_event", issues: parsed.error.issues } };
      try {
        const binding = await options.lifecycle.binding(instanceId);
        const context: MutationContext = {
          expectedRevision: parsed.data.expectedRevision,
          idempotencyKey: parsed.data.idempotencyKey,
          requestFingerprint: await sha256Fingerprint(parsed.data),
          traceId: parsed.data.traceId,
          runId: parsed.data.runId,
          requestId: parsed.data.requestId,
          actor: "sandbox-proof-control",
        };
        return { status: 200, body: await options.lifecycle.controls.transition(binding, parsed.data.event, context) };
      } catch (error) {
        return lifecycleErrorResponse(error);
      }
    },
    async messengerProofEnvelope(sessionId: string) {
      const [turns, webhookDeliveries, pendingCustomerTurns, agentRuns, sessionAgentState, checkpoints, providerEvents, lifecycle] = await Promise.all([
        store.listTurns(sessionId),
        store.listWebhookDeliveries(sessionId),
        store.listPendingCustomerTurns(sessionId),
        store.listAgentRuns(sessionId),
        store.getSessionAgentState(sessionId),
        store.listCheckpointIdentifiers(sessionId),
        store.listEvents(sessionId).then((events) => events.filter((event) => event.sourceType === "catalog_observation_pinned")),
        options.lifecycle?.proofForSession?.(sessionId) ?? Promise.resolve({ instance: null, audit: [] }),
      ]);
      const links = (await Promise.all(agentRuns.map(async (run) => ({ runId: run.id, turns: await store.listAgentRunTurns(run.id) })))).flatMap(
        ({ runId, turns: runLinks }) => runLinks.map((link) => ({ ...link, runId })),
      );
      const userTurns = turns.filter((turn) => turn.role === "user" && turn.externalMessageId);
      const assistantById = new Map(turns.filter((turn) => turn.role === "assistant").map((turn) => [turn.id, turn]));
      const runIds = new Set(agentRuns.map(({ id }) => id));
      const linkedRunIds = new Set(links.map(({ runId }) => runId));
      const webhookIds = new Set(webhookDeliveries.filter(({ status }) => status === "processed").map(({ externalEventId }) => externalEventId));
      const missing = [
        ...(webhookDeliveries.length > 0 && userTurns.every(({ externalMessageId }) => webhookIds.has(externalMessageId!)) ? [] : ["webhook_deliveries"]),
        ...(pendingCustomerTurns.length > 0 && pendingCustomerTurns.every(({ status, claimedRunId }) => status === "claimed" && claimedRunId && runIds.has(claimedRunId)) ? [] : ["pending_customer_turns"]),
        ...(agentRuns.length > 0 && agentRuns.every(({ id }) => linkedRunIds.has(id)) ? [] : ["agent_runs_and_links"]),
        ...(sessionAgentState.generation === Math.max(0, ...agentRuns.map(({ generation }) => generation)) ? [] : ["agent_generation"]),
        ...(checkpoints.length > 0 ? [] : ["checkpoint_identifiers"]),
        ...(providerEvents.length > 0 ? [] : ["provider_audit"]),
        ...(lifecycle.instance && lifecycle.audit.length > 0 ? [] : ["lifecycle_audit"]),
        ...(agentRuns.filter(({ status }) => status === "completed").length > 0 && agentRuns.filter(({ status }) => status === "completed").every((run) => {
          const assistant = run.assistantTurnId ? assistantById.get(run.assistantTurnId) : undefined;
          return run.deliveryStatus === "sent" && Boolean(run.deliveryExternalMessageId) && assistant?.externalMessageId === run.deliveryExternalMessageId;
        }) ? [] : ["outbound_graph_api_correlation"]),
      ];
      const body = {
        schemaVersion: 1,
        artifactKind: "messenger-session-proof-envelope",
        complete: missing.length === 0,
        missing,
        sessionId,
        webhookDeliveries,
        pendingCustomerTurns,
        agentRuns,
        agentRunTurns: links,
        sessionAgentState,
        checkpoints,
        providerEvents,
        lifecycle,
        outbound: agentRuns.filter(({ status }) => status === "completed").map((run) => ({
          runId: run.id,
          assistantTurnId: run.assistantTurnId,
          graphApiExternalMessageId: run.deliveryExternalMessageId,
          persistedExternalMessageId: run.assistantTurnId ? assistantById.get(run.assistantTurnId)?.externalMessageId ?? null : null,
        })),
      };
      return { status: missing.length === 0 ? 200 : 409, body };
    },
    async kfcProofEnvelope(sessionId: string) {
      const [turns, events, checkpoints, lifecycle] = await Promise.all([
        store.listTurns(sessionId),
        store.listEvents(sessionId),
        store.listCheckpointIdentifiers(sessionId),
        options.lifecycle?.proofForSession?.(sessionId) ?? Promise.resolve({ instance: null, audit: [] }),
      ]);
      const verifiedStates = events.filter(({ sourceType }) => sourceType === "graph:verified_state");
      const plannerPlans = events.filter(({ sourceType }) => sourceType === "llm:tool_plan");
      const missing = [
        ...(turns.length > 0 && turns.length % 2 === 0 ? [] : ["durable_turns"]),
        ...(verifiedStates.length > 0 ? [] : ["verified_state"]),
        ...(plannerPlans.length > 0 ? [] : ["planner_plans"]),
        ...(checkpoints.length > 0 ? [] : ["checkpoint_identifiers"]),
        ...(lifecycle.instance ? [] : ["lifecycle_instance"]),
      ];
      return {
        status: missing.length === 0 ? 200 : 409,
        body: {
          schemaVersion: 1,
          artifactKind: "kfc-session-proof-envelope",
          complete: missing.length === 0,
          missing,
          sessionId,
          turnCount: turns.length,
          verifiedStateCount: verifiedStates.length,
          verifiedStates,
          plannerPlans,
          events,
          eventCount: events.length,
          checkpoints,
          lifecycle,
        },
      };
    },
    async kfcProofPreconditions(sessionId: string, body: unknown) {
      if (options.lifecycle?.environment !== "sandbox") return { status: 404, body: { errorCode: "not_found" } };
      const parsed = kfcProofPreconditionsSchema.safeParse(body);
      if (!parsed.success || sessionId !== `kfc:${parsed.data?.customerId ?? ""}`) {
        return { status: 400, body: { errorCode: "invalid_kfc_proof_preconditions" } };
      }
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      let verifiedState = parsed.data.verifiedState;
      if (parsed.data.orderId) {
        const clients = await createFirstPartyKfcClients(sessionId, {}, {
          providerProfile: parsed.data.providerProfile ?? null,
        });
        const [order, payment] = await Promise.all([
          clients.oms.getOrderStatus(parsed.data.orderId),
          clients.payment.checkPaymentStatus(parsed.data.orderId),
        ]);
        if (!order.ok || !order.value || !payment.ok || !payment.value) {
          return { status: 409, body: { errorCode: "kfc_proof_provider_precondition_unavailable" } };
        }
        verifiedState = {
          ...verifiedState,
            order: order.value,
            paymentAttempt: {
              method: "momo",
              status: payment.value.status,
              paymentUrl: `https://payment.kfc.vn/orders/${encodeURIComponent(parsed.data.orderId)}`,
            },
            toolTrace: [],
        };
      }
      await store.appendEvent(sessionId, "proof:kfc_preconditions", {
        customerId: parsed.data.customerId,
        authenticated: parsed.data.authenticated,
        expiresAt,
        orderId: parsed.data.orderId ?? null,
        providerProfile: parsed.data.providerProfile ?? null,
      });
      if (verifiedState) {
        await store.appendEvent(sessionId, "graph:verified_state", { verifiedState });
      }
      return { status: 201, body: { ok: true, sessionId, authenticated: parsed.data.authenticated, orderId: parsed.data.orderId ?? null, providerProfileBound: parsed.data.providerProfile != null, expiresAt } };
    },
    async confirmationResume(body: unknown) {
      const parsed = confirmationResumePayloadSchema.safeParse(body);
      if (!parsed.success) return { status: 400, body: { errorCode: "invalid_confirmation_resume", issues: parsed.error.issues } };
      const pause = await store.findConfirmationPause(parsed.data.requestId);
      if (!pause) return { status: 404, body: { errorCode: "confirmation_not_found" } };
      const prior = (await store.listEvents(pause.sessionId)).find((event) => event.sourceType === "confirmation_resume_completed" && event.payload.requestId === parsed.data.requestId);
      if (prior) {
        if (prior.payload.decision !== parsed.data.decision) return { status: 409, body: { errorCode: "confirmation_decision_conflict" } };
        return { status: 200, body: { ...prior.payload.response as Record<string, unknown>, replayed: true } };
      }
      if (pause.channel !== "kfc") return { status: 409, body: { errorCode: "confirmation_channel_not_supported" } };
      if (!store.reserveIrreversibleOperation || !store.completeIrreversibleOperation || !store.failIrreversibleOperation) {
        return { status: 503, body: { errorCode: "confirmation_resume_fence_unavailable" } };
      }
      const reservationInput = {
        requestId: `confirmation-resume:${parsed.data.requestId}`,
        sessionId: pause.sessionId,
        operation: "confirmation_resume",
        bindingFingerprint: await sha256Fingerprint({ requestId: parsed.data.requestId, decision: parsed.data.decision }),
      };
      let reservation;
      try {
        reservation = await store.reserveIrreversibleOperation(reservationInput);
      } catch (error) {
        if (error instanceof Error && error.message.includes("binding conflict")) {
          return { status: 409, body: { errorCode: "confirmation_decision_conflict" } };
        }
        throw error;
      }
      if (reservation.status === "completed") {
        return { status: 200, body: { ...reservation.result, replayed: true } };
      }
      if (reservation.status !== "reserved") {
        return { status: 409, body: { errorCode: "confirmation_resume_in_progress" } };
      }
      try {
        const output = await runAgentTurn({
        sessionId: pause.sessionId,
        customerId: pause.customerId,
        channel: "kfc",
        text: "",
        metadata: options.readiness?.release ? { release: options.readiness.release } : undefined,
        clients: await createFirstPartyKfcClients(pause.sessionId, {}),
        store,
        dashboard,
        responseComposer: options.responseComposer,
        toolPlanner: options.toolPlanner,
        smallTalkRouter: options.smallTalkRouter,
        monitorJudge: options.monitorJudge,
        tracer: options.agentTracer,
        checkpointer: options.checkpointer,
        confirmationResume: { requestId: parsed.data.requestId, approved: parsed.data.decision === "approve" },
        });
        if (output.assistantTurnId) await store.updateTurnDeliveryStatus(output.assistantTurnId, "sent", null);
        const response = { ...output, sessionId: pause.sessionId, customerId: pause.customerId, replayed: false };
        const completed = await store.completeIrreversibleOperation(reservationInput, reservation, response);
        if (completed.status !== "completed") {
          return { status: 409, body: { errorCode: "confirmation_resume_in_progress" } };
        }
        await store.appendEvent(pause.sessionId, "confirmation_resume_completed", { requestId: parsed.data.requestId, decision: parsed.data.decision, response: completed.result });
        return { status: 200, body: completed.result };
      } catch (error) {
        await store.failIrreversibleOperation(reservationInput, reservation, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },

  };
}
