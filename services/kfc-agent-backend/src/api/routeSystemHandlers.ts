import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { projectKfcLifecycleProofEvidence } from '../proof/kfcLifecycleProofEvidence.js';
import type {
  ChannelMediaDeliveryResult,
  ExternalCallContext,
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
import { dashboardSessionTarget } from '../dashboard/sessionVisibility.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type {
  AgentMode,
  Channel,
  ConversationProfile,
  ConversationTurn,
  ConversationTurnMetadata,
  CustomerAccessContext,
  MonitorSessionIntelligence,
  ToolResult,
} from '../domain/types.js';
import { customerCommandFromVerifiedAction } from '../domain/customerCommand.js';
import { isKfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { AgentState } from '../agent/agentState.js';
import {
  calculateMonitorSessionIntelligence,
  preserveMonitorContext,
  countCustomerTurns,
  monitorContextReevaluationCustomerTurnThreshold,
  resolveMonitorSessionIntelligence,
} from '../monitor/sessionIntelligence.js';
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
import { paymentOrderIdentifierMatches } from '../ordering/paymentOrderAuthority.js';
import { kfcVietnamPack } from '../businessPacks/kfcVietnam/kfcVietnamPack.js';
import { createPackStateEnvelope } from '../runtime/businessPack.js';
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
  type WebhookDelivery,
} from '../persistence/memoryStore.js';
import {
  buildBoundedRecentTurns,
  sessionIdForConversationEvent,
} from '../session/sessionContext.js';
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
  KfcRecommendationProofProjection,
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

import type { RouteHandlerContext } from './routeHandlerContext.js';

const proofProviderTimeoutMs = 3_000;

async function projectKfcProofTurn(turn: ConversationTurn) {
  return {
    id: turn.id,
    ordinal: turn.ordinal,
    channel: turn.channel,
    role: turn.role,
    deliveryStatus: turn.deliveryStatus,
    createdAt: turn.createdAt,
    content: {
      characterCount: [...turn.text].length,
      sha256: await sha256Fingerprint(turn.text),
    },
    externalMessageIdDigest:
      turn.externalMessageId === null
        ? null
        : await sha256Fingerprint(turn.externalMessageId),
    metadataDigest:
      turn.metadata === null ? null : await sha256Fingerprint(turn.metadata),
  };
}

export function createSystemRouteHandlers(context: RouteHandlerContext) {
  const {
    options,
    store,
    dashboard,
    showcase,
    streamingRunObservers,
    customerRuns,
    getFixtures,
    withConfiguredCommerce,
    createWebhookClients,
    createDeliveryClients,
    dashboardProfileForTarget,
    createFirstPartyKfcClients,
    kfcProofAccessContext,
    latestKfcProofPreconditions,
    kfcAgentResponse,
    deferAiMonitorRefinement,
    deliverAssistantReply,
    persistEventProfile,
    turnMetadataFor,
    emitConversationTurnCreatedEvent,
    emitSessionModeEvent,
    emitSessionControlIntelligence,
    resumedOwnershipSummary,
    recommendations,
    clearPersistedHandoff,
    persistedHandoffStatus,
    shouldEvaluateDashboardMonitorContext,
    ensureDashboardMonitorContext,
    persistNonAgentInboundEvent,
    pauseIfHumanJoined,
    latestUnansweredCustomerTurn,
    replyToLatestUnansweredCustomerTurn,
    processMessengerEventInternal,
    recoverStaleMessengerDeliveriesInternal,
    processMessengerAgentRunInternal,
  } = context;
  return {
    health() {
      return { status: 200, body: { ok: true, service: 'kfc-agent-backend' } };
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
          options.agent?.identity.provider === 'openai',
      };
      const runtimeAgent =
        options.readiness?.runtime?.agent ?? options.agent?.identity;
      const agent = {
        ok: options.readiness?.agentConfigured ?? Boolean(options.agent),
        required: false,
        configured:
          options.readiness?.agentConfigured ?? Boolean(options.agent),
        provider: runtimeAgent?.provider ?? 'unconfigured',
        model: runtimeAgent?.model ?? 'unconfigured',
        profile: runtimeAgent?.profile ?? 'unconfigured',
      };
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
        provider: runtimeMonitor?.provider ?? 'unconfigured',
        model: runtimeMonitor?.model ?? 'unconfigured',
        profile: runtimeMonitor?.profile ?? 'unconfigured',
        message:
          monitorExpected && !monitorConfigured
            ? 'The configured asynchronous monitor model is unavailable'
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
      const commerce = {
        ok: true,
        mode: 'fixture',
        configured: true,
        production: false,
        message: 'Bundled fixture-backed mock commerce is enabled',
      };
      const recommendationShadow = options.readiness?.recommendationShadow ?? {
        ok: true as const,
        required: false as const,
        configured: false,
        outputMode: 'baseline' as const,
        message: 'Recommendation shadow scoring is not configured',
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
            commerce,
            recommendationShadow,
          }
        : {
            database,
            fixtures,
            messenger,
            zalo,
            openai,
            agent,
            monitor,
            observability,
            commerce,
            recommendationShadow,
          };
      const ok = Object.values(checks).every((check) => check.ok);

      return {
        status: ok ? 200 : 503,
        body: {
          ok,
          service: 'kfc-agent-backend',
          checks,
          ...(options.readiness?.release
            ? { release: options.readiness.release }
            : {}),
          ...(deep
            ? {
                proof: {
                  deployment: options.readiness?.release ?? null,
                  commerceEnvironment: 'fixture',
                  providerFingerprint: null,
                  catalogObservation: null,
                  lifecycle: {
                    provider:
                      options.lifecycle?.environment === 'sandbox'
                        ? 'd1'
                        : null,
                    controlsRegistered:
                      options.lifecycle?.environment === 'sandbox',
                  },
                  agent: {
                    runtime: 'simple-model-tool-loop',
                    context: 'conversation-history',
                  },
                  versions: {
                    agent: runtimeAgent ?? {
                      provider: 'unconfigured',
                      model: 'unconfigured',
                      profile: 'unconfigured',
                    },
                    monitor: runtimeMonitor ?? null,
                    toolCatalog: 'typed-commerce-tools-v1',
                    ranker: 'deterministic-safety-rerank-v1',
                    ledger: 'kfc-scenario-ledger-v1',
                    recommendationShadow,
                  },
                },
              }
            : {}),
          timestamp: new Date().toISOString(),
        },
      };
    },
    async lifecycleCreate(sessionId: string) {
      if (!options.lifecycle || options.lifecycle.environment !== 'sandbox') {
        return { status: 404, body: { errorCode: 'not_found' } };
      }
      try {
        return {
          status: 201,
          body: await options.lifecycle.controls.create(
            await options.lifecycle.createInput(sessionId),
          ),
        };
      } catch (error) {
        return lifecycleErrorResponse(error);
      }
    },
    async lifecycleGet(instanceId: string) {
      if (!options.lifecycle || options.lifecycle.environment !== 'sandbox') {
        return { status: 404, body: { errorCode: 'not_found' } };
      }
      try {
        return {
          status: 200,
          body: await options.lifecycle.controls.get(
            await options.lifecycle.binding(instanceId),
          ),
        };
      } catch (error) {
        return lifecycleErrorResponse(error);
      }
    },
    async lifecycleEvent(instanceId: string, body: unknown) {
      if (!options.lifecycle || options.lifecycle.environment !== 'sandbox') {
        return { status: 404, body: { errorCode: 'not_found' } };
      }
      const parsed = lifecycleEventPayloadSchema.safeParse(body);
      if (!parsed.success)
        return {
          status: 400,
          body: {
            errorCode: 'invalid_lifecycle_event',
            issues: parsed.error.issues,
          },
        };
      try {
        const binding = await options.lifecycle.binding(instanceId);
        const context: MutationContext = {
          expectedRevision: parsed.data.expectedRevision,
          idempotencyKey: parsed.data.idempotencyKey,
          requestFingerprint: await sha256Fingerprint(parsed.data),
          traceId: parsed.data.traceId,
          runId: parsed.data.runId,
          requestId: parsed.data.requestId,
          actor: 'sandbox-proof-control',
        };
        return {
          status: 200,
          body: await options.lifecycle.controls.transition(
            binding,
            parsed.data.event,
            context,
          ),
        };
      } catch (error) {
        return lifecycleErrorResponse(error);
      }
    },
    async messengerProofEnvelope(sessionId: string) {
      const [
        turns,
        webhookDeliveries,
        pendingCustomerTurns,
        agentRuns,
        sessionAgentState,
        providerEvents,
        lifecycle,
      ] = await Promise.all([
        store.listTurns(sessionId),
        store.listWebhookDeliveries(sessionId),
        store.listPendingCustomerTurns(sessionId),
        store.listAgentRuns(sessionId),
        store.getSessionAgentState(sessionId),
        store
          .getCatalogPin(sessionId)
          .then((projection) => (projection ? [projection] : [])),
        options.lifecycle?.proofForSession?.(sessionId) ??
          Promise.resolve({ instance: null, audit: [] }),
      ]);
      const links = (
        await Promise.all(
          agentRuns.map(async (run) => ({
            runId: run.id,
            turns: await store.listAgentRunTurns(run.id),
          })),
        )
      ).flatMap(({ runId, turns: runLinks }) =>
        runLinks.map((link) => ({ ...link, runId })),
      );
      const userTurns = turns.filter(
        (turn) => turn.role === 'user' && turn.externalMessageId,
      );
      const assistantById = new Map(
        turns
          .filter((turn) => turn.role === 'assistant')
          .map((turn) => [turn.id, turn]),
      );
      const runIds = new Set(agentRuns.map(({ id }) => id));
      const linkedRunIds = new Set(links.map(({ runId }) => runId));
      const webhookIds = new Set(
        webhookDeliveries
          .filter(({ status }) => status === 'processed')
          .map(({ externalEventId }) => externalEventId),
      );
      const missing = [
        ...(webhookDeliveries.length > 0 &&
        userTurns.every(({ externalMessageId }) =>
          webhookIds.has(externalMessageId!),
        )
          ? []
          : ['webhook_deliveries']),
        ...(pendingCustomerTurns.length > 0 &&
        pendingCustomerTurns.every(
          ({ status, claimedRunId }) =>
            status === 'claimed' && claimedRunId && runIds.has(claimedRunId),
        )
          ? []
          : ['pending_customer_turns']),
        ...(agentRuns.length > 0 &&
        agentRuns.every(({ id }) => linkedRunIds.has(id))
          ? []
          : ['agent_runs_and_links']),
        ...(sessionAgentState.generation ===
        Math.max(0, ...agentRuns.map(({ generation }) => generation))
          ? []
          : ['agent_generation']),
        ...(providerEvents.length > 0 ? [] : ['provider_audit']),
        ...(lifecycle.instance && lifecycle.audit.length > 0
          ? []
          : ['lifecycle_audit']),
        ...(agentRuns.filter(({ status }) => status === 'completed').length >
          0 &&
        agentRuns
          .filter(({ status }) => status === 'completed')
          .every((run) => {
            const assistant = run.assistantTurnId
              ? assistantById.get(run.assistantTurnId)
              : undefined;
            return (
              run.deliveryStatus === 'sent' &&
              Boolean(run.deliveryExternalMessageId) &&
              assistant?.externalMessageId === run.deliveryExternalMessageId
            );
          })
          ? []
          : ['outbound_graph_api_correlation']),
      ];
      const body = {
        schemaVersion: 1,
        artifactKind: 'messenger-session-proof-envelope',
        complete: missing.length === 0,
        missing,
        sessionId,
        webhookDeliveries,
        pendingCustomerTurns,
        agentRuns,
        agentRunTurns: links,
        sessionAgentState,
        providerEvents,
        lifecycle,
        outbound: agentRuns
          .filter(({ status }) => status === 'completed')
          .map((run) => ({
            runId: run.id,
            assistantTurnId: run.assistantTurnId,
            graphApiExternalMessageId: run.deliveryExternalMessageId,
            persistedExternalMessageId: run.assistantTurnId
              ? (assistantById.get(run.assistantTurnId)?.externalMessageId ??
                null)
              : null,
          })),
      };
      return { status: missing.length === 0 ? 200 : 409, body };
    },
    async kfcProofEnvelope(sessionId: string) {
      const [turns, packState, lifecycleSource, recommendationSession] =
        await Promise.all([
          store.listTurns(sessionId),
          store.getPackState(sessionId, kfcVietnamPack.ref),
          options.lifecycle?.proofForSession?.(sessionId) ??
            Promise.resolve({ instance: null, audit: [] }),
          recommendations?.inspection.session(sessionId) ??
            Promise.resolve(null),
        ]);
      const lifecycle = projectKfcLifecycleProofEvidence(lifecycleSource);
      const proofTurns = await Promise.all(turns.map(projectKfcProofTurn));
      const missing = [
        ...(turns.length > 0 ? [] : ['conversation_turns']),
        ...lifecycle.missing,
      ];
      const recommendationProjection:
        KfcRecommendationProofProjection | undefined = recommendationSession
        ? (() => {
            const {
              correlations: { sessionId: _sessionId, ...correlations },
              ...projection
            } = recommendationSession;
            return { ...projection, correlations };
          })()
        : undefined;
      return {
        status: missing.length === 0 ? 200 : 409,
        body: {
          schemaVersion: 1,
          artifactKind: 'kfc-simple-agent-proof',
          runtime: 'simple-model-tool-loop',
          turns: proofTurns,
          packState,
          agent: options.agent?.identity ?? null,
          complete: missing.length === 0,
          missing,
          sessionId,
          lifecycle,
          ...(recommendationProjection
            ? { recommendations: recommendationProjection }
            : {}),
        },
      };
    },
    async kfcProofPreconditions(sessionId: string, body: unknown) {
      if (options.lifecycle?.environment !== 'sandbox')
        return { status: 404, body: { errorCode: 'not_found' } };
      const parsed = kfcProofPreconditionsSchema.safeParse(body);
      if (
        !parsed.success ||
        sessionId !== `kfc:${parsed.data?.customerId ?? ''}`
      ) {
        return {
          status: 400,
          body: { errorCode: 'invalid_kfc_proof_preconditions' },
        };
      }
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      let verifiedState = parsed.data.verifiedState;
      if (parsed.data.orderId) {
        const clients = await createFirstPartyKfcClients(
          sessionId,
          {},
          {
            providerProfile: parsed.data.providerProfile ?? null,
          },
        );
        const startedAt = Date.now();
        const externalCallContext: ExternalCallContext = {
          signal: AbortSignal.timeout(proofProviderTimeoutMs),
          deadlineAt: startedAt + proofProviderTimeoutMs,
        };
        const [order, payment] = await Promise.all([
          clients.oms.getOrderStatus(parsed.data.orderId, externalCallContext),
          clients.payment.checkPaymentStatus(
            parsed.data.orderId,
            externalCallContext,
          ),
        ]);
        if (!order.ok || !order.value || !payment.ok || !payment.value) {
          return {
            status: 409,
            body: { errorCode: 'kfc_proof_provider_precondition_unavailable' },
          };
        }
        if (!paymentOrderIdentifierMatches(order.value, parsed.data.orderId)) {
          return {
            status: 409,
            body: {
              errorCode: 'kfc_proof_provider_order_authority_mismatch',
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
      await store.putSandboxProofSession({
        sessionId,
        customerId: parsed.data.customerId,
        authenticated: parsed.data.authenticated,
        expiresAt,
        orderId: parsed.data.orderId ?? null,
        providerProfile: parsed.data.providerProfile ?? null,
        createdAt: new Date().toISOString(),
      });
      if (verifiedState) {
        await store.putPackState(
          sessionId,
          await createPackStateEnvelope({
            packRef: kfcVietnamPack.ref,
            schemaVersion: kfcVietnamPack.stateSchemaVersion,
            state: kfcVietnamPack.parseState(verifiedState),
          }),
        );
      }
      return {
        status: 201,
        body: {
          ok: true,
          sessionId,
          authenticated: parsed.data.authenticated,
          orderId: parsed.data.orderId ?? null,
          providerProfileBound: parsed.data.providerProfile != null,
          expiresAt,
        },
      };
    },
  };
}
