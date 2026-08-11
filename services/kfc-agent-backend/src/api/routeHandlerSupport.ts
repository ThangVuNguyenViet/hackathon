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
import {
  createZaloClient,
  normalizeZaloWebhook,
  PVCFC_ZALO_OA_ID,
} from "../channels/zalo.js";
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
  type MonitorSessionIntelligenceJudge,
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
import type {
  HandlerResponse,
  ReadinessCheckResult,
  ReadinessOptions,
  RouteOptions,
} from './routeHandlerContracts.js';

export function messengerDeliveryFailureForStorage(input: {
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

export function eventFromMessengerDelivery(
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

export async function sendMessengerSenderAction(
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

export async function startMessengerRunTyping(input: {
  messenger: MessengerClient;
  externalUserId: string;
  rawEventId: string;
  alreadyStarted: boolean;
}): Promise<boolean> {
  if (input.alreadyStarted) return true;
  await sendMessengerSenderAction(
    input.messenger,
    input.externalUserId,
    'mark_seen',
    input.rawEventId,
  );
  return sendMessengerSenderAction(
    input.messenger,
    input.externalUserId,
    'typing_on',
    input.rawEventId,
  );
}

export function dashboardEventId(sessionId: string, type: string): string {
  return `dash_${sessionId}_${type}_${Date.now()}_${crypto.randomUUID()}`;
}

export async function checkCommerceGatewayReadiness(
  config: NonNullable<ReadinessOptions["commerce"]>,
) {
  if (!config.baseUrl) {
    return {
      ok: false,
      mode: "gateway" as const,
      configured: false,
      reachable: false,
      authenticated: false,
      commerceEnvironment: "unavailable" as const,
      providerImplementation: "unavailable" as const,
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
      commerceEnvironment: "unavailable" as const,
      providerImplementation: "unavailable" as const,
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
    const requiredCapabilities = config.requiredCapabilities ?? [];
    const missingCapabilities = requiredCapabilities.filter(
      (capability) => !capabilities.has(capability),
    );
    const implementedCapabilities = new Set(
      config.implementedCapabilities ?? requiredCapabilities,
    );
    const missingLocalCapabilities = requiredCapabilities.filter(
      (capability) => !implementedCapabilities.has(capability),
    );
    const ok =
      response.ok &&
      payload.ok === true &&
      authenticated &&
      missingCapabilities.length === 0 &&
      missingLocalCapabilities.length === 0;
    return {
      ok,
      mode: "gateway" as const,
      configured: true,
      reachable: true,
      authenticated,
      commerceEnvironment:
        payload.commerceEnvironment === "sandbox" || payload.commerceEnvironment === "production"
          ? payload.commerceEnvironment
          : ("unavailable" as const),
      providerImplementation:
        typeof payload.providerImplementation === "string" && payload.providerImplementation.length > 0
          ? payload.providerImplementation
          : ("unavailable" as const),
      latencyMs: Math.round(performance.now() - startedAt),
      capabilities: [...capabilities],
      missingCapabilities,
      implementedCapabilities: [...implementedCapabilities],
      missingLocalCapabilities,
      ...(ok
        ? {}
        : {
            message: missingCapabilities.length > 0
              ? `Commerce gateway missing capabilities: ${missingCapabilities.join(", ")}`
              : missingLocalCapabilities.length > 0
                ? `Commerce runtime missing local capabilities: ${missingLocalCapabilities.join(", ")}`
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
      commerceEnvironment: "unavailable" as const,
      providerImplementation: "unavailable" as const,
      latencyMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkCatalogReadiness(
  config: RouteOptions["catalog"],
): Promise<ReadinessCheckResult> {
  if (!config) return { ok: false, configured: false, message: "Missing current catalog provider configuration" };
  try {
    const observation = await fetchCatalogObservation({ ...config, fetchImpl: config.fetchImpl });
    return {
      ok: observation.itemCount > 0,
      configured: true,
      observation: {
        id: observation.id,
        sha256: observation.sha256,
        observedAt: observation.observedAt,
        expiresAt: observation.expiresAt,
        itemCount: observation.itemCount,
        modifierTreeCount: observation.modifierTreeCount,
        providerFingerprint: observation.providerFingerprint,
      },
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

export async function runReadinessCheck(
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

export async function checkFixtures(
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

export function checkMessengerConfig(options: RouteOptions): ReadinessCheckResult {
  const required = options.readiness?.messengerRequired ?? true;
  const missing = [
    !options.messengerVerifyToken ? "MESSENGER_VERIFY_TOKEN" : undefined,
    !options.metaAppSecret ? "META_APP_SECRET" : undefined,
    !options.metaPageId ? "META_PAGE_ID" : undefined,
    !options.messengerPageAccessToken ? "META_PAGE_ACCESS_TOKEN" : undefined,
    !options.metaInboxUrlTemplate ? "META_INBOX_URL_TEMPLATE" : undefined,
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

export function checkZaloConfig(options: RouteOptions): ReadinessCheckResult {
  const required = options.readiness?.zaloRequired ?? true;
  const productionRefreshRequired = options.readiness?.zaloRequired === true;
  const missing = [
    !options.zaloOaId ? "ZALO_OA_ID" : undefined,
    productionRefreshRequired && options.zaloOaId !== PVCFC_ZALO_OA_ID
      ? "ZALO_OA_ID_PVCFC_BINDING"
      : undefined,
    productionRefreshRequired && !options.zaloWebhookSecret
      ? "ZALO_OA_SECRET"
      : undefined,
    !options.zaloAccessToken && !options.zaloAccessTokenProvider
      ? "ZALO_ACCESS_TOKEN_OR_PROVIDER"
      : undefined,
    !options.zaloInboxUrlTemplate ? "ZALO_INBOX_URL_TEMPLATE" : undefined,
    productionRefreshRequired && !options.zaloPublicBaseUrl?.startsWith('https://')
      ? "ZALO_PUBLIC_BASE_URL_HTTPS"
      : undefined,
    productionRefreshRequired && !options.zaloOAuth
      ? "ZALO_OAUTH_REFRESH_CONFIG"
      : undefined,
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

export function deeplinkForSession(
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

export function renderInboxUrlTemplate(
  template: string,
  values: { pageId: string; externalUserId: string; sessionId: string },
): string {
  return template
    .replaceAll("{pageId}", encodeURIComponent(values.pageId))
    .replaceAll("{externalUserId}", encodeURIComponent(values.externalUserId))
    .replaceAll("{sessionId}", encodeURIComponent(values.sessionId));
}

export type ChannelProfileTarget = {
  channel: "messenger" | "zalo";
  externalUserId: string;
};

export function channelTargetForSession(
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

export function humanChannelTargetForSession(sessionId: string) {
  return dashboardSessionTarget(sessionId);
}
