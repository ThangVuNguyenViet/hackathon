import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { KFC_AGENT_RUNTIME_ID } from "../agent/agentStateGraph.js";
import {
  buildKfcStateGraphProofEvidence,
  createKfcStateGraphProofSource,
} from "../proof/kfcStateGraphProofEvidence.js";
import {
  projectKfcLifecycleProofEvidence,
} from "../proof/kfcLifecycleProofEvidence.js";
import type {
  ChannelMediaDeliveryResult,
  ExternalCallContext,
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
import {
  paymentOrderIdentifierMatches,
} from "../ordering/paymentOrderAuthority.js";
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
import {
  createProductionConfirmationResumeHandler,
} from './productionConfirmationResume.js';

const proofProviderTimeoutMs = 3_000;

export function createSystemRouteHandlers(context: RouteHandlerContext) {
  const { options, store, dashboard, showcase, streamingRunObservers, customerRuns, getFixtures, withConfiguredCommerce, createWebhookClients, createDeliveryClients, dashboardProfileForTarget, createFirstPartyKfcClients, kfcProofAccessContext, latestKfcProofPreconditions, kfcAgentResponse, deferAiMonitorRefinement, deliverAssistantReply, persistEventProfile, turnMetadataFor, emitConversationTurnCreatedEvent, emitSessionModeEvent, emitSessionControlIntelligence, resumedOwnershipSummary, clearPersistedHandoff, persistedHandoffStatus, shouldEvaluateDashboardMonitorContext, ensureDashboardMonitorContext, persistNonAgentInboundEvent, pauseIfHumanJoined, latestUnansweredCustomerTurn, replyToLatestUnansweredCustomerTurn, processMessengerEventInternal, recoverStaleMessengerDeliveriesInternal, processMessengerAgentRunInternal } = context;
  const resumeConfirmation =
    createProductionConfirmationResumeHandler({
      store,
      dashboard,
      keyRing: options.confirmationApprovalKeyRing,
      checkpointer: options.checkpointer,
      agentModel: options.agent?.model,
      tracer: options.agentTracer,
      accessContext: kfcProofAccessContext,
      createClients: createFirstPartyKfcClients,
    });
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
          options.agent?.identity.provider === "openai",
      };
      const runtimeAgent =
        options.readiness?.runtime?.agent ?? options.agent?.identity;
      const agent = {
        ok: options.readiness?.agentConfigured ?? Boolean(options.agent),
        required: false,
        configured: options.readiness?.agentConfigured ?? Boolean(options.agent),
        provider: runtimeAgent?.provider ?? "unconfigured",
        model: runtimeAgent?.model ?? "unconfigured",
        profile: runtimeAgent?.profile ?? "unconfigured",
      };
      const agentProfileMode =
        options.readiness?.runtime?.agentProfileMode ?? "production";
      const runtimeMonitor = options.readiness?.runtime?.monitor;
      const monitorExpected = runtimeMonitor !== undefined;
      const monitorConfigured =
        options.readiness?.monitorConfigured ?? Boolean(options.monitorJudge);
      const monitor = {
        // The post-turn monitor is advisory and never gates customer traffic
        // or release readiness. Configuration state remains visible here.
        ok: true,
        required: false,
        configured: monitorConfigured,
        provider: runtimeMonitor?.provider ?? "unconfigured",
        model: runtimeMonitor?.model ?? "unconfigured",
        profile: runtimeMonitor?.profile ?? "unconfigured",
        message:
          monitorExpected && !monitorConfigured
            ? "The configured asynchronous monitor model is unavailable"
            : undefined,
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
            monitor,
            observability,
            catalog,
            commerce,
            pos,
          }
        : { database, fixtures, messenger, zalo, openai, agent, monitor, observability, catalog, commerce, pos };
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
              agentProfileMode,
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
              graph: { runtime: KFC_AGENT_RUNTIME_ID, checkpoint: options.checkpointer ? "configured-v1" : "memory-v1" },
              versions: {
                agent: runtimeAgent ?? {
                  provider: "unconfigured",
                  model: "unconfigured",
                  profile: "unconfigured",
                },
                monitor: runtimeMonitor ?? null,
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
      const [stateGraphProof, lifecycleSource] = await Promise.all([
        buildKfcStateGraphProofEvidence({
          sessionId,
          source: createKfcStateGraphProofSource({
            store,
            checkpointer: options.checkpointer,
          }),
          configurationAtProofTime: {
            ...(options.agent
              ? { agent: options.agent.identity }
              : {}),
          },
        }),
        options.lifecycle?.proofForSession?.(sessionId) ?? Promise.resolve({ instance: null, audit: [] }),
      ]);
      const lifecycle =
        projectKfcLifecycleProofEvidence(lifecycleSource);
      const missing = [
        ...stateGraphProof.missing,
        ...lifecycle.missing,
      ];
      return {
        status: missing.length === 0 ? 200 : 409,
        body: {
          ...stateGraphProof,
          complete: missing.length === 0,
          missing,
          sessionId,
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
        const startedAt = Date.now();
        const externalCallContext: ExternalCallContext = {
          signal: AbortSignal.timeout(proofProviderTimeoutMs),
          deadlineAt: startedAt + proofProviderTimeoutMs,
        };
        const [order, payment] = await Promise.all([
          clients.oms.getOrderStatus(
            parsed.data.orderId,
            externalCallContext,
          ),
          clients.payment.checkPaymentStatus(
            parsed.data.orderId,
            externalCallContext,
          ),
        ]);
        if (!order.ok || !order.value || !payment.ok || !payment.value) {
          return { status: 409, body: { errorCode: "kfc_proof_provider_precondition_unavailable" } };
        }
        if (
          !paymentOrderIdentifierMatches(
            order.value,
            parsed.data.orderId,
          )
        ) {
          return {
            status: 409,
            body: {
              errorCode: "kfc_proof_provider_order_authority_mismatch",
            },
          };
        }
        verifiedState = {
          ...verifiedState,
            order: order.value,
            paymentAttempt: {
              orderId: order.value.id,
              status: payment.value.status,
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
      return resumeConfirmation(parsed.data);
    },

  };
}
