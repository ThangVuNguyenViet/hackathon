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
import { createCatalogDiscoveryCache } from "../catalog/catalogDiscoveryCache.js";
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

const catalogDiscoveryCache = createCatalogDiscoveryCache();

export function createRouteCommerceRuntime(input: { options: RouteOptions; store: ConversationStore; dashboard: DashboardEventBus }) {
  const { options, store, dashboard } = input;
  let clientsPromise: ReturnType<typeof loadGeneratedFixtures> | undefined;
  const catalogPinLoads = new Map<string, Promise<CatalogObservation>>();

  function getFixtures() {
    if (options.fixtures) return Promise.resolve(options.fixtures);
    clientsPromise ??= loadGeneratedFixtures(
      options.fixturesRoot ?? defaultFixturesRoot(),
    );
    return clientsPromise;
  }

  async function withConfiguredCommerce(
    sessionId: string,
    clients: ExternalClients,
  ): Promise<ExternalClients> {
    if (options.readiness?.commerce?.mode !== "gateway") return clients;
    if (!options.catalog || !options.kfcCommerceGateway) {
      throw new Error("Gateway commerce requires catalog, order, and payment clients");
    }
    const fetchCurrent = () => fetchCatalogObservation({
      ...options.catalog!,
      fetchImpl: options.catalog!.fetchImpl,
    });
    const fetchDiscovery = () => catalogDiscoveryCache.get({
      environment: options.catalog!.environment,
      sourceUrl: options.catalog!.sourceUrl,
      load: fetchCurrent,
    });
    const events = await store.listEvents(sessionId);
    const storedPin = [...events].reverse().find((event) =>
      event.sourceType === "catalog_observation_pinned" &&
      isRecord(event.payload.observation) &&
      event.payload.observation.environment === options.catalog!.environment &&
      event.payload.observation.sourceUrl === new URL(options.catalog!.sourceUrl).toString() &&
      typeof event.payload.observation.id === "string" &&
      Array.isArray(event.payload.observation.items)
    )?.payload.observation as CatalogObservation | undefined;
    let pinned = storedPin ? Promise.resolve(storedPin) : catalogPinLoads.get(sessionId);
    if (!pinned) {
      pinned = fetchDiscovery().then(async (observation) => {
        await store.appendEvent(sessionId, "catalog_observation_pinned", { observation });
        return observation;
      }).finally(() => catalogPinLoads.delete(sessionId));
      catalogPinLoads.set(sessionId, pinned);
    }
    const unavailable = async <T>(capability: string): Promise<ToolResult<T>> => ({
      ok: false,
      errorCode: "commerce_provider_not_configured",
      message: `${capability} requires a configured commerce provider`,
    });
    const providerCart = options.kfcCommerceProvider?.cart ?? {
      createCart: () => unavailable("cart"),
      applyChanges: () => unavailable("cart"),
      updateCart: () => unavailable("cart"),
      previewCart: () => unavailable("cart"),
    };
    const lifecycle = await options.lifecycle?.activeForSession?.(sessionId);
    const gateway = lifecycle
      ? projectLifecycleCommerceClients(options.kfcCommerceGateway, lifecycle)
      : options.kfcCommerceGateway;
    const catalogClients = createCatalogObservationClients({
      sessionId,
      pinned: await pinned,
      fetchCurrent,
      cart: providerCart,
      oms: gateway.oms,
    });
    return {
      confirmationAuthority: catalogClients.confirmationAuthority,
      menu: catalogClients.menu,
      cart: catalogClients.cart,
      recommendation: catalogClients.recommendation,
      promotion: {
        searchPromotions: () => unavailable("promotions"),
        explainPromotion: () => unavailable("promotions"),
        validateVoucher: () => unavailable("promotions"),
        validateVoucherInput: () => unavailable("promotions"),
      },
      membership: {
        getProfile: () => unavailable("membership"),
        listRewards: () => unavailable("membership"),
        listWallet: () => unavailable("membership"),
        getPointHistory: () => unavailable("membership"),
        listTools: () => unavailable("membership"),
        acquireVoucher: () => unavailable("membership"),
        redeemReward: () => unavailable("membership"),
      },
      inventory: options.kfcCommerceProvider?.inventory ?? {
        checkInventory: () => unavailable("inventory"),
      },
      storeLocator: options.kfcCommerceProvider?.storeLocator ?? {
        assignStore: () => unavailable("store locator"),
        findStores: () => unavailable("store locator"),
      },
      fulfillment: options.kfcCommerceProvider?.fulfillment ?? {
        getPlanningContext: () => unavailable("fulfillment"),
        quoteFulfillment: () => unavailable("fulfillment"),
      },
      content: clients.content,
      invoice: { collectInvoice: () => unavailable("invoice") },
      oms: catalogClients.oms,
      payment: gateway.payment,
      delivery: { quoteDelivery: () => unavailable("delivery") },
      customer: {
        getSavedAddresses: () => unavailable("customer profile"),
        getRecentOrder: () => unavailable("customer profile"),
        getFavoriteItems: () => unavailable("customer profile"),
      },
      loyalty: { lookupLoyalty: () => unavailable("loyalty") },
      handoff: { escalateToHuman: () => unavailable("handoff") },
      feedback: { recordFeedback: () => unavailable("feedback") },
      messenger: clients.messenger,
      zalo: clients.zalo,
    };
  }

  async function createWebhookClients(sessionId: string): Promise<ExternalClients> {
    const clients = createMockClients(await getFixtures(), {
      ...options.mockClientOptions,
      channelClients: {
        messenger: createMessengerClient({
          pageAccessToken: options.messengerPageAccessToken,
          graphApiBaseUrl: options.messengerGraphApiBaseUrl,
          fetchImpl: options.messengerFetchImpl,
        }),
        zalo: createZaloClient({
          accessToken: options.zaloAccessToken,
          apiBaseUrl: options.zaloApiBaseUrl,
          fetchImpl: options.zaloFetchImpl,
        }),
      },
    });
    return withConfiguredCommerce(sessionId, clients);
  }

  function createDeliveryClients(): Pick<
    ExternalClients,
    "messenger" | "zalo"
  > {
    return {
      messenger: createMessengerClient({
        pageAccessToken: options.messengerPageAccessToken,
        graphApiBaseUrl: options.messengerGraphApiBaseUrl,
        fetchImpl: options.messengerFetchImpl,
      }),
      zalo: createZaloClient({
        accessToken: options.zaloAccessToken,
        apiBaseUrl: options.zaloApiBaseUrl,
        fetchImpl: options.zaloFetchImpl,
      }),
    };
  }

  async function dashboardProfileForTarget(
    target: ChannelProfileTarget,
  ): Promise<ConversationProfile | undefined> {
    const existing = await store.getProfile(
      target.channel,
      target.externalUserId,
    );
    if (existing?.displayName) return existing;

    const clients = createDeliveryClients();
    const profileResult =
      target.channel === "messenger"
        ? await clients.messenger.getProfile(target.externalUserId)
        : await clients.zalo.getProfile(target.externalUserId);
    if (!profileResult.ok) return existing;

    const profile = profileResult.value;
    if (!profile?.displayName && !profile?.avatarUrl) return existing;

    return store.upsertProfile({
      channel: target.channel,
      externalUserId: target.externalUserId,
      displayName: profile.displayName ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      profileSource: profile.profileSource,
      profileUpdatedAt: new Date().toISOString(),
    });
  }

  async function createFirstPartyKfcClients(
    sessionId: string,
    _metadata: ConversationTurnMetadata,
    profileOverride?: { providerProfile: z.infer<typeof mockedUpstreamApiProfileSchema> | null },
  ): Promise<ExternalClients> {
    let fixtures = await getFixtures();
    const proofPreconditions = profileOverride ? undefined : await latestKfcProofPreconditions(sessionId);
    const mockedProfile = profileOverride
      ? profileOverride.providerProfile ?? undefined
      : proofPreconditions && isRecord(proofPreconditions.payload.providerProfile)
        ? mockedUpstreamApiProfileSchema.parse(proofPreconditions.payload.providerProfile)
        : undefined;
    fixtures = applyMockedUpstreamFixtureOverrides(fixtures, mockedProfile);
    const unavailableItemCodes = new Set(mockedProfile?.unavailableItemCodes ?? []);
    if (unavailableItemCodes.size > 0) {
      fixtures = structuredClone(fixtures);
      fixtures.menuItems = fixtures.menuItems.map((item) => unavailableItemCodes.has(item.code) ? { ...item, available: false } : item);
      fixtures.storeAvailability = fixtures.storeAvailability.map((entry) => ({
        ...entry,
        delivery: { ...entry.delivery, excludedItemIds: [...new Set([...entry.delivery.excludedItemIds, ...unavailableItemCodes])] },
      }));
    }
    const etaMinutes = mockedProfile?.deliveryEtaMinutes;
    const feeVnd = mockedProfile?.deliveryFeeVnd;
    const clients = createMockClients(fixtures, {
      ...options.mockClientOptions,
      ...mockedUpstreamClientOptions(mockedProfile),
      ...(etaMinutes !== undefined && etaMinutes > 0 && feeVnd !== undefined
        ? { fulfillmentQuoteProvider: () => ({ ok: true as const, value: { feeVnd, etaMinutes }, message: "mocked_upstream_api_quote" }) }
        : {}),
      channelClients: {
        messenger: {
          async sendText() {
            return {
              ok: false,
              errorCode: "kfc_first_party_no_messenger_delivery",
              message:
                "KFC first-party chat does not deliver through Messenger",
            };
          },
          async sendSenderAction() {
            return {
              ok: false,
              errorCode: "kfc_first_party_no_messenger_delivery",
              message:
                "KFC first-party chat does not deliver through Messenger",
            };
          },
          async getProfile() {
            return {
              ok: false,
              errorCode: "kfc_first_party_no_messenger_profile",
              message: "KFC first-party chat does not use Messenger profiles",
            };
          },
        },
        zalo: {
          async sendText() {
            return {
              ok: false,
              errorCode: "kfc_first_party_no_zalo_delivery",
              message: "KFC first-party chat does not deliver through Zalo",
            };
          },
          async getProfile() {
            return {
              ok: false,
              errorCode: "kfc_first_party_no_zalo_profile",
              message: "KFC first-party chat does not use Zalo profiles",
            };
          },
        },
      },
    });
    return withConfiguredCommerce(sessionId, clients);
  }

  async function kfcProofAccessContext(sessionId: string, customerId: string): Promise<CustomerAccessContext | undefined> {
    const event = await latestKfcProofPreconditions(sessionId);
    if (event?.payload.authenticated !== true || event.payload.customerId !== customerId || typeof event.payload.expiresAt !== "string") return undefined;
    return {
      tenantScope: "kfc-vietnam",
      customerSurface: "kfc-app-chat",
      sessionRef: sessionId,
      surfaceSubjectRef: "not-applicable",
      kfcSubjectRef: customerId,
      authenticationState: "authenticated",
      membershipState: "member",
      channelAccountLinkState: "not-applicable",
      subjectBindingState: "verified",
      authenticationEvidence: {
        state: "verified",
        method: "sandbox-proof-control",
        issuer: "kfc-agent-backend",
        audience: "kfc-agent-backend",
        authenticatedAt: event.createdAt,
        expiresAt: event.payload.expiresAt,
        evidenceRef: event.id,
      },
      authorizedScopes: ["customer:read", "membership:read", "membership:write", "order:read", "payment:read"],
    };
  }

  async function latestKfcProofPreconditions(sessionId: string) {
    if (options.lifecycle?.environment !== "sandbox") return undefined;
    const event = [...await store.listEvents(sessionId)].reverse().find(({ sourceType }) => sourceType === "proof:kfc_preconditions");
    if (!event || typeof event.payload.expiresAt !== "string" || Date.parse(event.payload.expiresAt) <= Date.now()) return undefined;
    return event;
  }


  return { getFixtures, withConfiguredCommerce, createWebhookClients, createDeliveryClients, dashboardProfileForTarget, createFirstPartyKfcClients, kfcProofAccessContext, latestKfcProofPreconditions };
}

export type RouteCommerceRuntime = ReturnType<typeof createRouteCommerceRuntime>;
