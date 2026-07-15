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
  type LifecycleTransition,
  type MutationContext,
  type SandboxLifecycleControls,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const kfcSessionIdSchema = z
  .string()
  .refine((value) => value.startsWith("kfc:"), {
    message: "KFC chat sessions must use the kfc: prefix",
  });

const kfcChatPayloadSchema = z
  .object({
    sessionId: kfcSessionIdSchema,
    customerId: z.string().min(1),
    clientMessageId: z.string().min(1),
    text: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(kfcSessionMatchesCustomer, {
    path: ["sessionId"],
    message: "KFC session must match the supplied customer ID",
  });

const kfcGenUiActionPayloadSchema = z
  .object({
    sessionId: kfcSessionIdSchema,
    customerId: z.string().min(1),
    clientMessageId: z.string().min(1),
    action: z.object({
      attachmentId: z.string().min(1),
      actionId: z.string().min(1),
      value: z.string().optional(),
      payload: z.record(z.unknown()).optional(),
    }),
  })
  .strict()
  .refine(kfcSessionMatchesCustomer, {
    path: ["sessionId"],
    message: "KFC session must match the supplied customer ID",
  });

const kfcSmartMenuBatchPayloadSchema = z.object({
  items: z.array(z.object({
    itemCode: z.string().min(1),
    quantity: z.number().int().min(1).max(99),
  }).strict()).min(1).max(5),
}).strict().superRefine((payload, context) => {
  const seen = new Set<string>();
  payload.items.forEach((item, index) => {
    if (seen.has(item.itemCode)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['items', index, 'itemCode'], message: 'Item codes must be unique' });
    }
    seen.add(item.itemCode);
  });
});

const messengerHistorySyncPayloadSchema = z
  .object({
    limitConversations: z.number().int().positive().optional(),
    since: z.string().datetime({ offset: true }).optional(),
  })
  .optional();

const staleMessengerRecoveryPayloadSchema = z
  .object({
    olderThanMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .optional();

const sessionControlPayloadSchema = z.object({
  agentId: z.string().min(1).optional(),
});

const dashboardSessionDefaultLookbackMs = 24 * 60 * 60 * 1000;

const humanMessagePayloadSchema = z.object({
  agentId: z.string().min(1),
  text: z.string().min(1),
});

const lifecycleTransitionSchema: z.ZodType<LifecycleTransition> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("payment_pending"), attemptId: z.string().min(1) }).strict(),
  ...(["payment_paid", "payment_failed", "payment_expired", "payment_cancelled", "order_accepted", "order_rejected", "order_preparing", "order_ready", "order_completed", "order_cancelled", "delivery_assigned", "delivery_started", "delivery_delivered", "delivery_cancelled", "delivery_failed"] as const)
    .map((type) => z.object({ type: z.literal(type) }).strict()),
  z.object({ type: z.literal("delivery_pending"), attemptId: z.string().min(1) }).strict(),
]);

const lifecycleEventPayloadSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(200),
  event: lifecycleTransitionSchema,
  traceId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
}).strict();

function lifecycleErrorResponse(error: unknown): HandlerResponse {
  if (error instanceof LifecycleError) {
    return { status: error.statusCode, body: { errorCode: error.code, message: error.message } };
  }
  return { status: 500, body: { errorCode: "lifecycle_control_failed", message: error instanceof Error ? error.message : String(error) } };
}

export interface ReadinessCheckResult {
  ok: boolean;
  message?: string;
  required?: boolean;
  configured?: boolean;
}

export interface ReadinessOptions {
  database?: () => Promise<ReadinessCheckResult>;
  messengerToken?: () => Promise<ReadinessCheckResult>;
  fixturesRoot?: string;
  openAiConfigured?: boolean;
  openAiRequired?: boolean;
  zaloRequired?: boolean;
  langsmith?: {
    configured: boolean;
    project: string;
    endpoint: string;
    samplingRate: number;
  };
  commerce?: {
    mode: "fixture" | "gateway";
    baseUrl?: string;
    token?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    requiredCapabilities?: string[];
  };
  pos?: {
    mode: "disabled" | "http";
    baseUrl?: string;
    token?: string;
    simulated?: boolean;
  };
}

export interface RouteOptions {
  fixturesRoot?: string;
  demoAdminToken?: string;
  messengerVerifyToken?: string;
  metaAppSecret?: string;
  metaPageId?: string;
  messengerPageAccessToken?: string;
  metaInboxUrlTemplate?: string;
  messengerGraphApiBaseUrl?: string;
  messengerFetchImpl?: typeof fetch;
  zaloOaId?: string;
  zaloAccessToken?: string;
  zaloInboxUrlTemplate?: string;
  zaloApiBaseUrl?: string;
  zaloFetchImpl?: typeof fetch;
  responseComposer?: ResponseComposer;
  toolPlanner?: ToolPlanner;
  smallTalkRouter?: SmallTalkRouter;
  monitorJudge?: MonitorSessionIntelligenceJudge;
  agentTracer?: AgentTracer;
  checkpointer?: BaseCheckpointSaver;
  defer?: (task: () => Promise<void>) => void;
  customerRunPaceMs?: number;
  customerRunMaxTextEvents?: number;
  customerRunSleep?: (milliseconds: number) => Promise<void>;
  mockClientOptions?: MockClientOptions;
  fixtures?: GeneratedFixtures;
  store?: ConversationStore;
  dashboard?: DashboardEventBus;
  messengerHistorySync?: MessengerHistorySyncCoordinator;
  readiness?: ReadinessOptions;
  kfcCommerceGateway?: KfcCommerceGatewayClients;
  kfcCommerceProvider?: Pick<
    ExternalClients,
    "cart" | "inventory" | "storeLocator" | "fulfillment"
  >;
  catalog?: {
    environment: CommerceEnvironment;
    sourceUrl: string;
    fetchImpl?: typeof fetch;
    fallbackTtlSeconds?: number;
  };
  lifecycle?: {
    environment: CommerceEnvironment;
    controls: Pick<SandboxLifecycleControls, "create" | "get" | "transition">;
    createInput(sessionId: string): Promise<CreateLifecycleInput>;
    binding(instanceId: string): Promise<LifecycleBinding>;
  };
  showcase?: {
    source: ShowcaseScenarioSource;
    releaseSha: string;
    plannerModel: string;
    responseModel: string;
  };
}

export interface HandlerResponse<T = unknown> {
  status: number;
  body: T;
  contentType?: string;
}

export interface MessengerWebhookEventProcessingResult {
  status: "processed" | "failed" | "skipped";
  errorCode?: string;
  errorMessage?: string;
}

export interface StaleMessengerDeliveryRecoveryResult {
  scanned: number;
  processed: number;
  failed: number;
  skipped: number;
  cutoff: string;
  deliveries: Array<{
    externalEventId: string;
    sessionId: string;
    status: MessengerWebhookEventProcessingResult["status"] | "invalid";
    errorCode?: string;
    errorMessage?: string;
  }>;
}

export interface RouteHandlers {
  store: ConversationStore;
  dashboard: DashboardEventBus;
  health(): HandlerResponse;
  ready(): Promise<HandlerResponse>;
  lifecycleCreate(sessionId: string): Promise<HandlerResponse>;
  lifecycleGet(instanceId: string): Promise<HandlerResponse>;
  lifecycleEvent(instanceId: string, body: unknown): Promise<HandlerResponse>;
  chatKfcMessage(body: unknown): Promise<HandlerResponse>;
  chatKfcGenUiAction(body: unknown): Promise<HandlerResponse>;
  chatKfcStartRun(body: unknown): Promise<HandlerResponse>;
  chatKfcCancelRun(runId: string): Promise<HandlerResponse>;
  showcaseCatalog(): Promise<HandlerResponse>;
  showcaseComplete(body: unknown): Promise<HandlerResponse>;
  chatKfcSessionUpdates(sessionId: string, afterTurnId?: string): Promise<HandlerResponse>;
  messengerVerify(query: Record<string, unknown>): HandlerResponse<string>;
  messengerWebhook(body: unknown): Promise<HandlerResponse>;
  processMessengerEvent(
    event: ConversationEvent,
  ): Promise<MessengerWebhookEventProcessingResult>;
  recoverStaleMessengerDeliveries(
    body?: unknown,
  ): Promise<HandlerResponse<StaleMessengerDeliveryRecoveryResult>>;
  processMessengerAgentRun(
    runId: string,
  ): Promise<MessengerWebhookEventProcessingResult>;
  zaloWebhook(body: unknown): Promise<HandlerResponse>;
  messengerHistorySync(body: unknown): Promise<HandlerResponse>;
  messengerHistorySyncStatus(): HandlerResponse;
  dashboardHumanJoin(
    sessionId: string,
    body: unknown,
  ): Promise<HandlerResponse>;
  dashboardHumanMessage(
    sessionId: string,
    body: unknown,
  ): Promise<HandlerResponse>;
  dashboardResumeAi(sessionId: string, body: unknown): Promise<HandlerResponse>;
  dashboardSessionControl(sessionId: string): Promise<HandlerResponse>;
  dashboardEvents(sessionId: string): HandlerResponse;
  dashboardSessions(): Promise<HandlerResponse>;
  dashboardTurns(sessionId: string): Promise<HandlerResponse>;
}

function defaultFixturesRoot(): string {
  if (existsSync(join(process.cwd(), "fixtures/generated")))
    return process.cwd();
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function createRouteHandlers(options: RouteOptions = {}): RouteHandlers {
  const store = options.store ?? new MemoryStore();
  const dashboard = options.dashboard ?? new DashboardEventBus();
  const showcase = options.showcase
    ? new ShowcaseService({ ...options.showcase, store })
    : undefined;
  const streamingRunObservers = new Map<string, {
    observe: (observation: CustomerRunObservation) => Promise<void>;
    isCurrent: () => Promise<boolean>;
  }>();
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
      pinned = fetchCurrent().then(async (observation) => {
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
    const catalogClients = createCatalogObservationClients({
      sessionId,
      pinned: await pinned,
      fetchCurrent,
      cart: providerCart,
      oms: options.kfcCommerceGateway.oms,
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
      payment: options.kfcCommerceGateway.payment,
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
    metadata: ConversationTurnMetadata,
  ): Promise<ExternalClients> {
    let fixtures = await getFixtures();
    const rawProfile = isRecord(metadata.rawEvent) && metadata.rawEvent.mockedUpstreamAuthorized === true && isRecord(metadata.rawEvent.mockedUpstreamApi)
      ? metadata.rawEvent.mockedUpstreamApi
      : undefined;
    const mockedProfile = rawProfile ? mockedUpstreamApiProfileSchema.parse(rawProfile) : undefined;
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

  async function kfcAgentResponse(input: {
    sessionId: string;
    customerId: string;
    clientMessageId: string;
    text: string;
    metadata: ConversationTurnMetadata;
    observeRun?: (observation: CustomerRunObservation) => Promise<void>;
    runGuard?: { isCurrent(): Promise<boolean> };
  }): Promise<HandlerResponse> {
    const requestFingerprint = await sha256Fingerprint({
      customerId: input.customerId,
      text: input.text,
      metadata: input.metadata,
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
          metadata: input.metadata,
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
      responseProfile: input.metadata.responseProfile,
      text: input.text,
      externalMessageId: input.clientMessageId,
      metadata: input.metadata,
      clients: await createFirstPartyKfcClients(input.sessionId, input.metadata),
      store,
      dashboard,
      responseComposer: options.responseComposer,
      toolPlanner: options.toolPlanner,
      smallTalkRouter: options.smallTalkRouter,
      monitorJudge: options.monitorJudge,
      tracer: options.agentTracer,
      checkpointer: options.checkpointer,
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

  let routeHandlers!: RouteHandlers;
  const customerRuns = new CustomerRunCoordinator({
    store,
    defer: options.defer,
    paceMs: options.customerRunPaceMs,
    maxTextEvents: options.customerRunMaxTextEvents,
    sleep: options.customerRunSleep,
    execute: async (request: CustomerRunStartRequest, _runId, observeRun, isCurrent) => {
      let response: HandlerResponse;
      if (request.input.kind === "text") {
        const responseProfile = request.metadata?.showcaseResponseMode === "text"
          ? "social" as const
          : request.metadata?.showcaseResponseMode === "genui"
            ? "genui" as const
            : undefined;
        response = await kfcAgentResponse({
            sessionId: request.sessionId,
            customerId: request.customerId,
            clientMessageId: request.clientMessageId,
            text: request.input.text,
            metadata: {
              rawEvent: { source: "kfc_stream", ...request.metadata },
              ...(responseProfile ? { responseProfile } : {}),
            },
            observeRun,
            runGuard: { isCurrent },
          });
      } else {
        streamingRunObservers.set(request.clientMessageId, { observe: observeRun, isCurrent });
        try {
          response = await routeHandlers.chatKfcGenUiAction({
            sessionId: request.sessionId,
            customerId: request.customerId,
            clientMessageId: request.clientMessageId,
            action: {
              attachmentId: request.input.attachmentId,
              actionId: request.input.actionId,
              ...(request.input.value === undefined ? {} : { value: request.input.value }),
              ...(request.input.payload === undefined ? {} : { payload: request.input.payload }),
            },
          });
        } finally {
          streamingRunObservers.delete(request.clientMessageId);
        }
      }
      if (response.status < 200 || response.status >= 300 || !isRecord(response.body)) {
        throw new Error("KFC run execution failed");
      }
      if (typeof response.body.responseText !== "string") {
        throw new Error("KFC run response is missing customer text");
      }
      return response.body as unknown as {
        responseText: string;
        genUi?: import("../genui/kfcGenUi.js").KfcGenUiAttachment;
        assistantTurnId?: string | null;
      };
    },
  });

  routeHandlers = {
    store,
    dashboard,
    health() {
      return { status: 200, body: { ok: true, service: "kfc-agent-backend" } };
    },
    async ready() {
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
      const observability = {
        ok: true,
        langsmith: options.readiness?.langsmith ?? {
          configured: Boolean(options.agentTracer),
          project: null,
          endpoint: null,
          samplingRate: 0,
        },
      };
      const commerceConfig = options.readiness?.commerce ?? {
        mode: "fixture" as const,
      };
      const commerce =
        commerceConfig.mode === "fixture"
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
      const catalog = commerceConfig.mode === "gateway"
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
            observability,
            catalog,
            commerce,
            pos,
          }
        : { database, fixtures, messenger, zalo, openai, observability, catalog, commerce, pos };
      const ok = Object.values(checks).every((check) => check.ok);

      return {
        status: ok ? 200 : 503,
        body: {
          ok,
          service: "kfc-agent-backend",
          checks,
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
    async chatKfcMessage(body: unknown) {
      const parsed = kfcChatPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            errorCode: "invalid_kfc_chat_payload",
            issues: parsed.error.issues,
          },
        };
      }

      const responseProfile = parsed.data.metadata?.showcaseResponseMode === "text"
        ? "social" as const
        : parsed.data.metadata?.showcaseResponseMode === "genui"
          ? "genui" as const
          : undefined;
      return kfcAgentResponse({
        sessionId: parsed.data.sessionId,
        customerId: parsed.data.customerId,
        clientMessageId: parsed.data.clientMessageId,
        text: parsed.data.text,
        metadata: {
          rawEvent: { source: "kfc_chat", ...parsed.data.metadata },
          ...(responseProfile ? { responseProfile } : {}),
        },
      });
    },
    async chatKfcStartRun(body: unknown) {
      return customerRuns.start(body);
    },
    async chatKfcCancelRun(runId: string) {
      return customerRuns.cancel(runId);
    },
    async showcaseCatalog() {
      if (!showcase) return { status: 503, body: { errorCode: "showcase_not_configured" } };
      try {
        return { status: 200, body: await showcase.catalog() };
      } catch (error) {
        return {
          status: 503,
          body: {
            errorCode: "showcase_catalog_unavailable",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    async showcaseComplete(body: unknown) {
      if (!showcase) return { status: 503, body: { errorCode: "showcase_not_configured" } };
      try {
        return { status: 200, body: await showcase.complete(body) };
      } catch (error) {
        if (error instanceof ShowcaseValidationError || error instanceof z.ZodError) {
          return {
            status: error instanceof ShowcaseValidationError && error.code === "showcase_scenario_not_found" ? 404 : 422,
            body: { errorCode: error instanceof ShowcaseValidationError ? error.code : "invalid_showcase_result" },
          };
        }
        throw error;
      }
    },
    async chatKfcGenUiAction(body: unknown) {
      const parsed = kfcGenUiActionPayloadSchema.safeParse(body);
      if (!parsed.success) {
        return {
          status: 400,
          body: {
            errorCode: "invalid_kfc_genui_action_payload",
            issues: parsed.error.issues,
          },
        };
      }

      const attachment = (await store.listTurns(parsed.data.sessionId))
        .slice()
        .reverse()
        .map((turn) => turn.metadata?.genUi)
        .find(
          (candidate) =>
            isKfcGenUiAttachment(candidate) &&
            candidate.id === parsed.data.action.attachmentId,
        );
      if (!attachment || !isKfcGenUiAttachment(attachment)) {
        return {
          status: 404,
          body: { errorCode: "action_not_found" },
        };
      }
      const actionSpec = attachment.actions.find(
        (candidate) => candidate.id === parsed.data.action.actionId,
      );
      if (!actionSpec) {
        return {
          status: 404,
          body: { errorCode: "action_not_found" },
        };
      }
      if (attachment.status !== "active") {
        return {
          status: 409,
          body: { errorCode: "stale_action" },
        };
      }
      const clientQuantity = parsed.data.action.payload?.quantity;
      if (
        clientQuantity !== undefined &&
        (typeof clientQuantity !== "number" ||
          !Number.isInteger(clientQuantity) ||
          clientQuantity < 1)
      ) {
        return {
          status: 422,
          body: { errorCode: "invalid_action_payload" },
        };
      }
      let trustedPayload: Record<string, unknown> = {
        ...(actionSpec.payload ?? {}),
      };
      let trustedValue = actionSpec.value ?? parsed.data.action.value;
      if (actionSpec.id === "add_items") {
        if (attachment.widgetKind !== "smartMenuPicker") {
          return { status: 422, body: { errorCode: "invalid_action_payload" } };
        }
        const batch = kfcSmartMenuBatchPayloadSchema.safeParse(parsed.data.action.payload);
        const allowedCodes = new Set(
          (Array.isArray(attachment.data.items) ? attachment.data.items : [])
            .filter(isRecord)
            .map((item) => item.code)
            .filter((code): code is string => typeof code === "string"),
        );
        if (!batch.success || batch.data.items.some((item) => !allowedCodes.has(item.itemCode))) {
          return { status: 422, body: { errorCode: "invalid_action_payload" } };
        }
        trustedPayload = { items: batch.data.items };
        trustedValue = undefined;
      } else if (actionSpec.id === "add_item") {
        const requestedItemCode = parsed.data.action.payload?.itemCode;
        const items = Array.isArray(attachment.data.items)
          ? attachment.data.items
          : [];
        const selectedItem = items.find(
          (item) =>
            isRecord(item) &&
            typeof requestedItemCode === "string" &&
            item.code === requestedItemCode,
        );
        if (!isRecord(selectedItem)) {
          return {
            status: 422,
            body: { errorCode: "invalid_action_payload" },
          };
        }
        trustedPayload.itemCode = selectedItem.code;
        trustedValue =
          typeof selectedItem.name === "string"
            ? selectedItem.name
            : trustedValue;
      }
      if (actionSpec.id === "remove_item" || actionSpec.id === "update_item_quantity") {
        const requestedItemCode = parsed.data.action.payload?.itemCode;
        const cart = isRecord(attachment.data.cart) ? attachment.data.cart : {};
        const items = Array.isArray(cart.items) ? cart.items : [];
        const selectedItem = items.find(
          (item) => isRecord(item) && typeof requestedItemCode === "string" && item.itemCode === requestedItemCode,
        );
        if (!isRecord(selectedItem)) {
          return { status: 422, body: { errorCode: "invalid_action_payload" } };
        }
        trustedPayload.itemCode = selectedItem.itemCode;
        trustedValue = typeof selectedItem.name === "string" ? selectedItem.name : trustedValue;
      }
      if (actionSpec.id === "select_payment_method") {
        const requestedMethodId = parsed.data.action.payload?.methodId;
        const methods = Array.isArray(attachment.data.methods) ? attachment.data.methods : [];
        const selectedMethod = methods.find(
          (method) => isRecord(method) && typeof requestedMethodId === "string" && method.methodId === requestedMethodId,
        );
        if (!isRecord(selectedMethod) || selectedMethod.supported !== true) {
          return { status: 422, body: { errorCode: "invalid_action_payload" } };
        }
        trustedPayload.methodId = selectedMethod.methodId;
        trustedValue = typeof selectedMethod.displayName === "string" ? selectedMethod.displayName : trustedValue;
      }
      if (clientQuantity !== undefined) {
        trustedPayload.quantity = clientQuantity;
      }
      const trustedAction = {
        attachmentId: attachment.id,
        actionId: actionSpec.id,
        value: trustedValue,
        payload: trustedPayload,
      };
      const customerCommand = customerCommandFromVerifiedAction(trustedAction);
      if (!customerCommand) {
        return { status: 422, body: { errorCode: "invalid_action_payload" } };
      }

      return kfcAgentResponse({
        sessionId: parsed.data.sessionId,
        customerId: parsed.data.customerId,
        clientMessageId: parsed.data.clientMessageId,
        text: normalizeGenUiActionToText(trustedAction),
        metadata: {
          customerCommand,
          rawEvent: {
            source: "kfc_genui_action",
          },
        },
      });
    },
    async chatKfcSessionUpdates(sessionId: string, afterTurnId?: string) {
      if (!sessionId.startsWith("kfc:")) {
        return { status: 400, body: { errorCode: "invalid_kfc_session" } };
      }
      const allTurns = await store.listTurns(sessionId);
      const cursorIndex = afterTurnId ? allTurns.findIndex((turn) => turn.id === afterTurnId) : -1;
      const turns = cursorIndex >= 0 ? allTurns.slice(cursorIndex + 1) : allTurns;
      const control = await store.getSessionControl(sessionId);
      return {
        status: 200,
        body: {
          sessionId,
          agentMode: control.agentMode,
          assignedAgentId: control.assignedAgentId,
          handoffStatus: await persistedHandoffStatus(sessionId, control.agentMode),
          turns,
        },
      };
    },
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
  return routeHandlers;

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
}

function messengerDeliveryFailureForStorage(input: {
  errorCode?: string;
  errorMessage?: string;
}): string {
  if (input.errorCode === "messenger_access_token_invalid") {
    return input.errorMessage ?? input.errorCode;
  }
  return (
    input.errorCode ?? input.errorMessage ?? "assistant_reply_delivery_failed"
  );
}

function eventFromMessengerDelivery(
  delivery: WebhookDelivery,
): ConversationEvent | undefined {
  const text = delivery.payload.text;
  if (typeof text !== "string" || text.length === 0) return undefined;
  const eventType =
    delivery.payload.eventType === "postback" ? "postback" : "message";
  return {
    channel: "messenger",
    externalUserId: delivery.externalUserId,
    externalThreadId: delivery.externalThreadId,
    text,
    eventType,
    rawEventId: delivery.externalEventId,
    receivedAt: delivery.receivedAt,
    platformEventName: eventType,
    shouldRunAgent: true,
    rawEvent:
      typeof delivery.payload.rawEvent === "object" &&
      delivery.payload.rawEvent !== null &&
      !Array.isArray(delivery.payload.rawEvent)
        ? (delivery.payload.rawEvent as Record<string, unknown>)
        : delivery.payload,
  };
}

async function sendMessengerSenderAction(
  client: MessengerClient,
  recipientId: string,
  action: MessengerSenderAction,
  rawEventId: string,
): Promise<boolean> {
  const result = await client.sendSenderAction(recipientId, action);
  if (result.ok) {
    console.log("messenger_sender_action_sent", { action, rawEventId });
    return true;
  }

  console.warn("messenger_sender_action_failed", {
    action,
    rawEventId,
    errorCode: result.errorCode,
    message: result.message,
  });
  return false;
}

function dashboardEventId(sessionId: string, type: string): string {
  return `dash_${sessionId}_${type}_${Date.now()}_${crypto.randomUUID()}`;
}

async function checkCommerceGatewayReadiness(
  config: NonNullable<ReadinessOptions["commerce"]>,
) {
  if (!config.baseUrl) {
    return {
      ok: false,
      mode: "gateway" as const,
      configured: false,
      reachable: false,
      authenticated: false,
      dependencyClass: "unavailable" as const,
      message: "Missing KFC_COMMERCE_GATEWAY_BASE_URL",
    };
  }
  if (!config.token) {
    return {
      ok: false,
      mode: "gateway" as const,
      configured: false,
      reachable: false,
      authenticated: false,
      dependencyClass: "unavailable" as const,
      message: "Missing KFC_COMMERCE_GATEWAY_TOKEN",
    };
  }

  const startedAt = performance.now();
  try {
    const response = await (config.fetchImpl ?? fetch)(
      `${config.baseUrl.replace(/\/$/, "")}/ready`,
      {
        headers: { authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(config.timeoutMs ?? 3000),
      },
    );
    const payload = (await response.json()) as Record<string, unknown>;
    const authenticated = response.status !== 401 && response.status !== 403;
    const capabilities = new Set(
      Array.isArray(payload.capabilities)
        ? payload.capabilities.filter((value): value is string => typeof value === "string")
        : [],
    );
    const missingCapabilities = (config.requiredCapabilities ?? []).filter(
      (capability) => !capabilities.has(capability),
    );
    const ok = response.ok && payload.ok === true && authenticated && missingCapabilities.length === 0;
    return {
      ok,
      mode: "gateway" as const,
      configured: true,
      reachable: true,
      authenticated,
      dependencyClass:
        payload.dependencyClass === "simulated" ||
        payload.dependencyClass === "sandbox" ||
        payload.dependencyClass === "production"
          ? payload.dependencyClass
          : ("unavailable" as const),
      latencyMs: Math.round(performance.now() - startedAt),
      capabilities: [...capabilities],
      missingCapabilities,
      ...(ok
        ? {}
        : {
            message: missingCapabilities.length > 0
              ? `Commerce gateway missing capabilities: ${missingCapabilities.join(", ")}`
              : `Commerce gateway readiness returned HTTP ${response.status}`,
          }),
    };
  } catch (error) {
    return {
      ok: false,
      mode: "gateway" as const,
      configured: true,
      reachable: false,
      authenticated: false,
      dependencyClass: "unavailable" as const,
      latencyMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkCatalogReadiness(
  config: RouteOptions["catalog"],
): Promise<ReadinessCheckResult> {
  if (!config) return { ok: false, configured: false, message: "Missing current catalog provider configuration" };
  try {
    const observation = await fetchCatalogObservation({ ...config, fetchImpl: config.fetchImpl });
    return {
      ok: observation.itemCount > 0,
      configured: true,
      message: observation.itemCount > 0 ? undefined : "Current catalog provider returned no items",
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : "Current catalog provider failed",
    };
  }
}

async function runReadinessCheck(
  check: () => Promise<ReadinessCheckResult>,
): Promise<ReadinessCheckResult> {
  try {
    return await check();
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Readiness check failed",
    };
  }
}

async function checkFixtures(
  fixturesRoot: string,
): Promise<ReadinessCheckResult> {
  try {
    const fixtures = await loadGeneratedFixtures(fixturesRoot);
    return {
      ok: fixtures.menuItems.length > 0 && fixtures.stores.length > 0,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Generated fixtures unavailable",
    };
  }
}

function checkMessengerConfig(options: RouteOptions): ReadinessCheckResult {
  const missing = [
    !options.messengerVerifyToken ? "MESSENGER_VERIFY_TOKEN" : undefined,
    !options.metaAppSecret ? "META_APP_SECRET" : undefined,
    !options.metaPageId ? "META_PAGE_ID" : undefined,
    !options.messengerPageAccessToken ? "META_PAGE_ACCESS_TOKEN" : undefined,
    !options.metaInboxUrlTemplate ? "META_INBOX_URL_TEMPLATE" : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: configured,
    configured,
    required: true,
    message: configured ? undefined : `Missing ${missing.join(", ")}`,
  };
}

function checkZaloConfig(options: RouteOptions): ReadinessCheckResult {
  const required = options.readiness?.zaloRequired ?? true;
  const missing = [
    !options.zaloOaId ? "ZALO_OA_ID" : undefined,
    !options.zaloAccessToken ? "ZALO_ACCESS_TOKEN" : undefined,
    !options.zaloInboxUrlTemplate ? "ZALO_INBOX_URL_TEMPLATE" : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: configured || !required,
    configured,
    required,
    message:
      configured || !required ? undefined : `Missing ${missing.join(", ")}`,
  };
}

function deeplinkForSession(
  sessionId: string,
  config: {
    metaPageId?: string;
    metaInboxUrlTemplate?: string;
    zaloOaId?: string;
    zaloInboxUrlTemplate?: string;
  },
): {
  status: "available" | "unavailable";
  url: string | null;
  reason?: string;
} {
  if (sessionId.startsWith("kfc:")) {
    return {
      status: "unavailable",
      url: null,
      reason: "KFC chat deeplink disabled",
    };
  }

  const target = channelTargetForSession(sessionId);
  if (!target)
    return { status: "unavailable", url: null, reason: "Unknown channel" };

  if (target.channel === "messenger") {
    if (!config.metaInboxUrlTemplate)
      return {
        status: "unavailable",
        url: null,
        reason: "Missing META_INBOX_URL_TEMPLATE",
      };
    if (!config.metaPageId)
      return {
        status: "unavailable",
        url: null,
        reason: "Missing META_PAGE_ID",
      };
    return {
      status: "available",
      url: renderInboxUrlTemplate(config.metaInboxUrlTemplate, {
        pageId: config.metaPageId,
        externalUserId: target.externalUserId,
        sessionId,
      }),
    };
  }

  if (target.channel === "zalo") {
    if (!config.zaloInboxUrlTemplate)
      return {
        status: "unavailable",
        url: null,
        reason: "Missing ZALO_INBOX_URL_TEMPLATE",
      };
    if (!config.zaloOaId)
      return { status: "unavailable", url: null, reason: "Missing ZALO_OA_ID" };
    return {
      status: "available",
      url: renderInboxUrlTemplate(config.zaloInboxUrlTemplate, {
        pageId: config.zaloOaId,
        externalUserId: target.externalUserId,
        sessionId,
      }),
    };
  }

  return { status: "unavailable", url: null, reason: "Unknown channel" };
}

function renderInboxUrlTemplate(
  template: string,
  values: { pageId: string; externalUserId: string; sessionId: string },
): string {
  return template
    .replaceAll("{pageId}", encodeURIComponent(values.pageId))
    .replaceAll("{externalUserId}", encodeURIComponent(values.externalUserId))
    .replaceAll("{sessionId}", encodeURIComponent(values.sessionId));
}

type ChannelProfileTarget = {
  channel: "messenger" | "zalo";
  externalUserId: string;
};

function channelTargetForSession(
  sessionId: string,
): ChannelProfileTarget | undefined {
  const target = dashboardSessionTarget(sessionId);
  const channel =
    target?.channel === "messenger" || target?.channel === "zalo"
      ? target.channel
      : undefined;
  if (target && channel) {
    return {
      channel,
      externalUserId: target.externalUserId,
    };
  }
  return undefined;
}

function humanChannelTargetForSession(sessionId: string) {
  return dashboardSessionTarget(sessionId);
}
